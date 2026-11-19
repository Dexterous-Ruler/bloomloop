// Phase 6: the hub's tutor - hint ladders and feedback on wrong options
// (decision H13, under decisions 1 and 5).
//
// Pinned here: the answer-leak check, kind by kind, refusing a hint that holds
// the answer and saying why; which hint comes first, on hand-built histories
// (the student's recent attempts on the question and topic, the wrong option
// they chose, their topic state; never a self-test's or Get Ready's attempts);
// no hints in a self-test or Get Ready, tested against the mode values; every
// hint opened recorded and counted onto the attempt; only approved hints and
// feedback reach a student, each with its slides; the model's drafts parsed
// from fixture replies through the real parser, and none offline; hints and
// feedback as items in the generic translation shape; the repos' side of the
// contract. End to end, over HTTP, in scripts/tutor.mjs. Never calls Gemini,
// Supabase or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import {
  BATCH, HINT_MODES, MAX_HINTS, MAX_MODEL_TEXT, NO_HINT_MODES, OFFLINE_NOTE, WHY, answerLeak, buildTutorPrompt, chosenWrongKeys,
  draftTutor, feedbackOptions, optionFeedbackAfter, parseTutorReply, planHints, serveHint, servableFeedback,
  servableLadder, shownHints, staffQuestionTutor, tutorInput, tutorText, tutorTranslationItems, wantedFor, writeTutorDrafts,
} from '../src/services/hubTutor.js';
import { feedbackAfter, hintsOffered, hintsUsedOn } from '../src/services/hubHintHook.js';
import { activityOf } from '../src/services/hubProgress.js';
import { syncTopics } from '../src/services/hubTopics.js';
import { feedbackFor, hubSeed, nextQuestion, recordAttempt } from '../src/services/hubPractice.js';
import { fieldsOf, sourceHash, translatable } from '../src/services/hubLanguages.js';
import { snapshotOf } from '../src/sockets/index.js';

// The model is never called here: drafts are parsed from fixture replies.
config.gemini.apiKey = '';

const PROF = 'a0000000-0000-4000-8000-00000000000a';
const T0 = new Date('2026-11-19T10:00:00.000Z');
const iso = (minutes) => new Date(T0.getTime() + minutes * 60000).toISOString();
const asha = { id: 'acc-asha', role: 'student', reportsTo: PROF, rollNo: '21cs01', active: true };

// What a student may never be sent before an attempt.
const KEYS = /answerIdx|answerIdxs|answerBool|"accept"|rubric|"solution"|explanation|misconception/;

/* ------------------------------------------------------- the leak check -- */

