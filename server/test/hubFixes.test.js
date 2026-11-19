// Phase 6: the fixes from the hub's review.
//
// Pinned here, each against the rule it restores:
//   - a question being asked in a room (a phone's served question, or the
//     running class question), one on an open self-test, and the one an open
//     Get Ready check is asking are CLOSED to practice, a review set, the tutor
//     and Get Ready: not served, no answer kept (409), no hint; a self-test's
//     result and the error log keep the answer of a room's question back;
//   - the error log's "From class" entries show what was right only where
//     practice could show it too, never for a question a room may ask again
//     and practice cannot serve;
//   - hints used count every hint opened on the question since the last
//     answer, under any attempt id;
//   - a student off the roster no longer reads an open self-test's questions;
//   - a lesson never takes an answer to a question that was never approved;
//   - a complete Get Ready check stays complete, whatever is approved later;
//   - a refresher step on a topic with few questions can still be finished;
//   - a topic's state never promises an estimate its bank cannot give;
//   - a translation that drops or adds a ____ gap cannot be approved or shown;
//   - a formula sets no element id and makes no link.
// Never calls Gemini, Supabase or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { snapshotOf } from '../src/sockets/index.js';
import { syncTopics } from '../src/services/hubTopics.js';
import {
  ALL_CLOSED, nextQuestion, recordAttempt, stateFrom, studentScope, topicModels,
} from '../src/services/hubPractice.js';
import { CLOSED_SENTENCE, ROOM_HELD_NOTE, closedQuestions } from '../src/services/hubClosed.js';
import { serveHint } from '../src/services/hubTutor.js';
import { hintsOffered, hintsUsedOn } from '../src/services/hubHintHook.js';
import { examView, startExam, submitExam, answerExam, OUT_OF_REACH } from '../src/services/hubExam.js';
import {
  COMPLETE, activePaths, answerCheck, checkView, listChecks, refresherPath, startCheck, stepAnswers,
} from '../src/services/hubGetReady.js';
import { CLASS_KEY_NOTE, errorLogFor } from '../src/services/hubProgress.js';
import { lessonQuestion } from '../src/services/hubLessons.js';
import { topicState } from '../src/services/hubElo.js';
import {
  buildTranslationPrompt, checkTranslation, fieldsOf, servableTranslations, sourceHash,
} from '../src/services/hubLanguages.js';
import { richText } from '../src/services/richText.js';

// Nothing here may reach a model.
config.gemini.apiKey = '';

const PROF = 'a0000000-0000-4000-8000-00000000000a';
const asha = { id: 'acc-asha', role: 'student', reportsTo: PROF, rollNo: '21cs01', active: true };
const OPTIONS = ['right', 'wrong a', 'wrong b', 'wrong c'];
const id = (x) => String(x._id);
const lower = (x) => String(x).toLowerCase();
const pause = () => new Promise((r) => setTimeout(r, 5));

/**
 * PROF's class with Asha on it, one chapter placed with three topics: Sets
 * (three approved mcq questions, key 0, each with an approved three-step hint
 * ladder), Pairs (two approved questions) and Relations (one). Pairs is a
 * confirmed prerequisite of Relations, and Sets of Pairs.
 */
