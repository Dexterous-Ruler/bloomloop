// Phase 5 - the confidence tap: how sure a student says they are of an answer.
//
// Three taps on the phone, Sure, Think so and Guessing, optional on every answer
// (an adaptive answer and a class question's vote alike). It is INFORMATION and
// nothing more: it never changes a score, `correct`, the level ladder, a band,
// an insight or attainment. The live loop stores it on the answer row and no
// reader of the ladder, the bands or a mark ever reads it. Its one use is staff
// counts: per room and per question, how many answers were given at each tap
// and how many of those were right ("6 sure and wrong" is the misconception
// signal the roadmap names), and on the student card the same counts for one
// student. Never a label, and never per answer on a staff screen.
//
// STORED SPELLINGS. answers.confidence has carried a check since 0008 that
// allows 'sure', 'think' and 'guess', and nothing wrote it until now. The taps
// are stored as those three, so no migration widens the check and a database
// that has not applied 0023 still takes every tap. Everything the server sends
// uses the tap's own id: sure, think_so, guessing.

import { allAnswers } from './evidence.js';

export const CONFIDENCE = Object.freeze(['sure', 'think_so', 'guessing']);

export const CONFIDENCE_CHOICES = Object.freeze([
  Object.freeze({ id: 'sure', label: 'Sure' }),
  Object.freeze({ id: 'think_so', label: 'Think so' }),
  Object.freeze({ id: 'guessing', label: 'Guessing' }),
]);

const TO_STORED = Object.freeze({ sure: 'sure', think_so: 'think', guessing: 'guess' });
const FROM_STORED = Object.freeze({ sure: 'sure', think: 'think_so', guess: 'guessing' });

/** Said with every confidence count, so a screen can say what the counts are and are not. */
export const CONFIDENCE_NOTE = 'How sure students said they were, counted beside whether the answer was right. It is '
  + 'information only: it never changes a mark, a level or attainment, and no student is labelled by it.';

/**
 * The tap a phone sent, as one of CONFIDENCE, or null. Optional: anything else,
 * including nothing at all, is no tap. Never a reason to refuse the answer it
 * came with.
 */
export function confidenceFrom(raw) {
  return typeof raw === 'string' && CONFIDENCE.includes(raw) ? raw : null;
}

/** A tap (one of CONFIDENCE) as answers.confidence stores it, or null. */
export const storedConfidence = (tap) => TO_STORED[tap] ?? null;

/** The tap an answer row carries, as one of CONFIDENCE, or null for none. */
export const confidenceOf = (row) => FROM_STORED[row?.confidence] ?? null;

const emptyCell = () => ({ answers: 0, correct: 0, wrong: 0, ungraded: 0 });

/**
 * Answers counted by tap and by whether they were right: for each of
 * CONFIDENCE, and `none` for no tap, { answers, correct, wrong, ungraded }
 * (ungraded is a poll, which has no right answer). Counts only: who gave which
 * is never in it. `rows` are answer rows; the caller picks which (final
 * adaptive answers, or a class question round's votes in force).
 */
export function confidenceCounts(rows = []) {
  const out = Object.fromEntries([...CONFIDENCE, 'none'].map((k) => [k, emptyCell()]));
  for (const a of rows) {
    const cell = out[confidenceOf(a) ?? 'none'];
    cell.answers += 1;
    if (a?.ungraded) cell.ungraded += 1;
    else if (a?.correct === true) cell.correct += 1;
    else cell.wrong += 1;
  }
  return out;
}

/**
 * A room's confidence counts (GET /api/session/:code/confidence): over the
 * room's final answers to the students' own questions, the room's counts, then
 * each question's, in the order they were first answered. A class question's
 * votes are not here: each class question counts its own, round by round
 * (services/classQuestions.js). Counts only, with no roll number or name.
 */
export async function roomConfidence(repo, session) {
  const rows = await allAnswers(repo, { sessionId: session._id, final: true, classVotes: false });
  const byQuestion = new Map();
  for (const a of rows) {
    const snap = a.questionSnapshot ?? {};
    const id = String(a.questionId ?? snap.id ?? '');
    if (!byQuestion.has(id)) {
      byQuestion.set(id, { questionId: id || null, text: String(snap.text ?? ''), level: a.bloom ?? null, kind: a.kind ?? 'mcq', rows: [] });
    }
    byQuestion.get(id).rows.push(a);
  }
  return {
    choices: CONFIDENCE_CHOICES,
    answers: rows.length,
    tapped: rows.filter((a) => confidenceOf(a) !== null).length,
    counts: confidenceCounts(rows),
    questions: [...byQuestion.values()].map(({ rows: mine, ...q }) => ({ ...q, answers: mine.length, counts: confidenceCounts(mine) })),
    note: CONFIDENCE_NOTE,
  };
}