describe('the answer-leak check: a hint never holds the answer', () => {
  const mcq = { _id: 'q1', kind: 'mcq', text: 'Which protocol guarantees delivery?', options: ['TCP', 'UDP', 'IP', 'TCP and UDP'], answerIdx: 0, bloom: 'remember' };

  test('a choice question: the right option\'s words, its letter or its number; another option holding them is not it', () => {
    assert.equal(answerLeak(mcq, 'Think about which protocol sets up a connection first.'), null);
    assert.equal(answerLeak(mcq, 'It is TCP.').id, 'key-text');
    assert.match(answerLeak(mcq, 'It is TCP.').message, /^It gives the answer away: it names the right option, "TCP"\.$/);
    assert.equal(answerLeak(mcq, 'Pick option A.').id, 'key-letter');
    assert.equal(answerLeak(mcq, 'The answer is (A).').id, 'key-letter');
    assert.equal(answerLeak(mcq, 'Choice 1 is the one.').id, 'key-letter');
    assert.equal(answerLeak(mcq, 'Option B is tempting, but read slide 2.'), null, 'another option\'s letter is not the answer');
    assert.equal(answerLeak(mcq, 'Does "TCP and UDP" make sense for one protocol?'), null, 'an option that contains the key\'s words is not the key');
  });

  test('options that differ only in symbols are matched character for character', () => {
    const q = { _id: 'q2', kind: 'mcq', text: 'Which of these is a set?', options: ['{1, 2}', '{1, 1}', '(1, 2)', '[1, 2]'], answerIdx: 0, bloom: 'remember' };
    assert.equal(answerLeak(q, '(1, 2) and [1, 2] use other brackets; {1, 1} repeats an element.'), null);
    assert.equal(answerLeak(q, 'The answer is {1, 2}.').id, 'key-text');
  });

  test('the right option named in the stem may be mentioned; stated as the result, it may not', () => {
    const q = { _id: 'q3', kind: 'mcq', text: 'How many elements has {1, 2, 3}?', options: ['1', '2', '3', '4'], answerIdx: 2, bloom: 'remember' };
    assert.equal(answerLeak(q, 'Count the elements of {1, 2, 3} one by one.'), null);
    assert.equal(answerLeak(q, 'The set has 3 elements.').id, 'key-text');
    assert.equal(answerLeak(q, 'So the count = 3.').id, 'key-text');
  });

  test('choose all that apply: any right option', () => {
    const q = { _id: 'q4', kind: 'multi', text: 'Which are prime?', options: ['2', '4', '5', '9'], answerIdxs: [0, 2], bloom: 'analyse' };
    assert.equal(answerLeak(q, 'A prime has exactly two divisors.'), null);
    assert.equal(answerLeak(q, 'Five has two divisors.'), null);
    assert.equal(answerLeak(q, 'Try 5 first.').id, 'key-text');
    assert.equal(answerLeak(q, 'Option C is one of them.').id, 'key-letter');
  });

  test('true or false: a claim that the statement is what the key says; a question about it is fine', () => {
    const t = { _id: 'q5', kind: 'truefalse', text: 'Every set contains the empty set.', answerBool: true, bloom: 'remember' };
    assert.equal(answerLeak(t, 'The statement is true.').id, 'key-claim');
    assert.equal(answerLeak(t, 'True.').id, 'key-claim');
    assert.equal(answerLeak(t, 'It\'s true for every set.').id, 'key-claim');
    assert.equal(answerLeak(t, 'Is this true for the set {1}? Check the definition of a subset.'), null);
    assert.equal(answerLeak(t, 'Check whether the claim is true for the empty set itself.'), null);
    assert.equal(answerLeak({ ...t, answerBool: false }, 'The statement is true.'), null, 'the opposite of the key gives nothing away');
  });

  test('a numeric answer: its value within the tolerance, in any digits; a number the stem shows may be named, not stated', () => {
    const q = { _id: 'q6', kind: 'numeric', text: 'A train covers 120 km in 2 hours. What is its speed?', value: 60, tolerance: 0, unit: 'km/h', bloom: 'apply' };
    assert.equal(answerLeak(q, 'Divide the distance by the time.'), null);
    assert.equal(answerLeak(q, 'Divide 120 by 2.'), null);
    assert.equal(answerLeak(q, 'It comes to 60.').id, 'key-value');
    assert.match(answerLeak(q, 'about 60').message, /the answer's value, 60 km\/h\./);
    assert.equal(answerLeak(q, 'उत्तर ६० है').id, 'key-value', 'Devanagari digits are read as digits');
    assert.equal(answerLeak({ ...q, tolerance: 1 }, 'Roughly 59.5 km/h.').id, 'key-value');
    const shown = { _id: 'q7', kind: 'numeric', text: 'If x + 0 = 7, what is x?', value: 7, tolerance: 0, bloom: 'apply' };
    assert.equal(answerLeak(shown, 'Look at what adding 0 does to x, then at the 7.'), null);
    assert.equal(answerLeak(shown, 'So x is 7.').id, 'key-value');
  });

  test('typed answers, pairs, groups, an order, the words to pick and a rubric point', () => {
    const blank = { _id: 'b', kind: 'blank', text: 'A set with no elements is the ____ set.', accept: ['empty', 'null'], bloom: 'apply' };
    assert.equal(answerLeak(blank, 'Think of a set you can write as {}.'), null);
    assert.equal(answerLeak(blank, 'It is the empty one.').id, 'key-text');
    const match = { _id: 'm', kind: 'match', text: 'Match each term.', pairs: [{ left: 'Union', right: 'in A or B' }, { left: 'Intersection', right: 'in A and B' }, { left: 'Difference', right: 'in A not B' }], bloom: 'understand' };
    assert.equal(answerLeak(match, 'Union and intersection differ in one word.'), null);
    assert.equal(answerLeak(match, 'Union means in A or B.').id, 'pair');
    const cat = { _id: 'c', kind: 'categorise', text: 'Sort them.', buckets: [{ name: 'Finite', items: ['{1, 2}', 'the days of a week'] }, { name: 'Infinite', items: ['the integers', 'the reals'] }], bloom: 'understand' };
    assert.equal(answerLeak(cat, 'The integers are infinite.').id, 'group');
    const order = { _id: 'o', kind: 'order', text: 'Order the layers.', sequence: ['physical', 'data link', 'network'], bloom: 'evaluate' };
    assert.equal(answerLeak(order, 'Start from the wires: physical comes before network.'), null);
    assert.equal(answerLeak(order, 'physical, then data link, then network').id, 'order');
    const hot = { _id: 'h', kind: 'hottext', text: 'Pick the verb.', tokens: ['The', 'router', 'forwards', 'packets'], criterion: 'the verb', answerIdxs: [2], bloom: 'analyse' };
    assert.equal(answerLeak(hot, 'A verb says what something does.'), null);
    assert.equal(answerLeak(hot, 'The verb is forwards.').id, 'tokens');
    const open = { _id: 'p', kind: 'open', text: 'Design a protocol.', rubric: ['states a handshake with three messages', 'names a timeout'], bloom: 'create' };
    assert.equal(answerLeak(open, 'Think about how the two ends agree to start.'), null);
    assert.equal(answerLeak(open, 'Your answer states a handshake with three messages.').id, 'rubric');
  });

  test('a professor\'s hint holding the answer is refused, saying why; a clean one is tidied and kept', () => {
    assert.throws(() => tutorText('Pick option A, TCP.', mcq), (err) => err.status === 400
      && /^This hint was not saved\. It gives the answer away: it names the right option, "TCP"\. Rewrite it/.test(err.message));
    assert.throws(() => tutorText('   ', mcq), (err) => err.status === 400);
    assert.throws(() => tutorText('x'.repeat(601), mcq), (err) => err.status === 400 && /600/.test(err.message));
    assert.throws(() => tutorText('Mail me at a@b.co', mcq), (err) => err.status === 400 && /email/.test(err.message));
    assert.equal(tutorText('  Which one   needs a handshake? ', mcq), 'Which one needs a handshake?');
    assert.throws(() => tutorText('UDP never retries; TCP does.', mcq, 'feedback'), (err) => /^This feedback was not saved/.test(err.message));
  });
});

/* ------------------------------------------------------ which hint first -- */

describe('which hint comes first (planHints), on hand-built histories', () => {
  const q = { _id: 'q-sets', kind: 'mcq', text: 'Which of these is a set?', options: ['{1, 2}', '{1, 1}', '(1, 2)', '[1, 2]'], answerIdx: 0, bloom: 'remember' };
  const ladder = servableLadder(q, [1, 2, 3].map((step) => ({ _id: `h${step}`, step, text: `Hint ${step}: think about repeats.`, status: 'approved', provenance: 'professor' })));
  // Feedback on {1, 1} (option 1) only.
  const feedback = servableFeedback(q, [{ _id: 'f1', option: '{1, 1}', optionKey: '{1, 1}', text: 'A set never holds an element twice.', status: 'approved', provenance: 'professor' }]);
  const seedOf = (a) => hubSeed(a.accountId, a.questionId);
  let n = 0;
  /** An attempt by Asha: on this question by default, `chose` an option index. */
  const att = ({ minutes = (n += 1), questionId = 'q-sets', correct = false, chose = 2, hints = 0, mode = 'practice' } = {}) => ({
    _id: `a${n}`, accountId: 'acc-asha', questionId, topicId: 't1', bloom: 'remember', kind: 'mcq', mode, correct, hintsUsed: hints,
    response: chose, questionSnapshot: snapshotOf(q), createdAt: iso(minutes),
  });
  const plan = (history, state = null) => planHints({ question: q, ladder, feedback, history, state, seedOf });
  const kinds = (p) => p.items.map((i) => i.kind).join(',');

  test('no history: the nudge first, the whole ladder, and a plain sentence', () => {
    const p = plan([]);
    assert.equal(kinds(p), 'nudge,strategy,worked');
    assert.equal(p.why, WHY.plain);
  });

  test('wrong last time after hints: the ladder starts past them', () => {
    assert.equal(kinds(plan([att({ hints: 1 })])), 'strategy,worked');
    assert.equal(plan([att({ hints: 1 })]).why, WHY.question(1));
    assert.equal(kinds(plan([att({ hints: 2 })])), 'worked');
    assert.equal(kinds(plan([att({ hints: 3 })])), 'worked', 'never past the last step');
  });

  test('wrong last time, choosing an option with feedback: that feedback first, in place of the nudge', () => {
    const p = plan([att({ chose: 1 })]);
    assert.equal(kinds(p), 'feedback,strategy,worked');
    assert.equal(p.items[0].id, 'f1');
    assert.equal(p.why, WHY.feedback);
    assert.equal(kinds(plan([att({ chose: 1, hints: 2 })])), 'feedback,worked');
    assert.equal(kinds(plan([att({ chose: 2 })])), 'nudge,strategy,worked', 'an option with no feedback: the ladder as usual');
    assert.deepEqual(chosenWrongKeys(q, att({ chose: 1 }), 'any'), ['{1, 1}']);
  });

  test('right last time, or right after an earlier mistake: least help first', () => {
    assert.equal(kinds(plan([att({ correct: true, chose: 0 })])), 'nudge,strategy,worked');
    assert.equal(kinds(plan([att({ chose: 1, hints: 2 }), att({ correct: true, chose: 0 })])), 'nudge,strategy,worked', 'only the latest attempt at the question counts');
  });

  test('the topic: most of the last five answers wrong starts at the strategy; fewer than three answers say nothing yet', () => {
    const other = (correct) => att({ questionId: 'q-other', correct });
    const p = plan([other(false), other(true), other(false), other(false), other(true)]);
    assert.equal(kinds(p), 'strategy,worked');
    assert.equal(p.why, WHY.topic);
    assert.equal(kinds(plan([other(false), other(true), other(true), other(false), other(true)])), 'nudge,strategy,worked');
    assert.equal(kinds(plan([other(false), other(false)])), 'nudge,strategy,worked');
    assert.equal(kinds(plan([other(true), other(false), other(false), other(false), other(true), other(true), other(true)])), 'nudge,strategy,worked',
      'only the last five count');
  });

  test('the topic state: under an even chance starts at the strategy; a provisional estimate or a mastered topic does not', () => {
    const p = plan([], { state: 'in-progress', provisional: false, pRight: 0.4 });
    assert.equal(kinds(p), 'strategy,worked');
    assert.equal(p.why, WHY.state);
    assert.equal(kinds(plan([], { state: 'not-sure', provisional: true, pRight: null })), 'nudge,strategy,worked');
    assert.equal(kinds(plan([], { state: 'mastered', provisional: false, pRight: 0.9 })), 'nudge,strategy,worked');
  });

  test('a self-test\'s and Get Ready\'s attempts are never read: their results may not be out', () => {
    assert.equal(kinds(plan([att({ chose: 1, mode: 'exam' })])), 'nudge,strategy,worked', 'no feedback first from a self-test answer');
    assert.equal(kinds(plan([att({ hints: 0, mode: 'getready' }), att({ mode: 'getready' }), att({ mode: 'getready' })])), 'nudge,strategy,worked');
    for (const mode of ['review', 'lesson']) assert.equal(kinds(plan([att({ chose: 1, mode })])), 'feedback,strategy,worked', mode);
  });

  test('a ladder too short to start where the rule says offers its deepest step; never more than three hints', () => {
    const onlyNudge = servableLadder(q, [{ _id: 'h1', step: 1, text: 'Think about repeats.', status: 'approved', provenance: 'ai' }]);
    const p = planHints({ question: q, ladder: onlyNudge, feedback: [], history: [att({ hints: 1 })], seedOf });
    assert.equal(kinds(p), 'nudge');
    assert.equal(p.why, WHY.deepest);
    assert.equal(kinds(planHints({ question: q, ladder: onlyNudge, feedback, history: [att({ chose: 1 })], seedOf })), 'feedback,nudge');
    assert.equal(planHints({ question: q, ladder: [], feedback: [], history: [] }).items.length, 0);
    assert.equal(planHints({ question: q, ladder: [], feedback: [], history: [] }).why, WHY.none);
    assert.ok(plan([att({ chose: 1 })]).items.length <= MAX_HINTS);
  });

  test('only approved hints and feedback are on offer, and none that holds the answer now', () => {
    const rows = [
      { _id: 'h1', step: 1, text: 'Think about repeats.', status: 'draft', provenance: 'ai' },
      { _id: 'h2', step: 2, text: 'Check the brackets.', status: 'approved', provenance: 'ai' },
      { _id: 'h3', step: 3, text: 'So it is {1, 2}.', status: 'approved', provenance: 'professor' },
    ];
    assert.deepEqual(servableLadder(q, rows).map((h) => h.step), [2]);
    const fb = [
      { _id: 'f1', option: '{1, 1}', optionKey: '{1, 1}', text: 'Repeats.', status: 'draft', provenance: 'ai' },
      { _id: 'f2', option: '{1, 2}', optionKey: '{1, 2}', text: 'On the right answer.', status: 'approved', provenance: 'professor' },
      { _id: 'f3', option: 'gone', optionKey: 'gone', text: 'An option reworded since.', status: 'approved', provenance: 'professor' },
      { _id: 'f4', option: '[1, 2]', optionKey: '[1, 2]', text: 'Square brackets make a list.', status: 'approved', provenance: 'professor' },
    ];
    assert.deepEqual(servableFeedback(q, fb).map((f) => f.id), ['f4']);
    assert.deepEqual(feedbackOptions(q).map((o) => o.optionIdx), [1, 2, 3]);
    assert.deepEqual(feedbackOptions({ kind: 'truefalse', answerBool: true }).map((o) => o.option), ['False']);
    assert.deepEqual(feedbackOptions({ kind: 'numeric', value: 3 }), []);
  });
});

/* ------------------------------------------------------- over a store -- */

/** PROF's class with Asha on it, a deck placed with two topics, and questions on Sets. */
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
  const [sets] = await repo.listChapterTopics(content._id);
  const [q, num, tf] = await repo.insertQuestions([
    { topic: 'Sets', text: 'Which of these is a set?', kind: 'mcq', options: ['{1, 2}', '{1, 1}', '(1, 2)', '[1, 2]'], answerIdx: 0, bloom: 'remember' },
    { topic: 'Sets', text: 'How many elements has {1, 2, 3}?', kind: 'numeric', value: 3, tolerance: 0, bloom: 'apply' },
    { topic: 'Sets', text: 'Every set holds some element twice.', kind: 'truefalse', answerBool: false, bloom: 'understand' },
  ].map((x) => ({ ...x, contentId: content._id, status: 'active', source: 'teacher' })));
  const ladder = async (question, status = 'approved', provenance = 'professor') => {
    const texts = ['Look again at slide 1: what may a set never do?', 'Check each choice for a repeat, then for its brackets.',
      '{1, 1} repeats 1; (1, 2) and [1, 2] use other brackets. One is left.'];
    for (const [i, text] of texts.entries()) {
      await repo.addQuestionHint({
        questionId: String(question._id), step: i + 1, text, provenance, status, model: provenance === 'ai' ? 'stand-in' : null,
        sourceRef: { kind: 'slides', slides: [1] }, ...(status === 'approved' ? { approvedAt: iso(0), approvedBy: PROF } : {}),
      });
    }
  };
  return { repo, cls, content, sets, q, num, tf, ladder };
}

