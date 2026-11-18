/**
 * Department, Overview and Rooms, drawn from sample data. Development only.
 *
 * Every object here has the shape the server returns - GET /api/dashboard for
 * an HOD and for a professor, GET /api/analytics/:id for one professor and one
 * student, GET /api/session for the room list, POST /api/auth/invite and the
 * Classroom routes for the invite dialog - so what is drawn is what the real
 * screens draw. Nothing in this file talks to the server: the callbacks wait a
 * moment and change local state, which is enough to see every in-flight state
 * and to press the destructive buttons without destroying anything.
 */

import { useCallback, useRef, useState } from 'react';

import { DepartmentView } from '../account/Department.jsx';
import { OverviewView } from '../account/Overview.jsx';
import { RoomsView } from '../account/Rooms.jsx';
import { LEVELS } from '../lib/bloom.js';

/* ------------------------------------------------------------------ helpers */

const NOW = Date.now();
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const daysAgo = (d, hours = 0) => new Date(NOW - d * 86400000 - hours * 3600000).toISOString();
const inDays = (d) => new Date(NOW + d * 86400000).toISOString();
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The same sample on every reload: a seeded generator, not Math.random. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The server's own alphabets: no I, L, O or U in an account or invite code, and
// no O, 0, I, 1 or L in a room code.
const ACCOUNT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const draw = (r, alphabet, n) => Array.from({ length: n }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
const uuid = (r) => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(r() * 16).toString(16));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A per-level report, as services/dashboard.js and analytics.js build it. */
const report = (seen, acc) => LEVELS.map((level, i) => {
  const correct = Math.round(seen[i] * acc[i]);
  return { level, seen: seen[i], correct, accuracy: seen[i] ? correct / seen[i] : null };
});

/** Best and weakest level, skipping anything with fewer than three answers. */
function extremes(bloom) {
  const solid = bloom.filter((b) => b.seen >= 3 && b.accuracy !== null);
  if (!solid.length) return { best: null, weakest: null, confident: false };
  const sorted = [...solid].sort((a, b) => b.accuracy - a.accuracy);
  return { best: sorted[0], weakest: sorted[sorted.length - 1], confident: solid.length >= 2 };
}

const CHAPTERS = [
  'Unit III: Transport layer', 'Process scheduling', 'Normalisation and keys', 'Graphs and shortest paths',
  'Regular languages and automata', 'Memory management', 'SQL joins and subqueries', 'Deadlocks',
  'Trees and heaps', 'Software testing strategies', 'Routing algorithms', 'Network security basics',
];

const gen = seeded(20261118);

/* --------------------------------------------------------------- department */

const DEPARTMENT = 'Computer Science and Engineering';

//   name, email, rooms, students, chapters, questions, accuracy, last room (days ago), active
const STAFF = [
  ['Dr. Kavita Nair', 'kavita.nair@example.edu', 14, 62, 4, 286, 0.68, 0, true],
  ['Prof. Rohan Deshpande', 'rohan.deshpande@example.edu', 11, 58, 3, 241, 0.63, 1, true],
  ['Dr. Sana Qureshi', 'sana.qureshi@example.edu', 9, 54, 3, 214, 0.71, 2, true],
  ['Prof. Vikram Joshi', 'vikram.joshi@example.edu', 8, 49, 3, 198, 0.55, 4, true],
  ['Dr. Ananya Iyer', 'ananya.iyer@example.edu', 6, 51, 2, 162, 0.61, 6, true],
  ['Prof. Imran Shaikh', 'imran.shaikh@example.edu', 5, 47, 2, 148, 0.47, 9, true],
  ['Prof. Nikhil Sawant', 'nikhil.sawant@example.edu', 4, 44, 2, 127, 0.58, 41, false],
  ['Dr. Farah Mistry', 'farah.mistry@example.edu', 0, 47, 2, 110, null, null, true],
];

