/**
 * Live insights and the student card, drawn from sample data. Development only.
 *
 * The samples are in the shape of GET /api/session/:code/insights and
 * GET /api/session/:code/students/:roll/card (docs/API.md "Phase 3: live
 * insights"). Each student's band and reason sentence are worked out here the
 * way the server does (services/insights.js bandFor and bandReason), and the
 * three orders the same way, so every figure agrees with the others. Acting on
 * or dismissing a card changes the sample only.
 *
 * Phase 5, honest indicators: every student carries `bandBasis` and
 * `levelBasis`, every KPI its `sentence`, every card its `basis`, and the card
 * `serving.basis`, `serving.moves`, `mastery` and `languages`, in the server's
 * own words (services/mastery.js levelEvidence and masteryBasis,
 * services/honesty.js basedOn and studentLanguages). Below three answers a
 * level and a band are provisional, as the server says.
 *
 * The "Live only" entry mounts the real components on a real room on :5050
 * (with the socket feed), so it needs the local server and the teacher key.
 */

import { useState } from 'react';

import { LABEL } from '../lib/bloom.js';
import AccountShell from '../shell/AccountShell.jsx';
import Insights, { InsightsView } from '../teach/Insights.jsx';
import StudentCard, { StudentCardView } from '../teach/StudentCard.jsx';
import useRoomFeed from '../teach/useRoomFeed.js';

/* ------------------------------------------------------------ the server's words */

const THRESHOLDS = { needsSupportBelow: 0.4, excellingFrom: 0.6, minAnswers: 3 };
const BANDS = [
  { id: 'needs-support', label: 'Needs support', note: 'Below 40% overall: the engine serves Remember and Understand questions only.' },
  { id: 'developing', label: 'Developing', note: '40% to 59% overall.' },
  { id: 'excelling', label: 'Excelling', note: '60% or more overall.' },
];
const SORT_KEYS = [
  { id: 'band', label: 'By band', rule: 'Needs support, then Developing, then Excelling, then students with too few answers; lowest accuracy first within each.' },
  { id: 'lowest', label: 'Lowest first', rule: 'Lowest accuracy first; students with no graded answer last.' },
  { id: 'roll', label: 'Roll', rule: 'Roll-number order, numerically.' },
];
const PRIVACY = 'Bands, insight cards and the student card are for staff only: never shown on a phone or the projector. They describe answers already given and predict nothing.';
const STAFF_ONLY = 'Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level.';
const RECORDS_NOTE = 'Counted apart from the digital answers: never added to accuracy, a band or a card.';
const CARDS_NOTE = 'A Teacher-led room takes no answers on phones, so it has no band, card or digital figure. Its teacher records are counted under teacherRecords.';
const NEXT_NOTE = 'A plan, not a promise. These are the levels the selector would serve next if this student\'s level held: their working level until its unseen questions run out, then the level below, as the selector does (inside the below-40% band, Remember and Understand in turn). Which question at a level is chosen at random when the phone asks, and any answer can move the level.';
const EV_FOCUS = 'Working levels of students with at least one graded answer; graded answers in this room.';
const EV_SUPPORT = 'Overall accuracy from at least 3 graded answers each; "the start" is the first count in this room.';

const bandFor = (correct, answers) => {
  if (answers < THRESHOLDS.minAnswers) return null;
  const a = correct / answers;
  if (a < 0.4) return 'needs-support';
  if (a < 0.6) return 'developing';
  return 'excelling';
};
const bandLabel = (id) => BANDS.find((b) => b.id === id)?.label ?? null;
const bandReason = ({ correct, answers, band }) => {
  if (band === null) return answers ? `${answers} graded answer${answers === 1 ? '' : 's'} so far; a band needs at least 3.` : 'No graded answers yet.';
  return `${correct} of ${answers} graded answers right (${Math.round((correct / answers) * 100)}%): ${bandLabel(band)}.`;
};

/* ------------------------------------------------------------ building a room */

const at = (min) => new Date(Date.UTC(2026, 10, 19, 4, 30 + min, 0)).toISOString();

/** [roll, roster name, typed name, correct, answers, working level, present, answered] */
const answersWord = (n) => `${n} ${n === 1 ? 'answer' : 'answers'}`;

