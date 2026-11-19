/**
 * Attainment, drawn from sample data. Development only.
 *
 * Every object has the shape the server returns (docs/API.md, "Phase 4:
 * configurable attainment and the marks register", with the review fixes the
 * server's working tree already carries: marks.questionSources, rollNotes,
 * a row's `note`, an answer's `givenAs`, roomWeights[].inReport). The figures
 * agree with each other: they are worked out below from per-student marks by
 * the documented rules (a state from the counted share and the minimum
 * answers, a class figure over the roster now, marks of the students counted,
 * the rest outside). Nothing here talks to the server: the window bar is a
 * stand-in, and saves wait a moment and answer locally.
 */

import { useState } from 'react';

import { AttainmentView } from '../account/Attainment.jsx';
import { FormulaEditor, toDraft } from '../account/AttainmentFormula.jsx';
import { StudentSheet } from '../account/StudentAttainment.jsx';
import { LABEL, LEVELS } from '../lib/bloom.js';
import AccountShell from '../shell/AccountShell.jsx';
import { Button, Segmented } from '../ui/index.jsx';

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const hex = (n) => n.toString(16).padStart(24, '0');

// A seeded generator, so the sample is the same on every load.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------- the class */

const CLASS = { id: '6fc2802e8bcc25b1479fd944', courseName: 'Computer Networks', section: 'CS-A', termLabel: 'Odd term 2026' };
const CHAPTER = { contentId: '661fa153382d270f7268a84e', chapter: 'Computer Networks - Unit 4: The Transport Layer' };

const NAMES = [
  'Aarav Shah', 'Aditi Rao', 'Ananya Iyer', 'Arjun Patil', 'Ishaan Kulkarni', 'Kavya Nair', 'Rohan Deshmukh',
  'Sneha Joshi', 'Vihaan Mehta', 'Diya Kapoor', 'Aryan Gupta', 'Meera Pillai', 'Kabir Singh', 'Saanvi Reddy',
  'Yash Pawar', 'Tanvi Bhosale', 'Reyansh Menon', 'Ira Banerjee', 'Atharv Chavan', 'Myra Fernandes',
];
const PEOPLE = [
  ...NAMES.map((name, i) => ({ studentId: hex(0xa000 + i), rollNo: `21CS${String(i + 1).padStart(2, '0')}`, name, status: 'active', statusLabel: 'On the roster' })),
  { studentId: hex(0xb001), rollNo: '21CS26', name: 'Ira Bose', status: 'removed', statusLabel: 'Removed from the roster', removedAt: '2026-11-12T06:10:00.000Z' },
  { studentId: null, rollNo: 'VISIT9', name: 'Visitor', status: 'not-on-roster', statusLabel: 'Not on the roster' },
];

const ROOMS = [
  { roomId: hex(0xe001), code: 'K7W4BM', title: 'Week A: services and ports', day: '2026-11-03', startedAt: '2026-11-03T04:30:00.000Z', status: 'closed', weight: 1 },
  { roomId: hex(0xe002), code: 'M4RE79', title: 'Week B: UDP and TCP', day: '2026-11-10', startedAt: '2026-11-10T04:30:00.000Z', status: 'closed', weight: 1 },
  { roomId: hex(0xe003), code: 'JDMEE4', title: 'Week C: congestion control', day: '2026-11-17', startedAt: '2026-11-17T04:30:00.000Z', status: 'open', weight: 1 },
];

const OUTCOMES = [
  { id: hex(0xc001), code: 'CO1', statement: 'Explain how the transport layer delivers data between processes.', targetLevel: 'understand', archived: false,
    topics: [{ ...CHAPTER, topic: 'Transport layer services', weight: 1, inChapter: true }], directQuestions: 0, w: 1, mean: 0.72 },
  { id: hex(0xc002), code: 'CO2', statement: 'Compare UDP and TCP for a given application.', targetLevel: 'analyse', archived: false,
    topics: [{ ...CHAPTER, topic: 'Transmission Control Protocol', weight: 2, inChapter: true }, { ...CHAPTER, topic: 'User Datagram Protocol', weight: 1, inChapter: true }], directQuestions: 0, w: 2, mean: 0.55 },
  { id: hex(0xc003), code: 'CO3', statement: 'Apply flow and congestion control to a scenario.', targetLevel: 'apply', archived: false,
    topics: [{ ...CHAPTER, topic: 'Congestion control', weight: 1, inChapter: false }], directQuestions: 2, w: 1, mean: 0.6, thin: true },
  { id: hex(0xc004), code: 'CO4', statement: 'Describe connection set-up and teardown.', targetLevel: null, archived: true,
    topics: [{ ...CHAPTER, topic: 'Connection management', weight: 1, inChapter: true }], directQuestions: 0, w: 1, mean: 0.66 },
];

const BANDS = [
  { id: 'lower', label: 'Remember and Understand', levels: ['remember', 'understand'] },
  { id: 'middle', label: 'Apply and Analyse', levels: ['apply', 'analyse'] },
  { id: 'higher', label: 'Evaluate and Create', levels: ['evaluate', 'create'] },
];

/* ------------------------------------------------------------ the formula */

const EXAMPLE_CONFIG = {
  studentThreshold: 0.6, minAnswers: 3,
  levels: [{ level: 1, minShare: 0.5 }, { level: 2, minShare: 0.6 }, { level: 3, minShare: 0.7 }],
  evidence: { digital: true, aiProvisional: false, humanReviewed: true }, attempts: 'final', roomWeights: [],
};
const STRICT_CONFIG = { ...EXAMPLE_CONFIG, levels: [{ level: 1, minShare: 0.6 }, { level: 2, minShare: 0.7 }, { level: 3, minShare: 0.85 }] };
const EXAMPLE_NAME = 'Example: 60% of marks; levels at 50 / 60 / 70% of students';
const STRICT_NAME = 'Example: 60% of marks; levels at 60 / 70 / 85% of students';

