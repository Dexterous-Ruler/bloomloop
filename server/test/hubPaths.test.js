// Phase 6: Get Ready, refresher paths, self-tests, goals and the hub home
// (decisions H9, H10, H16, H17).
//
// Pinned here: the Get Ready stopping rule and each prerequisite's end state
// with its counts; a refresher path's order on a graph with a shared
// prerequisite and a long chain; a self-test's feedback held back (from its
// replies, the error log and the estimates) until it is handed in; a time-out
// handing in what was answered, an answer in the grace counted and a late one
// kept but not counted; goal progress; the hub home's shape and what it never
// says; staff's students by state in roll order. End to end, over HTTP, in
// scripts/paths.mjs. Never calls Gemini, Supabase or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { syncTopics } from '../src/services/hubTopics.js';
import { prerequisiteChain } from '../src/services/hubGraph.js';
import { errorLogFor, studentProgress } from '../src/services/hubProgress.js';
import { recordAttempt } from '../src/services/hubPractice.js';
import { EXAM_GRACE_SECONDS, countable, finalAnswers, runEnd } from '../src/services/hubHeld.js';
import {
  MAX_CHECK_QUESTIONS, answerCheck, checkState, checkView, checksForStaff, decide, listChecks, nextCheckQuestion, outcomeSentence,
  refresherPath, startCheck, stepDone,
} from '../src/services/hubGetReady.js';
import {
  MAX_EXAM_QUESTIONS, NONE_MATCH, UNANSWERED, answerExam, examView, listExams, pickExamQuestions, startExam, submitExam, summarise,
} from '../src/services/hubExam.js';
import {
  GOAL_NOT_FOUND, MAX_GOALS, addGoal, changeGoal, goalProgress, goalsFor, hubHome, removeGoal, studentsByState,
} from '../src/services/hubGoals.js';

// The model is never called here.
config.gemini.apiKey = '';

const PROF = 'a0000000-0000-4000-8000-00000000000a';
const OTHER_PROF = 'b0000000-0000-4000-8000-00000000000b';
const T0 = new Date('2026-11-19T04:30:00.000Z'); // 10:00 in India
const at = (minutes, from = T0) => new Date(from.getTime() + minutes * 60000);

const asha = { id: 'acc-asha', role: 'student', reportsTo: PROF, rollNo: '21cs01', active: true };
const bilal = { id: 'acc-bilal', role: 'student', reportsTo: PROF, rollNo: '21CS02', active: true };
const omar = { id: 'acc-omar', role: 'student', reportsTo: OTHER_PROF, rollNo: '21CS01', active: true };

const LEVELS_CYCLE = ['remember', 'understand', 'apply', 'analyse'];

// What a student may never be sent before an attempt.
const KEYS = /answerIdx|answerIdxs|answerBool|"accept"|rubric|"solution"|"explanation"|"correct"|"score"|misconception/;

/**
 * Professor PROF's class, with Asha and Bilal on it, one chapter placed with
 * five topics and four approved mcq questions on each (key 0, as shown: an mcq's
 * options are dealt in stored order). Links: Logic before Functions, Relations
 * before Functions, Sets before Relations.
 */
async function fixture() {
  const repo = createMemoryRepo();
  const cls = await repo.createClass({ courseName: 'Discrete Maths', section: 'A', ownerId: PROF });
  await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }, { rollNo: '21CS02', name: 'Bilal' }, { rollNo: '21CS03', name: 'Cara' }]);
  const names = ['Sets', 'Logic', 'Relations', 'Functions', 'Graphs'];
  const content = await repo.createContent({ title: 'Discrete structures', kind: 'syllabus', rawText: names.join('\n'), topics: names, ownerId: PROF });
  await syncTopics(repo, content);
  await repo.placeClassChapter({ classId: cls._id, contentId: content._id, unitId: null, position: 1 });
  const t = Object.fromEntries((await repo.listChapterTopics(content._id)).map((r) => [r.name, r]));
  const made = await repo.insertQuestions(names.flatMap((topic) => LEVELS_CYCLE.map((bloom, i) => ({
    contentId: content._id, topic, text: `${topic} ${bloom} ${i}?`, kind: 'mcq', options: ['right', 'wrong a', 'wrong b', 'wrong c'],
    answerIdx: 0, bloom, status: 'active', source: 'teacher',
  }))));
  const qs = Object.fromEntries(names.map((n) => [n, made.filter((q) => q.topic === n)]));
  const link = (p, topic) => repo.addTopicLink({ ownerId: PROF, prerequisiteId: String(t[p]._id), topicId: String(t[topic]._id), provenance: 'professor', state: 'confirmed' });
  await link('Logic', 'Functions');
  await link('Relations', 'Functions');
  await link('Sets', 'Relations');
  return { repo, cls, content, t, qs };
}

const id = (x) => String(x._id);

/* -------------------------------------------------------- stopping rule -- */

