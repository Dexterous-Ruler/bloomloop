// Mastery in the Learning Hub: an Elo rating per (student, topic) and per
// question (Phase 6, decision H6). Pure: no store, no clock.
//
// THE MODEL. Pelánek (2016), "Applications of the Elo rating system in adaptive
// educational systems", Computers & Education 98, 169-179:
//
//   P(right) = 1 / (1 + e^-(skill - difficulty))
//
//   after an answer, with r = 1 for right and 0 for wrong:
//     the student's skill on the topic   += K(n_student) * (r - P)
//     the question's difficulty          -= K(n_question) * (r - P)
//
//   K(n) = ALPHA / (1 + BETA * n)
//
// K is the paper's "uncertainty function": a rating that rests on n answers
// already moves less with each new one, so a new student or a new question
// finds its level quickly and a settled one is not thrown about by one slip.
// ALPHA = 1 and BETA = 0.05 are of the size the paper reports for adaptive
// practice systems. They are not tuned to BloomLoop's data yet; that needs
// answers, and changing them re-derives every estimate (see below).
//
// WHAT IS RATED. A student has one skill per topic record (chapter_topics,
// 0025), starting at 0; a question has one difficulty, shared by every student
// who practises it, starting from its Bloom level (ITEM_SEED below: Remember
// easiest, Create hardest, symmetric about 0). The answers students actually
// give then correct that seed, which is the roadmap's "Elo-style difficulty
// that corrects the Bloom tag over time".
//
// WHAT COUNTS. Only a student's FIRST attempt at each question moves either
// rating, as in the paper's systems: once the answer and its explanation have
// been shown, a second attempt at the same question measures memory of that
// answer more than understanding of the topic. Every attempt is still stored
// and counted as practice (`attempts`); the estimate's N (`answers`) is the
// first attempts it rests on. A written answer's provisional machine mark
// counts, as it does in a room, and is labelled where it is shown.
//
// WHERE IT COMES FROM. Ratings are not stored. They are worked out by replaying
// every hub attempt on the topic, by every student, in the server's order
// (replayTopic), as attainment is worked out from answers when it is asked for:
// nothing derived can drift from the evidence, and changing a constant here
// changes every estimate consistently. Room answers do not seed or move a hub
// rating: a room serves each student questions at the level the ladder has
// reached, with retries and class discussion, so its right-or-wrong is not the
// same measurement, and the hub's estimate says it rests on hub practice alone.
//
// TOPIC STATES (H6), each with N (the answers it rests on) and a plain sentence:
//   Not started    no attempt
//   Not sure yet   fewer than 3 answers: provisional, no estimate shown
//   In progress    3 or more answers, not mastered
//   Mastered       P(right) on the topic's typical question at least 0.8 (the
//                  decision-2 mastery goal, DEFAULT_MASTERY_GOAL), from at
//                  least 5 answers
//   Needs review   spaced review is due (services/hubReview.js); it comes first
//                  once a topic has any answer
// The typical question is the median difficulty of the topic's practisable
// questions. Nothing here ranks a student against another: a student is told
// only their own state, and staff see states listed in roll order.
//
// H6 says "attempts"; the thresholds count ANSWERS TO DIFFERENT QUESTIONS (the
// first attempts above), because a repeat after the answer was shown is not new
// evidence. So a topic with fewer approved questions than a threshold cannot
// reach it however much it is practised. The caller passes `reachable` (the
// answers the estimate could rest on with the questions approved now), and the
// sentence then says the topic needs more approved questions, instead of
// promising a state more practice cannot bring (`bankShort` marks it).

import { LEVELS, LABEL as LEVEL_LABEL } from '../bloom.js';
import { DEFAULT_MASTERY_GOAL } from './mastery.js';

/** The uncertainty function's constants (Pelánek 2016). */
export const ALPHA = 1;
export const BETA = 0.05;

/** A student's skill on a topic before any answer. */
export const START_SKILL = 0;

/** A question's difficulty before any answer, from its Bloom level: 0.5 apart, symmetric about 0. */
export const ITEM_SEED = Object.freeze({
  remember: -1.25,
  understand: -0.75,
  apply: -0.25,
  analyse: 0.25,
  evaluate: 0.75,
  create: 1.25,
});

/** Fewer answers than this: Not sure yet, no estimate shown. */
export const MIN_ANSWERS_FOR_ESTIMATE = 3;
/** Mastered needs at least this many answers... */
export const MIN_ANSWERS_FOR_MASTERY = 5;
/** ...and this chance of getting the topic's typical question right (decision 2's goal). */
export const MASTERY_P = DEFAULT_MASTERY_GOAL;

