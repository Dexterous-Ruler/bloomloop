// /api/hub - Get Ready, refresher paths, self-tests, goals and the hub home
// (Phase 6, decisions H9, H10, H16, H17). Mounted beside the other hub routers
// at the same prefix, behind the same guard (hubGate): accounts only, 503
// without Supabase, never the teacher key, so a room phone holding a typed roll
// number reaches none of it. Nothing here is read by a room, attainment or the
// marks register.
//
// A STUDENT, their own data only (403 for staff, before anything is read):
//   GET    /home                         the hub home: mastery map by unit and topic, due reviews, goals,
//                                        refresher paths, weeks, and that the professor can see it (H17)
//   POST   /getready                     start a check { clientRunId, targetTopicId }: 201, or 200 for a resend
//   GET    /getready                     their checks, newest first (?topicId=)
//   GET    /getready/:checkId            one check: where it stands, the question to answer, the path once complete
//   POST   /getready/:checkId/answers    { attemptId, questionId, response, timeTakenMs, shown? }: 201 with the
//                                        feedback and the check after it; a resend is 200 with the same
//   POST   /getready/:checkId/end        end it early (Batch 8): undecided topics become Not sure yet and its
//                                        question is open again; the check as it ended (200, also when already ended)
//   POST   /exams                        start a self-test { clientRunId, topicIds, levels?, count?, timeLimitMinutes? }
//   GET    /exams                        their self-tests, newest first
//   GET    /exams/:examId                open: the questions, with no mark; ended: the result
//   POST   /exams/:examId/answers        { attemptId, questionId, response, timeTakenMs, shown? }: 201 "saved",
//                                        with no mark of any kind until the end
//   POST   /exams/:examId/submit         hand it in: the result
//   GET    /goals                        their goals with progress
//   POST   /goals                        { title?, examDate, topicIds }
//   PATCH  /goals/:goalId                { title?, examDate?, topicIds? }
//   DELETE /goals/:goalId
//
// STAFF, by the class's rule (services/hubAccess.js): the owner and the
// department's HOD read; anyone else gets the same 404 as for a class that does
// not exist; a student gets 403 before anything is read.
//   GET    /classes/:classId/states                          per topic, the students in each state, roll order
//   GET    /classes/:classId/students/:studentId/getready    one roster student's Get Ready results on the class's topics
//
// A check's or a self-test's id is the server's (`id` in every reply); the
// client's own `clientRunId` makes a resent start return the stored one.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { isRecordId } from '../ids.js';
import { listBelow } from '../services/accounts.js';
import { hubGate } from './hub.js';
import { assertStaff, hubClass } from '../services/hubAccess.js';
import { classHead } from '../services/hubViews.js';
import { feedbackFor } from '../services/hubPractice.js';
import { classProgress, classScope, rosterAccounts } from '../services/hubProgress.js';
import { itemKeyOf } from '../services/hubElo.js';
import { ownRun } from '../services/hubRuns.js';
import { answerCheck, checkView, checksForStaff, endCheck, listChecks, startCheck } from '../services/hubGetReady.js';
import { answerExam, examView, listExams, startExam, submitExam } from '../services/hubExam.js';
import { addGoal, changeGoal, goalsFor, hubHome, removeGoal, studentsByState } from '../services/hubGoals.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

export const FOR_STUDENTS = 'This is for a student account. Staff see their students\' progress through the class.';

router.use(hubGate);

/** 403 before any lookup for staff on a student's own route. */
function assertStudent(viewer) {
  if (viewer?.role !== 'student') throw fail(FOR_STUDENTS, 403);
}

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

/** Wrap a handler: errors go to the app's error handler. */
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

/* ----------------------------------------------------------------- home -- */

router.get('/home', handle(async (req, res) => {
  assertStudent(req.viewer);
  res.json(await hubHome(getRepo(), req.viewer));
}));

/* ------------------------------------------------------------ Get Ready -- */

router.post('/getready', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  // One start at a time per student, so a double press makes one check.
  const { run, duplicate, scope } = await withLock(`start:${req.viewer.id}`, () => startCheck(repo, req.viewer, req.body ?? {}));
  res.status(duplicate ? 200 : 201).json({ duplicate, ...(await checkView(repo, req.viewer, run, { scope })) });
}));

router.get('/getready', handle(async (req, res) => {
  assertStudent(req.viewer);
  res.json(await listChecks(getRepo(), req.viewer, { topicId: req.query.topicId ? String(req.query.topicId) : null }));
}));

router.get('/getready/:checkId', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  const run = await ownRun(repo, req.viewer, req.params.checkId, 'getready');
  res.json(await checkView(repo, req.viewer, run));
}));

router.post('/getready/:checkId/answers', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  const run = await ownRun(repo, req.viewer, req.params.checkId, 'getready');
  // One answer at a time per check: two at once could both pass "not decided yet".
  const out = await withLock(`run:${run._id}`, async () => {
    const { attempt, duplicate, entry } = await answerCheck(repo, req.viewer, run, req.body ?? {});
    const feedback = await feedbackFor(repo, req.viewer, attempt, { entry, duplicate });
    const fresh = (await repo.getHubRun(run._id)) ?? run;
    return { duplicate, body: { ...feedback, check: await checkView(repo, req.viewer, fresh) } };
  });
  res.status(out.duplicate ? 200 : 201).json(out.body);
}));

