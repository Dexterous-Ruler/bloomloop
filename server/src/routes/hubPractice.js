// /api/hub - practice, mastery, the error log, reviews and explanations
// (Phase 6, decisions H5 to H8, H14, H17). Mounted beside the backbone's router
// (routes/hub.js) at the same prefix, behind the same guard (hubGate): accounts
// only, 503 without Supabase, never the teacher key, so a room phone holding a
// typed roll number reaches none of it.
//
// A STUDENT, their own data only (403 for staff, before anything is read):
//   GET  /practice/next              one approved question { topicIds | topicId, mode: practice|review }
//   POST /practice/attempts          mark and keep an attempt { attemptId, questionId, topicId, response, mode, timeTakenMs, shown? }:
//                                    201 with right or wrong, the right answer, the approved explanation and the
//                                    topic's state; a resend of the same attemptId is 200 with the same result
//                                    (an id kept for another question, or in another mode, is 409); a question
//                                    closed to the student now (services/hubClosed.js) is 409, nothing stored
//   GET  /progress                   every topic they can practise, its state with N and a sentence
//   GET  /review/due                 topics due for review now, and those coming up
//   GET  /errors                     their error log (?status=open|cleared, ?topicId=)
//   GET  /consistency                their weeks: days practised and rested (?weeks=1..26)
//
// STAFF, by the class's and the chapter's own rules (services/hubAccess.js):
// the owner reads and writes, the department's HOD reads (403 on a write),
// anyone else gets the same 404 as for something that does not exist; a
// student gets 403 before anything is read.
//   GET    /classes/:classId/progress                      students per topic state, in roll order
//   GET    /classes/:classId/students/:studentId/progress  one roster student's states, activity and error log
//   GET    /chapters/:contentId/explanations               each question's explanation, if any
//   PUT    /questions/:questionId/explanation              owner: write or rewrite it { text } (approved as written)
//   POST   /questions/:questionId/explanation/approve      owner: approve an AI draft
//   DELETE /questions/:questionId/explanation              owner: remove it
//   POST   /explanations/generate                          owner: AI drafts { contentId | questionIds, runId? }
//   GET    /explanations/run/:runId                        that run's progress, for its owner

import express from 'express';

import { getRepo } from '../repo/index.js';
import { isRecordId } from '../ids.js';
import { listBelow } from '../services/accounts.js';
import { hubGate } from './hub.js';
import { assertStaff, hubChapter, hubChapterToEdit, hubClass } from '../services/hubAccess.js';
import { classHead } from '../services/hubViews.js';
import {
  NO_QUESTION, PRACTICE_MODES, STUDENT_ONLY, feedbackFor, nextQuestion, recordAttempt,
} from '../services/hubPractice.js';
import { hintsUsedOn } from '../services/hubHintHook.js';
import {
  classProgress, consistencyFor, dueList, errorLogFor, studentProgress, studentProgressForStaff,
} from '../services/hubProgress.js';
import { MAX_WEEKS } from '../services/hubReview.js';
import {
  MAX_GENERATE_QUESTIONS, draftExplanations, explanationText, staffExplanationView,
} from '../services/hubExplanations.js';
import { failRun, finishRun, getRun, startRun, updateRun } from '../services/runs.js';
import { labelHtml, richText } from '../services/richText.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

router.use(hubGate);

/** 403 before any lookup for staff on a student's own route. */
function assertStudent(viewer) {
  if (viewer?.role !== 'student') throw fail(STUDENT_ONLY, 403);
}

export const ID_TAKEN = 'That attempt id was used for another answer. Send this one with a new id.';

/** Is a stored attempt an answer to the question a request names? */
const sameQuestion = (attempt, questionId) => String(attempt?.questionId ?? '').toLowerCase() === String(questionId ?? '').trim().toLowerCase();

/** Run `fn` after every earlier call with the same key has finished, in this process. */
const queues = new Map();
function withLock(key, fn) {
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

/* -------------------------------------------------------------- student -- */

router.get('/practice/next', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    res.json(await nextQuestion(getRepo(), req.viewer, {
      topicIds: req.query.topicIds ?? req.query.topicId,
      mode: String(req.query.mode ?? 'practice'),
    }));
  } catch (err) {
    next(err);
  }
});

router.post('/practice/attempts', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    const repo = getRepo();
    const body = req.body ?? {};
    const mode = body.mode ?? 'practice';
    if (!PRACTICE_MODES.includes(mode)) throw fail('Practice keeps practice and review answers; a self-test is handed in with the self-test.', 400);
    // HINT HOOK: the hints this student opened on this question (0 until the tutor's hints exist).
    const hintsUsed = await hintsUsedOn(repo, { account: req.viewer, questionId: body.questionId, attemptId: body.attemptId, mode });
    const { attempt, duplicate, entry } = await recordAttempt(repo, req.viewer, { ...body, mode }, { hintsUsed });
    // An attempt kept in a self-test is answered only with the self-test: a
    // resend of its id here must not show its answer early.
    if (duplicate && attempt.mode === 'exam') {
      throw fail('That answer belongs to a self-test; its result comes when the self-test is handed in.', 409);
    }
    // A resend is the same answer to the same question, in practice or a review
    // set. An id kept for anything else (a lesson's answer, a check's, another
    // question's) is refused, so its stored result is never shown here.
    if (duplicate && (!PRACTICE_MODES.includes(attempt.mode) || !sameQuestion(attempt, body.questionId))) {
      throw fail(ID_TAKEN, 409);
    }
    res.status(duplicate ? 200 : 201).json(await feedbackFor(repo, req.viewer, attempt, { entry, duplicate }));
  } catch (err) {
    next(err);
  }
});