const PROFESSORS = STAFF.map(([fullName, email, sessions, students, contents, questions, accuracy, last, active]) => ({
  id: uuid(gen),
  code: `BL-${draw(gen, ACCOUNT_ALPHABET, 6)}`,
  fullName,
  email,
  active,
  students,
  contents,
  questions,
  sessions,
  lastSessionAt: last == null ? null : last === 0 ? minsAgo(26) : daysAgo(last, 3),
  accuracy,
}));

/** Every room one professor ran, newest first. */
function roomsOf(p, index) {
  const r = seeded(700 + index);
  return Array.from({ length: p.sessions }, (_, i) => {
    const first = i === 0;
    const live = first && index === 0;
    const startedAt = first ? p.lastSessionAt : daysAgo(i * 5 + index + 2, Math.floor(r() * 6));
    const joined = Math.round(p.students * (0.55 + r() * 0.4));
    return {
      code: draw(r, ROOM_ALPHABET, 6),
      title: CHAPTERS[(index * 3 + i) % CHAPTERS.length],
      status: live ? 'open' : 'closed',
      ownerId: p.id,
      startedAt,
      closedAt: live ? null : new Date(new Date(startedAt).getTime() + 50 * 60000).toISOString(),
      joined,
      banded: Math.round(joined * clamp(0.62 - p.accuracy + r() * 0.1, 0, 0.4)),
      accuracy: clamp(p.accuracy + (r() - 0.5) * 0.16, 0.2, 0.95),
    };
  });
}

const STAFF_ROOMS = PROFESSORS.map(roomsOf);

const HOD = {
  role: 'hod',
  department: DEPARTMENT,
  counts: { professors: 8, students: 412, contents: 21, questions: 1486, sessions: 57, answered: 18240, banded: 96, accuracy: 0.612 },
  professors: PROFESSORS,
  bloom: report([4380, 4120, 3890, 2760, 1840, 1250], [0.79, 0.72, 0.62, 0.51, 0.44, 0.38]),
  // Newest first, and short: the department's last twelve.
  recentSessions: STAFF_ROOMS.flat()
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, 12),
};

const HOD_EMPTY = {
  role: 'hod',
  department: DEPARTMENT,
  counts: { professors: 0, students: 0, contents: 0, questions: 0, sessions: 0, answered: 0, banded: 0, accuracy: null },
  professors: [],
  bloom: report([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]),
  recentSessions: [],
};

/** GET /api/analytics/:id for one professor. */
function professorDetail(p, index) {
  const r = seeded(900 + index);
  const scale = p.sessions / 57;
  const tilt = (p.accuracy ?? 0.6) - 0.612;
  const bloom = report(
    [4380, 4120, 3890, 2760, 1840, 1250].map((n) => Math.round(n * scale * (0.85 + r() * 0.3))),
    [0.79, 0.72, 0.62, 0.51, 0.44, 0.38].map((a) => clamp(a + tilt + (r() - 0.5) * 0.08, 0.05, 0.97)),
  );
  const answered = bloom.reduce((n, b) => n + b.seen, 0);
  const seats = Math.round(p.students * 0.9);
  return {
    kind: 'professor',
    subject: { id: p.id, name: p.fullName, code: p.code, active: p.active },
    counts: { sessions: p.sessions, students: p.sessions ? seats : 0, answered, accuracy: p.accuracy },
    bloom,
    ...extremes(bloom),
    topics: p.sessions ? [
      { topic: 'Flow control', seen: 212, correct: 151, accuracy: 151 / 212 },
      { topic: 'Congestion windows', seen: 188, correct: 103, accuracy: 103 / 188 },
      { topic: 'Three-way handshake', seen: 164, correct: 131, accuracy: 131 / 164 },
    ] : [],
    // Oldest first, as the service sorts it.
    timeline: [...STAFF_ROOMS[index]].reverse().map(({ code, title, status, startedAt, joined, banded, accuracy }) => ({
      code, title, status, startedAt, joined, banded, accuracy,
    })),
    students: p.sessions ? [
      { rollNo: '23CS014', name: 'Kavya Iyer', sessions: 6, answered: 84, correct: 71, lastLevel: 'evaluate', accuracy: 71 / 84 },
      { rollNo: '23CS021', name: 'Pranav Gaikwad', sessions: 5, answered: 70, correct: 44, lastLevel: 'apply', accuracy: 44 / 70 },
      { rollNo: '23CS009', name: 'Esha Gokhale', sessions: 6, answered: 79, correct: 30, lastLevel: 'understand', accuracy: 30 / 79 },
    ] : [],
  };
}