/** What a working level rests on, in the server's words (services/mastery.js levelEvidence). */
function levelBasis(answers, workingLevel, band) {
  const here = LABEL[workingLevel];
  if (band === 'needs-support') return { answers, provisional: false, sentence: `Based on ${answersWord(answers)} overall.` };
  if (!answers) return { answers: 0, provisional: true, sentence: `No graded answers yet: ${here} is the room's start level, not an estimate.` };
  if (answers < THRESHOLDS.minAnswers) {
    return { answers, provisional: true, sentence: `Provisional: ${answersWord(answers)} at ${here} so far, and the ladder needs 3 before it can move a student.` };
  }
  const n = Math.min(5, answers);
  return { answers: n, provisional: false, sentence: `Based on the last ${answersWord(n)} at ${here}.` };
}

function student([rollNo, rosterName, typed, correct, answers, workingLevel, present = true, answered = answers]) {
  const band = bandFor(correct, answers);
  const reason = bandReason({ correct, answers, band });
  return {
    rollNo, name: typed ?? rosterName, rosterName, present, workingLevel, answers, correct,
    accuracy: answers ? correct / answers : null, band, bandLabel: bandLabel(band),
    reason, answered,
    bandBasis: { answers, provisional: answers < THRESHOLDS.minAnswers, sentence: reason },
    levelBasis: levelBasis(answers, workingLevel, band),
  };
}

const ORDER = ['needs-support', 'developing', 'excelling', null];
const byRoll = (a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true });
const byAcc = (a, b) => (a.accuracy === null) - (b.accuracy === null) || (a.accuracy ?? 0) - (b.accuracy ?? 0) || byRoll(a, b);
const orders = (s) => ({
  band: [...s].sort((a, b) => ORDER.indexOf(a.band) - ORDER.indexOf(b.band) || byAcc(a, b)).map((x) => x.rollNo),
  lowest: [...s].sort(byAcc).map((x) => x.rollNo),
  roll: [...s].sort(byRoll).map((x) => x.rollNo),
});
const countsOf = (s) => ({
  'needs-support': s.filter((x) => x.band === 'needs-support').length,
  developing: s.filter((x) => x.band === 'developing').length,
  excelling: s.filter((x) => x.band === 'excelling').length,
  notEnough: s.filter((x) => x.band === null).length,
  students: s.length,
});

function room({ code, mode = 'mixed', status = 'open', students, cards, kpis, series, teacherRecords, cardsNote }) {
  return {
    room: { code, title: 'Computer Networks, Unit 4: the transport layer', status, startedAt: at(0), classId: 'ec349fd84c312402e637884a', mode },
    thresholds: THRESHOLDS,
    bands: BANDS,
    students,
    counts: countsOf(students),
    sort: { keys: SORT_KEYS, orders: orders(students), default: 'roll' },
    cards,
    ...(cardsNote ? { cardsNote } : {}),
    kpis,
    series,
    ...(teacherRecords ? { teacherRecords } : {}),
    privacy: PRIVACY,
  };
}

/* ------------------------------------------------------------ a full room */

const FULL_STUDENTS = [
  ['21CS01', 'Aarav Shah', null, 9, 13, 'apply'],
  ['21CS02', 'Aditi Rao', null, 4, 12, 'understand'],
  ['21CS03', 'Ananya Iyer', null, 10, 14, 'analyse'],
  ['21CS04', 'Arjun Patil', null, 6, 11, 'apply'],
  ['21CS05', 'Ishaan Kulkarni', 'ishaan', 3, 10, 'understand'],
  ['21CS06', 'Kavya Nair', null, 7, 12, 'apply'],
  ['21CS07', 'Bilal Khan', null, 6, 13, 'apply'],
  ['21CS08', 'Sneha Joshi', null, 11, 14, 'analyse'],
  ['21CS09', 'Vihaan Mehta', null, 2, 9, 'remember'],
  ['21CS10', 'Diya Kapoor', null, 8, 12, 'apply'],
  ['21CS11', 'Aryan Gupta', null, 5, 11, 'understand'],
  ['21CS12', 'Meera Pillai', null, 9, 12, 'apply'],
  ['21CS13', 'Kabir Singh', null, 1, 2, 'remember'],
  ['21CS14', 'Saanvi Reddy', null, 6, 12, 'understand'],
  ['21CS15', 'Yash Pawar', null, 3, 9, 'understand'],
  ['21CS16', 'Tanvi Bhosale', null, 10, 13, 'analyse'],
  ['21CS17', 'Om Jadhav', null, 5, 10, 'understand'],
  ['21CS18', 'Riya Sharma', null, 0, 0, 'understand', true, 0],
  ['21CS19', 'Neel Chavan', null, 7, 11, 'apply'],
  ['21CS20', 'Pooja Gaikwad', null, 8, 13, 'apply'],
  ['21CS21', 'Siddharth Menon', null, 0, 1, 'remember', false],
  ['21CS22', 'Nisha Verma', null, 6, 10, 'apply'],
  ['21CS23', 'Harsh Thakur', null, 0, 0, 'understand', true, 0],
  ['21CS24', 'Aisha Khan', null, 7, 12, 'apply'],
].map(student);

