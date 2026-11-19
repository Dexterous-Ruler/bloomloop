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
import { checkFigure, figureForStaff } from '../figures/index.js';
import { draftChecks } from '../services/figureDrafts.js';
import { KINDS_FOR_LEVEL, LABEL as KIND_LABEL, PAYLOAD_FIELDS, isUngraded } from '../questionTypes.js';
import { contentItemStats, questionMisconceptions } from '../services/itemStats.js';
import {
  LABELLED_KINDS,
  LABEL_NOTE,
  MAX_LABEL,
  changeLabels,
  keptLabels,
  labelView,
  labelsOf,
  optionTexts,
  stampLabels,
  wrongIdxs,
} from '../services/misconceptions.js';
import { ROOMS_ONLY_SENTENCE } from '../services/bankShare.js';
import { assertCanRead, assertCanWrite, canWrite, readable } from '../ownership.js';
import { staffQuestion } from '../services/honesty.js';

const router = Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** One bulk press must not turn into a thousand writes. */
const MAX_BULK = 200;

/** As long as the longest topic extraction keeps (MAX_TOPIC_CHARS in services/extract.js). */
const MAX_TOPIC_CHARS = 160;

/** Who is acting, for created_by and approved_by: null on the shared teacher key. */
const actor = (req) => req.viewer?.id ?? null;

/**
 * A question just made active, and the active question it was regenerated to
 * replace (`replacesId`, 0022): the old one is retired now, set discarded, as a
 * plain regenerate always discarded it, only later. Until this approval it went
 * on serving (the owner's decision of 19 Nov 2026). Only an active question of
 * the same chapter is retired; one discarded or edited away since is left alone.
 * Every route that makes a question active calls this.
 *
 * @returns {Promise<string|null>} the id retired, or null
 */
async function retireReplaced(repo, question) {
  if (question?.status !== 'active' || !question.replacesId) return null;
  const old = await repo.getQuestion(question.replacesId).catch(() => null);
  if (!old || old.status !== 'active' || String(old.contentId) !== String(question.contentId)) return null;
  await repo.updateQuestion(old._id, { status: 'discarded' });
  return String(old._id);
}

/**
 * The body with its stimulus checked against the store: an uploaded image must
 * be one of this chapter's (services/media.js withUpload). Every route that
 * takes a stimulus passes through here before the validator sees it.
 */
