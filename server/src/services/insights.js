// Phase 3 - live insights for the professor, and the student card.
//
// The handoff's live view: each student in one of three accuracy bands, three
// insight cards that each end in something to do (Focus, Support,
// Participation), KPI tiles with the change since the room started, and the
// card a professor opens on one student. The gap analysis's rule for all of it
// ("Labels and leaderboards"): a flag describes evidence and never predicts
// failure, it is for staff only, it can be dismissed, it never reaches the
// projector, and what was done about it is recorded.
//
//   Staff-only.  Nothing here goes to a phone or the projector. The routes are
//                teacher-only (routes/insights.js) and the push goes to the
//                teacher room (`teacher:<code>`) only. buildGridRow, which also
//                feeds the phone, is not touched: no band is added to it.
//   Evidence.    Bands, cards and tiles are counted from graded digital answers
//                (the profile's level tallies, a professor's reviews included;
//                polls never count). Teacher records are counted beside them
//                under their own label and never added in (decision 3).
//   No guess.    Below MIN_BAND_ANSWERS graded answers a student has no band:
//                "not enough answers yet", never a guess.
//
// What a room's KPIs looked like earlier (the sparklines and "since the start")
// is held in this process's memory, like the projector's screen and the live
// loop's presence map. A server restart starts the series again; see
// noteSample() for exactly what is lost.

import crypto from 'node:crypto';

import { LEVELS, LABEL, levelIndex } from '../bloom.js';
import {
  hydrate,
  countedTotals,
  countedLevels,
  withdrawnByLevel,
  isSlowLearner,
  eligibleLevels,
  sessionSettings,
  levelEvidence,
  levelMoves,
  masteryBasis,
  SLOW_LEARNER_BAND,
  MIN_EVIDENCE,
} from './mastery.js';
import { basedOn, studentLanguages } from './honesty.js';
import { selectSet, servableFor } from './selector.js';
import { allAnswers, answerItem, rollKey } from './evidence.js';
import { CONFIDENCE_CHOICES, CONFIDENCE_NOTE, confidenceCounts } from './confidence.js';
import { ROLL_SHAPE } from './roster.js';
import {
  OBSERVATION_KINDS,
  STAFF_ONLY,
  currentObservation,
  observationView,
  roomDay,
  roomPeople,
  slotKey,
} from './records.js';
import { pickView } from './wheel.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/** Said with every insight read and push, so no screen can show them without it. */
export const INSIGHTS_PRIVACY = 'Bands, insight cards and the student card are for staff only: never shown on a phone '
  + 'or the projector. They describe answers already given and predict nothing.';

/* ----------------------------------------------------------------- bands -- */

/**
 * The live view's three accuracy bands: one pair of cut points, used by every
 * band, card, tile and histogram on the server.
 *
 *   Needs support  below 0.4. The engine's own line: SLOW_LEARNER_BAND (the
 *                  below-40% band, which serves Remember and Understand only)
 *                  and DEMOTE_AT are both 0.4. So "Needs support" is exactly
 *                  the set of students the engine is already holding under the
 *                  Understand ceiling, read from the same counted figure.
 *   Developing     0.4 up to 0.6.
 *   Excelling      0.6 or more.
 *
 * Why 0.6 and not the handoff's 0.62: the handoff's own histogram legend reads
 * "Below 40%", "40-60%" and "Above 60%", and a band that disagrees with the
 * chart drawn beside it is a band nobody can check. 0.4 and 0.6 also fall on
 * the edges of the 10-point histogram buckets (bucketOf), so each band is a
 * whole number of bars. A default (docs/PRODUCT_DECISIONS.md): decisions 2 and
 * 6 are open, and the owner may want other numbers.
 */
export const BAND_CUTS = Object.freeze({ needsSupportBelow: SLOW_LEARNER_BAND, excellingFrom: 0.6 });

/**
 * No band below this many graded answers: MIN_EVIDENCE (3), the engine's own
 * floor for the below-40% band. With it, "Needs support" and the engine's
 * ceiling start at the same answer; a higher floor would leave a student held
 * under the ceiling with no band to say so.
 */
export const MIN_BAND_ANSWERS = MIN_EVIDENCE;

export const BANDS = Object.freeze([
  { id: 'needs-support', label: 'Needs support', note: 'Below 40% overall: the engine serves Remember and Understand questions only.' },
  { id: 'developing', label: 'Developing', note: '40% to 59% overall.' },
  { id: 'excelling', label: 'Excelling', note: '60% or more overall.' },
]);
const bandLabel = (id) => BANDS.find((b) => b.id === id)?.label ?? null;

/** The cut points and the floor, sent with every read so a screen can say what they are. */
export const THRESHOLDS = Object.freeze({
  needsSupportBelow: BAND_CUTS.needsSupportBelow,
  excellingFrom: BAND_CUTS.excellingFrom,
  minAnswers: MIN_BAND_ANSWERS,
});

/**
 * A band from `correct` right of `answers` graded answers, or null below the
 * floor. Compared as a quotient: correct / answers is correctly rounded, so 2 of
 * 5 lands exactly on 0.4 and 3 of 5 exactly on 0.6, where a product such as
 * 0.4 * 15 would not.
 */
