// Phase 3: the class roster, a room's attendance, and what the teacher's grid
// gains for a room opened for a class.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { rollKey } from '../src/services/accounts.js';
import { buildRoomArchive, decodeRoomArchive } from '../src/services/archive.js';
import {
  ROLL_SHAPE,
  MAX_CLASS_SIZE,
  JOINED_CAVEAT,
  activeStudentFor,
  attendanceReport,
  classFields,
  classGrid,
  cleanName,
  markJoined,
  marksFrom,
  marksFromJoins,
  nameProblem,
  presentCount,
  rosterRoll,
  validateRoster,
} from '../src/services/roster.js';

const status400 = (fn, match) => assert.throws(fn, (err) => err.status === 400 && (!match || match.test(err.message)));

// A roster as the repo returns it.
const student = (_id, rollNo, name, removedAt = null) => ({ _id, classId: 'c1', rollNo, name, addedAt: '2026-11-19T09:00:00.000Z', removedAt });

describe('roll numbers: the roster compares them as the live room does', () => {
  test('trimmed, single-spaced and upper-cased, by the same rollKey the accounts use', () => {
    assert.equal(rosterRoll(' 21cs  01 '), '21CS 01');
    assert.equal(rosterRoll('21cs01'), rollKey('21CS01'));
    assert.equal(rosterRoll(' 3 '), '3', '" 3 " and "3" are one student');
  });

  test('"03" and "3" stay two roll numbers: rollKey does not strip zeros, and neither does the room', () => {
    assert.notEqual(rosterRoll('03'), rosterRoll('3'));
    assert.equal(rosterRoll('03'), '03');
  });

  test('a number from a spreadsheet is read as its digits', () => {
    assert.equal(rosterRoll(17), '17');
    assert.equal(rosterRoll(Number.NaN), null);
  });

  test('a roll number no phone could join with is refused', () => {
    for (const bad of ['', '   ', '#12', '21CS#01', '-01', 'A'.repeat(25), null, undefined, {}, ['01']]) {
      assert.equal(rosterRoll(bad), null, JSON.stringify(bad));
    }
    assert.equal(rosterRoll('A'.repeat(24)), 'A'.repeat(24));
    for (const good of ['21BCE1234', 'CS-045', '2/A', 'TY.CSF_07']) assert.ok(ROLL_SHAPE.test(rosterRoll(good)), good);
  });

  test('a phone\'s typed roll number finds its roster student; a removed one finds nobody', () => {
    const roster = [student('a', '21CS01', 'Asha'), student('b', '21CS02', 'Bilal', '2026-11-19T10:00:00.000Z')];
    assert.equal(activeStudentFor(roster, ' 21cs01')?._id, 'a');
    assert.equal(activeStudentFor(roster, '21CS02'), null);
    assert.equal(activeStudentFor(roster, '21CS99'), null);
    assert.equal(activeStudentFor(roster, ''), null);
  });
});

