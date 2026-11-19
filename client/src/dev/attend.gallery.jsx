/**
 * The waiting room, attendance and the two halves of a Mixed room, drawn from
 * sample data. Development only.
 *
 * Each component takes its server calls as props (`start`, `load`, `mark`), so
 * these entries hand them stand-ins that keep the server's rules (docs/API.md,
 * "Phase 3: classes, rosters and attendance" and "room modes, the waiting room
 * and the projector"): `unmarked` is not absent, "N / M present" counts
 * present and late, `fromJoins` keeps hand marks and is a 409 in a Teacher-led
 * room, and a room with no class answers 409. Nothing here talks to the server.
 */

import { useState } from 'react';

import AppShell from '../shell/AppShell.jsx';
import Attendance from '../teach/Attendance.jsx';
import FeedSplit from '../teach/FeedSplit.jsx';
import Lobby from '../teach/Lobby.jsx';
import { Note, Panel } from '../ui/index.jsx';

/* ------------------------------------------------------------------ sample */

const CODE = 'R8N4UR';
const TITLE = 'Computer Networks - Unit 4: The Transport Layer (sample)';
const CLASS = { id: 'ec349fd84c312402e637884a', courseName: 'Computer Networks', section: 'TY-CS A', termLabel: 'Odd term 2026' };
const CAVEAT = '"Joined" means a phone joined this room with that roll number. A room has no sign-in, so a typed roll number is not proof of who was holding the phone.';
const PRIVACY = 'Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level.';

const NAMES = [
  'Aarav Shah', 'Aditi Rao', 'Ananya Iyer', 'Arjun Nair', 'Bhavya Joshi', 'Chitra Menon', 'Devansh Kulkarni',
  'Diya Patil', 'Farhan Qureshi', 'Gauri Deshpande', 'Harsh Thakur', 'Ishaan Bose', 'Jahnavi Reddy', 'Kabir Singh',
  'Kavya Pillai', 'Meera Kulkarni', 'Nikhil Jain', 'Nisha Verma', 'Om Gupta', 'Pooja Gaikwad', 'Rohan Das',
  'Sana Sheikh', 'Siddharth Menon', 'Tanvi Bhatt', 'Vihaan Chopra',
];
const id = (i) => `5c${String(i).padStart(2, '0')}a7e3b9d1f4c2a6e8b0d3f5`.slice(0, 24);
const roll = (i) => `21CS${String(i + 1).padStart(2, '0')}`;

/*
 * The roster, as a class room stands mid-lesson: 17 phones joined and were
 * marked present by the join; 21CS04 joined late and was marked late by hand;
 * 21CS09 was marked late by hand before joining; 21CS12 was marked absent by
 * hand and then a phone joined with that roll number; 21CS15 was marked absent;
 * the rest have no mark.
 */
function rosterOf({ teacherLed = false } = {}) {
  return NAMES.map((name, i) => {
    let status = 'unmarked'; let source = null; let joined = false;
    if (teacherLed) {
      if (i < 14) { status = 'present'; source = 'teacher'; }
      if (i === 3 || i === 8) { status = 'late'; source = 'teacher'; }
      if (i === 14) { status = 'absent'; source = 'teacher'; }
    } else {
      if (i < 20 && ![3, 8, 11, 14, 17, 18].includes(i)) { status = 'present'; source = 'joined'; joined = true; }
      if (i === 3) { status = 'late'; source = 'teacher'; joined = true; }
      if (i === 8) { status = 'late'; source = 'teacher'; }
      if (i === 11) { status = 'absent'; source = 'teacher'; joined = true; }
      if (i === 14) { status = 'absent'; source = 'teacher'; }
    }
    return {
      studentId: id(i), rollNo: roll(i), name, status, source,
      markedAt: source ? '2026-11-19T04:12:00.000Z' : null, markedBy: null, joined,
    };
  });
}

