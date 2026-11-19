// Phase 6: where Get Ready and self-tests meet the tutor, after the two were
// built apart (decisions H9, H10, H13).
//
// Pinned here: a question on a self-test the student has not handed in keeps its
// hints closed wherever it is asked for (practice, a lesson), until the
// self-test ends (handed in, or its time is up), while every other question
// still offers its hints; a self-test's result carries the professor's approved
// feedback on the wrong option chosen, after the end only and only for a
// question answered; and a Get Ready answer's reply carries that feedback after
// the attempt, as practice's does, while the check's question offers no hints.
// Never calls Gemini, Supabase or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { syncTopics } from '../src/services/hubTopics.js';
import { IN_SELF_TEST, serveHint } from '../src/services/hubTutor.js';
import { hintsOffered } from '../src/services/hubHintHook.js';
import { feedbackFor } from '../src/services/hubPractice.js';
import { openSelfTestQuestions } from '../src/services/hubHeld.js';
import { answerExam, examView, startExam, submitExam } from '../src/services/hubExam.js';
import { answerCheck, checkView, startCheck } from '../src/services/hubGetReady.js';

// Nothing here may reach a model.
config.gemini.apiKey = '';

const PROF = 'a0000000-0000-4000-8000-00000000000a';
const asha = { id: 'acc-asha', role: 'student', reportsTo: PROF, rollNo: '21cs01', active: true };
const OPTIONS = ['{1, 2}', '{1, 1}', '(1, 2)', '[1, 2]'];
const WRONG = 1; // '{1, 1}': an mcq's options are dealt in stored order

/**
 * PROF's class with Asha on it, one chapter placed: three approved mcq questions
 * on Sets (key 0) and one on Relations, each with an approved three-step hint
 * ladder; Sets is a confirmed prerequisite of Relations.
 */
async function fixture() {
  const repo = createMemoryRepo();
  const cls = await repo.createClass({ courseName: 'Discrete', section: 'A', ownerId: PROF });
  await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }]);
  const content = await repo.createContent({
    title: 'Sets', kind: 'pptx', ownerId: PROF, topics: ['Sets', 'Relations'], topicSlides: { Sets: [1, 2], Relations: [3] },
    rawText: 'Sets\nA set holds each element once.\nRelations\nA relation pairs elements.',
  });
  await syncTopics(repo, content);
  await repo.placeClassChapter({ classId: cls._id, contentId: content._id, unitId: null, position: 1 });
  const [sets, relations] = await repo.listChapterTopics(content._id);
  await repo.addTopicLink({ ownerId: PROF, prerequisiteId: String(sets._id), topicId: String(relations._id), provenance: 'professor', state: 'confirmed' });
  const made = await repo.insertQuestions([
    { topic: 'Sets', text: 'Which of these is a set?', bloom: 'remember' },
    { topic: 'Sets', text: 'Which of these is written as a set?', bloom: 'understand' },
    { topic: 'Sets', text: 'Which of these could be a set of two numbers?', bloom: 'apply' },
    { topic: 'Relations', text: 'Which of these is a set, as a relation is?', bloom: 'remember' },
  ].map((x) => ({ ...x, kind: 'mcq', options: OPTIONS, answerIdx: 0, contentId: content._id, status: 'active', source: 'teacher' })));
  const texts = ['Look again at slide 1: what may a set never do?', 'Check each choice for a repeat, then for its brackets.',
    '{1, 1} repeats 1; (1, 2) and [1, 2] use other brackets. One is left.'];
  for (const q of made) {
    for (const [i, text] of texts.entries()) {
      await repo.addQuestionHint({
        questionId: String(q._id), step: i + 1, text, provenance: 'professor', status: 'approved',
        sourceRef: { kind: 'slides', slides: [1] }, approvedAt: new Date().toISOString(), approvedBy: PROF,
      });
    }
  }
  const feedback = (q, text) => repo.addOptionFeedback({
    questionId: String(q._id), option: '{1, 1}', optionKey: '{1, 1}', text, provenance: 'professor', status: 'approved',
    approvedAt: new Date().toISOString(), sourceRef: { kind: 'slides', slides: [2] },
  });
  return { repo, sets, relations, setsQs: made.slice(0, 3), rel: made[3], feedback };
}

const id = (x) => String(x._id);
const byId = (qs, qid) => qs.find((q) => id(q) === String(qid));