async function fixture() {
  const repo = createMemoryRepo();
  const cls = await repo.createClass({ courseName: 'Discrete', section: 'A', ownerId: PROF });
  const [ashaRow] = await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }]);
  const names = ['Sets', 'Pairs', 'Relations'];
  const content = await repo.createContent({ title: 'Discrete structures', kind: 'syllabus', rawText: names.join('\n'), topics: names, ownerId: PROF });
  await syncTopics(repo, content);
  await repo.placeClassChapter({ classId: cls._id, contentId: content._id, unitId: null, position: 1 });
  const t = Object.fromEntries((await repo.listChapterTopics(content._id)).map((r) => [r.name, r]));
  const made = await repo.insertQuestions([
    { topic: 'Sets', bloom: 'remember' }, { topic: 'Sets', bloom: 'understand' }, { topic: 'Sets', bloom: 'apply' },
    { topic: 'Pairs', bloom: 'remember' }, { topic: 'Pairs', bloom: 'understand' },
    { topic: 'Relations', bloom: 'remember' },
  ].map((x, i) => ({ ...x, text: `${x.topic} ${x.bloom} ${i}?`, kind: 'mcq', options: OPTIONS, answerIdx: 0, contentId: content._id, status: 'active', source: 'teacher' })));
  const sets = made.slice(0, 3);
  for (const q of sets) {
    for (const [i, text] of ['Look at slide 1 again.', 'Check each choice in turn.', 'Rule out the ones that repeat.'].entries()) {
      await repo.addQuestionHint({
        questionId: id(q), step: i + 1, text, provenance: 'professor', status: 'approved', sourceRef: { kind: 'slides', slides: [1] },
        approvedAt: new Date().toISOString(), approvedBy: PROF,
      });
    }
  }
  const link = (p, topic) => repo.addTopicLink({ ownerId: PROF, prerequisiteId: id(t[p]), topicId: id(t[topic]), provenance: 'professor', state: 'confirmed' });
  await link('Sets', 'Pairs');
  await link('Pairs', 'Relations');
  const room = () => repo.createSession({ contentId: content._id, code: `R${Math.floor(Math.random() * 1e6)}`, title: 'Room', ownerId: PROF });
  return { repo, cls, ashaRow, content, t, sets, pairs: made.slice(3, 5), rel: made[5], room };
}

/** A phone in `session` that has been served `q` and not finished it. */
const servedTo = (repo, session, q, rollNo = '21CS09') => repo.saveProfile({
  sessionId: id(session), rollNo, name: '', served: { questionId: id(q), at: new Date().toISOString(), reason: '' },
});

/* ------------------------------------------------------- closed questions -- */