export const STATES = Object.freeze(['not-started', 'not-sure', 'in-progress', 'mastered', 'needs-review']);

export const STATE_LABEL = Object.freeze({
  'not-started': 'Not started',
  'not-sure': 'Not sure yet',
  'in-progress': 'In progress',
  mastered: 'Mastered',
  'needs-review': 'Needs review',
});

/** K(n): how far one answer moves a rating that already rests on n answers. */
export const uncertaintyK = (n) => ALPHA / (1 + BETA * Math.max(0, Number(n) || 0));

/** The chance of a right answer, from a skill and a difficulty. */
export const pRight = (skill, difficulty) => 1 / (1 + Math.exp(-(skill - difficulty)));

/** A question's starting difficulty from its Bloom level; an unknown level starts in the middle (0). */
export const seedFor = (bloom) => (LEVELS.includes(bloom) ? ITEM_SEED[bloom] : 0);

/** Which question an attempt was at: its id, or the id kept in its snapshot once the question is deleted. */
export const itemKeyOf = (attempt) => String(attempt?.questionId ?? attempt?.questionSnapshot?.id ?? '');

const timeOf = (a) => Date.parse(a?.createdAt ?? '') || 0;

/**
 * Server order: time, then the stored text of the time (Postgres keeps
 * microseconds). Rows of one instant keep the order the store listed them in
 * (the sort is stable): the order they were written, by the store's own key.
 */
export const attemptOrder = (a, b) => (timeOf(a) - timeOf(b))
  || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));

/**
 * Replay every attempt on ONE topic, by every student, in server order.
 *
 * `seedOf(itemKey, attempt)` gives a question's starting difficulty the first
 * time it is met; by default the Bloom level the attempt carries.
 *
 * @returns {{
 *   students: Map<string, { skill, answers, right, attempts, lastAt }>,
 *   items: Map<string, { difficulty, answers }>,
 *   steps: { accountId, item, counted, expected, skillBefore, skillAfter, difficultyBefore, difficultyAfter }[],
 * }}
 *   `answers` are the counted first attempts; `attempts` every attempt.
 */
export function replayTopic(attempts = [], { seedOf = (_key, a) => seedFor(a?.bloom) } = {}) {
  const students = new Map();
  const items = new Map();
  const seen = new Set();
  const steps = [];
  for (const a of [...attempts].sort(attemptOrder)) {
    const who = String(a.accountId ?? '');
    const key = itemKeyOf(a);
    if (!who || !key || typeof a.correct !== 'boolean') continue;
    if (!students.has(who)) students.set(who, { skill: START_SKILL, answers: 0, right: 0, attempts: 0, lastAt: null });
    if (!items.has(key)) items.set(key, { difficulty: seedOf(key, a), answers: 0 });
    const s = students.get(who);
    const item = items.get(key);
    s.attempts += 1;
    s.lastAt = a.createdAt ?? s.lastAt;
    const first = !seen.has(`${who}\u0000${key}`);
    seen.add(`${who}\u0000${key}`);
    const step = { accountId: who, item: key, counted: first, skillBefore: s.skill, difficultyBefore: item.difficulty };
    if (first) {
      const r = a.correct ? 1 : 0;
      const expected = pRight(s.skill, item.difficulty);
      const kStudent = uncertaintyK(s.answers);
      const kItem = uncertaintyK(item.answers);
      s.skill += kStudent * (r - expected);
      item.difficulty -= kItem * (r - expected);
      s.answers += 1;
      if (a.correct) s.right += 1;
      item.answers += 1;
      step.expected = expected;
    }
    steps.push({ ...step, skillAfter: s.skill, difficultyAfter: item.difficulty });
  }
  return { students, items, steps };
}