const methodologyOf = (head, c) => `${head} A student attains a course outcome when they score at least ${c.studentThreshold * 100}% of the marks on the questions mapped to it, counting ${c.attempts === 'best' ? 'only their best attempt at each question, across attempts and rooms' : 'final attempts only (an attempt followed by a retry is left out, and a question answered in two rooms counts in both)'}, from digital answers marked automatically and written answers a professor has reviewed. Written answers given only a provisional machine mark (a keyword match against the rubric, not AI) and not yet reviewed are shown but not counted. Students with fewer than ${c.minAnswers} such answers on an outcome are shown as not enough evidence, never as not attained. Each answer is worth one mark, scored from 0 to 1 as it was marked (a professor's review replaces the machine's mark) and weighted by its topic's weight in the outcome; a question mapped to an outcome directly weighs 1. ${c.roomWeights.length ? 'Room M4RE79 counts 2; every other room counts 1.' : 'Every room counts the same.'} The class's attainment level for an outcome comes from the share of the students counted who attained it: ${[...c.levels].reverse().map((l) => `level ${l.level} from ${l.minShare * 100}%`).join(', ')} and level 0 below ${c.levels[0].minShare * 100}%. The students counted are those on the class roster now; removed students and roll numbers not on the roster are listed apart and not counted. Bloom attainment applies the same rules to each Bloom level in place of each outcome, over every counted answer at that level whether or not it is mapped to an outcome (topic weights do not apply; room weights do). Because each student is served different questions, a student's share is of the marks on the questions they were actually given. Polls are not marked and are counted only as a number. Teacher observations, wheel picks and hand tallies are reported in their own section and never enter a mark or move a level. Rooms deleted from the live views are not counted; their evidence is kept in room archives. This is direct attainment from class evidence only. A college's final attainment may combine it with examinations or surveys by its own formula; this report does not.`;

const EXAMPLE_FORMULA = { source: 'example', version: 0, savedAt: null, savedBy: null, preset: { id: 'example-60-50-60-70', name: EXAMPLE_NAME }, config: EXAMPLE_CONFIG, roomWeights: [] };
const SAVED_CONFIG = {
  ...EXAMPLE_CONFIG, minAnswers: 3, attempts: 'best',
  roomWeights: [{ roomId: hex(0xe002), weight: 2 }, { roomId: hex(0xe009), weight: 1.5 }, { roomId: hex(0xe00a), weight: 3 }],
};
const SAVED_FORMULA = {
  source: 'saved', version: 2, savedAt: '2026-11-12T09:41:00.000Z', savedBy: null, preset: null, config: SAVED_CONFIG,
  roomWeights: [
    { roomId: hex(0xe002), code: 'M4RE79', weight: 2, found: true, inReport: true },
    { roomId: hex(0xe009), code: 'Q2LX8P', weight: 1.5, found: true, inReport: false },
    { roomId: hex(0xe00a), code: null, weight: 3, found: false, inReport: false },
  ],
};
const EXAMPLE_METHOD = methodologyOf(`No formula has been saved for this class, so this report uses "${EXAMPLE_NAME}", which ships with BloomLoop as an example to start from, not as an institutional standard.`, EXAMPLE_CONFIG);
const SAVED_METHOD = methodologyOf('Formula: version 2 of this class\'s own formula, saved 2026-11-12.', SAVED_CONFIG);

const FIELDS = {
  studentThreshold: 'A share from 0 to 1 (0.6 for 60%): a student attains an outcome when their marks on its questions reach this share of the marks possible.',
  minAnswers: 'A whole number from 1 to 100: below this many counted answers on an outcome, a student is "not enough evidence".',
  levels: '1 to 10 class levels: the class reaches a level when at least minShare of the students counted attained the outcome.',
  evidence: 'Which evidence counts towards a mark. Teacher records never count (decision 3).',
  attempts: '"final" or "best".',
  roomWeights: 'Up to 100 rooms of the class with a weight above 0 and at most 100.',
};
const EVIDENCE_TYPES = [
  { id: 'digital', label: 'Digital answers', description: 'Objective answers given on a phone and marked by the server from the stored answer key.' },
  { id: 'aiProvisional', label: 'Provisional machine marks', description: 'Written answers marked by the keyword marker, which matches the rubric\'s words in the answer: a provisional machine mark, not AI and not a professor\'s judgement, until a professor reviews it.' },
  { id: 'humanReviewed', label: 'Reviewed by a professor', description: 'Written answers whose mark a professor confirmed or changed in the review queue.' },
];
const QUESTION_SOURCES = [
  { id: 'aiGenerated', label: 'AI-generated questions', description: 'Questions the language model wrote from the professor’s own material (question_source "llm"). A professor approved each before any room served it. This says where the question came from, not how the answer was marked.' },
  { id: 'professorWritten', label: 'Professor-written questions', description: 'Questions a professor wrote in the question bank (question_source "teacher").' },
  { id: 'offlineTemplate', label: 'Offline-template or professor-written questions', description: 'Questions no model wrote (question_source "fallback"): the offline template’s, and a professor’s own while they are stored the same way. An answer row cannot tell these two apart.' },
];
const PRIVACY = 'Attainment, marks and every report here are for staff only: never sent to a student\'s phone or the projector, or to any route a student can reach. Students are listed in roll-number order, never ranked by score.';
const STATES = [{ id: 'attained', label: 'Attained' }, { id: 'not-attained', label: 'Not attained' }, { id: 'not-enough-evidence', label: 'Not enough evidence' }];