describe('closed questions: a room\'s, an open self-test\'s, an open check\'s (review finding: keys and hints on demand)', () => {
  test('practice serves none of them, and says so when nothing else is left; a room closing opens its questions again', async () => {
    const { repo, content, t, sets, room } = await fixture();
    const { run } = await startExam(repo, asha, { clientRunId: 'fix-exam-0001', topicIds: [id(t.Sets)], count: 1 });
    const onTest = sets.find((q) => id(q) === run.spec.questions[0].questionId);
    const [served, voted] = sets.filter((q) => q !== onTest);
    const open = await room();
    await servedTo(repo, open, served);
    await repo.addClassQuestion({ sessionId: id(open), seq: 1, questionId: id(voted), state: 'open' });

    const closed = await closedQuestions(repo, asha, { contentIds: [id(content)] });
    assert.deepEqual(Object.fromEntries([...closed].sort()), Object.fromEntries([
      [lower(id(served)), 'room'], [lower(id(voted)), 'room'], [lower(id(onTest)), 'self-test'],
    ].sort()));
    const none = await nextQuestion(repo, asha, { topicIds: id(t.Sets) });
    assert.equal(none.question, null);
    assert.equal(none.message, ALL_CLOSED);

    await repo.updateSession(id(open), { status: 'closed' });
    const seen = new Set();
    for (let i = 0; i < 4; i += 1) {
      const out = await nextQuestion(repo, asha, { topicIds: id(t.Sets) });
      seen.add(out.question._id);
      await recordAttempt(repo, asha, { attemptId: `fix-open-000${i}`, questionId: out.question._id, topicId: id(t.Sets), response: 0 });
    }
    assert.deepEqual([...seen].sort(), [id(served), id(voted)].sort(), 'the room\'s two questions, never the open self-test\'s');
  });

  test('an answer to a closed question in practice or a review set is refused, saying why, and nothing is stored', async () => {
    const { repo, content, t, sets, room } = await fixture();
    const { run } = await startExam(repo, asha, { clientRunId: 'fix-exam-0002', topicIds: [id(t.Sets)], count: 1 });
    const onTest = sets.find((q) => id(q) === run.spec.questions[0].questionId);
    const inRoom = sets.find((q) => q !== onTest);
    const open = await room();
    await servedTo(repo, open, inRoom);
    for (const mode of ['practice', 'review']) {
      await assert.rejects(recordAttempt(repo, asha, { attemptId: `fix-room-${mode}`, questionId: id(inRoom), topicId: id(t.Sets), response: 0, mode }),
        (err) => err.status === 409 && err.message === CLOSED_SENTENCE.room, mode);
      await assert.rejects(recordAttempt(repo, asha, { attemptId: `fix-test-${mode}`, questionId: id(onTest), topicId: id(t.Sets), response: 0, mode }),
        (err) => err.status === 409 && err.message === CLOSED_SENTENCE['self-test'], mode);
    }
    assert.equal((await repo.listHubAttempts({ accountId: asha.id })).length, 0, 'nothing stored');
    // The self-test's own answer is taken as always, with no mark shown.
    const kept = await answerExam(repo, asha, run, { attemptId: 'fix-exam-ans-1', questionId: id(onTest), response: 0 });
    assert.equal(kept.duplicate, false);
    // Once it is handed in, and the room closed, both are practised as before.
    await submitExam(repo, run);
    await repo.updateSession(id(open), { status: 'closed' });
    for (const q of [onTest, inRoom]) {
      const { attempt } = await recordAttempt(repo, asha, { attemptId: `fix-after-${id(q).slice(-6)}`, questionId: id(q), topicId: id(t.Sets), response: 0 });
      assert.equal(attempt.mode, 'practice');
    }
    assert.ok(content);
  });

  test('no hint opens on a closed question, and the next question\'s hints say why', async () => {
    const { repo, t, sets, room } = await fixture();
    const open = await room();
    await servedTo(repo, open, sets[0]);
    const offered = await hintsOffered(repo, { account: asha, question: sets[0], topicId: id(t.Sets), mode: 'practice' });
    assert.deepEqual(offered, { available: 0, note: CLOSED_SENTENCE.room });
    await assert.rejects(serveHint(repo, { account: asha, question: sets[0], topicId: id(t.Sets), mode: 'practice', attemptId: 'fix-hint-0001' }),
      (err) => err.status === 409 && err.message === CLOSED_SENTENCE.room);
    assert.equal((await repo.listHintViews({ accountId: asha.id })).length, 0);
    assert.equal((await hintsOffered(repo, { account: asha, question: sets[1], topicId: id(t.Sets), mode: 'practice' })).available, 3,
      'another question still offers its hints');
  });

  test('the question an open Get Ready check is asking is closed to practice and hints; answered in the check, it opens', async () => {
    const { repo, t } = await fixture();
    const { run } = await startCheck(repo, asha, { clientRunId: 'fix-check-0001', targetTopicId: id(t.Pairs) });
    const view = await checkView(repo, asha, run);
    const asked = view.question.question;
    await assert.rejects(recordAttempt(repo, asha, { attemptId: 'fix-gr-practice', questionId: asked._id, topicId: id(t.Sets), response: 0 }),
      (err) => err.status === 409 && err.message === CLOSED_SENTENCE.getready);
    await assert.rejects(serveHint(repo, { account: asha, question: await repo.getQuestion(asked._id), topicId: id(t.Sets), attemptId: 'fix-gr-hint-01' }),
      (err) => err.status === 409 && err.message === CLOSED_SENTENCE.getready);
    await answerCheck(repo, asha, run, { attemptId: 'fix-gr-answer-1', questionId: asked._id, response: 0 });
    const { attempt } = await recordAttempt(repo, asha, { attemptId: 'fix-gr-practice', questionId: asked._id, topicId: id(t.Sets), response: 0 });
    assert.equal(attempt.mode, 'practice', 'once the check has moved on, it is practised as before');
  });

  test('Get Ready skips a question a room is asking, and refuses an answer to it', async () => {
    const { repo, t, room } = await fixture();
    const { run } = await startCheck(repo, asha, { clientRunId: 'fix-check-0002', targetTopicId: id(t.Pairs) });
    const first = (await checkView(repo, asha, run)).question.question;
    const open = await room();
    await servedTo(repo, open, { _id: first._id });
    const after = await checkView(repo, asha, run);
    assert.notEqual(after.question.question._id, first._id, 'another question on the same topic');
    await assert.rejects(answerCheck(repo, asha, run, { attemptId: 'fix-gr-room-01', questionId: first._id, response: 0 }),
      (err) => err.status === 409 && err.message === CLOSED_SENTENCE.room);
    assert.equal((await repo.listHubAttempts({ accountId: asha.id })).length, 0);
  });

  test('a self-test\'s result keeps back the answer of a question a room is asking now, and shows it once the room moves on', async () => {
    const { repo, t, room } = await fixture();
    const { run } = await startExam(repo, asha, { clientRunId: 'fix-exam-0003', topicIds: [id(t.Sets)], count: 1 });
    const qid = run.spec.questions[0].questionId;
    await answerExam(repo, asha, run, { attemptId: 'fix-exam-ans-3', questionId: qid, response: 1 });
    await submitExam(repo, run);
    const open = await room();
    await servedTo(repo, open, { _id: qid });
    const held = (await examView(repo, asha, (await repo.getHubRun(run._id)))).questions[0];
    assert.deepEqual([held.answered, held.correct, held.solution, held.explanation, held.held, held.heldNote], [true, false, null, null, true, ROOM_HELD_NOTE]);
    await repo.updateSession(id(open), { status: 'closed' });
    const shown = (await examView(repo, asha, (await repo.getHubRun(run._id)))).questions[0];
    assert.equal(shown.solution, 0);
    assert.equal(shown.held, undefined);
  });
});

