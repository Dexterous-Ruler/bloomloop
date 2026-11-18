// F2 - the review screen behind /api/bank. The teacher reads the bank, edits or
// discards weak items, splits one that is doing two jobs, merges two that are
// doing half of one, and asks for a replacement. Every write goes through the
// same strict validator the model output goes through, so a hand edit cannot
// put a three-option question in front of a student.
//
// Phase 2 adds the approval gate: a generated question arrives as a draft, which
// no room serves, and is approved or rejected here, one at a time or the whole
// bank at once. A professor may also write a question outright, and ask for one
// a Bloom level harder or easier than one already in the bank.
//
// The routes are thin on purpose: fetch, check who owns it, hand the documents
// to services/edits.js, write what comes back. Every rule about what a question
// may become lives there and in questionTypes.js, never here.

import { Router } from 'express';

import { LEVELS, FLOOR, CEILING, isLevel, shiftLevel, LABEL as LEVEL_LABEL } from '../bloom.js';
import { getRepo } from '../repo/index.js';
import { generateForTopic, sourceRefFor } from '../services/generate.js';
import {
  EDITABLE,
  applyEdit,
  patchFor,
  splitQuestion,
  mergeQuestions,
  authorQuestion,
  approvePatch,
  rejectPatch,
  activatePatch,
} from '../services/edits.js';
import { runChecks, failedChecks, isSelectedResponse } from '../services/checks.js';
import { withUpload } from '../services/media.js';
import { KINDS_FOR_LEVEL, LABEL as KIND_LABEL, PAYLOAD_FIELDS, isUngraded } from '../questionTypes.js';
import { contentItemStats } from '../services/itemStats.js';
import { assertCanRead, assertCanWrite, readable } from '../ownership.js';

const router = Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** One bulk press must not turn into a thousand writes. */
const MAX_BULK = 200;

/** As long as the longest topic extraction keeps (MAX_TOPIC_CHARS in services/extract.js). */
const MAX_TOPIC_CHARS = 160;

/** Who is acting, for created_by and approved_by: null on the shared teacher key. */
const actor = (req) => req.viewer?.id ?? null;

/**
 * The body with its stimulus checked against the store: an uploaded image must
 * be one of this chapter's (services/media.js withUpload). Every route that
 * takes a stimulus passes through here before the validator sees it.
 */
async function withStimulus(repo, body, contentId) {
  if (body.stimulus === undefined) return body;
  return { ...body, stimulus: await withUpload(repo, body.stimulus, contentId) };
}

/**
 * A content id from the path, for a write on its bank. Malformed, missing and
 * another teacher's all answer the same 404.
 */
async function contentForWrite(repo, viewer, id) {
  const content = await repo.getContent(id).catch(() => null);
  await assertCanWrite(viewer, content, 'That content');
  return content;
}

/**
 * The single authorization path for every write in this file.
 *
 * A question id says nothing about who owns it, so the deck it belongs to is
 * what gets checked - and it is checked here, once, rather than being spelled
 * out per route where one of them would eventually be written without it.
 */
