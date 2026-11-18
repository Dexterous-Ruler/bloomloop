/**
 * /me and /analytics with sample data, for the dev gallery.
 *
 * The data is made the way the server makes it. Answers are simulated per
 * student per room, and everything else - the level tallies, the session rows,
 * strongest and weakest, a professor's roster - is folded out of those answers
 * with the arithmetic of server/src/services/dashboard.js and analytics.js. So
 * the figures on a screen agree with each other, and every object has the
 * shape its route returns.
 *
 * One liberty: answers here carry a topic, so the Topics section can be seen.
 *
 * The stored answers (GET /api/analytics/:id/answers) are written from the
 * same simulated answers, so a list, its grid and the levels above it agree.
 * storedAnswer() is exported for the dashboard gallery, which draws a
 * professor's view of the same kind of row.
 */

import { Fragment, useState } from 'react';

import { AnalyticsView } from '../account/Analytics.jsx';
import { MeView } from '../account/Me.jsx';
import { arrange } from '../account/insightData.js';
import { LEVELS } from '../lib/bloom.js';

/* ------------------------------------------------------------- the answers */

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const CHAPTERS = [
  ['Data link layer', ['Framing', 'Error detection', 'Sliding window']],
  ['Medium access control', ['CSMA/CD', 'Ethernet frames', 'Switching']],
  ['Network layer and IP', ['IPv4 addressing', 'Subnetting', 'Fragmentation']],
  ['Routing algorithms', ['Distance vector', 'Link state', 'Shortest paths']],
  ['Transport layer', ['TCP handshake', 'Flow control', 'UDP']],
  ['Congestion control', ['Slow start', 'Congestion window', 'Fairness']],
  ['Application layer protocols', ['DNS', 'HTTP', 'Email delivery']],
  ['Network security', ['Symmetric keys', 'Public keys', 'TLS']],
  ['Wireless and mobile networks', ['802.11', 'Hidden terminals', 'Handoff']],
];

const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** `count` weekly rooms, the last of them on 17 November less `back` days. */
function roomsFor(seed, count, back = 0) {
  const r = rng(seed);
  return CHAPTERS.slice(0, count).map(([title, topics], i) => ({
    code: Array.from({ length: 6 }, () => CODE[Math.floor(r() * CODE.length)]).join(''),
    title,
    topics,
    status: 'closed',
    startedAt: new Date(Date.UTC(2026, 10, 17 - back - 7 * (count - 1 - i), 4, 30)).toISOString(),
  }));
}

/** One student in one room. Every room starts at Understand, as on the server. */
function sitting(r, skill, room, n) {
  const levels = Object.fromEntries(LEVELS.map((l) => [l, { seen: 0, correct: 0 }]));
  const history = [];
  const asked = [];
  const t0 = Date.parse(room.startedAt);
  let at = 1;
  let run = [];
  let right = 0;

  for (let i = 0; i < n; i += 1) {
    const bloom = LEVELS[at];
    const correct = r() < skill[at];
    levels[bloom].seen += 1;
    if (correct) { levels[bloom].correct += 1; right += 1; }
    history.push({ questionId: `${room.code}-${i + 1}`, bloom, correct, at: new Date(t0 + (i + 1) * 70000).toISOString() });
    asked.push({ topic: room.topics[Math.floor(r() * room.topics.length)], bloom, correct, at: history[history.length - 1].at });

    run.push(correct);
    if (run.length >= 3 && run.slice(-3).every(Boolean) && at < 5) { at += 1; run = []; }
    else if (run.length >= 2 && !run.slice(-2).some(Boolean) && at > 0) { at -= 1; run = []; }
    // The support band: easy and understanding-type questions only.
    if (history.length >= 3 && right / history.length < 0.4 && at > 1) at = 1;
  }

  return {
    room, levels, history, asked, seen: n, correct: right,
    workingLevel: LEVELS[at],
    banded: n >= 3 && right / n < 0.4,
  };
}

/** `skill` is the chance of a right answer at each of the six levels. */
function sittings(seed, skill, rooms, { attend = 0.9, answers } = {}) {
  const r = rng(seed);
  return rooms
    .filter(() => r() < attend)
    .map((room) => sitting(r, skill, room, answers ?? 11 + Math.floor(r() * 6)));
}

const skillOf = (ability) => LEVELS.map((_, l) => Math.min(0.97, Math.max(0.06, ability + 0.1 - l * 0.12)));

/* ---------------------------------------------- the server's arithmetic -- */

const sum = (xs) => xs.reduce((n, x) => n + x, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);

const report = (sat) => LEVELS.map((level) => {
  const seen = sum(sat.map((s) => s.levels[level].seen));
  const correct = sum(sat.map((s) => s.levels[level].correct));
  return { level, seen, correct, accuracy: seen ? correct / seen : null };
});