describe('names and class fields', () => {
  test('a name is trimmed and single-spaced', () => {
    assert.equal(cleanName('  Bilal   Khan '), 'Bilal Khan');
    assert.equal(cleanName(42), '');
  });

  test('a name that carries an email or a long number is refused, with a reason', () => {
    assert.match(nameProblem(''), /missing/);
    assert.match(nameProblem('n'.repeat(81)), /longer than 80/);
    assert.match(nameProblem('asha@example.com'), /email/);
    assert.match(nameProblem('Ravi 98450 12345'), /phone number or a date of birth/);
    assert.match(nameProblem('Meera 12/05/2004'), /date of birth/);
    assert.equal(nameProblem('Asha Rao'), null);
    assert.equal(nameProblem('Rahul 2'), null, 'a short number is a name, not a phone');
  });

  test('a short date in a name is a date of birth, however few its digits', () => {
    assert.match(nameProblem('Asha 12-5-04'), /date/);
    assert.match(nameProblem('Asha 1/5/04'), /date/);
    assert.match(nameProblem('Asha 01.05.2004'), /date/);
    assert.equal(nameProblem('Asha R. 2'), null);
  });

  test('a class\'s course, section and term keep no email address and no phone number', () => {
    status400(() => classFields({ courseName: 'Networks, call 98450 12345', section: 'A' }), /courseName.*email address or a phone number/);
    status400(() => classFields({ courseName: 'Networks', section: 'asha@example.com' }), /section.*email address or a phone number/);
    status400(() => classFields({ termLabel: 'Odd 2026 +91 9845012345' }, { partial: true }), /termLabel.*email address or a phone number/);
    assert.deepEqual(classFields({ courseName: 'CS 2021', section: 'TY-CSF B', termLabel: '2026-27 odd' }),
      { courseName: 'CS 2021', section: 'TY-CSF B', termLabel: '2026-27 odd' });
  });

  test('a class needs a course and a section; the term is optional', () => {
    assert.deepEqual(classFields({ courseName: ' Computer  Networks ', section: 'TY-CSF B' }),
      { courseName: 'Computer Networks', section: 'TY-CSF B', termLabel: '' });
    status400(() => classFields({ section: 'A' }), /courseName is required/);
    status400(() => classFields({ courseName: 'X' }), /section is required/);
    status400(() => classFields({ courseName: 'X', section: 'A', termLabel: 't'.repeat(41) }), /termLabel/);
    status400(() => classFields({ courseName: 5, section: 'A' }), /must be text/);
  });

  test('an edit changes only what it sends, and must send something', () => {
    assert.deepEqual(classFields({ section: 'TY-CSF C' }, { partial: true }), { section: 'TY-CSF C' });
    assert.deepEqual(classFields({ termLabel: null }, { partial: true }), { termLabel: '' });
    status400(() => classFields({}, { partial: true }), /Send courseName/);
    status400(() => classFields({ courseName: '' }, { partial: true }), /courseName is required/);
  });
});