describe('Get Ready: the stopping rule (H9)', () => {
  test('two right is Ready, two wrong Needs review, one of each waits for a third', () => {
    assert.equal(decide([]), null);
    assert.equal(decide([true]), null);
    assert.equal(decide([false]), null);
    assert.equal(decide([true, true]), 'ready');
    assert.equal(decide([false, false]), 'needs-review');
    assert.equal(decide([true, false]), null);
    assert.equal(decide([false, true]), null);
    assert.equal(decide([true, false, true]), 'ready');
    assert.equal(decide([false, true, true]), 'ready');
    assert.equal(decide([true, false, false]), 'needs-review');
    assert.equal(decide([false, true, false]), 'needs-review');
  });

  const pool = (topic) => [`${topic}-q1`, `${topic}-q2`, `${topic}-q3`, `${topic}-q4`];
  const answer = (topic, n, correct) => ({ _id: `${topic}-a${n}`, topicId: topic, questionId: `${topic}-q${n}`, correct, createdAt: at(n).toISOString() });
  let clock = 0;
  const seq = (topic, results) => results.map((r, i) => ({ ...answer(topic, i + 1, r), createdAt: at((clock += 1)).toISOString() }));

  test('each prerequisite ends Ready, Needs review or Not sure yet, with its counts; the check stops at 12 questions', () => {
    const prereqs = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((topicId, i) => ({ topicId, name: topicId.toUpperCase(), depth: i < 3 ? 1 : 2, via: [], prior: null }));
    const available = new Map(prereqs.map((p) => [p.topicId, pool(p.topicId)]));
    clock = 0;
    const attempts = [
      ...seq('p1', [true, true]), // Ready, 2 of 2
      ...seq('p2', [false, false]), // Needs review, 0 of 2
      ...seq('p3', [true, false, true]), // Ready, 2 of 3
      ...seq('p4', [false, true, false]), // Needs review, 1 of 3
      ...seq('p5', [true, false]), // undecided when the 12th question is used
      ...seq('p6', []),
    ];
    // 2 + 2 + 3 + 3 + 2 = 12 questions.
    const s = checkState(prereqs, { attempts, available });
    assert.equal(s.asked, MAX_CHECK_QUESTIONS);
    assert.equal(s.complete, true, 'every prerequisite decided or the 12 questions used: the check stops');
    assert.deepEqual(s.items.map((i) => [i.topicId, i.outcome, i.answers, i.right, i.reason]), [
      ['p1', 'ready', 2, 2, 'decided'],
      ['p2', 'needs-review', 2, 0, 'decided'],
      ['p3', 'ready', 3, 2, 'decided'],
      ['p4', 'needs-review', 3, 1, 'decided'],
      ['p5', 'not-sure', 2, 1, 'budget'],
      ['p6', 'not-sure', 0, 0, 'not-reached'],
    ]);
    assert.equal(outcomeSentence(s.items[0]), 'Ready: you got 2 of 2 right.');
    assert.equal(outcomeSentence(s.items[3]), 'Needs review: you got 1 of 3 right.');
    assert.equal(outcomeSentence(s.items[4]), `Not sure yet: you got 1 of 2 right before the check used its ${MAX_CHECK_QUESTIONS} questions.`);
    assert.match(outcomeSentence(s.items[5]), /before it reached this topic/);
    assert.equal(outcomeSentence(s.items[3], { audience: 'staff' }), 'Needs review: they got 1 of 3 right.');
  });

  test('it stops early: a prerequisite decided in two answers is not asked a third, and the next one is asked', () => {
    const prereqs = [{ topicId: 'p1', name: 'P1', depth: 1, via: [] }, { topicId: 'p2', name: 'P2', depth: 1, via: [] }];
    const available = new Map([['p1', pool('p1')], ['p2', pool('p2')]]);
    clock = 0;
    const s = checkState(prereqs, { attempts: seq('p1', [true, true]), available });
    assert.deepEqual([s.items[0].outcome, s.items[1].status, s.current, s.complete, s.asked], ['ready', 'asking', 1, false, 2]);
    const fresh = checkState(prereqs, { attempts: [], available });
    assert.deepEqual(fresh.items.map((i) => i.status), ['asking', 'waiting'], 'nearest first: one prerequisite at a time');
  });

  test('Not sure yet when it cannot decide: too few questions, none approved, or material on none of the student\'s classes', () => {
    const prereqs = [
      { topicId: 'few', name: 'Few', depth: 1, via: [] },
      { topicId: 'none', name: 'None', depth: 1, via: [] },
      { topicId: 'far', name: 'Far', depth: 2, via: [] },
      { topicId: 'known', name: 'Known', depth: 2, via: [], prior: { state: 'mastered', answers: 7 } },
    ];
    clock = 0;
    const s = checkState(prereqs, { attempts: seq('few', [true]), available: new Map([['few', ['few-q1']], ['none', []]]) });
    assert.deepEqual(s.items.map((i) => [i.outcome, i.reason, i.answers]), [
      ['not-sure', 'too-few', 1], ['not-sure', 'no-questions', 0], ['not-sure', 'elsewhere', 0], ['ready', 'mastered', 7],
    ]);
    assert.equal(s.complete, true);
    assert.match(outcomeSentence(s.items[0]), /^Not sure yet: you got 1 of 1 right, and your professor has approved no other question/);
    assert.match(outcomeSentence(s.items[2]), /not on your classes in the hub/);
    assert.equal(outcomeSentence(s.items[3]), 'Ready: you have mastered it in practice (7 answers), so the check did not ask about it.');
  });

  test('the next question: never one asked in the check, one the student has not met first, a stable seeded order', () => {
    const qs = ['a', 'b', 'c', 'd'].map((x) => ({ _id: x }));
    const first = nextCheckQuestion(qs, { asked: new Set(['a']), met: new Set(['b', 'c']), seed: 'run-1' });
    assert.equal(first._id, 'd');
    const again = nextCheckQuestion(qs, { asked: new Set(['a', 'd']), met: new Set(['b', 'c']), seed: 'run-1' });
    assert.ok(['b', 'c'].includes(again._id));
    assert.equal(nextCheckQuestion(qs, { asked: new Set(['a', 'd']), met: new Set(['b', 'c']), seed: 'run-1' })._id, again._id, 'the same on a reload');
    assert.equal(nextCheckQuestion(qs, { asked: new Set(['a', 'b', 'c', 'd']) }), null);
  });
});