function extremes(rep) {
  const solid = rep.filter((x) => x.seen >= 3 && x.accuracy !== null);
  if (!solid.length) return { best: null, weakest: null, confident: false };
  const sorted = [...solid].sort((a, b) => b.accuracy - a.accuracy);
  return { best: sorted[0], weakest: sorted[sorted.length - 1], confident: solid.length >= 2 };
}

function topicsOf(sat) {
  const by = new Map();
  for (const { topic, correct } of sat.flatMap((s) => s.asked)) {
    const cell = by.get(topic) ?? { topic, seen: 0, correct: 0 };
    cell.seen += 1;
    if (correct) cell.correct += 1;
    by.set(topic, cell);
  }
  return [...by.values()]
    .map((c) => ({ ...c, accuracy: c.seen ? c.correct / c.seen : null }))
    .sort((a, b) => b.seen - a.seen)
    .slice(0, 12);
}

const accuracyOf = (s) => (s.seen ? s.correct / s.seen : null);

/**
 * The topic report (topicLevels), as services/evidence.js folds it: per topic
 * and per level, every topic carrying all six levels in ladder order, most
 * answered first. `rows` are { topic, level, correct } for final, marked answers.
 */
export function topicReportOf(rows, students = 1) {
  const by = new Map();
  for (const { topic, level, correct } of rows) {
    let t = by.get(topic);
    if (!t) {
      t = { topic, seen: 0, correct: 0, levels: Object.fromEntries(LEVELS.map((l) => [l, { seen: 0, correct: 0 }])) };
      by.set(topic, t);
    }
    t.seen += 1;
    t.levels[level].seen += 1;
    if (correct) { t.correct += 1; t.levels[level].correct += 1; }
  }
  const rate = (c) => (c.seen ? c.correct / c.seen : null);
  const topics = [...by.values()]
    .map((t) => ({
      topic: t.topic, seen: t.seen, correct: t.correct, accuracy: rate(t), students,
      levels: LEVELS.map((level) => ({ level, ...t.levels[level], accuracy: rate(t.levels[level]) })),
    }))
    .sort((a, b) => b.seen - a.seen || a.topic.localeCompare(b.topic));
  return {
    source: rows.length ? 'answers' : 'none',
    counted: { answers: rows.length, history: 0 },
    students: rows.length ? students : 0,
    untagged: 0,
    topics,
  };
}

/** The first twelve, in the old shape, read off the report as the server does. */
const topicsFrom = (topicLevels) => topicLevels.topics
  .slice(0, 12)
  .map(({ topic, seen, correct, accuracy }) => ({ topic, seen, correct, accuracy }));

/** GET /api/analytics/:id for a student. */
function studentRecord(subject, sat) {
  const base = {
    kind: 'student',
    subject: { id: subject.id, name: subject.name, code: subject.code, rollNo: subject.rollNo || null },
    counts: { sessions: 0, answered: 0, correct: 0, accuracy: null },
    bloom: report([]),
    best: null, weakest: null, confident: false,
    topics: [],
    topicLevels: topicReportOf([]),
    timeline: [],
  };
  if (!subject.rollNo) {
    return {
      ...base,
      reason: 'No roll number on this account, and a live session identifies a student by the number '
        + 'they type on their phone - so there is nothing to match their results against yet.',
    };
  }
  const timeline = sat.map((s) => ({
    code: s.room.code, title: s.room.title, startedAt: s.room.startedAt,
    answered: s.seen, correct: s.correct, accuracy: accuracyOf(s),
    workingLevel: s.workingLevel, banded: s.banded,
  }));
  const rep = report(sat);
  const topicLevels = topicReportOf(sat.flatMap((s) => s.asked.map((a) => ({ topic: a.topic, level: a.bloom, correct: a.correct }))));
  return {
    ...base,
    counts: {
      sessions: timeline.length,
      answered: sum(sat.map((s) => s.seen)),
      correct: sum(sat.map((s) => s.correct)),
      accuracy: mean(timeline.filter((s) => s.accuracy !== null).map((s) => s.accuracy)),
    },
    bloom: rep,
    ...extremes(rep),
    topics: topicsFrom(topicLevels),
    topicLevels,
    timeline,
    currentLevel: timeline.length ? timeline[timeline.length - 1].workingLevel : null,
  };
}