const STAFF_DETAIL = Object.fromEntries(PROFESSORS.map((p, i) => [p.id, professorDetail(p, i)]));

// POST /api/auth/invite answers { code, role, expiresAt }; the screen stamps who it was for.
const PENDING = [
  { code: draw(gen, ACCOUNT_ALPHABET, 8), role: 'professor', expiresAt: inDays(14), forName: 'Dr. Leena Bhatt', forEmail: 'leena.bhatt@example.edu' },
  { code: draw(gen, ACCOUNT_ALPHABET, 8), role: 'professor', expiresAt: inDays(11), forName: '', forEmail: 'omkar.kelkar@example.edu' },
  { code: draw(gen, ACCOUNT_ALPHABET, 8), role: 'professor', expiresAt: inDays(6), forName: '', forEmail: '' },
];

/** Hands back whatever `lookup` holds for an id, after a pause long enough to see the skeleton. */
function useDetails(lookup) {
  const [details, setDetails] = useState({});
  const asked = useRef(new Set());
  const inspect = useCallback((id, force = false) => {
    if (asked.current.has(id) && !force) return;
    asked.current.add(id);
    setDetails((all) => ({ ...all, [id]: { loading: true } }));
    setTimeout(() => setDetails((all) => ({ ...all, [id]: { data: lookup[id] } })), 500);
  }, [lookup]);
  const reset = useCallback(() => { asked.current = new Set(); setDetails({}); }, []);
  return [details, inspect, reset];
}

function DepartmentDemo({ data, pending = [] }) {
  const [invites, setInvites] = useState(pending);
  const [refreshing, setRefreshing] = useState(false);
  const [details, inspect, reset] = useDetails(STAFF_DETAIL);
  const codes = useRef(seeded(41));

  return (
    <DepartmentView
      loading={false}
      error=""
      data={data}
      refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await wait(700); reset(); setRefreshing(false); }}
      invites={invites}
      onInvite={async ({ fullName, email }) => {
        await wait(700);
        const made = {
          code: draw(codes.current, ACCOUNT_ALPHABET, 8), role: 'professor', expiresAt: inDays(14),
          forName: String(fullName ?? '').trim(), forEmail: String(email ?? '').trim(),
        };
        setInvites((list) => [made, ...list]);
        return made;
      }}
      details={details}
      onInspect={inspect}
    />
  );
}

/* ----------------------------------------------------------------- overview */

const ME = uuid(gen);

//   title, kind, topics, questions, rooms run, loaded (days ago)
const MY_CHAPTERS = [
  ['Memory management', 'pptx', 10, 52, 0, 2],
  ['File systems and inodes', 'syllabus', 6, 0, 0, 3],
  ['Unit III: Transport layer', 'pptx', 12, 72, 3, 9],
  ['Deadlocks', 'pptx', 7, 42, 2, 16],
  ['Process scheduling', 'pptx', 9, 54, 2, 24],
  ['Normalisation and keys', 'syllabus', 8, 48, 2, 38],
].map(([title, kind, topics, questions, sessions, loaded]) => ({
  id: uuid(gen), title, kind, topics, questions, ownerId: ME, createdAt: daysAgo(loaded, 2), sessions,
}));

