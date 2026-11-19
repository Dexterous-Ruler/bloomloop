// The class roster and a room's attendance (Phase 3).
//
// A room only ever knew the phones that joined it. A professor teaches a class:
// a course and a section with a list of students, some of whom never join. The
// roster is that list, kept as a roll number and a name and nothing else (bar the
// owner's yes-or-no under-18 mark, decision 8, 0022), and a room opened for a
// class can say who of it was there.
//
// Everything here is teacher-only. Attendance and roster names never go to a
// phone: not in the live loop's payloads (buildGridRow in routes/session.js
// feeds the phone too, so the roster name is added AFTER it, on the teacher's
// grid only), and not in GET /api/session/:code, which anyone holding the room
// code can read. A phone that typed a roll number would otherwise be told the
// real name behind it, which turns a projected room code into a way to look up
// a class list one roll number at a time.
//
// Attendance is evidence of its own kind. It never moves a Bloom level and is
// never blended into accuracy (decision 3's safe default, PRODUCT_DECISIONS.md).

import { rollKey } from './accounts.js';
import { parseCsv } from './csv.js';

/**
 * What a phone may join with (and so what a roster may hold): letters, digits,
 * space and . _ - /, starting with a letter or digit, at most 24 characters,
 * once trimmed, single-spaced and upper-cased. The live loop imports this, so a
 * roster can never hold a roll number no phone could send.
 */
export const ROLL_SHAPE = /^[A-Z0-9][A-Z0-9 ._\-\/]{0,23}$/;

export const MAX_NAME = 80;
export const MAX_COURSE_NAME = 120;
export const MAX_SECTION = 40;
export const MAX_TERM_LABEL = 40;
// Per class, and per request. Far over an Indian college section (60 to 120),
// and the most profiles one room's grid reads back from Supabase (listProfiles).
export const MAX_CLASS_SIZE = 500;

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late'];

/**
 * The lock the teacher's attendance writes take (lockProfile in
 * sockets/index.js), so a room being deleted waits for them as it waits for each
 * student. '#' is outside ROLL_SHAPE, so it is never a student's own lock.
 */
export const ATTENDANCE_LOCK = '#attendance';

/**
 * Said wherever a 'joined' mark is shown. A room has no sign-in: the roll number
 * is whatever was typed, so a classmate can be marked present by someone else's
 * phone. Decision 7 (19 Nov 2026) keeps it so: a join from a typed roll number
 * stays 'joined', with this sentence; a phone's sign-in links the room to the
 * student's history, not their attendance (docs/PRODUCT_DECISIONS.md).
 */
export const JOINED_CAVEAT =
  '"Joined" means a phone joined this room with that roll number. A room has no sign-in, '
  + 'so a typed roll number is not proof of who was holding the phone.';

// The keys a roster row may carry. Anything else (a phone number, an email) is
// left out of what is stored and named back in `ignoredFields` (a CSV import
// names unread columns in `ignoredColumns` instead: rosterFromCsv). `under18` is
// the owner's optional mark (decision 8, 0022).
const ROW_KEYS = new Set(['roll', 'rollNo', 'name', 'under18']);

/**
 * Decision 8 (19 Nov 2026), said wherever the mark is set. It is the owner's
 * working posture, not a legal determination.
 */
export const UNDER_18_NOTE = 'Integrity signals are neither recorded nor shown for a student marked under 18, in any room '
  + 'opened for this class. The mark is a yes or no; no date of birth is kept. This is a working default, not legal advice: '
  + 'a lawyer must confirm it before any college signs or before 13 May 2027.';

/**
 * The under-18 mark off a row: true, false, or null when it says something else.
 * JSON sends a boolean; a CSV cell sends text (yes, y, true, 1 / no, n, false, 0,
 * or blank for no).
 */
export function under18From(raw) {
  if (raw === undefined || raw === null || raw === false) return false;
  if (raw === true) return true;
  if (typeof raw !== 'string') return null;
  const word = raw.trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(word)) return true;
  if (['', 'no', 'n', 'false', '0'].includes(word)) return false;
  return null;
}

const fail = (message, status) => Object.assign(new Error(message), { status });

/** A roll number in the room's form, or null when a phone could not join with it. */
export function rosterRoll(raw) {
  if (typeof raw !== 'string' && !(typeof raw === 'number' && Number.isFinite(raw))) return null;
  const roll = rollKey(raw);
  return ROLL_SHAPE.test(roll) ? roll : null;
}