/** GET /api/analytics/:id for a professor. `klass` is [{ rollNo, name, sat }]. */
function professorRecord(subject, rooms, klass) {
  const all = klass.flatMap((k) => k.sat);
  const students = klass
    .filter((k) => k.rollNo && k.sat.length)
    .map((k) => {
      const answered = sum(k.sat.map((s) => s.seen));
      const correct = sum(k.sat.map((s) => s.correct));
      return {
        rollNo: k.rollNo, name: k.name, sessions: k.sat.length, answered, correct,
        lastLevel: k.sat[k.sat.length - 1].workingLevel,
        accuracy: answered ? correct / answered : null,
      };
    })
    .sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));
  const rep = report(all);

  return {
    kind: 'professor',
    subject: { id: subject.id, name: subject.name, code: subject.code, active: subject.active },
    counts: {
      sessions: rooms.length,
      students: students.length,
      answered: sum(students.map((s) => s.answered)),
      accuracy: mean(students.filter((s) => s.answered > 0).map((s) => s.correct / s.answered)),
    },
    bloom: rep,
    ...extremes(rep),
    topics: topicsOf(all),
    timeline: rooms.map((room) => {
      const here = all.filter((s) => s.room === room);
      return {
        code: room.code, title: room.title, status: room.status, startedAt: room.startedAt,
        joined: here.length,
        banded: here.filter((s) => s.banded).length,
        accuracy: mean(here.filter((s) => s.seen).map(accuracyOf)),
      };
    }),
    students,
  };
}

/** One row of GET /api/analytics: the subject, and enough of its record to rank it. */
const overviewRow = (subject, record) => ({
  ...subject,
  counts: record.counts,
  best: record.best?.level ?? null,
  weakest: record.weakest?.level ?? null,
  confident: record.confident,
});

/** GET /api/dashboard for a student. */
function dashboardOf(who, sat) {
  const scored = sat.filter((s) => s.seen);
  const latest = sat[sat.length - 1];
  return {
    role: 'student',
    department: who.department,
    rollNo: who.rollNo,
    professor: who.professor,
    counts: {
      sessions: sat.length,
      answered: sum(sat.map((s) => s.seen)),
      correct: sum(sat.map((s) => s.correct)),
      accuracy: mean(scored.map(accuracyOf)),
    },
    workingLevel: latest?.workingLevel ?? null,
    banded: Boolean(latest?.banded),
    bloom: report(sat),
    sessions: sat.map((s) => ({
      code: s.room.code, title: s.room.title, status: s.room.status, startedAt: s.room.startedAt,
      answered: s.seen, correct: s.correct, accuracy: accuracyOf(s),
      workingLevel: s.workingLevel, banded: s.banded,
      history: s.history.slice(-40),
    })).reverse(),
  };
}

/* -------------------------------------------------------- stored answers -- */

/* The kinds each level is asked through, as KINDS_FOR_LEVEL on the server. */
const KINDS = {
  remember: ['mcq', 'truefalse'],
  understand: ['match', 'categorise'],
  apply: ['blank', 'cloze', 'numeric', 'dropdown'],
  analyse: ['multi', 'hottext'],
  evaluate: ['order', 'rank'],
  create: ['open'],
};
/* Kinds marked in parts, so a wrong answer can still carry some credit. */
const PARTIAL = new Set(['match', 'categorise', 'cloze', 'dropdown', 'multi', 'hottext', 'order', 'rank', 'open']);

/** "Flow control" reads as "flow control" mid-sentence; "TCP handshake" and "802.11" stay as they are. */
const mid = (topic) => (/[A-Z0-9]/.test(String(topic).slice(1)) || /^\d/.test(topic) ? topic : topic.charAt(0).toLowerCase() + topic.slice(1));

/*
 * One question per kind, worded around the topic. Each has the fields the
 * phone was shown (`shown`), a right response (`ok`) and wrong ones (`no`),
 * all in shown positions, as the server stores them.
 */
