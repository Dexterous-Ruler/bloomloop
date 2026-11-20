/**
 * Exam mode on the console (Batch 9, E5 and E7), drawn from sample data.
 * Development only; nothing here talks to the server.
 *
 * The live part of a room in exam mode (teach/ExamRoom.jsx) is handed stand-ins
 * for GET and PATCH /api/session/:code/exam, the screen picture and the
 * collusion check, with replies in the server's shapes (docs/API.md, "Exam
 * mode"). The pictures are drawn here as a sample screen, not taken from
 * anyone's. The setting at the opening is in the room set-up's entries.
 */

import { useState } from 'react';

import { RoomsView } from '../account/Rooms.jsx';
import AppShell from '../shell/AppShell.jsx';
import ExamRoom from '../teach/ExamRoom.jsx';
import { examHelpNow } from '../teach/ExamSettings.jsx';
import { StudentCardView } from '../teach/StudentCard.jsx';

const CODE = 'GA7KRX';
const NOW = Date.now();
const secsAgo = (s) => new Date(NOW - s * 1000).toISOString();
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const fail = (message, status) => Object.assign(new Error(message), { status });

// The server's sentences (services/integrity.js HONESTY, services/examGuard.js).
const HONESTY = 'These are signals, not proof. A browser can see this tab losing focus; it cannot see a second device, '
  + 'another person in the room, or a tool built to stay invisible to the page — and a student who edits the page can '
  + 'suppress the reported ones entirely. Read them as a prompt to look, never as a verdict.';
const PRIVACY = 'Staff only: never shown on a phone or the projector, and screen pictures never go into the archive, the CSV or any report.';
const RULE = 'Listed when two students gave the same wrong answer to at least 3 of the same questions, each pair of answers '
  + 'within 60 seconds of each other. A wrong answer that half or more of the students who got that question wrong also '
  + 'gave (when at least 5 did) is a common misunderstanding and is not counted. Students the class list marks under 18 '
  + 'are left out.';
const NOTE = 'Signals worth a look, not proof. Students who sit together, revise together or share a misunderstanding can '
  + 'give the same wrong answers at the same time. Talk to them before you conclude anything.';
const LENS = 'Page left: possibly Google Lens, a screenshot tool or another app. A notification or a message does the same.';

const KEY = '3f1c9a0b7d2e4f6a8b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a';
const MODE = { on: true, fullscreen: true, screenShare: true, snapshotSeconds: 30, seb: { required: true, configKeyHashes: [KEY] } };
const SUMMARY = { on: true, fullscreen: true, screenShare: true, snapshotSeconds: 30, seb: { required: true, keys: 1, browserKeys: 0 } };

/** A summary in the server's shape, from counts. */
function summary(counts, latest, notes) {
  const events = Object.values(counts).reduce((n, c) => n + c, 0);
  const observed = ['timing_anomaly', 'second_device', 'snapshot_missing'].reduce((n, k) => n + (counts[k] ?? 0), 0);
  return {
    events, away: counts.visibility_hidden ?? 0, awayMs: 0, reported: events - observed, observed, notes,
    level: observed ? 'watch' : events ? 'note' : 'clear', counts, latest,
  };
}

const STUDENTS = [
  {
    rollNo: '23CS01', name: 'Aarav Shah', snapshotAt: secsAgo(12),
    summary: summary(
      { focus_lost: 2, visibility_hidden: 1, copy_attempt: 1 },
      { kind: 'copy_attempt', at: secsAgo(70), src: 'reported' },
      ['Left the page 1 time.', 'The window lost focus 2 times with the page still showing.', LENS, 'Copying was blocked 1 time.'],
    ),
  },
  { rollNo: '23CS02', name: 'Aditi Rao', snapshotAt: secsAgo(26), summary: summary({}, null, []) },
  {
    rollNo: '23CS03', name: 'Ananya Iyer', snapshotAt: null,
    summary: summary(
      { fullscreen_exit: 2, screenshot_attempt: 1 },
      { kind: 'screenshot_attempt', at: secsAgo(140), src: 'reported', method: 'printscreen' },
      ['Left fullscreen 2 times.', 'A screenshot shortcut was pressed 1 time. The page sees the key, not whether a picture was taken.'],
    ),
  },
  {
    rollNo: '23CS04', name: 'Arjun Patil', snapshotAt: secsAgo(200),
    summary: summary(
      { timing_anomaly: 1, snapshot_missing: 1 },
      { kind: 'snapshot_missing', at: secsAgo(95), src: 'observed' },
      ['1 expected screen picture did not arrive. A dropped connection or a laptop going to sleep does the same.', '1 answer arrived faster than the question could be read.'],
    ),
  },
  {
    rollNo: '23CS05', name: 'Ishaan Kulkarni', snapshotAt: null,
    summary: summary({ screenshare_not_started: 1 }, { kind: 'screenshare_not_started', at: secsAgo(600), src: 'reported' }, ['Screen sharing was not started.']),
  },
  { rollNo: '23CS06', name: 'Kavya Nair', snapshotAt: secsAgo(8), summary: summary({}, null, []) },
  {
    rollNo: '23CS07', name: 'Rohan Deshmukh', snapshotAt: secsAgo(19),
    summary: summary(
      { second_device: 1, context_menu: 2 },
      { kind: 'context_menu', at: secsAgo(33), src: 'reported' },
      ['The right-click or long-press menu was blocked 2 times.', 'Joined from a second connection while the first was still live, 1 time.'],
    ),
  },
];