/** Trimmed and single-spaced; '' for anything that is not text. */
export function cleanName(raw) {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

// An email address, and an Indian mobile number (ten digits from 6 to 9, spaced
// or not, with or without +91). Narrow on purpose: a teacher's note may well
// name a roll number, and many roll numbers are long runs of digits.
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const MOBILE = /(?<!\d)(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d)/;
// A day, a month and a year: 12-5-04, 1/5/04, 01.05.2004.
const DATE = /(?<!\d)\d{1,2}[-/.]\d{1,2}[-/.](?:\d{2}|\d{4})(?!\d)/;

/**
 * Does this text carry an email address or a mobile number? Every free-text
 * field the server keeps about a class or its teaching is screened with it: a
 * roster keeps a roll number and a name only, and a field meant for something
 * else (a note, a group's label, a course name) is the easiest place for a
 * parent's number to end up.
 */
export function holdsContact(text) {
  return EMAIL.test(text) || MOBILE.test(text);
}

/** `field` off a body, refused when it carries an email address or a phone number (holdsContact). */
export function withoutContact(text, field) {
  if (holdsContact(text)) throw fail(`${field} holds an email address or a phone number; teacher records keep neither.`, 400);
  return text;
}

/**
 * Why this name cannot go on a roster, or null. A roster keeps a roll number and
 * a name only, and a pasted spreadsheet row ("Asha Rao 98450 12345") is the usual
 * way something else arrives inside the name.
 */
export function nameProblem(name) {
  if (!name) return 'the name is missing';
  if (name.length > MAX_NAME) return `the name is longer than ${MAX_NAME} characters`;
  if (name.includes('@')) return 'the name looks like it holds an email address; a roster keeps a roll number and a name only';
  if ((name.match(/\d/g) ?? []).length >= 6) {
    return 'the name holds a long number (a phone number or a date of birth?); a roster keeps a roll number and a name only';
  }
  // A short date has too few digits for the rule above ("Asha 12-5-04").
  if (DATE.test(name)) return 'the name holds a date (a date of birth?); a roster keeps a roll number and a name only';
  return null;
}

const textField = (body, key) => {
  const value = body?.[key];
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') throw fail(`${key} must be text.`, 400);
  return withoutContact(value.replace(/\s+/g, ' ').trim(), key);
};

/**
 * A class's own fields off a request body, or an honest 400. `partial` is an
 * edit: only what was sent, and at least one of the three.
 */
export function classFields(body = {}, { partial = false } = {}) {
  const out = {};
  const courseName = textField(body, 'courseName');
  const section = textField(body, 'section');
  const termLabel = textField(body, 'termLabel');

  if (courseName !== undefined || !partial) {
    if (!courseName) throw fail('courseName is required: the course this class takes, such as "Computer Networks".', 400);
    if (courseName.length > MAX_COURSE_NAME) throw fail(`courseName is longer than ${MAX_COURSE_NAME} characters.`, 400);
    out.courseName = courseName;
  }
  if (section !== undefined || !partial) {
    if (!section) throw fail('section is required, such as "TY-CSF B".', 400);
    if (section.length > MAX_SECTION) throw fail(`section is longer than ${MAX_SECTION} characters.`, 400);
    out.section = section;
  }
  if (termLabel !== undefined || !partial) {
    if ((termLabel ?? '').length > MAX_TERM_LABEL) throw fail(`termLabel is longer than ${MAX_TERM_LABEL} characters.`, 400);
    out.termLabel = termLabel ?? '';
  }
  if (partial && !Object.keys(out).length) throw fail('Send courseName, section or termLabel to change.', 400);
  return out;
}

/** Why a row was refused, as a word a screen or the CSV import can sort by. The sentence is in `reason`. */
export const REFUSAL = Object.freeze({
  notARow: 'not-a-row',
  noRoll: 'no-roll',
  badRoll: 'bad-roll',
  badName: 'bad-name',
  badUnder18: 'bad-under-18',
  onRoster: 'on-roster',
  removed: 'removed',
  repeated: 'repeated',
  full: 'class-full',
});

/** Roll-number order, numerically, so '2' comes before '10'. */
export function byRoll(a, b) {
  return String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true });
}