const NOT_ON_ROSTER = [
  { rollNo: '21CS31', name: 'rahul', removedFromRoster: false },
  { rollNo: '21CS26', name: 'Yash Pawar', removedFromRoster: true },
];
const REMOVED = [
  {
    studentId: id(26), rollNo: '21CS26', name: 'Yash Pawar', status: 'present', source: 'joined',
    markedAt: '2026-11-19T04:02:00.000Z', markedBy: null, joined: true, removedAt: '2026-11-19T04:20:00.000Z',
  },
];

/** The read, counted the way the server counts it (services/roster.js attendanceReport). */
function report(room, students, notOnRoster, removed) {
  const count = (k) => students.filter((s) => s.status === k).length;
  const counts = {
    present: count('present'), late: count('late'), absent: count('absent'), unmarked: count('unmarked'),
    classSize: students.length, joined: students.filter((s) => s.joined).length, notOnRoster: notOnRoster.length,
  };
  return {
    room, class: CLASS, students, removed, notOnRoster, counts,
    summary: `${counts.present + counts.late} / ${counts.classSize} present`,
    caveat: CAVEAT,
  };
}

/* ------------------------------------------------------ the stand-in server */

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const fail = (message, status) => Object.assign(new Error(message), { status });

function attendanceServer({ mode = 'mixed', noClass = false, readFails = null, never = false, closed = false, empty = false } = {}) {
  const teacherLed = mode === 'teacher-led';
  let students = empty ? [] : rosterOf({ teacherLed });
  const notOnRoster = teacherLed || empty ? [] : NOT_ON_ROSTER;
  const removed = teacherLed || empty ? [] : REMOVED;
  const room = { code: CODE, title: TITLE, startedAt: '2026-11-19T04:00:00.000Z', status: closed ? 'closed' : 'open' };
  const read = () => report(room, students, notOnRoster, removed);
  const noRoster = 'This room was not opened for a class, so it has no roster to take attendance against. Open the room with a classId to take attendance.';

  return {
    load: async () => {
      if (never) return new Promise(() => {});
      await wait(400);
      if (noClass) throw fail(noRoster, 409);
      if (readFails) throw fail(readFails.message, readFails.status);
      return read();
    },
    mark: async (code, body) => {
      await wait(500);
      if (noClass) throw fail(noRoster, 409);
      let changed = 0; let kept = 0;
      if (body.fromJoins === true) {
        if (teacherLed) {
          throw fail('This room is Teacher-led, so no phone joins it: "everyone who joined present, the rest absent" would mark every student not yet marked absent. Mark them by hand with { marks: [{ studentId, status }] }. Nothing was changed.', 409);
        }
        students = students.map((s) => {
          if (s.source === 'teacher') { kept += 1; return s; }
          changed += 1;
          return { ...s, status: s.joined ? 'present' : 'absent', source: 'teacher', markedAt: new Date().toISOString() };
        });
      } else {
        const marks = body.marks ?? [];
        // All or nothing, as the server: one bad row changes nobody.
        if (marks.some((m) => !['present', 'absent', 'late'].includes(m.status) || !students.some((s) => s.studentId === m.studentId))) {
          throw fail('marks: every row needs a studentId on this class roster and a status of present, absent or late. Nothing was changed.', 400);
        }
        const by = new Map(marks.map((m) => [m.studentId, m.status]));
        students = students.map((s) => (by.has(s.studentId)
          ? { ...s, status: by.get(s.studentId), source: 'teacher', markedAt: new Date().toISOString() }
          : s));
        changed = marks.length;
      }
      return { changed, kept, ...read() };
    },
  };
}

/* ---------------------------------------------------------------- the frame */

const NAV = [
  { id: 'content', label: 'Material', icon: 'material', group: 'prepare' },
  { id: 'bank', label: 'Questions', icon: 'bank', group: 'prepare' },
  { id: 'session', label: 'Room', icon: 'room', group: 'prepare' },
  { id: 'live', label: 'Live class', icon: 'live', group: 'teach' },
];