async function forWrite(repo, viewer, id, contents = null) {
  const question = await repo.getQuestion(id).catch(() => null);
  // Word for word the refusal assertCanWrite gives another teacher's question,
  // so a question id cannot be probed by comparing the two.
  if (!question) throw fail('That question was not found.', 404);
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

    // Discarded items and drafts come back too: the review screen offers a
    // restore and an approval, and the client filters. `counts` covers the
    // active bank only, since that is what the session will actually be able to
    // serve - a draft is not in it until a professor approves it.
    const questions = await repo.listQuestions(content._id, { includeDiscarded: true });

    const counts = LEVELS.reduce((acc, level) => ({ ...acc, [level]: 0 }), {});
    let active = 0;
    let drafts = 0;
    for (const question of questions) {
      if (question.status === 'draft') drafts += 1;
      if (question.status !== 'active') continue;
      active += 1;
      if (isLevel(question.bloom)) counts[question.bloom] += 1;
    }

    res.json({
      questions,
      counts,
      total: questions.length,
      active,
      drafts,
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
 * How each question of this bank has done, across every room run on it that the
 * caller may read (services/itemStats.js): attempts, proportion correct, how many
 * chose each option, mean score, a band for the class, the point-biserial and
 * its flag. Every approved question is listed, answered or not.
 *
 * A read: an HOD may look at a professor's bank. A missing bank and another
 * teacher's are the same 404, word for word. Two segments deep, so GET
 * /:contentId above never answers it, and no other GET here has two segments.
 */
router.get('/:contentId/stats', async (req, res, next) => {
  try {
    const repo = getRepo();
    const content = await repo.getContent(req.params.contentId).catch(() => null);
    await assertCanRead(req.viewer, content, 'That content');
    // Every room on the chapter is its owner's, but each is filtered by the
    // room rule as well, so a room the caller may not read adds nothing.
    const rooms = await readable(req.viewer, await repo.listSessionsForContent(content._id));
    res.json({
      content: { _id: String(content._id), title: content.title ?? '' },
      rooms: rooms.map((r) => ({ code: r.code, title: r.title ?? '', status: r.status, startedAt: r.startedAt ?? null })),
      ...(await contentItemStats(repo, content, rooms)),
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
      // 'draft' is not on offer: a question becomes one only by being generated.
      if (!['active', 'discarded'].includes(body.status)) {
        throw fail("status must be 'active' or 'discarded'.", 400);
      }
      // Setting a draft active is approving it, so it is recorded as one.
      Object.assign(patch, body.status === 'active'
        ? activatePatch(existing, { by: actor(req) })
        : { status: 'discarded' });
    }

    // Absent means "leave it alone"; empty means "I emptied it" and is an edit
    // like any other, so it reaches the validator and gets refused by name. The
    // list is imported, never retyped - a second copy here would decide that a
    // field was not an edit while applyEdit went on merging it.
    const edits = EDITABLE.some((field) => body[field] !== undefined);

    if (edits) {
      const { question, reason } = applyEdit(existing, await withStimulus(repo, body, existing.contentId));
      if (reason) throw fail(reason, 400);
      // The status is not in an edit's patch, so an edited question keeps the
      // one it had: an active question stays active, a draft stays a draft.
      Object.assign(patch, patchFor(question));
      // The checks describe the wording, so new wording is checked again.
      patch.checks = runChecks(question);
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
    // fewer usable question than they started with. The halves keep the
    // original's status (a draft's halves are drafts) and are checked afresh.
    const questions = await repo.insertQuestions(
      parts.map((part) => ({ ...part, createdBy: actor(req), checks: runChecks(part) })),
    );
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

    const [question] = await repo.insertQuestions([{ ...made, createdBy: actor(req), checks: runChecks(made) }]);
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
 *
 * `stimulus` is how several questions share one passage or image: the same
 * stimulus is put on every question picked (null takes it off). Each question
 * gets its own copy, never a reference to a shared row, for the reasons the
 * generator gives for its shared readings: a question is served, snapshotted
 * into the evidence and archived on its own, and a passage edited in one place
 * must not quietly change what the answers already given were answers to. The
 * copies are equal, so questions sharing a passage are the ones whose passages
 * are equal; sending this again with an edited passage is how all of them change.
 */
router.post('/bulk', async (req, res, next) => {
  try {
    const { ids, action, bloom, stimulus } = req.body ?? {};
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];

    if (!unique.length) throw fail('Pick at least one question first.', 400);
    if (unique.length > MAX_BULK) throw fail(`That is ${unique.length} questions; ${MAX_BULK} at a time is the limit.`, 400);
    if (!['discard', 'restore', 'bloom', 'stimulus'].includes(action)) {
      throw fail("action must be 'discard', 'restore', 'bloom' or 'stimulus'.", 400);
    }
    if (action === 'bloom' && !isLevel(bloom)) {
      throw fail(`Retagging needs a level: ${LEVELS.join(', ')}.`, 400);
    }
    if (action === 'stimulus' && stimulus === undefined) {
      throw fail('Sharing a stimulus needs one: send "stimulus" as a passage or an image, or null to take it off.', 400);
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
          patch = { ...patchFor(question), checks: runChecks(question) };
        } else if (action === 'stimulus') {
          // Through applyEdit like any edit, so the whole question is validated
          // with its new stimulus, and the checks re-run: attaching the picture
          // a stem points at is what clears slide-only-reference.
          const { question, reason } = applyEdit(existing, await withStimulus(repo, { stimulus }, existing.contentId));
          if (reason) throw fail(reason, 400);
          patch = { ...patchFor(question), checks: runChecks(question) };
        } else {
          // A restore of model output nobody approved is its approval, and is
          // recorded as one - see activatePatch.
          patch = action === 'discard' ? { status: 'discarded' } : activatePatch(existing, { by: actor(req) });
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

/**
 * A new question in place of this one, written by the generator.
 *
 * With no body it is a replacement at the same level, and the old one is
 * discarded, as it always was. With `direction: 'harder'` or `'easier'` it is a
 * new draft one Bloom level up or down, on the same topic and from the same
 * slides, and the original is left exactly as it is: the professor is asking for
 * a second question beside it, not rejecting it.
 *
 * Either way the new question is a draft. It came from the generator, so it
 * waits for approval like every other generated item.
 */
router.post('/question/:id/regenerate', async (req, res, next) => {
  try {
    const direction = req.body?.direction ?? null;
    if (direction !== null && direction !== 'harder' && direction !== 'easier') {
      throw fail("direction must be 'harder' or 'easier', or left out for a replacement at the same level.", 400);
    }

    const repo = getRepo();
    const { question: old, content } = await forWrite(repo, req.viewer, req.params.id);
    if (!isLevel(old.bloom)) throw fail('That question has no valid Bloom tag to regenerate against.', 400);

    let bloom = old.bloom;
    if (direction) {
      // A poll's tag says where it sits in the lesson, not what it demands, so
      // there is no level to move it up or down from.
      if (isUngraded(old.kind)) throw fail('A poll is not marked, so it has no level to make harder or easier.', 400);
      if (direction === 'easier' && old.bloom === FLOOR) {
        throw fail(`This question is at ${LEVEL_LABEL[FLOOR]}, the bottom of the ladder, so there is no easier level to write it at.`, 400);
      }
      if (direction === 'harder' && old.bloom === CEILING) {
        throw fail(`This question is at ${LEVEL_LABEL[CEILING]}, the top of the ladder, so there is no harder level to write it at.`, 400);
      }
      bloom = shiftLevel(old.bloom, direction === 'harder' ? 1 : -1);
    }

    // Hand the generator everything already written for this topic so the
    // new question is a genuinely new item rather than one already in the bank.
    const siblings = await repo.listQuestions(content._id, { includeDiscarded: true });
    const avoidTexts = siblings
      .filter((question) => question.topic === old.topic)
      .map((question) => question.text);

    // No `kinds`: each level is asked through its own default interaction, and
    // at Create that is the written answer.
    const { questions } = await generateForTopic({
      topic: old.topic || content.title,
      contextText: content.rawText,
      mix: { [bloom]: 1 },
      avoidTexts,
    });

    const item = questions[0];
    if (!item || item.bloom !== bloom) {
      throw fail(direction
        ? `Could not write a ${LEVEL_LABEL[bloom]} question on this topic from the material.`
        : 'Could not generate a replacement question.', 502);
    }
    // Picking from offered options never reaches Create (Crowe et al. 2008).
    // The generator only writes `open` there; this holds even if that changes.
    if (bloom === CEILING && isSelectedResponse(item.kind)) {
      throw fail(`The generator offered a "${KIND_LABEL[item.kind] ?? item.kind}" at ${LEVEL_LABEL[CEILING]}, which picking cannot reach. Nothing was saved.`, 502);
    }

    const row = {
      contentId: content._id,
      topic: old.topic || item.topic,
      text: item.text,
      kind: item.kind ?? 'mcq',
      bloom: item.bloom,
      source: item.source,
      status: 'draft',
      model: item.model ?? null,
      // Same topic, so the same slides. A question older than slide references
      // looks its topic up instead.
      sourceRef: old.sourceRef ?? sourceRefFor(content, old.topic || item.topic),
      createdBy: actor(req),
    };
    if (Array.isArray(item.options)) row.options = item.options;
    if (Number.isInteger(item.answerIdx)) row.answerIdx = item.answerIdx;
    // Carry whatever this kind needs. Naming only options/answerIdx here is what
    // landed every regenerated match, order, blank and open item in the bank
    // with nothing to answer - the same bug generate.js had, in the one route
    // that had not been fixed with it.
    for (const f of PAYLOAD_FIELDS) if (item[f] !== undefined) row[f] = item[f];
    row.checks = runChecks(row);

    // Insert first: a failed insert must not leave the teacher with one fewer
    // usable item than they started with.
    const [question] = await repo.insertQuestions([row]);

    if (!direction) await repo.updateQuestion(old._id, { status: 'discarded' });

    // Said, because it is the one way a regenerate takes something away: the
    // old question was let into rooms and the new one has not been yet. A bank
    // just at the floor stops opening rooms until it is approved.
    const warnings = !direction && old.status === 'active'
      ? ['The question this replaces was in use, so it has left rooms now. Its replacement is a draft, and joins them when you approve it.']
      : [];

    res.json({ question, ...(direction ? { direction, from: String(old._id) } : {}), ...(warnings.length ? { warnings } : {}) });
  } catch (err) {
    next(err);
  }
});

/**
 * Let one question into rooms: active, with who approved it and when.
 *
 * Failing rule checks do not stop it - they are advice, and the professor has
 * read the question - but the reply names each one that failed.
 */
router.post('/question/:id/approve', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { question: existing } = await forWrite(repo, req.viewer, req.params.id);

    // Run again rather than trusted from the row: a question older than the
    // checks has none stored, and the reply must say what is true now.
    const checks = runChecks(existing);
    const { patch, changed } = approvePatch(existing, { by: actor(req) });
    const stale = JSON.stringify(existing.checks ?? null) !== JSON.stringify(checks);
    const question = changed || stale
      ? await repo.updateQuestion(existing._id, { ...patch, checks })
      : existing;
    if (!question) throw fail('That question was not found.', 404);

    res.json({ question, changed, failedChecks: failedChecks(checks) });
  } catch (err) {
    next(err);
  }
});

/** Keep one question out of rooms: the discarded status, so a restore still works. */
router.post('/question/:id/reject', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { question: existing } = await forWrite(repo, req.viewer, req.params.id);
    const { patch, changed } = rejectPatch(existing);
    const question = changed ? await repo.updateQuestion(existing._id, patch) : existing;
    if (!question) throw fail('That question was not found.', 404);
    res.json({ question, changed });
  } catch (err) {
    next(err);
  }
});

/**
 * Approve every draft in one bank. Rejected and active questions are left as
 * they are. The reply lists, per approved question, the checks it failed, so
 * "approve all" never hides a flag the professor did not open.
 */
router.post('/:contentId/approve-all', async (req, res, next) => {
  try {
    const repo = getRepo();
    const content = await contentForWrite(repo, req.viewer, req.params.contentId);
    const drafts = (await repo.listQuestions(content._id, { includeDiscarded: true }))
      .filter((q) => q.status === 'draft');

    const at = new Date().toISOString();
    const questions = [];
    const flagged = [];
    for (const draft of drafts) {
      const checks = runChecks(draft);
      const { patch } = approvePatch(draft, { by: actor(req), at });
      const question = await repo.updateQuestion(draft._id, { ...patch, checks });
      if (!question) continue;
      questions.push(question);
      const failed = failedChecks(checks);
      if (failed.length) flagged.push({ id: String(question._id), text: question.text, failedChecks: failed });
    }

    res.json({
      approved: questions.length,
      questions,
      flagged,
      bankCount: await repo.countQuestions(content._id),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * A question the professor writes. Any kind, at its own level (a poll at any),
 * validated exactly as an edit is. It is created active: the person who wrote
 * it is the person who would approve it. No model wrote it, so `model` is null,
 * and the rule checks run on it too - as advice, in the reply.
 *
 * `source` is 'fallback', because CONTRACT.md section 6 rule 5 says every item
 * not produced by the model must carry it. model: null is what says a person
 * wrote it.
 */
router.post('/:contentId/questions', async (req, res, next) => {
  try {
    const repo = getRepo();
    const content = await contentForWrite(repo, req.viewer, req.params.contentId);
    const body = req.body ?? {};

    if (body.topic !== undefined && body.topic !== null && typeof body.topic !== 'string') {
      throw fail('topic must be text.', 400);
    }
    const topic = String(body.topic ?? '').replace(/\s+/g, ' ').trim();
    if (topic.length > MAX_TOPIC_CHARS) throw fail(`topic must be at most ${MAX_TOPIC_CHARS} characters.`, 400);

    const { question: made, reason } = authorQuestion(await withStimulus(repo, body, content._id));
    if (reason) throw fail(reason, 400);

    const checks = runChecks(made);
    const [question] = await repo.insertQuestions([{
      contentId: content._id,
      topic,
      ...patchFor(made),
      source: 'fallback',
      status: 'active',
      model: null,
      sourceRef: null,
      checks,
      createdBy: actor(req),
    }]);

    res.status(201).json({ question, failedChecks: failedChecks(checks) });
  } catch (err) {
    next(err);
  }
});

export default router;