/**
 * Which rows of a pasted list may join the roster, and why each other one may
 * not. Nothing is refused silently and nothing is half-added: every row is
 * either in `accepted` or in `refused` with a reason a professor can act on.
 *
 * `existing` is the whole roster, removed students included: a removed
 * student's roll number is refused with "restore them" rather than added as a
 * second row, because their answers and attendance hang off the first.
 *
 * Each refusal also carries a `code` (REFUSAL), so the CSV import can list
 * duplicates and removed students apart without reading the sentences.
 * `maxRows` is how long one request's list may be: MAX_CLASS_SIZE for a pasted
 * list; the CSV import allows a longer file (MAX_CSV_ROWS) and its rows past the
 * class's room are refused one by one, with their lines, by the same rule.
 *
 * @returns {{ accepted: {index, rollNo, name, under18}[], refused: {index, roll, name, code, reason}[], ignoredFields: string[] }}
 */
export function validateRoster(list, existing = [], { maxRows = MAX_CLASS_SIZE } = {}) {
  if (!Array.isArray(list)) throw fail('students must be a list of { roll, name }.', 400);
  if (!list.length) throw fail('students is empty: send at least one { roll, name }.', 400);
  if (list.length > maxRows) {
    throw fail(`students lists ${list.length} rows; ${maxRows} is the most one request may add.`, 400);
  }

  const held = new Map(existing.map((s) => [s.rollNo, s]));
  let room = MAX_CLASS_SIZE - existing.filter((s) => !s.removedAt).length;
  const taken = new Set();
  const accepted = [];
  const refused = [];
  const ignored = new Set();

  list.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      refused.push({ index, roll: null, name: null, code: REFUSAL.notARow, reason: 'not a { roll, name } object' });
      return;
    }
    for (const k of Object.keys(row)) if (!ROW_KEYS.has(k)) ignored.add(k);

    const given = row.roll ?? row.rollNo;
    const refuse = (code, reason) => refused.push({
      index,
      roll: given === undefined || given === null ? null : String(given),
      name: typeof row.name === 'string' ? row.name : null,
      code,
      reason,
    });

    if (given === undefined || given === null || String(given).trim() === '') return refuse(REFUSAL.noRoll, 'the roll number is missing');
    const rollNo = rosterRoll(given);
    if (!rollNo) {
      return refuse(REFUSAL.badRoll, 'the roll number is not one a phone can join with: letters, digits, spaces and . _ - / only, '
        + 'starting with a letter or digit, at most 24 characters');
    }
    const name = cleanName(row.name);
    const problem = nameProblem(name);
    if (problem) return refuse(REFUSAL.badName, problem);
    const under18 = under18From(row.under18);
    if (under18 === null) {
      return refuse(REFUSAL.badUnder18, 'the under-18 mark must be yes or no (or left blank for no)');
    }

    const prior = held.get(rollNo);
    if (prior && !prior.removedAt) return refuse(REFUSAL.onRoster, `roll number ${rollNo} is already on this class's roster`);
    if (prior) {
      return refuse(REFUSAL.removed, `roll number ${rollNo} was removed from this class; restore that student instead of adding them again`);
    }
    if (taken.has(rollNo)) return refuse(REFUSAL.repeated, `roll number ${rollNo} appears more than once in this list`);
    if (room <= 0) return refuse(REFUSAL.full, `the class would have more than ${MAX_CLASS_SIZE} students`);

    room -= 1;
    taken.add(rollNo);
    accepted.push({ index, rollNo, name, under18 });
    return undefined;
  });

  return { accepted, refused, ignoredFields: [...ignored].sort() };
}

/**
 * Add a list to a class's roster: validateRoster against the roster as stored,
 * then one write of the rows that passed. The one path every add takes (the
 * JSON list and the CSV import), so the two can never disagree about a row.
 *
 * A row that passed the check and was still not written lost a race with
 * another request adding the same roll number: it is on the roster, once, and is
 * refused as already there.
 *
 * @returns {{ roster, accepted, made, refused, ignoredFields }} `roster` is the
 *   roster as it was read before the write, removed students included
 */