/* -------------------------------------------------------- refresher path -- */

describe('the refresher path (H9)', () => {
  // T needs A, B and C; A and B both need S (a shared prerequisite); C needs D,
  // D needs E, E needs F (a long chain).
  const L = (p, t) => ({ prerequisiteId: p, topicId: t, state: 'confirmed' });
  const links = [L('A', 'T'), L('B', 'T'), L('C', 'T'), L('S', 'A'), L('S', 'B'), L('D', 'C'), L('E', 'D'), L('F', 'E')];

  test('the chain the check covers, nearest first, a shared prerequisite once', () => {
    const chain = prerequisiteChain('T', links);
    assert.deepEqual(chain.map((c) => [c.topicId, c.depth]), [['A', 1], ['B', 1], ['C', 1], ['S', 2], ['D', 2], ['E', 3], ['F', 4]]);
    assert.deepEqual(chain.find((c) => c.topicId === 'S').via, ['A', 'B']);
  });

  test('Needs review topics in dependency order, the shared one before both that need it, the long chain from its far end, ending at the target', () => {
    const chain = prerequisiteChain('T', links);
    const outcome = { A: 'needs-review', B: 'needs-review', C: 'ready', S: 'needs-review', D: 'needs-review', E: 'needs-review', F: 'needs-review' };
    const items = chain.map((c) => ({ ...c, name: `Topic ${c.topicId}`, outcome: outcome[c.topicId], answers: 2, right: 0 }));
    const path = refresherPath({ items, target: { topicId: 'T', name: 'Topic T' }, links });
    assert.deepEqual(path.steps.map((s) => s.topicId), ['S', 'A', 'B', 'F', 'E', 'D']);
    assert.ok(!path.steps.some((s) => s.topicId === 'C'), 'a Ready prerequisite is not on the path');
    assert.equal(path.target.topicId, 'T');
    assert.equal(path.target.status, 'waiting');
    assert.equal(path.next, 'S');
    const s = path.steps[0];
    assert.equal(s.why, 'On your path because you got 0 of 2 right on it in the Get Ready check. It comes before "Topic A" and "Topic B", on the way to "Topic T".');
    assert.match(path.steps[1].why, /"Topic T" builds on it directly\.$/);
    assert.equal(s.status, 'to-do');
  });

  test('progress is practice since the check: two right in a row, or two of the last three, finishes a step', () => {
    assert.equal(stepDone([]), false);
    assert.equal(stepDone([true]), false);
    assert.equal(stepDone([true, true]), true);
    assert.equal(stepDone([false, true, false]), false);
    assert.equal(stepDone([true, false, true]), true);
    assert.equal(stepDone([false, false, true, true]), true);
    const items = [{ topicId: 'S', name: 'S', depth: 1, via: ['T'], outcome: 'needs-review', answers: 2, right: 0 }];
    const since = [
      { _id: '1', topicId: 'S', questionId: 'q1', correct: false, createdAt: at(1).toISOString() },
      { _id: '2', topicId: 'S', questionId: 'q2', correct: true, createdAt: at(2).toISOString() },
      { _id: '3', topicId: 'S', questionId: 'q2', correct: true, createdAt: at(3).toISOString() }, // a repeat: not a new answer
    ];
    const half = refresherPath({ items, target: { topicId: 'T', name: 'T' }, links: [], since });
    assert.deepEqual([half.steps[0].status, half.steps[0].answers, half.steps[0].right], ['in-progress', 2, 1]);
    const done = refresherPath({ items, target: { topicId: 'T', name: 'T' }, links: [],
      since: [...since, { _id: '4', topicId: 'S', questionId: 'q3', correct: true, createdAt: at(4).toISOString() }] });
    assert.deepEqual([done.steps[0].status, done.target.status, done.next], ['done', 'ready', 'T']);
    assert.match(done.target.sentence, /start "T" now/);
  });
});

/* ------------------------------------------------- Get Ready over a store -- */

