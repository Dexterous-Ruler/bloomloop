// The teacher-record store (Phase 3, 0017): observations, the raised-hands
// tally, no-device activities and what was done about an insight. The wheel has
// its own file (wheel.js) and uses the room helpers here.
//
// What a professor sees and hears in a class, kept as evidence of its own kind.
// Three rules hold for everything in this file:
//
//   Staff-only.  Nothing here is sent to a student's phone, to the projector, or
//                into any route a student can reach. The routes are teacher-only
//                (routes/records.js) and the live loop never reads these tables.
//   Not a level. No record here is read by the Bloom-level ladder or blended into
//                any accuracy figure (decision 3's safe default,
//                docs/PRODUCT_DECISIONS.md). Observations are labelled by type and
//                counted apart.
//   No phones needed. A room opened for a class works from its roster, so a
//                Teacher-led room with nobody joined can use all of it.

import { activeStudentFor, byRoll, rosterRoll, withoutContact } from './roster.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/**
 * The lock every teacher-record write in a room takes (lockProfile in
 * sockets/index.js), so a room being deleted waits them out as it waits for each
 * student. '#' is outside ROLL_SHAPE, so it is never a student's own lock.
 */
export const RECORDS_LOCK = '#records';

/** Said with every record read, so no screen can show the data without it. */
export const STAFF_ONLY = 'Teacher records are for staff only: never shown on a phone or the projector, '
  + 'and they never move a Bloom level.';

export const MAX_NOTE = 280;

// ------------------------------------------------------------------- day --

// India keeps one time zone and no daylight saving, so a fixed offset is the
// whole rule. A UTC day would put a class opened before 05:30 IST on the day
// before.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * The day a room's records belong to: the day it was opened, in India's time.
 * A mark is about a class meeting, so a correction made the next morning is
 * still that meeting's.
 */
export function roomDay(session, now = new Date()) {
  const t = Date.parse(session?.startedAt ?? '');
  const at = Number.isFinite(t) ? t : now.getTime();
  return new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * A time strictly after `previous`, so records written in the same millisecond
 * still read back in the order they were written (lists are ordered by time).
 */
export function laterThan(previous, now = new Date()) {
  const p = Date.parse(previous ?? '');
  return Number.isFinite(p) && p >= now.getTime() ? new Date(p + 1).toISOString() : now.toISOString();
}

// ---------------------------------------------------------------- people --

/**
 * Everyone a room can call on or record, each { rollNo, name, classStudentId,
 * present }, in roll-number order.
 *
 *   class room   everyone on the roster now, and phones that joined with a roll
 *                number off it (a removed student's included), who have no
 *                roster student
 *   no class     the phones that joined
 *
 * `present`: in a class room, an attendance mark of present or late (unmarked
 * is not present, and a phone off the roster has no attendance at all); in a
 * room opened for no class there is no attendance, and a phone that joined is
 * the only sign anyone was there.
 */
export function roomPeople({ session, roster = [], marks = [], profiles = [] } = {}) {
  const out = new Map();
  if (session?.classId) {
    const markOf = new Map(marks.map((m) => [String(m.classStudentId), m.status]));
    for (const s of roster.filter((r) => !r.removedAt)) {
      const status = markOf.get(String(s._id));
      out.set(s.rollNo, {
        rollNo: s.rollNo,
        name: s.name,
        classStudentId: String(s._id),
        present: status === 'present' || status === 'late',
      });
    }
  }
  for (const p of profiles) {
    const rollNo = String(p.rollNo);
    if (!out.has(rollNo)) {
      out.set(rollNo, { rollNo, name: p.name ?? '', classStudentId: null, present: !session?.classId });
    }
  }
  return [...out.values()].sort(byRoll);
}

/** How many are present, as "N of M present responded" counts them. */
export function presentCount(people) {
  return people.filter((p) => p.present).length;
}

// ---------------------------------------------------------- notes, text --

/**
 * A short note off a request body: '' when not sent, an honest 400 otherwise.
 * A note hangs off a roster student, which keeps a roll number and a name only,
 * so a note is refused when it carries an email address or a mobile number
 * ("call parent 98450 12345"; roster.js holdsContact, which screens every other
 * free-text field here too).
 */
export function noteFrom(raw, field = 'note', max = MAX_NOTE) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw fail(`${field} must be text.`, 400);
  const note = raw.replace(/\s+/g, ' ').trim();
  if (note.length > max) throw fail(`${field} is ${note.length} characters; ${max} is the most.`, 400);
  return withoutContact(note, field);
}