describe('the hint hook: never in a self-test or Get Ready (tested against the mode values)', () => {
  test('the modes', () => {
    assert.deepEqual([...HINT_MODES], ['practice', 'review', 'lesson']);
    assert.deepEqual([...NO_HINT_MODES], ['exam', 'getready']);
    assert.ok(NO_HINT_MODES.every((m) => !HINT_MODES.includes(m)));
  });

  test('hints offered: none in exam or getready; the plan\'s count in practice, review and lessons', async () => {
    const { repo, sets, q, ladder } = await fixture();
    await ladder(q);
    for (const mode of NO_HINT_MODES) {
      const out = await hintsOffered(repo, { account: asha, question: q, topicId: sets._id, mode });
      assert.equal(out.available, 0, mode);
      assert.match(out.note, mode === 'exam' ? /No hints in a self-test/ : /No hints in Get Ready/);
    }
    for (const mode of HINT_MODES) assert.equal((await hintsOffered(repo, { account: asha, question: q, topicId: sets._id, mode })).available, 3, mode);
  });

  test('hints used: 0 in exam or getready even with hints recorded under that attempt id; counted otherwise, per question', async () => {
    const { repo, sets, q, num, ladder } = await fixture();
    await ladder(q);
    await serveHint(repo, { account: asha, question: q, topicId: sets._id, mode: 'practice', attemptId: 'attempt-0001' });
    await serveHint(repo, { account: asha, question: q, topicId: sets._id, mode: 'practice', attemptId: 'attempt-0001' });
    for (const mode of NO_HINT_MODES) assert.equal(await hintsUsedOn(repo, { account: asha, questionId: q._id, attemptId: 'attempt-0001', mode }), 0, mode);
    assert.equal(await hintsUsedOn(repo, { account: asha, questionId: q._id, attemptId: 'attempt-0001', mode: 'practice' }), 2);
    assert.equal(await hintsUsedOn(repo, { account: asha, questionId: num._id, attemptId: 'attempt-0001', mode: 'practice' }), 0, 'another question');
    assert.equal(await hintsUsedOn(repo, { account: asha, questionId: q._id, attemptId: 'x', mode: 'practice' }), 0, 'no usable attempt id');
    assert.equal(await hintsUsedOn({ listHintViews: async () => { throw new Error('no table'); } },
      { account: asha, questionId: q._id, attemptId: 'attempt-0001', mode: 'practice' }), 0, 'never a reason to refuse the answer');
    await assert.rejects(serveHint(repo, { account: asha, question: q, topicId: sets._id, mode: 'exam', attemptId: 'attempt-0002' }),
      (err) => err.status === 400 && /self-test/.test(err.message));
    await assert.rejects(serveHint(repo, { account: asha, question: q, topicId: sets._id, mode: 'getready', attemptId: 'attempt-0003' }),
      (err) => err.status === 400 && /Get Ready/.test(err.message));
    assert.equal((await repo.listHintViews({ accountId: asha.id })).length, 2, 'nothing recorded for the refused modes');
  });

  test('staff\'s activity counts carry the hints opened, as counts only', () => {
    const rows = [{ hintsUsed: 2, createdAt: iso(0), mode: 'practice' }, { hintsUsed: 0, createdAt: iso(1), mode: 'exam' }, { hintsUsed: 1, createdAt: iso(2), mode: 'lesson' }];
    const a = activityOf(rows, new Date(iso(10)));
    assert.deepEqual([a.hintsUsed, a.attemptsWithHints, a.total], [3, 2, 3]);
  });
});