const PRESETS = {
  presets: [
    { id: 'example-60-50-60-70', name: EXAMPLE_NAME, config: EXAMPLE_CONFIG, methodology: methodologyOf(`Formula: "${EXAMPLE_NAME}", which ships with BloomLoop as an example to start from, not as an institutional standard.`, EXAMPLE_CONFIG),
      description: 'A student attains an outcome with 60% of the marks on its questions, from at least 3 answers. The class reaches level 1 when 50% of its students attain it, level 2 at 60% and level 3 at 70%. An example to start from, not an institutional standard.' },
    { id: 'example-60-60-70-85', name: STRICT_NAME, config: STRICT_CONFIG, methodology: methodologyOf(`Formula: "${STRICT_NAME}", which ships with BloomLoop as an example to start from, not as an institutional standard.`, STRICT_CONFIG),
      description: 'A stricter class target: level 1 when 60% of its students attain an outcome, level 2 at 70% and level 3 at 85%. The same evidence and attempts as the first example. An example to start from, not an institutional standard.' },
  ],
  default: 'example-60-50-60-70', fields: FIELDS, evidenceTypes: EVIDENCE_TYPES, states: STATES,
};
const configReply = (formula, methodology, canEdit = true) => ({
  class: CLASS, canEdit, formula, methodology, presets: PRESETS.presets.map((p) => ({ id: p.id, name: p.name })), fields: FIELDS, privacy: PRIVACY,
});

/* ------------------------------------------------- figures, by the rules */

const TYPE = ['digital', 'aiProvisional', 'humanReviewed'];
const SRC = ['aiGenerated', 'professorWritten', 'offlineTemplate'];
const r3 = (v) => Math.round(v * 1000) / 1000;
const cut4 = (part, whole) => (whole > 0 ? Math.floor((part / whole) * 10000) / 10000 : null);
const pctWords = (s) => `${Number((s * 100).toFixed(2))}%`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function emptyMarks() {
  const m = {};
  TYPE.forEach((t) => { m[t] = { answers: 0, obtained: 0, possible: 0 }; });
  m.ungraded = { answers: 0 };
  m.src = Object.fromEntries(SRC.map((s) => [s, { answers: 0, obtained: 0, possible: 0, notCounted: 0 }]));
  return m;
}

/** A student's marks on one outcome or level. `scale` thins the evidence. */
function draw(rand, { mean, w = 1, scale = 1, none = false }) {
  const m = emptyMarks();
  if (none) return m;
  const add = (type, score, weight) => {
    const s = SRC[Math.floor(rand() * 3)];
    m[type].answers += 1; m[type].obtained += score * weight; m[type].possible += weight;
    if (type === 'aiProvisional') m.src[s].notCounted += 1;
    else { m.src[s].answers += 1; m.src[s].obtained += score * weight; m.src[s].possible += weight; }
  };
  const n = Math.round((2 + rand() * 6) * scale);
  for (let i = 0; i < n; i += 1) add('digital', rand() < mean ? 1 : 0, rand() < 0.5 ? w : 1);
  if (rand() < 0.35) add('aiProvisional', [0, 0.5, 1][Math.floor(rand() * 3)], 1);
  if (rand() < 0.3) add('humanReviewed', [0.5, 1][Math.floor(rand() * 2)], 1);
  if (rand() < 0.15) m.ungraded.answers += 1;
  return m;
}

function sum(list) {
  const out = emptyMarks();
  list.forEach((m) => {
    TYPE.forEach((t) => { out[t].answers += m[t].answers; out[t].obtained += m[t].obtained; out[t].possible += m[t].possible; });
    out.ungraded.answers += m.ungraded.answers;
    SRC.forEach((s) => Object.keys(out.src[s]).forEach((k) => { out.src[s][k] += m.src[s][k]; }));
  });
  return out;
}

const marksView = (m, cfg) => ({
  ...Object.fromEntries(TYPE.map((t) => [t, { answers: m[t].answers, obtained: r3(m[t].obtained), possible: r3(m[t].possible), counted: cfg.evidence[t] }])),
  ungraded: { answers: m.ungraded.answers, counted: false },
  questionSources: Object.fromEntries(SRC.map((s) => [s, { answers: m.src[s].answers, obtained: r3(m.src[s].obtained), possible: r3(m.src[s].possible), notCounted: m.src[s].notCounted }])),
});

const countedOf = (m, cfg) => TYPE.filter((t) => cfg.evidence[t]).reduce((o, t) => ({
  answers: o.answers + m[t].answers, obtained: o.obtained + m[t].obtained, possible: o.possible + m[t].possible,
}), { answers: 0, obtained: 0, possible: 0 });

function cellOf(m, cfg) {
  const c = countedOf(m, cfg);
  const state = c.answers < cfg.minAnswers || c.possible <= 0 ? 'not-enough-evidence' : c.obtained / c.possible >= cfg.studentThreshold ? 'attained' : 'not-attained';
  return {
    state, stateLabel: STATES.find((s) => s.id === state).label, answers: c.answers, obtained: r3(c.obtained), possible: r3(c.possible),
    share: cut4(c.obtained, c.possible), marks: marksView(m, cfg),
  };
}

