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
  active: true, addedAt: daysAgo(40), removedAt: null,
}));
const REMOVED = [
  { id: hex(0xb001), rollNo: '21CS26', name: 'Ira Bose', active: false, addedAt: daysAgo(40), removedAt: daysAgo(12) },
  { id: hex(0xb002), rollNo: '21CS31', name: 'Zoya Qureshi', active: false, addedAt: daysAgo(40), removedAt: daysAgo(2) },
];
const ROSTER = { class: CN, students: STUDENTS, removed: REMOVED };

const MESSAGE = 'Removed from the roster. Nothing they did is deleted: their answers in every room, their attendance and their records stay, and they can be put back on the roster (PATCH with { "active": true }).';

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

const added = (roll, name, n) => ({ id: hex(0xc000 + n), rollNo: roll, name, active: true, addedAt: daysAgo(0), removedAt: null });
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

const lv = (level, label, answers, correct) => ({ level, label, answers, correct, accuracy: answers ? correct / answers : null });
const band = (id, label, levels, answers, correct) => ({ id, label, levels, answers, correct, accuracy: answers ? correct / answers : null });
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
  accuracy: acc, participation: part, attendance, bands,
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
const item = (n, text, kind, bloom, topic, attempts, correct, flags = []) => ({
  questionId: hex(0xe000 + n), text, kind, bloom, topic, status: 'active', attempts, correct, proportionCorrect: correct / attempts,
  meanScore: null, band: correct / attempts < 0.4 ? 'hard' : 'medium', pointBiserial: flags.length ? -0.31 : 0.22, pointBiserialN: attempts,
  pointBiserialNote: null, flags, versions: 1,
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
  },
  levels: levelsOf(WINDOW),
  levelBands: bandsOf(WINDOW),
  hardest: {
    items: [
      item(1, 'Which protocol is connectionless?', 'mcq', 'remember', 'Transport', 24, 9, [WRONG_KEY]),
      item(2, 'A segment arrives with a bad checksum. What does UDP do with it?', 'mcq', 'understand', 'User Datagram Protocol', 23, 6),
      item(3, 'Put the steps of closing a TCP connection in order.', 'order', 'apply', 'Connection management', 18, 5),
      item(4, 'Which header field lets a receiver say how much more data it can take?', 'blank', 'remember', 'Flow control', 22, 8),
      item(5, 'Why does TCP slow its sending rate after a lost segment?', 'mcq', 'analyse', 'Congestion control', 9, 4),
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
  histogram: { ...ANALYTICS.histogram, buckets: BUCKETS.map((_, i) => ({ from: i * 10, to: i * 10 + 10, students: 0 })), legend: ANALYTICS.histogram.legend.map((l) => ({ ...l, students: 0 })), students: 0, answers: 0, notEnough: 0 },
  levels: levelsOf(Array(12).fill(0)),
  levelBands: bandsOf(Array(12).fill(0)),
  hardest: { items: [], minAttempts: 5, answers: 0, questions: 0, belowFloor: 0 },
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
function LiveClass({ initial, view: firstView = 'roster', analytics = ANALYTICS, startPaste, obsStudent, firstReading }) {
  const [data, setData] = useState(initial);
  const [view, setView] = useState(firstView);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState('');
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
      onAddStudents={async () => { await wait(700); return PASTE_REPLY; }}
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
    note: 'Edit a row from its menu, remove softly and put back. The removed sit apart.',
    render: () => <LiveClass initial={ROSTER} />,
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
    id: 'class-observations', title: 'Classes: one student’s observations', role: 'professor',
    note: 'Across days, newest first, with what each day’s mark replaced. Staff only.',
    render: () => <LiveClass initial={ROSTER} obsStudent={KAVYA} />,
  },
  {
    id: 'class-rooms', title: 'Classes: across the last 4 rooms', role: 'professor',
    note: 'The trend, the rooms oldest first, the spread, the three level bands (decision 6) and the hardest questions.',
    render: () => <LiveClass initial={ROSTER} view="rooms" />,
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
    id: 'class-missing', title: 'Classes: not found', role: 'professor',
    note: 'The server’s one 404 sentence, for a class that is not there or not yours.',
    render: () => <ClassView error="That class was not found." notFound onReload={() => {}} />,
  },
];
