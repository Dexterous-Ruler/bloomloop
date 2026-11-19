/**
 * The marks register and the roster import, drawn from sample data.
 * Development only.
 *
 * Every object has the shape the server returns (docs/API.md,
 * "GET /api/classes/:id/register" and "POST /api/classes/:id/students/import"),
 * and the figures agree with each other: a total is the sum of its cells, the
 * attendance counts are the cells' marks, the import's counts are its rows.
 * Nothing here talks to the server, except the shared ReportWindow, which reads
 * the room list (a made-up class id finds no rooms in it).
 */

import { useRef, useState } from 'react';

import { RegisterView } from '../account/Register.jsx';
import RosterImport from '../account/RosterImport.jsx';
import ReportWindow, { NO_WINDOW } from '../account/ReportWindow.jsx';
import AccountShell from '../shell/AccountShell.jsx';
import { Button } from '../ui/index.jsx';

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const hex = (n) => n.toString(16).padStart(24, '0');
const CLASS = { id: '6fc2802e8bcc25b1479fd944', courseName: 'Computer Networks', section: 'CS-A', termLabel: 'Odd term 2026' };

/* ---------------------------------------------------------------- register */

const ROOMS = [
  { roomId: hex(1), code: 'K7W4BM', title: 'Transport layer services', day: '2026-11-03', startedAt: '2026-11-03T04:30:00.000Z', status: 'closed', weight: 1 },
  { roomId: hex(2), code: 'M4RE79', title: 'User Datagram Protocol', day: '2026-11-10', startedAt: '2026-11-10T04:30:00.000Z', status: 'closed', weight: 1 },
  { roomId: hex(3), code: 'TLX2Q8', title: 'Hands up: TCP handshake (teacher-led)', day: '2026-11-14', startedAt: '2026-11-14T04:30:00.000Z', status: 'closed', weight: 1 },
  { roomId: hex(4), code: 'JDMEE4', title: 'Transmission Control Protocol', day: '2026-11-17', startedAt: '2026-11-17T04:30:00.000Z', status: 'open', weight: 1 },
];

const TYPES = ['digital', 'aiProvisional', 'humanReviewed', 'revote'];
const SOURCES = ['aiGenerated', 'professorWritten', 'offlineTemplate'];
// The formula's evidence. A re-vote after discussion is never in it: no formula counts one.
const COUNTS = { digital: true, aiProvisional: false, humanReviewed: true };
const mk = (o = 0, p = 0) => ({ answers: p, obtained: o, possible: p });
const add = (a, b) => ({ answers: a.answers + b.answers, obtained: Math.round((a.obtained + b.obtained) * 1000) / 1000, possible: a.possible + b.possible });

/**
 * A cell from its parts: { att, joined, d: [obtained, possible], w: provisional,
 * r: reviewed, v: re-votes after discussion, polls, src }. Who wrote the
 * questions, as the server splits it: the digital answers and re-votes come
 * from `src` (AI-generated unless the room served the offline template), the
 * written ones from the professor; a provisional mark is the professor-written
 * source's `notCounted`, a re-vote its own source's.
 */