const graded = FULL_STUDENTS.filter((s) => s.answers > 0);
const FULL_ACC = graded.reduce((n, s) => n + s.accuracy, 0) / graded.length;
const FULL_ANSWERS = graded.reduce((n, s) => n + s.answers, 0);
const FULL_SUPPORT = FULL_STUDENTS.filter((s) => s.band === 'needs-support').length;
const FULL_BANDED = FULL_STUDENTS.filter((s) => s.band).length;
const present = FULL_STUDENTS.filter((s) => s.present);
const answeredPresent = present.filter((s) => s.answered > 0).length;

const wave = (n, from, to, wobble) => Array.from({ length: n }, (_, i) => {
  const t = i / (n - 1);
  return from + (to - from) * t + Math.sin(i * 1.7) * wobble * (1 - t);
});
const ACC_LINE = wave(26, 0.62, FULL_ACC, 0.05);
const SUP_LINE = [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 3, 3, 4, 4, 4, 4, 4, 5, 5, 4, FULL_SUPPORT, FULL_SUPPORT];
const PAR_LINE = wave(26, 0.22, answeredPresent / present.length, 0.02);
const FULL_SERIES = {
  since: at(0), interval: 'minute',
  points: ACC_LINE.map((a, i) => ({ at: at(i), accuracy: a, support: SUP_LINE[i], participation: Math.min(1, PAR_LINE[i]) })),
};

const FULL_KPIS = {
  accuracy: {
    label: 'Class accuracy', value: FULL_ACC, answers: FULL_ANSWERS, students: graded.length, start: { value: 0.62, at: at(0), answers: 3, students: 2 }, change: FULL_ACC - 0.62,
    sentence: `Based on ${FULL_ANSWERS} graded answers from ${graded.length} students.`,
  },
  support: {
    label: 'Needs support', value: FULL_SUPPORT, banded: FULL_BANDED, start: { value: 1, at: at(2), students: 3 }, change: FULL_SUPPORT - 1,
    sentence: `Based on ${FULL_BANDED} students with at least 3 graded answers each.`,
  },
  participation: {
    label: 'Participation', value: answeredPresent / present.length, answered: answeredPresent, present: present.length,
    start: { value: 0.22, at: at(0), present: 18 }, change: answeredPresent / present.length - 0.22,
    sentence: `Based on ${present.length} present students.`,
  },
};

const FOCUS = {
  kind: 'focus', title: 'Focus', flagId: 'focus:apply',
  text: '11 students are working at Apply, the most at any level. 21 of the 38 Apply answers in this room were right.',
  evidence: EV_FOCUS,
  action: { label: 'Ask Apply', do: 'ask', level: 'apply' },
  figures: { level: 'apply', students: 11, answers: 38, correct: 21 }, dismissed: false, lastAction: null,
  basis: { students: graded.length, answers: 38, sentence: `Based on ${graded.length} students with a graded answer, and 38 Apply answers in this room.` },
};
const SUPPORT = {
  kind: 'support', title: 'Support', flagId: 'support:fe76c26d8957b79f',
  text: `${FULL_SUPPORT} students are below 40% overall, ${FULL_SUPPORT - 1} more than at the start.`,
  evidence: EV_SUPPORT,
  action: { label: 'Show them', do: 'sort', sort: 'lowest' },
  figures: { now: FULL_SUPPORT, start: 1, change: FULL_SUPPORT - 1, banded: FULL_BANDED },
  dismissed: false, lastAction: { action: 'acted', note: '', actedAt: at(14), actedBy: null },
  basis: { students: FULL_BANDED, sentence: `Based on ${FULL_BANDED} students with at least 3 graded answers each.` },
};
const SILENT = present.length - answeredPresent;
const PARTICIPATION = {
  kind: 'participation', title: 'Participation', flagId: 'participation:f2e469ca53bd1431',
  text: `${SILENT} present students have not answered yet in this room.`,
  evidence: `${present.length} present · room 7QF2MD`,
  action: { label: 'Spin the wheel', do: 'wheel' },
  figures: { present: present.length, answered: answeredPresent, notAnswered: SILENT }, dismissed: false, lastAction: null,
  basis: { students: present.length, sentence: `Based on ${present.length} present students.` },
};