describe('serving hints: approval gating, one at a time, recorded, never the answer', () => {
  test('drafts reach no student; once approved, the ladder in order, each with its slides, recorded', async () => {
    const { repo, sets, q, ladder } = await fixture();
    await ladder(q, 'draft', 'ai');
    assert.equal((await hintsOffered(repo, { account: asha, question: q, topicId: sets._id })).available, 0);
    const none = await serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0001' });
    assert.equal(none.body.hint, null);
    assert.equal(none.body.message, WHY.none);
    assert.equal((await repo.listHintViews({})).length, 0);

    for (const h of await repo.listQuestionHints([String(q._id)])) await repo.updateQuestionHint(h._id, { status: 'approved', approvedAt: iso(1), approvedBy: PROF });
    const first = await serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0001' });
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.hint.position, first.body.hint.kind, first.body.hint.label, first.body.hint.cite, first.body.hint.by],
      [1, 'nudge', 'A nudge', 'Slide 1', 'ai']);
    assert.equal(first.body.hint.byLabel, 'Written with AI help and checked by your professor.');
    assert.deepEqual([first.body.hintsUsed, first.body.remaining], [1, 2]);
    assert.ok(!KEYS.test(JSON.stringify(first.body)), 'no key, no solution, no explanation');
    const [view] = await repo.listHintViews({ accountId: asha.id });
    assert.deepEqual([view.mode, view.position, view.kind, view.clientAttemptId, view.language, view.questionId, view.topicId],
      ['practice', 1, 'nudge', 'attempt-0001', 'en', String(q._id), String(sets._id)]);
    assert.deepEqual(view.plan.items.map((i) => i.kind), ['nudge', 'strategy', 'worked']);

    const second = await serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0001' });
    assert.equal(second.body.hint.kind, 'strategy');
    const again = await serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0001', step: 1 });
    assert.deepEqual([again.status, again.body.duplicate, again.body.hint.kind], [200, true, 'nudge']);
    await assert.rejects(serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0001', step: 3 + 1 }), (err) => err.status === 400);
    const third = await serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0001', step: 3 });
    assert.deepEqual([third.status, third.body.hint.kind, third.body.remaining], [201, 'worked', 0]);
    const done = await serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0001' });
    assert.deepEqual([done.body.hint, done.body.hintsUsed], [null, 3]);
    assert.equal((await repo.listHintViews({ accountId: asha.id })).length, 3, 'asking again records nothing new');
    const reload = await shownHints(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0001' });
    assert.deepEqual(reload.hints.map((h) => h.kind), ['nudge', 'strategy', 'worked']);
    assert.equal(reload.remaining, 0);
  });

  test('the attempt records the hints opened; then its hints are closed, and an attempt id is one question\'s', async () => {
    const { repo, sets, q, num, ladder } = await fixture();
    await ladder(q);
    await serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0007' });
    await assert.rejects(serveHint(repo, { account: asha, question: num, topicId: sets._id, attemptId: 'attempt-0007' }),
      (err) => err.status === 409 && /another question/.test(err.message));
    const hintsUsed = await hintsUsedOn(repo, { account: asha, questionId: String(q._id), attemptId: 'attempt-0007', mode: 'practice' });
    const { attempt } = await recordAttempt(repo, asha, { attemptId: 'attempt-0007', questionId: String(q._id), topicId: String(sets._id), response: 1 }, { hintsUsed });
    assert.equal(attempt.hintsUsed, 1);
    await assert.rejects(serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0007' }),
      (err) => err.status === 409 && /answered already/.test(err.message));
  });

  test('a hint that would give the answer away after the key changed is not shown, and staff are told', async () => {
    const { repo, sets, q, ladder } = await fixture();
    await ladder(q);
    // The professor makes [1, 2] the key: hint 3 names it now.
    await repo.updateQuestion(q._id, { options: ['{1, 2}', '{1, 1}', '(1, 2)', '[1, 2]'], answerIdx: 3 });
    const changed = await repo.getQuestion(q._id);
    assert.equal((await hintsOffered(repo, { account: asha, question: changed, topicId: sets._id })).available, 2);
    const staff = await staffQuestionTutor(changed, { hints: await repo.listQuestionHints([String(q._id)]) });
    assert.match(staff.hints[2].leak, /^Students are not shown this hint\. It gives the answer away: it names the right option, "\[1, 2\]"\./);
    assert.equal(staff.counts.shownToStudents, 2);
  });

  // The client session's ask of 19 Nov 2026: the staff queue sent the stem and the
  // options as plain text only, so a formula showed as its TeX source there.
  test('staff read the stem, its topic, each wrong option and its feedback as HTML too, beside the plain text', async () => {
    const { repo, q } = await fixture();
    await repo.updateQuestion(q._id, {
      text: 'Which of these is the set $\\{1, 2\\}$?', topic: 'Sets of $n$ elements', options: ['$\\{1, 2\\}$', '$\\{1, 1\\}$', '(1, 2)', '[1, 2]'], answerIdx: 0,
    });
    const changed = await repo.getQuestion(q._id);
    await repo.addOptionFeedback({ questionId: String(q._id), option: '$\\{1, 1\\}$', optionKey: '$\\{1, 1\\}$', text: 'Count each element of $\\{1, 1\\}$ once.',
      provenance: 'professor', status: 'approved', approvedAt: iso(0) });
    await repo.addOptionFeedback({ questionId: String(q._id), option: '$x$', optionKey: '$x$', text: 'An option that is gone.', provenance: 'professor', status: 'approved' });
    const staff = await staffQuestionTutor(changed, { feedback: await repo.listOptionFeedback([String(q._id)]) });
    assert.equal(staff.text, changed.text);
    assert.match(staff.textHtml, /<math/);
    assert.doesNotMatch(staff.textHtml, /\$/);
    assert.match(staff.topicHtml, /<math/);
    assert.deepEqual(staff.options.map((o) => o.option), ['$\\{1, 1\\}$', '(1, 2)', '[1, 2]']);
    assert.match(staff.options[0].optionHtml, /<math/);
    assert.equal(staff.options[1].optionHtml, '(1, 2)');
    assert.match(staff.options[0].feedback.optionHtml, /<math/);
    assert.match(staff.options[0].feedback.textHtml, /<math/);
    // Feedback whose option is gone still says which option it was written on.
    assert.equal(staff.noLongerShown.length, 1);
    assert.match(staff.noLongerShown[0].optionHtml, /<math/);
  });

  test('feedback on the option chosen: after the attempt; and first, in place of the nudge, when the question comes back', async () => {
    const { repo, sets, q, ladder } = await fixture();
    await ladder(q);
    await repo.addOptionFeedback({ questionId: String(q._id), option: '{1, 1}', optionKey: '{1, 1}', text: 'A set holds each element once, so {1, 1} is the set {1}.',
      provenance: 'professor', status: 'approved', approvedAt: iso(0), sourceRef: { kind: 'slides', slides: [2] } });
    await repo.addOptionFeedback({ questionId: String(q._id), option: '(1, 2)', optionKey: '(1, 2)', text: 'Round brackets write an ordered pair.',
      provenance: 'ai', status: 'draft', model: 'stand-in' });
    const { attempt, entry } = await recordAttempt(repo, asha, { attemptId: 'attempt-0101', questionId: String(q._id), topicId: String(sets._id), response: 1 });
    const told = await feedbackFor(repo, asha, attempt, { entry });
    assert.equal(told.correct, false);
    assert.deepEqual(told.optionFeedback.map((f) => [f.option, f.cite, f.by]), [['{1, 1}', 'Slide 2', 'professor']]);
    const draftOnly = await recordAttempt(repo, asha, { attemptId: 'attempt-0102', questionId: String(q._id), topicId: String(sets._id), response: 2 });
    assert.deepEqual(await feedbackAfter(repo, { account: asha, attempt: draftOnly.attempt }), [], 'a draft never reaches a student');
    const right = await recordAttempt(repo, asha, { attemptId: 'attempt-0103', questionId: String(q._id), topicId: String(sets._id), response: 0 });
    assert.deepEqual(await optionFeedbackAfter(repo, { account: asha, attempt: right.attempt }), []);

    // Back to the attempt that chose {1, 1}: rebuild Asha's history with only it.
    const fresh = await fixture();
    await fresh.ladder(fresh.q);
    await fresh.repo.addOptionFeedback({ questionId: String(fresh.q._id), option: '{1, 1}', optionKey: '{1, 1}', text: 'A set holds each element once.',
      provenance: 'professor', status: 'approved', approvedAt: iso(0) });
    await recordAttempt(fresh.repo, asha, { attemptId: 'attempt-0201', questionId: String(fresh.q._id), topicId: String(fresh.sets._id), response: 1 });
    const hint = await serveHint(fresh.repo, { account: asha, question: fresh.q, topicId: fresh.sets._id, attemptId: 'attempt-0202' });
    assert.deepEqual([hint.body.hint.kind, hint.body.hint.label, hint.body.why], ['feedback', 'About the option you chose last time', WHY.feedback]);
    const next = await serveHint(fresh.repo, { account: asha, question: fresh.q, topicId: fresh.sets._id, attemptId: 'attempt-0202' });
    assert.equal(next.body.hint.kind, 'strategy');
  });

  test('the next question says how many hints there are; never in a self-test', async () => {
    const { repo, sets, q, num, tf, ladder } = await fixture();
    for (const x of [q, num, tf]) await ladder(x);
    const next = await nextQuestion(repo, asha, { topicIds: String(sets._id) });
    assert.equal(next.hints.available, 3);
    assert.ok(!KEYS.test(JSON.stringify(next.hints)));
  });

  test('a Hindi translation of a hint is shown when approved and current, and never when it holds the answer', async () => {
    const { repo, content, sets, q, ladder } = await fixture();
    await ladder(q);
    await repo.setLanguageChoice(asha.id, 'hi');
    const [nudge, strategy] = await repo.listQuestionHints([String(q._id)]);
    const add = async (row, words) => {
      const english = fieldsOf('hint', row);
      const t = await repo.addItemTranslation({
        itemKind: 'hint', itemId: row._id, contentId: content._id, ownerId: PROF, language: 'hi', fields: { hint: words },
        sourceFields: english, sourceHash: sourceHash(english), provenance: 'professor', model: null, checks: [],
      });
      return repo.approveItemTranslation(t._id, { by: PROF });
    };
    await add(nudge, 'स्लाइड 1 फिर से देखें: एक set क्या कभी नहीं करता?');
    await add(strategy, 'उत्तर {1, 2} है।');
    const first = await serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0301' });
    assert.deepEqual([first.body.hint.language, /स्लाइड/.test(first.body.hint.text)], ['hi', true]);
    const second = await serveHint(repo, { account: asha, question: q, topicId: sets._id, attemptId: 'attempt-0301' });
    assert.deepEqual([second.body.hint.language, second.body.hint.text], ['en', strategy.text]);
    assert.match(second.body.hint.languageNote, /not in Hindi yet/);
    const [, v2] = await repo.listHintViews({ accountId: asha.id });
    assert.deepEqual([v2.language, v2.text], ['en', strategy.text], 'what was shown is what is recorded');
  });
});

