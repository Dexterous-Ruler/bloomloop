// /api/hub - the tutor: hint ladders and feedback on wrong options (Phase 6,
// decision H13, under decisions 1 and 5).
//
// Behind the hub's own gate (hubGate in routes/hub.js): accounts only, 503
// without Supabase, never the teacher key, so a room phone holding a typed roll
// number reaches none of it. Who reaches what is the hub's one rule
// (services/hubAccess.js): a student opens hints only on a question they may be
// served (practice: an approved question of a topic on their classes; a lesson:
// one of the approved lesson's questions); the chapter's owner writes, drafts
// and approves hints and feedback; an HOD reads them and changes nothing (403);
// anyone else gets the same 404 as for something that does not exist, word for
// word.
//
// A STUDENT (403 for staff, before anything is read). A hint is opened before
// the attempt, under the attempt id the answer will carry, and recorded:
//   GET  /practice/hints        the hints opened so far { attemptId, questionId, topicId }
//   POST /practice/hints        open the next one { attemptId, questionId, topicId, mode: practice|review, step? }:
//                               201 with the hint; asking again for one already opened is 200 with the same hint
//   GET  /lessons/:lessonId/questions/:questionId/hints    as above, in a lesson { attemptId }
//   POST /lessons/:lessonId/questions/:questionId/hints    { attemptId, step? }
// Never in a self-test or Get Ready (400): those modes offer no hints (H9, H10).
// Nor on a question closed to the student now (409; services/hubClosed.js): on
// an open self-test, asked by an open Get Ready check, or being asked in a room.
//
// STAFF:
//   GET    /chapters/:contentId/hints               each question's ladder and feedback, with counts
//   GET    /questions/:questionId/hints             one question's
//   PUT    /questions/:questionId/hints/:step       owner: write or rewrite step 1, 2 or 3 { text, slides? } (approved as written)
//   DELETE /questions/:questionId/hints/:step       owner: remove it
//   PUT    /questions/:questionId/feedback/:option  owner: write or rewrite feedback on a wrong option { text, slides? }
//                                                    (option: its number in the question, from 0; True is 0, False 1)
//   DELETE /questions/:questionId/feedback/:option  owner: remove it
//   POST   /questions/:questionId/hints/approve     owner: approve its AI drafts { steps?, options? } (all, when neither is sent)
//   POST   /chapters/:contentId/hints/generate      owner: AI drafts for what the chapter's questions lack
//                                                    { questionIds?, runId? } (202, a run)
//   GET    /hints/run/:runId                        that run's progress, for its owner
//
// Drafting is on the professor's button only, in the background: the press
// answers at once with a run to poll, and nothing a student does waits on a
// model (decision 5).

import express from 'express';

import { getRepo } from '../repo/index.js';
import { isRecordId } from '../ids.js';
import { hasGemini } from '../config.js';
import { hubGate } from './hub.js';
import { READ_ONLY, assertStaff, hubChapter, hubChapterToEdit, hubTopic } from '../services/hubAccess.js';
import { cleanRunId, failRun, finishRun, getRun, startRun, updateRun } from '../services/runs.js';
import { NO_QUESTION, PRACTICE_MODES, STUDENT_ONLY, stateFrom, studentScope, topicEntries, topicModels } from '../services/hubPractice.js';
import { lessonQuestion, withLock } from '../services/hubLessons.js';
import { closedQuestions } from '../services/hubClosed.js';
import { labelHtml } from '../services/richText.js';
import {
  DRAFT_NOTE, FEEDBACK_KINDS, HINT_MODES, MAX_GENERATE_QUESTIONS, NO_HINTS_HERE, OFFLINE_NOTE, STEP_KINDS,
  answerLeak, cannotDraft, defaultSlides, feedbackOptions, feedbackPlace, serveHint, shownHints, slidesFrom, slidesRef,
  staffQuestionTutor, studentTopicState, tutorRowsOf, tutorText, wantedFor, writeTutorDrafts,
} from '../services/hubTutor.js';