const RECORDS = {
  label: 'Teacher records', handsRaised: { questions: 3, hands: 41 }, answeredAloud: 4,
  wheel: { picks: 6, answered: 4, passed: 1, help: 1, skipped: 0, absent: 0, pending: 0 },
  observations: { understood: 3, participated: 5, revision: 2, support: 1, observed: 11 }, activities: 2,
  note: RECORDS_NOTE, privacy: STAFF_ONLY,
};

const FULL = room({ code: '7QF2MD', students: FULL_STUDENTS, cards: [FOCUS, SUPPORT, PARTICIPATION], kpis: FULL_KPIS, series: FULL_SERIES, teacherRecords: RECORDS });

const DISMISSED = {
  ...FULL,
  cards: [
    FOCUS,
    { ...SUPPORT, dismissed: true, lastAction: { action: 'dismissed', note: 'Spoke to the four of them at the break; revisiting segments on Friday.', actedAt: at(19), actedBy: null } },
    { ...PARTICIPATION, dismissed: true, lastAction: { action: 'dismissed', note: '', actedAt: at(21), actedBy: null } },
  ],
};

/* ------------------------------------------------------------ an early room */

const EARLY_STUDENTS = [
  ['SIM01', 'Aarav Shah', null, 1, 2, 'remember'],
  ['SIM02', 'Aditi Rao', null, 1, 1, 'remember'],
  ['SIM03', 'Ananya Iyer', null, 2, 2, 'understand'],
  ['SIM04', 'Arjun Patil', null, 0, 1, 'remember'],
  ['SIM05', 'Ishaan Kulkarni', null, 0, 0, 'understand', true, 0],
  ['SIM06', 'Kavya Nair', null, 0, 0, 'understand', true, 0],
  ['SIM07', 'Rohan Deshmukh', null, 1, 1, 'remember'],
  ['SIM08', 'Sneha Joshi', null, 0, 0, 'understand', true, 0],
  ['SIM09', 'Vihaan Mehta', null, 0, 0, 'understand', true, 0],
].map(student);

const EARLY = room({
  code: '4RVP6E', mode: 'devices',
  students: EARLY_STUDENTS,
  cards: [
    {
      kind: 'focus', title: 'Focus', flagId: 'focus:remember',
      text: '4 students are working at Remember, the most at any level. 3 of the 5 Remember answers in this room were right.',
      evidence: EV_FOCUS, action: { label: 'Ask Remember', do: 'ask', level: 'remember' },
      figures: { level: 'remember', students: 4, answers: 5, correct: 3 }, dismissed: false, lastAction: null,
      basis: { students: 5, answers: 5, sentence: 'Based on 5 students with a graded answer, and 5 Remember answers in this room.' },
    },
    {
      kind: 'support', title: 'Support', flagId: 'support:none', evidence: EV_SUPPORT,
      action: { label: 'Show them', do: 'sort', sort: 'lowest' },
      text: 'Nobody has 3 graded answers yet, so nobody is placed in a band.',
      figures: { now: null, start: null, change: null, banded: 0 }, dismissed: false, lastAction: null,
      basis: { students: 0, sentence: 'Nobody has 3 graded answers yet.' },
    },
    {
      kind: 'participation', title: 'Participation', flagId: 'participation:22ca3414bed3af0f',
      text: '4 present students have not answered yet in this room.', evidence: '9 present · room 4RVP6E',
      action: { label: 'Spin the wheel', do: 'wheel' },
      figures: { present: 9, answered: 5, notAnswered: 4 }, dismissed: false, lastAction: null,
      basis: { students: 9, sentence: 'Based on 9 present students.' },
    },
  ],
  kpis: {
    accuracy: { label: 'Class accuracy', value: 0.6, answers: 7, students: 5, start: { value: 1, at: at(1), answers: 1, students: 1 }, change: -0.4, sentence: 'Based on 7 graded answers from 5 students.' },
    support: { label: 'Needs support', value: null, banded: 0, start: null, change: null, sentence: 'Nobody has 3 graded answers yet.' },
    participation: { label: 'Participation', value: 5 / 9, answered: 5, present: 9, start: { value: 0, at: at(0), present: 9 }, change: 5 / 9, sentence: 'Based on 9 present students.' },
  },
  series: { since: at(0), interval: 'minute', points: [
    { at: at(0), accuracy: null, support: null, participation: 0 },
    { at: at(1), accuracy: 1, support: null, participation: 1 / 9 },
    { at: at(2), accuracy: 0.6, support: null, participation: 5 / 9 },
  ] },
});