// ---------------------------------------------------------- observations --

export const OBSERVATION_KINDS = [
  { id: 'understood', label: 'Understood' },
  { id: 'participated', label: 'Participated' },
  { id: 'revision', label: 'Needs revision' },
  { id: 'support', label: 'Needs additional support' },
];
const OBSERVATION_IDS = OBSERVATION_KINDS.map((k) => k.id);
const observationLabel = (kind) => OBSERVATION_KINDS.find((k) => k.id === kind)?.label ?? null;

/** The kind to set, or null to clear. Not sending it is a 400: a clear is said, never assumed. */
export function observationKindFrom(raw) {
  if (raw === null) return null;
  if (!OBSERVATION_IDS.includes(raw)) {
    throw fail(`kind must be one of ${OBSERVATION_IDS.join(', ')}, or null to clear the mark.`, 400);
  }
  return raw;
}

/**
 * Who an observation is about, from { studentId } or { rollNo }.
 *
 * A room opened for a class: a student on its roster now. A record is kept per
 * student per class per day, and only a roster student is "of the class"; a
 * phone that joined with a roll number off the roster is refused with a reason
 * (add them to the roster first). A room opened for no class: a roll number a
 * phone joined the room with.
 */
export function observationSubject({ session, roster = [], profiles = [], body = {} }) {
  const { studentId, rollNo } = body ?? {};
  if (session?.classId) {
    let student = null;
    if (typeof studentId === 'string' && studentId.trim()) {
      const id = studentId.trim().toLowerCase();
      student = roster.find((s) => !s.removedAt && String(s._id).toLowerCase() === id) ?? null;
    } else if (rollNo !== undefined && rollNo !== null) {
      student = activeStudentFor(roster, rosterRoll(rollNo) ?? '');
    } else {
      throw fail('Name the student: studentId (from the roster) or rollNo.', 400);
    }
    if (!student) {
      throw fail('That student is not on this class\'s roster. Observations in a class room are kept per roster '
        + 'student: add them to the roster first.', 400);
    }
    return { classStudentId: String(student._id), rollNo: student.rollNo, name: student.name };
  }
  if (studentId !== undefined && studentId !== null) {
    throw fail('This room was opened for no class, so it has no roster: name the student by rollNo.', 400);
  }
  const roll = rosterRoll(rollNo ?? '');
  const profile = roll ? profiles.find((p) => String(p.rollNo) === roll) : null;
  if (!profile) throw fail('No phone joined this room with that roll number.', 400);
  return { classStudentId: null, rollNo: roll, name: profile.name ?? '' };
}

/** The key of a student's day: one mark per student per class per day. */
export const slotKey = (o) => (o.classStudentId ? `s:${o.classStudentId}` : `r:${o.rollNo}`);

/** The mark in force: the latest event, unless it cleared the mark. */
export function currentObservation(events) {
  const last = events.at(-1);
  return last && last.kind ? last : null;
}

/** One event as a teacher's screen gets it. `rooms` maps a session id to its code. */
export function observationView(o, rooms = new Map()) {
  return {
    id: String(o._id),
    kind: o.kind ?? null,
    label: observationLabel(o.kind),
    note: o.note ?? '',
    observedAt: o.observedAt ?? null,
    observedBy: o.observedBy ?? null,
    room: rooms.get(String(o.sessionId)) ?? null,
  };
}