export async function addToRoster(repo, classId, list, { maxRows = MAX_CLASS_SIZE } = {}) {
  const roster = await repo.listClassStudents(classId);
  const { accepted, refused, ignoredFields } = validateRoster(list, roster, { maxRows });
  const made = accepted.length
    ? await repo.addClassStudents(classId, accepted.map(({ rollNo, name, under18 }) => ({ rollNo, name, under18 })))
    : [];
  const added = new Set(made.map((s) => s.rollNo));
  for (const row of accepted) {
    if (!added.has(row.rollNo)) {
      refused.push({
        index: row.index, roll: row.rollNo, name: row.name, code: REFUSAL.onRoster,
        reason: `roll number ${row.rollNo} is already on this class's roster`,
      });
    }
  }
  refused.sort((a, b) => a.index - b.index);
  return { roster, accepted, made, refused, ignoredFields };
}

/* ---------------------------------------------------------- CSV import -- */

/** The most a roster CSV may be: about a megabyte, and 2,000 rows under its header. */
export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_CSV_ROWS = 2000;

// Header cells, compared in lower case with . _ - read as spaces and runs of
// spaces as one: "Roll No.", "ROLL_NO" and "roll  no" are all "roll no".
const ROLL_HEADERS = new Set(['roll', 'roll no', 'roll number', 'rollno']);
const NAME_HEADERS = new Set(['name', 'student name']);
// The owner's optional under-18 mark (decision 8, 0022): a yes or no, read only
// when a column says so. A date-of-birth column is never read: it stays unread
// and named back like any other column.
const UNDER_18_HEADERS = new Set(['under 18', 'under18', 'minor', 'below 18']);
const headerKey = (cell) => String(cell ?? '').toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A roster CSV read into { roll, name } rows, each with the line it came from.
 *
 * The first non-blank line must name the columns: one roll number column (roll,
 * roll no, roll number or rollno) and one name column (name or student name),
 * in any case and any order. One more column is read when the file has it: the
 * owner's under-18 mark (under 18, under18, minor or below 18), as yes or no
 * (decision 8). Every other column is left unread and named back in
 * `ignoredColumns`, so a sheet that also carries phone numbers, emails or dates
 * of birth never brings them in: a roster keeps a roll number, a name and that
 * mark only. A line whose cells are all blank is skipped and counted.
 *
 * Refuses the whole file (400) when it has no such header, names either column
 * twice, or holds more than MAX_CSV_ROWS rows; 413 when it is over MAX_CSV_BYTES.
 *
 * @returns {{ delimiter, columns: { roll, name, under18, all }, rows: { line, roll, name, under18? }[], ignoredColumns: string[], blankLines: number }}
 */
export function rosterFromCsv(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw fail('Send the CSV as the request body (Content-Type: text/csv) or as { "csv": "..." }; it was empty.', 400);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) {
    throw fail(`The CSV is larger than ${MAX_CSV_BYTES / (1024 * 1024)} MB. A class list is far smaller; split the file.`, 413);
  }
  const { delimiter, records } = parseCsv(text);
  const blank = (r) => r.cells.every((c) => !c.trim());
  const headerAt = records.findIndex((r) => !blank(r));
  const header = records[headerAt];
  const wanted = 'a roll number column (roll, roll no, roll number or rollno) and a name column (name or student name)';
  if (!header) throw fail(`The CSV has no rows. Its first line must name the columns: ${wanted}.`, 400);

  const names = header.cells.map((c) => c.replace(/\s+/g, ' ').trim());
  const keys = names.map(headerKey);
  const rollAt = keys.flatMap((k, i) => (ROLL_HEADERS.has(k) ? [i] : []));
  const nameAt = keys.flatMap((k, i) => (NAME_HEADERS.has(k) ? [i] : []));
  const minorAt = keys.flatMap((k, i) => (UNDER_18_HEADERS.has(k) ? [i] : []));
  if (!rollAt.length || !nameAt.length) {
    const found = names.filter(Boolean).map((n) => `"${n}"`).join(', ') || 'nothing';
    throw fail(`Line ${header.line} must name the columns: ${wanted}. It names ${found}.`, 400);
  }
  for (const [at, what] of [[rollAt, 'roll number'], [nameAt, 'name'], [minorAt, 'under-18']]) {
    if (at.length > 1) {
      throw fail(`Line ${header.line} names ${at.length} ${what} columns (${at.map((i) => `"${names[i]}"`).join(', ')}); keep one.`, 400);
    }
  }
  const read = new Set([rollAt[0], nameAt[0], ...minorAt]);

  const ignoredColumns = names
    .map((n, i) => (read.has(i) ? null : n || `column ${i + 1} (no header)`))
    .filter(Boolean);
  const rows = [];
  let blankLines = 0;
  let pastHeader = false;
  for (const r of records.slice(headerAt + 1)) {
    if (blank(r)) { blankLines += 1; continue; }
    // A cell past the last named column has no header to say what it is: not
    // read, and named back once, like an ignored column.
    if (!pastHeader && r.cells.slice(names.length).some((c) => c.trim())) pastHeader = true;
    rows.push({
      line: r.line,
      roll: r.cells[rollAt[0]] ?? '',
      name: r.cells[nameAt[0]] ?? '',
      ...(minorAt.length ? { under18: r.cells[minorAt[0]] ?? '' } : {}),
    });
  }
  if (pastHeader) ignoredColumns.push('cells past the last named column');
  if (!rows.length) throw fail(`The CSV names its columns on line ${header.line} but has no students under them.`, 400);
  if (rows.length > MAX_CSV_ROWS) {
    throw fail(`The CSV has ${rows.length} rows; ${MAX_CSV_ROWS} is the most one import reads. A class is at most ${MAX_CLASS_SIZE} students.`, 400);
  }
  return {
    delimiter,
    columns: { roll: names[rollAt[0]], name: names[nameAt[0]], under18: minorAt.length ? names[minorAt[0]] : null, all: names },
    rows,
    ignoredColumns,
    blankLines,
  };
}