export function bandFor(correct, answers) {
  if (!Number.isInteger(answers) || answers < MIN_BAND_ANSWERS) return null;
  const accuracy = correct / answers;
  if (accuracy < BAND_CUTS.needsSupportBelow) return 'needs-support';
  if (accuracy < BAND_CUTS.excellingFrom) return 'developing';
  return 'excelling';
}

/**
 * The 10-point bucket (0 to 9) of `correct` right of `answers`. Integer
 * arithmetic, so 4 of 10 is bucket 4, not 3; 100% shares the top bucket. Buckets
 * 0-3 are Needs support, 4-5 Developing and 6-9 Excelling, the handoff's legend.
 */
export function bucketOf(correct, answers) {
  return Math.min(9, Math.floor((10 * correct) / answers));
}

/** The 10 buckets of a list of { correct, answers }, and the three bands' counts beside them. */
export function histogram(students = []) {
  const counts = Array(10).fill(0);
  let answers = 0;
  let notEnough = 0;
  for (const s of students) {
    if (bandFor(s.correct, s.answers) === null) { notEnough += 1; continue; }
    counts[bucketOf(s.correct, s.answers)] += 1;
    answers += s.answers;
  }
  const sum = (a, b) => counts.slice(a, b).reduce((n, x) => n + x, 0);
  return {
    buckets: counts.map((n, i) => ({ from: i * 10, to: i * 10 + 10, students: n })),
    legend: [
      { band: 'needs-support', label: 'Below 40%', students: sum(0, 4) },
      { band: 'developing', label: '40-60%', students: sum(4, 6) },
      { band: 'excelling', label: '60% and above', students: sum(6, 10) },
    ],
    students: counts.reduce((n, x) => n + x, 0),
    answers,
    notEnough,
  };
}

/**
 * One student's standing in a room, from their profile: counted graded answers
 * (redemption's set-asides out, a professor's reviews in), the band, and the
 * level the ladder has them on. `answered` counts every answer, polls included:
 * it is participation, not accuracy.
 */
export function standingOf(raw) {
  const p = hydrate(raw);
  const { seen, correct } = countedTotals(p);
  const band = bandFor(correct, seen);
  return {
    rollNo: p.rollNo,
    name: p.name,
    workingLevel: p.workingLevel,
    answers: seen,
    correct,
    accuracy: seen ? correct / seen : null,
    band,
    answered: p.history.length,
  };
}

/** Why a student is in their band, or why they have none, in words. */
export function bandReason({ correct, answers, band }) {
  if (band === null) {
    return answers
      ? `${answers} graded answer${answers === 1 ? '' : 's'} so far; a band needs at least ${MIN_BAND_ANSWERS}.`
      : 'No graded answers yet.';
  }
  return `${correct} of ${answers} graded answers right (${Math.round((correct / answers) * 100)}%): ${bandLabel(band)}.`;
}

/**
 * What a band rests on (Phase 5): the graded answers, and whether they are too
 * few for a band at all, which is provisional and never a firm state.
 */
export const bandBasis = (s) => ({ answers: s.answers, provisional: s.answers < MIN_BAND_ANSWERS, sentence: bandReason(s) });

/* ---------------------------------------------------------------- figures -- */

/**
 * Everything the room's KPIs and cards are counted from, pure. `roster` and
 * `marks` matter only in a class room (who is present). Teacher-led rooms take
 * no digital answers, so their digital figures are null rather than a 0% that
 * reads like a class that did nothing.
 */
export function roomFigures({ session, profiles = [], roster = [], marks = [] }) {
  const students = profiles.map(standingOf);
  const graded = students.filter((s) => s.answers > 0);
  const banded = students.filter((s) => s.band !== null);
  const people = roomPeople({ session, roster, marks, profiles });
  const answeredRolls = new Set(students.filter((s) => s.answered > 0).map((s) => s.rollNo));
  const present = people.filter((p) => p.present);
  const silent = present.filter((p) => !answeredRolls.has(p.rollNo));
  const teacherLed = sessionSettings(session).mode === 'teacher-led';
  return {
    teacherLed,
    students,
    present: present.length,
    presentRolls: present.map((p) => p.rollNo),
    silentRolls: silent.map((p) => p.rollNo),
    // The mean of each student's accuracy, as the room list and the dashboards
    // count it: a student with forty answers does not outvote one with four.
    accuracy: !teacherLed && graded.length
      ? graded.reduce((n, s) => n + s.correct / s.answers, 0) / graded.length
      : null,
    answers: graded.reduce((n, s) => n + s.answers, 0),
    graded: graded.length,
    // Null until someone has a band: nobody counted is not "nobody needs support".
    support: !teacherLed && banded.length ? banded.filter((s) => s.band === 'needs-support').length : null,
    banded: banded.length,
    supportRolls: banded.filter((s) => s.band === 'needs-support').map((s) => s.rollNo),
    participation: !teacherLed && present.length ? (present.length - silent.length) / present.length : null,
    answered: present.length - silent.length,
  };
}