/** The median of a list of difficulties: the topic's typical question. With none, the middle of the scale (0). */
export function typicalDifficulty(difficulties = []) {
  const xs = difficulties.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** "about 7 in 10", rounded down so an estimate never reads higher than it is. */
const outOfTen = (p) => Math.max(0, Math.min(10, Math.floor(p * 10 + 1e-9)));

const answersWord = (n) => `${n} answer${n === 1 ? '' : 's'}`;

const TOO_FEW = (you) => `this topic does not have enough approved questions for that yet, so ${you ? 'your' : 'the'} professor needs to approve more`;

/**
 * A topic's state for one student (H6): which state, the N it rests on, and a
 * plain sentence. `audience` 'student' speaks to the student; 'staff' about them.
 * `reachable`: the most answers the estimate can rest on with the questions
 * approved now (see the header); unbounded when not given.
 *
 * @param {{ answers?: number, attempts?: number, skill?: number, typical?: number, reviewDue?: boolean, reachable?: number }} input
 * @returns {{ state, label, answers, attempts, provisional, pRight: number|null, outOf10: number|null, estimateState, sentence, bankShort?: true }}
 *   `estimateState` is the state the estimate alone gives (Needs review aside);
 *   `bankShort` is there when the next state needs more approved questions than the topic has.
 */
export function topicState({
  answers = 0, attempts = 0, skill = START_SKILL, typical = 0, reviewDue = false, reachable = Infinity,
} = {}, { audience = 'student' } = {}) {
  const you = audience === 'student';
  if (!answers) {
    return {
      state: 'not-started', label: STATE_LABEL['not-started'], answers: 0, attempts, provisional: true, pRight: null, outOf10: null,
      estimateState: 'not-started',
      sentence: you ? 'You have not practised this topic yet.' : 'Not practised in the hub yet.',
    };
  }
  const p = pRight(skill, typical);
  const tens = outOfTen(p);
  let estimateState;
  if (answers < MIN_ANSWERS_FOR_ESTIMATE) estimateState = 'not-sure';
  else if (answers >= MIN_ANSWERS_FOR_MASTERY && p >= MASTERY_P) estimateState = 'mastered';
  else estimateState = 'in-progress';
  const state = reviewDue ? 'needs-review' : estimateState;
  const provisional = estimateState === 'not-sure';
  const likely = you
    ? `from your ${answersWord(answers)}, you would likely get about ${tens} in 10 typical questions on this topic right`
    : `from ${answersWord(answers)}, the estimated chance of a typical question on this topic right is about ${tens} in 10`;
  // The next state needs more answers to different questions than the topic's approved questions can give.
  const bankShort = (estimateState === 'not-sure' && reachable < MIN_ANSWERS_FOR_ESTIMATE)
    || (estimateState === 'in-progress' && reachable < MIN_ANSWERS_FOR_MASTERY);
  let sentence;
  if (estimateState === 'not-sure' && bankShort) {
    sentence = you
      ? `Not sure yet: this rests on ${answersWord(answers)}. A first estimate needs answers to ${MIN_ANSWERS_FOR_ESTIMATE} different questions, and ${TOO_FEW(true)}.`
      : `Not sure yet: ${answersWord(answers)}, and an estimate needs ${MIN_ANSWERS_FOR_ESTIMATE} different questions; ${TOO_FEW(false)}.`;
  } else if (estimateState === 'not-sure') {
    sentence = you
      ? `Not sure yet: this rests on ${answersWord(answers)}. After ${MIN_ANSWERS_FOR_ESTIMATE} answers you get a first estimate.`
      : `Not sure yet: ${answersWord(answers)}, and an estimate needs ${MIN_ANSWERS_FOR_ESTIMATE}.`;
  } else if (estimateState === 'mastered') {
    sentence = `Mastered: ${likely}.`;
  } else if (bankShort) {
    sentence = `In progress: ${likely}. Mastered needs answers to at least ${MIN_ANSWERS_FOR_MASTERY} different questions, and ${TOO_FEW(you)}.`;
  } else if (p >= MASTERY_P) {
    sentence = `In progress: ${likely}. Mastered needs at least ${MIN_ANSWERS_FOR_MASTERY} answers, so a few more will show it.`;
  } else {
    sentence = `In progress: ${likely}. Mastered means about ${Math.round(MASTERY_P * 10)} in 10, from at least ${MIN_ANSWERS_FOR_MASTERY} answers.`;
  }
  if (state === 'needs-review') {
    sentence = you
      ? `Due for review: a short practice set now helps you keep this topic. ${sentence}`
      : `Due for review. ${sentence}`;
  }
  return {
    state,
    label: STATE_LABEL[state],
    answers,
    attempts,
    provisional,
    // No figure while the state is provisional: it would read as more than it is.
    pRight: provisional ? null : Math.round(p * 100) / 100,
    outOf10: provisional ? null : tens,
    estimateState,
    sentence,
    ...(bankShort ? { bankShort: true } : {}),
  };
}

/** A level's name as a student reads it. */
export const levelLabel = (bloom) => LEVEL_LABEL[bloom] ?? bloom;
