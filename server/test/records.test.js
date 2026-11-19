// Phase 3: the teacher-record store. Observations (one per student per class
// per day, every change logged), the raised-hands tally, activities, insight
// actions, the in-process repo's contract, the room archive, and the requests
// the Supabase repo sends.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { ARCHIVE_LIMIT_BYTES, buildRoomArchive, decodeRoomArchive } from '../src/services/archive.js';
import {
  activityView,
  correctFrom,
  countsFrom,
  currentObservation,
  flagIdFrom,
  groupsFrom,
  labelsFrom,
  laterThan,
  noteFrom,
  observationDays,
  observationKindFrom,
  observationReport,
  observationSubject,
  optionIndex,
  questionTextFrom,
  roomDay,
  tallyDefaultsFrom,
  tallyView,
} from '../src/services/records.js';

const status400 = (fn, match) => assert.throws(fn, (err) => err.status === 400 && (!match || match.test(err.message)));

const s = (_id, rollNo, name, removedAt = null) => ({ _id, classId: 'c1', rollNo, name, removedAt });
const roster = [s('a', '01', 'Asha Rao'), s('b', '02', 'Bilal'), s('f', '06', 'Farhan', '2026-11-18T00:00:00.000Z')];
const classRoom = { _id: 'room1', code: 'CLS001', classId: 'c1', startedAt: '2026-11-19T04:00:00.000Z' };
const plainRoom = { _id: 'room2', code: 'PLN001', classId: null, startedAt: '2026-11-19T04:00:00.000Z' };

describe('the day a record belongs to', () => {
  test('the day the room was opened, in India\'s time', () => {
    assert.equal(roomDay({ startedAt: '2026-11-18T19:00:00.000Z' }), '2026-11-19', '00:30 IST on the 19th');
    assert.equal(roomDay({ startedAt: '2026-11-19T18:29:59.000Z' }), '2026-11-19', '23:59 IST');
    assert.equal(roomDay({ startedAt: '2026-11-19T18:30:00.000Z' }), '2026-11-20', 'midnight IST');
    assert.equal(roomDay({}, new Date('2026-11-19T04:00:00.000Z')), '2026-11-19', 'no start: today');
  });

  test('a time after the last record, even inside one millisecond', () => {
    const now = new Date('2026-11-19T04:00:00.000Z');
    assert.equal(laterThan(null, now), now.toISOString());
    assert.equal(laterThan('2026-11-19T04:00:00.000Z', now), '2026-11-19T04:00:00.001Z');
    assert.equal(laterThan('2026-11-19T03:00:00.000Z', now), now.toISOString());
  });
});

describe('notes', () => {
  test('short, tidied, and never an email address or a phone number', () => {
    assert.equal(noteFrom(undefined), '');
    assert.equal(noteFrom('  Explained   inorder well '), 'Explained inorder well');
    status400(() => noteFrom('x'.repeat(281)), /280/);
    status400(() => noteFrom(12), /text/);
    status400(() => noteFrom('mail parent at asha.rao@example.com'), /email address or a phone number/);
    status400(() => noteFrom('call parent 98450 12345'), /phone number/);
    status400(() => noteFrom('call +91-9845012345'), /phone number/);
    // A roll number is not a phone number: many are long runs of digits.
    assert.equal(noteFrom('Worked with 2021001234 on the proof'), 'Worked with 2021001234 on the proof');
    assert.equal(noteFrom('Q3 2 4 5 6 7 right'), 'Q3 2 4 5 6 7 right');
  });
});

