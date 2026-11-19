// Phase 2 - how each question behaved in front of a class: classical item
// analysis, read from the answers store (0008).
//
// Once a question has been used, the class's own answers are the best check on
// it (reports/BloomLoop gap analysis and roadmap.md, "Questions from uploaded
// units need a review gate"). For each question this reports how many answered
// it, the proportion who got it right, how many chose each option, a mean score
// where marks are partial, a rough difficulty band for this class, and the
// point-biserial: do the students who did well on everything else tend to get
// this one right? A negative point-biserial is the strongest single sign of a
// wrong answer key, so it is flagged.
//
// What is counted. Final, graded answer rows, with the mark in force (a
// professor's review included): a wrong attempt followed by a retry never
// counted, and a poll assesses nothing. A room run before the answers table
// existed has no rows, and its profile history is NOT read instead: a history
// entry holds no response, so it could give a proportion but never a count per
// option, and one report built from two kinds of evidence is worse than one
// honest gap.
//
// What it cannot say. Calibrating items properly (item response theory) needs
// hundreds of answers per question; one class gives tens. So the band is a band,
// the point-biserial is rough, and both are withheld below the floors set out at
// their constants.
//
// Pure, apart from the two readers at the end, which are handed the repository
// and rooms a route has already vetted (ownership.js): who may ask is decided by
// the routes, never here.

import { LEVELS, levelIndex } from '../bloom.js';
import { toOriginalResponse } from '../questionTypes.js';
import { EDITABLE } from './edits.js';
import { DEFAULT_MASTERY_GOAL, DEMOTE_AT, WINDOW } from './mastery.js';
import { roomQuestionIds } from './selector.js';
import { allAnswers } from './evidence.js';
import { labelFor, misconceptionReport } from './misconceptions.js';
import {
  ORIGINAL_LANGUAGE,
  TRANSLATION_NOTE,
  TRANSLATION_WARNING,
  basedOn,
  languageSplit,
  levelCheck,
  questionProvenance,
} from './honesty.js';

/**
 * The band's cut points: the product's own two numbers rather than new ones, so
 * the band says what the rest of the product already says.
 *   easy    at or above DEFAULT_MASTERY_GOAL (0.8): the share at which a room
 *           counts a level as mastered by default, so the class as a whole would
 *           pass the room's default goal on this question.
 *   hard    below DEMOTE_AT (0.4): the accuracy at which the ladder judges a
 *           level too hard for a student and moves them down.
 *   medium  everything between.
 * "For this class" is meant: an adaptive room shows a question to the students
 * the ladder thought ready for it, so a band says how it went for them, not how
 * hard the question is in itself.
 */
export const EASY_AT = DEFAULT_MASTERY_GOAL;
export const HARD_BELOW = DEMOTE_AT;

/**
 * No band below this many answers: the ladder's own window (WINDOW, 5), the
 * fewest answers it reads before moving a student. Below it a single answer
 * moves the proportion by a fifth or more, which can cross a whole band.
 */
export const MIN_ANSWERS_FOR_BAND = WINDOW;

/**
 * No point-biserial below this many students, counting only students who also
 * answered something else in the room (a student with one answer has no "rest"
 * to compare it with).
 *
 * Why 10. A correlation's standard error is roughly (1 - r^2) / sqrt(n - 1),
 * which is a third at 10 students when the true value is near zero, and a half
 * at 5. Under 10 the sign itself is close to a coin toss, and a flag raised on a
 * coin toss teaches a professor to ignore the flag. Much higher would be safer
 * and useless here: a class is 30 to 60 students and an adaptive room shows each
 * question to only part of it, so a floor of 30 would withhold the figure from
 * almost every question one class ever answers. At 10 to 20 students the figure
 * is still rough, and the flag is worded as a reason to look, never a finding.
 */
export const MIN_STUDENTS_FOR_PB = 10;