/* --------------------------------------------------------------- error log -- */

describe('the error log keeps a room\'s keys back (review finding: "From class" solutions)', () => {
  test('an entry whose question a room is asking now shows no answer, and says why; it shows once the room moves on', async () => {
    const { repo, t, sets, room } = await fixture();
    await recordAttempt(repo, asha, { attemptId: 'fix-log-0001', questionId: id(sets[0]), topicId: id(t.Sets), response: 2 });
    const open = await room();
    await servedTo(repo, open, sets[0]);
    const [held] = (await errorLogFor(repo, asha)).entries;
    assert.deepEqual([held.from, held.solution, held.explanation, held.keyHeld], ['practice', null, null, ROOM_HELD_NOTE]);
    await repo.updateSession(id(open), { status: 'closed' });
    const [shown] = (await errorLogFor(repo, asha)).entries;
    assert.deepEqual([shown.solution, shown.keyHeld], [0, undefined]);
  });

  test('"From class": what was right only where practice could show it too; never for a question a room may ask again and practice cannot serve', async () => {
    const { repo, content, sets, room } = await fixture();
    const [image] = await repo.insertQuestions([{ contentId: content._id, topic: 'Sets', text: 'Which set does the diagram show?', kind: 'mcq', options: OPTIONS,
      answerIdx: 0, bloom: 'apply', source: 'teacher', status: 'active', stimulus: { kind: 'image', url: '/api/media/0123456789abcdef01234567', alt: 'a diagram' } }]);
    const closedRoom = await room();
    await repo.updateSession(id(closedRoom), { status: 'closed' });
    const wrong = (q, key) => repo.recordAnswer({
      sessionId: id(closedRoom), answerKey: key, rollNo: '21CS01', accountId: asha.id, accountVerified: true, questionId: id(q),
      contentId: id(content), topic: 'Sets', bloom: q.bloom, kind: 'mcq', questionSnapshot: snapshotOf(q), response: 1,
      correct: false, score: 0, final: true, answeredAt: new Date().toISOString(),
    });
    await wrong(image, 'fix-class-image');
    await pause();
    await wrong(sets[2], 'fix-class-sets');
    const log = await errorLogFor(repo, asha);
    const byItem = new Map(log.entries.map((e) => [e.question.text, e]));
    const onImage = byItem.get(image.text);
    const onSets = byItem.get(sets[2].text);
    assert.deepEqual([onImage.from, onImage.solution, onImage.explanation, onImage.keyHeld], ['class', null, null, CLASS_KEY_NOTE]);
    assert.deepEqual([onSets.from, onSets.solution, onSets.keyHeld], ['class', 0, undefined], 'practice could serve it: its answer is shown');
    // Retired from the bank, no room serves it again: its answer is the student's to see.
    await repo.updateQuestion(id(image), { status: 'discarded' });
    const after = (await errorLogFor(repo, asha)).entries.find((e) => e.question.text === image.text);
    assert.deepEqual([after.solution, after.keyHeld], [0, undefined]);
  });
});

