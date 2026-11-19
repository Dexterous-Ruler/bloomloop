// /api/hub - a topic's lessons (Phase 6, decision H11, under decisions 1 and 5).
//
// Behind the hub's own gate (hubGate in routes/hub.js): accounts only, 503
// without Supabase, and a room phone holding a typed roll number never gets in.
// Who reaches what is the hub's one rule (services/hubAccess.js): a student
// reaches a topic of a chapter placed on a class they are rostered on, and reads
// only its approved lesson; the chapter's owner makes, approves and discards
// lessons; an HOD reads the department's and changes nothing (403); anyone else
// gets the same 404 as for something that does not exist, word for word.
//
//   GET    /topics/:topicId/lesson               the approved lesson as a student reads it, in their language,
//                                                with their latest answer to each question it asks
//                                                (staff: a preview, ?lang=hi|mr|en)
//   GET    /topics/:topicId/lessons              staff: every version, the one serving first
//   POST   /topics/:topicId/lessons/generate     owner: write a new version as a draft, in the background (202)
//   GET    /lessons/run/:runId                   that run's progress, for its owner
//   GET    /lessons/:lessonId                    staff: one version
//   POST   /lessons/:lessonId/approve            owner: students read it from now; the one before is retired
//   POST   /lessons/:lessonId/discard            owner: discard a draft
//   POST   /lessons/:lessonId/questions/:questionId/attempts
//                                                a student answers a retrieval question { attemptId, response, shown?, timeMs? };
//                                                a resend of a lesson answer to this question is 200 with the stored
//                                                result, an id kept for any other answer 409; a question closed to the
//                                                student now (services/hubClosed.js) 409, nothing stored
//
// A lesson is written on the professor's button only, in the background: the
// press answers at once with a run to poll, and nothing a student does waits on
// a model (decision 5).

import express from 'express';

import { getRepo } from '../repo/index.js';
import { isRecordId } from '../ids.js';
import { hasGemini } from '../config.js';
import { score } from '../questionTypes.js';
import { snapshotOf } from '../sockets/index.js';
import { hubGate } from './hub.js';
import { READ_ONLY, assertStaff, hubChapter, hubTopic } from '../services/hubAccess.js';
import { labelHtml } from '../services/richText.js';
import { cleanRunId, failRun, finishRun, getRun, startRun, updateRun } from '../services/runs.js';
import {
  NO_LESSON, NOTHING_TO_TEACH, attemptSolution, lessonQuestion, lessonSource, staffLessonView, studentLessonView, withLock, writeLessonDraft,
} from '../services/hubLessons.js';
import { ORIGINAL, attemptLanguage, isLanguage, languageChoice } from '../services/hubLanguages.js';
import { attemptStoreConnected, recordHubAttempt } from '../services/hubAttemptBridge.js';
import { hubSeed } from '../services/hubPractice.js';
import { feedbackAfter, hintsUsedOn } from '../services/hubHintHook.js';
import { closedError, closedQuestions } from '../services/hubClosed.js';

const router = express.Router();
router.use(hubGate);

const fail = (message, status) => Object.assign(new Error(message), { status });

export const LESSON_NOT_FOUND = 'That lesson was not found.';
export const QUESTION_NOT_FOUND = 'That question was not found.';
export const STUDENTS_ONLY = 'Answering a lesson\'s questions is for students. Preview the lesson to see what they see.';
export const RETIRED_TOPIC = 'This topic is no longer on its chapter\'s list, so it cannot have a new lesson.';
/** The most a response may weigh, as JSON. Far above any honest answer. */
export const MAX_RESPONSE_CHARS = 20000;

/** Topics whose lesson is being written now, in this process: one run per topic at a time. */
const writing = new Set();

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

/** A lesson this viewer may read as staff, with its chapter's context, or the one 404. */
async function staffLesson(repo, viewer, rawId) {
  assertStaff(viewer);
  const id = String(rawId ?? '').trim();
  const lesson = isRecordId(id) ? await repo.getTopicLesson(id) : null;
  if (!lesson) throw fail(LESSON_NOT_FOUND, 404);
  try {
    return { lesson, ...(await hubChapter(repo, viewer, lesson.contentId)) };
  } catch (err) {
    if (err.status === 404) throw fail(LESSON_NOT_FOUND, 404);
    throw err;
  }
}