/** Every floor and cut point, sent with each report so a screen can say what they are. */
export const THRESHOLDS = Object.freeze({
  easyAt: EASY_AT,
  hardBelow: HARD_BELOW,
  minAnswersForBand: MIN_ANSWERS_FOR_BAND,
  minStudentsForPointBiserial: MIN_STUDENTS_FOR_PB,
});

/**
 * Kinds marked all or nothing (questionTypes.js scoreOne). Every other graded
 * kind gives partial credit, so its mean score says something its proportion
 * correct does not: a match where most got two pairs of three is not a match
 * where most got none.
 */
const ALL_OR_NOTHING = ['mcq', 'truefalse', 'blank', 'numeric'];

export const NEGATIVE_POINT_BISERIAL = Object.freeze({
  id: 'negative-point-biserial',
  message: 'Students who did well on their other answers got this one wrong more often than those who did not. '
    + 'The usual cause is a wrong answer key: check the key first, then the wording.',
});

const TOO_FEW = `Fewer than ${MIN_STUDENTS_FOR_PB} students who also answered other questions.`;
const SAME_MARK = 'Everyone got the same mark on it, so it cannot separate stronger students from weaker ones.';
const SAME_REST = 'Everyone\'s other answers came to the same mark, so there is nothing to compare it with.';

/** Below this a sum of squares is rounding, not spread: the mean of [0.1, 0.1, 0.1] is not exactly 0.1. */
const EPSILON = 1e-12;

/* ------------------------------------------------------------ the maths -- */

/** Pearson's r, or null when either list has no spread. */
export function pearson(xs, ys) {
  const n = xs.length;
  if (!n || n !== ys.length) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < EPSILON || syy < EPSILON) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * The point-biserial over `pairs` of { item: 1 | 0, rest }: whether a student
 * got this question right, against their mean mark on everything else.
 *
 * It is Pearson's r with one variable dichotomous, which is the same number as
 * the textbook (M1 - M0) / s * sqrt(p * q) with population standard deviation.
 *
 * Against the REST, not the total. With ten questions a student's total is a
 * tenth made of this very question, which pulls every item's correlation
 * upwards, a bad key's included. And a MEAN, not a count: an adaptive room gives
 * a quick student more questions than a slow one, and a count of right answers
 * would measure speed.
 */
export function pointBiserial(pairs = []) {
  const n = pairs.length;
  if (n < MIN_STUDENTS_FOR_PB) return { r: null, n, note: TOO_FEW };
  const xs = pairs.map((p) => p.item);
  if (xs.every((x) => x === xs[0])) return { r: null, n, note: SAME_MARK };
  const r = pearson(xs, pairs.map((p) => p.rest));
  if (r === null) return { r: null, n, note: SAME_REST };
  return { r, n, note: null };
}

/** easy / medium / hard for this class, or null below MIN_ANSWERS_FOR_BAND. */
export function difficultyBand(proportion, attempts) {
  if (proportion === null || proportion === undefined || attempts < MIN_ANSWERS_FOR_BAND) return null;
  if (proportion >= EASY_AT) return 'easy';
  if (proportion < HARD_BELOW) return 'hard';
  return 'medium';
}

/* ------------------------------------------------------- the answer rows -- */

const snapOf = (a) => (a?.questionSnapshot && typeof a.questionSnapshot === 'object' ? a.questionSnapshot : {});
const kindOf = (a) => a?.kind ?? snapOf(a).kind ?? 'mcq';
/** The question an answer was to: its row, or the snapshot's id once the row is deleted. */
const questionKey = (a) => String(a?.questionId || snapOf(a).id || '').toLowerCase();
/** A student is a roll number IN A ROOM: two sections may both have a 21CS01. */
const studentOf = (a) => `${a.sessionId}:${a.rollNo}`;

/** The mark in force, 0 to 1. A row with no score is marked by `correct`. */
function markOf(a) {
  const s = a?.score === null || a?.score === undefined ? NaN : Number(a.score);
  if (Number.isFinite(s)) return Math.max(0, Math.min(1, s));
  return a?.correct === true ? 1 : 0;
}