/* ------------------------------------------------------------ hints used -- */

describe('hints used are counted on the question, not on the client\'s attempt id (review finding)', () => {
  test('a hint opened under one id counts on an answer sent under another; hints before the previous answer do not', async () => {
    const { repo, t, sets } = await fixture();
    const q = sets[0];
    await serveHint(repo, { account: asha, question: q, topicId: id(t.Sets), mode: 'practice', attemptId: 'hintsid-00001' });
    await serveHint(repo, { account: asha, question: q, topicId: id(t.Sets), mode: 'practice', attemptId: 'hintsid-00001' });
    assert.equal(await hintsUsedOn(repo, { account: asha, questionId: id(q), attemptId: 'answerid-0001', mode: 'practice' }), 2);
    assert.equal(await hintsUsedOn(repo, { account: asha, questionId: id(sets[1]), attemptId: 'answerid-0001', mode: 'practice' }), 0, 'another question');
    await pause();
    const { attempt } = await recordAttempt(repo, asha, { attemptId: 'answerid-0001', questionId: id(q), topicId: id(t.Sets), response: 1 },
      { hintsUsed: await hintsUsedOn(repo, { account: asha, questionId: id(q), attemptId: 'answerid-0001', mode: 'practice' }) });
    assert.equal(attempt.hintsUsed, 2);
    await pause();
    assert.equal(await hintsUsedOn(repo, { account: asha, questionId: id(q), attemptId: 'answerid-0002', mode: 'practice' }), 0,
      'those were used on the answer before');
    await serveHint(repo, { account: asha, question: q, topicId: id(t.Sets), mode: 'practice', attemptId: 'hintsid-00002' });
    assert.equal(await hintsUsedOn(repo, { account: asha, questionId: id(q), attemptId: 'answerid-0002', mode: 'practice' }), 1);
    assert.equal(await hintsUsedOn(repo, { account: asha, questionId: id(q), attemptId: 'answerid-0002', mode: 'exam' }), 0, 'never in a self-test');
  });
});

/* ------------------------------------------------- off the roster, lessons -- */

describe('what a student no longer reaches, and what was never approved', () => {
  test('off the roster, an open self-test shows none of its questions, and its result none it did not answer', async () => {
    const { repo, ashaRow, t } = await fixture();
    const { run } = await startExam(repo, asha, { clientRunId: 'fix-exam-0004', topicIds: [id(t.Sets), id(t.Pairs)], count: 4 });
    await answerExam(repo, asha, run, { attemptId: 'fix-gone-ans-1', questionId: run.spec.questions[0].questionId, response: 0 });
    await repo.updateClassStudent(ashaRow._id, { removedAt: new Date().toISOString() });
    const open = await examView(repo, asha, run);
    assert.ok(open.questions.every((x) => x.removed === true && x.sentence === OUT_OF_REACH && !x.question), JSON.stringify(open.questions[0]));
    const ended = await examView(repo, asha, await submitExam(repo, run));
    const [answered, ...rest] = ended.questions;
    assert.equal(answered.answered, true, 'what they answered stays theirs, from their own attempt');
    assert.ok(answered.question?.text);
    assert.ok(rest.every((x) => x.question === null && x.solution === null && /no longer on your classes/.test(x.markLabel)));
  });

  test('a lesson never takes an answer to a question that was never approved (a rejected AI draft)', () => {
    const rejected = { _id: 'q-rejected', status: 'discarded', model: 'm', approvedAt: null, kind: 'mcq' };
    const retired = { _id: 'q-retired', status: 'discarded', model: 'm', approvedAt: '2026-11-19T04:00:00.000Z', kind: 'mcq' };
    const lesson = { steps: [{ type: 'questions', questionIds: ['q-rejected', 'q-retired'] }] };
    assert.equal(lessonQuestion(lesson, 'q-rejected', [rejected, retired]), null);
    assert.equal(lessonQuestion(lesson, 'q-retired', [rejected, retired]), retired, 'one approved and retired since still takes the answer');
  });
});