/** One roster row as a teacher's screen gets it. Field by field: nothing else stored is sent. */
export function studentView(s) {
  return {
    id: String(s._id),
    rollNo: s.rollNo,
    name: s.name,
    active: !s.removedAt,
    addedAt: s.addedAt ?? null,
    removedAt: s.removedAt ?? null,
    // The owner's optional mark (decision 8, 0022). Staff-only, like the roster.
    under18: s.under18 === true,
  };
}

/**
 * The roll numbers of a class room tied to a roster student marked under 18
 * (decision 8, 0022): each such student's roll number on the roster now, and any
 * roll number an attendance mark of the room was made under for them (0021), so
 * a corrected roll number still ties the room's rows to the student. A removed
 * student is still the age they were. Integrity signals are neither recorded nor
 * shown for these. `marks` are the room's, `roster` its class's.
 */
export function minorRolls(roster = [], marks = []) {
  const minors = roster.filter((s) => s.under18 === true);
  const ids = new Set(minors.map((s) => String(s._id)));
  const out = new Set(minors.map((s) => s.rollNo));
  for (const m of marks) if (m.rollNo && ids.has(String(m.classStudentId))) out.add(m.rollNo);
  return out;
}

/**
 * Is a signal about this roll number in this room to be dropped (decision 8)?
 * True in a class room for a student marked under 18. Read only when a signal is
 * about to be recorded, so a room pays nothing for it otherwise; a failed read
 * says true, so a signal is lost rather than recorded about a minor.
 */
export async function signalsOff(repo, session, rollNo) {
  if (!session?.classId) return false;
  try {
    const [roster, marks] = await Promise.all([repo.listClassStudents(session.classId), repo.listAttendance(session._id)]);
    return minorRolls(roster, marks).has(String(rollNo));
  } catch (err) {
    console.error('[roster] under-18 check failed:', err);
    return true;
  }
}

/** A class as a teacher's screen gets it. `size` is the active roster. */
export function classView(cls, roster = []) {
  return {
    id: String(cls._id),
    courseName: cls.courseName,
    section: cls.section,
    termLabel: cls.termLabel ?? '',
    ownerId: cls.ownerId ?? null,
    createdAt: cls.createdAt ?? null,
    updatedAt: cls.updatedAt ?? null,
    size: roster.filter((s) => !s.removedAt).length,
  };
}

/** The student on the roster (not removed) a phone's roll number names, or null. */
export function activeStudentFor(roster, rollNo) {
  const wanted = rollKey(rollNo);
  if (!wanted) return null;
  return roster.find((s) => !s.removedAt && s.rollNo === wanted) ?? null;
}

/** Present or late: in the room. The "N" of "N / M present". */
const inRoom = (mark) => mark?.status === 'present' || mark?.status === 'late';

const markOf = (marks) => new Map(marks.map((m) => [String(m.classStudentId), m]));