function figure(name, rows, cfg) {
  // rows: [{ person, m }]
  const active = rows.filter((x) => x.person.status === 'active');
  const states = active.map((x) => cellOf(x.m, cfg).state);
  const attained = states.filter((s) => s === 'attained').length;
  const notAttained = states.filter((s) => s === 'not-attained').length;
  const counted = attained + notAttained;
  const short = active.filter((_, i) => states[i] === 'not-enough-evidence');
  const shortC = short.map((x) => countedOf(x.m, cfg));
  const outside = (status) => {
    const c = rows.filter((x) => x.person.status === status).map((x) => countedOf(x.m, cfg));
    return { students: c.filter((v) => v.answers > 0).length, answers: c.reduce((n, v) => n + v.answers, 0) };
  };
  let level = null;
  if (counted) { level = 0; cfg.levels.forEach((l) => { if (attained / counted >= l.minShare) level = l.level; }); }
  const marks = sum(active.filter((_, i) => states[i] !== 'not-enough-evidence').map((x) => x.m));
  const nee = active.length - counted;
  const out = {
    students: { roster: active.length, counted, attained, notAttained, notEnoughEvidence: nee, withNoAnswers: active.filter((x) => !countedOf(x.m, cfg).answers).length },
    share: cut4(attained, counted), attainmentLevel: level, marks: marksView(marks, cfg),
    outside: {
      notEnoughEvidence: { students: shortC.filter((v) => v.answers > 0).length, answers: shortC.reduce((n, v) => n + v.answers, 0), marks: marksView(sum(short.map((x) => x.m)), cfg) },
      removed: outside('removed'), notOnRoster: outside('not-on-roster'),
    },
  };
  if (!counted) {
    out.summary = `No student on the roster has ${cfg.minAnswers} counted answers on ${name} yet, so it has no class level.`;
    return out;
  }
  const on = TYPE.filter((t) => cfg.evidence[t] && marks[t].answers);
  const words = { digital: 'digital', aiProvisional: 'provisional written', humanReviewed: 'reviewed written' };
  const n = on.reduce((s, t) => s + marks[t].answers, 0);
  // The server's sentence, in its order: head, not enough evidence, what it
  // rests on, outside the share, then what is shown but not counted.
  const outN = out.outside.notEnoughEvidence;
  const prov = cfg.evidence.aiProvisional ? 0 : marks.aiProvisional.answers + sum(short.map((x) => x.m)).aiProvisional.answers;
  out.summary = `${attained} of ${plural(counted, 'student')} counted attained ${name} (${pctWords(out.share)}): level ${level}.`
    + `${nee ? ` ${nee} on the roster ${nee === 1 ? 'has' : 'have'} not enough evidence (fewer than ${cfg.minAnswers} counted answers).` : ''}`
    + ` Rests on ${plural(n, 'counted answer')} from the ${plural(counted, 'student')} counted: ${on.map((t) => `${marks[t].answers} ${words[t]}`).join(' and ')}.`
    + `${outN.answers ? ` Outside the share: ${plural(outN.answers, 'counted answer')} from ${plural(outN.students, 'student')} with not enough evidence.` : ''}`
    + `${prov ? ` ${plural(prov, 'provisional written answer')} ${prov === 1 ? 'is' : 'are'} shown but not counted.` : ''}`;
  return out;
}

/** A whole report from one seed, under one formula. */
function buildReport({ seed = 7, formula = EXAMPLE_FORMULA, methodology = EXAMPLE_METHOD, scale = 1, none = false, outcomes = OUTCOMES, rooms = ROOMS, window } = {}) {
  const cfg = formula.config;
  const rand = rng(seed);
  // Per person, per outcome and per level.
  const per = PEOPLE.map((p, i) => {
    const lean = 0.75 + rand() * 0.5; // some students answer more than others
    const thin = p.status !== 'active' ? 0.6 : i % 7 === 3 ? 0.3 : 1;
    return {
      person: p,
      out: outcomes.map((o) => draw(rand, { mean: o.mean * lean, w: o.w, scale: scale * thin * (o.thin ? 0.45 : 1), none })),
      lv: LEVELS.map((l, j) => draw(rand, { mean: 0.78 - j * 0.07, scale: scale * thin * (j > 3 ? 0.35 : 0.8), none })),
    };
  });
  const outcomeRows = outcomes.map((o, k) => {
    const { w, mean, thin, ...rest } = o; // eslint-disable-line no-unused-vars
    return { ...rest, ...figure(o.code, per.map((x) => ({ person: x.person, m: x.out[k] })), cfg) };
  });
  const levels = LEVELS.map((l, j) => ({ level: l, label: LABEL[l], ...figure(LABEL[l], per.map((x) => ({ person: x.person, m: x.lv[j] })), cfg) }));
  const bandM = (x, b) => sum(b.levels.map((l) => x.lv[LEVELS.indexOf(l)]));
  const bands = BANDS.map((b) => ({ ...b, ...figure(b.label, per.map((x) => ({ person: x.person, m: bandM(x, b) })), cfg) }));
  const people = per.filter((x) => x.person.status === 'active' || [...x.out, ...x.lv].some((m) => countedOf(m, cfg).answers));
  const students = people.map((x) => ({
    ...x.person,
    ...(x.person.status === 'not-on-roster' ? { note: ROLL_NOTE } : {}),
    outcomes: outcomes.map((o, k) => ({ id: o.id, code: o.code, ...cellOf(x.out[k], cfg) })),
    bloom: {
      levels: LEVELS.map((l, j) => ({ level: l, label: LABEL[l], ...cellOf(x.lv[j], cfg) })),
      bands: BANDS.map((b) => ({ id: b.id, label: b.label, ...cellOf(bandM(x, b), cfg) })),
    },
    records: { observations: { understood: 0, participated: 0, revision: 0, support: 0 }, picks: {} },
  }));
  const all = sum(per.flatMap((x) => x.lv));
  const graded = TYPE.reduce((n, t) => n + all[t].answers, 0);
  const unmappedN = none ? 0 : 8;
  return {
    class: CLASS,
    window: window ?? { from: null, to: null, rooms: null },
    rooms,
    formula,
    methodology,
    evidenceTypes: EVIDENCE_TYPES,
    states: STATES,
    answers: {
      rows: graded + all.ungraded.answers + (none ? 0 : 6), setAside: none ? 0 : 6, chosen: graded + all.ungraded.answers, ungraded: all.ungraded.answers, graded,
      byType: Object.fromEntries(TYPE.map((t) => [t, all[t].answers])), mapped: graded - unmappedN - (none ? 0 : 2), excluded: none ? 0 : 2, unmapped: unmappedN,
      bySource: Object.fromEntries(SRC.map((s) => [s, all.src[s].answers + all.src[s].notCounted])),
    },
    unmapped: none ? [] : [
      { ...CHAPTER, topic: 'Socket programming', inChapter: true, answers: 6 },
      { ...CHAPTER, topic: 'Port numbers (old name)', inChapter: false, answers: 2 },
    ],
    outcomes: outcomeRows,
    bloom: { levels, bands },
    students,
    rollNotes: students.some((s) => s.status === 'not-on-roster') ? [{ rollNo: 'VISIT9', rooms: ['K7W4BM', 'M4RE79'], tiedTo: [], note: ROLL_NOTE }] : [],
    questionSources: QUESTION_SOURCES,
    teacherRecords: none ? RECORDS_NONE : RECORDS,
    definitions: DEFINITIONS,
    privacy: PRIVACY,
  };
}