/* ------------------------------------------------------- Get Ready, paths -- */

describe('Get Ready: a complete check stays complete; a refresher step can be finished (review findings)', () => {
  test('a check complete at once stays complete, with its path, when questions are approved after it ended', async () => {
    const { repo, t, sets } = await fixture();
    // Nothing approved on Sets yet: Pairs' check cannot ask about it.
    for (const q of sets) await repo.updateQuestion(id(q), { status: 'draft' });
    const { run } = await startCheck(repo, asha, { clientRunId: 'fix-check-0003', targetTopicId: id(t.Pairs) });
    assert.equal(run.endReason, 'complete');
    const before = await checkView(repo, asha, run);
    assert.deepEqual([before.check.status, before.prerequisites[0].outcome, before.question], ['complete', 'not-sure', null]);
    for (const q of sets) await repo.updateQuestion(id(q), { status: 'active' });
    const after = await checkView(repo, asha, await repo.getHubRun(run._id));
    assert.deepEqual([after.check.status, after.check.endedAt, after.prerequisites[0].outcome, after.question],
      ['complete', run.endedAt, 'not-sure', null]);
    assert.equal(after.prerequisites[0].sentence, 'Not sure yet: the check ended before it could ask about this topic.');
    assert.ok(after.path, 'its path stays');
    await assert.rejects(answerCheck(repo, asha, run, { attemptId: 'fix-ended-0001', questionId: id(sets[0]), response: 0 }),
      (err) => err.status === 409 && err.message === COMPLETE);
    assert.equal((await listChecks(repo, asha)).checks[0].status, 'complete');
    assert.equal((await activePaths(repo, asha)).length, 1);
  });

  test('a step counts a question again once every question on its topic has been answered since; a repeat before that is not counted', () => {
    const at = (m) => new Date(Date.parse('2026-11-19T05:00:00.000Z') + m * 60000).toISOString();
    const a = (q, correct, m) => ({ topicId: 'P', questionId: q, correct, createdAt: at(m) });
    const pools = new Map([['p', ['q1', 'q2']]]);
    assert.deepEqual(stepAnswers([a('q1', false, 1), a('q1', true, 2), a('q2', true, 3)], pools).get('p').map((x) => x.correct), [false, true],
      'q1 again before q2 was answered is not counted');
    const items = [{ topicId: 'P', name: 'Pairs', depth: 1, via: [], outcome: 'needs-review', answers: 2, right: 0 }];
    const since = [a('q1', false, 1), a('q2', true, 2), a('q1', true, 3)];
    const stuck = refresherPath({ items, target: { topicId: 'R', name: 'Relations' }, since });
    assert.equal(stuck.steps[0].status, 'in-progress', 'without the topic\'s questions, each counts once');
    const path = refresherPath({ items, target: { topicId: 'R', name: 'Relations' }, since, pools });
    assert.deepEqual([path.steps[0].status, path.steps[0].answers, path.steps[0].right], ['done', 3, 2]);
  });
});

/* ------------------------------------------------------------------ Elo -- */