/* ------------------------------------------------------------ Teacher-led */

const LED = room({
  code: 'J5ENVQ', mode: 'teacher-led', students: [], cards: [], cardsNote: CARDS_NOTE,
  kpis: {
    accuracy: { label: 'Class accuracy', value: null, answers: 0, students: 0, start: null, change: null },
    support: { label: 'Needs support', value: null, banded: 0, start: null, change: null },
    participation: { label: 'Participation', value: null, answered: 0, present: 0, start: null, change: null },
  },
  series: { since: at(0), interval: 'minute', points: [{ at: at(0), accuracy: null, support: null, participation: null }] },
  teacherRecords: {
    ...RECORDS, handsRaised: { questions: 5, hands: 72 }, answeredAloud: 7,
    wheel: { picks: 9, answered: 7, passed: 1, help: 0, skipped: 0, absent: 1, pending: 0 },
    observations: { understood: 6, participated: 9, revision: 3, support: 2, observed: 20 }, activities: 3,
  },
});

/* ------------------------------------------------------------ the card */

const Q = [
  ['Which field of the TCP header lets the receiver put arriving segments back in order?', 'apply', true],
  ['A sender has 4 unacknowledged segments and receives three duplicate ACKs for the second. What does TCP Reno do next?', 'apply', false],
  ['Sort these terms from Transmission Control Protocol by which idea the material discusses each one with.', 'understand', true],
  ['Explain why UDP suits a live voice call better than TCP.', 'understand', false],
  ['What does the receive window advertise to the sender?', 'understand', true],
  ['Name the three steps of the TCP connection set-up.', 'remember', true],
];
const ANSWERS = Q.map(([text, level, correct], i) => ({
  answerId: `a${i}`, level, kind: i === 3 ? 'open' : 'mcq', topic: i < 2 ? 'Reliable transfer' : 'Transmission Control Protocol',
  question: { text, bloom: level }, response: 0, correct, score: i === 3 ? 0.5 : correct ? 1 : 0, ungraded: false,
  review: { status: i === 3 ? 'provisional' : 'auto', note: '', reviewedAt: null }, attempt: 1, final: true, answeredAt: at(22 - i * 3),
  language: 'en',
}));

/** Every move the ladder made for 21CS07, newest first (services/mastery.js levelMoves). */
const move = (min, rule, from, to, share, answers, reason) => ({ at: at(min), questionId: `q${min}`, rule, from, to, window: 5, share, answers, reason });
const MOVES = [
  move(19, 'demote', 'analyse', 'apply', 0.3333, 3, '33% at Analyse over the last 3 - demoted to Apply.'),
  move(15, 'promote', 'apply', 'analyse', 0.8, 5, '80% at Apply over the last 5 - promoted to Analyse.'),
  move(11, 'demote', 'analyse', 'apply', 0, 3, '0% at Analyse over the last 3 - demoted to Apply.'),
  move(8, 'promote', 'apply', 'analyse', 1, 3, '100% at Apply over the last 3 - promoted to Analyse.'),
  move(5, 'promote', 'understand', 'apply', 1, 3, '100% at Understand over the last 3 - promoted to Apply.'),
  move(2, 'promote', 'remember', 'understand', 1, 3, '100% at Remember over the last 3 - promoted to Understand.'),
];
const ENGLISH_ONLY = {
  original: 'en', originalName: 'English',
  languages: [{ language: 'en', name: 'English', answers: 13, original: true }], otherThanOriginal: 0, note: null,
};

