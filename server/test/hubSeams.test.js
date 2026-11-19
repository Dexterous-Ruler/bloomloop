// Phase 6: where practice and lessons meet, after the two were built apart.
//
// Pinned here: a lesson's answer goes into practice's own attempt store
// (hub_attempts) through services/hubAttemptBridge.js, once per attempt id, with
// the language shown; a lesson shows its questions with practice's one seed, so
// the error log redraws a lesson's wrong answer as the student saw it, and the
// answer counts in their progress; practice serves an approved, current Hindi or
// Marathi question and records the language shown; and an explanation is
// translated like any other item and read in the student's language after an
// attempt. End to end, over HTTP, in scripts/lessons.mjs. Never calls Gemini,
// Supabase or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { forStudent, score } from '../src/questionTypes.js';
import { snapshotOf } from '../src/sockets/index.js';
import { syncTopics } from '../src/services/hubTopics.js';
import { ANSWER_HELD, studentLessonView } from '../src/services/hubLessons.js';
import { ROOM_HELD_NOTE } from '../src/services/hubClosed.js';
import { fieldsOf, sourceHash, translatable } from '../src/services/hubLanguages.js';
import { PRACTICE_STORE, attemptStoreConnected, listHubAttempts, recordHubAttempt } from '../src/services/hubAttemptBridge.js';
import { feedbackFor, hubSeed, nextQuestion, recordAttempt } from '../src/services/hubPractice.js';
import { errorLogFor, studentProgress } from '../src/services/hubProgress.js';
import { explanationForStudent } from '../src/services/hubExplanations.js';

// Nothing here may reach a model.
config.gemini.apiKey = '';

const PROF = 'a0000000-0000-4000-8000-00000000000a';
const T0 = new Date('2026-11-19T10:00:00.000Z');
const iso = (minutes) => new Date(T0.getTime() + minutes * 60000).toISOString();
const asha = { id: 'acc-asha', role: 'student', reportsTo: PROF, rollNo: '21cs01', active: true };

/** PROF's class with Asha on it, one chapter placed, an approved lesson on Framing, one question on Routing. */
async function fixture() {
  const repo = createMemoryRepo();
  const cls = await repo.createClass({ courseName: 'Networks', section: 'A', ownerId: PROF });
  await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }]);
  const content = await repo.createContent({ title: 'Layers', kind: 'syllabus', rawText: 'Framing splits bits. Routing picks paths.', topics: ['Framing', 'Routing'], ownerId: PROF });
  await syncTopics(repo, content);
  await repo.placeClassChapter({ classId: cls._id, contentId: content._id, unitId: null, position: 1 });
  const [framing, routing] = await repo.listChapterTopics(content._id);
  const [qmcq, qorder, qroute] = await repo.insertQuestions([
    { topic: 'Framing', text: 'What splits bits?', kind: 'mcq', options: ['framing', 'routing', 'naming', 'paging'], answerIdx: 0, bloom: 'remember' },
    { topic: 'Framing', text: 'Put the layers in order', kind: 'order', sequence: ['physical', 'link', 'network', 'transport'], bloom: 'understand' },
    { topic: 'Routing', text: 'What picks paths?', kind: 'mcq', options: ['routing', 'framing', 'naming', 'paging'], answerIdx: 0, bloom: 'remember' },
  ].map((q) => ({ ...q, contentId: content._id, status: 'active', source: 'teacher' })));
  const draft = await repo.createTopicLesson({
    topicId: framing._id, contentId: content._id, ownerId: PROF, version: 1, source: 'slides', model: null,
    steps: [{ type: 'chunk', slides: null, text: 'Framing splits bits.' }, { type: 'questions', slides: null, questionIds: [qmcq._id, qorder._id] }],
    basis: { from: 'chapter-text' }, warnings: [],
  });
  const lesson = await repo.approveTopicLesson(draft._id, { by: PROF });
  return { repo, cls, content, framing, routing, qmcq, qorder, qroute, lesson };
}