function cell(code, { att = 'unmarked', joined = false, d, w, r, v, polls = 0, src = 'aiGenerated' } = {}) {
  const marks = {
    digital: { ...mk(...(d ?? [])), counted: true },
    aiProvisional: { ...mk(...(w ?? [])), counted: false },
    humanReviewed: { ...mk(...(r ?? [])), counted: true },
    revote: { ...mk(...(v ?? [])), counted: false },
    ungraded: { answers: polls, counted: false },
  };
  marks.questionSources = Object.fromEntries(SOURCES.map((id) => [id, { ...mk(), notCounted: 0 }]));
  marks.questionSources[src] = { ...mk(...(d ?? [])), notCounted: marks.revote.answers };
  marks.questionSources.professorWritten = { ...add(marks.questionSources.professorWritten, mk(...(r ?? []))), notCounted: marks.aiProvisional.answers };
  return { code, attendance: att, joined, answered: Boolean(d || w || r || v || polls), marks, counted: countedOf(marks) };
}
function countedOf(marks) {
  let c = mk();
  for (const t of TYPES) if (COUNTS[t]) c = add(c, marks[t]);
  return { ...c, share: c.possible > 0 ? Math.floor((c.obtained / c.possible) * 10000) / 10000 : null };
}
function totalOf(cells, roster) {
  const marks = {};
  for (const t of TYPES) marks[t] = { ...cells.reduce((a, x) => add(a, x.marks[t]), mk()), counted: Boolean(COUNTS[t]) };
  marks.ungraded = { answers: cells.reduce((n, x) => n + x.marks.ungraded.answers, 0), counted: false };
  marks.questionSources = Object.fromEntries(SOURCES.map((id) => [id, {
    ...cells.reduce((a, x) => add(a, x.marks.questionSources[id]), mk()),
    notCounted: cells.reduce((n, x) => n + x.marks.questionSources[id].notCounted, 0),
  }]));
  const attendance = roster ? { present: 0, late: 0, absent: 0, unmarked: 0 } : null;
  if (attendance) for (const x of cells) attendance[x.attendance] += 1;
  return { counted: countedOf(marks), marks, attendance };
}
function student(i, rollNo, name, parts, status = 'active', extra = {}) {
  // The newest room served the offline template's questions.
  const cells = ROOMS.map((r, k) => cell(r.code, { ...(k === 3 ? { src: 'offlineTemplate' } : {}), ...parts[k] }));
  if (status === 'not-on-roster') for (const c of cells) c.attendance = null;
  return {
    studentId: status === 'not-on-roster' ? null : hex(0xa000 + i), rollNo, name, status,
    statusLabel: { active: 'On the roster', removed: 'Removed from the roster', 'not-on-roster': 'Not on the roster' }[status],
    ...extra,
    rooms: cells,
    total: totalOf(cells, status !== 'not-on-roster'),
  };
}

const P = (d, more = {}) => ({ att: 'present', joined: true, d, ...more });
const TL = (att) => ({ att }); // Teacher-led: marked by hand, nobody joins
const NOTES = {
  VISIT9: 'VISIT9 is not on the class roster, so its answers in M4RE79 are listed apart and counted in no class figure.',
  '21CS31': '21CS31 is not on the class roster, so its answers in JDMEE4 are listed apart and counted in no class figure. The attendance marks in K7W4BM and M4RE79 were made under it for Diya Kapoor (now 21CS11); answers under it are theirs only in a room whose mark carries it.',
};
const STUDENTS = [
  // JDMEE4 put two questions to the whole class: each first vote is in `d`, each re-vote after discussion in `v`.
  student(1, '21CS01', 'Aarav Shah', [P([7, 10]), P([5, 8]), TL('present'), P([6, 9], { v: [2, 2] })]),
  student(2, '21CS02', 'Aditi Rao', [P([9, 10]), P([6, 8], { w: [1, 2] }), TL('present'), P([7, 9], { r: [0.5, 1], v: [1, 2] })]),
  student(3, '21CS03', 'Ananya Iyer', [P([4, 10]), { att: 'absent' }, TL('absent'), P([5, 9], { v: [2, 2] })]),
  student(4, '21CS04', 'Arjun Patil', [{ att: 'late', joined: true, d: [6, 9] }, P([3, 8]), TL('late'), P([4, 9], { v: [1, 2] })]),
  student(5, '21CS05', 'Ishaan Kulkarni', [P([8, 10]), P([7, 8]), TL('present'), { att: 'present', joined: true }]),
  student(6, '21CS06', 'Kavya Nair', [P([5, 10], { polls: 2 }), P([4, 8], { polls: 1 }), TL('present'), P([6, 9], { w: [2, 3] })]),
  student(7, '21CS07', 'मीरा जोशी', [{ att: 'absent' }, { att: 'absent' }, TL('absent'), { att: 'absent' }]),
  student(8, '21CS08', 'Rohan Deshmukh', [P([6, 10]), { att: 'present', joined: true, polls: 1 }, TL('present'), P([8, 9])]),
  student(9, '21CS09', 'Sneha Joshi Venkataraman-Krishnamurthy', [P([10, 10]), P([8, 8]), TL('present'), {}]),
  student(10, '21CS10', 'Vihaan Mehta', [P([3, 10]), P([2, 8], { r: [1, 1] }), TL('unmarked'), P([4, 9])]),
  // Her roll number was corrected from 21CS31 after two rooms: she stays in one row.
  student(11, '21CS11', 'Diya Kapoor', [P([6, 10]), P([5, 8]), TL('present'), { att: 'absent' }]),
  student(26, '21CS26', 'Ira Bose', [P([5, 10]), { att: 'absent' }, TL('absent'), { att: 'absent' }], 'removed', { removedAt: '2026-11-12T06:10:00.000Z' }),
  // A phone joined under her old roll number after the correction.
  student(0, '21CS31', 'Diya K', [{}, {}, {}, { joined: true, d: [3, 9] }], 'not-on-roster', { note: NOTES['21CS31'] }),
  student(0, 'VISIT9', 'Visitor', [{}, { joined: true, d: [4, 8] }, {}, {}], 'not-on-roster', { note: NOTES.VISIT9 }),
];