const CARD = {
  room: FULL.room,
  student: { rollNo: '21CS07', name: 'Bilal Khan', display: 'Bilal Khan', studentId: '5206aa', onRoster: true, joined: true, attendance: 'present' },
  band: { id: 'developing', label: 'Developing', accuracy: 6 / 13, answers: 13, correct: 6, reason: '6 of 13 graded answers right (46%): Developing.', provisional: false },
  serving: {
    level: 'apply', label: 'Apply', reason: '60% at Apply over the last 5 - holding at Apply.',
    eligible: ['remember', 'understand', 'apply', 'analyse'], ceiling: false, adapt: true,
    basis: { answers: 5, provisional: false, sentence: 'Based on the last 5 answers at Apply.' },
    moves: MOVES,
  },
  mastery: [
    { level: 'remember', answers: 3, correct: 3, mastered: true, provisional: false, sentence: '3 of 3 right at Remember: at or above this room\'s goal, so Remember counts as mastered.' },
    { level: 'understand', answers: 5, correct: 2, mastered: false, provisional: false, sentence: '2 of 5 right at Understand: not yet at this room\'s goal. 1 earlier answer at Understand set aside.' },
    { level: 'apply', answers: 5, correct: 1, mastered: false, provisional: false, sentence: '1 of 5 right at Apply: not yet at this room\'s goal.' },
  ],
  languages: ENGLISH_ONLY,
  levels: [
    { level: 'remember', label: 'Remember', answers: 3, correct: 3, accuracy: 1, withdrawn: 0, class: { answers: 41, correct: 31, accuracy: 31 / 41 } },
    { level: 'understand', label: 'Understand', answers: 5, correct: 2, accuracy: 0.4, withdrawn: 1, class: { answers: 96, correct: 49, accuracy: 49 / 96 } },
    { level: 'apply', label: 'Apply', answers: 5, correct: 1, accuracy: 0.2, withdrawn: 0, class: { answers: 38, correct: 21, accuracy: 21 / 38 } },
    { level: 'analyse', label: 'Analyse', answers: 0, correct: 0, accuracy: null, withdrawn: 0, class: { answers: 14, correct: 6, accuracy: 6 / 14 } },
    { level: 'evaluate', label: 'Evaluate', answers: 0, correct: 0, accuracy: null, withdrawn: 0, class: { answers: 0, correct: 0, accuracy: null } },
    { level: 'create', label: 'Create', answers: 0, correct: 0, accuracy: null, withdrawn: 0, class: { answers: 0, correct: 0, accuracy: null } },
  ],
  lastAnswers: { items: ANSWERS, limit: 10, final: true },
  nextSet: {
    planned: true, size: 5,
    levels: [{ level: 'apply', label: 'Apply', count: 2, role: 'current' }, { level: 'understand', label: 'Understand', count: 3, role: 'review' }],
    summary: '2 Apply · 3 Understand review', onScreen: { level: 'apply', label: 'Apply' }, empty: null, note: NEXT_NOTE,
  },
  records: {
    day: '2026-11-19',
    observation: {
      current: { id: 'o2', kind: 'participated', label: 'Participated', note: 'Walked the class through the three-way handshake on the board.', observedAt: at(17), observedBy: null, room: '7QF2MD' },
      history: [
        { id: 'o1', kind: 'revision', label: 'Needs revision', note: '', observedAt: at(6), observedBy: null, room: '7QF2MD' },
        { id: 'o2', kind: 'participated', label: 'Participated', note: 'Walked the class through the three-way handshake on the board.', observedAt: at(17), observedBy: null, room: '7QF2MD' },
      ],
    },
    picks: [
      { id: 'p1', round: 1, rollNo: '21CS07', askLabel: 'Bank', statusLabel: 'Answered', pickedAt: at(9) },
      { id: 'p2', round: 2, rollNo: '21CS07', askLabel: 'Demo', statusLabel: 'Needs help', pickedAt: at(18) },
    ],
    privacy: STAFF_ONLY,
  },
  thresholds: THRESHOLDS,
  privacy: PRIVACY,
};

const NO_PHONE = {
  room: LED.room,
  student: { rollNo: 'SIM04', name: 'Arjun Patil', display: 'Arjun Patil', studentId: '059a61', onRoster: true, joined: false, attendance: 'unmarked' },
  band: { id: null, label: null, accuracy: null, answers: 0, correct: 0, reason: 'No graded answers yet.', provisional: true },
  serving: null,
  mastery: [],
  languages: { ...ENGLISH_ONLY, languages: [], note: null },
  levels: CARD.levels.map((l) => ({ ...l, answers: 0, correct: 0, accuracy: null, withdrawn: 0, class: { answers: 0, correct: 0, accuracy: null } })),
  lastAnswers: { items: [], limit: 10, final: true },
  nextSet: null,
  records: { day: '2026-11-19', observation: { current: null, history: [] }, picks: [], privacy: STAFF_ONLY },
  thresholds: THRESHOLDS,
  privacy: PRIVACY,
};

