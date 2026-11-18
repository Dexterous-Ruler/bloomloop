// F2 - the review screen behind /api/bank. The teacher reads the bank, edits or
// discards weak items, splits one that is doing two jobs, merges two that are
// doing half of one, and asks for a replacement. Every write goes through the
// same strict validator the model output goes through, so a hand edit cannot
// put a three-option question in front of a student.
//
// The routes are thin on purpose: fetch, check who owns it, hand the documents
// to services/edits.js, write what comes back. Every rule about what a question
// may become lives there and in questionTypes.js, never here.

import { Router } from 'express';

import { LEVELS, isLevel, LABEL as LEVEL_LABEL } from '../bloom.js';
import { getRepo } from '../repo/index.js';
import { generateForTopic } from '../services/generate.js';
import { EDITABLE, applyEdit, patchFor, splitQuestion, mergeQuestions } from '../services/edits.js';
import { KINDS_FOR_LEVEL, LABEL as KIND_LABEL, PAYLOAD_FIELDS } from '../questionTypes.js';
import { assertCanRead, assertCanWrite } from '../ownership.js';

const router = Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** One bulk press must not turn into a thousand writes. */
const MAX_BULK = 200;

/**
 * The single authorization path for every write in this file.
 *
 * A question id says nothing about who owns it, so the deck it belongs to is
 * what gets checked - and it is checked here, once, rather than being spelled
 * out per route where one of them would eventually be written without it.
 */
async function forWrite(repo, viewer, id, contents = null) {
  const question = await repo.getQuestion(id).catch(() => null);
  if (!question) throw fail('Question not found.', 404);
  const cid = String(question.contentId);
  // Bulk actions touch one deck many times; the ownership check still runs per
  // question, only the row it checks against is remembered.
  let content = contents?.get(cid);
  if (content === undefined) {
    content = await repo.getContent(question.contentId).catch(() => null);
    contents?.set(cid, content);
  }
  await assertCanWrite(viewer, content, 'That question');
  return { question, content };
}

router.get('/:contentId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const content = await repo.getContent(req.params.contentId).catch(() => null);
    // This response carries answerIdx for every item, so the ownership check is
    // the only thing between one teacher's key and another teacher's class.
    await assertCanRead(req.viewer, content, 'That content');

    // Discarded items come back too: the review screen offers a restore, and the
    // client filters. `counts` covers the active bank only, since that is what
    // the session will actually be able to serve.
    const questions = await repo.listQuestions(content._id, { includeDiscarded: true });

    const counts = LEVELS.reduce((acc, level) => ({ ...acc, [level]: 0 }), {});
    let active = 0;
    for (const question of questions) {
      if (question.status === 'discarded') continue;
      active += 1;
      if (isLevel(question.bloom)) counts[question.bloom] += 1;
    }

    res.json({
      questions,
      counts,
      total: questions.length,
      active,
      // Which interactions each level may be asked through, straight from the
      // contract. The editor offers exactly this and nothing else, so the list
      // a teacher sees and the list the server accepts cannot drift apart -
      // and the client is never the thing deciding what a question may be.
      kinds: { forLevel: KINDS_FOR_LEVEL, label: KIND_LABEL },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * A full edit of any kind: text, level, type and every payload field.
 *
 * The merged result is validated as one whole and refused with the validator's
 * own wording, which is written to be read by a teacher rather than a log.
 */
router.patch('/question/:id', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const repo = getRepo();
    const { question: existing } = await forWrite(repo, req.viewer, req.params.id);

    const patch = {};

    if (body.status !== undefined) {
      if (!['active', 'discarded'].includes(body.status)) {
        throw fail("status must be 'active' or 'discarded'.", 400);
      }
      patch.status = body.status;
    }

    // Absent means "leave it alone"; empty means "I emptied it" and is an edit
    // like any other, so it reaches the validator and gets refused by name. The
    // list is imported, never retyped - a second copy here would decide that a
    // field was not an edit while applyEdit went on merging it.
    const edits = EDITABLE.some((field) => body[field] !== undefined);

    if (edits) {
      const { question, reason } = applyEdit(existing, body);
      if (reason) throw fail(reason, 400);
      Object.assign(patch, patchFor(question));
    }

    if (!Object.keys(patch).length) throw fail('Nothing to update.', 400);

    const question = await repo.updateQuestion(existing._id, patch);
    if (!question) throw fail('Question not found.', 404);

    res.json({ question });
  } catch (err) {
    next(err);
  }
});

/**
 * One question in, two out. Both halves are validated before anything is
 * written, and the original is discarded rather than deleted so a split the
 * teacher did not like is one press away from being undone.
 */
router.post('/question/:id/split', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { question: old } = await forWrite(repo, req.viewer, req.params.id);

    const { parts, reason } = splitQuestion(old);
    if (reason) throw fail(reason, 400);

    // Insert first: a failed insert must not leave the teacher holding one
    // fewer usable question than they started with.
    const questions = await repo.insertQuestions(parts);
    await repo.updateQuestion(old._id, { status: 'discarded' });

    res.json({ questions, discarded: String(old._id) });
  } catch (err) {
    next(err);
  }
});