const DEFINITIONS = {
  evidenceTypes: 'Every figure is split by evidence type (digital, aiProvisional, humanReviewed), each with its answers and marks and whether the formula counts it; polls (ungraded) are a count only. aiProvisional is a provisional machine mark: the keyword marker’s match of the rubric’s words, not AI, until a professor reviews it (the key keeps its stored name).',
  questionSources: 'marks.questionSources splits the same counted marks by who wrote the question: aiGenerated (the language model, from the professor’s material, approved before use; question_source "llm"), professorWritten ("teacher") and offlineTemplate ("fallback": the offline template, and a professor’s own questions while they are stored the same way). The three add up to the counted types; notCounted is each one’s answers of a type the formula does not count. It moves no mark.',
  classFigure: 'counted: students on the roster now who are attained or not attained; share: attained / counted; attainmentLevel: the formula’s levels applied to that share (null with nobody counted). Removed students and roll numbers not on the roster are in `outside`, never counted.',
  rooms: 'The rooms opened for this class that the caller may read, opened from `from` to `to` (India’s days) and among `rooms` when given; oldest first. Only rooms opened for this class are counted: a room opened without choosing it is not, whoever answered in it. Deleted rooms are not counted.',
  order: 'Students in roll-number order: the roster, then removed students with evidence, then roll numbers not on the roster.',
  rolls: 'A room’s answers are filed under the roster student whose attendance mark in that room was made under the roll number they were given under (0021), so a corrected roll number keeps them; otherwise under the roll number as the roster holds it now. rollNotes (and `note` on each row off the roster) says, for every roll number not on the roster, that its answers are apart and uncounted, and which roster student any room’s mark was made under it for.',
};

const ROLL_NOTE = 'VISIT9 is not on the class roster, so its answers in K7W4BM and M4RE79 are listed apart and counted in no class figure.';

const RECORDS = {
  label: 'Teacher records: reported beside the marks, never part of one',
  observations: {
    kinds: [{ id: 'understood', label: 'Understood' }, { id: 'participated', label: 'Participated' }, { id: 'revision', label: 'Needs revision' }, { id: 'support', label: 'Needs additional support' }],
    counts: { understood: 9, participated: 14, revision: 4, support: 1 }, studentDays: 28,
  },
  picks: {
    statuses: [{ id: 'pending', label: 'Pending' }, { id: 'answered', label: 'Answered' }, { id: 'passed', label: 'Passed to partner' }, { id: 'help', label: 'Needs help' }, { id: 'skipped', label: 'Skipped' }, { id: 'absent', label: 'Absent' }],
    counts: { pending: 0, answered: 11, passed: 2, help: 1, skipped: 1, absent: 1 }, total: 16, answeredAloud: 11,
  },
  tallies: { questions: 5, hands: 61 },
  activities: {
    kinds: [{ id: 'check', label: 'Quick knowledge check' }, { id: 'think', label: 'Think and explain' }, { id: 'group', label: 'Group challenge' }, { id: 'diagram', label: 'Explain the diagram' }, { id: 'real', label: 'Real-world application' }],
    counts: { check: 2, think: 1, group: 1, diagram: 0, real: 1 }, total: 5,
  },
  note: 'Counted from the rooms in this report. They never enter a mark, a share, a state or a level (decision 3), and the professor\'s observations are private to staff.',
};
const zeros = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, 0]));
const RECORDS_NONE = {
  ...RECORDS,
  observations: { ...RECORDS.observations, counts: zeros(RECORDS.observations.counts), studentDays: 0 },
  picks: { ...RECORDS.picks, counts: zeros(RECORDS.picks.counts), total: 0, answeredAloud: 0 },
  tallies: { questions: 0, hands: 0 },
  activities: { ...RECORDS.activities, counts: zeros(RECORDS.activities.counts), total: 0 },
};