const ASK = {
  mcq: (t) => ({
    text: `Which statement about ${t} is true?`,
    shown: { options: ['It trades extra work now for fewer failures later', 'It removes the need for any checking', 'It only matters on a single machine', 'It is decided once and never revisited'] },
    ok: 0, no: [1, 3, 2],
  }),
  truefalse: (t) => ({ text: `Using ${t} always makes the system faster.`, shown: {}, ok: false, no: [true] }),
  match: (t) => ({
    text: `Match each term from ${t} to its meaning.`,
    shown: { left: ['Precondition', 'Invariant', 'Cost'], right: ['What it spends to work', 'What must hold before it starts', 'What stays true throughout'] },
    ok: [1, 2, 0], no: [[2, 1, 0], [1, 0, 2]],
  }),
  categorise: (t) => ({
    text: `Sort these into what is guaranteed with ${t} and what is left to chance.`,
    shown: { groups: ['Guaranteed', 'Left to chance'], items: ['Speed under load', 'A correct result', 'Fairness between users', 'Safety from the failure it targets', 'The lowest memory use'] },
    ok: { 0: 1, 1: 0, 2: 1, 3: 0, 4: 1 }, no: [{ 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 }, { 0: 0, 1: 1, 2: 0, 3: 1, 4: 1 }],
  }),
  blank: (t) => ({
    text: `Complete the sentence: with ${t}, a ____ is checked before the system goes ahead.`,
    shown: { blankCount: 1 }, ok: 'condition', no: ['shortcut', 'guess'],
  }),
  cloze: (t) => ({
    text: `With ${t}, the system keeps a ____ of the current state and refuses any step that would leave it ____.`,
    shown: { blankCount: 2 }, ok: ['record', 'unsafe'], no: [['copy', 'unsafe'], ['guess', 'faster']],
  }),
  numeric: () => ({
    text: 'Five jobs need 2, 4, 1, 3 and 5 units of time. Run one after another, how many units pass before the last one finishes?',
    shown: { unit: 'units' }, ok: '15', no: ['12', '5'],
  }),
  dropdown: (t) => ({
    text: `When a check in ${t} finds a problem, the system ____ the request and ____ the reason.`,
    shown: { blankCount: 2, gaps: [{ options: ['grants', 'refuses', 'queues'] }, { options: ['hides', 'logs', 'ignores'] }] },
    ok: [1, 1], no: [[0, 1], [2, 0]],
  }),
  multi: (t) => ({
    text: `Which of these would change the behaviour of ${t}? Choose all that apply.`,
    shown: { options: ['How much load there is', 'The colour of the interface', 'The order requests arrive in', 'The name of the file', 'The size of each request'] },
    ok: [0, 2, 4], no: [[0, 1], [2, 3, 4]],
  }),
  hottext: (t) => ({
    text: `In this sentence about ${t}, pick the words that name a risk.`,
    shown: { tokens: ['It', 'guards', 'the', 'system', 'against', 'loss', 'and', 'conflict,', 'not', 'delay.'], criterion: 'what it protects against' },
    ok: [5, 7], no: [[5, 9], [1]],
  }),
  order: (t) => ({
    text: `Put the steps of ${t} in the order they happen.`,
    shown: { items: ['Check the request against the rules', 'Record the new state', 'Receive the request', 'Carry it out'] },
    ok: [2, 0, 3, 1], no: [[0, 2, 3, 1], [2, 3, 0, 1]],
  }),
  rank: (t) => ({
    text: `Rank these changes to ${t} from most to least effective.`,
    shown: { criterion: 'How often it fails', items: ['Retrying faster', 'Checking earlier', 'Logging more', 'Adding memory'] },
    ok: [1, 3, 0, 2], no: [[0, 1, 3, 2], [2, 0, 1, 3]],
  }),
  open: (t) => ({
    text: `Design a small test that shows ${t} doing its job. Say what you would measure and why.`,
    shown: { hint: '3 points to cover' },
    ok: 'Run the same workload twice, once with it and once without, and count how often the failure it targets happens. Keep everything else fixed so any difference comes from it alone.',
    no: ['Run it and see if it works.', 'Check that nothing crashes while it runs, and look at the logs afterwards.'],
  }),
};

/* What a professor decided on a written answer, newest first: the latest not
   read yet, then changed, kept, kept without a word, and changed the other way. */
const REVIEWS = [
  { status: 'provisional', note: '' },
  { status: 'overridden', note: 'The comparison is the right idea even without numbers, so this counts as right.', correct: true, score: 0.8 },
  { status: 'confirmed', note: 'Good: you said what you would measure and why. Keep the workload fixed next time too.' },
  { status: 'confirmed', note: '' },
  { status: 'overridden', note: 'This says what to run but not what to measure. Name the failure you would count.', correct: false, score: 0.33 },
];

const hex = (r) => Array.from({ length: 24 }, () => Math.floor(r() * 16).toString(16)).join('');

/**
 * One stored answer as GET /api/analytics/:id/answers lists it: the student's
 * view, or with `teacher` the professor's (who answered, the snapshot and the
 * machine's first reading beside the mark in force).
 *
 * @param n     which of the kinds and wrong answers to use, so a list varies
 * @param open  for a written answer, how many written answers are newer: it picks the review
 */
