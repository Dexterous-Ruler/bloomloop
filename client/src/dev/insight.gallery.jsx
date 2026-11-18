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
    asked.push({ topic: room.topics[Math.floor(r() * room.topics.length)], correct });

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

/** GET /api/analytics/:id for a student. */
function studentRecord(subject, sat) {
  const base = {
    kind: 'student',
    subject: { id: subject.id, name: subject.name, code: subject.code, rollNo: subject.rollNo || null },
    counts: { sessions: 0, answered: 0, correct: 0, accuracy: null },
    bloom: report([]),
    best: null, weakest: null, confident: false,
    topics: [],
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
    topics: topicsOf(sat),
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
  'Isha Deshmukh': { skill: [0.96, 0.9, 0.82, 0.62, 0.45, 0.3], attend: 1, answers: 14 },
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
    sat: sittings(9000 + i * 17, cast.skill ?? skillOf(0.38 + r() * 0.5), rooms, { attend: cast.attend ?? 0.88, answers: cast.answers }),
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

function MeDemo({ dash, link: first = LINK, loading = false, error = '' }) {
  const [busy, setBusy] = useState(loading);
  const [link, setLink] = useState(first);
  return (
    <MeView
      dash={dash}
      busy={busy}
      error={error}
      onRefresh={() => { setBusy(true); setTimeout(() => setBusy(loading), 700); }}
      link={link}
      linkBusy={false}
      linkError=""
      onConnect={() => setLink(LINKED)}
      onDisconnect={() => setLink(LINK)}
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
  { id: 'me', title: 'Me: eight sessions', role: 'student', el: <MeDemo dash={DASH} /> },
  { id: 'me-new', title: 'Me: brand-new student', role: 'student', el: <MeDemo dash={DASH_NEW} /> },
  { id: 'me-band', title: 'Me: support band, Google linked', role: 'student', el: <MeDemo dash={DASH_BAND} link={LINKED} /> },
  { id: 'me-no-roll', title: 'Me: no roll number', role: 'student', el: <MeDemo dash={DASH_NO_ROLL} /> },
  { id: 'analytics-hod', title: 'Analytics: head of department', role: 'hod', el: <AnalyticsDemo overview={HOD_OVERVIEW} records={PROFESSOR_RECORDS} open={ARJUN.id} /> },
  { id: 'analytics-professor', title: 'Analytics: professor', role: 'professor', el: <AnalyticsDemo overview={PROFESSOR_OVERVIEW} records={STUDENT_RECORDS} open={ISHA.id} /> },
  { id: 'analytics-student', title: 'Analytics: student', role: 'student', el: <AnalyticsDemo overview={STUDENT_OVERVIEW} /> },

  // The states nobody sees until something is missing or broken.
  { id: 'me-loading', title: 'Me: first read', role: 'student', el: <MeDemo dash={null} loading link={null} /> },
  { id: 'me-failed', title: 'Me: did not load', role: 'student', el: <MeDemo dash={null} error="Failed to fetch" link={null} /> },
  { id: 'me-stale', title: 'Me: refresh failed', role: 'student', el: <MeDemo dash={DASH} error="Failed to fetch" link={{ ...LINKED, source: 'roster' }} /> },
  { id: 'me-wrong-role', title: 'Me: opened by a professor', role: 'professor', el: <MeDemo dash={{ role: 'professor' }} link={null} /> },
  { id: 'analytics-loading', title: 'Analytics: first read', role: 'professor', el: <AnalyticsDemo role="professor" /> },
  { id: 'analytics-failed', title: 'Analytics: did not load', role: 'professor', el: <AnalyticsDemo role="professor" error="Failed to fetch" /> },
  { id: 'analytics-nobody', title: 'Analytics: nobody yet', role: 'hod', el: <AnalyticsDemo overview={{ role: 'hod', subjects: [] }} /> },
  { id: 'analytics-record-loading', title: 'Analytics: record on its way', role: 'professor', el: <AnalyticsDemo overview={PROFESSOR_OVERVIEW} pending /> },
  { id: 'analytics-record-failed', title: 'Analytics: record did not load', role: 'professor', el: <AnalyticsDemo overview={PROFESSOR_OVERVIEW} /> },
  { id: 'analytics-no-roll', title: 'Analytics: student with no roll number', role: 'student', el: <AnalyticsDemo overview={NO_ROLL_OVERVIEW} /> },
];

// Keyed, so stepping from one entry to the next starts the screen afresh and
// does not carry the last entry's state into it.
export default SCREENS.map(({ el, ...entry }) => ({ ...entry, render: () => <Fragment key={entry.id}>{el}</Fragment> }));