const INFO = { code: CODE, classId: 'ec349fd84c312402e637884a', status: 'open', examMode: SUMMARY, canControl: true };
const NO_CLASS = { ...INFO, classId: null };

const examReply = (examMode, students, status = 'open') => ({
  room: { code: CODE, title: 'Operating Systems - Unit 2: CPU scheduling (sample)', status },
  examMode, help: examHelpNow(), students, honesty: HONESTY, privacy: PRIVACY,
});
const feed = (students, examMode = SUMMARY) => ({ code: CODE, examMode, honesty: HONESTY, privacy: PRIVACY, students, seq: 1 });

/** A sample screen, drawn here: the phone's question page on a laptop, as a shared screen would show it. */
function sampleScreen(roll) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
    <rect width="960" height="600" fill="#F4F3EF"/>
    <rect x="0" y="0" width="960" height="34" fill="#E5E3DD"/>
    <circle cx="20" cy="17" r="6" fill="#C9C6BE"/><circle cx="40" cy="17" r="6" fill="#C9C6BE"/><circle cx="60" cy="17" r="6" fill="#C9C6BE"/>
    <rect x="200" y="9" width="560" height="16" rx="8" fill="#FFFFFF"/>
    <rect x="230" y="70" width="500" height="470" rx="16" fill="#FFFFFF" stroke="#E5E3DD"/>
    <text x="260" y="110" font-family="Arial" font-size="15" fill="#585C63">Question 4 of 12 · Apply</text>
    <text x="260" y="150" font-family="Arial" font-size="20" font-weight="700" fill="#14161A">Work out the turnaround time of P3</text>
    <text x="260" y="176" font-family="Arial" font-size="20" font-weight="700" fill="#14161A">with a quantum of 4 ms.</text>
    <rect x="260" y="210" width="440" height="56" rx="10" fill="#F4F3EF" stroke="#D7D4CC"/>
    <rect x="260" y="280" width="440" height="56" rx="10" fill="#F4F3EF" stroke="#D7D4CC"/>
    <rect x="260" y="350" width="440" height="56" rx="10" fill="#E8F1EC" stroke="#2F6B4F"/>
    <rect x="260" y="470" width="160" height="44" rx="10" fill="#2F6B4F"/>
    <text x="300" y="498" font-family="Arial" font-size="16" fill="#FFFFFF">Submit</text>
    <text x="480" y="320" font-family="Arial" font-size="64" fill="#14161A" fill-opacity="0.06" transform="rotate(-24 480 320)">${roll} · ${CODE}</text>
  </svg>`;
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}

const reader = (reply) => async () => { await wait(300); return reply; };
const saver = (refuse) => async (code, examMode) => {
  await wait(500);
  if (refuse) throw fail(refuse.message, refuse.status);
  return { room: { code, status: 'open' }, examMode: examMode.on ? examMode : { ...MODE, on: false, fullscreen: false, screenShare: false, snapshotSeconds: 0, seb: { required: false, configKeyHashes: [] } }, help: examHelpNow() };
};
const picture = async (code, roll) => {
  await wait(350);
  const s = STUDENTS.find((x) => x.rollNo === roll);
  if (!s?.snapshotAt) throw fail('There is no screen picture for that student.', 404);
  return { url: sampleScreen(roll), at: s.snapshotAt };
};
const purged = async () => { await wait(350); throw fail('There is no screen picture for that student.', 404); };
const collusion = async () => {
  await wait(500);
  return {
    room: { code: CODE, status: 'open' },
    rule: { minMatches: 3, closeSeconds: 60, commonShare: 0.5, commonFloor: 5, sentence: RULE },
    pairs: [
      {
        students: [{ rollNo: '23CS01', name: 'Aarav Shah' }, { rollNo: '23CS04', name: 'Arjun Patil' }],
        matches: 3,
        sameWrong: 4,
        questions: [
          { questionId: 'q1', topic: 'Round robin', bloom: 'apply', gapSeconds: 8 },
          { questionId: 'q2', topic: 'Round robin', bloom: 'understand', gapSeconds: 21 },
          { questionId: 'q3', topic: 'Priority and starvation', bloom: 'analyse', gapSeconds: 46 },
        ],
      },
    ],
    note: NOTE,
    privacy: PRIVACY,
  };
};

const NAV = [
  { id: 'session', label: 'Room', icon: 'room', group: 'prepare' },
  { id: 'live', label: 'Live class', icon: 'live', group: 'teach' },
];

function Frame({ children, sub = 'The exam part of the live room. Staff only.' }) {
  return (
    <AppShell crumb={<span className="mono">{CODE}</span>} title="Exam mode" sub={sub} nav={NAV} current="live" onNav={() => {}}>
      {children}
    </AppShell>
  );
}

function Live({ info = INFO, reply = examReply(MODE, STUDENTS), students = STUDENTS, examMode = SUMMARY, refuse = null, ...rest }) {
  const [card, setCard] = useState('');
  const [read] = useState(() => reader(reply));
  const [save] = useState(() => saver(refuse));
  const [integrity] = useState(() => (reply.examMode.on ? feed(students, examMode) : null));
  return (
    <Frame>
      <ExamRoom
        code={CODE}
        info={info}
        integrity={integrity}
        read={read}
        save={save}
        snapshot={picture}
        collusion={collusion}
        onOpenStudent={setCard}
        {...rest}
      />
      {card && <StudentCardView card={cardOf(card)} roll={card} onClose={() => setCard('')} loadSnapshot={() => picture(CODE, card)} />}
    </Frame>
  );
}

/* ---------------------------------------------------------- the card */

const LEVELS6 = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'];
function cardOf(roll, { integrity, exam } = {}) {
  const s = STUDENTS.find((x) => x.rollNo === roll) ?? STUDENTS[0];
  return {
    room: { code: CODE, status: 'open', mode: 'devices', classId: INFO.classId },
    student: { rollNo: s.rollNo, name: s.name, display: s.name, onRoster: true, joined: true, attendance: 'present' },
    band: { id: null, label: null, reason: 'Not enough graded answers for a band yet.', provisional: true },
    serving: null,
    levels: LEVELS6.map((l) => ({ level: l, label: l[0].toUpperCase() + l.slice(1), answers: 0, correct: 0, accuracy: null, withdrawn: 0, class: { answers: 0, correct: 0, accuracy: null } })),
    lastAnswers: { items: [], limit: 10, final: true },
    nextSet: null,
    records: { day: '2026-11-20', observation: { current: null, history: [] }, picks: [], privacy: 'Teacher records are for staff only.' },
    integrity: integrity === undefined ? s.summary : integrity,
    integrityNote: HONESTY,
    ...(exam === false ? {} : { exam: { snapshotAt: s.snapshotAt } }),
    privacy: PRIVACY,
  };
}

/* ---------------------------------------------------------- the rooms list */

const ROOM = (code, title, more = {}) => ({
  code, title, status: 'open', startedAt: secsAgo(1500), closedAt: null, pausedAt: null,
  settings: { masteryGoal: 0.8, reattempts: 0, redemption: false, mode: 'devices' },
  classId: INFO.classId, class: { courseName: 'Operating Systems', section: 'SY-CS A', termLabel: 'Odd term 2026' },
  joined: 58, online: 55, answered: 412, accuracy: 0.64, banded: 0, canControl: true, questionIds: null, ...more,
});

function Rooms() {
  return (
    <RoomsView
      loading={false}
      error=""
      locked={false}
      rooms={[
        ROOM(CODE, 'Unit 2 test: CPU scheduling', { examMode: SUMMARY }),
        ROOM('K7Q42M', 'Unit 1 test: processes', { status: 'closed', closedAt: secsAgo(300), online: 0, examMode: { on: true, fullscreen: false, screenShare: false, snapshotSeconds: 0, seb: { required: false, keys: 0, browserKeys: 0 } } }),
        ROOM('P3XN8D', 'Round robin practice', { examMode: { on: false } }),
      ]}
      reading={false}
      onReload={() => {}}
      busy={null}
      actionError=""
      notice=""
      warning="K7Q42M is closed. This room's record is 3.72 MB, close to or over the 4 MB a deleted room can be kept in. If it is over, the room cannot be deleted: keep it closed, and export the results as CSV if you need a copy."
      onDismiss={() => {}}
      onPause={() => {}}
      onResume={() => {}}
      onClose={async () => true}
      onDelete={async () => true}
    />
  );
}

/* ---------------------------------------------------------------- entries */

export default [
  {
    id: 'exam-live',
    title: 'Exam mode: a running exam room',
    note: 'Seven students in roll order with counts, the latest signal and the server’s notes; Aarav’s newest screen picture open beside them. Press a picture time to see another, a roll number for the card, Change exam mode for the setting, Check now for matching wrong answers.',
    role: 'professor',
    render: () => <Live initialPick="23CS01" />,
  },
  {
    id: 'exam-live-404',
    title: 'Exam mode: a picture that is no longer there',
    note: 'The server answers 404 with its sentence (purged, or the student is now marked under 18).',
    role: 'professor',
    render: () => <Live initialPick="23CS02" snapshot={purged} />,
  },
  {
    id: 'exam-live-off',
    title: 'Exam mode: off, in a room for a class',
    note: 'The owner can turn it on while the room runs: the dialog has every control and its help, and says what a phone already in the room does first.',
    role: 'professor',
    render: () => <Live reply={examReply({ ...MODE, on: false }, null)} info={{ ...INFO, examMode: { on: false } }} />,
  },
  {
    id: 'exam-live-no-class',
    title: 'Exam mode: on, in a room with no class',
    note: 'Copy guard and signals only. Change exam mode: fullscreen, screen sharing and pictures are off with the reason.',
    role: 'professor',
    render: () => (
      <Live
        info={NO_CLASS}
        reply={examReply({ on: true, fullscreen: false, screenShare: false, snapshotSeconds: 0, seb: { required: false, configKeyHashes: [] } }, STUDENTS.slice(0, 4).map((s) => ({ ...s, snapshotAt: null })))}
        students={STUDENTS.slice(0, 4).map((s) => ({ ...s, snapshotAt: null }))}
        examMode={{ on: true, fullscreen: false, screenShare: false, snapshotSeconds: 0, seb: { required: false, keys: 0, browserKeys: 0 } }}
      />
    ),
  },
  {
    id: 'exam-live-hod',
    title: 'Exam mode: read only, as an HOD',
    note: 'Every signal and picture can be read; nothing can be changed.',
    role: 'hod',
    render: () => <Live canControl={false} initialPick="23CS06" />,
  },
  {
    id: 'exam-live-refused',
    title: 'Exam mode: the server refuses the change',
    note: 'Press Change exam mode, then Save the change: the stand-in answers 409 for a room closed meanwhile, and its sentence is shown as given.',
    role: 'professor',
    render: () => <Live refuse={{ status: 409, message: 'That room is closed, so its exam mode can no longer change.' }} />,
  },
  {
    id: 'exam-live-empty',
    title: 'Exam mode: nobody has joined yet',
    role: 'professor',
    render: () => <Live reply={examReply(MODE, [])} students={[]} />,
  },
  {
    id: 'exam-card',
    title: 'Exam mode: one student’s card',
    note: 'Their signals with the honesty note, and the newest screen picture on request.',
    role: 'professor',
    render: () => <Frame><StudentCardView card={cardOf('23CS07')} roll="23CS07" onClose={() => {}} loadSnapshot={() => picture(CODE, '23CS07')} /></Frame>,
  },
  {
    id: 'exam-card-none',
    title: 'Exam mode: a card with no signals shown',
    note: 'integrity is null: none are shown for this student.',
    role: 'professor',
    render: () => <Frame><StudentCardView card={cardOf('23CS02', { integrity: null })} roll="23CS02" onClose={() => {}} /></Frame>,
  },
  {
    id: 'exam-rooms',
    title: 'Exam mode: the rooms list',
    note: 'An exam room says so in its row (counts only, never a key), and closing a room near the archive’s ceiling says so.',
    role: 'professor',
    render: () => <Rooms />,
  },
];