describe('Get Ready over a store', () => {
  const right = (q) => 0;
  const wrong = (q) => 1;

  async function answerNext(repo, account, run, rightOrWrong, n) {
    const view = await checkView(repo, account, run);
    const q = view.question;
    assert.ok(q, 'the check has a question to answer');
    assert.doesNotMatch(JSON.stringify(q), KEYS, 'no key or mark before the attempt');
    return answerCheck(repo, account, run, { attemptId: `ready-${n}-xxxx`, questionId: q.question._id, response: rightOrWrong(q) }, { now: at(n) });
  }

  test('a check runs nearest first, stops early, and ends with a path; attempts are kept with their mode and check', async () => {
    const { repo, t, qs } = await fixture();
    const { run } = await startCheck(repo, asha, { clientRunId: 'check-0001', targetTopicId: id(t.Functions) }, { now: T0 });
    assert.deepEqual(run.spec.prerequisites.map((p) => [p.name, p.depth]), [['Logic', 1], ['Relations', 1], ['Sets', 2]]);
    // Logic: right, right (Ready). Relations: wrong, wrong (Needs review). Sets: right, wrong, wrong (Needs review).
    const plan = [right, right, wrong, wrong, right, wrong, wrong];
    for (const [i, how] of plan.entries()) await answerNext(repo, asha, run, how, i + 1);
    const view = await checkView(repo, asha, await repo.getHubRun(run._id));
    assert.equal(view.check.status, 'complete');
    assert.equal(view.check.asked, 7);
    assert.ok(view.check.endedAt, 'its end is written');
    assert.deepEqual(view.prerequisites.map((p) => [p.topic.name, p.outcome, p.answers, p.right]),
      [['Logic', 'ready', 2, 2], ['Relations', 'needs-review', 2, 0], ['Sets', 'needs-review', 3, 1]]);
    assert.equal(view.question, null);
    assert.deepEqual(view.path.steps.map((s) => s.topic.name), ['Sets', 'Relations'], 'Sets comes before Relations, which needs it');
    assert.equal(view.path.target.topic.name, 'Functions');
    const rows = await repo.listHubAttempts({ accountId: asha.id });
    assert.equal(rows.length, 7);
    assert.ok(rows.every((a) => a.mode === 'getready' && a.runId === id(run) && a.hintsUsed === 0));
    await assert.rejects(answerCheck(repo, asha, run, { attemptId: 'ready-9-xxxx', questionId: id(qs.Sets[3]), response: 0 }),
      (err) => err.status === 409, 'a complete check takes no more answers');
  });

  test('a resent start or answer returns what was stored; an answer to a question not on the prerequisite being checked is the question\'s 404', async () => {
    const { repo, t, qs } = await fixture();
    const first = await startCheck(repo, asha, { clientRunId: 'check-0002', targetTopicId: id(t.Functions) }, { now: T0 });
    const again = await startCheck(repo, asha, { clientRunId: 'check-0002', targetTopicId: id(t.Sets) }, { now: at(1) });
    assert.equal(again.duplicate, true);
    assert.equal(id(again.run), id(first.run));
    await assert.rejects(answerCheck(repo, asha, first.run, { attemptId: 'wrong-topic-1', questionId: id(qs.Sets[0]), response: 0 }, { now: at(2) }),
      (err) => err.status === 404 && err.message === 'That question was not found.');
    const view = await checkView(repo, asha, first.run);
    const a = await answerCheck(repo, asha, first.run, { attemptId: 'resent-0001', questionId: view.question.question._id, response: 0 }, { now: at(3) });
    const b = await answerCheck(repo, asha, first.run, { attemptId: 'resent-0001', questionId: view.question.question._id, response: 1 }, { now: at(4) });
    assert.equal(b.duplicate, true);
    assert.equal(id(b.attempt), id(a.attempt));
    assert.equal((await repo.listHubAttempts({ runIds: [id(first.run)] })).length, 1);
  });

  test('another student, or another professor\'s student, reaches neither the target nor the check', async () => {
    const { repo, t } = await fixture();
    await assert.rejects(startCheck(repo, omar, { clientRunId: 'check-omar1', targetTopicId: id(t.Functions) }), (err) => err.status === 404 && err.message === 'That topic was not found.');
    const { run } = await startCheck(repo, asha, { clientRunId: 'check-0003', targetTopicId: id(t.Functions) }, { now: T0 });
    assert.equal((await listChecks(repo, bilal)).checks.length, 0);
    const { ownRun } = await import('../src/services/hubRuns.js');
    await assert.rejects(ownRun(repo, bilal, id(run), 'getready'), (err) => err.status === 404 && err.message === 'That Get Ready check was not found.');
    await assert.rejects(ownRun(repo, asha, id(run), 'exam'), (err) => err.status === 404 && err.message === 'That self-test was not found.');
  });

  test('a prerequisite already mastered in practice is Ready without asking; a target with no prerequisites is complete at once', async () => {
    const { repo, content, t, qs } = await fixture();
    const [fifth] = await repo.insertQuestions([{ contentId: content._id, topic: 'Logic', text: 'Logic evaluate?', kind: 'mcq',
      options: ['right', 'wrong a', 'wrong b', 'wrong c'], answerIdx: 0, bloom: 'evaluate', status: 'active', source: 'teacher' }]);
    // Four right answers are not yet Mastered (it needs five)...
    for (const [i, q] of qs.Logic.entries()) {
      await recordAttempt(repo, asha, { attemptId: `logic-practice-${i}`, questionId: id(q), topicId: id(t.Logic), response: 0 }, { now: at(-60 + i) });
    }
    const four = await startCheck(repo, asha, { clientRunId: 'check-0004', targetTopicId: id(t.Functions) }, { now: at(-55) });
    assert.equal(four.run.spec.prerequisites[0].name, 'Logic');
    assert.equal(four.run.spec.prerequisites[0].prior, null, 'four answers: asked about');
    // The open check asks the fifth question now (the one not met yet), so
    // practice refuses it and stores nothing: its feedback would show the answer.
    await assert.rejects(
      recordAttempt(repo, asha, { attemptId: 'logic-practice-5', questionId: id(fifth), topicId: id(t.Logic), response: 0 }, { now: at(-54) }),
      (err) => err.status === 409 && /Get Ready check is asking now/.test(err.message),
    );
    assert.equal((await repo.listHubAttempts({ accountId: asha.id })).length, 4, 'nothing stored');
    // ...and the fifth, right, answered in the check, is (about 9 in 10 on its typical question, worked by hubElo's rule).
    await answerCheck(repo, asha, four.run, { attemptId: 'logic-check-5', questionId: id(fifth), response: 0 }, { now: at(-54) });
    const state = (await studentProgress(repo, asha, { now: at(-50) })).topics.find((x) => x.id === id(t.Logic)).state;
    assert.deepEqual([state.state, state.answers], ['mastered', 5]);
    const five = await startCheck(repo, asha, { clientRunId: 'check-0005b', targetTopicId: id(t.Functions) }, { now: at(-50) });
    assert.deepEqual(five.run.spec.prerequisites[0].prior, { state: 'mastered', answers: 5 });
    const view = await checkView(repo, asha, five.run);
    assert.equal(view.prerequisites[0].sentence, 'Ready: you have mastered it in practice (5 answers), so the check did not ask about it.');
    assert.equal(view.question.topic.name, 'Relations', 'the check starts on the next prerequisite');
    const none = await startCheck(repo, asha, { clientRunId: 'check-0005', targetTopicId: id(t.Graphs) }, { now: T0 });
    assert.equal(none.run.endReason, 'complete');
    const empty = await checkView(repo, asha, none.run);
    assert.equal(empty.prerequisites.length, 0);
    assert.match(empty.sentence, /no prerequisites the professor has confirmed/);
    assert.deepEqual(empty.path.steps, []);
    assert.equal(empty.path.target.status, 'ready');
  });

  test('staff read a student\'s checks on the class\'s topics, with the counts and in their own words', async () => {
    const { repo, t } = await fixture();
    const { run } = await startCheck(repo, asha, { clientRunId: 'check-0006', targetTopicId: id(t.Functions) }, { now: T0 });
    await answerNext(repo, asha, run, right, 1);
    const checks = await checksForStaff(repo, asha, { classTopicIds: new Set([id(t.Functions).toLowerCase()]) });
    assert.equal(checks.length, 1);
    assert.equal(checks[0].status, 'open');
    assert.equal(checks[0].prerequisites[0].sentence, 'Being checked now: they got 1 of 1 right so far.');
    assert.equal((await checksForStaff(repo, asha, { classTopicIds: new Set() })).length, 0, 'a check on another class\'s topic is not this class\'s');
  });
});