/** A lesson step's attempt, as routes/hubLessons.js hands it to the bridge, marked with the hub's seed. */
function lessonAttempt({ cls, framing, lesson, q, response, attemptId, minutes = 0, over = {} }) {
  const graded = score(q, response, hubSeed(asha.id, q._id));
  return {
    accountId: asha.id, attemptId, mode: 'lesson', lessonId: String(lesson._id), lessonVersion: lesson.version,
    topicId: String(framing._id), topic: framing.name, classId: String(cls._id), contentId: String(lesson.contentId),
    questionId: String(q._id), kind: q.kind, bloom: q.bloom, questionSource: q.source, questionSnapshot: snapshotOf(q),
    response, correct: graded.correct, score: graded.score, ungraded: Boolean(graded.ungraded), detail: graded.detail ?? null,
    language: 'en', translationId: null, hintsUsed: 0, timeMs: 5000, answeredAt: iso(minutes), ...over,
  };
}

/** A translation as the professor writes it, made from the item's English now. */
async function translate(repo, { kind, item, contentId, language, fields }) {
  const english = fieldsOf(kind, item);
  return repo.addItemTranslation({
    itemKind: kind, itemId: item._id, contentId, ownerId: PROF, language, fields,
    sourceFields: english, sourceHash: sourceHash(english), provenance: 'professor', checks: [],
  });
}

/* ------------------------------------------------------- the attempt store -- */

describe('a lesson\'s answer goes into practice\'s attempt store (H5)', () => {
  test('connected from the start: one hub attempt per attempt id, with the mode, the language shown and the device\'s time', async () => {
    const f = await fixture();
    assert.equal(attemptStoreConnected(), true);
    const sent = lessonAttempt({ ...f, q: f.qmcq, response: 1, attemptId: 'lesson-0001', over: { language: 'hi' } });
    const first = await recordHubAttempt(f.repo, sent);
    assert.equal(first.duplicate, false);
    const rows = await f.repo.listHubAttempts({ accountId: asha.id });
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.deepEqual(
      [row.mode, row.clientAttemptId, row.topic, row.classId, row.questionId, row.language, row.hintsUsed, row.timeTakenMs, row.createdAt,
        row.correct, row.score, row.detail, row.reviewStatus, row.questionSource, row.questionSnapshot.answerIdx],
      ['lesson', 'lesson-0001', 'Framing', String(f.cls._id), String(f.qmcq._id), 'hi', 0, 5000, iso(0), false, 0, '', 'auto', 'teacher', 0],
    );
    const again = await recordHubAttempt(f.repo, { ...sent, response: 0, correct: true, score: 1 });
    assert.equal(again.duplicate, true);
    assert.equal(again.attempt.correct, false, 'the first answer back, unchanged');
    assert.equal((await f.repo.listHubAttempts({})).length, 1, 'never a second row');
    // A device's time hub_attempts would refuse (over a day) is kept as unknown, never as a failure.
    await recordHubAttempt(f.repo, lessonAttempt({ ...f, q: f.qorder, response: [0, 1, 2, 3], attemptId: 'lesson-0002', over: { timeMs: 90000000 } }));
    assert.equal((await f.repo.listHubAttempts({ accountId: asha.id }))[1].timeTakenMs, null);
  });

  test('a chapter is read through its questions; a mode narrows it', async () => {
    const f = await fixture();
    await recordHubAttempt(f.repo, lessonAttempt({ ...f, q: f.qmcq, response: 0, attemptId: 'lesson-0001' }));
    await recordAttempt(f.repo, asha, { attemptId: 'practice-01', questionId: String(f.qroute._id), topicId: String(f.routing._id), response: 0 },
      { now: new Date(iso(1)) });
    const other = await f.repo.createContent({ title: 'Other', kind: 'syllabus', rawText: 'x', topics: ['X'], ownerId: PROF });
    assert.deepEqual((await listHubAttempts(f.repo, { contentId: String(f.content._id) })).map((a) => a.clientAttemptId), ['lesson-0001', 'practice-01']);
    assert.deepEqual((await listHubAttempts(f.repo, { contentId: String(f.content._id), mode: 'lesson' })).map((a) => a.clientAttemptId), ['lesson-0001']);
    assert.deepEqual(await listHubAttempts(f.repo, { contentId: String(other._id) }), []);
  });

  test('a question that became a poll is refused before anything is written (hub_attempts refuses one)', async () => {
    const f = await fixture();
    await assert.rejects(PRACTICE_STORE.record(f.repo, lessonAttempt({ ...f, q: f.qmcq, response: 0, attemptId: 'lesson-0003', over: { kind: 'poll' } })),
      (err) => err.status === 409 && /not taken/.test(err.message));
    assert.equal((await f.repo.listHubAttempts({})).length, 0);
  });
});

