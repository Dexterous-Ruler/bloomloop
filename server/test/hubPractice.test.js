// Phase 6: practice in the Learning Hub, Elo mastery, the error log, spaced
// review and explanations (decisions H5 to H8, H14, H17).
//
// Pinned here: the Elo model worked by hand (Pelánek 2016's update with its
// uncertainty function, item ratings seeded from the Bloom level, first
// attempts only); the topic states' thresholds and the N each carries; the
// session-to-rating mapping and FSRS due dates against a fixed clock; weekly
// consistency with rest days and no streak; the error log opening and clearing;
// a resent attempt id making one row; no key or explanation before an attempt
// and never a draft; hub attempts leaving rooms, attainment and the register
// exactly as they were; the model's explanations parsed from fixture replies
// through the real parser, and none offline; the repos' side of the contract.
// End to end, over HTTP, in scripts/practice.mjs. Never calls Gemini, Supabase
// or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { syncTopics } from '../src/services/hubTopics.js';
import {
  ALPHA, BETA, ITEM_SEED, MASTERY_P, pRight, replayTopic, seedFor, topicState, typicalDifficulty, uncertaintyK,
} from '../src/services/hubElo.js';
import {
  RATING_CUTS, SESSION_GAP_MINUTES, addDays, ratingFor, reviewState, sessionsOf, weekStart, weeklyConsistency,
} from '../src/services/hubReview.js';
import { buildErrorLog, openByTopic } from '../src/services/hubErrors.js';
import {
  NO_QUESTION, chooseNext, cleanAttemptId, feedbackFor, nextQuestion, onceServable, practisable, recordAttempt, studentScope,
} from '../src/services/hubPractice.js';
import {
  LEVELS_MONTH_DAYS, activityOf, bloomLevelsFor, classProgress, dueList, errorLogFor, levelFigures, rosterAccounts, studentProgress,
  studentProgressForStaff,
} from '../src/services/hubProgress.js';
import {
  BATCH, MAX_MODEL_EXPLANATION, OFFLINE_NOTE, buildExplanationPrompt, draftExplanations, explanationForStudent, explanationInput,
  explanationText, parseExplanations,
} from '../src/services/hubExplanations.js';
import { hintsOffered, hintsUsedOn } from '../src/services/hubHintHook.js';
import { classAttainment, formulaOf, marksRegister, readAttainmentInputs } from '../src/services/attainment.js';

// The model is never called here: explanations are parsed from fixture replies.
config.gemini.apiKey = '';

const PROF = 'a0000000-0000-4000-8000-00000000000a';
const OTHER_PROF = 'b0000000-0000-4000-8000-00000000000b';
const T0 = new Date('2026-11-19T10:00:00.000Z');
const at = (minutes) => new Date(T0.getTime() + minutes * 60000);
const iso = (minutes) => at(minutes).toISOString();
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const asha = { id: 'acc-asha', role: 'student', reportsTo: PROF, rollNo: '21cs01', active: true };
const bilal = { id: 'acc-bilal', role: 'student', reportsTo: PROF, rollNo: '21CS02', active: true };
const stranger = { id: 'acc-omar', role: 'student', reportsTo: OTHER_PROF, rollNo: '21CS01', active: true };

const mcq = (topic, bloom, text, extra = {}) => ({
  topic, text, kind: 'mcq', options: ['right', 'wrong a', 'wrong b', 'wrong c'], answerIdx: 0, bloom, status: 'active', source: 'teacher', ...extra,
});

/** Professor PROF's class with Asha and Bilal on it, one chapter placed, questions on two topics. */
async function fixture() {
  const repo = createMemoryRepo();
  const cls = await repo.createClass({ courseName: 'Networks', section: 'A', ownerId: PROF });
  await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }, { rollNo: '21CS02', name: 'Bilal' }]);
  const content = await repo.createContent({ title: 'Layers', kind: 'syllabus', rawText: 'Framing splits bits. Routing picks paths.', topics: ['Framing', 'Routing'], ownerId: PROF });
  await syncTopics(repo, content);
  await repo.placeClassChapter({ classId: cls._id, contentId: content._id, unitId: null, position: 1 });
  const [framing, routing] = await repo.listChapterTopics(content._id);
  const qs = await repo.insertQuestions([
    mcq('Framing', 'remember', 'F remember?'),
    mcq('Framing', 'apply', 'F apply?'),
    mcq('Framing', 'analyse', 'F analyse?'),
    mcq('Framing', 'evaluate', 'F evaluate?'),
    mcq('Routing', 'understand', 'R understand?'),
    // Never practised: a poll, a draft, a question showing an uploaded image.
    { topic: 'Framing', text: 'Which do you prefer?', kind: 'poll', options: ['a', 'b'], bloom: 'remember', status: 'active', source: 'teacher' },
    mcq('Framing', 'apply', 'F draft?', { status: 'draft', model: 'm', source: 'llm' }),
    mcq('Framing', 'apply', 'F image?', { stimulus: { kind: 'image', url: '/api/media/x', alt: 'a diagram' } }),
  ].map((q) => ({ ...q, contentId: content._id })));
  const by = Object.fromEntries(qs.map((q) => [q.text, q]));
  return { repo, cls, content, framing, routing, by };
}

const attempt = (over = {}) => ({ _id: `x${Math.random()}`, accountId: 'acc-asha', topicId: 't1', questionId: 'q1', bloom: 'apply', correct: true, createdAt: iso(0), ...over });

/* ------------------------------------------------------------------ Elo -- */