/**
 * A room's attendance against its class roster.
 *
 *   students     every student on the roster now, with their mark, or
 *                'unmarked' (which is not absent: nobody has said)
 *   removed      students removed from the roster since who still have a mark
 *                in this room. Kept and shown, not counted
 *   notOnRoster  phones that joined with a roll number the roster does not hold
 *                (a removed student's included), so the professor can add them.
 *                They were let in, as every roll number is
 *   counts       present, late, absent, unmarked, classSize (the roster now),
 *                joined (roster students with a phone in the room), notOnRoster
 *   summary      "N / M present", N counting late arrivals: they were there
 */
export function attendanceReport({ roster = [], marks = [], profiles = [] } = {}) {
  const joined = new Map(profiles.map((p) => [String(p.rollNo), p]));
  const byStudent = markOf(marks);
  const sorted = [...roster].sort(byRoll);
  const active = sorted.filter((s) => !s.removedAt);
  const onRoster = new Set(active.map((s) => s.rollNo));
  const removedRolls = new Set(sorted.filter((s) => s.removedAt).map((s) => s.rollNo));

  const row = (s) => {
    const m = byStudent.get(String(s._id));
    return {
      studentId: String(s._id),
      rollNo: s.rollNo,
      name: s.name,
      status: m?.status ?? 'unmarked',
      source: m?.source ?? null,
      markedAt: m?.markedAt ?? null,
      markedBy: m?.markedBy ?? null,
      joined: joined.has(s.rollNo),
    };
  };

  const students = active.map(row);
  const removed = sorted
    .filter((s) => s.removedAt && byStudent.has(String(s._id)))
    .map((s) => ({ ...row(s), removedAt: s.removedAt }));
  const notOnRoster = profiles
    .filter((p) => !onRoster.has(String(p.rollNo)))
    .map((p) => ({ rollNo: p.rollNo, name: p.name ?? '', removedFromRoster: removedRolls.has(String(p.rollNo)) }));

  const count = (status) => students.filter((s) => s.status === status).length;
  const counts = {
    present: count('present'),
    late: count('late'),
    absent: count('absent'),
    unmarked: count('unmarked'),
    classSize: active.length,
    joined: students.filter((s) => s.joined).length,
    notOnRoster: notOnRoster.length,
  };
  return {
    students,
    removed,
    notOnRoster,
    counts,
    summary: `${counts.present + counts.late} / ${counts.classSize} present`,
    caveat: JOINED_CAVEAT,
  };
}

/** "N / M present" for the live grid, by the same rule as the report. */
export function presentCount(roster = [], marks = []) {
  const byStudent = markOf(marks);
  const active = roster.filter((s) => !s.removedAt);
  const present = active.filter((s) => inRoom(byStudent.get(String(s._id)))).length;
  return { present, classSize: active.length, summary: `${present} / ${active.length} present` };
}

/**
 * The teacher's marks off a request body, checked against the roster, or an
 * honest 400. All or nothing: a list with one bad row changes nobody, so a
 * professor never has to work out which half of a press went through.
 */
export function marksFrom(raw, roster) {
  if (!Array.isArray(raw) || !raw.length) {
    throw fail('marks must be a list of { studentId, status }, or send { fromJoins: true }.', 400);
  }
  if (raw.length > MAX_CLASS_SIZE) throw fail(`marks lists ${raw.length} rows; ${MAX_CLASS_SIZE} is the most.`, 400);
  // Any case: a uuid may be typed either way, as for a room's question set.
  const active = new Map(roster.filter((s) => !s.removedAt).map((s) => [String(s._id).toLowerCase(), s]));
  const seen = new Set();
  const out = [];
  let outside = 0;
  raw.forEach((m, i) => {
    const status = m?.status;
    if (!ATTENDANCE_STATUSES.includes(status)) {
      throw fail(`marks[${i}]: status must be ${ATTENDANCE_STATUSES.join(', ').replace(/, (?=[^,]*$)/, ' or ')}.`, 400);
    }
    const id = typeof m?.studentId === 'string' ? m.studentId.trim().toLowerCase() : '';
    const student = active.get(id);
    if (!student) { outside += 1; return; }
    if (seen.has(id)) throw fail(`marks names roll number ${student.rollNo} twice.`, 400);
    seen.add(id);
    out.push({ classStudentId: String(student._id), status });
  });
  if (outside) {
    throw fail(
      `${outside} of the ${raw.length} marks name${outside === 1 ? 's' : ''} a student who is not on this class's roster. `
        + 'Nothing was changed.',
      400,
    );
  }
  return out;
}