const FULL = buildReport();
const THIN = buildReport({ seed: 11, scale: 0.42 });
const NOBODY = buildReport({ none: true, rooms: [], outcomes: OUTCOMES.slice(0, 3) });
const NO_OUTCOMES = { ...buildReport({ seed: 5, outcomes: [] }), unmapped: [{ ...CHAPTER, topic: 'Transport layer services', inChapter: true, answers: 120 }] };
const SAVED = buildReport({ seed: 7, formula: SAVED_FORMULA, methodology: SAVED_METHOD, rooms: ROOMS.slice(0, 2), window: { from: '2026-11-01', to: '2026-11-12', rooms: null } });

/* ------------------------------------------------------ one student's report */

const ARJUN = FULL.students[3];
const answer = (n, o) => ({
  answerId: hex(0xf000 + n), attempt: 1, final: true, ungraded: false, kind: 'mcq', questionSource: 'llm', questionSourceType: 'aiGenerated',
  room: { code: 'K7W4BM', title: ROOMS[0].title, startedAt: ROOMS[0].startedAt }, answeredAt: ROOMS[0].startedAt,
  chosen: true, counts: true, note: 'Counted.', via: 'topic', detail: '', ...o,
});
const STUDENT = {
  class: CLASS,
  student: { id: ARJUN.studentId, rollNo: ARJUN.rollNo, name: ARJUN.name, active: true, removedAt: null, status: 'active', statusLabel: 'On the roster' },
  window: FULL.window, rooms: ROOMS, formula: EXAMPLE_FORMULA, methodology: EXAMPLE_METHOD, evidenceTypes: EVIDENCE_TYPES, questionSources: QUESTION_SOURCES, states: STATES,
  outcomes: ARJUN.outcomes.map((c, k) => ({ ...c, statement: OUTCOMES[k].statement, archived: OUTCOMES[k].archived })),
  bloom: ARJUN.bloom,
  answers: [
    answer(1, { level: 'remember', question: { text: 'Which transport-layer service delivers a segment to the right socket on the receiving host?', bloom: 'remember', kind: 'mcq' }, score: 1, correct: true, evidenceType: 'digital', outcomes: [{ id: OUTCOMES[0].id, code: 'CO1', weight: 1 }] }),
    answer(2, { level: 'understand', kind: 'match', question: { text: 'Match each idea from User Datagram Protocol to what it means.', bloom: 'understand', kind: 'match' }, score: 0.5, correct: false, detail: '2/4 pairs', evidenceType: 'digital', questionSource: 'fallback', questionSourceType: 'offlineTemplate', outcomes: [{ id: OUTCOMES[1].id, code: 'CO2', weight: 1 }] }),
    answer(3, { level: 'understand', question: { text: 'Why does TCP need a three-way handshake before sending data?', bloom: 'understand', kind: 'mcq' }, score: 0, correct: false, final: false, chosen: false, counts: false, evidenceType: 'digital', note: 'Not counted: an attempt followed by a retry.', outcomes: [{ id: OUTCOMES[1].id, code: 'CO2', weight: 2 }] }),
    answer(4, { attempt: 2, level: 'understand', question: { text: 'Why does TCP need a three-way handshake before sending data?', bloom: 'understand', kind: 'mcq' }, score: 1, correct: true, evidenceType: 'digital', outcomes: [{ id: OUTCOMES[1].id, code: 'CO2', weight: 2 }] }),
    answer(5, { room: { code: 'M4RE79', title: ROOMS[1].title, startedAt: ROOMS[1].startedAt }, answeredAt: ROOMS[1].startedAt, level: 'analyse', kind: 'open', questionSource: 'teacher', questionSourceType: 'professorWritten', question: { text: 'A video call app loses a few packets a second. Argue whether it should use UDP or TCP.', bloom: 'analyse', kind: 'open' }, response: 'UDP, because a late frame is useless: retransmitting it would only add delay. The app can hide a lost frame and carry on.', score: 0.5, correct: false, evidenceType: 'aiProvisional', counts: false, note: 'Shown, not counted: the formula does not count provisional machine marks.', outcomes: [{ id: OUTCOMES[1].id, code: 'CO2', weight: 2 }] }),
    answer(6, { room: { code: 'M4RE79', title: ROOMS[1].title, startedAt: ROOMS[1].startedAt }, answeredAt: ROOMS[1].startedAt, level: 'evaluate', kind: 'open', question: { text: 'Judge whether a 64 KB receive window is enough on a 100 ms, 100 Mbit/s link.', bloom: 'evaluate', kind: 'open' }, response: 'Not enough: the bandwidth-delay product is about 1.25 MB, so a 64 KB window caps the rate near 5 Mbit/s.', score: 1, correct: true, evidenceType: 'humanReviewed', outcomes: [{ id: OUTCOMES[2].id, code: 'CO3', weight: 1 }], via: 'question' }),
    answer(7, { room: { code: 'JDMEE4', title: ROOMS[2].title, startedAt: ROOMS[2].startedAt }, answeredAt: ROOMS[2].startedAt, level: 'apply', question: { text: 'Which call opens a listening socket on port 8080?', bloom: 'apply', kind: 'mcq' }, score: 1, correct: true, evidenceType: 'digital', via: 'unmapped', outcomes: [], note: 'Counted. No course outcome is mapped to its topic ("Socket programming"). Given under roll number 21CS4, which this room’s attendance mark for the student was made under.', givenAs: '21CS4' }),
    answer(8, { room: { code: 'JDMEE4', title: ROOMS[2].title, startedAt: ROOMS[2].startedAt }, answeredAt: ROOMS[2].startedAt, level: 'remember', kind: 'poll', ungraded: true, question: { text: 'How confident are you with sliding windows?', bloom: 'remember', kind: 'poll' }, score: null, correct: null, evidenceType: 'ungraded', counts: false, note: 'A poll: not marked, counted only as a number.', outcomes: [] }),
  ],
  answerCounts: {
    rows: 8, setAside: 1, chosen: 7, ungraded: 1, graded: 6, byType: { digital: 4, aiProvisional: 1, humanReviewed: 1 }, mapped: 5, excluded: 0, unmapped: 1,
    bySource: { aiGenerated: 4, professorWritten: 1, offlineTemplate: 1 },
  },
  teacherRecords: {
    label: RECORDS.label,
    observations: { counts: { understood: 1, participated: 2, revision: 1, support: 0 }, days: [
      { day: '2026-11-03', kind: 'participated', label: 'Participated', note: 'Explained demultiplexing to his partner with the post-office picture.' },
      { day: '2026-11-10', kind: 'revision', label: 'Needs revision', note: 'Mixed up flow control and congestion control.' },
      { day: '2026-11-17', kind: 'understood', label: 'Understood', note: '' },
    ] },
    picks: { counts: { answered: 1, passed: 0 }, list: [{ room: 'M4RE79', round: 2, status: 'answered', pickedAt: ROOMS[1].startedAt }] },
    note: RECORDS.note,
  },
  privacy: PRIVACY,
};