describe('Elo mastery (H6), worked by hand', () => {
  test('the uncertainty function and the logistic chance', () => {
    assert.equal(ALPHA, 1);
    assert.equal(BETA, 0.05);
    assert.equal(uncertaintyK(0), 1);
    assert.equal(uncertaintyK(20), 0.5);
    assert.ok(close(uncertaintyK(1), 1 / 1.05));
    assert.equal(pRight(0, 0), 0.5);
    assert.ok(close(pRight(0, -0.25), 1 / (1 + Math.exp(-0.25))));
  });

  test('item ratings start from the Bloom level, Remember easiest', () => {
    assert.deepEqual(Object.keys(ITEM_SEED), ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create']);
    assert.equal(seedFor('remember'), -1.25);
    assert.equal(seedFor('create'), 1.25);
    assert.equal(seedFor('analyze'), 0, 'an unknown spelling starts in the middle');
  });

  test('one right, a repeat that counts for nothing, and a second student wrong', () => {
    const rows = [
      attempt({ _id: 'a1', createdAt: iso(0), correct: true }),
      attempt({ _id: 'a2', createdAt: iso(1), correct: false }), // Asha again at q1: not counted
      attempt({ _id: 'a3', accountId: 'acc-bilal', createdAt: iso(2), correct: false }),
    ];
    const { students, items, steps } = replayTopic(rows);
    // Asha: skill 0, difficulty -0.25 (apply). P = 1/(1+e^-0.25); K = 1.
    const p1 = 1 / (1 + Math.exp(-0.25));
    const skillA = 0 + 1 * (1 - p1);
    const diff1 = -0.25 - 1 * (1 - p1);
    // Bilal: skill 0 against diff1; his K = 1, the item's K = 1/(1 + 0.05).
    const p2 = 1 / (1 + Math.exp(-(0 - diff1)));
    const skillB = 0 + 1 * (0 - p2);
    const diff2 = diff1 - (1 / 1.05) * (0 - p2);
    assert.ok(close(students.get('acc-asha').skill, skillA));
    assert.equal(students.get('acc-asha').answers, 1, 'N counts first attempts only');
    assert.equal(students.get('acc-asha').attempts, 2, 'every attempt is still practice');
    assert.ok(close(students.get('acc-bilal').skill, skillB));
    assert.ok(close(items.get('q1').difficulty, diff2));
    assert.equal(items.get('q1').answers, 2);
    assert.deepEqual(steps.map((s) => s.counted), [true, false, true]);
    assert.ok(close(steps[0].expected, p1));
  });

  test('order is the server\'s: the same rows in any order replay the same', () => {
    const rows = [attempt({ _id: 'b', createdAt: iso(5), correct: false, questionId: 'q2' }), attempt({ _id: 'a', createdAt: iso(1) })];
    assert.deepEqual([...replayTopic(rows).students.values()], [...replayTopic([...rows].reverse()).students.values()]);
  });

  test('a deleted question is rated by the id its snapshot kept', () => {
    const { items } = replayTopic([attempt({ questionId: null, questionSnapshot: { id: 'gone' } })]);
    assert.ok(items.has('gone'));
  });

  test('the typical question is the median difficulty', () => {
    assert.equal(typicalDifficulty([]), 0);
    assert.equal(typicalDifficulty([3, -1, 1]), 1);
    assert.equal(typicalDifficulty([-1, 1, 3, 5]), 2);
  });
});

describe('topic states (H6): thresholds and N', () => {
  const mastery = Math.log(MASTERY_P / (1 - MASTERY_P)); // skill - typical where P = 0.8 exactly

  test('Not started, with N 0', () => {
    const s = topicState({});
    assert.equal(s.state, 'not-started');
    assert.equal(s.answers, 0);
    assert.match(s.sentence, /not practised/);
  });

  test('Not sure yet under 3 answers: provisional, no figure shown', () => {
    for (const n of [1, 2]) {
      const s = topicState({ answers: n, attempts: n, skill: 3 });
      assert.equal(s.state, 'not-sure');
      assert.equal(s.provisional, true);
      assert.equal(s.pRight, null);
      assert.equal(s.outOf10, null);
      assert.match(s.sentence, new RegExp(`rests on ${n} answer`));
    }
  });

  test('In progress from 3; Mastered needs P >= 0.8 AND at least 5 answers', () => {
    assert.equal(topicState({ answers: 3, skill: 0 }).state, 'in-progress');
    const four = topicState({ answers: 4, skill: mastery + 1 });
    assert.equal(four.state, 'in-progress', 'a high estimate on 4 answers is not yet mastered');
    assert.match(four.sentence, /at least 5 answers/);
    assert.equal(topicState({ answers: 5, skill: mastery + 1e-6 }).state, 'mastered');
    assert.equal(topicState({ answers: 5, skill: mastery - 1e-6 }).state, 'in-progress', 'just under 0.8 is not mastered');
    assert.equal(topicState({ answers: 9, skill: 2, typical: 2 }).state, 'in-progress', 'P 0.5 against the typical question');
  });

  test('the shown figure is rounded down, so it never reads higher than it is', () => {
    const s = topicState({ answers: 6, skill: Math.log(0.79 / 0.21) });
    assert.equal(s.outOf10, 7);
    assert.match(s.sentence, /about 7 in 10/);
  });

  test('Needs review comes first once a review is due, and still carries N and the estimate', () => {
    const s = topicState({ answers: 6, skill: 3, reviewDue: true });
    assert.equal(s.state, 'needs-review');
    assert.equal(s.estimateState, 'mastered');
    assert.equal(s.answers, 6);
    assert.match(s.sentence, /^Due for review/);
    assert.equal(topicState({ answers: 0, reviewDue: true }).state, 'not-started');
  });

  test('a student is spoken to; staff read about them; nobody is ranked', () => {
    const you = topicState({ answers: 4, skill: 0.2 });
    const them = topicState({ answers: 4, skill: 0.2 }, { audience: 'staff' });
    assert.match(you.sentence, /your 4 answers/);
    assert.match(them.sentence, /from 4 answers/);
    for (const s of [you, them]) assert.doesNotMatch(JSON.stringify(s), /\b(rank|ranked|average|slow|top|best|worst|percentile)\b/i);
  });
});

/* --------------------------------------------------------------- review -- */

describe('spaced review (H8): sessions, the rating mapping and due dates on a fixed clock', () => {
  test('a gap of 10 minutes starts a new session; a question counts once per session', () => {
    const rows = [
      attempt({ _id: 'a', createdAt: iso(0), correct: false }),
      attempt({ _id: 'b', createdAt: iso(1), correct: true }), // q1 again: not counted again
      attempt({ _id: 'c', createdAt: iso(9), questionId: 'q2', correct: true }),
      attempt({ _id: 'd', createdAt: iso(9 + SESSION_GAP_MINUTES), questionId: 'q3', correct: true }),
    ];
    const s = sessionsOf(rows);
    assert.equal(s.length, 2);
    assert.deepEqual([s[0].answers, s[0].right, s[0].endAt], [2, 1, iso(9)]);
    assert.deepEqual([s[1].answers, s[1].right], [1, 1]);
  });

  test('the mapping: under 0.4 Again, under 0.7 Hard, Good, Easy from 0.9 on 5 answers without hints', () => {
    const r = (right, answers, hints = 0) => ratingFor({ answers, right, hints }).rating;
    assert.equal(r(0, 1), 'again');
    assert.equal(r(1, 1), 'good');
    assert.equal(r(1, 3), 'again');
    assert.equal(r(2, 5), 'hard');
    assert.equal(r(3, 5), 'hard');
    assert.equal(r(7, 10), 'good');
    assert.equal(r(4, 4), 'good', 'all right, but under 5 answers');
    assert.equal(r(5, 5), 'easy');
    assert.equal(r(9, 10), 'easy');
    assert.equal(r(5, 5, 1), 'good', 'a hinted session is never Easy');
    assert.deepEqual(RATING_CUTS, { hard: 0.4, good: 0.7, easy: 0.9, easyMinAnswers: 5 });
  });

  test('ts-fsrs default parameters: a first Good comes back in 10 minutes, a second Good days later', () => {
    const first = reviewState([attempt({ createdAt: iso(0), correct: true })], at(5));
    assert.equal(first.sessions, 1);
    assert.equal(first.lastRating, 'good');
    assert.equal(first.dueAt, iso(10));
    assert.equal(first.due, false, 'not yet, five minutes on');
    assert.equal(reviewState([attempt({ createdAt: iso(0), correct: true })], at(10)).due, true, 'due at ten minutes');
    const second = reviewState([
      attempt({ _id: 'a', createdAt: iso(0), correct: true }),
      attempt({ _id: 'b', createdAt: iso(12), questionId: 'q2', correct: true }),
    ], at(13));
    assert.equal(second.sessions, 2);
    assert.equal(second.dueAt, '2026-11-21T10:12:00.000Z');
    assert.equal(second.due, false);
  });

  test('Again comes back in a minute; Easy goes days ahead', () => {
    assert.equal(reviewState([attempt({ correct: false })], at(0)).dueAt, iso(1));
    const easy = [1, 2, 3, 4, 5].map((i) => attempt({ _id: `e${i}`, questionId: `q${i}`, createdAt: iso(i / 10) }));
    assert.equal(reviewState(easy, at(1)).lastRating, 'easy');
    assert.equal(reviewState(easy, at(1)).dueAt, new Date(Date.parse(iso(0.5)) + 8 * 86400000).toISOString());
  });

  test('no attempt, no card and never due', () => {
    assert.deepEqual(reviewState([], at(0)), { card: null, sessions: 0, reviews: [], dueAt: null, due: false, lastRating: null });
  });

  test('weekly consistency: days practised and rested, India\'s days, upcoming days neither, no streak', () => {
    // 2026-11-19 is a Thursday. Practice on Monday (twice) and Wednesday; a
    // Sunday of the week before; one at 23:00 UTC Tuesday, which is Wednesday in India.
    const rows = ['2026-11-16T05:00:00.000Z', '2026-11-16T06:00:00.000Z', '2026-11-17T23:00:00.000Z', '2026-11-15T10:00:00.000Z']
      .map((t, i) => attempt({ _id: `w${i}`, createdAt: t }));
    const [now, before] = weeklyConsistency(rows, { now: T0, weeks: 2 });
    assert.equal(weekStart('2026-11-19'), '2026-11-16');
    assert.equal(addDays('2026-11-16', 6), '2026-11-22');
    assert.equal(now.start, '2026-11-16');
    assert.deepEqual(now.days.map((d) => [d.day.slice(8), d.practised, d.attempts, d.upcoming]), [
      ['16', true, 2, false], ['17', false, 0, false], ['18', true, 1, false], ['19', false, 0, false],
      ['20', false, 0, true], ['21', false, 0, true], ['22', false, 0, true]]);
    assert.deepEqual([now.practisedDays, now.restDays], [2, 2]);
    assert.equal(now.sentence, 'This week you practised on 2 days and rested on 2 days.');
    assert.deepEqual([before.practisedDays, before.restDays], [1, 6]);
    assert.doesNotMatch(JSON.stringify([now, before]), /streak/i);
  });
});

/* ------------------------------------------------------------ error log -- */

describe('the error log (H7)', () => {
  test('opens on a wrong answer; only a later right answer to ANOTHER question at that level or above clears it', () => {
    const rows = [
      attempt({ _id: '1', createdAt: iso(0), questionId: 'q1', bloom: 'apply', correct: false }),
      attempt({ _id: '2', createdAt: iso(1), questionId: 'q1', bloom: 'apply', correct: false }),
      attempt({ _id: '3', createdAt: iso(2), questionId: 'q1', bloom: 'apply', correct: true }), // the same question
      attempt({ _id: '4', createdAt: iso(3), questionId: 'q2', bloom: 'remember', correct: true }), // below the level
      attempt({ _id: '5', createdAt: iso(4), questionId: 'q9', bloom: 'analyse', correct: true, topicId: 't2' }), // another topic
    ];
    let [entry] = buildErrorLog({ hubAttempts: rows });
    assert.equal(entry.status, 'open');
    assert.equal(entry.times, 2, 'the same question wrong again adds to its entry');
    assert.equal(entry.latest._id, '2');
    [entry] = buildErrorLog({ hubAttempts: [...rows, attempt({ _id: '6', createdAt: iso(5), questionId: 'q3', bloom: 'analyse', correct: true })] });
    assert.equal(entry.status, 'cleared');
    assert.deepEqual([entry.clearedAt, entry.clearedBy.bloom, entry.clearedBy.from], [iso(5), 'analyse', 'practice']);
    const reopened = buildErrorLog({ hubAttempts: [...rows,
      attempt({ _id: '6', createdAt: iso(5), questionId: 'q3', bloom: 'apply', correct: true }),
      attempt({ _id: '7', createdAt: iso(6), questionId: 'q1', bloom: 'apply', correct: false })] });
    assert.deepEqual(reopened.map((e) => e.status), ['cleared', 'open'], 'a new wrong answer after clearing opens a new entry');
    assert.deepEqual([...openByTopic(reopened)], [['t1', 1]]);
  });

  test('room answers from class: final, marked and not a vote; they open and clear entries alike', () => {
    const room = (over) => ({ _id: `r${Math.random()}`, topicId: 't1', questionId: 'rq', bloom: 'apply', correct: false, final: true,
      answeredAt: iso(0), accountVerified: true, ...over });
    const log = buildErrorLog({
      roomAnswers: [
        room({ _id: 'r1' }),
        room({ _id: 'r2', final: false, questionId: 'rq2' }), // a wrong attempt followed by a retry never counted
        room({ _id: 'r3', ungraded: true, correct: null, questionId: 'rq3' }),
        room({ _id: 'r4', classQuestionId: 'cq', questionId: 'rq4' }),
      ],
    });
    assert.equal(log.length, 1);
    assert.deepEqual([log[0].from, log[0].id], ['class', 'class:r1']);
    const cleared = buildErrorLog({ roomAnswers: [room({ _id: 'r1' })], hubAttempts: [attempt({ createdAt: iso(1), questionId: 'hq', bloom: 'evaluate' })] });
    assert.equal(cleared[0].status, 'cleared');
  });
});

/* ------------------------------------------------------------- practice -- */

describe('the practice loop over a store', () => {
  test('what practice may serve, and what an answer may be stored against', () => {
    assert.equal(practisable({ status: 'active', kind: 'mcq' }), true);
    assert.equal(practisable({ status: 'active', kind: 'poll' }), false);
    assert.equal(practisable({ status: 'draft' }), false);
    assert.equal(practisable({ status: 'active', stimulus: { kind: 'image' } }), false);
    assert.equal(practisable({ status: 'active', stimulus: { kind: 'passage', text: 'x' } }), true);
    assert.equal(onceServable({ status: 'discarded', model: null }), true, 'a professor\'s question retired after serving');
    assert.equal(onceServable({ status: 'discarded', model: 'm', approvedAt: '2026-11-19' }), true);
    assert.equal(onceServable({ status: 'discarded', model: 'm', approvedAt: null }), false, 'a rejected draft was never shown');
    assert.equal(cleanAttemptId('short'), '');
    assert.equal(cleanAttemptId('att-0001_x'), 'att-0001_x');
  });

  test('a student\'s scope: their professor\'s class with them on its roster; live topics; practisable questions only', async () => {
    const { repo, framing, routing } = await fixture();
    const scope = await studentScope(repo, asha);
    assert.deepEqual([...scope.topics.keys()], [String(framing._id), String(routing._id)]);
    assert.deepEqual(scope.topics.get(String(framing._id)).questions.map((q) => q.text), ['F remember?', 'F apply?', 'F analyse?', 'F evaluate?']);
    assert.equal((await studentScope(repo, stranger)).topics.size, 0, 'another professor\'s student with the same roll number reaches nothing');
  });

  test('the next question: no key, the rich field, nearest the target chance first; none for a topic not theirs', async () => {
    const { repo, framing, by } = await fixture();
    const next = await nextQuestion(repo, asha, { topicIds: String(framing._id), now: T0 });
    assert.equal(next.question.text, 'F remember?', 'a new student (skill 0): Remember, at -1.25, gives 0.78, the nearest to 0.7 of the four');
    assert.deepEqual(Object.keys(next.question).sort(), ['_id', 'bloom', 'kind', 'options', 'provenance', 'rich', 'source', 'text', 'topic']);
    assert.doesNotMatch(JSON.stringify(next), /answerIdx|"explanation"|solution|rubric/);
    assert.deepEqual(next.hints, await hintsOffered(repo, {}));
    assert.equal(next.language, 'en');
    assert.match(next.why, /not practised this topic/);
    await assert.rejects(nextQuestion(repo, stranger, { topicIds: String(framing._id) }), (err) => err.status === 404 && err.message === 'That topic was not found.');
    await assert.rejects(nextQuestion(repo, asha, { topicIds: String(framing._id), mode: 'exam' }), (err) => err.status === 400);
    assert.equal(by['F remember?'].kind, 'mcq');
  });

  test('chooseNext: not the question just answered; once all are met, the one last wrong, then the oldest', () => {
    const c = (id, bloom = 'apply') => ({ q: { _id: id, bloom }, entry: {} });
    const mine = [attempt({ _id: '1', questionId: 'a', createdAt: iso(0), correct: true }), attempt({ _id: '2', questionId: 'b', createdAt: iso(1), correct: false }),
      attempt({ _id: '3', questionId: 'c', createdAt: iso(2), correct: true })];
    const pick = chooseNext([c('a'), c('b'), c('c')], { skillOf: () => 0, difficultyOf: () => 0, mine });
    assert.deepEqual([pick.q._id, pick.fresh, pick.lastRight], ['b', false, false]);
    const fresh = chooseNext([c('a'), c('d', 'create'), c('e', 'remember')], { skillOf: () => 0, difficultyOf: (x) => seedFor(x.q.bloom), mine });
    assert.equal(fresh.q._id, 'e', 'unmet first, nearest the target chance (remember: 0.78 against 0.7)');
    assert.equal(chooseNext([c('c')], { skillOf: () => 0, difficultyOf: () => 0, mine }).q._id, 'c', 'the only one comes back');
  });

  test('an attempt: marked on the server, kept once per attempt id, the key and explanation only after it', async () => {
    const { repo, framing, by } = await fixture();
    const q = by['F apply?'];
    await repo.addQuestionExplanation({ questionId: String(q._id), text: 'Because $x^2$ grows.', provenance: 'professor', status: 'approved', approvedAt: iso(0) });
    const body = { attemptId: 'attempt-0001', questionId: String(q._id), topicId: String(framing._id), response: 0, mode: 'practice', timeTakenMs: 4200 };
    const first = await recordAttempt(repo, asha, body, { now: at(0) });
    assert.equal(first.duplicate, false);
    assert.deepEqual([first.attempt.correct, first.attempt.score, first.attempt.mode, first.attempt.language, first.attempt.hintsUsed, first.attempt.timeTakenMs],
      [true, 1, 'practice', 'en', 0, 4200]);
    assert.equal(first.attempt.questionSnapshot.answerIdx, 0, 'the snapshot keeps the key, as a room answer\'s does');
    const again = await recordAttempt(repo, asha, { ...body, response: 2 }, { now: at(1) });
    assert.equal(again.duplicate, true);
    assert.equal(again.attempt._id, first.attempt._id);
    assert.equal(again.attempt.correct, true, 'the stored result, not the resend\'s');
    assert.equal((await repo.listHubAttempts({ accountId: asha.id })).length, 1, 'one row');
    // Another student may use the same attempt id: it is theirs.
    await recordAttempt(repo, bilal, body, { now: at(2) });
    assert.equal((await repo.listHubAttempts({})).length, 2);

    const fb = await feedbackFor(repo, asha, first.attempt, { now: at(0), entry: first.entry });
    assert.equal(fb.correct, true);
    assert.equal(fb.solution, 0, 'the right answer, in the positions shown');
    assert.equal(fb.explanation.text, 'Because $x^2$ grows.');
    assert.match(fb.explanation.textHtml, /<math>/);
    assert.equal(fb.explanation.label, 'Written by your professor.');
    assert.equal(fb.topic.state.answers, 1);
    assert.equal(fb.topic.state.state, 'not-sure');
  });

  test('a draft explanation is never shown; a written answer\'s mark is labelled provisional', async () => {
    const { repo, framing, content } = await fixture();
    const [open] = await repo.insertQuestions([{
      contentId: content._id, topic: 'Framing', text: 'Explain framing.', kind: 'open', rubric: ['frames split the bit stream'], bloom: 'evaluate', status: 'active', source: 'teacher',
    }]);
    await repo.addQuestionExplanation({ questionId: String(open._id), text: 'Draft words.', provenance: 'ai', status: 'draft', model: 'm' });
    assert.equal(await explanationForStudent(repo, String(open._id)), null);
    const { attempt: a, entry } = await recordAttempt(repo, asha, {
      attemptId: 'written-01', questionId: String(open._id), topicId: String(framing._id), response: 'frames split the stream of bits',
    }, { now: at(0) });
    assert.equal(a.reviewStatus, 'provisional');
    const fb = await feedbackFor(repo, asha, a, { entry });
    assert.equal(fb.provisional, true);
    assert.match(fb.provisionalNote, /provisional machine mark/);
    assert.equal(fb.explanation, null);
  });

  test('refused: a draft, a poll, a question of another topic, a bad attempt id, a mode not in the list', async () => {
    const { repo, framing, routing, by } = await fixture();
    const send = (over) => recordAttempt(repo, asha, { attemptId: 'refused-01', topicId: String(framing._id), response: 0, ...over });
    for (const q of [by['F draft?'], by['Which do you prefer?'], by['R understand?'], by['F image?']]) {
      await assert.rejects(send({ questionId: String(q._id) }), (err) => err.status === 404 && err.message === NO_QUESTION);
    }
    await assert.rejects(send({ questionId: String(by['F apply?']._id), attemptId: 'x' }), (err) => err.status === 400);
    await assert.rejects(send({ questionId: String(by['F apply?']._id), mode: 'homework' }), (err) => err.status === 400);
    await assert.rejects(send({ questionId: String(by['F apply?']._id), topicId: String(routing._id) }), (err) => err.status === 404);
    assert.equal((await repo.listHubAttempts({})).length, 0, 'nothing was stored');
  });

  test('the hint hook records 0 and offers none, and never in a self-test', async () => {
    assert.equal(await hintsUsedOn(null, { mode: 'practice' }), 0);
    assert.equal(await hintsUsedOn(null, { mode: 'exam' }), 0);
    assert.equal((await hintsOffered(null, { mode: 'exam' })).available, 0);
  });
});

/* --------------------------------------------------------- reads, staff -- */

describe('progress, the due list and the error log, for the student and for staff', () => {
  test('state moves with N; a review comes due; the error log fills and clears', async () => {
    const { repo, framing, by } = await fixture();
    const t = String(framing._id);
    const send = (q, response, minutes, id) => recordAttempt(repo, asha, { attemptId: id, questionId: String(by[q]._id), topicId: t, response }, { now: at(minutes) });
    await send('F apply?', 1, 0, 'flow-0001'); // wrong
    let p = await studentProgress(repo, asha, { now: at(0.5) });
    let framingState = p.topics.find((x) => x.id === t).state;
    assert.deepEqual([framingState.state, framingState.answers], ['not-sure', 1]);
    // A session that was all wrong is rated Again: FSRS brings it back a minute later.
    framingState = (await studentProgress(repo, asha, { now: at(1) })).topics.find((x) => x.id === t).state;
    assert.deepEqual([framingState.state, framingState.estimateState, framingState.answers], ['needs-review', 'not-sure', 1]);
    assert.match(framingState.sentence, /rests on 1 answer/);
    let log = await errorLogFor(repo, asha);
    assert.equal(log.counts.open, 1);
    const [entry] = log.entries;
    assert.equal(entry.question.text, 'F apply?');
    assert.doesNotMatch(JSON.stringify(entry.question), /answerIdx/);
    assert.deepEqual([entry.response, entry.solution, entry.from, entry.fromLabel], [1, 0, 'practice', 'From your practice']);
    await send('F remember?', 0, 2, 'flow-0002'); // right, but below Apply: still open
    await send('F analyse?', 0, 3, 'flow-0003'); // right at Analyse: clears it
    log = await errorLogFor(repo, asha);
    assert.deepEqual([log.counts.open, log.counts.cleared], [0, 1]);
    p = await studentProgress(repo, asha, { now: at(4) });
    framingState = p.topics.find((x) => x.id === t).state;
    assert.deepEqual([framingState.state, framingState.answers], ['in-progress', 3]);
    // One session (all within ten minutes), 2 of 3 right: Hard, due in 5.5 minutes after it.
    assert.equal(framingState.review.lastRating, 'hard');
    const due = await dueList(repo, asha, { now: at(30) });
    assert.deepEqual(due.due.map((d) => d.id), [t]);
    assert.equal(due.due[0].state, 'needs-review');
    assert.equal((await dueList(repo, asha, { now: at(4) })).due.length, 0);
  });

  test('verified room answers come into the error log "from class"; unverified ones never', async () => {
    const { repo, cls, content, by } = await fixture();
    const room = await repo.createSession({ code: 'ROOM01', contentId: content._id, classId: cls._id, ownerId: PROF });
    const q = by['F evaluate?'];
    const row = (key, over) => repo.recordAnswer({
      sessionId: room._id, answerKey: key, rollNo: '21CS01', accountId: asha.id, questionId: String(q._id), contentId: String(content._id),
      topic: 'Framing', bloom: 'evaluate', kind: 'mcq', questionSnapshot: { id: String(q._id), text: q.text, kind: 'mcq', options: q.options, answerIdx: 0 },
      response: 2, correct: false, score: 0, final: true, ...over,
    });
    await row('k-verified', { accountVerified: true });
    await row('k-typed', { accountVerified: false, questionId: String(by['F analyse?']._id) });
    const log = await errorLogFor(repo, asha);
    assert.equal(log.entries.length, 1);
    assert.deepEqual([log.entries[0].from, log.entries[0].fromLabel, log.entries[0].response, log.entries[0].solution], ['class', 'From class', 2, 0]);
  });

  test('staff: roll order, a state and N per topic, open errors, activity; a roll number with no account says so', async () => {
    const { repo, cls, framing, by } = await fixture();
    await repo.addClassStudents(cls._id, [{ rollNo: '21CS00', name: 'Zara' }]);
    await recordAttempt(repo, bilal, { attemptId: 'bilal-001', questionId: String(by['F apply?']._id), topicId: String(framing._id), response: 3 }, { now: at(0) });
    const listStudents = async () => [asha, bilal, stranger].map((a) => ({ ...a, reportsTo: a.reportsTo }));
    const people = await rosterAccounts(repo, cls, { listStudents });
    assert.deepEqual(people.map((p) => [p.roster.rollNo, p.account?.id ?? null]), [['21CS00', null], ['21CS01', 'acc-asha'], ['21CS02', 'acc-bilal']]);
    const view = await classProgress(repo, cls, { listStudents, now: at(0.5) });
    assert.deepEqual(view.students.map((s) => s.rollNo), ['21CS00', '21CS01', '21CS02'], 'roll order, never by score');
    assert.match(view.students[0].note, /No student account/);
    const b = view.students[2].topics[String(framing._id)];
    assert.deepEqual([b.state, b.answers, b.openErrors], ['not-sure', 1, 1]);
    assert.equal(view.students[2].activity.total, 1);
    const topic = view.topics.find((x) => x.id === String(framing._id));
    assert.deepEqual([topic.counts['not-sure'], topic.counts['not-started'], topic.openErrors], [1, 1, 1]);
    const one = await studentProgressForStaff(repo, cls, people[2].roster, { listStudents, now: at(1) });
    assert.equal(one.errors.entries[0].questionId, String(by['F apply?']._id));
    assert.match(one.errors.entries[0].sentence, /when they get/);
    assert.deepEqual(activityOf([], at(0)).byMode, { practice: 0, exam: 0, getready: 0, review: 0, lesson: 0 });
  });
});

// The client session's asks of 19 Nov 2026: the error log's prerequisites say
// which are on the student's classes, as the topic view does; and the home's
// "Your Bloom levels", now and a month ago, from the student's own answers only.
describe('the error log\'s prerequisites, and the Bloom levels now and a month ago', () => {
  test('each prerequisite says whether its chapter is on the student\'s classes; a staff read says nothing of it', async () => {
    const { repo, cls, framing, routing, by } = await fixture();
    // An earlier semester's chapter of the same professor, on none of Asha's classes.
    const earlier = await repo.createContent({ title: 'Signals', kind: 'syllabus', rawText: 'Bits are signals.', topics: ['Bits'], ownerId: PROF });
    await syncTopics(repo, earlier);
    const [bits] = await repo.listChapterTopics(earlier._id);
    await repo.addTopicLink({ ownerId: PROF, prerequisiteId: routing._id, topicId: framing._id, provenance: 'professor', state: 'confirmed' });
    await repo.addTopicLink({ ownerId: PROF, prerequisiteId: bits._id, topicId: framing._id, provenance: 'professor', state: 'confirmed' });
    await recordAttempt(repo, asha, { attemptId: 'prereq-0001', questionId: String(by['F apply?']._id), topicId: String(framing._id), response: 1 }, { now: at(0) });
    const [entry] = (await errorLogFor(repo, asha)).entries;
    const said = entry.prerequisites.map((p) => [p.name, p.depth, p.onYourClasses]).sort();
    assert.deepEqual(said, [['Bits', 1, false], ['Routing', 1, true]]);
    const listStudents = async () => [asha];
    const [person] = await rosterAccounts(repo, cls, { listStudents });
    const staff = await studentProgressForStaff(repo, cls, person.roster, { listStudents, now: at(1) });
    assert.ok(staff.errors.entries[0].prerequisites.length > 0);
    assert.ok(staff.errors.entries[0].prerequisites.every((p) => !('onYourClasses' in p)));
  });

  const hub = (bloom, correct, minutes, over = {}) => ({ _id: `h${minutes}${bloom}`, mode: 'practice', bloom, correct, createdAt: iso(minutes), ...over });
  const room = (bloom, correct, minutes, over = {}) => ({
    _id: `r${minutes}${bloom}`, bloom, correct, final: true, accountVerified: true, classQuestionId: null, answeredAt: iso(minutes), ...over,
  });
  const DAY = 24 * 60;

  test('per level, right of asked now and a month ago, each cumulative to its moment, counted by hand', () => {
    const now = at(40 * DAY);
    const out = levelFigures({
      now,
      hubAttempts: [
        // Apply: 3 of 4 a month ago, then 3 right more: 6 of 7 now.
        hub('apply', true, 0), hub('apply', true, 1), hub('apply', false, 2), hub('apply', true, 3),
        hub('apply', true, 35 * DAY), hub('apply', true, 36 * DAY), hub('apply', true, 37 * DAY),
        // Remember: two answers only, both lately.
        hub('remember', true, 38 * DAY), hub('remember', false, 39 * DAY),
        // Not counted: no level, a poll.
        hub('unknown', true, 5), hub('remember', true, 6, { ungraded: true, correct: null }),
      ],
      roomAnswers: [
        // Analyse: 1 of 3 a month ago (room), 1 of 4 now.
        room('analyse', true, 10), room('analyse', false, 11), room('analyse', false, 12), room('analyse', false, 38 * DAY),
        // Never counted: typed without signing in, kept and not counted, a class vote, a poll.
        room('analyse', true, 13, { accountVerified: false }), room('analyse', true, 14, { final: false }),
        room('analyse', true, 15, { classQuestionId: 'cq1' }), room('analyse', true, 16, { ungraded: true, correct: null }),
      ],
    });
    assert.equal(out.monthAgo, new Date(now.getTime() - LEVELS_MONTH_DAYS * 86400000).toISOString());
    assert.deepEqual(out.levels.map((l) => l.level), ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create']);
    const by = Object.fromEntries(out.levels.map((l) => [l.level, l]));
    assert.deepEqual([by.apply.now.right, by.apply.now.answers, by.apply.monthAgo.right, by.apply.monthAgo.answers], [6, 7, 3, 4]);
    // 86% now against 75%: up 11 points.
    assert.equal(by.apply.change, 11);
    assert.equal(by.apply.sentence, '6 of 7 right at Apply (86%), up 11 percentage points from 3 of 4 (75%) a month ago.');
    assert.deepEqual([by.analyse.now.right, by.analyse.now.answers, by.analyse.monthAgo.right, by.analyse.monthAgo.answers], [1, 4, 1, 3]);
    assert.equal(by.analyse.change, -8);
    assert.match(by.analyse.sentence, /^1 of 4 right at Analyse \(25%\), down 8 percentage points from 1 of 3 \(33%\) a month ago\.$/);
    assert.deepEqual([by.remember.now.answers, by.remember.monthAgo.answers, by.remember.change, by.remember.provisional], [2, 0, null, true]);
    assert.equal(by.remember.sentence, '1 of 2 right at Remember so far: too few answers to say much yet.');
    assert.deepEqual([by.create.now.answers, by.create.now.accuracy, by.create.change], [0, null, null]);
    assert.equal(by.create.sentence, 'No answers at Create yet.');
    assert.match(out.note, /own answers a month ago only/);
    // Own data only: no class figure, no rank, no band.
    assert.deepEqual(Object.keys(out.levels[0]).sort(), ['change', 'label', 'level', 'monthAgo', 'now', 'provisional', 'sentence']);
    assert.doesNotMatch(JSON.stringify(out), /\brank|average|streak|Needs support|Excelling|Developing/i);
  });

  test('over the store: hub attempts and the student\'s signed-in room answers, nobody else\'s', async () => {
    const { repo, cls, content, framing, by } = await fixture();
    const t = String(framing._id);
    await recordAttempt(repo, asha, { attemptId: 'level-0001', questionId: String(by['F apply?']._id), topicId: t, response: 0 }, { now: at(0) });
    await recordAttempt(repo, asha, { attemptId: 'level-0002', questionId: String(by['F apply?']._id), topicId: t, response: 1 }, { now: at(5) });
    await recordAttempt(repo, bilal, { attemptId: 'level-0003', questionId: String(by['F apply?']._id), topicId: t, response: 0 }, { now: at(5) });
    const roomRow = await repo.createSession({ code: 'LEVELS', contentId: content._id, classId: cls._id, ownerId: PROF });
    const q = by['F evaluate?'];
    const row = (key, over) => repo.recordAnswer({
      sessionId: roomRow._id, answerKey: key, rollNo: '21CS01', accountId: asha.id, questionId: String(q._id), contentId: String(content._id),
      topic: 'Framing', bloom: 'evaluate', kind: 'mcq', questionSnapshot: { id: String(q._id), text: q.text, kind: 'mcq', options: q.options, answerIdx: 0 },
      response: 0, correct: true, score: 1, final: true, answeredAt: iso(6), ...over,
    });
    await row('k-signed-in', { accountVerified: true });
    await row('k-typed', { accountVerified: false });
    const out = await bloomLevelsFor(repo, asha, { now: at(10) });
    const level = (l) => out.levels.find((x) => x.level === l);
    assert.deepEqual([level('apply').now.right, level('apply').now.answers], [1, 2]);
    assert.deepEqual([level('evaluate').now.right, level('evaluate').now.answers], [1, 1]);
    // A month before at(10) there was nothing yet.
    assert.ok(out.levels.every((l) => l.monthAgo.answers === 0));
  });
});

/* ---------------------------------------------- rooms, attainment, register -- */

describe('hub attempts change nothing in rooms, attainment or the register (H5)', () => {
  test('the class\'s room answers, profiles, attainment and register are the same before and after', async () => {
    const { repo, cls, content, framing, by } = await fixture();
    const room = await repo.createSession({ code: 'ROOM02', contentId: content._id, classId: cls._id, ownerId: PROF });
    await repo.saveProfile({ sessionId: room._id, rollNo: '21CS01', name: 'Asha', levels: {}, workingLevel: 'understand', history: [] });
    await repo.saveAttendance([{ sessionId: room._id, classStudentId: (await repo.listClassStudents(cls._id))[0]._id, status: 'present', source: 'joined', rollNo: '21CS01' }]);
    for (const [i, q] of ['F remember?', 'F apply?'].entries()) {
      await repo.recordAnswer({ sessionId: room._id, answerKey: `room-${i}`, rollNo: '21CS01', accountId: asha.id, accountVerified: true,
        questionId: String(by[q]._id), contentId: String(content._id), topic: 'Framing', bloom: by[q].bloom, kind: 'mcq',
        questionSnapshot: { id: String(by[q]._id) }, response: 0, correct: true, score: 1, final: true });
    }
    const read = async () => {
      const rooms = await repo.listSessionsForClass(cls._id);
      const inputs = await readAttainmentInputs(repo, cls, rooms, { records: true });
      const formula = formulaOf(null);
      return JSON.stringify({
        answers: await repo.listAnswers({ sessionId: room._id }),
        profiles: await repo.listProfiles(room._id),
        attainment: classAttainment({ cls, rooms, formula, ...inputs }),
        register: marksRegister({ cls, rooms, formula, ...inputs }),
      });
    };
    const before = await read();
    for (const [i, q] of ['F remember?', 'F apply?', 'F analyse?'].entries()) {
      await recordAttempt(repo, asha, { attemptId: `hub-${i}-xxxx`, questionId: String(by[q]._id), topicId: String(framing._id), response: i }, { now: at(i) });
    }
    assert.equal((await repo.listHubAttempts({ accountId: asha.id })).length, 3);
    assert.equal(await read(), before);
  });
});

/* --------------------------------------------------------- explanations -- */

describe('explanations (H14): the professor\'s text, and the model\'s drafts parsed from fixtures', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => ({
    question: { _id: `q${i}`, topic: 'Framing', text: `Question ${i}?`, kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, sourceRef: { kind: 'slides', slides: [2, 3] } },
    content: { title: 'Layers', rawText: 'Framing splits the bit stream into frames.', topicSlides: { Framing: [2, 3] } },
  }));

  test('a professor\'s text: tidied, capped, no contact details', () => {
    assert.equal(explanationText('  Because  frames\r\n\r\n\r\n end.  '), 'Because frames\n\nend.');
    assert.throws(() => explanationText('   '), (err) => err.status === 400);
    assert.throws(() => explanationText('x'.repeat(2001)), (err) => err.status === 400);
    assert.throws(() => explanationText('Mail me at a@b.co'), (err) => err.status === 400);
  });

  test('the prompt carries each question with its key and its own slides, and asks for slide numbers from those only', () => {
    const input = explanationInput(items(2));
    const prompt = buildExplanationPrompt(input);
    assert.match(prompt, /Q1 \| topic: Framing \| slides: 2, 3/);
    assert.match(prompt, /"answerIdx":1/);
    assert.match(prompt, /Framing splits the bit stream/);
    assert.match(prompt, /Never add facts/);
  });

  test('the parser keeps only what the rules allow, and names every refusal', () => {
    const input = explanationInput(items(5));
    const reply = JSON.stringify({ explanations: [
      { question: 'Q1', text: 'B is right because frames split bits.', slides: [3, 9] },
      { question: 'q2', text: 'Right because slide two says so.', slides: [] },
      { question: 'Q1', text: 'Again.', slides: [] },
      { question: 'Q3', text: 'x'.repeat(MAX_MODEL_EXPLANATION + 1) },
      { question: 'Q4', text: 'Call 9876543210 for help.' },
      { question: 'Q9', text: 'Invented.' },
    ] });
    const { drafts, skipped } = parseExplanations(`\`\`\`json\n${reply}\n\`\`\``, input);
    assert.deepEqual(drafts.map((d) => [d.questionId, d.sourceRef?.slides]), [['q0', [3]], ['q1', [2, 3]]],
      'slide 9 is not the topic\'s; citing none cites the slides it was given');
    assert.deepEqual(skipped.map((s) => s.why), [
      'it was written twice; the first was kept',
      `it was longer than ${MAX_MODEL_EXPLANATION} characters`,
      'it held an email address or a phone number',
      'it named a question that was not offered',
      'the model wrote none for it',
    ]);
    assert.throws(() => parseExplanations('not json', input), /not JSON/);
    assert.throws(() => parseExplanations('{"links": []}', input), /no list/);
    const partial = parseExplanations(JSON.stringify({ explanations: [] }), explanationInput(items(1)));
    assert.deepEqual(partial.skipped, [{ questionId: 'q0', why: 'the model wrote none for it' }]);
  });

  test('offline: no model key, no drafts, and the reply says so', async () => {
    const out = await draftExplanations({ items: items(3) });
    assert.deepEqual([out.source, out.drafts.length, out.note], ['offline', 0, OFFLINE_NOTE]);
  });

  test('a stand-in model: batches of ten, and a failed batch is a warning, not a failure', async () => {
    const calls = [];
    const out = await draftExplanations({
      items: items(BATCH + 2),
      callModel: async (prompt) => {
        calls.push(prompt);
        if (calls.length === 2) throw new Error('timed out');
        const labels = [...prompt.matchAll(/^(Q\d+) \|/gm)].map((m) => m[1]);
        return JSON.stringify({ explanations: labels.map((l) => ({ question: l, text: `Why ${l}.`, slides: [2] })) });
      },
    });
    assert.equal(calls.length, 2);
    assert.equal(out.drafts.length, BATCH);
    assert.equal(out.model, 'stand-in');
    assert.match(out.warnings[0], /could not draft 2 explanations: timed out/);
    assert.equal(out.skipped.length, 2);
  });
});