/* -------------------------------------------------------- one shuffle -- */

describe('one shuffle for the hub: a lesson shows a question as practice does', () => {
  test('the lesson\'s order question is practice\'s board; its wrong answer reads back the same in the error log and counts in progress', async () => {
    const f = await fixture();
    const view = await studentLessonView(f.repo, { lesson: f.lesson, account: asha });
    const shown = view.steps.find((s) => s.type === 'questions').questions.find((q) => q._id === String(f.qorder._id));
    assert.deepEqual(shown.items, forStudent(f.qorder, hubSeed(asha.id, f.qorder._id)).items);
    // Fully reversed, in the positions shown: wrong.
    const response = [3, 2, 1, 0].map((i) => shown.items.indexOf(f.qorder.sequence[i]));
    const sent = lessonAttempt({ ...f, q: f.qorder, response, attemptId: 'lesson-0010' });
    assert.equal(sent.correct, false);
    await recordHubAttempt(f.repo, sent);

    const log = await errorLogFor(f.repo, asha);
    assert.equal(log.entries.length, 1);
    const [entry] = log.entries;
    assert.deepEqual(entry.question.items, shown.items, 'the board the student saw, not another shuffle');
    assert.deepEqual(entry.response, response);
    assert.deepEqual(entry.solution, f.qorder.sequence);

    const progress = await studentProgress(f.repo, asha, { now: new Date(iso(0)) });
    const framing = progress.topics.find((t) => t.id === String(f.framing._id));
    assert.equal(framing.state.answers, 1, 'the lesson\'s answer is the topic\'s evidence');
    assert.equal(framing.state.state, 'not-sure');
  });
});

/* ------------------------------------------------- practice in a language -- */

describe('practice in the student\'s language (H12)', () => {
  test('English with a plain note until a translation is approved; then Hindi; the attempt records what was shown', async () => {
    const f = await fixture();
    await f.repo.setLanguageChoice(asha.id, 'hi');
    const topicIds = String(f.routing._id);
    const t = await translate(f.repo, {
      kind: 'question', item: f.qroute, contentId: f.content._id, language: 'hi',
      fields: { text: 'paths कौन चुनता है?', options: ['routing', 'framing', 'naming', 'paging'] },
    });

    const before = await nextQuestion(f.repo, asha, { topicIds, now: T0 });
    assert.deepEqual([before.language, before.translationId, before.question.text],
      ['en', null, 'What picks paths?']);
    assert.equal(before.languageNote, 'This question is not in Hindi yet, so it is shown in English.');

    await f.repo.approveItemTranslation(t._id, { by: PROF });
    const after = await nextQuestion(f.repo, asha, { topicIds, now: T0 });
    assert.deepEqual([after.language, after.translationId, after.languageNote, after.question.text],
      ['hi', String(t._id), null, 'paths कौन चुनता है?']);
    assert.doesNotMatch(JSON.stringify(after), /answerIdx/);

    const body = (attemptId, shown) => ({ attemptId, questionId: String(f.qroute._id), topicId: topicIds, response: 0, ...(shown ? { shown } : {}) });
    const echoed = await recordAttempt(f.repo, asha, body('practice-hi1', { language: 'hi', translationId: String(t._id) }));
    const english = await recordAttempt(f.repo, asha, body('practice-en1', { language: 'en', translationId: null }));
    const unsaid = await recordAttempt(f.repo, asha, body('practice-no1'));
    const forged = await recordAttempt(f.repo, asha, body('practice-mr1', { language: 'mr', translationId: String(t._id) }));
    assert.deepEqual([echoed, english, unsaid, forged].map((r) => r.attempt.language), ['hi', 'en', 'hi', 'hi'],
      'the echo is believed when it can have been true; otherwise what is shown now');
    const told = await recordAttempt(f.repo, asha, body('practice-xx1'), { language: 'mr' });
    assert.equal(told.attempt.language, 'mr', 'a caller that knows the language says so');
  });
});