const router = express.Router();
router.use(hubGate);

const fail = (message, status) => Object.assign(new Error(message), { status });
const lower = (v) => String(v ?? '').trim().toLowerCase();

export const LESSON_NOT_FOUND = 'That lesson was not found.';
const POLL = 'A poll has no right answer, so it takes no hints or feedback.';

/** 403 before any lookup for staff on a student's own route. */
function assertStudent(viewer) {
  if (viewer?.role !== 'student') throw fail(STUDENT_ONLY, 403);
}

/** Chapters whose hints are being drafted now, in this process: one run per chapter at a time. */
const drafting = new Set();

const ownerKey = (req) => String(req.viewer?.id ?? '');

/** Run `work` after the reply, and settle the run with its outcome. Never rejects. */
function inBackground(runId, work) {
  Promise.resolve().then(work).then(
    (patch) => finishRun(runId, patch ?? {}),
    (err) => {
      failRun(runId, err.message);
      if (!err.status || err.status >= 500) console.error('[hub] a background run failed:', err);
    },
  );
}

/** A step from the path: 1, 2 or 3, or the 400. */
function stepOf(raw) {
  const step = Number(raw);
  if (!Number.isInteger(step) || !STEP_KINDS[step]) throw fail('A question\'s hints are steps 1 (a nudge), 2 (a strategy) and 3 (a worked step).', 400);
  return step;
}

/** A step a student asks for: 1 to 3, or null for the next one. */
function askedStep(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  return Number(raw);
}

/* -------------------------------------------------------------- student -- */

/** The practice question a student asks hints for, through practice's own scope, with their topic state. */
async function practiceTarget(repo, viewer, { questionId, topicId }) {
  const scope = await studentScope(repo, viewer);
  const [entry] = topicEntries(scope, [topicId]);
  const qid = lower(questionId);
  // Hints are opened only on a question practice may serve now (approved, not a poll, no uploaded image).
  const question = isRecordId(qid) ? entry.questions.find((q) => lower(q._id) === qid) : null;
  if (!question) throw fail(NO_QUESTION, 404);
  const model = (await topicModels(repo, [entry])).get(lower(entry.topic._id));
  return { question, entry, scope, state: stateFrom(model, viewer.id) };
}

router.get('/practice/hints', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    const repo = getRepo();
    const { question, entry, state } = await practiceTarget(repo, req.viewer, { questionId: req.query.questionId, topicId: req.query.topicId });
    res.json(await shownHints(repo, {
      account: req.viewer, question, topicId: String(entry.topic._id), attemptId: String(req.query.attemptId ?? ''), state,
    }));
  } catch (err) {
    next(err);
  }
});

router.post('/practice/hints', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    const body = req.body ?? {};
    const mode = String(body.mode ?? 'practice');
    // Practice serves practice and review sets; a lesson's hints are opened in the lesson.
    if (!PRACTICE_MODES.includes(mode) || !HINT_MODES.includes(mode)) throw fail(NO_HINTS_HERE(mode), 400);
    const repo = getRepo();
    const { question, entry, scope, state } = await practiceTarget(repo, req.viewer, body);
    // Closed questions (services/hubClosed.js) open no hint: read here with the scope practice already has.
    const closed = await closedQuestions(repo, req.viewer, { contentIds: [String(entry.content._id)], scope });
    const out = await serveHint(repo, {
      account: req.viewer, question, topicId: String(entry.topic._id), contentId: String(entry.content._id), mode,
      attemptId: body.attemptId, step: askedStep(body.step), state, closed,
    });
    res.status(out.status).json(out.body);
  } catch (err) {
    next(err);
  }
});