/**
 * "Everyone who joined present, the rest absent", as marks. A student the
 * professor already marked by hand keeps that mark (someone marked late stays
 * late); only joins and unmarked students are written, as the teacher's.
 */
export function marksFromJoins({ roster = [], marks = [], profiles = [] } = {}) {
  const joined = new Set(profiles.map((p) => String(p.rollNo)));
  const byStudent = markOf(marks);
  const out = [];
  let kept = 0;
  for (const s of roster.filter((r) => !r.removedAt)) {
    if (byStudent.get(String(s._id))?.source === 'teacher') { kept += 1; continue; }
    out.push({ classStudentId: String(s._id), status: joined.has(s.rollNo) ? 'present' : 'absent' });
  }
  return { marks: out, kept };
}

/**
 * The roll number a teacher mark in a room is made under (0021): the one the
 * student's mark there already carries, else their roll number on the roster
 * now. Kept, so a professor correcting a room's attendance after a roll number
 * changed does not cut the room's answers, given under the old one, loose from
 * the student. `marks` are the room's, `roster` the class's.
 */
export function markRollNo(marks = [], roster = []) {
  const held = new Map(marks.map((m) => [String(m.classStudentId), m.rollNo]));
  const now = new Map(roster.map((s) => [String(s._id), s.rollNo]));
  return (classStudentId) => held.get(String(classStudentId)) || now.get(String(classStudentId)) || null;
}

/**
 * Mark a roster student present because a phone joined the room with their
 * roll number. Only if nobody has marked them yet: the professor's mark wins
 * over a later join, and a rejoin changes nothing. A roll number not on the
 * roster is let into the room as always and simply marks nobody.
 *
 * The roll number is typed, not proven (JOINED_CAVEAT), so this records that a
 * phone claimed the student, nothing more; decision 7 keeps it that way.
 *
 * @returns {Promise<{created: boolean} | null>} null when the room has no class or the roll is not on it
 */
export async function markJoined(repo, session, rollNo, { now = new Date() } = {}) {
  if (!session?.classId) return null;
  const student = activeStudentFor(await repo.listClassStudents(session.classId), rollNo);
  if (!student) return null;
  return repo.addAttendanceIfAbsent({
    sessionId: String(session._id),
    classStudentId: String(student._id),
    status: 'present',
    source: 'joined',
    markedAt: now.toISOString(),
    markedBy: null,
    // The roll number the phone joined with, in the roster's form (0021).
    rollNo: student.rollNo,
  });
}

/**
 * The teacher's grid for a class room: each row with the roster's name for its
 * roll number (`rosterName`, null for a roll number not on the roster), and the
 * present count. A room with no class gets its rows back untouched and no
 * `attendance`, exactly as before. Absent students who never joined have no
 * profile, so they are not rows.
 *
 * Never allowed to break the grid: it is pushed after every answer, and a
 * failed roster read must not tell a phone its saved answer "did not save".
 *
 * `seen`, when given, is handed the roster and the marks this read, so the live
 * insights' sample of the same push (services/insights.js sampleFromGrid) counts
 * who is present without reading them again. Left empty when the read fails.
 */
export async function classGrid(repo, session, rows, seen = null) {
  if (!session?.classId) return { rows };
  try {
    const [roster, marks] = await Promise.all([
      repo.listClassStudents(session.classId),
      repo.listAttendance(session._id),
    ]);
    if (seen) Object.assign(seen, { roster, marks });
    const names = new Map(roster.filter((s) => !s.removedAt).map((s) => [s.rollNo, s.name]));
    // Decision 8: no signal is shown for a student marked under 18. `integrity`
    // is null rather than an empty summary, which would read as "nothing seen".
    const minors = minorRolls(roster, marks);
    return {
      rows: rows.map((r) => ({
        ...r,
        rosterName: names.get(String(r.rollNo)) ?? null,
        ...(minors.has(String(r.rollNo)) ? { integrity: null } : {}),
      })),
      attendance: presentCount(roster, marks),
    };
  } catch (err) {
    console.error('[roster] class grid failed:', err);
    // Who is under 18 cannot be told without the roster, so no row shows a
    // signal on this push (decision 8): the safe side, for one push.
    return { rows: rows.map((r) => ({ ...r, integrity: null })) };
  }
}