/**
 * The answers that count, one per student per question. Rows come in oldest
 * first, and a later final row for the same student and question replaces an
 * earlier one: there should never be two, but a profile write that failed after
 * its answer was stored can let a resend under a new key write a second.
 */
export function gradedAnswers(answers = []) {
  const latest = new Map();
  for (const a of answers) {
    if (!a || a.final === false || a.ungraded || !LEVELS.includes(a.bloom)) continue;
    const q = questionKey(a);
    if (q) latest.set(`${studentOf(a)}|${q}`, a);
  }
  return [...latest.values()];
}

/* ------------------------------------------------------ the distribution -- */

/**
 * The points at which a question offers choices, each with its options in the
 * question's own order and which of them the key says: one row for a list
 * (mcq, multi, true/false, hot text), one per gap, per left-hand item, per item
 * to sort or per grid row. Null for kinds with nothing to choose from: typed
 * answers (blank, cloze, numeric, open, table) and arrangements (order, rank),
 * where an arrangement is one answer of many thousands, not a choice of options.
 */
function choiceRows(q) {
  const list = (a) => (Array.isArray(a) ? a : []);
  const pickFrom = (labels, isKey) => labels.map((text, i) => ({ text: String(text ?? ''), key: isKey(i) }));
  switch (q?.kind ?? 'mcq') {
    case 'mcq':
      return [{ label: null, select: 'one', options: pickFrom(list(q.options), (i) => i === q.answerIdx) }];
    case 'multi':
    case 'hottext': {
      const want = new Set(list(q.answerIdxs).map(Number));
      const labels = q.kind === 'multi' ? list(q.options) : list(q.tokens);
      return [{ label: null, select: 'many', options: pickFrom(labels, (i) => want.has(i)) }];
    }
    case 'truefalse':
      return [{ label: null, select: 'one', options: pickFrom(['True', 'False'], (i) => typeof q.answerBool === 'boolean' && q.answerBool === (i === 0)) }];
    case 'match': {
      const pairs = list(q.pairs);
      return pairs.map((p, i) => ({ label: String(p?.left ?? ''), select: 'one', options: pickFrom(pairs.map((o) => o?.right), (j) => j === i) }));
    }
    case 'categorise': {
      const buckets = list(q.buckets);
      const names = buckets.map((b) => b?.name);
      return buckets.flatMap((b, home) => list(b?.items).map((item) => ({
        label: String(item ?? ''), select: 'one', options: pickFrom(names, (i) => i === home),
      })));
    }
    case 'dropdown':
      return list(q.blanks).map((b, g) => ({
        label: `Gap ${g + 1}`, select: 'one', options: pickFrom(list(b?.options), (i) => i === b?.answerIdx),
      }));
    case 'grid':
      return list(q.rows).map((row, r) => ({
        label: String(row ?? ''), select: 'many', options: pickFrom(list(q.columns), (c) => q.answers?.[r]?.[c] === true),
      }));
    default:
      return null;
  }
}

/** toOriginalResponse()'s answer, as the option indices chosen at each of choiceRows()' rows. */
function picksByRow(kind, orig) {
  switch (kind) {
    case 'mcq':
      return [orig === null ? [] : [orig]];
    case 'truefalse':
      return [orig === true ? [0] : orig === false ? [1] : []];
    case 'multi':
    case 'hottext':
      return [orig];
    case 'match':
    case 'categorise':
    case 'dropdown':
      return orig.map((i) => (i === null ? [] : [i]));
    case 'grid':
      return orig.map((row) => row.flatMap((ticked, c) => (ticked ? [c] : [])));
    default:
      return null;
  }
}

/**
 * What a response's indices point at: each row's label and the text of each of
 * its options, in order. The number of options alone let a list reworded at the
 * same length take the old picks, so a right answer to the old wording landed on
 * whatever option now sits at its index. The key is left out on purpose: a key
 * moved over the same options leaves every pick on the option it was.
 */