export function storedAnswer({ r, room, topic, level, correct, at, n, open = 0, teacher = null, attempt = 1, final = true }) {
  const kinds = KINDS[level];
  const kind = kinds[n % kinds.length];
  const q = ASK[kind](mid(topic));
  const parts = PARTIAL.has(kind);
  const autoScore = correct ? (parts && n % 3 === 0 ? 0.8 : 1) : parts ? [0.33, 0.5, 0][n % 3] : 0;
  const decided = kind === 'open' ? REVIEWS[open % REVIEWS.length] : null;
  const mark = decided?.status === 'overridden' ? { correct: decided.correct, score: decided.score } : { correct, score: autoScore };
  const answerId = hex(r);
  const item = {
    answerId,
    room: { code: room.code, title: room.title, startedAt: room.startedAt },
    topic,
    level,
    kind,
    question: { text: q.text, bloom: level, topic, kind, source: 'llm', ...q.shown },
    response: correct ? q.ok : q.no[n % q.no.length],
    correct: mark.correct,
    score: mark.score,
    ungraded: false,
    review: {
      status: decided?.status ?? 'auto',
      note: decided?.note ?? '',
      reviewedAt: decided && decided.status !== 'provisional' ? new Date(Date.parse(at) + 26 * 3600000).toISOString() : null,
    },
    attempt,
    final,
    answeredAt: at,
  };
  if (!teacher) return item;
  return {
    ...item,
    student: { rollNo: teacher.rollNo, name: '', accountId: teacher.accountId ?? null },
    questionId: hex(r),
    // The key is in here, as the server stores it. No screen draws it.
    snapshot: { id: answerId, text: q.text, kind, bloom: level, topic, source: 'llm', ...(kind === 'open' ? { rubric: ['same workload twice', 'count the failure it targets', 'keep everything else fixed'] } : {}) },
    detail: '',
    auto: { correct, score: autoScore, detail: '' },
    review: { ...item.review, reviewedBy: decided && decided.status !== 'provisional' ? 'acc-prf-014' : null },
    servedAt: new Date(Date.parse(at) - 40000).toISOString(),
    questionSource: 'llm',
  };
}

/** A page of answers, as the route pages them: newest first, narrowed, `hasMore` from one row over. */
export function pageOf(items, { limit = 50, offset = 0, level, topic } = {}) {
  const hit = items.filter((a) => (!level || a.level === level) && (!topic || a.topic === topic));
  return {
    view: items[0]?.snapshot ? 'teacher' : 'student',
    filters: { topic: topic || null, level: level || null, code: null },
    items: hit.slice(offset, offset + limit),
    limit,
    offset,
    hasMore: offset + limit < hit.length,
  };
}

/** One student's sittings as their stored answers, newest first, with one retried attempt among them. */
function answersOf(sat, seed) {
  const r = rng(seed);
  const rows = [];
  let n = 0;
  let open = sat.reduce((k, s) => k + s.asked.filter((a) => a.bloom === 'create').length, 0);
  sat.forEach((s) => s.asked.forEach((a) => {
    if (a.bloom === 'create') open -= 1;
    const row = storedAnswer({ r, room: s.room, topic: a.topic, level: a.bloom, correct: a.correct, at: a.at, n, open });
    n += 1;
    rows.push(row);
  }));
  // A wrong first go, then the retry that counted: stored, and said to be.
  const last = rows.filter((x) => x.correct && x.kind === 'mcq').pop();
  if (last) {
    const first = { ...last, answerId: hex(r), response: 3, correct: false, score: 0, attempt: 1, final: false, answeredAt: new Date(Date.parse(last.answeredAt) - 25000).toISOString() };
    rows.splice(rows.indexOf(last), 1, first, { ...last, attempt: 2 });
  }
  return rows.reverse();
}

/** The answer list's stand-in: a pause long enough to see the skeleton, then a page. */
const answersFrom = (items, { fail = '', never = false } = {}) => (params) => new Promise((resolve, reject) => {
  if (never) return;
  setTimeout(() => (fail ? reject(new Error(fail)) : resolve(pageOf(items, params))), 650);
});

/* ------------------------------------------------- Prof. Arjun Rao's class */

const ARJUN = { id: 'acc-prf-014', kind: 'professor', name: 'Prof. Arjun Rao', code: 'BL-PRF014', active: true };
const ROOMS = roomsFor(14, 8);

const NAMES = [
  'Aarav Sharma', 'Ananya Iyer', 'Kabir Menon', 'Sneha Patil', 'Rohan Gupta', 'Diya Nair',
  'Vivaan Reddy', 'Meher Kaur', 'Arnav Joshi', 'Tanvi Kulkarni', 'Farhan Sheikh', 'Isha Deshmukh',
  'Karthik Subramanian', 'Riya Banerjee', 'Nikhil Bhatt', 'Pooja Yadav', 'Siddharth Rao', 'Zoya Khan',
  'Harsh Agarwal', 'Lavanya Pillai', 'Yash Thakur', 'Nandini Das', 'Pranav Hegde', 'Aisha Fernandes',
  'Dev Malhotra', 'Shruti Mishra', 'Manav Saxena', 'Ira Chatterjee', 'Keerthi Gowda', 'Om Pawar',
];