router.get('/progress', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    res.json(await studentProgress(getRepo(), req.viewer));
  } catch (err) {
    next(err);
  }
});

router.get('/review/due', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    res.json(await dueList(getRepo(), req.viewer));
  } catch (err) {
    next(err);
  }
});

router.get('/errors', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    const status = req.query.status === undefined || req.query.status === 'all' ? null : String(req.query.status);
    if (status && !['open', 'cleared'].includes(status)) throw fail('Ask for open or cleared entries, or leave it out for both.', 400);
    res.json(await errorLogFor(getRepo(), req.viewer, { status, topicId: req.query.topicId ? String(req.query.topicId) : null }));
  } catch (err) {
    next(err);
  }
});

router.get('/consistency', async (req, res, next) => {
  try {
    assertStudent(req.viewer);
    const weeks = req.query.weeks === undefined ? 8 : Number(req.query.weeks);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) throw fail(`Ask for 1 to ${MAX_WEEKS} weeks.`, 400);
    res.json(await consistencyFor(getRepo(), req.viewer, { weeks }));
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------- staff -- */

const classView = (ctx) => ({ ...classHead(ctx.cls), canEdit: ctx.canEdit, access: ctx.access });

router.get('/classes/:classId/progress', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const ctx = await hubClass(repo, req.viewer, req.params.classId);
    res.json({ class: classView(ctx), ...(await classProgress(repo, ctx.cls, { listStudents: listBelow })) });
  } catch (err) {
    next(err);
  }
});

router.get('/classes/:classId/students/:studentId/progress', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const ctx = await hubClass(repo, req.viewer, req.params.classId);
    const sid = String(req.params.studentId ?? '').trim();
    const row = isRecordId(sid) ? await repo.getClassStudent(sid) : null;
    if (!row || String(row.classId).toLowerCase() !== String(ctx.cls._id).toLowerCase()) throw fail('That student was not found.', 404);
    res.json({ class: classView(ctx), ...(await studentProgressForStaff(repo, ctx.cls, row, { listStudents: listBelow })) });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------- explanations -- */

/** A question and its chapter's context for this viewer, or the question's one 404 (403 for an HOD's write). */
async function questionFor(repo, viewer, rawId, { edit = false } = {}) {
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

const POLL = 'A poll has no right answer, so it has no explanation.';

router.get('/chapters/:contentId/explanations', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const ctx = await hubChapter(repo, req.viewer, req.params.contentId);
    const questions = (await repo.listQuestions(ctx.content._id, { includeDiscarded: true }))
      .filter((q) => q.status !== 'discarded' && (q.kind ?? 'mcq') !== 'poll');
    const held = new Map((await repo.listQuestionExplanations(questions.map((q) => String(q._id))))
      .map((e) => [String(e.questionId), e]));
    const counts = { approved: 0, draft: 0, none: 0 };
    const out = [];
    for (const q of questions) {
      const e = held.get(String(q._id)) ?? null;
      counts[e ? e.status : 'none'] += 1;
      // The stem as HTML beside its text, as a student is shown it: a formula in
      // it is what the explanation explains, and as plain text it reads as TeX.
      out.push({
        questionId: String(q._id), text: q.text, textHtml: (await richText(String(q.text ?? ''))).html,
        topic: q.topic ?? '', topicHtml: labelHtml(q.topic ?? ''), bloom: q.bloom, kind: q.kind ?? 'mcq', status: q.status,
        explanation: await staffExplanationView(e),
      });
    }
    res.json({
      chapter: { id: String(ctx.content._id), title: ctx.content.title ?? '', titleHtml: labelHtml(ctx.content.title ?? '') },
      canEdit: ctx.canEdit,
      questions: out,
      counts,
      note: 'A student sees an approved explanation after answering its question, never before, and never a draft.',
    });
  } catch (err) {
    next(err);
  }
});