/* ------------------------------------------------------------ the model -- */

describe('the model\'s drafts: fixture replies through the real parser', () => {
  const q = { _id: 'qa', topic: 'Sets', kind: 'mcq', text: 'Which of these is a set?', options: ['{1, 2}', '{1, 1}', '(1, 2)', '[1, 2]'], answerIdx: 0, bloom: 'remember',
    status: 'active', sourceRef: { kind: 'slides', slides: [1, 2] } };
  const tf = { _id: 'qb', topic: 'Sets', kind: 'truefalse', text: 'Every set holds some element twice.', answerBool: false, bloom: 'understand', status: 'active' };
  const content = { _id: 'c1', title: 'Sets', topicSlides: { Sets: [1, 2] }, slideTexts: [{ slide: 1, text: 'A set holds each element once.' }, { slide: 2, text: 'Braces write a set.' }] };
  const input = () => tutorInput([
    { question: q, content, want: { steps: [1, 2, 3], options: [1, 2, 3] } },
    { question: tf, content, want: { steps: [1], options: [0] } },
  ]);

  test('the prompt carries each question with its key, its own slides and what to write, and forbids the answer', () => {
    const prompt = buildTutorPrompt(input());
    assert.match(prompt, /Q1 \| topic: Sets \| slides: 1, 2/);
    assert.match(prompt, /"answerIdx":0/);
    assert.match(prompt, /write: hints 1, 2, 3; feedback for options 1, 2, 3 \(numbered from 0\)/);
    assert.match(prompt, /write: hints 1; feedback for options 0 \(numbered from 0; 0 is True, 1 is False\)/);
    assert.match(prompt, /A set holds each element once\./);
    assert.match(prompt, /never say which option is right/);
  });

  test('the parser keeps only what the rules allow, and names every refusal', () => {
    const reply = JSON.stringify({
      items: [
        {
          question: 'q1',
          hints: [
            { step: 1, text: 'What may a set never hold twice?', slides: [1, 9] },
            { step: 2, text: 'The answer is {1, 2}.', slides: [1] },
            { step: 2, text: 'Check each choice for repeats, then brackets.', slides: [] },
            { step: 4, text: 'A fourth step.' },
            { step: 3, text: 'x'.repeat(MAX_MODEL_TEXT + 1) },
          ],
          feedback: [
            { option: 1, text: '{1, 1} repeats an element, so it is the set {1}.', slides: [2] },
            { option: 0, text: 'On the right answer.' },
            { option: 2, text: 'Round brackets write an ordered pair. Mail a@b.co' },
            { option: 1, text: 'A second note on the same option.' },
          ],
        },
        { question: 'Q2', hints: [{ step: 1, text: 'Think of {1, 2}: does any element appear twice?' }], feedback: [{ text: 'A set never holds an element twice.' }] },
        { question: 'Q9', hints: [{ step: 1, text: 'Not offered.' }] },
      ],
    });
    const out = parseTutorReply(reply, input());
    assert.deepEqual(out.hints.map((h) => [h.questionId, h.step, h.sourceRef?.slides]), [['qa', 1, [1]], ['qa', 2, [1, 2]], ['qb', 1, [1, 2]]]);
    assert.deepEqual(out.feedback.map((f) => [f.questionId, f.option, f.optionKey]), [['qa', '{1, 1}', '{1, 1}'], ['qb', 'True', 'true']]);
    const why = out.skipped.map((s) => `${s.questionId}|${s.what}|${s.why}`);
    assert.ok(why.some((w) => /^qa\|hint 2\|the hint gave the answer away \(it names the right option, "\{1, 2\}"\)$/.test(w)), why.join('\n'));
    assert.ok(why.some((w) => /^qa\|hint\|it named a step other than 1, 2 or 3$/.test(w)));
    assert.ok(why.some((w) => /^qa\|hint 3\|it was longer than 300 characters$/.test(w)));
    assert.ok(why.some((w) => /^qa\|feedback on option 1\|it was not on a wrong option/.test(w)));
    assert.ok(why.some((w) => /^qa\|feedback on option 3\|it held an email address/.test(w)));
    assert.ok(why.some((w) => /^qa\|feedback on option 2\|it was written twice/.test(w)));
    assert.ok(why.some((w) => /^null\|question\|it named a question that was not offered$/.test(w)));
    assert.throws(() => parseTutorReply('not json', input()), /not JSON/);
    assert.throws(() => parseTutorReply('{"x": 1}', input()), /no list of items/);
  });

  test('a step or option already written is not asked for, and not taken if the model writes it anyway', () => {
    assert.deepEqual(wantedFor(q, { hints: [{ step: 1 }], feedback: [{ optionKey: '{1, 1}' }] }), { steps: [2, 3], options: [2, 3] });
    const only = tutorInput([{ question: q, content, want: { steps: [3], options: [] } }]);
    const out = parseTutorReply(JSON.stringify({ items: [{ question: 'Q1', hints: [{ step: 1, text: 'What may a set never hold twice?' }] }] }), only);
    assert.equal(out.hints.length, 0);
    assert.match(out.skipped[0].why, /not asked for/);
  });

  test('offline: no model key, no drafts, and the note says so', async () => {
    const out = await draftTutor({ items: [{ question: q, content }] });
    assert.deepEqual([out.source, out.hints.length, out.feedback.length, out.note], ['offline', 0, 0, OFFLINE_NOTE]);
  });

  test('a stand-in model: batches, and a failed batch is a warning, not a failure', async () => {
    const items = Array.from({ length: BATCH + 1 }, (_, i) => ({ question: { ...q, _id: `q${i}` }, content, want: { steps: [1], options: [] } }));
    let calls = 0;
    const out = await draftTutor({
      items,
      callModel: async () => {
        calls += 1;
        if (calls === 2) throw new Error('quota');
        return JSON.stringify({ items: Array.from({ length: BATCH }, (_, i) => ({ question: `Q${i + 1}`, hints: [{ step: 1, text: 'What may a set never hold twice?' }] })) });
      },
    });
    assert.equal(calls, 2);
    assert.equal(out.hints.length, BATCH);
    assert.match(out.warnings[0], /could not draft hints for one question: quota/);
  });

  test('drafts are stored as AI drafts; what was written meanwhile is kept', async () => {
    const { repo, content: deck, q: real } = await fixture();
    await repo.addQuestionHint({ questionId: String(real._id), step: 2, text: 'My own strategy.', provenance: 'professor', status: 'approved', approvedAt: iso(0) });
    const out = await writeTutorDrafts(repo, {
      items: [{ question: real, content: deck }],
      viewer: { id: PROF },
      callModel: async (prompt) => {
        assert.match(prompt, /write: hints 1, 3; feedback for options 1, 2, 3/);
        return JSON.stringify({ items: [{ question: 'Q1', hints: [{ step: 1, text: 'What may a set never hold twice?' }, { step: 3, text: 'Rule out the repeat first.' }],
          feedback: [{ option: 3, text: 'Square brackets write a list, not a set.' }] }] });
      },
    });
    assert.equal(out.written, 3);
    const hints = await repo.listQuestionHints([String(real._id)]);
    assert.deepEqual(hints.map((h) => [h.step, h.provenance, h.status, h.model]).sort(),
      [[1, 'ai', 'draft', 'stand-in'], [2, 'professor', 'approved', null], [3, 'ai', 'draft', 'stand-in']]);
    const [fb] = await repo.listOptionFeedback([String(real._id)]);
    assert.deepEqual([fb.option, fb.status, fb.createdBy], ['[1, 2]', 'draft', PROF]);
  });
});

