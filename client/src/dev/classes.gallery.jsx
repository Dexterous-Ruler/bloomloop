/**
 * Classes, drawn from sample data. Development only.
 *
 * Every object has the shape the server returns (docs/API.md, "Phase 3:
 * classes, rosters and attendance", the observations part of "the
 * teacher-record store", and GET /api/classes/:id/analytics), and the figures
 * agree with each other: sizes match rosters, buckets add up to the students
 * counted, levels add up to the answers, the bands to the levels. Nothing here
 * talks to the server: the callbacks wait a moment and change local state, so
 * every button can be pressed.
 */

import { useState } from 'react';

import { ClassListView, ClassView } from '../account/Classes.jsx';
import RosterImport from '../account/RosterImport.jsx';
import AccountShell from '../shell/AccountShell.jsx';
import { Button } from '../ui/index.jsx';

const NOW = Date.now();
const daysAgo = (d, h = 0) => new Date(NOW - d * 86400000 - h * 3600000).toISOString();
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const hex = (n) => n.toString(16).padStart(24, '0');
const dayStr = (d) => {
  const t = new Date(NOW - d * 86400000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/* ------------------------------------------------------------------ classes */

const CN = {
  id: '6fc2802e8bcc25b1479fd944', courseName: 'Computer Networks', section: 'CS-A', termLabel: 'Odd term 2026',
  ownerId: 'a0000000-0000-4000-8000-000000000002', createdAt: daysAgo(40), updatedAt: daysAgo(3), size: 25, canEdit: true,
};
const CLASSES = [
  { ...CN, id: '7922c0a1d4e5f60718293a4b', courseName: 'Data Structures', section: 'SY-CS A', termLabel: 'Sem III 2026', createdAt: daysAgo(6), size: 58 },
  { ...CN, id: '81a3b4c5d6e7f8091a2b3c4d', courseName: 'Operating Systems', section: 'TY-CSF B', termLabel: 'Sem V 2026', createdAt: daysAgo(21), size: 0 },
  CN,
  { ...CN, id: '93b4c5d6e7f8091a2b3c4d5e', courseName: 'Computer Networks lab', section: 'CS-A batch 2', termLabel: '', createdAt: daysAgo(44), size: 1 },
];

const NAMES = [
  'Aarav Shah', 'Aditi Rao', 'Ananya Iyer', 'Arjun Patil', 'Ishaan Kulkarni', 'Kavya Nair', 'Rohan Deshmukh',
  'Sneha Joshi', 'Vihaan Mehta', 'Diya Kapoor', 'Aryan Gupta', 'Meera Pillai', 'Kabir Singh', 'Saanvi Reddy',
  'Yash Pawar', 'Tanvi Bhosale', 'Reyansh Menon', 'Ira Banerjee', 'Atharv Chavan', 'Myra Fernandes',
  'Dev Malhotra', 'Riya Sawant', 'Krish Agarwal', 'Navya Hegde', 'Siddharth More',
];
const STUDENTS = NAMES.map((name, i) => ({
  id: hex(0xa000 + i), rollNo: `21CS${String(i + 1).padStart(2, '0')}`, name,
  active: true, addedAt: daysAgo(40), removedAt: null, under18: false,
}));
const REMOVED = [
  { id: hex(0xb001), rollNo: '21CS26', name: 'Ira Bose', active: false, addedAt: daysAgo(40), removedAt: daysAgo(12), under18: false },
  { id: hex(0xb002), rollNo: '21CS31', name: 'Zoya Qureshi', active: false, addedAt: daysAgo(40), removedAt: daysAgo(2), under18: false },
];
const ROSTER = { class: CN, students: STUDENTS, removed: REMOVED };

/* Decision 8: two first-years marked under 18, one of them since removed. The
   note is the server's, word for word (UNDER_18_NOTE in services/roster.js). */
const MINORS = new Set(['21CS03', '21CS17', '21CS31']);
const marked = (s) => ({ ...s, under18: MINORS.has(s.rollNo) });
const U18_NOTE = 'Integrity signals are neither recorded nor shown for a student marked under 18, in any room opened for this class. The mark is a yes or no; no date of birth is kept. This is a working default, not legal advice: a lawyer must confirm it before any college signs or before 13 May 2027.';
// GET /api/classes/:id carries the note whenever a student on the roster is
// marked, removed students included (Phase 5 follow-ups).
const ROSTER_U18 = { class: CN, students: STUDENTS.map(marked), removed: REMOVED.map(marked), under18Note: U18_NOTE };
// A read without the note (an older server): this screen's own sentence stands in.
const ROSTER_U18_BARE = { class: CN, students: STUDENTS.map(marked), removed: REMOVED.map(marked) };

const MESSAGE = 'Removed from the roster. Nothing they did is deleted: their answers in every room, their attendance and their records stay, and they can be put back on the roster at any time.';

/* ---------------------------------------------------------------- the paste */

const PASTE_TEXT = [
  'Roll no, Name',
  '21CS32, Nikhil Jadhav',
  '21CS33, Pooja Shinde',
  '21CS34,',
  ', Rahul Kale',
  '21CS05, Ishaan K',
  '21CS35, Farah Shaikh 9845012345',
  '21CS36, Om Pawar, om@example.edu',
  '3, Gauri Naik',
  '03, Harsh Wagh',
].join('\n');

const added = (roll, name, n, under18 = false) => ({ id: hex(0xc000 + n), rollNo: roll, name, active: true, addedAt: daysAgo(0), removedAt: null, under18 });
const PASTE_REPLY = {
  added: [
    added('21CS32', 'Nikhil Jadhav', 1), added('21CS33', 'Pooja Shinde', 2), added('21CS36', 'Om Pawar', 3),
    added('3', 'Gauri Naik', 4), added('03', 'Harsh Wagh', 5),
  ],
  refused: [
    { index: 2, roll: '21CS34', name: '', reason: 'the name is missing' },
    { index: 3, roll: '', name: 'Rahul Kale', reason: 'the roll number is missing' },
    { index: 4, roll: '21CS05', name: 'Ishaan K', reason: 'roll number 21CS05 is already on this class\'s roster (Ishaan Kulkarni)' },
    { index: 5, roll: '21CS35', name: 'Farah Shaikh 9845012345', reason: 'the name holds a long number (a phone number or a date of birth?); a roster keeps a roll number and a name only' },
  ],
  ignoredFields: ['email', 'phone'],
  note: 'A roster keeps a roll number and a name only. Not stored: email, phone.',
  size: 30,
  class: { ...CN, size: 30 },
};
const START_RESULT = { text: PASTE_TEXT, reply: PASTE_REPLY };
const START_PREVIEW = { text: `${PASTE_TEXT}\n21CS37\tTara Iyer\t9822012345\t12-05-2004` };

/* A paste whose heading names an Under 18 column: yes, no, blank, and one
   cell that is neither (a date of birth), which the preview never shows. */
const PASTE_U18_TEXT = [
  'Roll No, Name, Under 18, Phone',
  '21CS32, Nikhil Jadhav, yes, 9822012345',
  '21CS33, Pooja Shinde, no',
  '21CS34, Gauri Naik,',
  '21CS35, Farah Shaikh, 12-05-2009',
].join('\n');
const PASTE_U18_REPLY = {
  added: [added('21CS32', 'Nikhil Jadhav', 11, true), added('21CS33', 'Pooja Shinde', 12), added('21CS34', 'Gauri Naik', 13)],
  refused: [{ index: 3, roll: '21CS35', name: 'Farah Shaikh', reason: 'the under-18 mark must be yes or no (or left blank for no)' }],
  ignoredFields: [],
  under18Note: U18_NOTE,
  size: 28,
  class: { ...CN, size: 28 },
};

/* ------------------------------------------------- the import, under 18 */

/* POST /api/classes/:id/students/import for a file with an "Under 18"
   column, as the server answers it (routes/classes.js). Its date-of-birth
   column is named back and never read. */
const IMPORT_FILE = { name: 'cs-a-first-years.csv', size: 1210 };
const DRY_U18 = {
  dryRun: true,
  read: { delimiter: 'comma', columns: { roll: 'Roll No.', name: 'Student Name', under18: 'Under 18' }, rows: 6, blankLines: 0 },
  wouldAdd: [
    { line: 2, rollNo: '21CS27', name: 'Chitra Rao', under18: true },
    { line: 3, rollNo: '21CS28', name: 'Dev Malhotra', under18: false },
    { line: 4, rollNo: '21CS29', name: 'Meera Joshi', under18: true },
    { line: 5, rollNo: '21CS30', name: 'Navya Hegde', under18: false },
  ],
  refused: [
    { line: 6, roll: '21CS01', name: 'Aarav Shah', code: 'on-roster', reason: 'roll number 21CS01 is already on this class\'s roster' },
    { line: 7, roll: '21CS32', name: 'Kiran Shetty', code: 'bad-under-18', reason: 'the under-18 mark must be yes or no (or left blank for no)' },
  ],
  duplicates: {
    inFile: [],
    onRoster: [{ line: 6, rollNo: '21CS01', onRoster: { ...STUDENTS[0] } }],
  },
  removed: [],
  ignoredColumns: ['Date of birth'],
  note: 'A roster keeps a roll number and a name only. Not read from the file: Date of birth.',
  under18: 'Some students already on the roster are marked under 18 in the file but not on the roster. An import does not change a student already on it: mark them on the class\'s roster.',
  under18Note: U18_NOTE,
  message: 'Nothing was changed: this is what importing the file would do.',
  size: 25,
  sizeAfter: 29,
  class: { ...CN, size: 25 },
};
const DONE_U18 = (() => {
  const { wouldAdd, message, sizeAfter, ...rest } = DRY_U18;
  return {
    ...rest,
    dryRun: false,
    added: wouldAdd.map((s, i) => ({ line: s.line, ...added(s.rollNo, s.name, 20 + i, s.under18) })),
    size: 29,
    class: { ...CN, size: 29 },
  };
})();

/** The import dialog over the class page, answered from the samples above. */
function LiveImport({ start }) {
  const [open, setOpen] = useState(true);
  const send = async (_id, _csv, dryRun) => { await wait(700); return dryRun ? DRY_U18 : DONE_U18; };
  return (
    <AccountShell current="classes" crumb="Classes / CS-A" title={CN.courseName} sub="CS-A · Odd term 2026 · 25 students on the roster">
      <div className="cluster">
        <Button icon="upload" onClick={() => setOpen(true)}>Import a CSV</Button>
      </div>
      <RosterImport classId={CN.id} open={open} onOpenChange={setOpen} onDone={() => {}} send={send} restore={async () => {}} start={start} />
    </AccountShell>
  );
}

/* ------------------------------------------------------------- observations */

const KINDS = [
  { id: 'understood', label: 'Understood' }, { id: 'participated', label: 'Participated' },
  { id: 'revision', label: 'Needs revision' }, { id: 'support', label: 'Needs additional support' },
];
const LABELS = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));
const mark = (n, kind, note, d, h, room) => ({
  id: hex(0xd000 + n), kind, label: kind ? LABELS[kind] : null, note, observedAt: daysAgo(d, h), observedBy: null, room,
});
const OBS_DAYS = [
  { day: dayStr(1), current: mark(9, 'participated', 'Asked why UDP has no handshake, and answered it herself.', 1, 3, '2V8N5W'), history: [mark(9, 'participated', 'Asked why UDP has no handshake, and answered it herself.', 1, 3, '2V8N5W')] },
  {
    day: dayStr(8),
    current: mark(7, 'understood', 'Explained the three-way handshake to her group.', 8, 2, 'TN3WXC'),
    history: [mark(6, 'revision', 'Mixed up SYN and ACK.', 8, 4, 'TN3WXC'), mark(7, 'understood', 'Explained the three-way handshake to her group.', 8, 2, 'TN3WXC')],
  },
  { day: dayStr(15), current: mark(5, 'participated', '', 15, 3, 'HQ7MZP'), history: [mark(5, 'participated', '', 15, 3, 'HQ7MZP')] },
  { day: dayStr(22), current: mark(3, 'revision', 'Port numbers: revisit with the post-office picture.', 22, 3, 'K5ARGW'), history: [mark(3, 'revision', 'Port numbers: revisit with the post-office picture.', 22, 3, 'K5ARGW')] },
  { day: dayStr(29), current: mark(1, 'understood', '', 29, 3, 'M4PRTC'), history: [mark(1, 'understood', '', 29, 3, 'M4PRTC')] },
];
const PRIVACY = 'Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level.';
const obsOf = (s, days = OBS_DAYS) => {
  const counts = { understood: 0, participated: 0, revision: 0, support: 0, days: days.length };
  days.forEach((d) => { if (d.current?.kind) counts[d.current.kind] += 1; });
  return { class: { id: CN.id, courseName: CN.courseName, section: CN.section, termLabel: CN.termLabel }, student: s, kinds: KINDS, counts, days, privacy: PRIVACY };
};