//   title, status, started, joined, banded, accuracy
const MY_ROOMS = [
  ['Unit III: Transport layer', 'open', minsAgo(18), 27, 2, 0.66],
  ['Deadlocks', 'paused', minsAgo(190), 24, 3, 0.58],
  ['Unit III: Transport layer', 'closed', daysAgo(2, 4), 29, 1, 0.71],
  ['Process scheduling', 'closed', daysAgo(6, 2), 28, 2, 0.64],
  ['Normalisation and keys', 'closed', daysAgo(9, 5), 26, 4, 0.52],
  ['Deadlocks', 'closed', daysAgo(13, 1), 30, 1, 0.69],
  ['Unit III: Transport layer', 'closed', daysAgo(16, 3), 25, 2, 0.61],
  ['Process scheduling', 'closed', daysAgo(22, 6), 27, 1, 0.67],
  ['Normalisation and keys', 'closed', daysAgo(30, 2), 27, 1, 0.7],
].map(([title, status, startedAt, joined, banded, accuracy]) => ({
  code: draw(gen, ROOM_ALPHABET, 6),
  title,
  status,
  ownerId: ME,
  startedAt,
  closedAt: status === 'closed' ? new Date(new Date(startedAt).getTime() + 48 * 60000).toISOString() : null,
  joined,
  banded,
  accuracy,
}));

const CLASS = [
  'Aarav Kulkarni', 'Aditi Joshi', 'Akash Patil', 'Ananya Deshmukh', 'Arnav Shinde', 'Bhavya Mehta',
  'Chaitanya Pawar', 'Diya Nair', 'Esha Gokhale', 'Farhan Sayyed', 'Gauri Bhosale', 'Harsh Wagh', 'Ishaan Kale',
  'Janhavi More', 'Kabir Chavan', 'Kavya Iyer', 'Lakshya Jadhav', 'Manasi Kadam', 'Neel Sawant', 'Ojas Thakur',
  'Pranav Gaikwad', "Rhea D'Souza", 'Rohit Salunkhe', 'Saanvi Rane', 'Sahil Mulla', 'Shruti Phadke', 'Tanmay Bapat',
  'Urvi Shah', 'Vedant Mahajan', 'Yash Dhumal', 'Zoya Khan',
];

// The roll number is nullable and sometimes blank on the server, so both appear.
const NO_ROLL = { 5: null, 13: '', 22: null, 28: null };

const ROSTER = CLASS.map((fullName, i) => ({
  id: uuid(gen),
  code: `BL-${draw(gen, ACCOUNT_ALPHABET, 6)}`,
  fullName,
  rollNo: i in NO_ROLL ? NO_ROLL[i] : `23CS${String(i + 1).padStart(3, '0')}`,
  active: i !== 17,
}));

const PROFESSOR = {
  role: 'professor',
  department: DEPARTMENT,
  counts: { students: ROSTER.length, contents: MY_CHAPTERS.length, questions: 268, sessions: MY_ROOMS.length, attendances: 243, answered: 5120, banded: 17, accuracy: 0.64 },
  contents: MY_CHAPTERS,
  roster: ROSTER,
  bloom: report([1310, 1180, 1040, 760, 510, 320], [0.81, 0.74, 0.63, 0.52, 0.41, 0.36]),
  recentSessions: MY_ROOMS,
};

const PROFESSOR_EMPTY = {
  role: 'professor',
  department: DEPARTMENT,
  counts: { students: 0, contents: 0, questions: 0, sessions: 0, attendances: 0, answered: 0, banded: 0, accuracy: null },
  contents: [],
  roster: [],
  bloom: report([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]),
  recentSessions: [],
};