/** The card for whichever sample student was opened: their own name, band and reason. */
function cardFor(data, roll) {
  const s = data.students.find((x) => x.rollNo === roll);
  if (!s) return CARD;
  const early = s.answers < THRESHOLDS.minAnswers;
  return {
    ...CARD,
    student: { ...CARD.student, rollNo: s.rollNo, name: s.rosterName ?? s.name, display: s.rosterName ?? s.name, attendance: s.present ? 'present' : 'unmarked' },
    band: { id: s.band, label: s.bandLabel, accuracy: s.accuracy, answers: s.answers, correct: s.correct, reason: s.reason, provisional: early },
    serving: {
      ...CARD.serving, level: s.workingLevel, label: LABEL[s.workingLevel], basis: s.levelBasis,
      ...(early ? { reason: null, moves: [] } : {}),
    },
    ...(early ? {
      mastery: s.answers ? [{
        level: s.workingLevel, answers: s.answers, correct: s.correct, mastered: false, provisional: true,
        sentence: `${answersWord(s.answers)} at ${LABEL[s.workingLevel]} so far: 3 are needed before ${LABEL[s.workingLevel]} can count as mastered.`,
      }] : [],
      lastAnswers: { ...CARD.lastAnswers, items: CARD.lastAnswers.items.slice(0, s.answers) },
      levels: CARD.levels.map((l) => {
        const mine = l.level === s.workingLevel ? s.answers : 0;
        const right = l.level === s.workingLevel ? s.correct : 0;
        return { ...l, answers: mine, correct: right, accuracy: mine ? right / mine : null, withdrawn: 0 };
      }),
    } : {}),
  };
}

/** The same card once a second language exists: the server's note, and a tag on each answer given in Hindi. */
const HINDI = new Set(['a1', 'a4']);
const CARD_LANGUAGES = {
  ...CARD,
  lastAnswers: { ...CARD.lastAnswers, items: CARD.lastAnswers.items.map((a) => (HINDI.has(a.answerId) ? { ...a, language: 'hi' } : a)) },
  languages: {
    original: 'en', originalName: 'English',
    languages: [{ language: 'en', name: 'English', answers: 11, original: true }, { language: 'hi', name: 'Hindi', answers: 2, original: false }],
    otherThanOriginal: 2,
    note: '2 of this student\'s 13 answers were in Hindi, not the question\'s own English. Translation can change how hard a question is.',
  },
};

/* ------------------------------------------------------------ frames */

const SAY = {
  ask: (a) => `The console would now ask the class a ${a.level} question.`,
  sort: (a) => `The list was put in the “${a.sort}” order.`,
  wheel: () => 'The console would now open the wheel.',
};

function Frame({ code, children }) {
  return (
    <AccountShell current="console" crumb={`Live · room ${code}`} title="Insights" sub="Bands, the three cards and the KPI tiles for this room. Staff only." width="wide">
      {children}
    </AccountShell>
  );
}

/** A sample room that answers act and dismiss by changing itself. */
function Sample({ start, canControl = true, openRoll = null, card = null }) {
  const [data, setData] = useState(start);
  const [sort, setSort] = useState(null);
  const [roll, setRoll] = useState(openRoll);
  const [said, setSaid] = useState('');

  async function onAction(card, kind, note) {
    await new Promise((r) => { setTimeout(r, 450); });
    const lastAction = { action: kind, note: note ?? '', actedAt: new Date().toISOString(), actedBy: null };
    setData((d) => ({ ...d, cards: d.cards.map((c) => (c.flagId === card.flagId ? { ...c, dismissed: kind === 'dismissed', lastAction } : c)) }));
    if (kind === 'acted') setSaid(SAY[card.action.do]?.(card.action) ?? '');
  }

  return (
    <Frame code={data.room.code}>
      <InsightsView data={data} canControl={canControl} sort={sort} onSort={setSort} onAction={onAction} onOpenStudent={setRoll} />
      {said && <p className="t-meta" role="status" style={{ marginTop: 12 }}>Gallery only: {said}</p>}
      {roll && <StudentCardView card={card && roll === openRoll ? card : cardFor(data, roll)} roll={roll} onClose={() => setRoll(null)} />}
    </Frame>
  );
}