/* ---------------------------------------------------------------- analytics */

/* The count beside every figure (Phase 5), as the server words it (basedOn in services/honesty.js). */
const basedOn = (n, students = null, unit = 'graded answer') => {
  if (!n) return `No ${unit}s yet.`;
  const many = (k, one) => `${k.toLocaleString()} ${k === 1 ? one : `${one}s`}`;
  return `Based on ${many(n, unit)}${students === null ? '' : ` from ${many(students, 'student')}`}.`;
};
const lv = (level, label, answers, correct) => ({ level, label, answers, correct, accuracy: answers ? correct / answers : null, sentence: basedOn(answers) });
const band = (id, label, levels, answers, correct) => ({ id, label, levels, answers, correct, accuracy: answers ? correct / answers : null, sentence: basedOn(answers) });
const levelsOf = (r) => [
  lv('remember', 'Remember', r[0], r[1]), lv('understand', 'Understand', r[2], r[3]), lv('apply', 'Apply', r[4], r[5]),
  lv('analyse', 'Analyse', r[6], r[7]), lv('evaluate', 'Evaluate', r[8], r[9]), lv('create', 'Create', r[10], r[11]),
];
const bandsOf = (r) => [
  band('lower', 'Remember and Understand', ['remember', 'understand'], r[0] + r[2], r[1] + r[3]),
  band('middle', 'Apply and Analyse', ['apply', 'analyse'], r[4] + r[6], r[5] + r[7]),
  band('higher', 'Evaluate and Create', ['evaluate', 'create'], r[8] + r[10], r[9] + r[11]),
];
const att = (present, late, absent, unmarked) => ({ present, late, absent, unmarked, classSize: 25, summary: `${present + late} / 25 present` });
const room = (code, d, mode, status, acc, part, attendance, lvls, bands) => ({
  code, title: 'Computer Networks - Unit 4: The Transport Layer', status, startedAt: daysAgo(d, 4), closedAt: status === 'closed' ? daysAgo(d, 3) : null, mode,
  accuracy: { ...acc, sentence: basedOn(acc.answers, acc.answers ? acc.students : null) }, participation: part, attendance, bands,
  levels: levelsOf(lvls), levelBands: bandsOf(lvls),
});
const L1 = [150, 118, 120, 66, 30, 12, 10, 3, 0, 0, 0, 0];
const L2 = [130, 104, 140, 82, 50, 24, 20, 8, 4, 1, 0, 0];
const L4 = [140, 108, 120, 73, 80, 36, 40, 14, 16, 5, 6, 1];
const ROOMS = [
  room('K5ARGW', 22, 'devices', 'closed', { value: 0.4667, students: 22, answers: 310 }, { value: 22 / 24, present: 24, answered: 22, notAnswered: 2 }, att(23, 1, 1, 0), L1, { 'needs-support': 7, developing: 9, excelling: 6, notEnough: 0 }),
  room('HQ7MZP', 15, 'mixed', 'closed', { value: 0.52, students: 23, answers: 344 }, { value: 23 / 24, present: 24, answered: 23, notAnswered: 1 }, att(22, 2, 1, 0), L2, { 'needs-support': 6, developing: 8, excelling: 9, notEnough: 0 }),
  room('TN3WXC', 8, 'teacher-led', 'closed', { value: null, students: 0, answers: 0 }, { value: null, present: 21, answered: 0, notAnswered: 0 }, att(21, 0, 4, 0), Array(12).fill(0), { 'needs-support': 0, developing: 0, excelling: 0, notEnough: 0 }),
  room('2V8N5W', 1, 'devices', 'open', { value: 0.61, students: 24, answers: 402 }, { value: 1, present: 24, answered: 24, notAnswered: 0 }, att(24, 0, 0, 1), L4, { 'needs-support': 4, developing: 8, excelling: 12, notEnough: 0 }),
];
const WINDOW = L1.map((v, i) => v + L2[i] + L4[i]);
const WRONG_KEY = {
  id: 'negative-point-biserial',
  message: 'Students who did well on their other answers got this one wrong more often than those who did not. The usual cause is a wrong answer key: check the key first, then the wording.',
};
/* Who wrote a question (Phase 5 provenance), as services/honesty.js words it. */
const PROVENANCE = {
  ai: {
    source: 'ai', sourceLabel: 'AI-generated', model: 'gemini-2.5-flash', approval: 'approved', approvedAt: daysAgo(30), approvedBy: null, aiDraft: false,
    label: 'AI-generated, approved',
    sentence: 'Written by the language model (gemini-2.5-flash) from the professor\'s material. Approved by a professor.',
  },
  professor: {
    source: 'professor', sourceLabel: 'Professor-written', model: null, approval: 'written', approvedAt: null, approvedBy: null, aiDraft: false,
    label: 'Professor-written', sentence: 'Written by a professor. In use since a professor wrote it.',
  },
  template: {
    source: 'template', sourceLabel: 'Offline template', model: 'offline-template', approval: 'approved', approvedAt: daysAgo(30), approvedBy: null, aiDraft: false,
    label: 'Offline template, approved',
    sentence: 'Made by the offline template from the professor\'s material, without a language model. Approved by a professor.',
  },
};
const SURE = { uncertain: false, reasons: [], sentence: null };
/* An older Choose one at Analyse: its kind does not ask for its level. */
const KIND_MISFIT = 'A "Choose one" question is not one of the kinds that ask for Analyse ("Choose all that apply", "Pick the words"), so it may not ask for that level at all. Retag it, or change its kind.';
const UNSURE = { uncertain: true, reasons: [{ id: 'kind-does-not-fit-level', message: KIND_MISFIT }], sentence: `Level uncertain. ${KIND_MISFIT}` };
const english = (attempts, correct) => ({
  original: 'en', originalName: 'English',
  languages: [{ language: 'en', name: 'English', answers: attempts, correct, share: correct / attempts, original: true }],
  otherThanOriginal: 0, note: null, warning: null,
});
const item = (n, text, kind, bloom, topic, attempts, correct, flags = [], by = 'template', check = SURE) => ({
  questionId: hex(0xe000 + n), text, kind, bloom, topic, status: 'active',
  provenance: PROVENANCE[by], levelCheck: check,
  attempts, correct, proportionCorrect: correct / attempts,
  meanScore: null, band: correct / attempts < 0.4 ? 'hard' : 'medium',
  basis: { answers: attempts, provisional: false, sentence: basedOn(attempts, null, 'answer') },
  pointBiserial: flags.length ? -0.31 : 0.22, pointBiserialN: attempts,
  pointBiserialNote: null, flags, versions: 1, languages: english(attempts, correct),
});
const BUCKETS = [0, 1, 1, 3, 4, 4, 5, 3, 2, 0];
const ANALYTICS = {
  class: { id: CN.id, courseName: CN.courseName, section: CN.section, termLabel: CN.termLabel },
  last: 4,
  rooms: ROOMS,
  trend: {
    accuracy: { first: 0.4667, last: 0.61, change: 0.1433, rooms: 3 },
    participation: { first: 22 / 24, last: 1, change: 1 - 22 / 24, rooms: 3 },
  },
  histogram: {
    buckets: BUCKETS.map((students, i) => ({ from: i * 10, to: i * 10 + 10, students })),
    legend: [
      { band: 'needs-support', label: 'Below 40%', students: 5 },
      { band: 'developing', label: '40-60%', students: 8 },
      { band: 'excelling', label: '60% and above', students: 10 },
    ],
    students: 23, answers: 1056, notEnough: 1,
    sentence: 'Based on 1,056 graded answers from 23 students. 1 more with too few answers for a band are not in it.',
  },
  levels: levelsOf(WINDOW),
  levelBands: bandsOf(WINDOW),
  hardest: {
    items: [
      item(1, 'Which protocol is connectionless?', 'mcq', 'remember', 'Transport', 24, 9, [WRONG_KEY]),
      item(2, 'A segment arrives with a bad checksum. What does UDP do with it?', 'mcq', 'understand', 'User Datagram Protocol', 23, 6, [], 'ai'),
      item(3, 'Put the steps of closing a TCP connection in order.', 'order', 'apply', 'Connection management', 18, 5, [], 'professor'),
      item(4, 'Which header field lets a receiver say how much more data it can take?', 'blank', 'remember', 'Flow control', 22, 8),
      item(5, 'Why does TCP slow its sending rate after a lost segment?', 'mcq', 'analyse', 'Congestion control', 9, 4, [], 'ai', UNSURE),
    ],
    minAttempts: 5, answers: 1056, questions: 31, belowFloor: 4,
  },
  definitions: {
    display: 'Decision 6 is open: every level figure is given as the six levels (levels) and as the three level bands (levelBands). Which a screen shows first is its choice.',
    classSize: 'Attendance counts against the class roster as it is now; students added or removed since a room ran change its class size.',
  },
  privacy: 'Bands, insight cards and the student card are for staff only: never shown on a phone or the projector. They describe answers already given and predict nothing.',
};
const NO_ROOMS = {
  ...ANALYTICS,
  rooms: [],
  trend: { accuracy: { first: null, last: null, change: null, rooms: 0 }, participation: { first: null, last: null, change: null, rooms: 0 } },
  histogram: { ...ANALYTICS.histogram, buckets: BUCKETS.map((_, i) => ({ from: i * 10, to: i * 10 + 10, students: 0 })), legend: ANALYTICS.histogram.legend.map((l) => ({ ...l, students: 0 })), students: 0, answers: 0, notEnough: 0, sentence: 'No graded answers yet.' },
  levels: levelsOf(Array(12).fill(0)),
  levelBands: bandsOf(Array(12).fill(0)),
  hardest: { items: [], minAttempts: 5, answers: 0, questions: 0, belowFloor: 0 },
};