describe('a topic\'s state never promises what its bank cannot give (review finding: N on a small bank)', () => {
  test('too few questions for an estimate, or for Mastered: the sentence says the topic needs more approved questions', () => {
    const tiny = topicState({ answers: 2, attempts: 20, skill: 3, reachable: 2 });
    assert.deepEqual([tiny.state, tiny.bankShort], ['not-sure', true]);
    assert.match(tiny.sentence, /needs answers to 3 different questions, and this topic does not have enough approved questions/);
    assert.doesNotMatch(tiny.sentence, /After 3 answers/);
    const four = topicState({ answers: 4, attempts: 20, skill: 3, reachable: 4 });
    assert.deepEqual([four.state, four.bankShort], ['in-progress', true]);
    assert.match(four.sentence, /Mastered needs answers to at least 5 different questions, and this topic does not have enough/);
    assert.doesNotMatch(four.sentence, /a few more will show it/);
    const staff = topicState({ answers: 2, skill: 3, reachable: 2 }, { audience: 'staff' });
    assert.match(staff.sentence, /the professor needs to approve more/);
    assert.equal(topicState({ answers: 4, skill: 3, reachable: 5 }).bankShort, undefined, 'one more question can still bring it');
  });

  test('worked out from practice: a topic with two questions, answered right again and again, says it needs more questions', async () => {
    const { repo, t, pairs } = await fixture();
    for (let i = 0; i < 6; i += 1) {
      const q = pairs[i % 2];
      await recordAttempt(repo, asha, { attemptId: `fix-elo-000${i}`, questionId: id(q), topicId: id(t.Pairs), response: 0 });
    }
    const scope = await studentScope(repo, asha);
    const entry = scope.topics.get(lower(id(t.Pairs)));
    const state = stateFrom((await topicModels(repo, [entry])).get(lower(id(t.Pairs))), asha.id);
    assert.deepEqual([state.state, state.answers, state.attempts, state.bankShort], ['not-sure', 2, 6, true]);
    assert.match(state.sentence, /does not have enough approved questions/);
  });
});

/* ---------------------------------------------------------- translations -- */

describe('a translation keeps every ____ gap (review finding)', () => {
  const english = { text: 'TCP uses a ____-way handshake and UDP is ____.' };

  test('a gap dropped or added blocks approval, and the prompt tells the model to keep them', () => {
    const dropped = checkTranslation(english, { text: 'TCP एक three-way handshake करता है और UDP connectionless है।' });
    assert.equal(dropped.ok, false);
    assert.deepEqual(dropped.blocking.map((f) => f.id), ['blanks']);
    assert.match(dropped.blocking[0].message, /has 0 ____ gaps where the English has 2/);
    assert.equal(checkTranslation(english, { text: 'TCP ____-way handshake करता है, UDP ____ है, और ____।' }).blocking[0].id, 'blanks');
    assert.equal(checkTranslation(english, { text: 'TCP ____-way handshake करता है और UDP ____ है।' }).blocking.length, 0);
    const prompt = buildTranslationPrompt({ language: 'hi', items: [{ label: 'I1', fields: english }] });
    assert.match(prompt, /Keep every ____ \(four underscores/);
  });

  test('an approved translation whose gaps do not match is never shown: English stands', async () => {
    const repo = createMemoryRepo();
    const q = { _id: '0123456789abcdef0123cafe', text: english.text, kind: 'cloze', contentId: 'c1' };
    const source = fieldsOf('question', q);
    const t = await repo.addItemTranslation({
      itemKind: 'question', itemId: q._id, contentId: 'c1', language: 'hi', fields: { text: 'TCP handshake करता है।' },
      sourceFields: source, sourceHash: sourceHash(source), provenance: 'ai', model: 'm', checks: [],
    });
    await repo.approveItemTranslation(t._id, { by: PROF });
    assert.equal((await servableTranslations(repo, { kind: 'question', items: [q], language: 'hi' })).size, 0);
  });
});

/* ------------------------------------------------------------- formulas -- */

describe('a formula sets no element id and makes no link (review finding)', () => {
  test('\\label, \\ref and \\eqref are shown as their source; formulas without them render as before', async () => {
    for (const input of ['$\\ref{javascript:alert(1)}$', '$$\\begin{equation}x\\label{ab}\\end{equation}$$', '$\\eqref{a}$',
      '$$\\begin{align}a&=b\\label{q}\\\\c&=d\\end{align}$$', '$\\label{z}x$']) {
      const out = await richText(input);
      assert.doesNotMatch(out.html, /<[^>]*\s(?:id|href)\s*=/i, input);
      assert.match(out.html, /rich-tex-error/, input);
      assert.equal(out.errors, 1, input);
    }
    const plain = await richText('$$\\begin{equation}x^2\\end{equation}$$ and $\\frac{a}{b}$');
    assert.equal(plain.errors, 0);
    assert.match(plain.html, /<math/);
  });
});