async function withStimulus(repo, body, contentId) {
  if (body.stimulus === undefined) return body;
  // A figure (Batch 8) is drawn now, with every step, by the engines that will
  // draw it for phones: a spec they refuse is refused here with their sentence,
  // and the spec is stored as checked (figures/index.js checkFigure).
  if (body.stimulus?.kind === 'figure') {
    const checked = await checkFigure(body.stimulus.spec);
    if (checked.reason) throw fail(`The figure was not saved: ${checked.reason}`, 400);
    return { ...body, stimulus: { ...body.stimulus, spec: checked.spec } };
  }
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

/**
 * The misconception labels an edit leaves standing (keptLabels): an option
 * reworded or taken away, or made a right answer, loses its label with the
 * edit, which writes the shorter list into `patch`. Returns what was removed,
 * so the reply can name each one rather than let a label go quietly.
 */
function prunedLabels(existing, question, patch) {
  const before = labelsOf(existing);
  const { kept, removed } = keptLabels(question, before);
  if (JSON.stringify(kept) !== JSON.stringify(before)) patch.misconceptions = kept;
  return removed.map((l) => ({ option: l.option, label: l.label, provenance: l.provenance }));
}

const removedNote = (n) => (n === 1
  ? 'One misconception label no longer applied and was removed: its option was reworded or taken away, or became a '
    + 'right answer. Add it again if it still fits.'
  : `${n} misconception labels no longer applied and were removed: their options were reworded or taken away, or `
    + 'became right answers. Add them again where they still fit.');

/** A question's labels as the label routes answer them. */
const labelsBody = (question, canEdit) => {
  const kind = question.kind ?? 'mcq';
  return {
    question: {
      _id: String(question._id),
      text: question.text ?? '',
      kind,
      kindLabel: KIND_LABEL[kind] ?? kind,
      bloom: question.bloom ?? null,
      topic: question.topic ?? '',
      status: question.status ?? 'active',
      // The options a label can sit on, by index (true/false: True, False).
      options: optionTexts(question) ?? [],
    },
    labelled: LABELLED_KINDS.includes(kind),
    wrongOptions: wrongIdxs(question),
    misconceptions: labelView(question),
    canEdit,
    maxLength: MAX_LABEL,
    note: LABEL_NOTE,
  };
};

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
      // Each with its provenance and approval state, and whether its level is
      // one to check (services/honesty.js, Phase 5): staff-only, like the rest.
      // A figure stimulus also comes drawn (Batch 8): the picture, description,
      // table and parts a phone would get, so the review screen shows the same.
      questions: questions.map((q) => {
        const view = staffQuestion(q);
        return q.stimulus?.kind === 'figure' ? { ...view, figure: figureForStaff(q.stimulus.spec) } : view;
      }),
      counts,
      total: questions.length,
      active,
      drafts,
      // Which interactions each level may be asked through, straight from the
      // contract. The editor offers exactly this and nothing else, so the list
      // a teacher sees and the list the server accepts cannot drift apart -
      // and the client is never the thing deciding what a question may be.
      kinds: { forLevel: KINDS_FOR_LEVEL, label: KIND_LABEL },
      // Which kinds take a misconception label on their wrong options, and how
      // long one may be (services/misconceptions.js), so the editor offers what
      // the label route accepts.
      misconceptionLabels: { kinds: LABELLED_KINDS, maxLength: MAX_LABEL, note: LABEL_NOTE },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * One question of a bank, as the bank lists it, so a screen elsewhere (an error
 * log entry, an item report, a lesson's question) can link to it on its own.
 * Any status: a link may point at a draft or a discarded question.
 *
 * The bank's own rule, because it carries the same answer key: the owner
 * reads, an HOD reads (`canEdit` false), and a missing question and another
 * teacher's are the same 404, word for word. Registered before
 * /:contentId/stats, which would otherwise take /question/stats for the
 * statistics of a chapter whose id is "question".
 */
router.get('/question/:id', async (req, res, next) => {
  try {
    const repo = getRepo();
    const question = await repo.getQuestion(req.params.id).catch(() => null);
    if (!question) throw fail('That question was not found.', 404);
    const content = await repo.getContent(question.contentId).catch(() => null);
    await assertCanRead(req.viewer, content, 'That question');
    res.json({
      question: staffQuestion(question),
      content: { _id: String(content._id), title: content.title ?? '' },
      canEdit: await canWrite(req.viewer, content.ownerId ?? null),
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
 * /:contentId above never answers it; GET /question/:id is the one other GET
 * with two segments, and is registered first.
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
    let labelsRemoved = [];

    if (edits) {
      const { question, reason } = applyEdit(existing, await withStimulus(repo, body, existing.contentId));
      if (reason) throw fail(reason, 400);
      // The status is not in an edit's patch, so an edited question keeps the
      // one it had: an active question stays active, a draft stays a draft.
      Object.assign(patch, patchFor(question));
      // The checks describe the wording, so new wording is checked again.
      patch.checks = runChecks(question);
      labelsRemoved = prunedLabels(existing, question, patch);
    }

    if (!Object.keys(patch).length) throw fail('Nothing to update.', 400);

    const question = await repo.updateQuestion(existing._id, patch);
    if (!question) throw fail('Question not found.', 404);
    // Setting a regenerated draft active is its approval: the question it
    // replaces leaves rooms now.
    const retired = body.status === 'active' && existing.status !== 'active' ? await retireReplaced(repo, question) : null;

    res.json({
      question: staffQuestion(question),
      ...(retired ? { retired } : {}),
      ...(labelsRemoved.length ? { misconceptionsRemoved: labelsRemoved, misconceptionsNote: removedNote(labelsRemoved.length) } : {}),
    });
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
    // Each half keeps the labels of the wrong options it carries over, by their
    // words, as an edit keeps them.
    const questions = await repo.insertQuestions(
      parts.map((part) => ({
        ...part, misconceptions: keptLabels(part, labelsOf(old)).kept, createdBy: actor(req), checks: runChecks(part),
      })),
    );
    await repo.updateQuestion(old._id, { status: 'discarded' });

    res.json({ questions: questions.map(staffQuestion), discarded: String(old._id) });
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

    // Both parents' labels on the wrong options the merged question carries.
    const misconceptions = keptLabels(made, [...labelsOf(a), ...labelsOf(b)]).kept;
    const [question] = await repo.insertQuestions([{ ...made, misconceptions, createdBy: actor(req), checks: runChecks(made) }]);
    await repo.updateQuestion(a._id, { status: 'discarded' });
    await repo.updateQuestion(b._id, { status: 'discarded' });

    res.json({ question: staffQuestion(question), discarded: [String(a._id), String(b._id)] });
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
    const retired = [];
    const labelsRemoved = [];

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
          // A retag that changes the kind can leave no option a label fits.
          const removed = prunedLabels(existing, question, patch);
          if (removed.length) labelsRemoved.push({ id: String(existing._id), labels: removed });
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
        // A restore of a regenerated draft approves it, so what it replaces retires.
        if (action === 'restore' && existing.status !== 'active') {
          const gone = await retireReplaced(repo, question);
          if (gone) retired.push(gone);
        }
      } catch (err) {
        refused.push({ id, reason: err.message });
      }
    }

    res.json({
      action,
      questions: changed.map(staffQuestion),
      changed: changed.length,
      refused,
      ...(retired.length ? { retired } : {}),
      ...(action === 'bloom' ? { bloom, level: LEVEL_LABEL[bloom] } : {}),
      ...(labelsRemoved.length ? {
        misconceptionsRemoved: labelsRemoved,
        misconceptionsNote: removedNote(labelsRemoved.reduce((n, r) => n + r.labels.length, 0)),
      } : {}),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * A new question in place of this one, written by the generator.
 *
 * With no body it is a replacement at the same level. An active question goes
 * on serving until the replacement is approved, which retires it (19 Nov 2026,
 * `replacesId`); a draft or rejected one is discarded at once, as before, and
 * when it was itself a replacement the new draft takes over what it replaces. With
 * `direction: 'harder'` or `'easier'` it is a
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

    // A plain regenerate of an ACTIVE question (the owner's decision of 19 Nov
    // 2026): the old one goes on serving, and the draft names it (0022), so
    // approving the draft retires it (retireReplaced). Before, the old one was
    // discarded here and its slot left rooms until the draft was approved.
    const replacing = !direction && old.status === 'active';
    // A plain regenerate of a replacement that was never approved (a draft, or
    // a draft rejected) passes its link on: the new draft replaces the same
    // active question, so approving it still retires that one. The draft itself
    // is discarded below, as always; without this its link went with it, and
    // the active question and the approved replacement both served.
    const carried = !direction && !replacing && old.replacesId && !old.approvedAt ? String(old.replacesId) : null;
    const replaces = replacing ? String(old._id) : carried;
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
      ...(replaces ? { replacesId: replaces } : {}),
    };
    if (Array.isArray(item.options)) row.options = item.options;
    if (Number.isInteger(item.answerIdx)) row.answerIdx = item.answerIdx;
    // Carry whatever this kind needs. Naming only options/answerIdx here is what
    // landed every regenerated match, order, blank and open item in the bank
    // with nothing to answer - the same bug generate.js had, in the one route
    // that had not been fixed with it.
    for (const f of PAYLOAD_FIELDS) if (item[f] !== undefined) row[f] = item[f];
    // The model's proposed misconception labels (0024), AI drafts like the
    // question. The old question's labels stay with the old question.
    if (item.misconceptions?.length) row.misconceptions = stampLabels(item.misconceptions);
    // The rule checks, and what generation found about a figure and its key.
    row.checks = draftChecks(row, item);

    // Insert first: a failed insert must not leave the teacher with one fewer
    // usable item than they started with.
    const [question] = await repo.insertQuestions([row]);

    // A draft or a rejected question being replaced was serving nothing, and is
    // discarded now, as it always was. An active one waits for the approval.
    if (!direction && !replacing) await repo.updateQuestion(old._id, { status: 'discarded' });

    res.json({
      question: staffQuestion(question),
      ...(direction ? { direction, from: String(old._id) } : {}),
      ...(replaces
        ? {
          replaces,
          note: 'The question this replaces stays in rooms until you approve its replacement. Approving it takes the old '
            + 'one out; rejecting it leaves the old one as it is.',
        }
        : {}),
    });
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
    // The question a regenerated draft replaces leaves rooms with this approval.
    const retired = existing.status !== 'active' ? await retireReplaced(repo, question) : null;

    res.json({ question: staffQuestion(question), changed, failedChecks: failedChecks(checks), ...(retired ? { retired } : {}) });
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
    res.json({ question: staffQuestion(question), changed });
  } catch (err) {
    next(err);
  }
});

// ---- Batch 8: the shared question bank's "rooms only" switch ----

/**
 * Keep one question for rooms only, or share it with the Learning Hub again
 * ({ roomsOnly: true | false }; services/bankShare.js). The owner's write, like
 * every write here (an HOD is refused, another teacher's question is the same
 * 404). Rooms serve it either way; the hub never offers a question kept for
 * rooms. A draft may carry it too, so it is kept for rooms from its approval.
 */
router.put('/question/:id/rooms-only', async (req, res, next) => {
  try {
    if (typeof req.body?.roomsOnly !== 'boolean') throw fail('Say whether to keep this question for rooms only: true or false.', 400);
    const repo = getRepo();
    const { question: existing } = await forWrite(repo, req.viewer, req.params.id);
    const want = req.body.roomsOnly;
    const changed = (existing.roomsOnly === true) !== want;
    const question = changed ? await repo.setQuestionRoomsOnly(existing._id, want) : existing;
    if (!question) throw fail('That question was not found.', 404);
    res.json({
      question: staffQuestion(question),
      changed,
      roomsOnly: question.roomsOnly === true,
      message: ROOMS_ONLY_SENTENCE[question.roomsOnly === true ? 'on' : 'off'],
    });
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
    const retired = [];
    for (const draft of drafts) {
      const checks = runChecks(draft);
      const { patch } = approvePatch(draft, { by: actor(req), at });
      const question = await repo.updateQuestion(draft._id, { ...patch, checks });
      if (!question) continue;
      questions.push(question);
      const failed = failedChecks(checks);
      if (failed.length) flagged.push({ id: String(question._id), text: question.text, failedChecks: failed });
      const gone = await retireReplaced(repo, question);
      if (gone) retired.push(gone);
    }

    res.json({
      approved: questions.length,
      questions: questions.map(staffQuestion),
      flagged,
      // Questions that regenerated drafts replaced, taken out of rooms now.
      retired,
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
 * `source` is 'teacher': a professor wrote it (CONTRACT.md section 6 rule 5,
 * amended 19 Nov 2026; 0022 widened the check). Before that it was stored as
 * 'fallback', which the console labelled template text; those rows are left as
 * they are. model: null says no model wrote it either.
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
      source: 'teacher',
      status: 'active',
      model: null,
      sourceRef: null,
      checks,
      createdBy: actor(req),
    }]);

    res.status(201).json({ question: staffQuestion(question), failedChecks: failedChecks(checks) });
  } catch (err) {
    next(err);
  }
});

/*
 * Misconception labels (Phase 5, 0024): the misunderstanding behind each wrong
 * option of a Choose one, Choose all that apply or True or false question, and
 * how many students chose each (services/misconceptions.js). Three segments
 * deep, so neither GET /:contentId nor GET /:contentId/stats answers them.
 */

/**
 * One question's labels, and how many students chose each labelled option in
 * every room on its chapter the caller may read (a roll number counted once
 * per room: two classes may share one). Read rule, so an HOD reads it; a missing
 * question and another teacher's are the same 404, word for word.
 */
router.get('/question/:id/misconceptions', async (req, res, next) => {
  try {
    const repo = getRepo();
    const question = await repo.getQuestion(req.params.id).catch(() => null);
    if (!question) throw fail('That question was not found.', 404);
    const content = await repo.getContent(question.contentId).catch(() => null);
    await assertCanRead(req.viewer, content, 'That question');
    const rooms = await readable(req.viewer, await repo.listSessionsForContent(content._id));
    res.json({
      ...labelsBody(question, await canWrite(req.viewer, content.ownerId ?? null)),
      rooms: rooms.map((r) => ({ code: r.code, title: r.title ?? '', status: r.status, startedAt: r.startedAt ?? null })),
      report: await questionMisconceptions(repo, question, rooms),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Add, edit, confirm or clear labels: { misconceptions: [{ option, label }] },
 * where `option` is the option's index (true/false: 0 True, 1 False), a label
 * adds or replaces one, null clears it, and { option, confirm: true } confirms
 * an AI draft as it stands. Options not named keep their labels. One refused
 * change refuses the lot.
 *
 * The owner only: an HOD gets 403, anyone else the question's 404. A label
 * changes no mark, so the question keeps its status, its approval and its
 * checks: an approved question is not sent back to draft, a draft stays a
 * draft, and approving a question never confirms its labels.
 */
router.patch('/question/:id/misconceptions', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { question: existing } = await forWrite(repo, req.viewer, req.params.id);
    const { labels, changed, reason } = changeLabels(existing, req.body?.misconceptions, { by: actor(req) });
    if (reason) throw fail(reason, 400);
    const question = JSON.stringify(labels) === JSON.stringify(labelsOf(existing))
      ? existing
      : await repo.updateQuestion(existing._id, { misconceptions: labels });
    if (!question) throw fail('That question was not found.', 404);
    res.json({ ...labelsBody(question, true), changed });
  } catch (err) {
    next(err);
  }
});

export default router;