/* --------------------------------------------------------------- the frame */

/** A stand-in for ReportWindow (which reads the class's rooms from the server). */
function WindowStandIn() {
  const [v, setV] = useState({ from: '', to: '' });
  return (
    <div className="rwin" role="group" aria-label="Rooms this report reads">
      <label className="rwin-f"><span>From</span><input type="date" className="input input-sm" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></label>
      <label className="rwin-f"><span>To</span><input type="date" className="input input-sm" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></label>
      <Button size="sm" icon="rooms">Every room in these dates</Button>
    </div>
  );
}

function Frame({ children, canEdit = true }) {
  return (
    <AccountShell
      current="classes"
      crumb={<span>Classes <span aria-hidden="true">/</span> {CLASS.section}</span>}
      title={CLASS.courseName}
      sub={`${CLASS.section} · ${CLASS.termLabel} · 20 students on the roster`}
    >
      <div className="cl-viewbar">
        <Segmented
          label="Class view"
          value="attainment"
          onChange={() => {}}
          options={[{ id: 'roster', label: 'Roster', count: 20 }, { id: 'rooms', label: 'Across rooms' }, { id: 'outcomes', label: 'Outcomes' }, { id: 'attainment', label: 'Attainment' }, { id: 'register', label: 'Marks register' }]}
        />
        {!canEdit && <span className="cl-ro">Read only: changes belong to the professor who keeps this class.</span>}
      </div>
      {children}
    </AccountShell>
  );
}

/**
 * The tab with everything pressable: files answer after a moment, a name
 * opens the sample student, and the formula editor saves locally.
 */
function Live({
  data = FULL, cfg = configReply(EXAMPLE_FORMULA, EXAMPLE_METHOD), canEdit = true, first, matrix, openFirst,
  openStudent = false, editor = null, report: reportOverride,
}) {
  const [files, setFiles] = useState({ busy: null, note: null });
  const [row, setRow] = useState(openStudent ? ARJUN : null);
  const [editing, setEditing] = useState(Boolean(editor));
  const [config, setConfig] = useState({ ...cfg, canEdit });
  const [save, setSave] = useState(editor?.state ?? {});
  const [notice, setNotice] = useState(null);

  async function csv(sheet) {
    setFiles({ busy: sheet, note: null });
    await wait(600);
    setFiles({ busy: null, note: { tone: 'ok', text: `Saved bloomloop-${sheet === 'bloom' ? 'bloom-attainment' : 'attainment'}-computer-networks-cs-a-6fc2802e-2026-11-19.csv` } });
  }
  async function print() {
    setFiles({ busy: 'print', note: null });
    await wait(600);
    setFiles({ busy: null, note: { tone: 'ok', text: 'Opened in a new tab: print it from there.' } });
  }
  async function onSave(body) {
    setSave({ saving: true });
    await wait(700);
    const next = { ...config.formula, source: 'saved', version: config.formula.version + 1, savedAt: new Date().toISOString(), preset: null,
      config: { ...(body.preset ? PRESETS.presets.find((p) => p.id === body.preset).config : config.formula.config), ...(body.config ?? {}), evidence: { ...config.formula.config.evidence, ...(body.config?.evidence ?? {}) } } };
    const message = `Saved as version ${next.version}. Every report from now on uses it and says so; earlier versions are kept.`;
    setConfig({ ...config, formula: next });
    setSave({ result: { changed: true, message } });
    setNotice({ tone: 'ok', text: message });
  }

  return (
    <Frame canEdit={canEdit}>
      <AttainmentView
        report={reportOverride ?? { data, loading: false, error: '' }}
        config={{ data: config }}
        windowBar={<WindowStandIn />}
        onReload={() => {}}
        files={files}
        onCsv={csv}
        onPrint={print}
        onOpenStudent={(s) => setRow(s)}
        onEditFormula={() => { setSave({}); setEditing(true); }}
        notice={notice}
        first={first}
        matrix={matrix}
        openFirst={openFirst}
      />
      <StudentSheet
        row={row}
        state={row ? { data: row.studentId === ARJUN.studentId ? STUDENT : { ...STUDENT, student: { ...STUDENT.student, ...row, id: row.studentId } }, loading: false, error: '' } : null}
        onClose={() => setRow(null)}
        onPrint={() => {}}
      />
      {canEdit && (
        <FormulaEditor
          open={editing}
          onOpenChange={setEditing}
          current={config}
          presets={PRESETS}
          rooms={ROOMS}
          saving={save.saving}
          result={save.result}
          error={save.error}
          conflict={save.conflict}
          onSave={onSave}
          onReapply={() => onSave(editor?.body ?? { config: { minAnswers: 4 } })}
          start={editor?.start}
        />
      )}
    </Frame>
  );
}