/**
 * A room's observations: one row per student with the mark in force for the
 * room's day and every event behind it (oldest first, clears included), and the
 * counts per kind. In a class room the day's marks are the class's, whichever of
 * its rooms they were set in, since there is one per student per class per day.
 *
 * Rows: a class room lists its roster now, plus a removed student who has a mark
 * that day; a room with no class lists the phones that joined, plus any roll
 * number with a mark.
 */
export function observationReport({ session, roster = [], profiles = [], events = [], rooms = new Map() }) {
  const bySlot = new Map();
  for (const e of events) {
    const k = slotKey(e);
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(e);
  }

  let rows;
  if (session?.classId) {
    rows = roster
      .filter((s) => !s.removedAt || bySlot.has(`s:${s._id}`))
      .map((s) => ({ studentId: String(s._id), rollNo: s.rollNo, name: s.name, active: !s.removedAt, key: `s:${s._id}` }));
  } else {
    const rolls = new Map(profiles.map((p) => [String(p.rollNo), p.name ?? '']));
    for (const e of events) if (!rolls.has(e.rollNo)) rolls.set(e.rollNo, '');
    rows = [...rolls].map(([rollNo, name]) => ({ studentId: null, rollNo, name, active: true, key: `r:${rollNo}` }));
  }
  rows.sort(byRoll);

  const students = rows.map(({ key, ...row }) => {
    const history = bySlot.get(key) ?? [];
    const current = currentObservation(history);
    return {
      ...row,
      current: current ? observationView(current, rooms) : null,
      history: history.map((e) => observationView(e, rooms)),
    };
  });

  const counts = Object.fromEntries(OBSERVATION_IDS.map((id) => [id, 0]));
  for (const s of students) if (s.active && s.current) counts[s.current.kind] += 1;
  const active = students.filter((s) => s.active);
  return {
    students,
    counts: { ...counts, observed: active.filter((s) => s.current).length, students: active.length },
  };
}

/**
 * One class student across days, newest day first: the mark in force each day,
 * and every event of that day (oldest first).
 */
export function observationDays(events, rooms = new Map()) {
  const byDay = new Map();
  for (const e of events) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  return [...byDay.keys()].sort().reverse().map((day) => {
    const history = byDay.get(day);
    const current = currentObservation(history);
    return {
      day,
      current: current ? observationView(current, rooms) : null,
      history: history.map((e) => observationView(e, rooms)),
    };
  });
}

// --------------------------------------------------------------- tallies --

export const OPTION_KEYS = ['A', 'B', 'C', 'D'];
export const MAX_QUESTION_TEXT = 1000;
export const MAX_OPTION_LABEL = 200;
// More hands than any hall holds; a number past it is a slip of the thumb.
export const MAX_HANDS = 1000;

/** 'A' to 'D' (any case) or 0 to 3, as an index; an honest 400 otherwise. */
export function optionIndex(raw, field = 'option') {
  if (Number.isInteger(raw) && raw >= 0 && raw < 4) return raw;
  const i = typeof raw === 'string' ? OPTION_KEYS.indexOf(raw.trim().toUpperCase()) : -1;
  if (i < 0) throw fail(`${field} must be A, B, C or D.`, 400);
  return i;
}

/** The question's text off a body: required unless the room's bank question supplies it. */
export function questionTextFrom(raw, { required }) {
  if (raw === undefined || raw === null) {
    if (required) throw fail('Send the question asked aloud: text, or questionId of a question in this room\'s bank.', 400);
    return null;
  }
  if (typeof raw !== 'string') throw fail('text must be text.', 400);
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) throw fail('text is empty: send the question that was asked aloud.', 400);
  if (text.length > MAX_QUESTION_TEXT) throw fail(`text is longer than ${MAX_QUESTION_TEXT} characters.`, 400);
  return withoutContact(text, 'text');
}