describe('adding a list of students', () => {
  test('every row is either added or refused with its position and a reason', () => {
    const { accepted, refused, ignoredFields } = validateRoster([
      { roll: '21CS01', name: 'Asha Rao' },
      { roll: ' 21cs02 ', name: '  Bilal   Khan ' },
      { rollNo: '21CS03', name: 'Chitra' },
      { roll: '21cs01', name: 'Twice' },
      { roll: '', name: 'No roll' },
      { roll: '21CS#9', name: 'Bad shape' },
      { roll: '21CS05', name: '' },
      { roll: '21CS06', name: 'asha@example.com' },
      { roll: '21CS08', name: 'Eve', phone: '9845012345', dob: '2004-05-12' },
      'Not an object',
    ]);
    assert.deepEqual(accepted.map((a) => [a.index, a.rollNo, a.name]), [
      [0, '21CS01', 'Asha Rao'], [1, '21CS02', 'Bilal Khan'], [2, '21CS03', 'Chitra'], [8, '21CS08', 'Eve'],
    ]);
    assert.deepEqual(refused.map((r) => r.index), [3, 4, 5, 6, 7, 9]);
    assert.match(refused[0].reason, /appears more than once/);
    assert.match(refused[1].reason, /missing/);
    assert.match(refused[2].reason, /not one a phone can join with/);
    assert.match(refused[3].reason, /name is missing/);
    assert.match(refused[4].reason, /email/);
    assert.match(refused[5].reason, /not a \{ roll, name \} object/);
    assert.deepEqual(ignoredFields, ['dob', 'phone'], 'what was not stored is named back');
    assert.equal('phone' in accepted[3], false, 'and is not carried on');
  });

  test('a roll number on the roster is refused; a removed one is pointed at restore', () => {
    const existing = [student('a', '21CS01', 'Asha'), student('b', '21CS02', 'Bilal', '2026-11-19T10:00:00.000Z')];
    const { accepted, refused } = validateRoster([{ roll: '21cs01', name: 'A' }, { roll: '21CS02', name: 'B' }, { roll: '21CS03', name: 'C' }], existing);
    assert.deepEqual(accepted.map((a) => a.rollNo), ['21CS03']);
    assert.match(refused[0].reason, /already on this class's roster/);
    assert.match(refused[1].reason, /was removed from this class; restore/);
  });

  test('a bad first copy does not block a good second one', () => {
    const { accepted, refused } = validateRoster([{ roll: '21CS01', name: '' }, { roll: '21CS01', name: 'Asha' }]);
    assert.deepEqual(accepted.map((a) => a.index), [1]);
    assert.deepEqual(refused.map((r) => r.index), [0]);
  });

  test('the class stops at its size limit, counting only students still on it', () => {
    const full = Array.from({ length: MAX_CLASS_SIZE - 1 }, (_, i) => student(`s${i}`, `R${i}`, `N${i}`));
    full.push(student('gone', 'GONE', 'Left', '2026-11-19T10:00:00.000Z'));
    const { accepted, refused } = validateRoster([{ roll: 'NEW1', name: 'A' }, { roll: 'NEW2', name: 'B' }], full);
    assert.deepEqual(accepted.map((a) => a.rollNo), ['NEW1']);
    assert.match(refused[0].reason, new RegExp(`more than ${MAX_CLASS_SIZE}`));
  });

  test('not a list, an empty list and an oversized list are a 400 for the whole request', () => {
    status400(() => validateRoster({ roll: '1', name: 'A' }), /list/);
    status400(() => validateRoster([]), /empty/);
    status400(() => validateRoster(Array.from({ length: MAX_CLASS_SIZE + 1 }, (_, i) => ({ roll: `R${i}`, name: 'A' }))), /most one request/);
  });
});

describe('attendance against the roster', () => {
  const roster = [
    student('a', '21CS01', 'Asha'),
    student('b', '21CS02', 'Bilal'),
    student('c', '21CS03', 'Chitra'),
    student('d', '21CS04', 'Dev'),
    student('e', '21CS10', 'Esha'),
    student('x', '21CS09', 'Left early', '2026-11-19T10:00:00.000Z'),
  ];
  const mark = (classStudentId, status, source = 'teacher') => ({ classStudentId, status, source, markedAt: '2026-11-19T09:05:00.000Z', markedBy: null });
  const marks = [mark('a', 'present', 'joined'), mark('b', 'absent'), mark('c', 'late'), mark('x', 'present', 'joined')];
  const profiles = [{ rollNo: '21CS01', name: 'asha' }, { rollNo: '21CS04', name: 'Dev' }, { rollNo: 'GUEST1', name: 'Guest' }, { rollNo: '21CS09', name: 'Left' }];

  test('an unmarked student is unmarked, not absent; late counts as there', () => {
    const report = attendanceReport({ roster, marks, profiles });
    assert.deepEqual(report.students.map((s) => [s.rollNo, s.status, s.source, s.joined]), [
      ['21CS01', 'present', 'joined', true],
      ['21CS02', 'absent', 'teacher', false],
      ['21CS03', 'late', 'teacher', false],
      ['21CS04', 'unmarked', null, true],
      ['21CS10', 'unmarked', null, false],
    ], 'in roll-number order, 10 after 4');
    assert.deepEqual(report.counts, { present: 1, late: 1, absent: 1, unmarked: 2, classSize: 5, joined: 2, notOnRoster: 2 });
    assert.equal(report.summary, '2 / 5 present');
    assert.equal(report.caveat, JOINED_CAVEAT);
  });

  test('a removed student keeps their mark, shown apart and not counted; a phone off the roster is named', () => {
    const report = attendanceReport({ roster, marks, profiles });
    assert.deepEqual(report.removed.map((s) => [s.rollNo, s.status, s.removedAt]), [['21CS09', 'present', '2026-11-19T10:00:00.000Z']]);
    assert.deepEqual(report.notOnRoster, [
      { rollNo: 'GUEST1', name: 'Guest', removedFromRoster: false },
      { rollNo: '21CS09', name: 'Left', removedFromRoster: true },
    ]);
  });

  test('the live grid\'s count is the report\'s', () => {
    assert.deepEqual(presentCount(roster, marks), { present: 2, classSize: 5, summary: '2 / 5 present' });
    assert.deepEqual(presentCount([], []), { present: 0, classSize: 0, summary: '0 / 0 present' });
  });

  test('the teacher\'s marks: all or nothing, by id in any case, against students on the roster', () => {
    assert.deepEqual(marksFrom([{ studentId: 'A', status: 'late' }, { studentId: 'b', status: 'present' }], roster),
      [{ classStudentId: 'a', status: 'late' }, { classStudentId: 'b', status: 'present' }]);
    status400(() => marksFrom([{ studentId: 'a', status: 'excused' }], roster), /present, absent or late/);
    status400(() => marksFrom([{ studentId: 'a', status: 'present' }, { studentId: 'x', status: 'present' }], roster),
      /1 of the 2 marks names a student who is not on this class's roster. Nothing was changed/);
    status400(() => marksFrom([{ studentId: 'a', status: 'present' }, { studentId: 'a', status: 'absent' }], roster), /twice/);
    status400(() => marksFrom([], roster), /fromJoins/);
    status400(() => marksFrom('a', roster), /fromJoins/);
  });

  test('"joined present, the rest absent" keeps every mark the professor made by hand', () => {
    const { marks: wanted, kept } = marksFromJoins({ roster, marks, profiles });
    assert.equal(kept, 2, 'Bilal absent and Chitra late stay as marked');
    assert.deepEqual(wanted, [
      { classStudentId: 'a', status: 'present' },
      { classStudentId: 'd', status: 'present' },
      { classStudentId: 'e', status: 'absent' },
    ], 'a removed student is not marked');
  });
});

describe('a join marks attendance, and never over the professor', () => {
  async function classRoom(repo) {
    const cls = await repo.createClass({ ownerId: null, courseName: 'Networks', section: 'TY-CSF B' });
    const [asha, bilal] = await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }, { rollNo: '21CS02', name: 'Bilal' }]);
    const session = await repo.createSession({ code: 'CLS001', contentId: 'c', title: 'R', classId: cls._id });
    return { cls, asha, bilal, session };
  }

  test('a roster roll number is marked present by the join, once', async () => {
    const repo = createMemoryRepo();
    const { asha, session } = await classRoom(repo);
    assert.deepEqual(await markJoined(repo, session, ' 21cs01 '), { created: true });
    assert.deepEqual(await markJoined(repo, session, '21CS01'), { created: false }, 'a rejoin adds nothing');
    const [m] = await repo.listAttendance(session._id);
    assert.equal(m.classStudentId, asha._id);
    assert.equal(m.status, 'present');
    assert.equal(m.source, 'joined');
    assert.equal(m.markedBy, null);
  });

  test('the professor\'s mark wins over a later join', async () => {
    const repo = createMemoryRepo();
    const { bilal, session } = await classRoom(repo);
    await repo.saveAttendance([{ sessionId: session._id, classStudentId: bilal._id, status: 'absent', source: 'teacher', markedBy: null }]);
    assert.deepEqual(await markJoined(repo, session, '21CS02'), { created: false });
    const [m] = await repo.listAttendance(session._id);
    assert.equal(m.status, 'absent');
    assert.equal(m.source, 'teacher');
  });

  test('a roll number off the roster, a removed student and a room with no class mark nobody', async () => {
    const repo = createMemoryRepo();
    const { bilal, session } = await classRoom(repo);
    assert.equal(await markJoined(repo, session, 'GUEST1'), null);
    await repo.updateClassStudent(bilal._id, { removedAt: '2026-11-19T10:00:00.000Z' });
    assert.equal(await markJoined(repo, session, '21CS02'), null);
    const plain = await repo.createSession({ code: 'PLAIN1', contentId: 'c', title: 'R' });
    assert.equal(plain.classId, null, 'a room opened without a class has none');
    assert.equal(await markJoined(repo, plain, '21CS01'), null);
    assert.equal((await repo.listAttendance(session._id)).length, 0);
  });
});