/* ---------------------------------------------------------------- repos -- */

describe('the repos (0026)', () => {
  test('in-process: one attempt per (account, attempt id); oldest first; filters; one explanation per question', async () => {
    const repo = createMemoryRepo();
    const base = { bloom: 'apply', correct: true, score: 1, mode: 'practice' };
    const a = await repo.addHubAttempt({ ...base, accountId: 's1', clientAttemptId: 'aaaaaaaa', topicId: 't1', questionId: 'q1', createdAt: iso(1) });
    const b = await repo.addHubAttempt({ ...base, accountId: 's1', clientAttemptId: 'bbbbbbbb', topicId: 't2', questionId: 'q2', createdAt: iso(0) });
    const dup = await repo.addHubAttempt({ ...base, accountId: 's1', clientAttemptId: 'aaaaaaaa', topicId: 't9', createdAt: iso(5) });
    assert.deepEqual([a.duplicate, b.duplicate, dup.duplicate, dup.attempt._id, dup.attempt.topicId], [false, false, true, a.attempt._id, 't1']);
    assert.deepEqual((await repo.listHubAttempts({ accountId: 's1' })).map((x) => x.clientAttemptId), ['bbbbbbbb', 'aaaaaaaa']);
    assert.equal((await repo.listHubAttempts({ topicIds: ['t2'] })).length, 1);
    assert.equal((await repo.listHubAttempts({ topicIds: [] })).length, 0);
    assert.equal((await repo.listHubAttempts({ since: iso(1) })).length, 1);
    assert.equal((await repo.getHubAttemptByKey('s1', 'bbbbbbbb'))._id, b.attempt._id);
    assert.equal(typeof repo.updateHubAttempt, 'undefined', 'no method changes an attempt');
    await repo.addQuestionExplanation({ questionId: 'q1', text: 'x', provenance: 'ai', status: 'draft' });
    await assert.rejects(repo.addQuestionExplanation({ questionId: 'q1', text: 'y', provenance: 'professor', status: 'approved' }), (err) => err.status === 409);
    const up = await repo.updateQuestionExplanation('q1', { status: 'approved', approvedAt: iso(0), questionId: 'other' });
    assert.deepEqual([up.status, up.questionId], ['approved', 'q1']);
    assert.equal((await repo.listQuestionExplanations(['q1', 'q2'])).length, 1);
    assert.equal(await repo.deleteQuestionExplanation('q1'), true);
    assert.equal(await repo.getQuestionExplanation('q1'), null);
  });

  test('Supabase: an attempt is inserted with the server\'s time, a 23505 answers with the stored row, long id lists go in chunks', async () => {
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const row = { id: '11111111-1111-4111-8111-111111111111', account_id: '22222222-2222-4222-8222-222222222222', client_attempt_id: 'aaaaaaaa',
      bloom: 'apply', correct: true, score: '1.000', mode: 'practice', hints_used: 0, created_at: '2026-11-19T10:00:00.123456+00:00' };
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input.url ?? input));
      seen.push({ url, method: init.method ?? 'GET', body: init.body });
      if ((init.method ?? 'GET') === 'POST') {
        return new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "hub_attempts_account_attempt_key"' }),
          { status: 409, headers: { 'content-type': 'application/json' } });
      }
      if (url.searchParams.get('client_attempt_id')) return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      const out = await repo.addHubAttempt({ accountId: row.account_id, clientAttemptId: 'aaaaaaaa', bloom: 'apply', correct: true, score: 1, mode: 'practice',
        createdAt: '2026-11-19T10:00:00.000Z' });
      assert.equal(seen[0].url.pathname, '/rest/v1/hub_attempts');
      assert.equal(JSON.parse(seen[0].body).created_at, '2026-11-19T10:00:00.000Z');
      assert.deepEqual([out.duplicate, out.attempt._id, out.attempt.score, out.attempt.accountId], [true, row.id, 1, row.account_id]);
      const ids = Array.from({ length: 150 }, (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`);
      seen.length = 0;
      await repo.listHubAttempts({ topicIds: ids, accountId: row.account_id });
      assert.equal(seen.length, 2, '150 topic ids go as two requests of at most 100');
      assert.equal(seen[0].url.searchParams.get('account_id'), `eq.${row.account_id}`);
      assert.match(seen[0].url.searchParams.get('topic_id'), /^in\./);
      assert.equal(seen[0].url.searchParams.get('order'), 'created_at.asc,id.asc');
      seen.length = 0;
      assert.deepEqual(await repo.listHubAttempts({ topicIds: ['not-a-uuid'] }), []);
      assert.equal(seen.length, 0, 'nothing is asked for ids no row can have');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });
});