/** Labels for A to D: a list of up to four (shorter is padded with ''), each at most 200 characters. */
export function labelsFrom(raw) {
  if (!Array.isArray(raw) || raw.length > 4) throw fail('labels must be a list of at most four option labels, A to D.', 400);
  const out = ['', '', '', ''];
  raw.forEach((l, i) => {
    if (l === null || l === undefined) return;
    if (typeof l !== 'string') throw fail(`labels[${i}] must be text.`, 400);
    const label = l.replace(/\s+/g, ' ').trim();
    if (label.length > MAX_OPTION_LABEL) throw fail(`labels[${i}] is longer than ${MAX_OPTION_LABEL} characters.`, 400);
    out[i] = withoutContact(label, `labels[${i}]`);
  });
  return out;
}

/** Four whole numbers of hands, none below 0. */
export function countsFrom(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) throw fail('counts must be four whole numbers, for A to D.', 400);
  return raw.map((n, i) => {
    if (!Number.isInteger(n) || n < 0) throw fail(`counts[${i}] must be a whole number of 0 or more: a count never goes below 0.`, 400);
    if (n > MAX_HANDS) throw fail(`counts[${i}] is over ${MAX_HANDS}.`, 400);
    return n;
  });
}

/** The correct option as an index, or null for "not known". */
export function correctFrom(raw) {
  return raw === null ? null : optionIndex(raw, 'correct');
}

/**
 * A bank question's defaults for a tally: its text, and for a four-option mcq
 * its options as labels and its key as the correct option, so a professor
 * asking a bank question aloud need not type it again.
 */
export function tallyDefaultsFrom(question) {
  const four = question?.kind === 'mcq' && Array.isArray(question.options) && question.options.length === 4;
  return {
    text: String(question?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_TEXT),
    labels: four ? question.options.map((o) => String(o ?? '').slice(0, MAX_OPTION_LABEL)) : ['', '', '', ''],
    correct: four && Number.isInteger(question.answerIdx) ? question.answerIdx : null,
  };
}

/**
 * "N of M present responded". More hands than students marked present, or
 * nobody marked at all, is said in words: "17 of 3" reads as a fault in the
 * count when it is usually attendance not yet taken.
 */
export function tallySummary(total, present) {
  if (!present) return `${total} responded (nobody is marked present)`;
  if (total > present) return `${total} responded, more than the ${present} marked present`;
  return `${total} of ${present} present responded`;
}

/** One tally as a teacher's screen gets it, with "N of M present responded". */
export function tallyView(t, present) {
  const counts = Array.isArray(t.counts) ? t.counts.map(Number) : [0, 0, 0, 0];
  const total = counts.reduce((a, b) => a + b, 0);
  const correct = Number.isInteger(t.correct) ? t.correct : null;
  return {
    id: String(t._id),
    seq: t.seq,
    questionId: t.questionId ?? null,
    text: t.text,
    options: OPTION_KEYS.map((key, i) => ({
      key,
      label: t.labels?.[i] ?? '',
      count: counts[i] ?? 0,
      correct: correct === null ? null : correct === i,
    })),
    total,
    revealed: t.revealed === true,
    correct: correct === null ? null : OPTION_KEYS[correct],
    present,
    summary: tallySummary(total, present),
    createdAt: t.createdAt ?? null,
    createdBy: t.createdBy ?? null,
    updatedAt: t.updatedAt ?? null,
  };
}

// ------------------------------------------------------------ activities --

export const ACTIVITY_KINDS = [
  { id: 'check', label: 'Quick knowledge check' },
  { id: 'think', label: 'Think and explain' },
  { id: 'group', label: 'Group challenge' },
  { id: 'diagram', label: 'Explain the diagram' },
  { id: 'real', label: 'Real-world application' },
];
const ACTIVITY_IDS = ACTIVITY_KINDS.map((k) => k.id);

export const GROUP_RESULTS = [
  { id: 'yes', label: 'Got it' },
  { id: 'partly', label: 'Partly' },
  { id: 'no', label: 'Not yet' },
];
const GROUP_RESULT_IDS = GROUP_RESULTS.map((r) => r.id);
export const MAX_GROUPS = 100;
export const MAX_GROUP_LABEL = 40;