/** The real components on a real room: the socket's pushes, the real card. */
function LiveRoom({ code }) {
  const feed = useRoomFeed(code);
  const [sort, setSort] = useState(null);
  const [roll, setRoll] = useState(null);
  const [said, setSaid] = useState('');
  return (
    <Frame code={code}>
      <Insights
        code={code} insights={feed.insights} canControl sort={sort} onSort={setSort}
        onAct={(a) => setSaid(`onAct ${JSON.stringify(a)}`)} onOpenStudent={setRoll}
      />
      {said && <p className="t-meta mono" role="status" style={{ marginTop: 12 }}>Gallery only: {said}</p>}
      <StudentCard code={code} roll={roll} onClose={() => setRoll(null)} />
    </Frame>
  );
}

export default [
  {
    id: 'coach-full',
    title: 'Live insights: a Mixed room mid-lesson',
    role: 'professor',
    note: 'Bands, the three cards (act or dismiss them), KPI tiles with their trend, teacher records. Open a student for their card.',
    render: () => <Sample key="coach-full" start={FULL} />,
  },
  {
    id: 'coach-early',
    title: 'Live insights: an early room',
    role: 'professor',
    note: 'A few answers in: nobody has three graded answers, so no band, and every level is provisional, lighter and named so. Each tile and card says what it rests on.',
    render: () => <Sample key="coach-early" start={EARLY} />,
  },
  {
    id: 'coach-dismissed',
    title: 'Live insights: dismissed cards',
    role: 'professor',
    note: 'Two cards dismissed, one with a note. They stay, quieter; acting on one ends the dismissal.',
    render: () => <Sample key="coach-dismissed" start={DISMISSED} />,
  },
  {
    id: 'coach-teacher-led',
    title: 'Live insights: a Teacher-led room',
    role: 'professor',
    note: 'No phones, so no bands, cards or tiles: the server’s note and the teacher records.',
    render: () => <Sample key="coach-teacher-led" start={LED} />,
  },
  {
    id: 'coach-readonly',
    title: 'Live insights: read only',
    role: 'hod',
    note: 'A head of department reading a professor’s room: no act or dismiss.',
    render: () => <Sample key="coach-readonly" start={DISMISSED} canControl={false} />,
  },
  {
    id: 'coach-loading',
    title: 'Live insights: reading',
    role: 'professor',
    note: 'The first read, before the room’s body arrives.',
    render: () => <Frame key="coach-loading" code="7QF2MD"><InsightsView data={null} /></Frame>,
  },
  {
    id: 'coach-card',
    title: 'Student card',
    role: 'professor',
    note: 'One student: band, the level served, each level against the class, last answers, the planned next set, teacher records.',
    render: () => <Sample key="coach-card" start={FULL} openRoll="21CS07" />,
  },
  {
    id: 'coach-card-early',
    title: 'Student card: an early, provisional student',
    role: 'professor',
    note: 'Two answers in: no band, the level served is provisional with the sentence beside it, no level change yet, mastery not yet possible.',
    render: () => <Sample key="coach-card-early" start={EARLY} openRoll="SIM01" />,
  },
  {
    id: 'coach-card-languages',
    title: 'Student card: answers in a second language',
    role: 'professor',
    note: 'Quiet until a second language exists: then the server’s note under Last answers and a small tag on each answer given in Hindi.',
    render: () => <Sample key="coach-card-languages" start={FULL} openRoll="21CS07" card={CARD_LANGUAGES} />,
  },
  {
    id: 'coach-card-no-phone',
    title: 'Student card: on the roster, no phone',
    role: 'professor',
    note: 'A roster student in a Teacher-led room: no band, nothing served, nothing planned.',
    render: () => <Frame key="coach-card-no-phone" code="J5ENVQ"><StudentCardView card={NO_PHONE} roll="SIM04" onClose={() => {}} /></Frame>,
  },
  {
    id: 'coach-live',
    title: 'Live only: insights on a real room',
    role: 'professor',
    note: 'Not sample data. The real component on ?room=CODE of the local server (default MP9BRS), with the socket’s pushes. Needs :5050 and the teacher key.',
    render: () => <LiveRoom key="coach-live" code={(new URLSearchParams(window.location.search).get('room') || 'MP9BRS').toUpperCase()} />,
  },
];