describe('a self-test that is still open keeps its questions\' hints closed (H10 with H13)', () => {
  test('closed in practice and in a lesson while it is open; open again once it is handed in; other questions untouched', async () => {
    const { repo, sets, setsQs } = await fixture();
    const { run } = await startExam(repo, asha, { clientRunId: 'seam-exam-01', topicIds: [id(sets)], count: 1 });
    const held = byId(setsQs, run.spec.questions[0].questionId);
    const other = setsQs.find((q) => q !== held);
    assert.deepEqual([...await openSelfTestQuestions(repo, asha.id)], [id(held).toLowerCase()]);

    const offered = await hintsOffered(repo, { account: asha, question: held, topicId: id(sets), mode: 'practice' });
    assert.deepEqual(offered, { available: 0, note: IN_SELF_TEST }, 'the next question says why there are none');
    for (const mode of ['practice', 'review', 'lesson']) {
      await assert.rejects(serveHint(repo, { account: asha, question: held, topicId: id(sets), mode, attemptId: `seam-${mode}-0001` }),
        (err) => err.status === 409 && err.message === IN_SELF_TEST, `no hint in ${mode} on a question of the open self-test`);
    }
    assert.equal((await repo.listHintViews({ accountId: asha.id })).length, 0, 'nothing is recorded for a hint refused');
    assert.equal((await hintsOffered(repo, { account: asha, question: other, topicId: id(sets), mode: 'practice' })).available, 3,
      'a question not on the self-test still offers its hints');
    const elsewhere = await serveHint(repo, { account: asha, question: other, topicId: id(sets), mode: 'practice', attemptId: 'seam-other-0001' });
    assert.equal(elsewhere.status, 201);

    await submitExam(repo, run);
    assert.equal((await openSelfTestQuestions(repo, asha.id)).size, 0);
    assert.equal((await hintsOffered(repo, { account: asha, question: held, topicId: id(sets), mode: 'practice' })).available, 3);
    const after = await serveHint(repo, { account: asha, question: held, topicId: id(sets), mode: 'practice', attemptId: 'seam-after-0001' });
    assert.equal(after.status, 201, 'handed in: its hints open in practice');
  });

  test('a self-test whose time ran out holds nothing back, even before anyone has read it since', async () => {
    const { repo, sets, setsQs } = await fixture();
    // Started long ago with a ten-minute limit: its deadline and grace are past; its end is not written yet.
    const { run } = await startExam(repo, asha, { clientRunId: 'seam-exam-02', topicIds: [id(sets)], count: 1, timeLimitMinutes: 10 },
      { now: new Date('2020-02-03T05:00:00.000Z') });
    assert.equal(run.endedAt, null);
    assert.equal((await openSelfTestQuestions(repo, asha.id)).size, 0);
    const q = byId(setsQs, run.spec.questions[0].questionId);
    const out = await serveHint(repo, { account: asha, question: q, topicId: id(sets), mode: 'practice', attemptId: 'seam-late-0001' });
    assert.equal(out.status, 201);
  });
});

describe('the professor\'s feedback on a wrong option, after a self-test or a Get Ready answer (H13 with H9, H10)', () => {
  test('a self-test: none while it is open; then on the wrong option chosen, for a question answered only', async () => {
    const { repo, sets, setsQs, feedback } = await fixture();
    for (const [i, q] of setsQs.entries()) await feedback(q, `Feedback ${i + 1}: a set holds each element once.`);
    const { run } = await startExam(repo, asha, { clientRunId: 'seam-exam-03', topicIds: [id(sets)], count: 3 });
    assert.equal(run.spec.questions.length, 3);
    const [wrongQ, rightQ, blankQ] = run.spec.questions.map((x) => byId(setsQs, x.questionId));
    await answerExam(repo, asha, run, { attemptId: 'seam-ans-0001', questionId: id(wrongQ), response: WRONG });
    await answerExam(repo, asha, run, { attemptId: 'seam-ans-0002', questionId: id(rightQ), response: 0 });
    const open = await examView(repo, asha, run);
    assert.equal(open.exam.status, 'open');
    assert.doesNotMatch(JSON.stringify(open), /Feedback \d|optionFeedback/, 'no feedback of any kind before it is handed in');

    const result = await examView(repo, asha, await submitExam(repo, run));
    const item = (q) => result.questions.find((x) => x.questionId === id(q));
    const told = item(wrongQ).optionFeedback;
    assert.equal(told.length, 1);
    assert.equal(told[0].option, '{1, 1}');
    assert.equal(told[0].cite, 'Slide 2');
    assert.match(told[0].text, /^Feedback \d: a set holds each element once\.$/);
    assert.equal(told[0].text, `Feedback ${setsQs.indexOf(wrongQ) + 1}: a set holds each element once.`, 'the feedback of the question answered');
    assert.deepEqual(item(rightQ).optionFeedback, [], 'none on a question answered right');
    assert.deepEqual([item(blankQ).answered, item(blankQ).optionFeedback, item(blankQ).solution], [false, [], null],
      'none on a question left blank: it comes only after an attempt, like the key');
  });

  test('Get Ready: the check\'s question offers no hints; the answer\'s reply carries the feedback on the option chosen', async () => {
    const { repo, relations, setsQs, feedback } = await fixture();
    for (const [i, q] of setsQs.entries()) await feedback(q, `Feedback ${i + 1}: a set holds each element once.`);
    const { run } = await startCheck(repo, asha, { clientRunId: 'seam-check-01', targetTopicId: id(relations) });
    const view = await checkView(repo, asha, run);
    assert.equal(view.question.topic.name, 'Sets');
    assert.equal(view.question.hints.available, 0);
    assert.doesNotMatch(JSON.stringify(view), /Feedback \d/, 'no feedback before the attempt');
    const asked = byId(setsQs, view.question.question._id);
    await assert.rejects(serveHint(repo, { account: asha, question: asked, topicId: view.question.topic.id, mode: 'getready', attemptId: 'seam-ready-0001' }),
      (err) => err.status === 400);
    const { attempt, entry, duplicate } = await answerCheck(repo, asha, run, { attemptId: 'seam-ready-0001', questionId: id(asked), response: WRONG });
    assert.deepEqual([attempt.mode, attempt.hintsUsed, attempt.correct], ['getready', 0, false]);
    const reply = await feedbackFor(repo, asha, attempt, { entry, duplicate });
    assert.deepEqual(reply.optionFeedback.map((f) => [f.option, f.text]),
      [['{1, 1}', `Feedback ${setsQs.indexOf(asked) + 1}: a set holds each element once.`]]);
  });
});