function Frame({ sub, children }) {
  return (
    <AppShell
      crumb={<span className="clip">{TITLE}</span>}
      title="Live class"
      sub={sub}
      nav={NAV}
      current="live"
      onNav={() => {}}
    >
      <div className="stack stack-3">{children}</div>
    </AppShell>
  );
}

/* The grid's `waiting`, as services/modes.js waitingLine() builds it. */
const NO_PHONE = 'No phone has joined this room yet, so there is nobody to start it for. Wait for the class to join with the room code, then start.';
const WAITING = {
  class: { joinedN: 9, present: 12, classSize: 25, summary: '9 / 12 present', canStart: true },
  none: { joinedN: 0, present: 0, classSize: 25, summary: '0 / 0 present', canStart: false, reason: NO_PHONE },
  noClass: { joinedN: 4, present: null, classSize: null, summary: '4 joined', canStart: true },
  teacherLed: { joinedN: 0, present: 3, classSize: 25, summary: '0 / 3 present', canStart: true },
};

function LobbyDemo({ waiting, mode = 'mixed', canControl = true, refuse = null }) {
  const [reply, setReply] = useState(null);
  const [start] = useState(() => async () => {
    await wait(600);
    if (refuse) throw fail(refuse, 409);
    return { session: { code: CODE, status: 'open' }, settings: { mode } };
  });
  return (
    <Frame sub="The waiting room sits at the top of the live view until the room starts.">
      {reply && <Note tone="ok" role="status">onStarted got <span className="mono">{JSON.stringify(reply)}</span>. In the console the lobby now leaves.</Note>}
      <Lobby code={CODE} waiting={waiting} canControl={canControl} mode={mode} start={start} onStarted={setReply} />
    </Frame>
  );
}

function AttendDemo({ mode = 'mixed', canControl = true, ...server }) {
  const [calls] = useState(() => attendanceServer({ mode, ...server }));
  return (
    <Frame sub="Attendance against the room’s class. Staff only: it never reaches a phone or the projector.">
      <Attendance code={CODE} canControl={canControl} mode={mode} summary={null} load={calls.load} mark={calls.mark} />
    </Frame>
  );
}

/* The grid's `feed`, as services/modes.js teacherFeed() builds it. */
const TEACHER = {
  label: 'Teacher records',
  observations: { understood: 6, participated: 9, revision: 3, support: 1, observed: 19 },
  wheel: { picks: 7, answered: 5, pending: 1 },
  tallies: 3,
  activities: 2,
  privacy: PRIVACY,
};
const FEED = {
  mixed: { mode: 'mixed', digital: { label: 'Digital answers', joined: 22, answered: 21, answers: 164 }, teacher: TEACHER },
  teacherLed: { mode: 'teacher-led', teacher: TEACHER },
  fresh: {
    mode: 'mixed',
    digital: { label: 'Digital answers', joined: 1, answered: 0, answers: 0 },
    teacher: { ...TEACHER, observations: { understood: 0, participated: 0, revision: 0, support: 0, observed: 0 }, wheel: { picks: 0, answered: 0, pending: 0 }, tallies: 0, activities: 0 },
  },
};

function FeedDemo({ feed }) {
  return (
    <Frame sub="In a Mixed or Teacher-led room the class view’s brief carries both halves, each under its own label.">
      <Panel aria-label="The class right now">
        <div className="stack stack-3">
          <span className="tag-mint">Class right now</span>
          <p style={{ maxWidth: '60ch', color: 'var(--on-panel-2)' }}>On the forest brief, as the live view places it.</p>
          <FeedSplit feed={feed} />
        </div>
      </Panel>
      <section className="card card-pad stack stack-3">
        <p className="t-meta">The same component on a glass card.</p>
        <FeedSplit feed={feed} />
      </section>
    </Frame>
  );
}

/* ------------------------------------------------------------------ entries */