/** GET /api/analytics/:id for one student. */
function studentDetail(s, index) {
  const r = seeded(1200 + index);
  const subject = { id: s.id, name: s.fullName, code: s.code, rollNo: String(s.rollNo ?? '').trim() || null };
  const empty = report([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]);

  if (!subject.rollNo) {
    return {
      kind: 'student', subject, counts: { sessions: 0, answered: 0, correct: 0, accuracy: null }, bloom: empty,
      best: null, weakest: null, confident: false, topics: [], timeline: [],
      reason: 'No roll number on this account, and a live session identifies a student by the number they type on their phone - so there is nothing to match their results against yet.',
    };
  }
  // One student who holds an account and has not sat a room yet.
  if (index === 30) {
    return {
      kind: 'student', subject, counts: { sessions: 0, answered: 0, correct: 0, accuracy: null }, bloom: empty,
      best: null, weakest: null, confident: false, topics: [], timeline: [], currentLevel: null,
    };
  }

  const ability = 0.3 + r() * 0.55;
  const reached = clamp(Math.round(ability * 6 - 0.6 + r()), 0, 5);
  const sat = 2 + Math.floor(r() * 6);
  const seen = LEVELS.map((_, l) => (l <= reached ? 5 + Math.floor(r() * 14) : l === reached + 1 ? 1 + Math.floor(r() * 4) : 0));
  const acc = LEVELS.map((_, l) => clamp(ability + 0.32 - l * 0.1 + (r() - 0.5) * 0.12, 0.05, 1));
  const bloom = report(seen, acc);
  const answered = bloom.reduce((n, b) => n + b.seen, 0);
  const correct = bloom.reduce((n, b) => n + b.correct, 0);

  const rooms = MY_ROOMS.filter((m) => m.status === 'closed').slice(0, sat).reverse();
  const timeline = rooms.map((m, i) => {
    const a = Math.max(4, Math.round(answered / rooms.length + (r() - 0.5) * 4));
    const c = Math.round(a * clamp(correct / answered + (r() - 0.5) * 0.2, 0, 1));
    const level = LEVELS[clamp(reached - (rooms.length - 1 - i > 2 ? 1 : 0), 0, 5)];
    return { code: m.code, title: m.title, startedAt: m.startedAt, answered: a, correct: c, accuracy: c / a, workingLevel: level, banded: c / a < 0.4 };
  });

  return {
    kind: 'student',
    subject,
    counts: { sessions: timeline.length, answered, correct, accuracy: timeline.reduce((n, t) => n + t.accuracy, 0) / timeline.length },
    bloom,
    ...extremes(bloom),
    topics: [
      { topic: 'Flow control', seen: 9, correct: 7, accuracy: 7 / 9 },
      { topic: 'Banker’s algorithm', seen: 7, correct: 3, accuracy: 3 / 7 },
    ],
    timeline,
    currentLevel: LEVELS[reached],
  };
}

const CLASS_DETAIL = Object.fromEntries(ROSTER.map((s, i) => [s.id, studentDetail(s, i)]));

// GET /api/classroom/course/:id/students. Two already hold an account.
const GOOGLE_ROSTER = [
  ['Aarohi Bendre', '23cs041@example.edu', false], ['Dhruv Kotwal', '23cs042@example.edu', false],
  ['Ira Sabnis', 'ira.sabnis@example.edu', false], ['Kunal Tambe', '23cs044@example.edu', false],
  ['Kavya Iyer', '23cs016@example.edu', true], ['Mihir Apte', '23cs046@example.edu', false],
  ['Nandini Rao', '', false], ['Parth Ghorpade', '23cs048@example.edu', false],
  ['Pranav Gaikwad', '23cs021@example.edu', true], ['Sneha Lokhande', 's.lokhande@example.edu', false],
  ['Tejas Kamble', '23cs051@example.edu', false], ['Vaidehi Joglekar', '23cs052@example.edu', false],
].map(([name, email, linked], i) => ({ userId: `1178403265419${String(i + 10)}`, name, email, linked }));