const METHODOLOGY = 'No formula has been saved for this class, so this report uses "Example: 60% of marks; levels at 50 / 60 / 70% of students", which ships with BloomLoop as an example to start from, not as an institutional standard. Each cell is the marks a student obtained of the marks possible in one room: every question answered is one mark, scored from 0 to 1 as it was marked (a professor\'s review replaces the machine\'s mark), counting final attempts only (an attempt followed by a retry is left out). Counted: digital answers marked automatically and written answers a professor has reviewed. Written answers given only a provisional machine mark (a keyword match against the rubric, not AI) and not yet reviewed are shown apart and not counted. Polls are counted only as a number. A question the professor put to the whole class counts its first vote as a digital answer; its re-vote after the class discussed it is shown under its own label and never counted. How sure a student said they were never changes a mark. A student who answered nothing in a room has no marks there, not a zero: the attendance mark says whether they were present. A room\'s answers are its students\' by that room\'s attendance marks: an answer given under the roll number a student\'s mark there was made under is theirs, so correcting a roll number on the roster keeps their earlier answers theirs; any other answer is matched to the roster by its roll number as it stands now. Only rooms opened for this class are counted: a room opened without choosing this class is not in this report, whoever answered in it. Course outcomes, thresholds and room weights do not apply here; the attainment report applies them. Teacher records are not marks and are not in this register.';