export default [
  {
    id: 'lobby-class',
    title: 'Lobby: a class room waiting',
    note: '9 phones joined of the 12 students marked present. Start it: the stand-in answers like the server, and onStarted gets the reply.',
    render: () => <LobbyDemo waiting={WAITING.class} />,
  },
  {
    id: 'lobby-nobody',
    title: 'Lobby: nobody has joined',
    note: 'canStart is false, so Start is off with the server’s reason beside it.',
    render: () => <LobbyDemo waiting={WAITING.none} mode="devices" />,
  },
  {
    id: 'lobby-no-class',
    title: 'Lobby: a room with no class',
    note: 'The server’s line is "4 joined": with no class nobody is marked present.',
    render: () => <LobbyDemo waiting={WAITING.noClass} mode="devices" />,
  },
  {
    id: 'lobby-teacher-led',
    title: 'Lobby: Teacher-led',
    note: 'No phone joins, so there is no phone figure, and it can start at once.',
    render: () => <LobbyDemo waiting={WAITING.teacherLed} mode="teacher-led" />,
  },
  {
    id: 'lobby-409',
    title: 'Lobby: the start is refused',
    note: 'Started meanwhile on another screen. Press Start: the 409 is shown as given.',
    render: () => <LobbyDemo waiting={WAITING.class} refuse="That room has already started." />,
  },
  {
    id: 'lobby-read-only',
    title: 'Lobby: read only',
    note: 'A head of department watching a colleague’s room: no Start button.',
    render: () => <LobbyDemo waiting={WAITING.class} canControl={false} />,
  },
  {
    id: 'lobby-reading',
    title: 'Lobby: before the first grid',
    note: 'The waiting line has not arrived yet.',
    render: () => <LobbyDemo waiting={null} />,
  },
  {
    id: 'attend-mixed',
    title: 'Attendance: a Mixed class room',
    note: 'Every state on one roster: joined and marked by the join, late, absent (one of them joined after), and unmarked. Two phones not on the roster and one removed student sit apart. Mark one, several, or everyone who joined.',
    render: () => <AttendDemo />,
  },
  {
    id: 'attend-teacher-led',
    title: 'Attendance: Teacher-led',
    note: 'No phone joins, so there is no joined figure and no "everyone who joined"; every mark is made by hand.',
    render: () => <AttendDemo mode="teacher-led" />,
  },
  {
    id: 'attend-read-only',
    title: 'Attendance: read only',
    note: 'A head of department reading a colleague’s room: the marks, with no way to change them.',
    render: () => <AttendDemo canControl={false} />,
  },
  {
    id: 'attend-closed',
    title: 'Attendance: a closed room',
    note: 'The server still takes marks after the class, so it can be corrected.',
    render: () => <AttendDemo closed />,
  },
  {
    id: 'attend-no-class',
    title: 'Attendance: a room with no class',
    note: 'The server’s 409, as given.',
    render: () => <AttendDemo noClass />,
  },
  {
    id: 'attend-empty-roster',
    title: 'Attendance: an empty roster',
    note: 'A class with nobody on it yet.',
    render: () => <AttendDemo empty />,
  },
  {
    id: 'attend-error',
    title: 'Attendance: the read failed',
    note: 'The sentence as given, with a way to try again.',
    render: () => <AttendDemo readFails={{ status: 404, message: 'That session was not found.' }} />,
  },
  {
    id: 'attend-reading',
    title: 'Attendance: reading',
    note: 'The shape of the screen while the first read is out.',
    render: () => <AttendDemo never />,
  },
  {
    id: 'feed-mixed',
    title: 'Feed: a Mixed room',
    note: 'Digital answers and teacher records, each labelled, never added together, with the privacy sentence.',
    render: () => <FeedDemo feed={FEED.mixed} />,
  },
  {
    id: 'feed-teacher-led',
    title: 'Feed: a Teacher-led room',
    note: 'No digital half: no phone answers in a Teacher-led room.',
    render: () => <FeedDemo feed={FEED.teacherLed} />,
  },
  {
    id: 'feed-fresh',
    title: 'Feed: the first minute',
    note: 'One phone in, nothing answered or recorded yet.',
    render: () => <FeedDemo feed={FEED.fresh} />,
  },
];