const shapeOf = (kind, rows) => JSON.stringify([kind, rows.map((r) => [r.label, r.options.map((o) => o.text)])]);

/**
 * How many chose each option, in the question's own option order.
 *
 * Every response is translated back from the order that student was shown
 * (toOriginalResponse, seeded `rollNo:questionId` exactly as the live loop seeds
 * forStudent), and a fewer-choices student's from the shorter list they were
 * shown, which the live loop records on the answer's snapshot (`shownOptions`).
 *
 * Labels and keys are the question as the class LAST saw it (the newest
 * answer's snapshot). An answer to an earlier version is counted only when that
 * version had the same options, word for word, in the same order; one given
 * before options were added, removed or reworded would land on the wrong option
 * by index, so it is counted in `otherVersions` instead.
 *
 * `select: 'many'` rows (multi, hot text, grid) count every tick, so their counts
 * add up to more than the answers. `unanswered` is how many chose nothing there.
 *
 * Each option also carries its misconception label (0024), the bank question's
 * current one for an option of those words (services/misconceptions.js), or
 * null: so "4 chose C" can be read as "4 chose the option linked to ...".
 */
function distributionOf(list, question) {
  const latest = list.length ? { ...snapOf(list[list.length - 1]), kind: kindOf(list[list.length - 1]) } : question;
  const base = latest ? choiceRows(latest) : null;
  if (!base) return null;
  const want = shapeOf(latest.kind ?? 'mcq', base);
  const rows = base.map((r) => ({
    label: r.label,
    select: r.select,
    options: r.options.map((o, index) => ({
      index, text: o.text, count: 0, key: o.key, misconception: question ? labelFor(question, o.text) : null,
    })),
    unanswered: 0,
  }));
  let counted = 0;
  let otherVersions = 0;
  for (const a of list) {
    const snap = { ...snapOf(a), kind: kindOf(a) };
    const mine = choiceRows(snap);
    if (!mine || shapeOf(snap.kind, mine) !== want) {
      otherVersions += 1;
      continue;
    }
    const qid = String(snap.id || a.questionId || '');
    const keep = Array.isArray(snap.shownOptions) ? snap.shownOptions : null;
    const picks = picksByRow(snap.kind, toOriginalResponse(snap, a.response, `${a.rollNo}:${qid}`, keep));
    counted += 1;
    picks.forEach((chosen, r) => {
      if (!chosen.length) rows[r].unanswered += 1;
      for (const i of chosen) rows[r].options[i].count += 1;
    });
  }
  return { answers: counted, rows, otherVersions };
}

/* -------------------------------------------------------------- the items -- */

/**
 * The snapshot as a version of the question: the fields that say what was asked
 * (EDITABLE: wording, level, kind and payload), each only where it holds
 * something. Not what rides along with them - the model, the slides, who approved
 * it and when, a fewer-choices student's shorter list - which differs between
 * snapshots of one unchanged question: absent before the approval gate, empty
 * after it, stamped once an older question is approved.
 */
const versionOf = (a) => {
  const snap = { ...snapOf(a), kind: kindOf(a) };
  return JSON.stringify(EDITABLE.filter((f) => snap[f] !== undefined && snap[f] !== null).map((f) => [f, snap[f]]));
};