const REGISTER = {
  class: CLASS,
  window: { from: null, to: null, rooms: null },
  rooms: ROOMS,
  formula: {
    source: 'example', version: 0, savedAt: null, savedBy: null,
    preset: { id: 'example-60-50-60-70', name: 'Example: 60% of marks; levels at 50 / 60 / 70% of students' },
    config: {
      studentThreshold: 0.6, minAnswers: 3,
      levels: [{ level: 1, minShare: 0.5 }, { level: 2, minShare: 0.6 }, { level: 3, minShare: 0.7 }],
      evidence: COUNTS, attempts: 'final', roomWeights: [],
    },
    roomWeights: [],
  },
  methodology: METHODOLOGY,
  evidenceTypes: [
    { id: 'digital', label: 'Digital answers', description: 'Objective answers given on a phone and marked by the server from the stored answer key.' },
    { id: 'aiProvisional', label: 'Provisional machine marks', description: 'Written answers marked by the keyword marker, which matches the rubric\'s words in the answer: a provisional machine mark, not AI and not a professor\'s judgement, until a professor reviews it.' },
    { id: 'humanReviewed', label: 'Reviewed by a professor', description: 'Written answers whose mark a professor confirmed or changed in the review queue.' },
    { id: 'revote', label: 'Re-votes after discussion', description: 'The second vote on a question the professor put to the whole class, given after the class discussed it. Shown, and never counted towards a mark by any formula: it follows the discussion, so it is not the student\'s own work. The first vote on such a question is a digital answer.' },
  ],
  answers: { rows: 318, setAside: 4, chosen: 314 },
  students: STUDENTS,
  rollNotes: [
    { rollNo: '21CS31', rooms: ['JDMEE4'], tiedTo: [{ studentId: hex(0xa000 + 11), rollNo: '21CS11', name: 'Diya Kapoor', rooms: ['K7W4BM', 'M4RE79'] }], note: NOTES['21CS31'] },
    { rollNo: 'VISIT9', rooms: ['M4RE79'], tiedTo: [], note: NOTES.VISIT9 },
  ],
  questionSources: [
    { id: 'aiGenerated', label: 'AI-generated questions', description: 'Questions the language model wrote from the professor\'s own material (question_source "llm"). A professor approved each before any room served it. This says where the question came from, not how the answer was marked.' },
    { id: 'professorWritten', label: 'Professor-written questions', description: 'Questions a professor wrote in the question bank (question_source "teacher", since 19 Nov 2026).' },
    { id: 'offlineTemplate', label: 'Offline-template questions (and professor-written ones from before 19 Nov 2026)', description: 'Questions no model wrote (question_source "fallback"): the offline template\'s, and a professor\'s own written before 19 Nov 2026, which were stored the same way. An answer row cannot tell those two apart, so they were not relabelled.' },
  ],
  definitions: {
    cell: 'counted: the marks the formula counts, obtained of possible, and their share; marks: every evidence type, counted or not, and polls as a number. One question is one mark. answered: whether the student gave any answer in that room; attendance: present, late, absent or unmarked for a roster student, null off the roster; joined: a phone joined with that roll number.',
    absent: 'No marks is not a zero: a student who answered nothing in a room has 0 of 0 there, and the attendance mark says why.',
    order: 'Students in roll-number order: the roster, then removed students with evidence, then roll numbers not on the roster.',
    rooms: 'The rooms opened for this class that the caller may read, opened from `from` to `to` (India\'s days) and among `rooms` when given; oldest first. Only rooms opened for this class are counted: a room opened without choosing it is not, whoever answered in it. Deleted rooms are not counted.',
    rolls: 'A room\'s answers are filed under the roster student whose attendance mark in that room was made under the roll number they were given under (0021), so a corrected roll number keeps them; otherwise under the roll number as the roster holds it now. rollNotes (and `note` on each row off the roster) says, for every roll number not on the roster, that its answers are apart and uncounted, and which roster student any room\'s mark was made under it for.',
    questionSources: 'marks.questionSources splits the same counted marks by who wrote the question: aiGenerated (the language model, from the professor\'s material, approved before use; question_source "llm"), professorWritten ("teacher", a question a professor wrote in the bank since 19 Nov 2026) and offlineTemplate ("fallback": the offline template, and a professor\'s own questions written before then, which were stored the same way and cannot be told apart with certainty). The three add up to the counted types; notCounted is each one\'s answers of a type the formula does not count. It moves no mark.',
  },
  privacy: 'Attainment, marks and every report here are for staff only: never sent to a student\'s phone or the projector, or to any route a student can reach. Students are listed in roll-number order, never ranked by score.',
};

const EMPTY_WINDOW = {
  ...REGISTER,
  window: { from: '2026-11-20', to: null, rooms: null },
  rooms: [],
  answers: { rows: 0, setAside: 0, chosen: 0 },
  students: STUDENTS.filter((s) => s.status === 'active').map((s) => ({ ...s, rooms: [], total: totalOf([], true) })),
  rollNotes: [],
};

/** The class page around a tab, as /classes/:id draws it. */
function Page({ children }) {
  return (
    <AccountShell current="classes" crumb="Classes / CS-A" title={CLASS.courseName} sub="CS-A · Odd term 2026 · 11 students on the roster">
      {children}
    </AccountShell>
  );
}

/** The view with working files and window: the buttons wait a moment and say what they would do. */
function LiveRegister({ data, error, narrowed: startNarrowed = false, splitBy }) {
  const [win, setWin] = useState(startNarrowed ? { ...NO_WINDOW, from: '2026-11-20' } : NO_WINDOW);
  const [files, setFiles] = useState({});
  const narrowed = Boolean(win.from || win.to || win.rooms.length);
  return (
    <Page>
      <RegisterView
        data={data}
        error={error}
        filter={<ReportWindow classId="gallery-class" value={win} onChange={setWin} />}
        narrowed={narrowed}
        onClearWindow={() => setWin(NO_WINDOW)}
        onRetry={() => {}}
        files={files}
        onCsv={async () => { setFiles({ busy: 'csv' }); await wait(600); setFiles({ saved: 'Saved bloomloop-register-computer-networks-cs-a-6fc2802e-2026-11-19.csv.' }); }}
        onPrint={async () => { setFiles({ busy: 'print' }); await wait(600); setFiles({ saved: 'The printable page opened in a new tab. Print it from there.' }); }}
        splitBy={splitBy}
      />
    </Page>
  );
}

/* ------------------------------------------------------------------ import */