/** The five calls the invite dialog makes, answered from this file. */
function fakeServices({ classroom = 'connected' } = {}) {
  const codes = seeded(77);
  return {
    invite: async (body) => {
      await wait(450);
      // One refusal, in the server's words, so the batch result shows both outcomes.
      if (body.googleSub === GOOGLE_ROSTER[7].userId) {
        throw new Error('That Google Classroom student already has a BloomLoop account, so this invite could never be redeemed. They are already on your roster.');
      }
      return { invite: { code: draw(codes, ACCOUNT_ALPHABET, 8), role: body.role, expiresAt: inDays(14) } };
    },
    classroomStatus: async () => {
      await wait(400);
      if (classroom === 'off') {
        return {
          configured: false,
          connected: false,
          reason: 'Google Classroom is not configured - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are unset. The CSV export is the configured hand-off path and needs nothing from Google.',
        };
      }
      return { configured: true, connected: true, reason: 'Connected. Grades can be pushed to a course.' };
    },
    classroomAuthUrl: async () => { await wait(300); throw new Error('The gallery does not open Google.'); },
    classroomCourses: async () => {
      await wait(500);
      return { courses: [{ id: '681204417532', name: 'TY-CSF Computer Networks, Div A' }, { id: '681204417533', name: 'TY-CSF Operating Systems, Div A' }] };
    },
    classroomCourseStudents: async (courseId) => { await wait(600); return { courseId, students: GOOGLE_ROSTER }; },
    // The supports list is the server's own (server/src/accommodations.js);
    // two of the seven here are enough to see the panel.
    studentAccommodations: async () => {
      await wait(350);
      return {
        accommodations: { largerText: true },
        supports: [
          { key: 'readAloud', label: 'Read aloud', detail: 'Adds a control that speaks the question and its choices.' },
          { key: 'largerText', label: 'Larger text', detail: 'Raises the type size across the whole question screen.' },
        ],
      };
    },
    setStudentAccommodations: async (_id, accommodations) => { await wait(300); return { accommodations }; },
  };
}

function OverviewDemo({ data, classroom }) {
  const [refreshing, setRefreshing] = useState(false);
  const [details, inspect, reset] = useDetails(CLASS_DETAIL);
  const [services] = useState(() => fakeServices({ classroom }));

  return (
    <OverviewView
      loading={false}
      error=""
      data={data}
      refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await wait(700); reset(); setRefreshing(false); }}
      details={details}
      onInspect={inspect}
      services={services}
    />
  );
}

/* -------------------------------------------------------------------- rooms */

//   title, status, started, paused/closed after (min), joined, online, answered, banded, accuracy, withdrawn, redemption
const ROOM_ROWS = [
  ['Unit III: Transport layer', 'open', minsAgo(18), null, 27, 23, 196, 2, 0.66, 0, false],
  ['Memory management', 'open', minsAgo(4), null, 9, 9, 14, 0, 0.71, 0, false],
  ['Deadlocks', 'paused', minsAgo(190), 172, 24, 6, 288, 3, 0.58, 11, true],
  ['Unit III: Transport layer', 'closed', daysAgo(2, 4), 46, 29, 0, 512, 1, 0.71, 0, false],
  ['Process scheduling', 'closed', daysAgo(6, 2), 51, 28, 0, 476, 2, 0.64, 0, false],
  ['Normalisation and keys', 'closed', daysAgo(9, 5), 44, 26, 0, 402, 4, 0.52, 23, true],
  ['Deadlocks', 'closed', daysAgo(13, 1), 49, 30, 0, 548, 1, 0.69, 0, false],
  ['Unit III: Transport layer', 'closed', daysAgo(16, 3), 38, 25, 0, 381, 2, 0.61, 0, false],
  ['Process scheduling', 'closed', daysAgo(22, 6), 52, 27, 0, 455, 1, 0.67, 0, false],
  ['Normalisation and keys', 'closed', daysAgo(30, 2), 47, 27, 0, 438, 1, 0.7, 0, false],
  ['Process scheduling: revision before the mid-semester examination', 'closed', daysAgo(37, 4), 55, 31, 0, 604, 0, 0.74, 0, false],
  ['Deadlocks', 'closed', daysAgo(44, 1), 3, 0, 0, 0, 0, null, 0, false],
];