/* ------------------------------------------------- explanations translated -- */

describe('an explanation is translated like any item, and read after an attempt (H12, H14)', () => {
  test('named by its question; English with a note until approved; Hindi after; English again once rewritten', async () => {
    const f = await fixture();
    await f.repo.setLanguageChoice(asha.id, 'hi');
    await f.repo.addQuestionExplanation({
      questionId: f.qroute._id, text: 'Routing picks the path a packet takes.', provenance: 'professor', status: 'approved',
      approvedBy: PROF, approvedAt: iso(0), createdBy: PROF,
    });
    const item = await translatable('explanation').load(f.repo, f.qroute._id);
    assert.equal(String(item._id), String(f.qroute._id));
    assert.equal(String(item.contentId), String(f.content._id));
    assert.deepEqual(fieldsOf('explanation', item), { explanation: 'Routing picks the path a packet takes.' });

    const t = await translate(f.repo, {
      kind: 'explanation', item, contentId: f.content._id, language: 'hi', fields: { explanation: 'Routing वह path चुनता है जो packet लेता है।' },
    });
    let shown = await explanationForStudent(f.repo, f.qroute._id, 'hi');
    assert.equal(shown.text, 'Routing picks the path a packet takes.');
    assert.equal(shown.language.note, 'This explanation is not in Hindi yet, so it is shown in English.');

    await f.repo.approveItemTranslation(t._id, { by: PROF });
    const { attempt, entry } = await recordAttempt(f.repo, asha,
      { attemptId: 'practice-ex1', questionId: String(f.qroute._id), topicId: String(f.routing._id), response: 1 });
    const told = await feedbackFor(f.repo, asha, attempt, { entry });
    assert.equal(told.explanation.text, 'Routing वह path चुनता है जो packet लेता है।');
    assert.equal(told.explanation.language.language, 'hi');
    assert.equal((await explanationForStudent(f.repo, f.qroute._id)).text, 'Routing picks the path a packet takes.', 'English when English is asked for');

    await f.repo.updateQuestionExplanation(f.qroute._id, { text: 'Routing chooses each packet\'s path.' });
    shown = await explanationForStudent(f.repo, f.qroute._id, 'hi');
    assert.equal(shown.text, 'Routing chooses each packet\'s path.', 'a translation of the old words is never shown');
    assert.equal(shown.language.language, 'en');
  });
});

/* ------------------------------------------------- a lesson's earlier answers -- */