const SAVED_CFG = configReply(SAVED_FORMULA, SAVED_METHOD);
const DRAFT_400 = {
  from: 'current',
  draft: { studentThreshold: '60', minAnswers: '3', levels: [{ minShare: '50' }, { minShare: '40' }, { minShare: '70' }], evidence: { digital: true, aiProvisional: false, humanReviewed: true }, attempts: 'final', roomWeights: [] },
};
const DRAFT_409 = { from: 'current', draft: { ...toDraft(SAVED_CONFIG, SAVED_FORMULA.roomWeights), minAnswers: '4' } };

export default [
  {
    id: 'attain-report', title: 'Attainment: the class report', role: 'professor',
    note: 'Outcomes, Bloom bands, students in roll order, unmapped, teacher records and how it was made. Every button answers.',
    render: () => <Live key="attain-report" />,
  },
  {
    id: 'attain-rests-on', title: 'Attainment: what a figure rests on', role: 'professor',
    note: 'Marks by evidence type, counted or shown, by question source, and the answers outside the share.',
    render: () => <Live key="attain-rests-on" openFirst />,
  },
  {
    id: 'attain-levels', title: 'Attainment: six levels, students by band', role: 'professor',
    note: 'One press from the bands (decision 6); the student table read by Bloom band.',
    render: () => <Live key="attain-levels" first="levels" matrix="bands" />,
  },
  {
    id: 'attain-thin', title: 'Attainment: not enough evidence', role: 'professor',
    note: 'Few answers: most of the roster is “Not enough evidence”, its own state, with their answers beside the figure.',
    render: () => <Live key="attain-thin" data={THIN} />,
  },
  {
    id: 'attain-nobody', title: 'Attainment: nobody counted yet', role: 'professor',
    note: 'No rooms: every share a dash with why, no level.',
    render: () => <Live key="attain-nobody" data={NOBODY} />,
  },
  {
    id: 'attain-no-outcomes', title: 'Attainment: no course outcomes yet', role: 'professor',
    render: () => <Live key="attain-no-outcomes" data={NO_OUTCOMES} />,
  },
  {
    id: 'attain-hod', title: 'Attainment: read only, a saved formula', role: 'hod',
    note: 'canEdit is false. Version 2 with a weighted room not in this report and one deleted.',
    render: () => <Live key="attain-hod" data={SAVED} cfg={SAVED_CFG} canEdit={false} />,
  },
  {
    id: 'attain-student', title: 'Attainment: one student’s report', role: 'professor',
    note: 'Every answer behind each figure: counted, shown not counted, set aside, unmapped, a poll; teacher records apart.',
    render: () => <Live key="attain-student" openStudent />,
  },
  {
    id: 'attain-formula-example', title: 'Attainment: the formula, an example in use', role: 'professor',
    render: () => <Live key="attain-formula-example" editor={{}} />,
  },
  {
    id: 'attain-formula-saved', title: 'Attainment: the formula, a saved version', role: 'professor',
    note: 'Version 2 with room weights, one of them a deleted room.',
    render: () => <Live key="attain-formula-saved" data={SAVED} cfg={SAVED_CFG} editor={{}} />,
  },
  {
    id: 'attain-formula-400', title: 'Attainment: a save refused (400)', role: 'professor',
    note: 'The server’s sentence; nothing saved; the draft kept.',
    render: () => (
      <Live key="attain-formula-400" editor={{ start: DRAFT_400, state: { error: { status: 400, message: 'levels must strictly increase: levels[1] (level 2 at 0.4) does not come above levels[0] (level 1 at 0.5) in both level and minShare.' } } }} />
    ),
  },
  {
    id: 'attain-formula-409', title: 'Attainment: a version race (409)', role: 'professor',
    note: 'Read again; the same changes can be sent again.',
    render: () => (
      <Live key="attain-formula-409"
        data={SAVED}
        cfg={SAVED_CFG}
        editor={{ start: DRAFT_409, body: { config: { minAnswers: 4 } }, state: { conflict: { message: 'Another save took version 2 of this class’s formula first.' } } }}
      />
    ),
  },
  {
    id: 'attain-formula-saved-now', title: 'Attainment: a formula just saved', role: 'professor',
    render: () => <Live key="attain-formula-saved-now" data={SAVED} cfg={SAVED_CFG} editor={{ state: { result: { changed: true, message: 'Saved as version 2. Every report from now on uses it and says so; earlier versions are kept.' } } }} />,
  },
  {
    id: 'attain-loading', title: 'Attainment: loading', role: 'professor',
    render: () => <Live key="attain-loading" report={{ data: null, loading: true }} />,
  },
  {
    id: 'attain-missing', title: 'Attainment: not found', role: 'professor',
    render: () => <Live key="attain-missing" report={{ data: null, loading: false, status: 404, error: 'That class was not found.' }} />,
  },
];