const ROSTER_NOW = 25;
const REMOVED_STUDENT = { id: hex(0xb002), rollNo: '21CS26', name: 'Ira Bose', active: false, addedAt: '2026-10-01T05:00:00.000Z', removedAt: '2026-11-12T06:10:00.000Z' };
const DRY = {
  dryRun: true,
  read: { delimiter: 'comma', columns: { roll: 'Roll No.', name: 'Student Name' }, rows: 9, blankLines: 1 },
  wouldAdd: [
    { line: 2, rollNo: '21CS27', name: 'Rao, Chitra' },
    { line: 3, rollNo: '21CS28', name: 'Dev Malhotra' },
    { line: 4, rollNo: '21CS29', name: 'मीरा जोशी' },
    { line: 6, rollNo: '21CS30', name: 'Navya Hegde' },
  ],
  refused: [
    { line: 5, roll: '21CS01', name: 'Aarav Shah', code: 'on-roster', reason: 'roll number 21CS01 is already on this class\'s roster' },
    { line: 7, roll: '21CS26', name: 'Ira Bose', code: 'removed', reason: 'roll number 21CS26 was removed from this class; restore that student instead of adding them again' },
    { line: 8, roll: '21CS28', name: 'Dev M.', code: 'repeated', reason: 'roll number 21CS28 appears more than once in this list' },
    { line: 10, roll: '21CS31', name: 'Ravi 98450 12345', code: 'bad-name', reason: 'the name holds a long number (a phone number or a date of birth?); a roster keeps a roll number and a name only' },
    { line: 11, roll: '', name: 'Kiran Shetty', code: 'no-roll', reason: 'the roll number is missing' },
  ],
  duplicates: {
    inFile: [{ line: 8, rollNo: '21CS28', firstLine: 3 }],
    onRoster: [{ line: 5, rollNo: '21CS01', onRoster: { id: hex(0xa001), rollNo: '21CS01', name: 'Aarav Shah', active: true } }],
  },
  removed: [{ line: 7, rollNo: '21CS26', student: REMOVED_STUDENT }],
  ignoredColumns: ['Phone', 'Email', 'column 5 (no header)'],
  note: 'A roster keeps a roll number and a name only. Not read from the file: Phone, Email, column 5 (no header).',
  restore: 'Removed students are not restored by an import. To bring one back, restore them on the roster (PATCH /api/classes/:id/students/:studentId with { "active": true }).',
  message: 'Nothing was changed: this is what importing the file would do.',
  size: ROSTER_NOW,
  sizeAfter: ROSTER_NOW + 4,
  class: { ...CLASS, size: ROSTER_NOW },
};
const addedOf = (r) => r.wouldAdd.map((s, i) => ({ line: s.line, id: hex(0xc000 + i), rollNo: s.rollNo, name: s.name, active: true, addedAt: '2026-11-19T06:00:00.000Z', removedAt: null }));
const DONE = (() => {
  const { wouldAdd, message, sizeAfter, ...rest } = DRY;
  return { ...rest, dryRun: false, added: addedOf(DRY), size: ROSTER_NOW + 4 };
})();
const FILE = { name: 'cs-a-class-list.csv', size: 1843 };
const TOO_BIG = 'The CSV is larger than 1 MB. A class list is far smaller; split the file.';
const HOD_403 = 'That class belongs to another teacher - you can read it but not change it.';

/** The dialog over the class page, with a server that answers from the samples above. */
function LiveImport({ start }) {
  const [open, setOpen] = useState(true);
  // A ref, not state: the dialog reads the dry run again straight after a put-back.
  const restored = useRef(0);
  const send = async (_id, csv, dryRun) => {
    await wait(700);
    if (start?.refuse) throw Object.assign(new Error(start.refuse), { status: 403 });
    const back = restored.current > 0;
    const base = dryRun ? DRY : DONE;
    if (!back) return base;
    // After a put-back the removed row is on the roster: the server sorts it there.
    return {
      ...base,
      refused: base.refused.map((r) => (r.code === 'removed' ? { ...r, code: 'on-roster', reason: 'roll number 21CS26 is already on this class\'s roster' } : r)),
      duplicates: { ...base.duplicates, onRoster: [...base.duplicates.onRoster, { line: 7, rollNo: '21CS26', onRoster: { ...REMOVED_STUDENT, active: true } }] },
      removed: [],
      size: base.size + 1,
      ...(dryRun ? { sizeAfter: base.sizeAfter + 1 } : {}),
    };
  };
  const restore = async () => { await wait(500); restored.current += 1; };
  return (
    <Page>
      <div className="cluster">
        <Button icon="upload" onClick={() => setOpen(true)}>Import a CSV</Button>
      </div>
      <RosterImport classId={CLASS.id} open={open} onOpenChange={setOpen} onDone={() => {}} send={send} restore={restore} start={start} />
    </Page>
  );
}