/** A lesson's question a student asks hints for: the approved (or just replaced) lesson's, through the lesson's topic. */
async function lessonTarget(repo, viewer, { lessonId, questionId }) {
  const id = String(lessonId ?? '').trim();
  const lesson = isRecordId(id) ? await repo.getTopicLesson(id) : null;
  // A draft or a discarded lesson never reached a student: not there for them.
  if (!lesson || !['approved', 'superseded'].includes(lesson.status)) throw fail(LESSON_NOT_FOUND, 404);
  try {
    await hubTopic(repo, viewer, lesson.topicId);
  } catch (err) {
    if (err.status === 404) throw fail(LESSON_NOT_FOUND, 404);
    throw err;
  }
  const bank = await repo.listQuestions(lesson.contentId, { includeDiscarded: true });
  const question = lessonQuestion(lesson, questionId, bank);
  if (!question || question.status !== 'active' || (question.kind ?? 'mcq') === 'poll') throw fail(NO_QUESTION, 404);
  return { lesson, question, state: await studentTopicState(repo, viewer, lesson.topicId).catch(() => null) };
}

router.get('/lessons/:lessonId/questions/:questionId/hints', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    const repo = getRepo();
    const { lesson, question, state } = await lessonTarget(repo, req.viewer, req.params);
    res.json(await shownHints(repo, {
      account: req.viewer, question, topicId: String(lesson.topicId), attemptId: String(req.query.attemptId ?? ''), state,
    }));
  } catch (err) {
    next(err);
  }
});