function itemFor(id, list, question, totals) {
  const latest = list[list.length - 1] ?? null;
  const snap = latest ? snapOf(latest) : {};
  const kind = question?.kind ?? (latest ? kindOf(latest) : 'mcq');
  const attempts = list.length;
  const correct = list.filter((a) => a.correct === true).length;
  const proportionCorrect = attempts ? correct / attempts : null;

  const pairs = [];
  for (const a of list) {
    const t = totals.get(studentOf(a));
    if (t && t.n > 1) pairs.push({ item: a.correct === true ? 1 : 0, rest: (t.sum - markOf(a)) / (t.n - 1) });
  }
  const pb = pointBiserial(pairs);

  return {
    questionId: question ? String(question._id) : id,
    // The bank's question as it stands; `distribution` is as the class last saw it.
    text: question?.text ?? snap.text ?? '',
    kind,
    bloom: question?.bloom ?? latest?.bloom ?? null,
    topic: question?.topic ?? latest?.topic ?? '',
    status: question ? (question.status ?? 'active') : 'deleted',
    // Who wrote it and where it stands at the gate, and whether its level is
    // one to check (Phase 5, services/honesty.js). A deleted question is read
    // off the newest answer's snapshot, which keeps the source and the model;
    // its level is no longer anyone's to check.
    provenance: questionProvenance(question ?? {
      source: snap.source ?? latest?.questionSource ?? 'llm', model: snap.model ?? null, status: 'discarded',
    }),
    levelCheck: question ? levelCheck({ ...question, kind }) : null,
    attempts,
    correct,
    proportionCorrect,
    meanScore: attempts && !ALL_OR_NOTHING.includes(kind) ? list.reduce((s, a) => s + markOf(a), 0) / attempts : null,
    band: difficultyBand(proportionCorrect, attempts),
    // What the difficulty rests on (Phase 5): the answers counted, and whether
    // they are too few for a band at all.
    basis: {
      answers: attempts,
      provisional: attempts < MIN_ANSWERS_FOR_BAND,
      sentence: attempts && attempts < MIN_ANSWERS_FOR_BAND
        ? `${basedOn(attempts).slice(0, -1)}: too few for a difficulty band (${MIN_ANSWERS_FOR_BAND} needed).`
        : basedOn(attempts),
    },
    pointBiserial: pb.r,
    pointBiserialN: pb.n,
    pointBiserialNote: pb.note,
    flags: pb.r !== null && pb.r < 0 ? [{ ...NEGATIVE_POINT_BISERIAL }] : [],
    distribution: distributionOf(list, question ? { ...question, kind } : null),
    versions: new Set(list.map(versionOf)).size,
    // The same answers by the language each was given in, with a warning when
    // two languages' shares right are far apart (Phase 5, languageSplit).
    languages: languageSplit(list),
  };
}

/**
 * Every question's figures from a set of answer rows.
 *
 * `answers` are raw rows from the answers store, oldest first, already limited
 * to the rooms being reported on. `questions` are the bank's rows, for each
 * item's current text and status. `include` lists questions to report even with
 * no answer yet (a room's set, a bank's approved questions), at zero attempts.
 *
 * Each student's rest score is their mean mark over every OTHER graded answer
 * they gave in the same room, whichever questions those were.
 *
 * Flagged items come first, then ladder order, topic and text.
 */
export function itemAnalysis({ answers = [], questions = [], include = [] } = {}) {
  const rows = gradedAnswers(answers);

  const totals = new Map();
  const byQuestion = new Map();
  for (const a of rows) {
    const t = totals.get(studentOf(a)) ?? { sum: 0, n: 0 };
    t.sum += markOf(a);
    t.n += 1;
    totals.set(studentOf(a), t);
    const q = questionKey(a);
    if (!byQuestion.has(q)) byQuestion.set(q, []);
    byQuestion.get(q).push(a);
  }
  for (const id of include) {
    const q = String(id ?? '').toLowerCase();
    if (q && !byQuestion.has(q)) byQuestion.set(q, []);
  }

  const bank = new Map(questions.map((q) => [String(q._id).toLowerCase(), q]));
  const items = [...byQuestion.entries()].map(([id, list]) => itemFor(id, list, bank.get(id) ?? null, totals));
  items.sort((a, b) => (a.flags.length ? 0 : 1) - (b.flags.length ? 0 : 1)
    || levelIndex(a.bloom) - levelIndex(b.bloom)
    || String(a.topic).localeCompare(String(b.topic))
    || String(a.text).localeCompare(String(b.text))
    || a.questionId.localeCompare(b.questionId));

  return {
    counted: { answers: rows.length, students: totals.size },
    thresholds: THRESHOLDS,
    items,
    // When a question's answers in two languages are worth a warning, and how
    // many questions have one (Phase 5).
    translation: {
      original: ORIGINAL_LANGUAGE,
      ...TRANSLATION_WARNING,
      warnings: items.filter((i) => i.languages.warning).length,
      note: TRANSLATION_NOTE,
    },
  };
}

