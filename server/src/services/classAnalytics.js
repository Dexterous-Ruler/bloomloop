// Phase 3 - class analytics: one class across its last few rooms.
//
// The handoff's Analytics screen for a class: accuracy and participation per
// room (the trend), the accuracy histogram with the three accuracy bands
// (services/insights.js), accuracy at each Bloom level per room so two rooms
// can be compared, attendance per room, and the hardest questions.
//
// Decision 6 (six levels or three bands by default) is open, so every
// level-by-level figure is given both ways: the six levels, and the three level
// bands the gap analysis recommends (LEVEL_BANDS). Which one a screen shows
// first is the screen's choice.
//
// Every figure carries the number of answers it rests on. Where each comes from:
//   accuracy, bands, levels   the room profiles' counted level tallies: graded
//                             digital answers, a professor's reviews in,
//                             redemption's set-asides out, polls never. Rooms
//                             older than the answers table count too.
//   attendance                the room's attendance marks against the class
//                             roster as it is now (services/roster.js)
//   participation             present students (attendance, present or late)
//                             who answered at least once, polls included
//   hardest questions         final graded answer rows (services/itemStats.js),
//                             so a room older than the answers table adds none
// Teacher records are not read here: they are kept apart from these figures
// (decision 3) and are reported per room by the records routes.
//
// Who may ask is decided by the route (routes/classes.js, the class's read
// rule); `rooms` arrive already filtered to the rooms the caller may read.

import { LEVELS, LABEL } from '../bloom.js';
import { countedTotals, hydrate, sessionSettings } from './mastery.js';
import { allAnswers } from './evidence.js';
import { itemAnalysis, MIN_ANSWERS_FOR_BAND } from './itemStats.js';
import { attendanceReport } from './roster.js';
import { BANDS, INSIGHTS_PRIVACY, THRESHOLDS, classLevels, histogram, roomFigures } from './insights.js';
import { basedOn } from './honesty.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/**
 * Decision 6's three level bands (docs/PRODUCT_DECISIONS.md), for class
 * summaries. Not the accuracy bands (Needs support, Developing, Excelling),
 * which place a student by accuracy; these group the six levels.
 */
export const LEVEL_BANDS = Object.freeze([
  { id: 'lower', label: 'Remember and Understand', levels: ['remember', 'understand'] },
  { id: 'middle', label: 'Apply and Analyse', levels: ['apply', 'analyse'] },
  { id: 'higher', label: 'Evaluate and Create', levels: ['evaluate', 'create'] },
]);

/** The handoff's two ranges, "Last 4 sessions" and "Last 8 sessions". */
export const WINDOWS = Object.freeze([4, 8]);
export const DEFAULT_WINDOW = 4;

/** How many questions the hardest list holds. */
export const HARDEST = 10;

/** ?last= off the query string: 4 or 8, 4 when left out, an honest 400 otherwise. */
export function windowFrom(raw) {
  if (raw === undefined || raw === '') return DEFAULT_WINDOW;
  const n = Number(raw);
  if (!WINDOWS.includes(n)) throw fail(`last must be ${WINDOWS.join(' or ')}: the class's last ${WINDOWS.join(' or ')} rooms.`, 400);
  return n;
}

const rate = (correct, answers) => (answers ? correct / answers : null);

/** Six level cells ({ answers, correct, withdrawn } by level) as the six-level list and the three-band roll-up. */
export function levelViews(cells) {
  const levels = LEVELS.map((level) => ({
    level,
    label: LABEL[level],
    answers: cells[level].answers,
    correct: cells[level].correct,
    accuracy: rate(cells[level].correct, cells[level].answers),
    // The count again, as the sentence a figure carries (Phase 5).
    sentence: basedOn(cells[level].answers, { unit: 'graded answer' }),
  }));
  const levelBands = LEVEL_BANDS.map((b) => {
    const answers = b.levels.reduce((n, l) => n + cells[l].answers, 0);
    const correct = b.levels.reduce((n, l) => n + cells[l].correct, 0);
    return { id: b.id, label: b.label, levels: b.levels, answers, correct, accuracy: rate(correct, answers), sentence: basedOn(answers, { unit: 'graded answer' }) };
  });
  return { levels, levelBands };
}

/**
 * The three level bands of a six-level report as the dashboards and analytics
 * send it ({ level, seen, correct }), summed by levelViews, so every
 * `levelBands` the server sends has one shape and one sum (decision 6).
 */
export function levelBandsOf(report = []) {
  const by = new Map(report.map((r) => [r.level, r]));
  return levelViews(Object.fromEntries(LEVELS.map((l) => [l, { answers: by.get(l)?.seen ?? 0, correct: by.get(l)?.correct ?? 0 }])))
    .levelBands;
}

/** The first and last value of a trend, and the change between them, over the rooms that have one. */
function trendOf(values) {
  const known = values.filter((v) => v !== null && v !== undefined);
  if (!known.length) return { first: null, last: null, change: null, rooms: 0 };
  return { first: known[0], last: known.at(-1), change: known.length > 1 ? known.at(-1) - known[0] : null, rooms: known.length };
}