/* The handful every design has to survive: a strong record, a student in the
   support band, one with two answers to her name, one who has sat nothing,
   a deactivated account, and an account with no roll number. */
const CAST = {
  'Isha Deshmukh': { skill: [0.98, 0.95, 0.92, 0.86, 0.8, 0.5], attend: 1, answers: 20, seed: 9103 },
  'Farhan Sheikh': { skill: [0.42, 0.3, 0.2, 0.1, 0.1, 0.1], attend: 1 },
  'Meher Kaur': { skill: skillOf(0.6), only: 1, answers: 2 },
  'Pranav Hegde': { only: 0 },
  'Dev Malhotra': { skill: skillOf(0.55), active: false, only: 3 },
  'Om Pawar': { noRoll: true, only: 0 },
};

const CLASS = NAMES.map((name, i) => {
  const cast = CAST[name] ?? {};
  const r = rng(700 + i);
  const rooms = cast.only === undefined ? ROOMS : ROOMS.slice(ROOMS.length - cast.only);
  return {
    id: `acc-stu-${203 - 11 + i}`,
    kind: 'student',
    name,
    code: `BL-STU${203 - 11 + i}`,
    rollNo: cast.noRoll ? null : `CSF${String(31 + i).padStart(3, '0')}`,
    active: cast.active !== false,
    sat: sittings(cast.seed ?? 9000 + i * 17, cast.skill ?? skillOf(0.38 + r() * 0.5), rooms, { attend: cast.attend ?? 0.88, answers: cast.answers }),
  };
});

const subjectOf = ({ sat, ...subject }) => subject;
const STUDENT_RECORDS = Object.fromEntries(CLASS.map((s) => [s.id, studentRecord(s, s.sat)]));
const PROFESSOR_OVERVIEW = {
  role: 'professor',
  subjects: CLASS.map((s) => overviewRow(subjectOf(s), STUDENT_RECORDS[s.id])),
};

/* ----------------------------------------------------------- Isha's own -- */

const ISHA = CLASS.find((s) => s.name === 'Isha Deshmukh');
const FARHAN = CLASS.find((s) => s.name === 'Farhan Sheikh');
const WHO = { department: 'Computer Science', professor: { code: ARJUN.code, fullName: ARJUN.name } };

const STUDENT_OVERVIEW = {
  role: 'student',
  subjects: [{ id: ISHA.id, kind: 'student', name: ISHA.name, code: ISHA.code, rollNo: ISHA.rollNo, active: true }],
  detail: STUDENT_RECORDS[ISHA.id],
};

const NO_ROLL = { id: ISHA.id, kind: 'student', name: ISHA.name, code: ISHA.code, rollNo: null, active: true };
const NO_ROLL_OVERVIEW = { role: 'student', subjects: [NO_ROLL], detail: studentRecord(NO_ROLL, []) };

const DASH = dashboardOf({ ...WHO, rollNo: ISHA.rollNo }, ISHA.sat);
const DASH_BAND = dashboardOf({ ...WHO, rollNo: FARHAN.rollNo }, FARHAN.sat);

/* Their evidence: GET /api/analytics/:id's topicLevels, and the answer pages. */
const ISHA_TOPICS = { data: STUDENT_RECORDS[ISHA.id].topicLevels };
const FARHAN_TOPICS = { data: STUDENT_RECORDS[FARHAN.id].topicLevels };
const ISHA_ANSWERS = answersOf(ISHA.sat, 4242);
const FARHAN_ANSWERS = answersOf(FARHAN.sat, 4343);
// Rooms that ran before each answer was kept: the report reads them from the
// sittings, and the answer list has nothing to show.
const HISTORY_TOPICS = {
  data: { ...ISHA_TOPICS.data, source: 'history', counted: { answers: 0, history: ISHA_TOPICS.data.counted.answers } },
};
const DASH_NEW = dashboardOf({ ...WHO, rollNo: ISHA.rollNo }, []);
const DASH_NO_ROLL = {
  ...dashboardOf({ department: 'Computer Science', professor: null, rollNo: '' }, []),
  reason: 'Your account has no roll number on it yet, so BloomLoop cannot match you to the sessions '
    + 'you sat. Ask your professor to add it to your account.',
};