async function lessonToEdit(repo, viewer, rawId) {
  const ctx = await staffLesson(repo, viewer, rawId);
  if (!ctx.canEdit) throw fail(READ_ONLY, 403);
  return ctx;
}

const topicHead = (topic) => ({ id: String(topic._id), name: topic.name, nameHtml: labelHtml(topic.name) });

const approvedOf = (lessons) => lessons.find((l) => l.status === 'approved') ?? null;

// ------------------------------------------------------------ reading --

router.get('/topics/:topicId/lesson', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubTopic(repo, req.viewer, req.params.topicId);
    const student = ctx.access === 'student';
    let language;
    if (student) language = await languageChoice(repo, req.viewer);
    else language = isLanguage(req.query.lang) ? String(req.query.lang) : ORIGINAL;
    const lesson = approvedOf(await repo.listTopicLessons({ topicId: ctx.topic._id }));
    res.json({
      topic: topicHead(ctx.topic),
      lesson: lesson ? await studentLessonView(repo, { lesson, account: req.viewer, language }) : null,
      ...(lesson ? {} : { empty: NO_LESSON }),
      ...(student ? {} : { preview: 'This is the lesson as a student on your classes reads it.' }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/topics/:topicId/lessons', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const ctx = await hubTopic(repo, req.viewer, req.params.topicId);
    const lessons = await repo.listTopicLessons({ topicId: ctx.topic._id });
    const bank = await repo.listQuestions(ctx.content._id, { includeDiscarded: true });
    const views = await Promise.all(lessons.map((l) => staffLessonView(repo, l, { bank })));
    const serving = views.find((v) => v.status === 'approved') ?? null;
    const source = lessonSource(ctx.content, ctx.topic);
    res.json({
      topic: { ...topicHead(ctx.topic), retired: Boolean(ctx.topic.retiredAt) },
      canEdit: ctx.canEdit,
      writing: writing.has(String(ctx.topic._id)),
      serving,
      drafts: views.filter((v) => v.status === 'draft').reverse(),
      history: views.filter((v) => v.status === 'superseded' || v.status === 'discarded').reverse(),
      basis: source.basis,
      ...(source.chunks.length ? {} : { nothingToTeach: NOTHING_TO_TEACH }),
      notes: {
        approval: 'Students read only the lesson you approve. A new version stays a draft, and the approved one keeps serving, until you approve the new one.',
        questions: 'A lesson\'s questions go into the bank as drafts. Approve them there; students see only the approved ones.',
        model: hasGemini()
          ? 'A new version is written with the AI model from this topic\'s slides.'
          : 'No AI model is set up on this server, so a new version is slides only: your slides in steps, with questions you already approved.',
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/lessons/run/:runId', (req, res, next) => {
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

router.get('/lessons/:lessonId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await staffLesson(repo, req.viewer, req.params.lessonId);
    res.json({ lesson: await staffLessonView(repo, ctx.lesson), canEdit: ctx.canEdit });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------ writing --

router.post('/topics/:topicId/lessons/generate', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const ctx = await hubTopic(repo, req.viewer, req.params.topicId);
    if (!ctx.canEdit) throw fail(READ_ONLY, 403);
    if (ctx.topic.retiredAt) throw fail(RETIRED_TOPIC, 409);
    // Refused before the run starts, so a refusal costs no quota.
    if (!lessonSource(ctx.content, ctx.topic).chunks.length) throw fail(NOTHING_TO_TEACH, 409);
    const key = String(ctx.topic._id);
    if (writing.has(key)) throw fail('A lesson for this topic is being written now. Wait for it to finish.', 409);
    writing.add(key);
    const runId = startRun({ id: cleanRunId(req.body?.runId), ownerKey: ownerKey(req), total: 1, topicsTotal: 1 });
    updateRun(runId, { topic: ctx.topic.name });
    const viewer = req.viewer;
    inBackground(runId, async () => {
      try {
        await withLock(`lesson:${key}`, () => writeLessonDraft(repo, { content: ctx.content, topic: ctx.topic, viewer }));
        // One lesson written; its questions are counted on the lesson itself.
        return { written: 1, topicsDone: 1 };
      } finally {
        writing.delete(key);
      }
    });
    res.status(202).json({
      runId,
      state: 'running',
      note: hasGemini()
        ? 'The lesson is being written from this topic\'s slides. It arrives as an AI draft for you to approve; students do not see it until then.'
        : 'No AI model is set up on this server, so this makes a slides-only lesson: your slides in steps, with questions you already '
          + 'approved. It arrives as a draft for you to approve.',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/lessons/:lessonId/approve', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { lesson } = await lessonToEdit(repo, req.viewer, req.params.lessonId);
    const before = approvedOf(await repo.listTopicLessons({ topicId: lesson.topicId }));
    const approved = await withLock(`lesson:${lesson.topicId}`, () => repo.approveTopicLesson(lesson._id, { by: req.viewer.id }));
    if (!approved) throw fail(LESSON_NOT_FOUND, 404);
    const view = await staffLessonView(repo, approved);
    res.json({
      lesson: view,
      message: `Approved. Students on your classes now read this lesson${before ? `, in place of version ${before.version}` : ''}.`
        + `${view.questions.note ? ` ${view.questions.note}` : ''}`,
      ...(before ? { replaced: { id: String(before._id), version: before.version } } : {}),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/lessons/:lessonId/discard', async (req, res, next) => {
  try {
    const repo = getRepo();
    const { lesson } = await lessonToEdit(repo, req.viewer, req.params.lessonId);
    const discarded = await withLock(`lesson:${lesson.topicId}`, () => repo.discardTopicLesson(lesson._id, { by: req.viewer.id }));
    if (!discarded) throw fail(LESSON_NOT_FOUND, 404);
    const view = await staffLessonView(repo, discarded);
    res.json({
      lesson: view,
      message: 'Discarded. Students never saw it.'
        + (view.questions.waiting ? ' Its questions are still drafts in the bank; reject them there if you do not want them.' : ''),
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------- answering --

/** A client attempt id, the idempotency key: 8 to 64 letters, digits, - or _. */
const cleanAttemptId = (value) => (/^[A-Za-z0-9_-]{8,64}$/.test(String(value ?? '')) ? String(value) : '');

router.post('/lessons/:lessonId/questions/:questionId/attempts', async (req, res, next) => {
  try {
    if (req.viewer.role !== 'student') throw fail(STUDENTS_ONLY, 403);
    const repo = getRepo();
    const id = String(req.params.lessonId ?? '').trim();
    const lesson = isRecordId(id) ? await repo.getTopicLesson(id) : null;
    // A draft or a discarded lesson never reached a student: not there for them. A
    // lesson replaced while the student had it open still takes their answer.
    if (!lesson || !['approved', 'superseded'].includes(lesson.status)) throw fail(LESSON_NOT_FOUND, 404);
    let place;
    try {
      place = await hubTopic(repo, req.viewer, lesson.topicId);
    } catch (err) {
      if (err.status === 404) throw fail(LESSON_NOT_FOUND, 404);
      throw err;
    }
    const bank = await repo.listQuestions(lesson.contentId, { includeDiscarded: true });
    const q = lessonQuestion(lesson, req.params.questionId, bank);
    if (!q) throw fail(QUESTION_NOT_FOUND, 404);

    const body = req.body ?? {};
    const attemptId = cleanAttemptId(body.attemptId);
    if (!attemptId) throw fail('Each answer needs its own attempt id from the device: 8 to 64 letters, digits, dashes or underscores.', 400);
    if (body.response === undefined) throw fail('The answer is missing.', 400);
    if (JSON.stringify(body.response).length > MAX_RESPONSE_CHARS) throw fail('That answer is too long to take.', 400);
    const timeMs = Number.isFinite(body.timeMs) && body.timeMs >= 0 ? Math.round(body.timeMs) : null;

    // A resend is answered from the stored row, before anything else is read,
    // and only when that row is this question's answer in a lesson.
    const held = attemptStoreConnected() ? await repo.getHubAttemptByKey(String(req.viewer.id), attemptId) : null;
    if (held) {
      res.status(200).json(await lessonReply(repo, req.viewer, held, { duplicate: true, questionId: q._id }));
      return;
    }
    // Its reply shows the answer: never on a question closed to this student now
    // (being asked in a room, on an open self-test, or asked by an open Get Ready
    // check). Refused before anything is stored; the device keeps it.
    const why = (await closedQuestions(repo, req.viewer, { contentIds: [String(lesson.contentId)] })).get(String(q._id).toLowerCase());
    if (why) throw closedError(why);

    // Marked here, from the stored question, with the shuffle the student was
    // shown: the hub's one seed, so practice's error log redraws it the same way.
    const seed = hubSeed(req.viewer.id, q._id);
    const graded = score(q, body.response, seed);
    const shown = await attemptLanguage(repo, {
      kind: 'question', item: q, claim: body.shown ?? null, wanted: await languageChoice(repo, req.viewer),
    });
    // HINT HOOK (H13): the hints this student opened on this question for this attempt.
    const hintsUsed = await hintsUsedOn(repo, { account: req.viewer, questionId: String(q._id), attemptId, mode: 'lesson' });
    const { attempt, duplicate } = await recordHubAttempt(repo, {
      accountId: String(req.viewer.id),
      attemptId,
      mode: 'lesson',
      lessonId: String(lesson._id),
      lessonVersion: lesson.version,
      topicId: String(lesson.topicId),
      topic: place.topic.name,
      classId: place.classIds[0] ?? null,
      contentId: String(lesson.contentId),
      questionId: String(q._id),
      kind: q.kind ?? 'mcq',
      bloom: q.bloom,
      questionSource: q.source ?? 'llm',
      questionSnapshot: snapshotOf(q),
      response: body.response,
      correct: graded.correct,
      score: graded.score,
      ungraded: Boolean(graded.ungraded),
      detail: graded.detail ?? null,
      language: shown.language,
      translationId: shown.translationId,
      hintsUsed,
      timeMs,
      answeredAt: new Date().toISOString(),
    });
    res.status(duplicate ? 200 : 201).json(await lessonReply(repo, req.viewer, attempt, { duplicate: Boolean(duplicate), questionId: q._id }));
  } catch (err) {
    next(err);
  }
});

export const ID_TAKEN = 'That attempt id was used for another answer. Send this one with a new id.';

/**
 * What a student is told about a lesson answer that is stored: right or wrong,
 * and the key, which comes only now, after the attempt. Everything is read from
 * the STORED attempt: its own question's snapshot, marked against its own
 * response, never the question a request names. A resend (`duplicate`) is
 * answered only when the stored row is this question's answer in a lesson; an
 * id kept for anything else (a self-test's answer, practice's, another
 * question's) is refused, so its mark and key are never shown here.
 */
async function lessonReply(repo, viewer, attempt, { duplicate, questionId }) {
  const sameQuestion = String(attempt.questionId ?? '').toLowerCase() === String(questionId ?? '').toLowerCase();
  if (duplicate && (attempt.mode !== 'lesson' || !sameQuestion)) throw fail(ID_TAKEN, 409);
  // The lesson's reload shows its earlier answers through the same helper, so
  // the key it shows is the one this reply showed.
  const solution = attemptSolution(attempt, viewer.id);
  return {
    attemptId: attempt.clientAttemptId ?? attempt.attemptId,
    duplicate,
    correct: attempt.correct,
    score: attempt.score,
    solution,
    // After the attempt only: the professor's feedback on the wrong option(s) chosen.
    optionFeedback: await feedbackAfter(repo, { account: viewer, attempt }),
    language: attempt.language,
    ...(duplicate ? { note: 'This answer was already saved; nothing was added.' } : {}),
  };
}

export default router;