/** Per level, counted right and seen over every profile: the class's own figure at each level. */
export function classLevels(profiles = []) {
  const out = Object.fromEntries(LEVELS.map((l) => [l, { answers: 0, correct: 0, withdrawn: 0 }]));
  for (const raw of profiles) {
    const p = hydrate(raw);
    const counted = countedLevels(p);
    const gone = withdrawnByLevel(p);
    for (const l of LEVELS) {
      out[l].answers += counted[l].seen;
      out[l].correct += counted[l].correct;
      out[l].withdrawn += gone[l];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ series --

   A short record of each room's KPIs, for the sparklines and "since the start".

   Sampled per minute: every grid update (every join, answer, review, mark and
   record the grid is pushed for) and every insights read writes the room's
   figures into the point for the current minute, replacing what that minute
   held, so a point is the room as it stood at the last change in that minute.
   Per minute rather than per answer so a long class stays short: at most
   SERIES_POINTS points (three hours), the oldest dropped first.

   "The start" of each KPI is the first value it ever had in this process,
   frozen with its time and how much evidence it rested on: class accuracy from
   the first graded answer, the support count from the first student to reach a
   band, participation from the first student present. It is never moved by the
   cap on points. Early starts rest on little, and each says how little.

   On a server restart all of it is lost: the next grid update or read starts a
   new series, and every "start" is then the first value after the restart (its
   `at` says when). The figures for now are always counted from the store, so
   they are right whatever happened to the series. */

export const SERIES_POINTS = 180;
// The rooms held. Least recently sampled first out; a room evicted simply
// starts a new series at its next update, as after a restart.
export const SERIES_ROOMS = 200;

const series = new Map(); // sessionId -> { since, start: { accuracy, support, participation }, points }

const minuteOf = (iso) => Math.floor(Date.parse(iso) / 60000);

/** Write a room's figures into its series. Returns the series. */
export function noteSample(sessionId, figures, now = new Date()) {
  const key = String(sessionId);
  const at = now.toISOString();
  const held = series.get(key) ?? { since: at, start: { accuracy: null, support: null, participation: null }, points: [] };
  series.delete(key);
  series.set(key, held);
  while (series.size > SERIES_ROOMS) series.delete(series.keys().next().value);

  if (held.start.accuracy === null && figures.accuracy !== null) {
    held.start.accuracy = { value: figures.accuracy, at, answers: figures.answers, students: figures.graded };
  }
  if (held.start.support === null && figures.support !== null) {
    held.start.support = { value: figures.support, at, students: figures.banded };
  }
  if (held.start.participation === null && figures.participation !== null) {
    held.start.participation = { value: figures.participation, at, present: figures.present };
  }
  const point = { at, accuracy: figures.accuracy, support: figures.support, participation: figures.participation };
  const last = held.points.at(-1);
  if (last && minuteOf(last.at) === minuteOf(at)) held.points[held.points.length - 1] = point;
  else held.points.push(point);
  if (held.points.length > SERIES_POINTS) held.points.splice(0, held.points.length - SERIES_POINTS);
  return held;
}

/** A room's series as a screen gets it (a copy), or an empty one. */
export function seriesOf(sessionId) {
  const held = series.get(String(sessionId));
  if (!held) return { since: null, interval: 'minute', start: { accuracy: null, support: null, participation: null }, points: [] };
  return { since: held.since, interval: 'minute', start: structuredClone(held.start), points: held.points.map((p) => ({ ...p })) };
}

/** Forget a room's series and any push waiting for it: the room was deleted. */
export function forgetInsights(sessionId) {
  const key = String(sessionId);
  series.delete(key);
  const timer = pushes.get(key)?.timer;
  if (timer) clearTimeout(timer);
  pushes.delete(key);
}

/**
 * The grid's own sample, from what the grid push has just read (sockets/index.js
 * gridPayload), so the series costs no extra read. In a class room `roster` and
 * `marks` must be what the grid read; when that read failed they are missing and
 * no sample is taken, rather than a sample that counts nobody present.
 */
export function sampleFromGrid(session, { profiles, roster, marks }) {
  try {
    if (session?.classId && (!roster || !marks)) return;
    noteSample(session._id, roomFigures({ session, profiles, roster: roster ?? [], marks: marks ?? [] }));
  } catch (err) {
    console.error('[insights] sample failed:', err);
  }
}

/* ------------------------------------------------------------------ cards --

   Three cards, as the handoff has them, each ending in an action. Each card
   says what the answers show, never what will happen: "3 students are below
   40% overall", not "3 students are at risk".

   Each card has a flag id, `<kind>:<evidence key>`, which the insight-actions
   store (routes/records.js, 0017) records a dismissal or an action against. The
   key is the evidence the card is about, so the id stays the same while that
   evidence does and changes when it changes:

     focus          the bottleneck level              focus:analyse
     support        who is in Needs support           support:<digest of their roll numbers>
     participation  who is present and has not        participation:<digest of their roll numbers>
                    answered

   A card is dismissed while the latest action recorded against its CURRENT id is
   a dismissal. "Its evidence changes" therefore means: the bottleneck moves to
   another level; a student enters or leaves Needs support; a present student
   answers for the first time, or someone silent is marked present. The counts in
   the text moving without that (more answers at the same bottleneck, the
   support count's "since the start") do not bring a card back. A later "acted"
   on the same id ends the dismissal: the latest action wins. */

export const CARD_KINDS = ['focus', 'support', 'participation'];

/** A short, stable digest of a list of roll numbers: the same students, the same digest. */
export function rollsDigest(rolls = []) {
  if (!rolls.length) return 'none';
  return crypto.createHash('sha256').update([...rolls].map(String).sort().join('\n')).digest('hex').slice(0, 16);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const haveOrHas = (n) => (n === 1 ? 'has' : 'have');

/**
 * Focus: the level most students are working at, and how the class has done
 * there. "Working at" is the level the ladder has a student on, counted over
 * students with at least one graded answer: a student who has answered nothing
 * is only at the room's start level, which says nothing. Ties go to the lower
 * level, as the handoff's does.
 */
export function focusCard(figures, levels) {
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const s of figures.students) if (s.answers > 0) counts[s.workingLevel] += 1;
  const most = Math.max(...Object.values(counts));
  if (!most) {
    return {
      kind: 'focus',
      title: 'Focus',
      flagId: 'focus:none',
      text: 'No graded answers yet, so no level stands out.',
      evidence: 'Working levels of students with at least one graded answer.',
      action: null,
      figures: { level: null, students: 0, answers: 0, correct: 0 },
      basis: { students: 0, answers: 0, sentence: 'No graded answers yet.' },
    };
  }
  const level = LEVELS.find((l) => counts[l] === most);
  const cell = levels[level];
  const tail = cell.answers
    ? `${cell.correct} of the ${plural(cell.answers, `${LABEL[level]} answer`, `${LABEL[level]} answers`)} in this room ${cell.answers === 1 ? 'was' : 'were'} right.`
    : `No ${LABEL[level]} answers have been given in this room yet.`;
  return {
    kind: 'focus',
    title: 'Focus',
    flagId: `focus:${level}`,
    text: `${plural(most, 'student is', 'students are')} working at ${LABEL[level]}, the most at any level. ${tail}`,
    evidence: 'Working levels of students with at least one graded answer; graded answers in this room.',
    action: { label: `Ask ${LABEL[level]}`, do: 'ask', level },
    figures: { level, students: most, answers: cell.answers, correct: cell.correct },
    // What the card rests on (Phase 5): every student with a graded answer, and
    // this level's answers in the room.
    basis: {
      students: figures.graded,
      answers: cell.answers,
      sentence: `Based on ${plural(figures.graded, 'student', 'students')} with a graded answer, and `
        + `${plural(cell.answers, `${LABEL[level]} answer`, `${LABEL[level]} answers`)} in this room.`,
    },
  };
}

/** Support: how many students are in Needs support now, and how that compares with the first count. */
export function supportCard(figures, start = null) {
  const now = figures.support;
  const base = {
    kind: 'support',
    title: 'Support',
    flagId: `support:${rollsDigest(figures.supportRolls)}`,
    evidence: `Overall accuracy from at least ${MIN_BAND_ANSWERS} graded answers each; "the start" is the first count in this room.`,
    action: { label: 'Show them', do: 'sort', sort: 'lowest' },
  };
  if (now === null) {
    return {
      ...base,
      text: `Nobody has ${MIN_BAND_ANSWERS} graded answers yet, so nobody is placed in a band.`,
      figures: { now: null, start: null, change: null, banded: 0 },
      basis: { students: 0, sentence: `Nobody has ${MIN_BAND_ANSWERS} graded answers yet.` },
    };
  }
  const was = start?.value ?? null;
  const change = was === null ? null : now - was;
  let compared = '';
  if (change === 0) compared = ', the same as at the start';
  else if (change < 0) compared = `, ${-change} fewer than at the start`;
  else if (change > 0) compared = `, ${change} more than at the start`;
  const text = now
    ? `${plural(now, 'student is', 'students are')} below 40% overall${compared}.`
    : `No student is below 40% overall (${plural(figures.banded, 'student has', 'students have')} ${MIN_BAND_ANSWERS} or more graded answers)${compared}.`;
  return {
    ...base,
    text,
    figures: { now, start: was, change, banded: figures.banded },
    basis: {
      students: figures.banded,
      sentence: `Based on ${plural(figures.banded, 'student', 'students')} with at least ${MIN_BAND_ANSWERS} graded answers each.`,
    },
  };
}

/** Participation: who is present and has not answered yet. */
export function participationCard(figures, session) {
  const silent = figures.silentRolls.length;
  const where = `room ${session.code}`;
  const base = {
    kind: 'participation',
    title: 'Participation',
    evidence: `${figures.present} present · ${where}`,
    action: { label: 'Spin the wheel', do: 'wheel' },
  };
  if (!figures.present) {
    return {
      ...base,
      flagId: 'participation:nobody-present',
      text: session.classId ? 'Nobody is marked present yet.' : 'No phone has joined this room yet.',
      figures: { present: 0, answered: 0, notAnswered: 0 },
      basis: { students: 0, sentence: 'Nobody present yet.' },
    };
  }
  return {
    ...base,
    flagId: `participation:${rollsDigest(figures.silentRolls)}`,
    text: silent
      ? `${plural(silent, 'present student', 'present students')} ${haveOrHas(silent)} not answered yet in this room.`
      : 'Every present student has answered at least once.',
    figures: { present: figures.present, answered: figures.answered, notAnswered: silent },
    basis: { students: figures.present, sentence: `Based on ${plural(figures.present, 'present student', 'present students')}.` },
  };
}

/**
 * The latest action recorded against each flag id, oldest first in, latest out.
 * `actions` are the room's insight actions (repo.listInsightActions).
 */
export function latestActions(actions = []) {
  const out = new Map();
  for (const a of actions) out.set(String(a.flagId), a);
  return out;
}

/** A card with its dismissal state: dismissed while the latest action on its current id is a dismissal. */
export function withActions(card, latest) {
  const last = latest.get(card.flagId) ?? null;
  return {
    ...card,
    dismissed: last?.action === 'dismissed',
    lastAction: last ? { action: last.action, note: last.note ?? '', actedAt: last.actedAt ?? null, actedBy: last.actedBy ?? null } : null,
  };
}

/* ------------------------------------------------------------------- sort -- */

export const SORT_KEYS = Object.freeze([
  { id: 'band', label: 'By band', rule: 'Needs support, then Developing, then Excelling, then students with too few answers; lowest accuracy first within each.' },
  { id: 'lowest', label: 'Lowest first', rule: 'Lowest accuracy first; students with no graded answer last.' },
  { id: 'roll', label: 'Roll', rule: 'Roll-number order, numerically.' },
]);

const BAND_ORDER = ['needs-support', 'developing', 'excelling', null];
const byRollNo = (a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true });
const byAccuracy = (a, b) => (a.accuracy === null) - (b.accuracy === null) || (a.accuracy ?? 0) - (b.accuracy ?? 0) || byRollNo(a, b);

/** The three orders, as roll numbers, so every screen sorts the same way. */
export function sortOrders(students = []) {
  return {
    band: [...students].sort((a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || byAccuracy(a, b)).map((s) => s.rollNo),
    lowest: [...students].sort(byAccuracy).map((s) => s.rollNo),
    roll: [...students].sort(byRollNo).map((s) => s.rollNo),
  };
}

/* -------------------------------------------------------- teacher records -- */

/**
 * A Mixed or Teacher-led room's teacher records, counted: hands raised (per
 * question asked aloud), answered aloud (wheel picks marked Answered), and the
 * marks in force today by kind. Their own label and their own counts, never
 * added to accuracy or a band (decision 3).
 */
export async function teacherRecordCounts(repo, session) {
  const day = roomDay(session);
  const [events, picks, tallies, activities] = await Promise.all([
    session.classId
      ? repo.listObservations({ classId: session.classId, day })
      : repo.listObservations({ sessionId: session._id }),
    repo.listWheelPicks(session._id),
    repo.listTallies(session._id),
    repo.listActivities(session._id),
  ]);
  const latest = new Map();
  for (const e of events) if (session.classId || e.day === day) latest.set(slotKey(e), e);
  const observations = Object.fromEntries(OBSERVATION_KINDS.map((k) => [k.id, 0]));
  for (const e of latest.values()) if (e.kind && e.kind in observations) observations[e.kind] += 1;
  const status = (id) => picks.filter((p) => p.status === id).length;
  return {
    label: 'Teacher records',
    handsRaised: {
      questions: tallies.length,
      hands: tallies.reduce((n, t) => n + (Array.isArray(t.counts) ? t.counts.reduce((a, b) => a + (Number(b) || 0), 0) : 0), 0),
    },
    answeredAloud: status('answered'),
    wheel: {
      picks: picks.length,
      answered: status('answered'),
      passed: status('passed'),
      help: status('help'),
      skipped: status('skipped'),
      absent: status('absent'),
      pending: status('pending'),
    },
    observations: { ...observations, observed: [...latest.values()].filter((e) => e.kind).length },
    activities: activities.length,
    note: 'Counted apart from the digital answers: never added to accuracy, a band or a card.',
    privacy: STAFF_ONLY,
  };
}

/* ----------------------------------------------------------- the room read -- */

const kpi = (label, value, start, extra) => ({
  label,
  value,
  ...extra,
  start,
  change: value !== null && start?.value !== undefined && start?.value !== null ? value - start.value : null,
});

/**
 * Everything the live view needs for one room the caller may read: each
 * student's band, the sort orders, the three cards with their dismissal state,
 * the KPI tiles with their change since the start, the series for the
 * sparklines, and in a Mixed or Teacher-led room the teacher records' counts.
 * Takes a sample as it reads.
 */
export async function roomInsights(repo, session) {
  const { mode } = sessionSettings(session);
  const [profiles, roster, marks, actions] = await Promise.all([
    repo.listProfiles(session._id),
    session.classId ? repo.listClassStudents(session.classId) : [],
    session.classId ? repo.listAttendance(session._id) : [],
    repo.listInsightActions(session._id),
  ]);
  const figures = roomFigures({ session, profiles, roster, marks });
  noteSample(session._id, figures);
  const held = seriesOf(session._id);
  const levels = classLevels(profiles);

  const names = new Map(roster.filter((s) => !s.removedAt).map((s) => [s.rollNo, s.name]));
  const present = new Set(figures.presentRolls);
  const byRoll = new Map(profiles.map((p) => [hydrate(p).rollNo, p]));
  const { adapt } = sessionSettings(session);
  const students = figures.students.map((s) => ({
    rollNo: s.rollNo,
    name: s.name,
    // The roster's name for a class room; null off the roster or with no class.
    rosterName: session.classId ? names.get(s.rollNo) ?? null : null,
    present: present.has(s.rollNo),
    workingLevel: s.workingLevel,
    answers: s.answers,
    correct: s.correct,
    accuracy: s.accuracy,
    band: s.band,
    bandLabel: bandLabel(s.band),
    reason: bandReason(s),
    // What the band and the level rest on (Phase 5): each a count and a
    // sentence, provisional below the engine's own minimum.
    bandBasis: bandBasis(s),
    levelBasis: levelEvidence(byRoll.get(s.rollNo), { adapt }),
    answered: s.answered,
  }));
  const count = (id) => students.filter((s) => s.band === id).length;

  const latest = latestActions(actions);
  const cards = figures.teacherLed ? [] : [
    focusCard(figures, levels),
    supportCard(figures, held.start.support),
    participationCard(figures, session),
  ].map((c) => withActions(c, latest));

  return {
    room: {
      code: session.code,
      title: session.title ?? '',
      status: session.status,
      startedAt: session.startedAt ?? null,
      classId: session.classId ?? null,
      mode,
    },
    thresholds: THRESHOLDS,
    bands: BANDS,
    students,
    counts: {
      'needs-support': count('needs-support'),
      developing: count('developing'),
      excelling: count('excelling'),
      notEnough: count(null),
      students: students.length,
    },
    sort: { keys: SORT_KEYS, orders: sortOrders(students) },
    cards,
    ...(figures.teacherLed
      ? { cardsNote: 'A Teacher-led room takes no answers on phones, so it has no band, card or digital figure. '
          + 'Its teacher records are counted on their own, beside this.' }
      : {}),
    kpis: {
      accuracy: kpi('Class accuracy', figures.accuracy, held.start.accuracy, {
        answers: figures.answers, students: figures.graded,
        sentence: basedOn(figures.answers, { students: figures.graded, unit: 'graded answer' }),
      }),
      support: kpi('Needs support', figures.support, held.start.support, {
        banded: figures.banded,
        sentence: figures.banded
          ? `Based on ${plural(figures.banded, 'student', 'students')} with at least ${MIN_BAND_ANSWERS} graded answers each.`
          : `Nobody has ${MIN_BAND_ANSWERS} graded answers yet.`,
      }),
      participation: kpi('Participation', figures.participation, held.start.participation, {
        answered: figures.answered, present: figures.present,
        sentence: figures.present ? `Based on ${plural(figures.present, 'present student', 'present students')}.` : 'Nobody present yet.',
      }),
    },
    series: { since: held.since, interval: held.interval, points: held.points },
    ...(mode === 'devices' ? {} : { teacherRecords: await teacherRecordCounts(repo, session) }),
    privacy: INSIGHTS_PRIVACY,
  };
}

/* ------------------------------------------------------------------- push --

   teacher:insights, to the room's teacher screens only, whenever the grid is
   pushed. Throttled per room: at most one push every INSIGHTS_PUSH_MS, with one
   more after the last change, so a burst of answers costs one read of the room
   and the last state always arrives. The push reads the room fresh when it
   fires, never the state from when it was asked for. */

export const INSIGHTS_PUSH_MS = 2000;
const pushes = new Map(); // sessionId -> { last, timer }

const teacherRoom = (code) => `teacher:${String(code).toUpperCase()}`;

export function scheduleInsights(io, repo, session) {
  if (!io || !session?.code || !io.sockets.adapter.rooms.get(teacherRoom(session.code))?.size) return;
  const key = String(session._id);
  const state = pushes.get(key) ?? { last: 0, timer: null };
  pushes.set(key, state);
  if (state.timer) return;
  const wait = Math.max(0, state.last + INSIGHTS_PUSH_MS - Date.now());
  state.timer = setTimeout(async () => {
    state.timer = null;
    state.last = Date.now();
    // Rooms nobody has watched for a while drop out, so the map does not grow
    // for the life of the process. A room dropped and watched again simply gets
    // its next push at once.
    if (pushes.size > SERIES_ROOMS) {
      for (const [k, s] of pushes) if (!s.timer && s.last + INSIGHTS_PUSH_MS < state.last) pushes.delete(k);
    }
    try {
      const fresh = await repo.getSession(session._id);
      if (!fresh) {
        forgetInsights(key);
        return;
      }
      io.to(teacherRoom(fresh.code)).emit('teacher:insights', await roomInsights(repo, fresh));
    } catch (err) {
      console.error('[insights] push failed:', err);
    }
  }, wait);
  state.timer.unref?.();
}

/* -------------------------------------------------------- the student card -- */

export const NEXT_SET_SIZE = 5;
export const NEXT_SET_NOTE = 'A plan, not a promise. These are the levels the selector would serve next if this '
  + 'student\'s level held: their working level until its unseen questions run out, then the level below, as the '
  + 'selector does (inside the below-40% band, Remember and Understand in turn). Which question at a level is chosen at '
  + 'random when the phone asks, and any answer can move the level.';

/**
 * "Next set": what the selector would serve next, as levels.
 *
 * The handoff previewed a fixed "3 at the current level, 1 review one level
 * down, 1 stretch one level up". The selector does not schedule a review or a
 * stretch: it serves the working level until its unseen questions run out, then
 * the level below (the cushion), then further down, and only then up; inside the
 * below-40% band it alternates Remember and Understand and never goes above. A
 * preview promising a stretch the selector never serves would be false, so this
 * runs the selector itself (selectSet, which holds the level) over the room's
 * servable questions and reports the levels it gave, each named as the handoff
 * names it: the working level as is, a lower level "review", a higher one
 * "stretch". The ends clip themselves: nothing is below Remember or above
 * Create, and the band never yields a stretch.
 *
 * The question on the student's screen now (the pin) is served first on any
 * reconnect, so the plan starts after it. The room's cap on questions per
 * student shortens the plan.
 */
export function plannedNextSet(raw, bank = [], { size = NEXT_SET_SIZE, cap = null } = {}) {
  const profile = hydrate(raw);
  const done = new Set(profile.history.map((h) => String(h.questionId)));
  const pinId = profile.served?.questionId ? String(profile.served.questionId) : '';
  const pinned = pinId && !done.has(pinId) ? bank.find((q) => String(q._id) === pinId) ?? null : null;
  const spent = profile.history.length + (pinned ? 1 : 0);
  const room = cap ? Math.max(0, Math.min(size, cap - spent)) : size;
  const shadow = pinned
    ? { ...profile, history: [...profile.history, { questionId: pinId, bloom: pinned.bloom, correct: false, at: null }] }
    : profile;
  const picks = room ? selectSet(shadow, bank, room) : [];

  const roleOf = (level) => {
    const d = levelIndex(level) - levelIndex(profile.workingLevel);
    if (d < 0) return 'review';
    if (d > 0) return 'stretch';
    return 'current';
  };
  const order = [];
  const counts = new Map();
  for (const p of picks) {
    if (!counts.has(p.level)) order.push(p.level);
    counts.set(p.level, (counts.get(p.level) ?? 0) + 1);
  }
  const levels = order.map((level) => ({ level, label: LABEL[level], count: counts.get(level), role: roleOf(level) }));
  let empty = null;
  if (!picks.length) {
    empty = cap && room === 0
      ? `This student has reached the room's ${cap} question${cap === 1 ? '' : 's'}.`
      : 'No unseen question is left for this student in what the room serves.';
  }
  return {
    planned: true,
    size: picks.length,
    levels,
    summary: levels.map((l) => `${l.count} ${l.label}${l.role === 'current' ? '' : ` ${l.role}`}`).join(' · '),
    onScreen: pinned ? { level: pinned.bloom, label: LABEL[pinned.bloom] ?? null } : null,
    empty,
    note: NEXT_SET_NOTE,
  };
}

export const LAST_ANSWERS = 10;

/**
 * One student's card in one room the caller may read: who they are, their
 * band, the level being served, accuracy at each level with the answers behind
 * it (and the class's beside it, for the radar), their last ten final answers in
 * the professor's view (evidence.js answerItem: the same view /answers gives),
 * the planned next set, and this room's teacher records about them.
 *
 * The student is a roll number a phone joined the room with, or in a class room
 * a student on its roster (so a Teacher-led room's card works with no phone).
 * Anyone else is a 404.
 */
export async function studentCard(repo, session, rawRoll) {
  const rollNo = rollKey(rawRoll);
  if (!ROLL_SHAPE.test(rollNo)) throw fail('That student was not found.', 404);
  const settings = sessionSettings(session);
  const [profiles, roster, marks] = await Promise.all([
    repo.listProfiles(session._id),
    session.classId ? repo.listClassStudents(session.classId) : [],
    session.classId ? repo.listAttendance(session._id) : [],
  ]);
  const raw = profiles.find((p) => String(p.rollNo) === rollNo) ?? null;
  const onRoster = roster.find((s) => !s.removedAt && s.rollNo === rollNo) ?? null;
  if (!raw && !onRoster) throw fail('That student was not found.', 404);

  const day = roomDay(session);
  const [own, bank, events, picks] = await Promise.all([
    // Every final answer to this student's own questions here, oldest first:
    // the last ten, and the confidence counts. A class question's votes are not
    // theirs alone (Phase 5), so neither reads them.
    allAnswers(repo, { sessionId: session._id, rollNo, final: true, classVotes: false }),
    raw && settings.mode !== 'teacher-led' && session.status !== 'closed'
      ? repo.listQuestions(session.contentId).then((qs) => servableFor(session, qs))
      : [],
    onRoster
      ? repo.listObservations({ classStudentId: onRoster._id, day })
      : repo.listObservations({ sessionId: session._id }).then((all) => all.filter((o) => o.rollNo === rollNo && o.day === day)),
    repo.listWheelPicks(session._id),
  ]);

  const profile = raw ? hydrate(raw) : null;
  const standing = profile ? standingOf(profile) : { answers: 0, correct: 0, accuracy: null, band: null };
  const mine = profile ? countedLevels(profile) : null;
  const gone = profile ? withdrawnByLevel(profile) : null;
  const classCells = classLevels(profiles);
  const mark = onRoster ? marks.find((m) => String(m.classStudentId) === String(onRoster._id)) ?? null : null;
  const name = onRoster?.name ?? profile?.name ?? '';
  const nameOf = new Map([[rollNo, name]]);
  // In a class room the day's mark is the class's, so it may have been set in
  // another of its rooms that day: each event names the room it was set in.
  const rooms = new Map([[String(session._id), session.code]]);
  for (const id of new Set(events.map((e) => String(e.sessionId)))) {
    if (!rooms.has(id)) rooms.set(id, (await repo.getSession(id))?.code ?? null);
  }

  return {
    room: {
      code: session.code,
      title: session.title ?? '',
      status: session.status,
      startedAt: session.startedAt ?? null,
      classId: session.classId ?? null,
      mode: settings.mode,
    },
    student: {
      rollNo,
      name,
      display: name || rollNo,
      studentId: onRoster ? String(onRoster._id) : null,
      onRoster: Boolean(onRoster),
      joined: Boolean(raw),
      attendance: session.classId ? (mark?.status ?? (onRoster ? 'unmarked' : null)) : null,
    },
    band: {
      id: standing.band,
      label: bandLabel(standing.band),
      accuracy: standing.accuracy,
      answers: standing.answers,
      correct: standing.correct,
      reason: bandReason(standing),
      // Below the minimum there is no band, and that is provisional, not a state.
      provisional: standing.answers < MIN_BAND_ANSWERS,
    },
    serving: profile ? {
      level: profile.workingLevel,
      label: LABEL[profile.workingLevel],
      reason: profile.reason,
      eligible: eligibleLevels(profile),
      // The engine's below-40% band: Remember and Understand only, whatever the level.
      ceiling: isSlowLearner(profile),
      adapt: settings.adapt,
      // What the level rests on, and every move the ladder made, newest first,
      // each with its rule, window, share and answers (Phase 5: the history
      // keeps them, so they survive a reload).
      basis: levelEvidence(profile, { adapt: settings.adapt }),
      moves: levelMoves(profile),
    } : null,
    // Per level answered at, what its mastery rests on, against this room's goal.
    mastery: profile ? masteryBasis(profile, { goal: settings.masteryGoal }) : [],
    levels: LEVELS.map((level) => {
      const c = classCells[level];
      const answersAt = mine ? mine[level].seen : 0;
      const correctAt = mine ? mine[level].correct : 0;
      return {
        level,
        label: LABEL[level],
        answers: answersAt,
        correct: correctAt,
        accuracy: answersAt ? correctAt / answersAt : null,
        withdrawn: gone ? gone[level] : 0,
        class: { answers: c.answers, correct: c.correct, accuracy: c.answers ? c.correct / c.answers : null },
      };
    }),
    lastAnswers: {
      items: own.slice(-LAST_ANSWERS).reverse().map((a) => answerItem(a, session, { name })),
      limit: LAST_ANSWERS,
      // Final answers only: an attempt followed by a retry never counted. Every
      // attempt is in GET /api/session/:code/answers?rollNo=.
      final: true,
    },
    // How sure this student said they were, as counts by tap and by right and
    // wrong, over the answers above (Phase 5). Counts only: never per answer,
    // and never a label. It moves nothing on this card or anywhere else.
    confidence: { counts: confidenceCounts(own), choices: CONFIDENCE_CHOICES, note: CONFIDENCE_NOTE },
    // Which of these answers were in a language other than the question's own
    // (Phase 5); each of lastAnswers carries its own `language` too.
    languages: studentLanguages(own),
    nextSet: profile && settings.mode !== 'teacher-led' && session.status !== 'closed'
      ? plannedNextSet(profile, bank, { cap: settings.questionsPerStudent })
      : null,
    records: {
      day,
      observation: (() => {
        const current = currentObservation(events);
        return { current: current ? observationView(current, rooms) : null, history: events.map((e) => observationView(e, rooms)) };
      })(),
      picks: picks.filter((p) => String(p.rollNo) === rollNo).map((p) => pickView(p, { nameOf })),
      privacy: STAFF_ONLY,
    },
    thresholds: THRESHOLDS,
    privacy: INSIGHTS_PRIVACY,
  };
}