describe('the teacher\'s grid for a class room', () => {
  test('a room with no class gets its rows back as they were, and no attendance', async () => {
    const repo = createMemoryRepo();
    const rows = [{ rollNo: '21CS01', name: 'a' }];
    const out = await classGrid(repo, { _id: 's', classId: null }, rows);
    assert.deepEqual(Object.keys(out), ['rows']);
    assert.equal(out.rows, rows);
  });

  test('a class room\'s rows carry the roster name, and the payload the present count', async () => {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ ownerId: null, courseName: 'Networks', section: 'B' });
    const [asha] = await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha Rao' }, { rollNo: '21CS02', name: 'Bilal' }]);
    const session = await repo.createSession({ code: 'CLS002', contentId: 'c', classId: cls._id });
    await repo.saveAttendance([{ sessionId: session._id, classStudentId: asha._id, status: 'late', source: 'teacher' }]);
    const out = await classGrid(repo, session, [{ rollNo: '21CS01', name: 'asha' }, { rollNo: 'GUEST1', name: 'g' }]);
    assert.deepEqual(out.rows.map((r) => [r.rollNo, r.name, r.rosterName]), [['21CS01', 'asha', 'Asha Rao'], ['GUEST1', 'g', null]]);
    assert.deepEqual(out.attendance, { present: 1, classSize: 2, summary: '1 / 2 present' });
  });

  test('a failed roster read leaves the grid as it was rather than breaking it', async () => {
    const broken = { listClassStudents: async () => { throw new Error('down'); }, listAttendance: async () => [] };
    const rows = [{ rollNo: '1' }];
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await classGrid(broken, { _id: 's', classId: 'c' }, rows), { rows });
    } finally {
      console.error = quiet;
    }
  });
});