const roomsFor = (canControl) => {
  const r = seeded(3301);
  const ids = MY_CHAPTERS.map((c) => c.id);
  return ROOM_ROWS.map(([title, status, startedAt, after, joined, online, answered, banded, accuracy, withdrawn, redemption], i) => {
    const later = after == null ? null : new Date(new Date(startedAt).getTime() + after * 60000).toISOString();
    return {
      code: draw(r, ROOM_ALPHABET, 6),
      title,
      status,
      contentId: ids[i % ids.length],
      settings: { masteryGoal: 0.8, reattempts: redemption ? 1 : 0, redemption },
      withdrawn,
      startedAt,
      pausedAt: status === 'paused' ? later : null,
      closedAt: status === 'closed' ? later : null,
      joined,
      online,
      answered,
      banded,
      accuracy,
      canControl,
    };
  });
};

/** The room list with the server's side of each action played out locally. */
function RoomsDemo({ rooms: initial }) {
  const [rooms, setRooms] = useState(initial);
  const [busy, setBusy] = useState(null);
  const [reading, setReading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  async function act(room, action, change) {
    setBusy({ code: room.code, action });
    setActionError('');
    setNotice('');
    await wait(800);
    let ok = true;
    try {
      change();
    } catch (err) {
      ok = false;
      setActionError(err.message);
    }
    setBusy(null);
    return ok;
  }
  const patch = (code, next) => setRooms((list) => list.map((r) => (r.code === code ? { ...r, ...next } : r)));

  return (
    <RoomsView
      loading={false}
      error=""
      locked={false}
      rooms={rooms}
      reading={reading}
      onReload={async () => { setReading(true); await wait(600); setReading(false); }}
      busy={busy}
      actionError={actionError}
      notice={notice}
      onDismiss={() => { setActionError(''); setNotice(''); }}
      onPause={(room) => act(room, 'pause', () => patch(room.code, { status: 'paused', pausedAt: new Date().toISOString() }))}
      onResume={(room) => act(room, 'resume', () => patch(room.code, { status: 'open', pausedAt: null }))}
      onClose={(room) => act(room, 'close', () => patch(room.code, { status: 'closed', closedAt: new Date().toISOString(), online: 0 }))}
      onDelete={(room, typed) => act(room, 'delete', () => {
        // The server's own check, and its own sentence when it fails.
        if (typed !== room.code) {
          throw new Error(`Deleting ${room.code} also deletes every result recorded in it. Send ?confirm=${room.code} to go ahead.`);
        }
        setRooms((list) => list.filter((r) => r.code !== room.code));
        setNotice(`${room.code} is gone, and so are the ${room.joined} student result${room.joined === 1 ? '' : 's'} recorded in it.`);
      })}
    />
  );
}

/* ------------------------------------------------------------------ entries */

export default [
  { id: 'dash-department', title: 'Department', role: 'hod', render: () => <DepartmentDemo data={HOD} pending={PENDING} /> },
  { id: 'dash-department-empty', title: 'Department, no professors yet', role: 'hod', render: () => <DepartmentDemo data={HOD_EMPTY} /> },
  { id: 'dash-overview', title: 'Overview', role: 'professor', render: () => <OverviewDemo data={PROFESSOR} /> },
  { id: 'dash-overview-empty', title: 'Overview, nothing yet', role: 'professor', render: () => <OverviewDemo data={PROFESSOR_EMPTY} classroom="off" /> },
  { id: 'dash-rooms', title: 'Rooms', role: 'professor', render: () => <RoomsDemo rooms={roomsFor(true)} /> },
  { id: 'dash-rooms-empty', title: 'Rooms, none yet', role: 'professor', render: () => <RoomsDemo rooms={[]} /> },
  { id: 'dash-rooms-hod', title: 'Rooms, read only for a head of department', role: 'hod', render: () => <RoomsDemo rooms={roomsFor(false)} /> },
  { id: 'dash-rooms-key', title: 'Rooms, shared teacher key', render: () => <RoomsDemo rooms={roomsFor(true).slice(0, 5)} /> },
];