/* ------------------------------------------------------- held-back marks -- */

describe('a self-test\'s answers are held back until it ends (H10)', () => {
  const run = (over = {}) => ({ _id: 'run1', kind: 'exam', startedAt: T0.toISOString(), deadlineAt: null, endedAt: null, ...over });
  const a = (n, over = {}) => ({ _id: `a${n}`, mode: 'exam', runId: 'run1', questionId: `q${n}`, correct: true, createdAt: at(n).toISOString(), ...over });

  test('open: held back; ended: the last answer per question before the end; late ones never; others always', () => {
    const rows = [a(1), a(2, { correct: false }), a(3, { questionId: 'q2', correct: true }), a(20, { questionId: 'q4' }),
      { _id: 'p1', mode: 'practice', questionId: 'q9', correct: true, createdAt: at(1).toISOString() },
      { _id: 'x1', mode: 'exam', runId: null, questionId: 'q8', correct: true, createdAt: at(1).toISOString() }];
    assert.deepEqual(countable(rows, [run()], at(30)).map((x) => x._id), ['p1', 'x1'], 'an open self-test: none of its answers');
    const ended = run({ endedAt: at(10).toISOString(), endReason: 'submitted' });
    assert.deepEqual(countable(rows, [ended], at(30)).map((x) => x._id), ['a1', 'a3', 'p1', 'x1'],
      'the changed answer to q2 counts as its last; the one after the end does not');
    assert.deepEqual([...finalAnswers(ended, rows, at(30)).keys()], ['q1', 'q2']);
  });

  test('a time limit ends it at the deadline plus the grace, on the server\'s clock', () => {
    const timed = run({ deadlineAt: at(10).toISOString() });
    assert.equal(runEnd(timed, at(10)), null, 'at the deadline itself answers may still be on their way');
    assert.equal(runEnd(timed, at(11)), new Date(at(10).getTime() + EXAM_GRACE_SECONDS * 1000).toISOString());
    assert.equal(runEnd(run({ endedAt: at(5).toISOString() }), at(1)), at(5).toISOString());
  });
});

/* ------------------------------------------------------------ self-tests -- */