/** One room's figures, pure: `profiles`, `roster` (the class's) and `marks` (the room's). */
export function roomReport(session, { profiles = [], roster = [], marks = [] } = {}) {
  const f = roomFigures({ session, profiles, roster, marks });
  const count = (id) => f.students.filter((s) => s.band === id).length;
  const att = session.classId ? attendanceReport({ roster, marks, profiles }).counts : null;
  return {
    code: session.code,
    title: session.title ?? '',
    status: session.status,
    startedAt: session.startedAt ?? null,
    closedAt: session.closedAt ?? null,
    mode: sessionSettings(session).mode,
    accuracy: { value: f.accuracy, students: f.graded, answers: f.answers, sentence: basedOn(f.answers, { students: f.graded, unit: 'graded answer' }) },
    participation: { value: f.participation, present: f.present, answered: f.answered, notAnswered: f.present - f.answered },
    attendance: att ? {
      // Present counts late arrivals, as "N / M present" does everywhere.
      present: att.present + att.late,
      late: att.late,
      absent: att.absent,
      unmarked: att.unmarked,
      classSize: att.classSize,
      summary: `${att.present + att.late} / ${att.classSize} present`,
    } : null,
    bands: {
      'needs-support': count('needs-support'),
      developing: count('developing'),
      excelling: count('excelling'),
      notEnough: count(null),
    },
    ...levelViews(classLevels(profiles)),
  };
}

/** A hardest-list item: the item report without its option counts, which live on /items. */
const hardItem = ({ distribution, ...item }) => item;

/**
 * The class's last `last` rooms (newest by when they opened), reported oldest
 * first so a trend reads left to right. `rooms` are the class's rooms the caller
 * may read, any order, any status. A class with no rooms gets empty lists.
 */
export async function classAnalytics(repo, cls, rooms = [], { last = DEFAULT_WINDOW } = {}) {
  const chosen = [...rooms]
    .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
    .slice(0, last)
    .reverse();
  const roster = await repo.listClassStudents(cls._id);
  const read = await Promise.all(chosen.map(async (session) => {
    const [profiles, marks] = await Promise.all([repo.listProfiles(session._id), repo.listAttendance(session._id)]);
    return { session, profiles, marks };
  }));

  const reports = read.map(({ session, profiles, marks }) => roomReport(session, { profiles, roster, marks }));

  // A student over the window: their counted graded answers in every room,
  // pooled by roll number (a class's rooms share its roster and its roll
  // numbers), so a student who missed a room simply has fewer answers.
  const pooled = new Map();
  const cells = Object.fromEntries(LEVELS.map((l) => [l, { answers: 0, correct: 0, withdrawn: 0 }]));
  for (const { profiles } of read) {
    for (const raw of profiles) {
      const p = hydrate(raw);
      const { seen, correct } = countedTotals(p);
      const held = pooled.get(p.rollNo) ?? { answers: 0, correct: 0 };
      held.answers += seen;
      held.correct += correct;
      pooled.set(p.rollNo, held);
    }
    const roomCells = classLevels(profiles);
    for (const l of LEVELS) {
      cells[l].answers += roomCells[l].answers;
      cells[l].correct += roomCells[l].correct;
      cells[l].withdrawn += roomCells[l].withdrawn;
    }
  }

  // The hardest questions over the window's final graded answers, the item
  // report's own reading: flagged items first, then the lowest proportion right.
  // Only questions with at least MIN_ANSWERS_FOR_BAND answers, the item report's
  // floor for calling a question hard at all. Class question votes are left
  // out, as the item report leaves them out (Phase 5).
  const sessionIds = chosen.map((s) => String(s._id));
  const contentIds = [...new Set(chosen.map((s) => String(s.contentId)))];
  const [answers, banks] = await Promise.all([
    sessionIds.length ? allAnswers(repo, { sessionIds, final: true, classVotes: false }) : [],
    Promise.all(contentIds.map((id) => repo.listQuestions(id, { includeDiscarded: true }))),
  ]);
  const report = itemAnalysis({ answers, questions: banks.flat() });
  const enough = report.items.filter((i) => i.attempts >= MIN_ANSWERS_FOR_BAND);
  const hardest = enough
    .sort((a, b) => (b.flags.length ? 1 : 0) - (a.flags.length ? 1 : 0)
      || a.proportionCorrect - b.proportionCorrect
      || b.attempts - a.attempts
      || a.questionId.localeCompare(b.questionId))
    .slice(0, HARDEST)
    .map(hardItem);

  return {
    class: { id: String(cls._id), courseName: cls.courseName, section: cls.section, termLabel: cls.termLabel ?? '' },
    last,
    rooms: reports,
    trend: {
      accuracy: trendOf(reports.map((r) => r.accuracy.value)),
      participation: trendOf(reports.map((r) => r.participation.value)),
    },
    histogram: (() => {
      const h = histogram([...pooled.values()]);
      const short = h.notEnough ? ` ${h.notEnough} more with too few answers for a band are not in it.` : '';
      return { ...h, sentence: `${basedOn(h.answers, { students: h.students, unit: 'graded answer' })}${short}` };
    })(),
    ...levelViews(cells),
    hardest: {
      items: hardest,
      minAttempts: MIN_ANSWERS_FOR_BAND,
      answers: report.counted.answers,
      questions: report.items.filter((i) => i.attempts > 0).length,
      belowFloor: report.items.filter((i) => i.attempts > 0 && i.attempts < MIN_ANSWERS_FOR_BAND).length,
    },
    definitions: {
      thresholds: THRESHOLDS,
      accuracyBands: BANDS,
      levelBands: LEVEL_BANDS,
      display: 'Decision 6 is open: every level figure is given as the six levels (levels) and as the three level bands '
        + '(levelBands). Which a screen shows first is its choice.',
      classSize: 'Attendance counts against the class roster as it is now; students added or removed since a room ran '
        + 'change its class size.',
    },
    privacy: INSIGHTS_PRIVACY,
  };
}