router.put('/questions/:questionId/explanation', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const { q } = await questionFor(repo, req.viewer, req.params.questionId, { edit: true });
    if ((q.kind ?? 'mcq') === 'poll') throw fail(POLL, 400);
    const text = explanationText(req.body?.text);
    const now = new Date().toISOString();
    const { saved, created } = await withLock(`explain:${q._id}`, async () => {
      const held = await repo.getQuestionExplanation(q._id);
      // Written or rewritten by the professor: theirs, and approved as written.
      const patch = { text, provenance: 'professor', status: 'approved', model: null, approvedBy: req.viewer.id, approvedAt: now };
      if (held) return { saved: await repo.updateQuestionExplanation(q._id, patch), created: false };
      return {
        saved: await repo.addQuestionExplanation({ questionId: String(q._id), ...patch, sourceRef: q.sourceRef ?? null, createdBy: req.viewer.id }),
        created: true,
      };
    });
    res.status(created ? 201 : 200).json({ explanation: await staffExplanationView(saved) });
  } catch (err) {
    next(err);
  }
});

router.post('/questions/:questionId/explanation/approve', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const { q } = await questionFor(repo, req.viewer, req.params.questionId, { edit: true });
    const saved = await withLock(`explain:${q._id}`, async () => {
      const held = await repo.getQuestionExplanation(q._id);
      if (!held) throw fail('That question has no explanation to approve yet.', 404);
      if (held.status === 'approved') return held;
      return repo.updateQuestionExplanation(q._id, { status: 'approved', approvedBy: req.viewer.id, approvedAt: new Date().toISOString() });
    });
    res.json({ explanation: await staffExplanationView(saved) });
  } catch (err) {
    next(err);
  }
});

router.delete('/questions/:questionId/explanation', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const { q } = await questionFor(repo, req.viewer, req.params.questionId, { edit: true });
    const removed = await withLock(`explain:${q._id}`, () => repo.deleteQuestionExplanation(q._id));
    if (!removed) throw fail('That question has no explanation to remove.', 404);
    res.json({ removed: true, message: 'The explanation was removed. Students no longer see one for this question.' });
  } catch (err) {
    next(err);
  }
});

router.post('/explanations/generate', async (req, res, next) => {
  let runId = '';
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const body = req.body ?? {};
    const skipped = [];
    const candidates = [];
    const contents = new Map();
    if (body.contentId !== undefined) {
      const ctx = await hubChapterToEdit(repo, req.viewer, body.contentId);
      contents.set(String(ctx.content._id), ctx.content);
      for (const q of await repo.listQuestions(ctx.content._id, { includeDiscarded: true })) {
        if (q.status === 'discarded') continue;
        candidates.push(q);
      }
    } else if (Array.isArray(body.questionIds) && body.questionIds.length && body.questionIds.length <= MAX_GENERATE_QUESTIONS) {
      for (const raw of new Set(body.questionIds.map((x) => String(x ?? '').trim().toLowerCase()))) {
        const { q, content } = await questionFor(repo, req.viewer, raw, { edit: true });
        contents.set(String(content._id), content);
        if (q.status === 'discarded') skipped.push({ questionId: String(q._id), why: 'it is discarded' });
        else candidates.push(q);
      }
    } else {
      throw fail(`Choose a chapter, or between 1 and ${MAX_GENERATE_QUESTIONS} of your questions, to draft explanations for.`, 400);
    }
    const held = new Set((await repo.listQuestionExplanations(candidates.map((q) => String(q._id)))).map((e) => String(e.questionId)));
    const items = [];
    for (const q of candidates) {
      if ((q.kind ?? 'mcq') === 'poll') skipped.push({ questionId: String(q._id), why: 'a poll has no right answer to explain' });
      else if (held.has(String(q._id))) skipped.push({ questionId: String(q._id), why: 'it already has an explanation' });
      else if (items.length >= MAX_GENERATE_QUESTIONS) skipped.push({ questionId: String(q._id), why: `over the ${MAX_GENERATE_QUESTIONS} one press drafts; press again for the rest` });
      else items.push({ question: q, content: contents.get(String(q.contentId)) });
    }
    runId = startRun({ id: body.runId, ownerKey: String(req.viewer.id), total: items.length, topicsTotal: items.length });
    const out = await draftExplanations({ items, onBatch: (done) => updateRun(runId, { topicsDone: done }) });
    const drafted = [];
    for (const d of out.drafts) {
      try {
        drafted.push(await repo.addQuestionExplanation({
          questionId: d.questionId, text: d.text, provenance: 'ai', status: 'draft', model: out.model, sourceRef: d.sourceRef, createdBy: req.viewer.id,
        }));
      } catch (err) {
        if (err.status !== 409) throw err;
        skipped.push({ questionId: d.questionId, why: 'an explanation was written for it meanwhile, and is kept' });
      }
    }
    finishRun(runId, { written: drafted.length });
    res.json({
      runId,
      source: out.source,
      note: out.note,
      drafted: await Promise.all(drafted.map(staffExplanationView)),
      skipped: [...skipped, ...out.skipped],
      warnings: out.warnings,
    });
  } catch (err) {
    if (runId) failRun(runId, err.message);
    next(err);
  }
});

router.get('/explanations/run/:runId', (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const run = getRun(req.params.runId, String(req.viewer.id));
    // One 404 for "no such run" and "not yours".
    if (!run) throw fail('No such run.', 404);
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

export default router;