describe('observations', () => {
  test('the four kinds, and null to clear; nothing else', () => {
    for (const k of ['understood', 'participated', 'revision', 'support']) assert.equal(observationKindFrom(k), k);
    assert.equal(observationKindFrom(null), null);
    status400(() => observationKindFrom('slow learner'));
    status400(() => observationKindFrom(undefined));
  });

  test('in a class room, a student on the roster now, by id or roll number', () => {
    assert.deepEqual(observationSubject({ session: classRoom, roster, body: { studentId: 'A' } }),
      { classStudentId: 'a', rollNo: '01', name: 'Asha Rao' });
    assert.equal(observationSubject({ session: classRoom, roster, body: { rollNo: ' 02 ' } }).classStudentId, 'b');
    status400(() => observationSubject({ session: classRoom, roster, body: { rollNo: 'GUEST9' } }), /not on this class's roster/);
    status400(() => observationSubject({ session: classRoom, roster, body: { studentId: 'f' } }), /not on this class's roster/);
    status400(() => observationSubject({ session: classRoom, roster, body: {} }), /Name the student/);
  });

  test('in a room with no class, a roll number a phone joined with', () => {
    const profiles = [{ rollNo: 'GUEST9', name: 'Visitor' }];
    assert.deepEqual(observationSubject({ session: plainRoom, profiles, body: { rollNo: 'guest9' } }),
      { classStudentId: null, rollNo: 'GUEST9', name: 'Visitor' });
    status400(() => observationSubject({ session: plainRoom, profiles, body: { rollNo: '01' } }), /No phone joined/);
    status400(() => observationSubject({ session: plainRoom, profiles, body: { studentId: 'a' } }), /no roster/);
  });

  const ev = (id, k, kind, at, extra = {}) => ({
    _id: id, sessionId: 'room1', classId: 'c1', classStudentId: k, rollNo: k === 'a' ? '01' : '02', day: '2026-11-19',
    kind, note: '', observedAt: at, observedBy: 'prof', ...extra,
  });

  test('the mark in force is the latest event; a clear leaves none; every event is kept', () => {
    const events = [ev('1', 'a', 'understood', 'T1'), ev('2', 'a', 'revision', 'T2'), ev('3', 'b', 'support', 'T1')];
    const report = observationReport({ session: classRoom, roster, events, rooms: new Map([['room1', 'CLS001']]) });
    const asha = report.students.find((x) => x.rollNo === '01');
    assert.deepEqual([asha.current.kind, asha.current.label, asha.current.room], ['revision', 'Needs revision', 'CLS001']);
    assert.deepEqual(asha.history.map((h) => h.kind), ['understood', 'revision'], 'the replaced mark stays in the log');
    assert.deepEqual(report.counts, { understood: 0, participated: 0, revision: 1, support: 1, observed: 2, students: 2 });
    const cleared = [...events, ev('4', 'a', null, 'T3')];
    assert.equal(currentObservation(cleared.filter((e) => e.classStudentId === 'a')), null);
    const after = observationReport({ session: classRoom, roster, events: cleared });
    assert.equal(after.students.find((x) => x.rollNo === '01').current, null);
    assert.equal(after.students.find((x) => x.rollNo === '01').history.length, 3);
    assert.equal(after.counts.observed, 1);
  });

  test('a removed student with a mark that day is listed apart, not counted', () => {
    const report = observationReport({ session: classRoom, roster, events: [ev('1', 'f', 'participated', 'T1', { rollNo: '06' })] });
    const farhan = report.students.find((x) => x.rollNo === '06');
    assert.deepEqual([farhan.active, farhan.current.kind], [false, 'participated']);
    assert.equal(report.counts.students, 2);
    assert.equal(report.counts.participated, 0);
  });

  test('a room with no class lists the phones that joined', () => {
    const report = observationReport({
      session: plainRoom,
      profiles: [{ rollNo: '2', name: 'B' }, { rollNo: '10', name: 'A' }],
      events: [{ _id: 'x', sessionId: 'room2', rollNo: '10', day: '2026-11-19', kind: 'understood', observedAt: 'T1' }],
    });
    assert.deepEqual(report.students.map((x) => [x.rollNo, x.studentId, x.current?.kind ?? null]), [['2', null, null], ['10', null, 'understood']]);
  });

  test('one student across days: newest day first, each with its own mark', () => {
    const days = observationDays([
      ev('1', 'a', 'understood', 'T1', { day: '2026-11-17' }),
      ev('2', 'a', 'revision', 'T2', { day: '2026-11-19' }),
      ev('3', 'a', null, 'T3', { day: '2026-11-19' }),
      ev('4', 'a', 'participated', 'T4', { day: '2026-11-18' }),
    ]);
    assert.deepEqual(days.map((d) => [d.day, d.current?.kind ?? null, d.history.length]),
      [['2026-11-19', null, 2], ['2026-11-18', 'participated', 1], ['2026-11-17', 'understood', 1]]);
  });
});

describe('the raised-hands tally', () => {
  test('options are A to D; counts are four whole numbers, never below 0', () => {
    assert.deepEqual(['a', 'B', 2, 'd '].map((o) => optionIndex(o)), [0, 1, 2, 3]);
    status400(() => optionIndex('E'));
    status400(() => optionIndex(4));
    assert.deepEqual(countsFrom([0, 3, 18, 2]), [0, 3, 18, 2]);
    status400(() => countsFrom([0, -1, 0, 0]), /never goes below 0/);
    status400(() => countsFrom([0, 1.5, 0, 0]));
    status400(() => countsFrom([1, 2, 3]), /four/);
    status400(() => countsFrom([1001, 0, 0, 0]), /1000/);
    assert.equal(correctFrom(null), null);
    assert.equal(correctFrom('b'), 1);
  });

  test('labels are padded to four; text is required unless the bank brings it', () => {
    assert.deepEqual(labelsFrom(['Inorder', 'Preorder']), ['Inorder', 'Preorder', '', '']);
    status400(() => labelsFrom(['a', 'b', 'c', 'd', 'e']));
    status400(() => questionTextFrom(undefined, { required: true }), /questionId/);
    assert.equal(questionTextFrom(undefined, { required: false }), null);
    assert.equal(questionTextFrom('  Which   traversal? ', { required: true }), 'Which traversal?');
  });

  test('a bank mcq brings its text, its options and its key', () => {
    assert.deepEqual(tallyDefaultsFrom({ kind: 'mcq', text: 'Which visits the root first?', options: ['In', 'Pre', 'Post', 'Level'], answerIdx: 1 }),
      { text: 'Which visits the root first?', labels: ['In', 'Pre', 'Post', 'Level'], correct: 1 });
    assert.deepEqual(tallyDefaultsFrom({ kind: 'open', text: 'Explain' }), { text: 'Explain', labels: ['', '', '', ''], correct: null });
  });

  test('"N of M present responded", in words when nobody is marked present', () => {
    const t = { _id: 't1', seq: 1, text: 'Q', labels: ['In', 'Pre', 'Post', 'Level'], counts: [3, 18, 6, 2], revealed: false, correct: 1 };
    const v = tallyView(t, 36);
    assert.deepEqual([v.total, v.summary, v.correct], [29, '29 of 36 present responded', 'B']);
    assert.deepEqual(v.options.map((o) => [o.key, o.count, o.correct]), [['A', 3, false], ['B', 18, true], ['C', 6, false], ['D', 2, false]]);
    assert.equal(tallyView(t, 0).summary, '29 responded (nobody is marked present)');
    assert.equal(tallyView(t, 20).summary, '29 responded, more than the 20 marked present');
  });
});

describe('activities and insight actions', () => {
  test('groups are labelled groups with yes, partly or no; never named twice', () => {
    assert.deepEqual(groupsFrom([{ label: ' Bench  3 ', gotIt: 'yes' }, { label: 'Bench 4', gotIt: 'partly' }]),
      [{ label: 'Bench 3', gotIt: 'yes' }, { label: 'Bench 4', gotIt: 'partly' }]);
    status400(() => groupsFrom([{ label: 'Bench 3', gotIt: 'maybe' }]), /yes, partly or no/);
    status400(() => groupsFrom([{ label: 'Bench 3', gotIt: 'yes' }, { label: 'bench 3', gotIt: 'no' }]), /twice/);
    status400(() => groupsFrom([{ gotIt: 'yes' }]), /label/);
    assert.deepEqual(activityView({ _id: 'x', seq: 1, kind: 'group', groups: [{ label: 'Bench 3', gotIt: 'no' }] }).groups,
      [{ label: 'Bench 3', gotIt: 'no', result: 'Not yet' }]);
  });

  test('a flag id is short plain text', () => {
    assert.equal(flagIdFrom(' focus:analyse '), 'focus:analyse');
    status400(() => flagIdFrom(''));
    status400(() => flagIdFrom('a\nb'));
    status400(() => flagIdFrom('x'.repeat(121)));
  });

  test('a flag id has the shape the insights give their cards, and nothing else', () => {
    for (const id of ['focus:none', 'focus:analyse', 'support:none', 'support:0123456789abcdef', 'participation:nobody-present',
      'participation:fedcba9876543210']) {
      assert.equal(flagIdFrom(id), id);
    }
    status400(() => flagIdFrom('21CS01 Asha 9845012345'), /flagId/);
    status400(() => flagIdFrom('support:21CS05'), /flagId/, 'a roll number is never part of a flag id: the insights digest them');
    status400(() => flagIdFrom('focus:Asha Rao'), /flagId/);
    status400(() => flagIdFrom('custom:x'), /flagId/);
  });
});

describe('teacher-record text keeps no email address and no phone number', () => {
  test('a question asked aloud, its option labels, and a group\'s label', () => {
    status400(() => questionTextFrom('Asha, ring 98450 12345 after class', { required: true }), /email address or a phone number/);
    status400(() => labelsFrom(['Inorder', 'asha.rao@example.com']), /labels\[1\].*email address or a phone number/);
    status400(() => groupsFrom([{ label: 'Asha 9845012345', gotIt: 'yes' }]), /groups\[0\].*email address or a phone number/);
    assert.equal(questionTextFrom('What is 2 + 2?', { required: true }), 'What is 2 + 2?', 'numbers in a question are fine');
    assert.deepEqual(labelsFrom(['O(n log n)', '1024', '', '']), ['O(n log n)', '1024', '', '']);
  });
});

describe('the in-process repo', () => {
  test('observations and insight actions can only be added; places in a room are unique (409)', async () => {
    const repo = createMemoryRepo();
    assert.equal(typeof repo.updateObservation, 'undefined');
    assert.equal(typeof repo.updateInsightAction, 'undefined');
    await repo.addWheelRound({ sessionId: 'r', round: 1, presentOnly: true, noRepeat: true });
    await assert.rejects(repo.addWheelRound({ sessionId: 'r', round: 1, presentOnly: true, noRepeat: true }), (e) => e.status === 409);
    await repo.addWheelPick({ sessionId: 'r', round: 1, order: 1, rollNo: '01', poolSize: 2, presentOnly: true, noRepeat: true });
    await assert.rejects(repo.addWheelPick({ sessionId: 'r', round: 1, order: 1, rollNo: '02', poolSize: 2, presentOnly: true, noRepeat: true }),
      (e) => e.status === 409);
    await repo.addTally({ sessionId: 'r', seq: 1, text: 'Q' });
    await assert.rejects(repo.addTally({ sessionId: 'r', seq: 1, text: 'Q2' }), (e) => e.status === 409);
  });

  test('a pick\'s draw is written once; only its ask and response change', async () => {
    const repo = createMemoryRepo();
    const p = await repo.addWheelPick({ sessionId: 'r', round: 1, order: 1, rollNo: '01', poolSize: 2, presentOnly: true, noRepeat: true });
    const u = await repo.updateWheelPick(p._id, { rollNo: '02', poolSize: 9, status: 'answered', statusAt: 'T' });
    assert.deepEqual([u.rollNo, u.poolSize, u.status], ['01', 2, 'answered']);
  });

  test('deleting a room deletes its records, and only its own', async () => {
    const repo = createMemoryRepo();
    const room = await repo.createSession({ code: 'DEL001', contentId: 'c' });
    const other = await repo.createSession({ code: 'DEL002', contentId: 'c' });
    for (const id of [room._id, other._id]) {
      await repo.addObservation({ sessionId: id, rollNo: '01', day: '2026-11-19', kind: 'understood' });
      await repo.addWheelRound({ sessionId: id, round: 1, presentOnly: true, noRepeat: true });
      await repo.addWheelPick({ sessionId: id, round: 1, order: 1, rollNo: '01', poolSize: 1, presentOnly: true, noRepeat: true });
      await repo.addTally({ sessionId: id, seq: 1, text: 'Q' });
      await repo.addActivity({ sessionId: id, seq: 1, kind: 'think' });
      await repo.addInsightAction({ sessionId: id, flagId: 'f', action: 'acted' });
    }
    await repo.deleteSession(room._id);
    const counts = async (id) => [
      (await repo.listObservations({ sessionId: id })).length, (await repo.listWheelRounds(id)).length,
      (await repo.listWheelPicks(id)).length, (await repo.listTallies(id)).length,
      (await repo.listActivities(id)).length, (await repo.listInsightActions(id)).length,
    ];
    assert.deepEqual(await counts(room._id), [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(await counts(other._id), [1, 1, 1, 1, 1, 1]);
  });
});

describe('a room\'s archive keeps its teacher records', () => {
  async function recordedRoom(repo) {
    const cls = await repo.createClass({ courseName: 'Data Structures', section: 'SY-CS A' });
    const [asha, bilal] = await repo.addClassStudents(cls._id, [{ rollNo: '01', name: 'Asha Rao' }, { rollNo: '02', name: 'Bilal' }]);
    const session = await repo.createSession({ code: 'REC001', contentId: 'c', title: 'Trees', status: 'closed', classId: cls._id,
      startedAt: '2026-11-19T04:00:00.000Z' });
    const id = session._id;
    await repo.addObservation({ sessionId: id, classId: cls._id, classStudentId: asha._id, rollNo: '01', day: '2026-11-19',
      kind: 'understood', note: 'Explained inorder', observedBy: 'prof', observedAt: '2026-11-19T04:10:00.000Z' });
    await repo.addObservation({ sessionId: id, classId: cls._id, classStudentId: asha._id, rollNo: '01', day: '2026-11-19',
      kind: 'revision', note: '', observedBy: 'prof', observedAt: '2026-11-19T04:20:00.000Z' });
    await repo.addWheelRound({ sessionId: id, round: 1, presentOnly: true, noRepeat: true, startedAt: '2026-11-19T04:05:00.000Z' });
    await repo.addWheelPick({ sessionId: id, round: 1, order: 1, rollNo: '02', classStudentId: bilal._id, poolSize: 2, presentOnly: true,
      noRepeat: true, ask: 'diagram', status: 'help', pickedAt: '2026-11-19T04:06:00.000Z', statusAt: '2026-11-19T04:07:00.000Z' });
    const t = await repo.addTally({ sessionId: id, seq: 1, text: 'Which traversal visits the root first?', labels: ['In', 'Pre', 'Post', 'Level'],
      counts: [3, 18, 6, 2], revealed: true, correct: 1, createdAt: '2026-11-19T04:30:00.000Z', updatedAt: '2026-11-19T04:31:00.000Z' });
    await repo.addActivity({ sessionId: id, seq: 1, kind: 'check', tallyId: t._id, createdAt: '2026-11-19T04:30:00.000Z', updatedAt: '2026-11-19T04:30:00.000Z' });
    await repo.addActivity({ sessionId: id, seq: 2, kind: 'group', outcome: 'Most got it', groups: [{ label: 'Bench 3', gotIt: 'yes' }],
      createdAt: '2026-11-19T04:40:00.000Z', updatedAt: '2026-11-19T04:41:00.000Z' });
    await repo.addInsightAction({ sessionId: id, flagId: 'focus:analyse', action: 'acted', note: 'Asked two aloud', actedAt: '2026-11-19T04:50:00.000Z' });
    return { session, asha, bilal, tally: t };
  }

  test('every record, its times back as they were, a roster student\'s name copied in', async () => {
    const repo = createMemoryRepo();
    const { session, asha, tally } = await recordedRoom(repo);
    const { doc, json } = await buildRoomArchive(repo, session);
    assert.deepEqual([doc.data.counts.observations, doc.data.counts.wheelPicks, doc.data.counts.tallies, doc.data.counts.activities,
      doc.data.counts.insightActions, doc.data.counts.wheelRounds], [2, 1, 1, 2, 1, 1]);
    const back = decodeRoomArchive(JSON.parse(json));
    assert.deepEqual(back.observations.map((o) => [o.kind, o.rollNo, o.name, o.day, o.observedAt, o.classStudentId]), [
      ['understood', '01', 'Asha Rao', '2026-11-19', '2026-11-19T04:10:00.000Z', asha._id],
      ['revision', '01', 'Asha Rao', '2026-11-19', '2026-11-19T04:20:00.000Z', asha._id],
    ], 'the replaced mark is in the archive too');
    const [pick] = back.wheelPicks;
    assert.deepEqual([pick.rollNo, pick.name, pick.ask, pick.status, pick.poolSize, pick.pickedAt, pick.statusAt],
      ['02', 'Bilal', 'diagram', 'help', 2, '2026-11-19T04:06:00.000Z', '2026-11-19T04:07:00.000Z']);
    assert.deepEqual([back.tallies[0].counts, back.tallies[0].labels, back.tallies[0].correct, back.tallies[0].id],
      [[3, 18, 6, 2], ['In', 'Pre', 'Post', 'Level'], 1, tally._id]);
    assert.equal(back.activities[0].tallyId, back.tallies[0].id, 'a quick check still names its tally');
    assert.deepEqual(back.activities[1].groups, [{ label: 'Bench 3', gotIt: 'yes' }]);
    assert.deepEqual([back.insightActions[0].flagId, back.insightActions[0].action, back.insightActions[0].actedAt],
      ['focus:analyse', 'acted', '2026-11-19T04:50:00.000Z']);
    assert.equal(back.wheelRounds[0].startedAt, '2026-11-19T04:05:00.000Z');
  });

  test('a room with no records archives exactly as before; an older archive decodes with none', async () => {
    const repo = createMemoryRepo();
    const session = await repo.createSession({ code: 'ARC003', contentId: 'c', title: 'R', status: 'closed' });
    const { doc } = await buildRoomArchive(repo, session);
    for (const k of ['observations', 'wheelRounds', 'wheelPicks', 'tallies', 'activities', 'insightActions']) {
      assert.equal(k in doc.data, false, k);
      assert.equal(k in doc.data.counts, false, k);
    }
    const back = decodeRoomArchive(doc.data);
    assert.deepEqual([back.observations, back.wheelPicks, back.tallies, back.activities, back.insightActions, back.wheelRounds],
      [[], [], [], [], [], []]);
  });

  test('the records count towards the 1 MiB, and a busy term\'s class still fits with room to spare', async () => {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ courseName: 'N', section: 'A' });
    const roll = (i) => `21CS${String(i).padStart(3, '0')}`;
    const students = await repo.addClassStudents(cls._id, Array.from({ length: 120 }, (_, i) => ({ rollNo: roll(i), name: `Student Number ${i}` })));
    const session = await repo.createSession({ code: 'BIG001', contentId: 'c', status: 'closed', classId: cls._id, startedAt: '2026-11-19T04:00:00.000Z' });
    const before = (await buildRoomArchive(repo, session)).bytes;
    // Every student marked three times with a full note, 300 picks, 60 tallies,
    // 40 activities of 30 groups, 100 insight actions: far beyond one class.
    for (const st of students) {
      for (let k = 0; k < 3; k += 1) {
        await repo.addObservation({ sessionId: session._id, classId: cls._id, classStudentId: st._id, rollNo: st.rollNo, day: '2026-11-19',
          kind: 'revision', note: 'n'.repeat(280), observedBy: 'a0000000-0000-4000-8000-000000000002', observedAt: `2026-11-19T05:${String(k).padStart(2, '0')}:00.000Z` });
      }
    }
    for (let r = 1; r <= 3; r += 1) await repo.addWheelRound({ sessionId: session._id, round: r, presentOnly: true, noRepeat: true });
    for (let i = 0; i < 300; i += 1) {
      await repo.addWheelPick({ sessionId: session._id, round: 1 + Math.floor(i / 120), order: 1 + (i % 120), rollNo: students[i % 120].rollNo,
        classStudentId: students[i % 120]._id, poolSize: 120, presentOnly: true, noRepeat: true, status: 'answered', statusAt: '2026-11-19T06:00:00.000Z' });
    }
    for (let i = 1; i <= 60; i += 1) await repo.addTally({ sessionId: session._id, seq: i, text: 'q'.repeat(300), labels: ['a'.repeat(100), 'b', 'c', 'd'], counts: [10, 20, 30, 40] });
    for (let i = 1; i <= 40; i += 1) {
      await repo.addActivity({ sessionId: session._id, seq: i, kind: 'group', outcome: 'o'.repeat(280),
        groups: Array.from({ length: 30 }, (_, g) => ({ label: `Bench ${g}`, gotIt: 'partly' })) });
    }
    for (let i = 0; i < 100; i += 1) await repo.addInsightAction({ sessionId: session._id, flagId: `support:${roll(i)}`, action: 'acted', note: 'x'.repeat(280) });
    const { bytes, doc } = await buildRoomArchive(repo, session);
    assert.ok(bytes > before + 200_000, `the records are in the size: ${before} -> ${bytes}`);
    assert.equal(bytes, Buffer.byteLength(JSON.stringify(doc.data)), 'the size is of the whole document, records included');
    assert.ok(bytes < ARCHIVE_LIMIT_BYTES / 2, `${bytes} bytes`);
  });
});

// Not a database test: no Supabase is reachable from here. This pins the
// requests the Supabase repo sends for the teacher records.
describe('the Supabase repo\'s teacher-record requests', () => {
  test('columns as the migration names them, a taken place as 409, and no request for a malformed id', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const ROOM = '22222222-2222-4222-8222-222222222222';
    const STUDENT = '33333333-3333-4333-8333-333333333333';
    let nextReply = null;
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      seen.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
      const r = nextReply ?? { status: 201, body: {} };
      nextReply = null;
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      nextReply = { status: 201, body: { id: 'o1', session_id: ROOM, class_id: 'c', class_student_id: STUDENT, roll_no: '01', day: '2026-11-19',
        kind: 'understood', note: '', observed_by: null, observed_at: '2026-11-19T04:00:00+00:00' } };
      const o = await repo.addObservation({ sessionId: ROOM, classId: 'c', classStudentId: STUDENT, rollNo: '01', day: '2026-11-19', kind: 'understood' });
      assert.equal(seen[0].url.pathname, '/rest/v1/observations');
      assert.equal(seen[0].method, 'POST');
      assert.deepEqual(Object.keys(seen[0].body).sort(),
        ['class_id', 'class_student_id', 'day', 'kind', 'note', 'observed_at', 'observed_by', 'roll_no', 'session_id']);
      assert.deepEqual([o.day, o.kind, o.classStudentId], ['2026-11-19', 'understood', STUDENT]);

      nextReply = { status: 201, body: { id: 'p1', session_id: ROOM, round: 1, pick_order: 3, roll_no: '01', pool_size: '12', present_only: true,
        no_repeat: true, ask: 'bank', status: 'pending', picked_at: 'T' } };
      const p = await repo.addWheelPick({ sessionId: ROOM, round: 1, order: 3, rollNo: '01', poolSize: 12, presentOnly: true, noRepeat: true });
      assert.equal(seen[1].body.pick_order, 3);
      assert.deepEqual([p.order, p.poolSize], [3, 12]);

      nextReply = { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "wheel_picks_session_round_order_key"' } };
      await assert.rejects(repo.addWheelPick({ sessionId: ROOM, round: 1, order: 3, rollNo: '02', poolSize: 12, presentOnly: true, noRepeat: true }),
        (e) => e.status === 409);

      nextReply = { status: 200, body: { id: 't1', session_id: ROOM, seq: 1, question_text: 'Q', option_labels: ['a', '', '', ''],
        counts: [1, 0, 0, 0], revealed: false, correct_option: null } };
      const t = await repo.updateTally('44444444-4444-4444-8444-444444444444', { counts: [1, 0, 0, 0], revealed: false, text: 'Q' });
      assert.equal(seen[3].method, 'PATCH');
      assert.deepEqual(seen[3].body, { counts: [1, 0, 0, 0], revealed: false, question_text: 'Q' });
      assert.deepEqual(t.counts, [1, 0, 0, 0]);

      const before = seen.length;
      assert.deepEqual(await repo.listObservations({ sessionId: '0123456789abcdef01234567' }), []);
      assert.deepEqual(await repo.listWheelPicks('not-a-uuid'), []);
      assert.equal(await repo.updateWheelPick('nope', { status: 'answered' }), null);
      assert.equal(seen.length, before, 'no request for an id that cannot be a uuid');

      nextReply = { status: 200, body: [] };
      await repo.listObservations({ classStudentId: STUDENT, day: '2026-11-19' });
      const q = seen.at(-1).url.searchParams;
      assert.deepEqual([q.get('class_student_id'), q.get('day'), q.get('order')], [`eq.${STUDENT}`, 'eq.2026-11-19', 'observed_at.asc,id.asc']);
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });
});

describe('the Mongo schemas for teacher records', () => {
  test('kinds, statuses and counts are held to their lists, and nothing undeclared is kept', async () => {
    const { Observation, WheelPick, HandTally, RoomActivity, InsightAction } = await import('../src/models/index.js');
    assert.equal(new Observation({ sessionId: 's', rollNo: '01', day: '2026-11-19', kind: 'slow' }).validateSync()?.errors?.kind?.kind, 'enum');
    assert.equal(new Observation({ sessionId: 's', rollNo: '01', day: '2026-11-19', kind: null }).validateSync(), undefined, 'a clear is allowed');
    const obs = new Observation({ sessionId: 's', rollNo: '01', day: '2026-11-19', kind: 'understood', phone: '9845012345' }).toObject();
    assert.equal('phone' in obs, false);
    assert.equal(new WheelPick({ sessionId: 's', round: 1, order: 1, rollNo: '01', poolSize: 1, presentOnly: true, noRepeat: true, status: 'late' })
      .validateSync()?.errors?.status?.kind, 'enum');
    assert.ok(new HandTally({ sessionId: 's', seq: 1, text: 'Q', counts: [0, -1, 0, 0] }).validateSync()?.errors, 'a count below 0 is refused');
    assert.deepEqual(new HandTally({ sessionId: 's', seq: 1, text: 'Q' }).toObject().counts, [0, 0, 0, 0]);
    assert.equal(new RoomActivity({ sessionId: 's', seq: 1, kind: 'quiz' }).validateSync()?.errors?.kind?.kind, 'enum');
    assert.equal(new InsightAction({ sessionId: 's', flagId: 'f', action: 'snoozed' }).validateSync()?.errors?.action?.kind, 'enum');
  });
});