describe('the in-process store\'s roster and attendance', () => {
  test('a roll number the class holds is skipped on add and refused on edit', async () => {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ courseName: 'N', section: 'B' });
    const made = await repo.addClassStudents(cls._id, [{ rollNo: '01', name: 'A' }, { rollNo: '01', name: 'Again' }, { rollNo: '02', name: 'B' }]);
    assert.deepEqual(made.map((s) => s.rollNo), ['01', '02']);
    await assert.rejects(repo.updateClassStudent(made[1]._id, { rollNo: '01' }), (err) => err.status === 409);
    assert.equal((await repo.updateClassStudent(made[1]._id, { rollNo: '03' })).rollNo, '03');
    const other = await repo.createClass({ courseName: 'N', section: 'C' });
    assert.equal((await repo.addClassStudents(other._id, [{ rollNo: '01', name: 'A' }])).length, 1, 'another class may hold it');
  });

  test('deleting a room deletes its attendance and leaves the roster', async () => {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ courseName: 'N', section: 'B' });
    const [s] = await repo.addClassStudents(cls._id, [{ rollNo: '01', name: 'A' }]);
    const room = await repo.createSession({ code: 'DEL001', contentId: 'c', classId: cls._id });
    await repo.saveAttendance([{ sessionId: room._id, classStudentId: s._id, status: 'present', source: 'teacher' }]);
    await repo.deleteSession(room._id);
    assert.equal((await repo.listAttendance(room._id)).length, 0);
    assert.equal((await repo.listClassStudents(cls._id)).length, 1);
  });
});

describe('a class room\'s archive', () => {
  test('keeps the class and every mark, with the roll number and name the roster held', async () => {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ courseName: 'Networks', section: 'TY-CSF B' });
    const [asha, bilal] = await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }, { rollNo: '21CS02', name: 'Bilal' }]);
    const session = await repo.createSession({ code: 'ARC001', contentId: 'c', title: 'R', status: 'closed', classId: cls._id });
    await repo.saveAttendance([
      { sessionId: session._id, classStudentId: asha._id, status: 'present', source: 'joined', markedAt: '2026-11-19T09:01:00.000Z', markedBy: null },
      { sessionId: session._id, classStudentId: bilal._id, status: 'absent', source: 'teacher', markedAt: '2026-11-19T09:10:00.000Z', markedBy: 'prof-1' },
    ]);
    const { doc, json } = await buildRoomArchive(repo, session);
    assert.equal(doc.data.room.classId, cls._id);
    assert.equal(doc.data.counts.attendance, 2);
    const back = decodeRoomArchive(JSON.parse(json));
    assert.equal(back.room.classId, cls._id);
    const byRoll = Object.fromEntries(back.attendance.map((m) => [m.rollNo, m]));
    assert.deepEqual(
      [byRoll['21CS01'].status, byRoll['21CS01'].source, byRoll['21CS01'].name, byRoll['21CS01'].markedAt, byRoll['21CS01'].classStudentId],
      ['present', 'joined', 'Asha', '2026-11-19T09:01:00.000Z', asha._id],
    );
    assert.deepEqual([byRoll['21CS02'].status, byRoll['21CS02'].markedBy], ['absent', 'prof-1']);
  });

  test('a room with no class has no attendance table; an older archive decodes with none', async () => {
    const repo = createMemoryRepo();
    const session = await repo.createSession({ code: 'ARC002', contentId: 'c', title: 'R', status: 'closed' });
    const { doc } = await buildRoomArchive(repo, session);
    assert.equal('attendance' in doc.data, false);
    assert.equal('attendance' in doc.data.counts, false);
    assert.equal('classId' in doc.data.room, false, 'no classId key: the room archives as it did before 0016');
    const back = decodeRoomArchive(doc.data);
    assert.equal(back.room.classId, null, 'and, like an archive from before 0016, it decodes as null');
    assert.deepEqual(back.attendance, []);
  });
});