/* -------------------------------------------------------- translations -- */

describe('hints and feedback are translated in the generic shape', () => {
  test('each is an item named by its own id, whose one field is its words; feedback whose option is gone is not listed', async () => {
    const { repo, content, q, ladder } = await fixture();
    await ladder(q);
    await repo.addOptionFeedback({ questionId: String(q._id), option: '{1, 1}', optionKey: '{1, 1}', text: 'Repeats.', provenance: 'ai', status: 'draft' });
    await repo.addOptionFeedback({ questionId: String(q._id), option: 'old', optionKey: 'old', text: 'An option reworded since.', provenance: 'ai', status: 'draft' });
    const [h] = await repo.listQuestionHints([String(q._id)]);
    const loaded = await translatable('hint').load(repo, h._id);
    assert.equal(String(loaded.contentId), String(content._id));
    assert.deepEqual(fieldsOf('hint', loaded), { hint: h.text });
    const items = await tutorTranslationItems(repo, [q]);
    assert.deepEqual(items.map((i) => i.kind).sort(), ['feedback', 'hint', 'hint', 'hint']);
    assert.deepEqual(fieldsOf('feedback', items.find((i) => i.kind === 'feedback').item), { feedback: 'Repeats.' });
  });
});

/* ------------------------------------------------------------ the repos -- */