/* Once a second language exists (the Hub's switch, Phase 6): one hard question
   answered in English and Hindi, with the server's note and its warning. */
const ANALYTICS_LANGUAGES = {
  ...ANALYTICS,
  hardest: {
    ...ANALYTICS.hardest,
    items: ANALYTICS.hardest.items.map((it, i) => (i !== 1 ? it : {
      ...it,
      languages: {
        original: 'en', originalName: 'English',
        languages: [
          { language: 'en', name: 'English', answers: 15, correct: 5, share: 5 / 15, original: true },
          { language: 'hi', name: 'Hindi', answers: 8, correct: 1, share: 1 / 8, original: false },
        ],
        otherThanOriginal: 8,
        note: '8 of 23 answers were given in a language other than the question\'s own (English).',
        warning: {
          languages: ['en', 'hi'], higher: 'en', lower: 'hi', gap: 0.21,
          text: 'Answers in Hindi were right 1 of 8 times (13%), against 5 of 15 (33%) in English: a gap of 21 points, above the 20-point threshold. Translation can change how hard a question is, so check the Hindi version before reading this as a gap in understanding.',
        },
      },
    })),
  },
};

/* ----------------------------------------------------------------- wrappers */

function LiveList({ classes, role }) {
  const [rows, setRows] = useState(classes);
  return (
    <ClassListView
      classes={rows}
      canCreate={role !== 'hod'}
      onReload={() => {}}
      onCreate={async (body) => {
        await wait(600);
        if (/@/.test(body.courseName)) throw new Error('courseName holds an email address or a phone number; teacher records keep neither.');
        setRows((r) => [{ ...CN, ...body, id: hex(Date.now()), createdAt: new Date().toISOString(), size: 0 }, ...r]);
      }}
    />
  );
}