// The client session's ask of 19 Nov 2026: a reload of a lesson showed every
// question unanswered again, the student's answers already stored.
describe('a lesson shows the student\'s latest answer to each of its questions', () => {
  const KEYS = /answerIdx|answerIdxs|"accept"|rubric|"solution"|explanation/;
  const questionsOf = (view) => view.steps.find((s) => s.type === 'questions').questions;
  const byId = (view, q) => questionsOf(view).find((x) => x._id === String(q._id));

  test('none before an answer, and no key; after answers, the latest lesson answer with its key and explanation', async () => {
    const f = await fixture();
    await f.repo.addQuestionExplanation({
      questionId: f.qmcq._id, text: 'Framing is what splits the bits into frames.', provenance: 'professor', status: 'approved',
      approvedBy: PROF, approvedAt: iso(0), createdBy: PROF,
    });
    const before = await studentLessonView(f.repo, { lesson: f.lesson, account: asha });
    assert.ok(questionsOf(before).every((q) => q.lastAnswer === null));
    assert.doesNotMatch(JSON.stringify(before), KEYS);

    await recordHubAttempt(f.repo, lessonAttempt({ ...f, q: f.qmcq, response: 2, attemptId: 'lesson-0101', minutes: 1 }));
    await recordHubAttempt(f.repo, lessonAttempt({ ...f, q: f.qmcq, response: 0, attemptId: 'lesson-0102', minutes: 2 }));
    // Practice on the same question is not a lesson answer, even when it is later.
    await recordAttempt(f.repo, asha, { attemptId: 'practice-0103', questionId: String(f.qmcq._id), topicId: String(f.framing._id), response: 3 },
      { now: new Date(iso(3)) });

    const after = await studentLessonView(f.repo, { lesson: f.lesson, account: asha });
    const last = byId(after, f.qmcq).lastAnswer;
    assert.deepEqual([last.attemptId, last.response, last.correct, last.score, last.solution, last.answeredAt, last.language],
      ['lesson-0102', 0, true, 1, 0, iso(2), 'en']);
    assert.equal(last.explanation.text, 'Framing is what splits the bits into frames.');
    assert.deepEqual(last.optionFeedback, []);
    assert.equal(last.held, undefined);
    assert.equal(byId(after, f.qorder).lastAnswer, null, 'a question never answered here carries no key');
    assert.doesNotMatch(JSON.stringify(byId(after, f.qorder)), KEYS);
    // A staff preview has no answers of its own.
    const preview = await studentLessonView(f.repo, { lesson: f.lesson, account: { id: PROF, role: 'professor' } });
    assert.ok(questionsOf(preview).every((q) => q.lastAnswer === null));
  });

  test('the key is shown in the positions the student saw, worked out from the answer\'s own snapshot', async () => {
    const f = await fixture();
    const view = await studentLessonView(f.repo, { lesson: f.lesson, account: asha });
    const shown = byId(view, f.qorder);
    const response = [3, 2, 1, 0].map((i) => shown.items.indexOf(f.qorder.sequence[i]));
    await recordHubAttempt(f.repo, lessonAttempt({ ...f, q: f.qorder, response, attemptId: 'lesson-0201' }));
    const last = byId(await studentLessonView(f.repo, { lesson: f.lesson, account: asha }), f.qorder).lastAnswer;
    assert.equal(last.correct, false);
    assert.deepEqual(last.response, response);
    assert.deepEqual(last.solution, score(f.qorder, response, hubSeed(asha.id, f.qorder._id)).solution);
  });

  test('while a room is asking the question, what was right and why is kept back, and says why', async () => {
    const f = await fixture();
    await f.repo.addQuestionExplanation({
      questionId: f.qmcq._id, text: 'Framing splits bits.', provenance: 'professor', status: 'approved', approvedBy: PROF, approvedAt: iso(0), createdBy: PROF,
    });
    await recordHubAttempt(f.repo, lessonAttempt({ ...f, q: f.qmcq, response: 1, attemptId: 'lesson-0301' }));
    const room = await f.repo.createSession({ contentId: f.content._id, code: 'HELD01', title: 'Room', ownerId: PROF });
    await f.repo.saveProfile({ sessionId: String(room._id), rollNo: '21CS09', name: '', served: { questionId: String(f.qmcq._id), at: iso(1), reason: '' } });
    const q = byId(await studentLessonView(f.repo, { lesson: f.lesson, account: asha }), f.qmcq);
    assert.equal(q.closed.reason, 'room');
    assert.deepEqual([q.lastAnswer.response, q.lastAnswer.correct, q.lastAnswer.solution, q.lastAnswer.explanation, q.lastAnswer.held],
      [1, false, null, null, true]);
    assert.equal(q.lastAnswer.heldNote, ROOM_HELD_NOTE);
    assert.equal(ANSWER_HELD.room, ROOM_HELD_NOTE);
    assert.doesNotMatch(JSON.stringify(q), /"solution":0|Framing splits bits/);
  });
});