describe('the repos (0029)', () => {
  test('in-process: one hint per step, one feedback per option, hint views once per position and never changed', async () => {
    const repo = createMemoryRepo();
    const h = await repo.addQuestionHint({ questionId: 'q1', step: 1, text: 'a', provenance: 'ai', status: 'draft' });
    await assert.rejects(repo.addQuestionHint({ questionId: 'q1', step: 1, text: 'b', provenance: 'professor', status: 'approved' }), (err) => err.status === 409);
    const up = await repo.updateQuestionHint(h._id, { status: 'approved', approvedAt: iso(0), step: 3, questionId: 'other' });
    assert.deepEqual([up.status, up.step, up.questionId], ['approved', 1, 'q1']);
    await repo.addOptionFeedback({ questionId: 'q1', option: 'X', optionKey: 'x', text: 'a', provenance: 'ai', status: 'draft' });
    await assert.rejects(repo.addOptionFeedback({ questionId: 'q1', option: 'x ', optionKey: 'x', text: 'b', provenance: 'ai', status: 'draft' }), (err) => err.status === 409);
    assert.equal((await repo.listOptionFeedback(['q1', 'q2'])).length, 1);
    const base = { accountId: 's1', clientAttemptId: 'aaaaaaaa', questionId: 'q1', mode: 'practice', kind: 'nudge', text: 't', provenance: 'ai' };
    const a = await repo.addHintView({ ...base, position: 1, createdAt: iso(1) });
    const b = await repo.addHintView({ ...base, position: 2, kind: 'strategy', createdAt: iso(0) });
    const dup = await repo.addHintView({ ...base, position: 1, kind: 'worked', createdAt: iso(5) });
    assert.deepEqual([a.duplicate, b.duplicate, dup.duplicate, dup.view._id, dup.view.kind], [false, false, true, a.view._id, 'nudge']);
    assert.deepEqual((await repo.listHintViews({ accountId: 's1' })).map((v) => v.position), [2, 1]);
    assert.equal((await repo.listHintViews({ questionIds: [] })).length, 0);
    assert.equal((await repo.listHintViews({ clientAttemptId: 'bbbbbbbb' })).length, 0);
    assert.equal(typeof repo.updateHintView, 'undefined', 'no method changes a hint view');
    assert.equal(await repo.deleteQuestionHint(h._id), true);
    assert.equal(await repo.getQuestionHint(h._id), null);
  });

  test('Supabase: a hint view is inserted with its plan; a 23505 answers with the stored row; a second hint for a step is a 409', async () => {
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const row = { id: '11111111-1111-4111-8111-111111111111', account_id: '22222222-2222-4222-8222-222222222222', client_attempt_id: 'aaaaaaaa',
      mode: 'practice', position: 1, kind: 'nudge', text: 't', provenance: 'ai', language: 'en', plan: { items: [] }, created_at: '2026-11-19T10:00:00+00:00' };
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input.url ?? input));
      seen.push({ url, method: init.method ?? 'GET', body: init.body });
      if ((init.method ?? 'GET') === 'POST') {
        return new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint' }), { status: 409, headers: { 'content-type': 'application/json' } });
      }
      if (url.searchParams.get('position')) return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      const out = await repo.addHintView({ accountId: row.account_id, clientAttemptId: 'aaaaaaaa', mode: 'practice', position: 1, kind: 'nudge', text: 't',
        provenance: 'ai', plan: { items: [{ kind: 'nudge' }] } });
      assert.equal(seen[0].url.pathname, '/rest/v1/hub_hint_views');
      assert.deepEqual(JSON.parse(seen[0].body).plan, { items: [{ kind: 'nudge' }] });
      assert.deepEqual([out.duplicate, out.view._id, out.view.position, out.view.accountId], [true, row.id, 1, row.account_id]);
      await assert.rejects(repo.addQuestionHint({ questionId: row.id, step: 1, text: 'x', provenance: 'ai', status: 'draft' }), (err) => err.status === 409);
      seen.length = 0;
      assert.deepEqual(await repo.listHintViews({ questionIds: ['not-a-uuid'] }), []);
      assert.equal(seen.length, 0, 'nothing is asked for ids no row can have');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });
});