// ---- Batch 8: ending a Get Ready check early ----
router.post('/getready/:checkId/end', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  const run = await ownRun(repo, req.viewer, req.params.checkId, 'getready');
  // Under the check's own lock, so an answer arriving at the same moment is
  // either in before the end or refused after it, never half of each.
  const { run: ended, changed } = await withLock(`run:${run._id}`, () => endCheck(repo, req.viewer, run));
  res.json({ changed, ...(await checkView(repo, req.viewer, ended)) });
}));

/* ----------------------------------------------------------- self-tests -- */

router.post('/exams', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  const { run, duplicate } = await withLock(`start:${req.viewer.id}`, () => startExam(repo, req.viewer, req.body ?? {}));
  res.status(duplicate ? 200 : 201).json({ duplicate, ...(await examView(repo, req.viewer, run)) });
}));

router.get('/exams', handle(async (req, res) => {
  assertStudent(req.viewer);
  res.json(await listExams(getRepo(), req.viewer));
}));

router.get('/exams/:examId', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  const run = await ownRun(repo, req.viewer, req.params.examId, 'exam');
  res.json(await withLock(`run:${run._id}`, () => examView(repo, req.viewer, run)));
}));

router.post('/exams/:examId/answers', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  const run = await ownRun(repo, req.viewer, req.params.examId, 'exam');
  const out = await withLock(`run:${run._id}`, async () => {
    const { attempt, duplicate, late, run: after } = await answerExam(repo, req.viewer, run, req.body ?? {});
    const rows = await repo.listHubAttempts({ runIds: [String(run._id)] });
    const counted = after.endedAt ? rows.filter((a) => Date.parse(a.createdAt) <= Date.parse(after.endedAt)) : rows;
    return {
      duplicate,
      body: {
        // Saved, and nothing else: no right or wrong, no score, no answer, until the end.
        saved: true,
        duplicate,
        late,
        attempt: { id: String(attempt._id), attemptId: attempt.clientAttemptId, createdAt: attempt.createdAt },
        answered: new Set(counted.map((a) => itemKeyOf(a).toLowerCase())).size,
        total: (after.spec?.questions ?? []).length,
        status: after.endedAt ? 'ended' : 'open',
        ...(late ? { message: 'Your self-test had already ended, so this answer was kept but not counted.' } : {}),
      },
    };
  });
  res.status(out.duplicate ? 200 : 201).json(out.body);
}));

router.post('/exams/:examId/submit', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  const run = await ownRun(repo, req.viewer, req.params.examId, 'exam');
  res.json(await withLock(`run:${run._id}`, async () => examView(repo, req.viewer, await submitExam(repo, run))));
}));

/* ---------------------------------------------------------------- goals -- */

router.get('/goals', handle(async (req, res) => {
  assertStudent(req.viewer);
  res.json(await goalsFor(getRepo(), req.viewer));
}));

router.post('/goals', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  const goal = await withLock(`goals:${req.viewer.id}`, () => addGoal(repo, req.viewer, req.body ?? {}));
  const { goals } = await goalsFor(repo, req.viewer);
  res.status(201).json({ goal: goals.find((g) => g.id === String(goal._id)) ?? null });
}));

router.patch('/goals/:goalId', handle(async (req, res) => {
  assertStudent(req.viewer);
  const repo = getRepo();
  const goal = await withLock(`goals:${req.viewer.id}`, () => changeGoal(repo, req.viewer, req.params.goalId, req.body ?? {}));
  const { goals } = await goalsFor(repo, req.viewer);
  res.json({ goal: goals.find((g) => g.id === String(goal._id)) ?? null });
}));

router.delete('/goals/:goalId', handle(async (req, res) => {
  assertStudent(req.viewer);
  await withLock(`goals:${req.viewer.id}`, () => removeGoal(getRepo(), req.viewer, req.params.goalId));
  res.json({ removed: true, message: 'The goal was removed. Your practice and progress are as they were.' });
}));

/* ---------------------------------------------------------------- staff -- */

const classView = (ctx) => ({ ...classHead(ctx.cls), canEdit: ctx.canEdit, access: ctx.access });

router.get('/classes/:classId/states', handle(async (req, res) => {
  assertStaff(req.viewer);
  const repo = getRepo();
  const ctx = await hubClass(repo, req.viewer, req.params.classId);
  res.json({ class: classView(ctx), ...studentsByState(await classProgress(repo, ctx.cls, { listStudents: listBelow })) });
}));

router.get('/classes/:classId/students/:studentId/getready', handle(async (req, res) => {
  assertStaff(req.viewer);
  const repo = getRepo();
  const ctx = await hubClass(repo, req.viewer, req.params.classId);
  const sid = String(req.params.studentId ?? '').trim();
  const row = isRecordId(sid) ? await repo.getClassStudent(sid) : null;
  if (!row || String(row.classId).toLowerCase() !== String(ctx.cls._id).toLowerCase()) throw fail('That student was not found.', 404);
  const person = (await rosterAccounts(repo, ctx.cls, { listStudents: listBelow })).find((p) => String(p.roster._id) === String(row._id))
    ?? { roster: row, account: null, note: 'This student has been removed from the roster.' };
  const student = { rosterId: String(row._id), rollNo: row.rollNo, name: row.name ?? '', accountId: person.account ? String(person.account.id) : null };
  if (!person.account) {
    res.json({ class: classView(ctx), student, note: person.note, checks: [] });
    return;
  }
  const scope = await classScope(repo, ctx.cls);
  const checks = await checksForStaff(repo, person.account, { classTopicIds: new Set(scope.topics.keys()) });
  res.json({
    class: classView(ctx),
    student,
    checks,
    note: 'Get Ready checks this student made on this class\'s topics, newest first. Each prerequisite shows what the check found and the answers behind it.',
  });
}));

export default router;