/* --------------------------------------------------------------- readers -- */

/**
 * One room the caller may read: every question answered in it, and every
 * question of its set (sessions.question_ids) even if nobody has reached it yet.
 *
 * A class question's votes (Phase 5) are left out here and below: a question
 * put to the whole class, then discussed and voted on again, did not meet each
 * student on their own, and its own results count its two rounds apart
 * (services/classQuestions.js).
 */
export async function roomItemStats(repo, session) {
  const [answers, questions] = await Promise.all([
    allAnswers(repo, { sessionId: session._id, final: true, classVotes: false }),
    repo.listQuestions(session.contentId, { includeDiscarded: true }),
  ]);
  return itemAnalysis({ answers, questions, include: roomQuestionIds(session) ?? [] });
}

/**
 * One bank across `rooms`, the rooms run on it that the caller may read: every
 * question answered in any of them, and every approved question, answered or not.
 * Deleted rooms are not counted: their answers live on only in the archive.
 */
export async function contentItemStats(repo, content, rooms = []) {
  const sessionIds = rooms.map((r) => String(r._id));
  const [answers, questions] = await Promise.all([
    sessionIds.length ? allAnswers(repo, { sessionIds, final: true, classVotes: false }) : [],
    repo.listQuestions(content._id, { includeDiscarded: true }),
  ]);
  const approved = questions.filter((q) => q.status === 'active').map((q) => q._id);
  return itemAnalysis({ answers, questions, include: approved });
}

/* ------------------------------------------------- misconception counts --

   How many students chose each labelled wrong option (services/misconceptions.js),
   from the same counted answers as the item report above: final, graded, one per
   student per question per room, a class question's votes left out. */

/**
 * One room the caller may read: every labelled question answered in it, and
 * every labelled question of its set, answered or not.
 */
export async function roomMisconceptions(repo, session) {
  const [answers, questions] = await Promise.all([
    allAnswers(repo, { sessionId: session._id, final: true, classVotes: false }),
    repo.listQuestions(session.contentId, { includeDiscarded: true }),
  ]);
  return misconceptionReport({ rows: gradedAnswers(answers), questions, include: roomQuestionIds(session) ?? [], pool: 'roll' });
}

/**
 * A class's rooms, already filtered to those the caller may read: a student is
 * a roll number, pooled across the rooms as class analytics pools them (a
 * class's rooms share its roster), so one who chose an option in two rooms is
 * one student and two answers.
 */
export async function classMisconceptions(repo, rooms = []) {
  const sessionIds = rooms.map((r) => String(r._id));
  const contentIds = [...new Set(rooms.map((r) => String(r.contentId)))];
  const [answers, banks] = await Promise.all([
    sessionIds.length ? allAnswers(repo, { sessionIds, final: true, classVotes: false }) : [],
    Promise.all(contentIds.map((id) => repo.listQuestions(id, { includeDiscarded: true }))),
  ]);
  return misconceptionReport({ rows: gradedAnswers(answers), questions: banks.flat(), pool: 'roll' });
}

/**
 * One question across `rooms`, the rooms on its chapter the caller may read. A
 * student is a roll number in a room: a chapter's rooms may be different
 * classes, and two sections may both have a 21CS01.
 */
export async function questionMisconceptions(repo, question, rooms = []) {
  const sessionIds = rooms.map((r) => String(r._id));
  const answers = sessionIds.length ? await allAnswers(repo, { sessionIds, final: true, classVotes: false }) : [];
  const id = String(question._id).toLowerCase();
  const mine = gradedAnswers(answers).filter((a) => questionKey(a) === id);
  return misconceptionReport({ rows: mine, questions: [question], include: [question._id], pool: 'room' });
}