export default [
  {
    id: 'register', title: 'Marks register', role: 'professor',
    note: 'Students by four rooms in roll order: present, late, absent and unmarked, no answers, provisional marks not counted, re-votes after discussion never counted, polls, a corrected roll number kept in one row, a removed student and two roll numbers off the roster.',
    render: () => <LiveRegister data={REGISTER} />,
  },
  {
    id: 'register-sources', title: 'Marks register: by who wrote the question', role: 'professor',
    note: 'The same marks, each split by who wrote the question: AI-generated, professor-written, or the offline template (with professor-written ones from before 19 Nov 2026), with provisional marks and re-votes as not counted.',
    render: () => <LiveRegister data={REGISTER} splitBy="source" />,
  },
  {
    id: 'register-hod', title: 'Marks register: read only', role: 'hod',
    note: 'A head of department reads the same register and its files. The register has no writes, so nothing is hidden.',
    render: () => <LiveRegister data={REGISTER} />,
  },
  {
    id: 'register-empty-window', title: 'Marks register: no rooms in the window', role: 'professor',
    note: 'Dates that hold no room of the class: the window says so and offers every room again.',
    render: () => <LiveRegister data={EMPTY_WINDOW} narrowed />,
  },
  {
    id: 'register-no-rooms', title: 'Marks register: no rooms yet', role: 'professor',
    note: 'A class with no room opened for it.',
    render: () => <LiveRegister data={{ ...EMPTY_WINDOW, window: { from: null, to: null, rooms: null } }} />,
  },
  {
    id: 'register-reading', title: 'Marks register: reading', role: 'professor',
    render: () => <LiveRegister data={null} />,
  },
  {
    id: 'register-bad-window', title: 'Marks register: a window the server refuses', role: 'professor',
    render: () => <LiveRegister data={null} error={{ message: 'rooms: NOPE12 is not a room of this class.', status: 400 }} narrowed />,
  },
  {
    id: 'import-choose', title: 'Roster import: choose a file', role: 'professor',
    note: 'A CSV file or pasted text, and what the file needs. Nothing is read from it here.',
    render: () => <LiveImport />,
  },
  {
    id: 'import-chosen', title: 'Roster import: a file chosen', role: 'professor',
    note: 'The file’s name and size only: its text is never shown.',
    render: () => <LiveImport start={{ how: 'file', file: FILE, fileText: 'Roll No.,Student Name\n21CS27,Chitra' }} />,
  },
  {
    id: 'import-dry-run', title: 'Roster import: the dry run', role: 'professor',
    note: 'What the import would do: four to add, a removed student to put back, a roll number already on the roster, one twice in the file, two refused, and three columns not read (names only).',
    render: () => <LiveImport start={{ how: 'file', file: FILE, fileText: 'x', stage: 'checked', reply: DRY }} />,
  },
  {
    id: 'import-done', title: 'Roster import: the result', role: 'professor',
    note: 'The rows added, and every row not added with the server’s reason.',
    render: () => <LiveImport start={{ how: 'file', file: FILE, fileText: 'x', stage: 'done', reply: DONE }} />,
  },
  {
    id: 'import-too-big', title: 'Roster import: a file over 1 MB', role: 'professor',
    note: 'The server’s 413 sentence, as it comes.',
    render: () => <LiveImport start={{ how: 'file', file: { name: 'whole-college.csv', size: 1.4 * 1024 * 1024 }, fileText: 'x', error: TOO_BIG }} />,
  },
  {
    id: 'import-hod', title: 'Roster import: refused for a head of department', role: 'hod',
    note: 'The dry run is a write too: an HOD gets the server’s 403 sentence. (The class page does not offer the import to an HOD.)',
    render: () => <LiveImport start={{ how: 'paste', text: 'Roll No, Name\n21CS27, Chitra Rao', error: HOD_403, refuse: HOD_403 }} />,
  },
];