/* GET /api/classroom/link. Both sentences are the server's, word for word. */
const LINK = {
  linked: false, email: null, linkedAt: null, source: null, configured: true, reason: '',
  purpose: 'Linking lets your professor place your session marks on your exact Google account when results '
    + 'are posted to Classroom, instead of matching your roll number to a name on the roster. '
    + 'BloomLoop asks Google only who you are - never for your coursework, your mail or your files - '
    + 'and keeps no access to your account afterwards.',
  optional: 'This is optional. A student who never links, or has no Google account at all, sits every session '
    + 'exactly as they do now and is graded exactly as they are now.',
};
const LINKED = { ...LINK, linked: true, email: 'isha.deshmukh@example.edu', linkedAt: '2026-10-02T06:10:00.000Z', source: 'student' };

/* ---------------------------------------------------------- the department */

const FIRST = ['Aditi', 'Rahul', 'Neha', 'Varun', 'Priya', 'Kunal', 'Sana', 'Tejas', 'Mira', 'Akash', 'Jaya', 'Imran'];
const LAST = ['Kapoor', 'Shetty', 'Bose', 'Chavan', 'Mehta', 'Naidu', 'Siddiqui', 'Tiwari', 'Dutta', 'Gokhale'];

function klassFor(seed, size, rooms, lift) {
  const r = rng(seed);
  return Array.from({ length: size }, (_, i) => ({
    rollNo: `${'ABCDEFGH'[seed % 8]}${String(101 + i)}`,
    name: r() < 0.12 ? '' : `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
    sat: sittings(seed * 131 + i, skillOf(lift + r() * 0.5), rooms),
  }));
}

const STAFF = [
  { name: 'Prof. Kavita Nair', rooms: 9, size: 38, lift: 0.42 },
  { name: 'Prof. Sameer Joshi', rooms: 6, size: 27, lift: 0.3 },
  { name: 'Prof. Lakshmi Venkatesh', rooms: 7, size: 41, lift: 0.36 },
  { name: 'Prof. Imran Qureshi', rooms: 4, size: 22, lift: 0.24 },
  { name: 'Prof. Deepa Mukherjee', rooms: 1, size: 19, lift: 0.4 },
  { name: 'Prof. Anil Pawar', rooms: 5, size: 30, lift: 0.34, active: false },
  { name: 'Prof. Rajat Sinha', rooms: 0, size: 0, lift: 0 },
].map((p, i) => {
  const rooms = roomsFor(40 + i, p.rooms, i % 4);
  return {
    subject: { id: `acc-prf-${21 + i}`, kind: 'professor', name: p.name, code: `BL-PRF0${21 + i}`, active: p.active !== false },
    rooms,
    klass: klassFor(3 + i, p.size, rooms, p.lift),
  };
});
STAFF.unshift({ subject: ARJUN, rooms: ROOMS, klass: CLASS });

const PROFESSOR_RECORDS = Object.fromEntries(STAFF.map((p) => [p.subject.id, professorRecord(p.subject, p.rooms, p.klass)]));
const HOD_OVERVIEW = {
  role: 'hod',
  subjects: STAFF.map((p) => overviewRow(p.subject, PROFESSOR_RECORDS[p.subject.id])),
};

/* ------------------------------------------------------------- the screens */

function MeDemo({ dash, link: first = LINK, loading = false, error = '', topics = null, answers = null }) {
  const [busy, setBusy] = useState(loading);
  const [link, setLink] = useState(first);
  const [reads, setReads] = useState(0);
  return (
    <MeView
      dash={dash}
      busy={busy}
      error={error}
      onRefresh={() => { setBusy(true); setReads((n) => n + 1); setTimeout(() => setBusy(loading), 700); }}
      link={link}
      linkBusy={false}
      linkError=""
      onConnect={() => setLink(LINKED)}
      onDisconnect={() => setLink(LINK)}
      topics={topics}
      loadAnswers={answers}
      reads={reads}
    />
  );
}

/* `records` stands in for GET /api/analytics/:id. A person with no entry in
   it is a record that did not load, or with `pending` one still on its way. */
function AnalyticsDemo({ role, overview = null, records = {}, open = '', error = '', pending = false }) {
  const [picked, setPicked] = useState(open);
  const { subjects, sel } = arrange(overview, picked);
  const mine = overview?.role === 'student';
  const full = mine ? overview.detail : (sel && records[sel.id]) || null;
  return (
    <AnalyticsView
      role={overview?.role ?? role}
      ready={Boolean(overview)}
      loading={!overview && !error}
      error={error}
      subjects={subjects}
      sel={sel}
      full={full}
      busy={pending}
      detailError={!mine && sel && !full && !pending ? 'No such person, or not one you can see.' : ''}
      onPick={setPicked}
      onReload={() => {}}
    />
  );
}

const SCREENS = [
  { id: 'me', title: 'Me: eight sessions', role: 'student', note: 'A student with eight sessions: the brief, the path, the six levels, their answers with their professor’s notes, and the topic grid.', el: <MeDemo dash={DASH} topics={ISHA_TOPICS} answers={answersFrom(ISHA_ANSWERS)} /> },
  { id: 'me-new', title: 'Me: brand-new student', role: 'student', note: 'No sessions yet: the designed first-time page.', el: <MeDemo dash={DASH_NEW} /> },
  { id: 'me-band', title: 'Me: support band, Google linked', role: 'student', note: 'Under 40% last session, so the support band is explained.', el: <MeDemo dash={DASH_BAND} link={LINKED} topics={FARHAN_TOPICS} answers={answersFrom(FARHAN_ANSWERS)} /> },
  { id: 'me-no-roll', title: 'Me: no roll number', role: 'student', note: 'The server cannot match this account to any session.', el: <MeDemo dash={DASH_NO_ROLL} /> },
  { id: 'analytics-hod', title: 'Analytics: head of department', role: 'hod', note: 'The department brief, the professors and one professor in full.', el: <AnalyticsDemo overview={HOD_OVERVIEW} records={PROFESSOR_RECORDS} open={ARJUN.id} /> },
  { id: 'analytics-professor', title: 'Analytics: professor', role: 'professor', note: 'The class brief, thirty students and one student in full.', el: <AnalyticsDemo overview={PROFESSOR_OVERVIEW} records={STUDENT_RECORDS} open={ISHA.id} /> },
  { id: 'analytics-student', title: 'Analytics: student', role: 'student', note: 'A student’s own strengths and gaps.', el: <AnalyticsDemo overview={STUDENT_OVERVIEW} /> },

  // The states nobody sees until something is missing or broken.
  { id: 'me-loading', title: 'Me: first read', role: 'student', note: 'The shaped skeleton before the first answer.', el: <MeDemo dash={null} loading link={null} /> },
  { id: 'me-failed', title: 'Me: did not load', role: 'student', note: 'The server could not be asked.', el: <MeDemo dash={null} error="Failed to fetch" link={null} /> },
  { id: 'me-stale', title: 'Me: refresh failed', role: 'student', note: 'A refresh failed; the last answer stays, an unconfirmed Google link, and the answers and topics that did not load.', el: <MeDemo dash={DASH} error="Failed to fetch" link={{ ...LINKED, source: 'roster' }} topics={{ error: 'Failed to fetch' }} answers={answersFrom([], { fail: 'Failed to fetch' })} /> },
  { id: 'me-evidence-waiting', title: 'Me: answers on their way', role: 'student', note: 'The page is in; the answers and the topic grid are still loading.', el: <MeDemo dash={DASH} answers={answersFrom([], { never: true })} /> },
  { id: 'me-evidence-history', title: 'Me: rooms from before answers were kept', role: 'student', note: 'The topic report comes from older sittings, so the answer list explains why it is empty.', el: <MeDemo dash={DASH} topics={HISTORY_TOPICS} answers={answersFrom([])} /> },
  { id: 'me-wrong-role', title: 'Me: opened by a professor', role: 'professor', note: 'A professor who typed /me is sent to their own dashboard.', el: <MeDemo dash={{ role: 'professor' }} link={null} /> },
  { id: 'analytics-loading', title: 'Analytics: first read', role: 'professor', note: 'The shaped skeleton before the list arrives.', el: <AnalyticsDemo role="professor" /> },
  { id: 'analytics-failed', title: 'Analytics: did not load', role: 'professor', note: 'The list did not come back.', el: <AnalyticsDemo role="professor" error="Failed to fetch" /> },
  { id: 'analytics-nobody', title: 'Analytics: nobody yet', role: 'hod', note: 'A head of department with no professors.', el: <AnalyticsDemo overview={{ role: 'hod', subjects: [] }} /> },
  { id: 'analytics-record-loading', title: 'Analytics: record on its way', role: 'professor', note: 'The list is in; the open record is still loading.', el: <AnalyticsDemo overview={PROFESSOR_OVERVIEW} pending /> },
  { id: 'analytics-record-failed', title: 'Analytics: record did not load', role: 'professor', note: 'The open record was refused or failed.', el: <AnalyticsDemo overview={PROFESSOR_OVERVIEW} /> },
  { id: 'analytics-no-roll', title: 'Analytics: student with no roll number', role: 'student', note: 'A student whose account has no roll number.', el: <AnalyticsDemo overview={NO_ROLL_OVERVIEW} /> },
];

// Keyed, so stepping from one entry to the next starts the screen afresh and
// does not carry the last entry's state into it.
export default SCREENS.map(({ el, ...entry }) => ({ ...entry, render: () => <Fragment key={entry.id}>{el}</Fragment> }));