// Not a database test: no Supabase is reachable from here. This pins the
// requests the repo sends for the conflict rules the routes depend on.
describe('the Supabase repo\'s roster and attendance requests', () => {
  test('adds skip a held roll number, a join never replaces a mark, a teacher mark does', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const CLASS = '11111111-1111-4111-8111-111111111111';
    const ROOM = '22222222-2222-4222-8222-222222222222';
    const STUDENT = '33333333-3333-4333-8333-333333333333';
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      const body = init.body ? JSON.parse(init.body) : null;
      seen.push({ url: u, method: init.method ?? 'GET', prefer: new Headers(init.headers).get('prefer') ?? '', body });
      let reply = [];
      if (u.pathname === '/rest/v1/class_students') {
        reply = [{ id: STUDENT, class_id: CLASS, roll_no: '21CS01', name: 'Asha', added_at: '2026-11-19T09:00:00+00:00', removed_at: null }];
      } else if (u.pathname === '/rest/v1/attendance' && !seen.at(-1).prefer.includes('ignore')) {
        reply = [{ id: 'm', session_id: ROOM, class_student_id: STUDENT, status: 'late', source: 'teacher', marked_at: '2026-11-19T09:00:00+00:00', marked_by: null }];
      } else if (u.pathname === '/rest/v1/sessions') {
        reply = { id: ROOM, code: 'CLS001', content_id: CLASS, class_id: CLASS, mastery_goal: '0.80', reattempts: 0, redemption: false, question_ids: null };
      }
      return new Response(JSON.stringify(reply), { status: 201, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      const made = await repo.addClassStudents(CLASS, [{ rollNo: '21CS01', name: 'Asha' }]);
      assert.equal(seen[0].method, 'POST');
      assert.equal(seen[0].url.searchParams.get('on_conflict'), 'class_id,roll_no');
      assert.match(seen[0].prefer, /resolution=ignore-duplicates/);
      assert.deepEqual(seen[0].body, [{ class_id: CLASS, roll_no: '21CS01', name: 'Asha' }], 'a roll number and a name, nothing else');
      assert.deepEqual(made.map((s) => [s.rollNo, s.removedAt]), [['21CS01', null]]);

      const joined = await repo.addAttendanceIfAbsent({ sessionId: ROOM, classStudentId: STUDENT, status: 'present', source: 'joined', markedBy: null });
      assert.equal(seen[1].url.searchParams.get('on_conflict'), 'session_id,class_student_id');
      assert.match(seen[1].prefer, /resolution=ignore-duplicates/);
      assert.deepEqual(joined, { created: false }, 'nothing came back: the student already had a mark');

      const [m] = await repo.saveAttendance([{ sessionId: ROOM, classStudentId: STUDENT, status: 'late', source: 'teacher', markedBy: null }]);
      assert.match(seen[2].prefer, /resolution=merge-duplicates/);
      assert.equal(seen[2].url.searchParams.get('on_conflict'), 'session_id,class_student_id');
      assert.deepEqual([m.status, m.source, m.classStudentId], ['late', 'teacher', STUDENT]);

      const room = await repo.createSession({ code: 'CLS001', contentId: CLASS, title: 'R', classId: CLASS, masteryGoal: 0.8, reattempts: 0, redemption: false });
      assert.equal(seen[3].body.class_id, CLASS);
      assert.equal(room.classId, CLASS);

      assert.equal(await repo.getClass('0123456789abcdef01234567'), null, 'a non-uuid id is not found, with no request');
      assert.deepEqual(await repo.listAttendance('not-a-uuid'), []);
      assert.equal(seen.length, 4);
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });
});

// Not a database test either: the Mongo schemas, checked by building documents.
describe('the Mongo schemas', () => {
  test('a room keeps its class, and a roster row keeps a roll number and a name only', async () => {
    const { Session, ClassStudent, Attendance } = await import('../src/models/index.js');
    assert.equal(new Session({ code: 'X', contentId: '0123456789abcdef01234567', classId: 'c1' }).classId, 'c1');
    assert.equal(new Session({ code: 'Y', contentId: '0123456789abcdef01234567' }).classId, null);
    const row = new ClassStudent({ classId: 'c1', rollNo: '21CS01', name: 'Asha', phone: '9845012345', email: 'a@b.c' }).toObject();
    assert.equal('phone' in row, false);
    assert.equal('email' in row, false);
    assert.equal(new Attendance({ sessionId: 's', classStudentId: 'c', status: 'excused', source: 'teacher' }).validateSync()?.errors?.status?.kind, 'enum');
  });
});