/** Two questions of one kind and one level into one. Both parents are discarded. */
router.post('/merge', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    if (!ids || ids.length !== 2) throw fail('Merging takes exactly two questions.', 400);

    const repo = getRepo();
    const contents = new Map();
    const { question: a } = await forWrite(repo, req.viewer, ids[0], contents);
    const { question: b } = await forWrite(repo, req.viewer, ids[1], contents);

    const { question: made, reason } = mergeQuestions(a, b);
    if (reason) throw fail(reason, 400);

    const [question] = await repo.insertQuestions([made]);
    await repo.updateQuestion(a._id, { status: 'discarded' });
    await repo.updateQuestion(b._id, { status: 'discarded' });

    res.json({ question, discarded: [String(a._id), String(b._id)] });
  } catch (err) {
    next(err);
  }
});

/**
 * One action across a selection. Each id is fetched and authorized exactly as
 * the single-item routes do, and a refusal on one is reported rather than
 * failing the rest - a teacher retagging thirty items should not lose
 * twenty-nine of them because the thirtieth cannot honestly move.
 */
router.post('/bulk', async (req, res, next) => {
  try {
    const { ids, action, bloom } = req.body ?? {};
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];

    if (!unique.length) throw fail('Pick at least one question first.', 400);
    if (unique.length > MAX_BULK) throw fail(`That is ${unique.length} questions; ${MAX_BULK} at a time is the limit.`, 400);
    if (!['discard', 'restore', 'bloom'].includes(action)) {
      throw fail("action must be 'discard', 'restore' or 'bloom'.", 400);
    }
    if (action === 'bloom' && !isLevel(bloom)) {
      throw fail(`Retagging needs a level: ${LEVELS.join(', ')}.`, 400);
    }

    const repo = getRepo();
    const contents = new Map();
    const changed = [];
    const refused = [];

    for (const id of unique) {
      try {
        const { question: existing } = await forWrite(repo, req.viewer, id, contents);

        let patch;
        if (action === 'bloom') {
          // Straight through applyEdit, so a bulk retag obeys the same rule a
          // single one does: the level chooses the interaction, and a question
          // that cannot honestly be asked at the new level is refused here
          // instead of quietly landing there mis-shaped.
          const { question, reason } = applyEdit(existing, { bloom });
          if (reason) throw fail(reason, 400);
          patch = patchFor(question);
        } else {
          patch = { status: action === 'discard' ? 'discarded' : 'active' };
        }

        const question = await repo.updateQuestion(existing._id, patch);
        if (!question) throw fail('Question not found.', 404);
        changed.push(question);
      } catch (err) {
        refused.push({ id, reason: err.message });
      }
    }

    res.json({
      action,
      questions: changed,
      changed: changed.length,
      refused,
      ...(action === 'bloom' ? { bloom, level: LEVEL_LABEL[bloom] } : {}),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/question/:id/regenerate', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { question: old, content } = await forWrite(repo, req.viewer, req.params.id);
    if (!isLevel(old.bloom)) throw fail('That question has no valid Bloom tag to regenerate against.', 400);

    // Hand the generator everything already written for this topic so the
    // replacement is a genuinely new item rather than the one just rejected.
    const siblings = await repo.listQuestions(content._id, { includeDiscarded: true });
    const avoidTexts = siblings
      .filter((question) => question.topic === old.topic)
      .map((question) => question.text);

    const { questions } = await generateForTopic({
      topic: old.topic || content.title,
      contextText: content.rawText,
      mix: { [old.bloom]: 1 },
      avoidTexts,
    });

    const item = questions[0];
    if (!item) throw fail('Could not generate a replacement question.', 502);

    const row = {
      contentId: content._id,
      topic: old.topic || item.topic,
      text: item.text,
      kind: item.kind ?? 'mcq',
      bloom: item.bloom,
      source: item.source,
      status: 'active',
    };
    if (Array.isArray(item.options)) row.options = item.options;
    if (Number.isInteger(item.answerIdx)) row.answerIdx = item.answerIdx;
    // Carry whatever this kind needs. Naming only options/answerIdx here is what
    // landed every regenerated match, order, blank and open item in the bank
    // with nothing to answer - the same bug generate.js had, in the one route
    // that had not been fixed with it.
    for (const f of PAYLOAD_FIELDS) if (item[f] !== undefined) row[f] = item[f];

    // Insert first: a failed insert must not leave the teacher with one fewer
    // usable item than they started with.
    const [question] = await repo.insertQuestions([row]);

    await repo.updateQuestion(old._id, { status: 'discarded' });

    res.json({ question });
  } catch (err) {
    next(err);
  }
});

export default router;