/** One class, with every action done in local state. */
function LiveClass({
  initial, view: firstView = 'roster', analytics = ANALYTICS, startPaste, pasteReply = PASTE_REPLY, obsStudent, firstReading, note = '',
}) {
  const [data, setData] = useState(initial);
  const [view, setView] = useState(firstView);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState('');
  const [u18Note, setU18Note] = useState(note);
  const [obs, setObs] = useState(obsStudent ? { student: obsStudent, data: obsOf(obsStudent), loading: false, error: '' } : null);
  const [an, setAn] = useState({ last: 4, data: analytics, loading: false, error: '' });
  const canEdit = data.class.canEdit;

  const swap = (fn) => setData((d) => {
    const next = fn(d);
    return { ...next, class: { ...next.class, size: next.students.length } };
  });

  async function act(s, action, run) {
    setBusy({ id: s.id, action });
    setActionError('');
    setNotice(null);
    await wait(500);
    run();
    setBusy(null);
  }

  return (
    <ClassView
      data={data}
      onReload={() => {}}
      view={view}
      onView={setView}
      busy={busy}
      notice={notice}
      actionError={actionError}
      onDismiss={() => { setNotice(null); setActionError(''); }}
      onSaveStudent={async (s, patch) => {
        await wait(500);
        const roll = patch.rollNo ?? patch.roll;
        if (roll !== undefined) {
          const clash = [...data.students, ...data.removed].find((o) => o.id !== s.id && o.rollNo === roll.trim().toUpperCase());
          if (clash) throw new Error(`Roll number ${clash.rollNo} is already on this class's roster (${clash.name}).`);
        }
        if (patch.name !== undefined && !patch.name.trim()) throw new Error('The name is missing.');
        swap((d) => ({
          ...d,
          students: d.students.map((o) => (o.id === s.id
            ? { ...o, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(roll !== undefined ? { rollNo: roll.trim().toUpperCase() } : {}) }
            : o)),
        }));
      }}
      onRemove={(s) => act(s, 'remove', () => {
        const gone = { ...s, active: false, removedAt: new Date().toISOString() };
        swap((d) => ({ ...d, students: d.students.filter((o) => o.id !== s.id), removed: [gone, ...d.removed] }));
        setNotice({ message: MESSAGE, student: gone });
      })}
      onRestore={(s) => act(s, 'restore', () => {
        const back = { ...s, active: true, removedAt: null };
        swap((d) => ({
          ...d,
          removed: d.removed.filter((o) => o.id !== s.id),
          students: [...d.students, back].sort((a, b) => a.rollNo.localeCompare(b.rollNo)),
        }));
        setNotice({ message: `${s.rollNo} ${s.name} is back on the roster.` });
      })}
      onMarkUnder18={(s, under18) => act(s, 'under18', () => {
        // PATCH { under18 } answers with the student and the server's note.
        swap((d) => ({ ...d, students: d.students.map((o) => (o.id === s.id ? { ...o, under18 } : o)) }));
        setU18Note(U18_NOTE);
        setNotice({ message: under18 ? `${s.rollNo} ${s.name} is marked under 18.` : `${s.rollNo} ${s.name} is no longer marked under 18.` });
      })}
      under18Note={data.under18Note || u18Note}
      onAddStudents={async () => {
        await wait(700);
        if (pasteReply.under18Note) setU18Note(pasteReply.under18Note);
        return pasteReply;
      }}
      onEditClass={async (patch) => {
        await wait(500);
        if (patch.section !== undefined && !patch.section.trim()) throw new Error('section is required: the class\'s section or division, such as "TY-CSF B".');
        setData((d) => ({ ...d, class: { ...d.class, ...patch } }));
      }}
      obs={obs}
      onOpenObs={(s) => {
        setObs({ student: s, data: null, loading: true, error: '' });
        setTimeout(() => setObs({ student: s, data: obsOf(s, s.rollNo === '21CS06' ? OBS_DAYS : []), loading: false, error: '' }), 500);
      }}
      onCloseObs={() => setObs(null)}
      onRetryObs={() => {}}
      analytics={an}
      onLast={(n) => {
        setAn((a) => ({ ...a, last: n, loading: true }));
        setTimeout(() => setAn({ last: n, data: { ...analytics, last: n }, loading: false, error: '' }), 600);
      }}
      onRetryAnalytics={() => {}}
      startPaste={canEdit ? startPaste : undefined}
      firstReading={firstReading}
    />
  );
}