router.post('/lessons/:lessonId/questions/:questionId/hints', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    const repo = getRepo();
    const { lesson, question, state } = await lessonTarget(repo, req.viewer, req.params);
    const out = await serveHint(repo, {
      account: req.viewer, question, topicId: String(lesson.topicId), contentId: String(lesson.contentId), mode: 'lesson',
      attemptId: req.body?.attemptId, step: askedStep(req.body?.step), state,
    });
    res.status(out.status).json(out.body);
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------- staff -- */

/** A question and its chapter's context for this viewer, or the question's one 404 (403 for an HOD's write). */
async function questionFor(repo, viewer, rawId, { edit = false } = {}) {
  assertStaff(viewer);
  const id = String(rawId ?? '').trim();
  const q = isRecordId(id) ? await repo.getQuestion(id).catch(() => null) : null;
  if (!q) throw fail(NO_QUESTION, 404);
  try {
    const ctx = edit ? await hubChapterToEdit(repo, viewer, q.contentId) : await hubChapter(repo, viewer, q.contentId);
    return { q, ...ctx };
  } catch (err) {
    if (err.status === 404) throw fail(NO_QUESTION, 404);
    throw err;
  }
}

/** One question's tutor as staff read it now. */
async function questionView(repo, q) {
  const rows = await tutorRowsOf(repo, [String(q._id)]);
  const views = await repo.listHintViews({ questionIds: [String(q._id)] });
  return staffQuestionTutor(q, { hints: rows.hints.get(lower(q._id)) ?? [], feedback: rows.feedback.get(lower(q._id)) ?? [], views });
}

const NOTES = Object.freeze({
  approval: 'A student sees only the hints and feedback you approve. What you write yourself is approved as you save it; '
    + 'an AI draft waits for your approval.',
  answer: 'A hint is read before the answer, so none may hold it: the right option\'s words, its letter, the value it comes to, '
    + 'or a statement that the claim is true or false. Such a hint is refused when written, and never shown.',
  order: 'A student opens hints one at a time. The first is chosen from their own recent answers: feedback on the option they '
    + 'chose last time comes first, and someone who has been finding the topic hard starts at the strategy. Each hint opened is '
    + 'recorded with their answer.',
  modes: 'Hints are offered in practice, review sets and lessons, never in a self-test or Get Ready.',
});

router.get('/chapters/:contentId/hints', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const ctx = await hubChapter(repo, req.viewer, req.params.contentId);
    const questions = (await repo.listQuestions(ctx.content._id, { includeDiscarded: true }))
      .filter((q) => q.status !== 'discarded' && (q.kind ?? 'mcq') !== 'poll');
    const ids = questions.map((q) => String(q._id));
    const rows = await tutorRowsOf(repo, ids);
    const views = await repo.listHintViews({ questionIds: ids });
    const out = await Promise.all(questions.map((q) => staffQuestionTutor(q, {
      hints: rows.hints.get(lower(q._id)) ?? [],
      feedback: rows.feedback.get(lower(q._id)) ?? [],
      views: views.filter((v) => lower(v.questionId) === lower(q._id)),
    })));
    const sum = (f) => out.reduce((n, q) => n + f(q), 0);
    res.json({
      chapter: { id: String(ctx.content._id), title: ctx.content.title ?? '', titleHtml: labelHtml(ctx.content.title ?? '') },
      canEdit: ctx.canEdit,
      questions: out,
      counts: {
        questions: out.length,
        withHints: out.filter((q) => q.counts.shownToStudents > 0).length,
        hints: { approved: sum((q) => q.counts.hints.approved), draft: sum((q) => q.counts.hints.draft) },
        feedback: { approved: sum((q) => q.counts.feedback.approved), draft: sum((q) => q.counts.feedback.draft) },
      },
      notes: { ...NOTES, model: hasGemini() ? 'Drafts are written by the AI model from this chapter\'s slides, on your button.' : OFFLINE_NOTE },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/questions/:questionId/hints', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { q, canEdit } = await questionFor(repo, req.viewer, req.params.questionId);
    res.json({ question: await questionView(repo, q), canEdit, notes: NOTES });
  } catch (err) {
    next(err);
  }
});

/** Written or rewritten by the professor: theirs, and approved as written. */
const professorWrites = (viewer, text, sourceRef) => ({
  text, provenance: 'professor', status: 'approved', model: null, sourceRef, approvedBy: viewer.id, approvedAt: new Date().toISOString(),
});

router.put('/questions/:questionId/hints/:step', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { q, content } = await questionFor(repo, req.viewer, req.params.questionId, { edit: true });
    if ((q.kind ?? 'mcq') === 'poll') throw fail(POLL, 400);
    const step = stepOf(req.params.step);
    const text = tutorText(req.body?.text, q, 'hint');
    const slides = slidesFrom(req.body?.slides);
    const { created } = await withLock(`hints:${q._id}`, async () => {
      const held = (await repo.listQuestionHints([String(q._id)])).find((h) => h.step === step);
      const sourceRef = slides !== undefined ? slidesRef(slides) : (held ? held.sourceRef ?? null : slidesRef(defaultSlides(q, content)));
      if (held) return { created: false, row: await repo.updateQuestionHint(held._id, professorWrites(req.viewer, text, sourceRef)) };
      return {
        created: true,
        row: await repo.addQuestionHint({ questionId: String(q._id), step, ...professorWrites(req.viewer, text, sourceRef), createdBy: req.viewer.id }),
      };
    });
    res.status(created ? 201 : 200).json({
      question: await questionView(repo, q),
      message: 'Saved. Students on your classes see this hint when they ask for it.',
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/questions/:questionId/hints/:step', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { q } = await questionFor(repo, req.viewer, req.params.questionId, { edit: true });
    const step = stepOf(req.params.step);
    const removed = await withLock(`hints:${q._id}`, async () => {
      const held = (await repo.listQuestionHints([String(q._id)])).find((h) => h.step === step);
      return held ? repo.deleteQuestionHint(held._id) : false;
    });
    if (!removed) throw fail('That question has no hint at this step to remove.', 404);
    res.json({ removed: true, question: await questionView(repo, q), message: 'Removed. Students no longer see this hint.' });
  } catch (err) {
    next(err);
  }
});

/** The wrong option a professor names by its number, or the 400 that says why not. */
function wrongOption(q, raw) {
  const kind = q.kind ?? 'mcq';
  if (kind === 'poll') throw fail(POLL, 400);
  if (!FEEDBACK_KINDS.includes(kind)) {
    throw fail('Feedback goes on the wrong options of a "Choose one", "Choose all that apply" or "True or false" question.', 400);
  }
  const i = Number(raw);
  const place = feedbackOptions(q).find((o) => o.optionIdx === i);
  if (!Number.isInteger(i) || !place) {
    throw fail('Name a wrong option by its number in the question, counting from 0 (for true or false, 0 is True and 1 False). '
      + 'Feedback goes on a wrong option, never on a right answer.', 400);
  }
  return place;
}

router.put('/questions/:questionId/feedback/:option', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { q, content } = await questionFor(repo, req.viewer, req.params.questionId, { edit: true });
    const place = wrongOption(q, req.params.option);
    const text = tutorText(req.body?.text, q, 'feedback');
    const slides = slidesFrom(req.body?.slides);
    const { created } = await withLock(`hints:${q._id}`, async () => {
      const held = (await repo.listOptionFeedback([String(q._id)])).find((f) => f.optionKey === place.optionKey);
      const sourceRef = slides !== undefined ? slidesRef(slides) : (held ? held.sourceRef ?? null : slidesRef(defaultSlides(q, content)));
      if (held) {
        return { created: false, row: await repo.updateOptionFeedback(held._id, { option: place.option, ...professorWrites(req.viewer, text, sourceRef) }) };
      }
      return {
        created: true,
        row: await repo.addOptionFeedback({
          questionId: String(q._id), option: place.option, optionKey: place.optionKey, ...professorWrites(req.viewer, text, sourceRef), createdBy: req.viewer.id,
        }),
      };
    });
    res.status(created ? 201 : 200).json({
      question: await questionView(repo, q),
      message: 'Saved. A student who chooses this option reads it after answering, and as the first hint when they meet the question again.',
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/questions/:questionId/feedback/:option', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { q } = await questionFor(repo, req.viewer, req.params.questionId, { edit: true });
    const place = wrongOption(q, req.params.option);
    const removed = await withLock(`hints:${q._id}`, async () => {
      const held = (await repo.listOptionFeedback([String(q._id)])).find((f) => f.optionKey === place.optionKey);
      return held ? repo.deleteOptionFeedback(held._id) : false;
    });
    if (!removed) throw fail('That option has no feedback to remove.', 404);
    res.json({ removed: true, question: await questionView(repo, q), message: 'Removed. Students no longer see this feedback.' });
  } catch (err) {
    next(err);
  }
});

router.post('/questions/:questionId/hints/approve', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { q } = await questionFor(repo, req.viewer, req.params.questionId, { edit: true });
    const body = req.body ?? {};
    const onlySteps = Array.isArray(body.steps) ? new Set(body.steps.map(Number)) : null;
    const onlyOptions = Array.isArray(body.options) ? new Set(body.options.map(Number)) : null;
    const all = !onlySteps && !onlyOptions;
    const approved = [];
    const refused = [];
    await withLock(`hints:${q._id}`, async () => {
      const rows = await tutorRowsOf(repo, [String(q._id)]);
      const now = new Date().toISOString();
      const decide = { status: 'approved', approvedBy: req.viewer.id, approvedAt: now };
      for (const h of rows.hints.get(lower(q._id)) ?? []) {
        if (h.status !== 'draft' || !(all || onlySteps?.has(h.step))) continue;
        // Checked again here, never trusted from the row: the question may have changed since the draft.
        const leak = answerLeak(q, h.text);
        if (leak) { refused.push({ step: h.step, why: `${leak.message} Rewrite it before approving.` }); continue; }
        await repo.updateQuestionHint(h._id, decide);
        approved.push({ step: h.step });
      }
      for (const f of rows.feedback.get(lower(q._id)) ?? []) {
        if (f.status !== 'draft') continue;
        const place = feedbackPlace(f, q);
        if (!(all || (place && onlyOptions?.has(place.optionIdx)))) continue;
        if (!place) { refused.push({ option: f.option, why: 'Its option was reworded, removed or made a right answer since; write it again for the option as it is.' }); continue; }
        const leak = answerLeak(q, f.text);
        if (leak) { refused.push({ option: place.option, why: `${leak.message} Rewrite it before approving.` }); continue; }
        await repo.updateOptionFeedback(f._id, decide);
        approved.push({ option: place.option, optionIdx: place.optionIdx });
      }
    });
    if (!approved.length && !refused.length) throw fail('This question has no AI drafts to approve.', 404);
    res.json({
      approved,
      refused,
      question: await questionView(repo, q),
      message: approved.length
        ? `Approved ${approved.length}. Students on your classes see ${approved.length === 1 ? 'it' : 'them'} from now on.`
        : 'Nothing was approved.',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/chapters/:contentId/hints/generate', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubChapterToEdit(repo, req.viewer, req.params.contentId);
    const body = req.body ?? {};
    const bank = await repo.listQuestions(ctx.content._id, { includeDiscarded: true });
    let chosen;
    if (body.questionIds !== undefined) {
      if (!Array.isArray(body.questionIds) || !body.questionIds.length || body.questionIds.length > MAX_GENERATE_QUESTIONS) {
        throw fail(`Choose between 1 and ${MAX_GENERATE_QUESTIONS} of this chapter's questions, or leave the list out for all of them.`, 400);
      }
      chosen = [];
      for (const raw of new Set(body.questionIds.map(lower))) {
        const q = bank.find((x) => lower(x._id) === raw);
        if (!q) throw fail(NO_QUESTION, 404);
        chosen.push(q);
      }
    } else {
      chosen = bank.filter((q) => q.status !== 'discarded');
    }
    const skipped = [];
    const candidates = [];
    for (const q of chosen) {
      const why = cannotDraft(q);
      if (why) skipped.push({ questionId: String(q._id), why });
      else candidates.push(q);
    }
    const rows = await tutorRowsOf(repo, candidates.map((q) => String(q._id)));
    const items = [];
    for (const q of candidates) {
      const want = wantedFor(q, { hints: rows.hints.get(lower(q._id)) ?? [], feedback: rows.feedback.get(lower(q._id)) ?? [] });
      if (!want.steps.length && !want.options.length) skipped.push({ questionId: String(q._id), why: 'it has every hint and feedback already' });
      else if (items.length >= MAX_GENERATE_QUESTIONS) skipped.push({ questionId: String(q._id), why: `over the ${MAX_GENERATE_QUESTIONS} one press drafts for; press again for the rest` });
      else items.push({ question: q, content: ctx.content });
    }
    if (!items.length) throw fail('Every approved question chosen here already has its hints and feedback, or cannot take any.', 409);
    const key = String(ctx.content._id);
    if (drafting.has(key)) throw fail('Hints for this chapter are being drafted now. Wait for that to finish.', 409);
    drafting.add(key);
    const runId = startRun({ id: cleanRunId(body.runId), ownerKey: ownerKey(req), total: items.length, topicsTotal: items.length });
    const viewer = req.viewer;
    inBackground(runId, async () => {
      try {
        const out = await writeTutorDrafts(repo, { items, viewer, onBatch: (done) => updateRun(runId, { topicsDone: done }) });
        // The run has one field for a sentence; a finished run with one says what was not done.
        const said = [...out.warnings];
        if (out.source === 'offline') said.push(OFFLINE_NOTE);
        else if (out.skipped.length) {
          said.push(`${out.skipped.length} piece${out.skipped.length === 1 ? ' was' : 's were'} not drafted: `
            + `${[...new Set(out.skipped.map((s) => s.why))].slice(0, 4).join('; ')}.`);
        }
        return { written: out.written, topicsDone: items.length, error: said.join(' ') };
      } finally {
        drafting.delete(key);
      }
    });
    res.status(202).json({
      runId,
      state: 'running',
      questions: items.length,
      skipped,
      note: hasGemini() ? `The hints and feedback are being drafted from this chapter's slides. ${DRAFT_NOTE}` : OFFLINE_NOTE,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/hints/run/:runId', (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const run = getRun(req.params.runId, ownerKey(req));
    // One 404 for "no such run" and "not yours".
    if (!run) throw fail('No such run.', 404);
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

export default router;