describe('self-tests (H10)', () => {
  test('pickExamQuestions: at most the count, one from each topic in turn, questions not met first, the same for the same seed', () => {
    const pool = (name, n) => ({ entry: { name }, questions: Array.from({ length: n }, (_, i) => ({ _id: `${name}${i}` })) });
    const picked = pickExamQuestions([pool('a', 5), pool('b', 2)], { count: 6, seed: 's1', met: new Set(['a0']) });
    assert.equal(picked.length, 6);
    assert.equal(picked.filter((p) => p.entry.name === 'b').length, 2, 'both of the small topic\'s');
    assert.ok(!picked.some((p) => p.q._id === 'a0'), 'the one already met waits for the last place, and there is none');
    assert.deepEqual(pickExamQuestions([pool('a', 5), pool('b', 2)], { count: 6, seed: 's1', met: new Set(['a0']) }).map((p) => p.q._id),
      picked.map((p) => p.q._id));
    assert.equal(pickExamQuestions([pool('a', 50)], { count: MAX_EXAM_QUESTIONS, seed: 's' }).length, MAX_EXAM_QUESTIONS);
  });

  test('the summary by topic and by level, with the counts behind each', () => {
    const items = [
      { topicId: 't1', topicName: 'Sets', bloom: 'remember', answered: true, correct: true, mark: 'auto' },
      { topicId: 't1', topicName: 'Sets', bloom: 'apply', answered: true, correct: false, mark: 'auto' },
      { topicId: 't2', topicName: 'Logic', bloom: 'remember', answered: false, correct: null, mark: 'unmarked' },
      { topicId: 't2', topicName: 'Logic', bloom: 'create', answered: true, correct: true, mark: 'provisional' },
    ];
    const s = summarise(items, [{ id: 't1', name: 'Sets' }, { id: 't2', name: 'Logic' }]);
    assert.deepEqual([s.overall.questions, s.overall.answered, s.overall.right, s.overall.provisional, s.overall.unmarked], [4, 3, 2, 1, 1]);
    assert.equal(s.overall.sentence, '2 of 4 questions right; 1 not answered; 1 written answer with a provisional machine mark.');
    assert.deepEqual(s.byTopic.map((x) => [x.topic.name, x.right, x.questions]), [['Sets', 1, 2], ['Logic', 1, 2]]);
    assert.deepEqual(s.byLevel.map((x) => [x.level, x.right, x.questions]), [['remember', 1, 2], ['apply', 0, 1], ['create', 1, 1]]);
  });

  test('no feedback before it is handed in: not in its replies, its view, the error log or the estimates; then all of it', async () => {
    const { repo, t, qs } = await fixture();
    await repo.addQuestionExplanation({ questionId: id(qs.Sets[0]), text: 'Because the slide says so.', provenance: 'professor', status: 'approved', approvedAt: T0.toISOString() });
    const { run } = await startExam(repo, asha, { clientRunId: 'exam-00001', topicIds: [id(t.Sets)], levels: ['remember', 'understand', 'apply'], count: 3 }, { now: T0 });
    assert.equal(run.spec.questions.length, 3);
    assert.ok(run.spec.questions.every((x) => qs.Sets.slice(0, 3).some((q) => id(q) === x.questionId)), 'only the levels chosen');
    const open = await examView(repo, asha, run, { now: at(1) });
    assert.equal(open.exam.status, 'open');
    assert.doesNotMatch(JSON.stringify(open), KEYS, 'no key, mark or explanation in the open self-test');
    assert.equal(open.hints.available, 0);

    const target = id(qs.Sets[0]);
    const listed = run.spec.questions.map((x) => x.questionId);
    assert.ok(listed.includes(target));
    const saved = await answerExam(repo, asha, run, { attemptId: 'exam-a-0001', questionId: target, response: 2 }, { now: at(2) });
    assert.equal(saved.late, false);
    assert.equal(saved.attempt.mode, 'exam');
    assert.equal(saved.attempt.runId, id(run));
    const during = await examView(repo, asha, run, { now: at(3) });
    assert.doesNotMatch(JSON.stringify(during), KEYS, 'still no mark once answered');
    assert.equal(during.questions.find((x) => x.questionId === target).response, 2, 'their own answer, back for a reload');
    assert.equal((await errorLogFor(repo, asha)).entries.length, 0, 'the wrong answer is not in the error log yet');
    const before = (await studentProgress(repo, asha, { now: at(3) })).topics.find((x) => x.id === id(t.Sets)).state;
    assert.deepEqual([before.state, before.answers], ['not-started', 0], 'nor in the estimate');
    await assert.rejects(answerExam(repo, asha, run, { attemptId: 'exam-a-0002', questionId: id(qs.Logic[0]), response: 0 }, { now: at(3) }),
      (err) => err.status === 404, 'a question not on the list');

    // A second answer to the same question (changed to the right one), and a wrong one to another.
    await answerExam(repo, asha, run, { attemptId: 'exam-a-0003', questionId: target, response: 0 }, { now: at(4) });
    const other = listed.find((x) => x !== target);
    await answerExam(repo, asha, run, { attemptId: 'exam-a-0004', questionId: other, response: 3 }, { now: at(5) });

    const handed = await submitExam(repo, run, { now: at(6) });
    assert.equal(handed.endReason, 'submitted');
    const result = await examView(repo, asha, handed, { now: at(7) });
    const mine = result.questions.find((x) => x.questionId === target);
    assert.deepEqual([mine.answered, mine.correct, mine.response, mine.solution, mine.mark], [true, true, 0, 0, 'auto'], 'the last answer counts');
    assert.equal(mine.explanation.text, 'Because the slide says so.');
    const blank = result.questions.find((x) => !x.answered);
    assert.deepEqual([blank.mark, blank.solution, blank.explanation, blank.markLabel], ['unmarked', null, null, UNANSWERED],
      'a question left blank keeps its key');
    assert.deepEqual([result.summary.overall.questions, result.summary.overall.answered, result.summary.overall.right], [3, 2, 1]);
    assert.equal(result.summary.byTopic[0].topic.name, 'Sets');
    const log = await errorLogFor(repo, asha);
    assert.deepEqual(log.entries.map((e) => e.question.text), [qs.Sets.find((q) => id(q) === other).text],
      'once handed in: only the final wrong answer is in the error log, not the one changed');
    const after = (await studentProgress(repo, asha, { now: at(7) })).topics.find((x) => x.id === id(t.Sets)).state;
    assert.equal(after.answers, 2, 'and the two final answers count in the estimate');
    assert.equal((await repo.listHubAttempts({ runIds: [id(run)] })).length, 3, 'every answer is kept, the changed one too');
    const again = await submitExam(repo, handed, { now: at(9) });
    assert.equal(again.endedAt, handed.endedAt, 'handing in twice changes nothing');
  });

  test('a time-out hands in what was answered: one in the grace counts, a late one is kept and not counted', async () => {
    const { repo, t } = await fixture();
    const start = new Date('2020-02-03T05:00:00.000Z');
    const { run } = await startExam(repo, asha, { clientRunId: 'exam-timed1', topicIds: [id(t.Logic)], count: 3, timeLimitMinutes: 10 }, { now: start });
    assert.equal(run.deadlineAt, at(10, start).toISOString());
    const [q1, q2, q3] = run.spec.questions.map((x) => x.questionId);
    await answerExam(repo, asha, run, { attemptId: 'timed-0001', questionId: q1, response: 0 }, { now: at(5, start) });
    const inGrace = await answerExam(repo, asha, run, { attemptId: 'timed-0002', questionId: q2, response: 1 }, { now: new Date(at(10, start).getTime() + 20000) });
    assert.equal(inGrace.late, false);
    const late = await answerExam(repo, asha, run, { attemptId: 'timed-0003', questionId: q3, response: 0 }, { now: at(11, start) });
    assert.equal(late.late, true, 'after the grace: kept, marked late');
    assert.equal(late.run.endReason, 'timed-out');
    const ended = await repo.getHubRun(run._id);
    assert.equal(ended.endedAt, new Date(at(10, start).getTime() + EXAM_GRACE_SECONDS * 1000).toISOString());
    const result = await examView(repo, asha, ended, { now: at(12, start) });
    assert.equal(result.exam.endReason, 'timed-out');
    assert.match(result.ended, /time ran out/);
    assert.deepEqual(result.questions.map((x) => x.answered), [true, true, false]);
    assert.match(result.lateNote, /1 answer reached the server after the end/);
    assert.equal((await repo.listHubAttempts({ runIds: [id(run)] })).length, 3, 'the late answer is kept');
    const listed = (await listExams(repo, asha, { now: at(13, start) })).exams[0];
    assert.deepEqual([listed.status, listed.answered, listed.right], ['ended', 2, 1]);
  });

  test('a self-test is read only from the view of the student who took it; no match, bad counts and limits are refused', async () => {
    const { repo, t } = await fixture();
    await assert.rejects(startExam(repo, asha, { clientRunId: 'exam-none1', topicIds: [id(t.Sets)], levels: ['create'] }), (err) => err.status === 400 && err.message === NONE_MATCH);
    await assert.rejects(startExam(repo, asha, { clientRunId: 'exam-big01', topicIds: [id(t.Sets)], count: 31 }), (err) => err.status === 400);
    await assert.rejects(startExam(repo, asha, { clientRunId: 'exam-time1', topicIds: [id(t.Sets)], timeLimitMinutes: 0 }), (err) => err.status === 400);
    await assert.rejects(startExam(repo, asha, { clientRunId: 'exam-lvl01', topicIds: [id(t.Sets)], levels: ['analyze'] }), (err) => err.status === 400);
    await assert.rejects(startExam(repo, omar, { clientRunId: 'exam-omar1', topicIds: [id(t.Sets)] }), (err) => err.status === 404);
    const { run } = await startExam(repo, asha, { clientRunId: 'exam-mine1', topicIds: [id(t.Sets), id(t.Logic)], count: 30 }, { now: T0 });
    assert.equal(run.spec.questions.length, 8, 'all eight there are, when 30 are asked');
    assert.match((await examView(repo, asha, run, { now: at(1) })).exam.shortNote, /only 8 questions matched/);
    await assert.rejects(answerExam(repo, bilal, run, { attemptId: 'bilal-exam-1', questionId: run.spec.questions[0].questionId, response: 0 }),
      (err) => err.status === 404 && err.message === 'That self-test was not found.', 'never filed under another student\'s self-test');
    assert.equal((await repo.listHubAttempts({ accountId: bilal.id })).length, 0);
  });
});