export function activityKindFrom(raw) {
  if (!ACTIVITY_IDS.includes(raw)) throw fail(`kind must be one of ${ACTIVITY_IDS.join(', ')}.`, 400);
  return raw;
}

/**
 * A group challenge's groups: [{ label, gotIt: yes | partly | no }]. Groups,
 * not students ("Bench 3"): the handoff's rule, "record which groups got it, not
 * which students". Labels are short and each is named once.
 */
export function groupsFrom(raw) {
  if (!Array.isArray(raw)) throw fail('groups must be a list of { label, gotIt }.', 400);
  if (raw.length > MAX_GROUPS) throw fail(`groups lists ${raw.length}; ${MAX_GROUPS} is the most.`, 400);
  const seen = new Set();
  return raw.map((g, i) => {
    const label = typeof g?.label === 'string' ? g.label.replace(/\s+/g, ' ').trim() : '';
    if (!label) throw fail(`groups[${i}] needs a label, such as "Bench 3".`, 400);
    if (label.length > MAX_GROUP_LABEL) throw fail(`groups[${i}].label is longer than ${MAX_GROUP_LABEL} characters.`, 400);
    withoutContact(label, `groups[${i}].label`);
    if (!GROUP_RESULT_IDS.includes(g?.gotIt)) throw fail(`groups[${i}].gotIt must be yes, partly or no.`, 400);
    const k = label.toUpperCase();
    if (seen.has(k)) throw fail(`groups names "${label}" twice.`, 400);
    seen.add(k);
    return { label, gotIt: g.gotIt };
  });
}

export function activityView(a) {
  return {
    id: String(a._id),
    seq: a.seq,
    kind: a.kind,
    label: ACTIVITY_KINDS.find((k) => k.id === a.kind)?.label ?? a.kind,
    outcome: a.outcome ?? '',
    groups: (Array.isArray(a.groups) ? a.groups : []).map((g) => ({
      label: g.label,
      gotIt: g.gotIt,
      result: GROUP_RESULTS.find((r) => r.id === g.gotIt)?.label ?? g.gotIt,
    })),
    tallyId: a.tallyId ?? null,
    createdAt: a.createdAt ?? null,
    createdBy: a.createdBy ?? null,
    updatedAt: a.updatedAt ?? null,
  };
}

// ------------------------------------------------------- insight actions --

export const INSIGHT_ACTIONS = ['dismissed', 'acted'];
export const MAX_FLAG_ID = 120;

// The ids services/insights.js gives its cards: focus:<level> or focus:none,
// support:<digest of roll numbers> or support:none, participation:<digest>,
// participation:none or participation:nobody-present. Lower case, and never a
// roll number or a name: the insights digest who a card is about.
const FLAG_SHAPE = /^(focus|support|participation):[a-z0-9-]{1,64}$/;

/**
 * The flag's id as the Insights code names it, or an honest 400. Only that
 * shape: a free-text id would be a place to keep anything about a student
 * ("21CS01 Asha 98450 12345") beside the screening every note gets.
 */
export function flagIdFrom(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || id.length > MAX_FLAG_ID || /[\u0000-\u001f\u007f]/.test(id)) {
    throw fail(`flagId must be the flag's id: 1 to ${MAX_FLAG_ID} characters.`, 400);
  }
  if (!FLAG_SHAPE.test(id)) {
    throw fail('flagId must be the id of one of the room\'s insight cards, such as focus:analyse or support:none.', 400);
  }
  return id;
}

export function insightActionFrom(raw) {
  if (!INSIGHT_ACTIONS.includes(raw)) throw fail('action must be dismissed or acted.', 400);
  return raw;
}

export function insightActionView(a) {
  return {
    id: String(a._id),
    flagId: a.flagId,
    action: a.action,
    note: a.note ?? '',
    actedBy: a.actedBy ?? null,
    actedAt: a.actedAt ?? null,
  };
}

/** The next place in a room's ordered list (tallies, activities). */
export const nextSeq = (rows) => rows.reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0) + 1;