const KAVYA = STUDENTS[5];
const HOD_ROSTER = { ...ROSTER, class: { ...CN, canEdit: false } };
const HOD_ROSTER_U18 = { ...ROSTER_U18, class: { ...CN, canEdit: false } };
const EMPTY_CLASS = { class: { ...CN, id: CLASSES[1].id, courseName: 'Operating Systems', section: 'TY-CSF B', termLabel: 'Sem V 2026', size: 0 }, students: [], removed: [] };

export default [
  {
    id: 'classes-list', title: 'Classes: the list', role: 'professor',
    note: 'Every class, newest first, each with its course, section, term and size.',
    render: () => <LiveList classes={CLASSES} role="professor" />,
  },
  {
    id: 'classes-list-hod', title: 'Classes: the list, read only', role: 'hod',
    note: 'A head of department reads the department’s classes and creates none.',
    render: () => <ClassListView classes={CLASSES.map((c) => ({ ...c, canEdit: false }))} canCreate={false} onReload={() => {}} />,
  },
  {
    id: 'classes-empty', title: 'Classes: none yet', role: 'professor',
    note: 'What a class is for, and the first one made from here.',
    render: () => <LiveList classes={[]} role="professor" />,
  },
  {
    id: 'classes-loading', title: 'Classes: loading', role: 'professor',
    render: () => <ClassListView loading />,
  },
  {
    id: 'class-roster', title: 'Classes: a roster with removed students', role: 'professor',
    note: 'Edit a row from its menu, remove softly and put back. The removed sit apart. Nobody is marked under 18: the same menu marks one.',
    render: () => <LiveClass initial={ROSTER} />,
  },
  {
    id: 'class-roster-under18', title: 'Classes: students marked under 18', role: 'professor',
    note: 'Decision 8. Three marked, one since removed: the mark beside each name, and on a fresh read the server’s under18Note (a lawyer must confirm it).',
    render: () => <LiveClass initial={ROSTER_U18} />,
  },
  {
    id: 'class-roster-under18-note', title: 'Classes: under 18, a read without the note', role: 'professor',
    note: 'Only if a read carried no under18Note: this screen’s own sentence on what the mark does, until a mark is set or cleared and the reply brings the server’s.',
    render: () => <LiveClass initial={ROSTER_U18_BARE} />,
  },
  {
    id: 'class-roster-empty', title: 'Classes: a new class, nobody on it', role: 'professor',
    render: () => <LiveClass initial={EMPTY_CLASS} analytics={NO_ROOMS} />,
  },
  {
    id: 'class-paste-preview', title: 'Classes: pasting, before sending', role: 'professor',
    note: 'A heading line left out, extra columns not sent, contact details hidden.',
    render: () => <LiveClass initial={ROSTER} startPaste={START_PREVIEW} />,
  },
  {
    id: 'class-paste-result', title: 'Classes: what the server did with a paste', role: 'professor',
    note: 'Added, every refused row with its reason, the dropped fields and the note.',
    render: () => <LiveClass initial={ROSTER} startPaste={START_RESULT} />,
  },
  {
    id: 'class-paste-under18', title: 'Classes: pasting with an Under 18 column', role: 'professor',
    note: 'A heading names the column, so its yes or no goes with each line. A cell that is neither is flagged, never shown; the phone column is not sent.',
    render: () => <LiveClass initial={ROSTER} startPaste={{ text: PASTE_U18_TEXT }} pasteReply={PASTE_U18_REPLY} />,
  },
  {
    id: 'class-paste-under18-result', title: 'Classes: a paste that marked a student under 18', role: 'professor',
    note: 'The reply’s under18Note, the student marked in the added list, and the row refused for its mark.',
    render: () => <LiveClass initial={ROSTER} startPaste={{ text: PASTE_U18_TEXT, reply: PASTE_U18_REPLY }} pasteReply={PASTE_U18_REPLY} />,
  },
  {
    id: 'class-import-under18', title: 'Classes: importing a file with an Under 18 column', role: 'professor',
    note: 'The dry run: the column the server read, the rows it would mark, the sentence about a student already on the roster, and the note. Date of birth is named, never read.',
    render: () => <LiveImport start={{ how: 'file', file: IMPORT_FILE, fileText: 'x', stage: 'checked', reply: DRY_U18 }} />,
  },
  {
    id: 'class-import-under18-done', title: 'Classes: the import with an Under 18 column, done', role: 'professor',
    note: 'The rows added, two of them marked under 18, and every row not added with the server’s reason.',
    render: () => <LiveImport start={{ how: 'file', file: IMPORT_FILE, fileText: 'x', stage: 'done', reply: DONE_U18 }} />,
  },
  {
    id: 'class-observations', title: 'Classes: one student’s observations', role: 'professor',
    note: 'Across days, newest first, with what each day’s mark replaced. Staff only.',
    render: () => <LiveClass initial={ROSTER} obsStudent={KAVYA} />,
  },
  {
    id: 'class-rooms', title: 'Classes: across the last 4 rooms', role: 'professor',
    note: 'The trend, the two charts over the rooms (accuracy and took part as lines with their values; answered, present without an answer, absent and not marked as stacked bars with their words), the rooms oldest first, the spread, the three level bands (decision 6) and the hardest questions. Every figure carries the server’s count sentence; each hard question its author, the count behind it, and one level marked uncertain.',
    render: () => <LiveClass initial={ROSTER} view="rooms" />,
  },
  {
    id: 'class-rooms-languages', title: 'Classes: a hard question answered in two languages', role: 'professor',
    note: 'Once a second language exists: the item’s language note, and its translation warning when the gap is over 20 points.',
    render: () => <LiveClass initial={ROSTER} view="rooms" analytics={ANALYTICS_LANGUAGES} />,
  },
  {
    id: 'class-rooms-levels', title: 'Classes: across rooms, six levels', role: 'professor',
    note: 'One press from the bands: the same answers, each level on its own.',
    render: () => <LiveClass initial={ROSTER} view="rooms" firstReading="levels" />,
  },
  {
    id: 'class-rooms-none', title: 'Classes: no rooms yet', role: 'professor',
    render: () => <LiveClass initial={EMPTY_CLASS} view="rooms" analytics={NO_ROOMS} />,
  },
  {
    id: 'class-hod', title: 'Classes: a roster, read only', role: 'hod',
    note: 'canEdit is false: no edit controls, one read-only line.',
    render: () => <LiveClass initial={HOD_ROSTER} />,
  },
  {
    id: 'class-hod-under18', title: 'Classes: under 18, read only', role: 'hod',
    note: 'A head of department sees who is marked and what the mark does, and cannot change it.',
    render: () => <LiveClass initial={HOD_ROSTER_U18} />,
  },
  {
    id: 'class-missing', title: 'Classes: not found', role: 'professor',
    note: 'The server’s one 404 sentence, for a class that is not there or not yours.',
    render: () => <ClassView error="That class was not found." notFound onReload={() => {}} />,
  },
];