/* ------------------------------------------------------- goals and home -- */

describe('goals and the hub home (H16, H17)', () => {
  test('goal progress: states over its topics with N, the days left, what to do first; a topic no longer reachable is said', () => {
    const entry = (n) => ({ topic: { _id: `t${n}`, name: `T${n}` }, content: { _id: 'c1', title: 'Ch' } });
    const st = (state, answers) => ({ state, label: state, answers, provisional: answers < 3, outOf10: null, sentence: 's', review: { due: state === 'needs-review', dueAt: null, when: '' } });
    const states = new Map([
      ['t1', { entry: entry(1), state: st('mastered', 6) }],
      ['t2', { entry: entry(2), state: st('needs-review', 5) }],
      ['t3', { entry: entry(3), state: st('not-started', 0) }],
    ]);
    const g = goalProgress({ _id: 'g1', title: 'Mid-semester', examDate: '2026-12-01', topicIds: ['t1', 't2', 't3', 'gone'] }, states, '2026-11-19');
    assert.equal(g.daysLeft, 12);
    assert.equal(g.sentence, '1 of 3 topics mastered, 1 due for review, 1 not started. 12 days to go.');
    assert.deepEqual(g.focus.map((f) => f.id), ['t2', 't3']);
    assert.equal(g.topics[3].unavailable, true);
    assert.equal(g.topics[0].state.answers, 6, 'each topic carries its N');
    assert.equal(goalProgress({ _id: 'g2', examDate: '2026-11-18', topicIds: ['t1'] }, states, '2026-11-19').sentence, '1 of 1 topic mastered. The exam date has passed.');
  });

  test('set, change and remove a goal: today or later, the student\'s own topics, at most ten, only their own', async () => {
    const { repo, t } = await fixture();
    await assert.rejects(addGoal(repo, asha, { examDate: '2026-11-18', topicIds: [id(t.Sets)] }, { now: T0 }), (err) => err.status === 400 && /past/.test(err.message));
    await assert.rejects(addGoal(repo, asha, { examDate: '2026-02-30', topicIds: [id(t.Sets)] }, { now: T0 }), (err) => err.status === 400);
    await assert.rejects(addGoal(repo, omar, { examDate: '2026-12-01', topicIds: [id(t.Sets)] }, { now: T0 }), (err) => err.status === 404 && err.message === 'That topic was not found.');
    const goal = await addGoal(repo, asha, { title: '  End   semester ', examDate: '2026-11-19', topicIds: [id(t.Sets), id(t.Logic), id(t.Sets)] }, { now: T0 });
    assert.deepEqual([goal.title, goal.examDate, goal.topicIds.length], ['End semester', '2026-11-19', 2]);
    const changed = await changeGoal(repo, asha, id(goal), { title: 'Finals', topicIds: [id(t.Logic)] }, { now: T0 });
    assert.deepEqual([changed.title, changed.topicIds], ['Finals', [id(t.Logic)]]);
    await assert.rejects(changeGoal(repo, bilal, id(goal), { title: 'mine' }, { now: T0 }), (err) => err.status === 404 && err.message === GOAL_NOT_FOUND);
    for (let i = 1; i < MAX_GOALS; i += 1) await addGoal(repo, asha, { examDate: '2026-12-01', topicIds: [id(t.Sets)] }, { now: T0 });
    await assert.rejects(addGoal(repo, asha, { examDate: '2026-12-01', topicIds: [id(t.Sets)] }, { now: T0 }), (err) => err.status === 409);
    await assert.rejects(removeGoal(repo, bilal, id(goal)), (err) => err.status === 404);
    assert.equal(await removeGoal(repo, asha, id(goal)), true);
    assert.equal((await goalsFor(repo, asha, { now: T0 })).goals.length, MAX_GOALS - 1);
  });

  test('the hub home: the mastery map by unit and topic, reviews, goals, paths, weeks, the notice; never a rank, average, streak or band', async () => {
    const { repo, cls, content, t } = await fixture();
    const unit = await repo.createClassUnit({ classId: cls._id, name: 'Unit 1', position: 1 });
    await repo.updateClassChapter(String((await repo.listClassChapters(cls._id))[0]._id), { unitId: String(unit._id) });
    await recordAttempt(repo, asha, { attemptId: 'home-0001', questionId: id((await repo.listQuestions(content._id))[0]), topicId: id(t.Sets), response: 0 }, { now: T0 });
    await addGoal(repo, asha, { examDate: '2026-12-10', topicIds: [id(t.Sets), id(t.Logic)] }, { now: T0 });
    const home = await hubHome(repo, asha, { now: at(1) });
    assert.match(home.notice, /professor can see your progress/);
    assert.equal(home.classes.length, 1);
    assert.equal(home.classes[0].units[0].name, 'Unit 1');
    const topics = home.classes[0].units[0].chapters[0].topics;
    assert.deepEqual(topics.map((x) => x.name), ['Sets', 'Logic', 'Relations', 'Functions', 'Graphs']);
    assert.deepEqual([topics[0].state.state, topics[0].state.answers], ['not-sure', 1]);
    assert.equal(home.goals.goals.length, 1);
    assert.match(home.goals.goals[0].sentence, /0 of 2 topics mastered/);
    assert.equal(home.weeks.weeks.length, 4);
    assert.deepEqual(home.paths.paths, []);
    assert.doesNotMatch(JSON.stringify(home), /rank|average|streak|leaderboard|coin|slow learner|Needs support|Excelling|Developing/i);
    const nobody = await hubHome(repo, omar, { now: at(1) });
    assert.equal(nobody.classes.length, 0);
    assert.match(nobody.empty, /None of your classes/);
  });

  test('staff: per topic, the students in each state in roll order, with N; a roll number with no account apart', () => {
    const progress = {
      topics: [{ id: 't1', name: 'Sets' }],
      students: [
        { rosterId: 'r1', rollNo: '21CS01', name: 'Asha', accountId: 'a', topics: { t1: { state: 'in-progress', answers: 4, provisional: false } } },
        { rosterId: 'r2', rollNo: '21CS02', name: 'Bilal', accountId: 'b', topics: { t1: { state: 'not-started', answers: 0, provisional: true } } },
        { rosterId: 'r3', rollNo: '21CS03', name: 'Cara', accountId: null, note: 'No student account carries this roll number yet.', topics: {} },
        { rosterId: 'r4', rollNo: '21CS10', name: 'Dev', accountId: 'd', topics: { t1: { state: 'in-progress', answers: 3, provisional: false } } },
      ],
      notes: { order: 'roll order' },
    };
    const v = studentsByState(progress);
    assert.deepEqual(v.topics[0].students['in-progress'].map((s) => [s.rollNo, s.answers]), [['21CS01', 4], ['21CS10', 3]], 'roll order, not by score');
    assert.deepEqual(v.topics[0].students['not-started'].map((s) => s.rollNo), ['21CS02']);
    assert.deepEqual(v.noAccount.map((s) => s.rollNo), ['21CS03']);
  });
});
