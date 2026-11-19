// Phase 7 (decision O4): a room archive saved by laptop mode, imported into the
// cloud as a closed room the professor owns.
//
// Validation (a malformed file is refused with a sentence, and nothing is
// written), idempotency (the same room again changes nothing and says so), the
// refusals (another teacher's, another source's room id or code, a chapter or
// class that is not the caller's), what the room becomes (closed, owned, every
// answer, review, vote, class question and attendance mark kept), decision 8
// (no integrity signal of a student the roster marks under 18), and a store
// failure part way (nothing left behind, and a retry works).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { buildRoomArchive, decodeRoomArchive, fromTable } from '../src/services/archive.js';
import { ELSEWHERE, archiveDigest, importRoomArchive, isImportedRoom } from '../src/services/roomImport.js';
import { AFTER_CLOSE_DETAIL, keptNotCounted } from '../src/services/offline.js';

const PROF = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';
const prof = { id: PROF, role: 'professor' };
const other = { id: OTHER, role: 'professor' };
const keyTeacher = { id: null, role: 'professor' };

const T0 = Date.parse('2026-11-19T04:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const LAPTOP = { run: 'c0ffee12', startedAt: at(-600) };

const snap = (q) => {
  const { _id, contentId, createdAt, status, ...rest } = q;
  return { id: String(_id), ...rest };
};

/**
 * A class room run on a laptop: three roster students (two joined, one marked
 * absent by the professor), answers with a review, a class question with
 * votes, signals for one student. Returns the laptop's store and its archive as
 * the laptop saves it.
 */
async function laptopRoom({ status = 'closed', code = 'LPT234' } = {}) {
  const repo = createMemoryRepo();
  const content = await repo.createContent({ title: 'Cells', kind: 'syllabus', rawText: '', topics: ['Cells', 'Energy'] });
  const qs = await repo.insertQuestions([
    { contentId: content._id, topic: 'Cells', text: 'Which organelle releases energy?', kind: 'mcq', options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Vacuole'], answerIdx: 1, bloom: 'remember' },
    { contentId: content._id, topic: 'Energy', text: 'Explain why cells need ATP.', kind: 'open', bloom: 'understand', rubric: 'Energy currency' },
    { contentId: content._id, topic: 'Cells', text: 'Plant cells have walls.', kind: 'truefalse', answerBool: true, bloom: 'remember' },
  ]);
  const cls = await repo.createClass({ courseName: 'Biology', section: 'A', ownerId: null });
  const roster = await repo.addClassStudents(cls._id, [
    { rollNo: '23BIO01', name: 'Asha' }, { rollNo: '23BIO02', name: 'Ravi' }, { rollNo: '23BIO03', name: 'Meera' },
  ]);
  const session = await repo.createSession({
    code, contentId: content._id, title: 'Cells quiz', status, ownerId: null,
    masteryGoal: 0.8, reattempts: 0, redemption: false, classId: cls._id, startedAt: at(0),
    ...(status === 'closed' ? { closedAt: at(900) } : {}),
  });
  const sid = session._id;
  const give = (rollNo, q, key, extra) => repo.recordAnswer({
    sessionId: sid, answerKey: key, rollNo, accountId: null, questionId: q._id, contentId: content._id, topic: q.topic, bloom: q.bloom,
    kind: q.kind, questionSnapshot: snap(q), servedAt: at(10), ...extra,
  });
  const a1 = await give('23BIO01', qs[0], 'k1', { response: 1, correct: true, score: 1, autoCorrect: true, autoScore: 1, answeredAt: at(30), confidence: 'sure' });
  const a2 = await give('23BIO02', qs[0], 'k2', { response: 0, correct: false, score: 0, autoCorrect: false, autoScore: 0, answeredAt: at(35), detail: 'Not the expected answer' });
  const a3 = await give('23BIO01', qs[1], 'k3', {
    response: 'ATP carries energy', correct: true, score: 0.5, autoCorrect: true, autoScore: 0.5, reviewStatus: 'provisional', answeredAt: at(60),
  });
  await repo.addAnswerReview({ answerId: a3.answer._id, sessionId: sid, decision: 'override', correct: true, score: 1, note: 'Full marks', reviewedAt: at(400) });
  await repo.updateAnswer(a3.answer._id, { correct: true, score: 1, reviewStatus: 'overridden', reviewedAt: at(400), reviewNote: 'Full marks' });
  const cq = await repo.addClassQuestion({ sessionId: sid, seq: 1, questionId: qs[2]._id, questionSnapshot: snap(qs[2]), state: 'closed', revealed: true, startedAt: at(500), pausedAt: at(560), closedAt: at(620) });
  await give('23BIO01', qs[2], 'v1', { response: true, correct: true, score: 1, answeredAt: at(520), classQuestionId: cq._id, round: 1, final: true });
  await give('23BIO02', qs[2], 'v2', { response: false, correct: false, score: 0, answeredAt: at(525), classQuestionId: cq._id, round: 1, final: true });
  const history = (rollNo) => [{ questionId: String(qs[0]._id), bloom: 'remember', topic: 'Cells', kind: 'mcq', answerId: rollNo === '23BIO01' ? 'k1' : 'k2', correct: rollNo === '23BIO01', score: rollNo === '23BIO01' ? 1 : 0, at: rollNo === '23BIO01' ? at(30) : at(35) }];
  await repo.saveProfile({ sessionId: sid, rollNo: '23BIO01', name: 'Asha', workingLevel: 'understand', history: [...history('23BIO01'), { questionId: String(qs[1]._id), bloom: 'understand', topic: 'Energy', kind: 'open', answerId: 'k3', correct: true, score: 1, at: at(60) }], levels: {}, integrity: [] });
  await repo.saveProfile({ sessionId: sid, rollNo: '23BIO02', name: 'Ravi', workingLevel: 'remember', history: history('23BIO02'), levels: {}, integrity: [{ type: 'tab-hidden', at: at(40) }] });
  await repo.saveAttendance([
    { sessionId: sid, classStudentId: roster[0]._id, status: 'present', source: 'joined', rollNo: '23BIO01', markedAt: at(5) },
    { sessionId: sid, classStudentId: roster[1]._id, status: 'present', source: 'joined', rollNo: '23BIO02', markedAt: at(6) },
    { sessionId: sid, classStudentId: roster[2]._id, status: 'absent', source: 'teacher', rollNo: null, markedAt: at(300) },
  ]);
  await repo.addObservation({ sessionId: sid, classId: cls._id, classStudentId: roster[0]._id, rollNo: '23BIO01', day: '2026-11-19', kind: 'participated', observedAt: at(200) });
  const { doc } = await buildRoomArchive(repo, await repo.getSession(sid), { now: new Date(T0 + 1000 * 1000) });
  return { repo, session: await repo.getSession(sid), archive: { ...doc.data, laptop: LAPTOP } };
}

/** The cloud: a chapter and a class the professor owns, with two of the three students (Ravi under 18). */
async function cloud({ owner = PROF } = {}) {
  const repo = createMemoryRepo();
  const content = await repo.createContent({ title: 'Cells (cloud)', kind: 'syllabus', rawText: '', topics: ['Cells'], ownerId: owner });
  const cls = await repo.createClass({ courseName: 'Biology', section: 'A', ownerId: owner });
  const roster = await repo.addClassStudents(cls._id, [{ rollNo: '23BIO01', name: 'Asha' }, { rollNo: '23bio02', name: 'Ravi', under18: true }]);
  return { repo, content, cls, roster, target: { contentId: String(content._id), classId: String(cls._id) } };
}

const copy = (v) => JSON.parse(JSON.stringify(v));
async function storeCounts(repo) {
  const sessions = await repo.listSessions();
  const answers = await repo.listAnswers({});
  return { sessions: sessions.length, answers: answers.length, imports: (await repo.listRoomImports()).length };
}

/** Expect a refusal with this status and sentence, and the store unchanged. */
async function refused(repo, viewer, input, status, pattern) {
  const before = await storeCounts(repo);
  await assert.rejects(importRoomArchive(repo, viewer, input), (err) => {
    assert.equal(err.status, status, err.message);
    assert.match(err.message, pattern);
    return true;
  });
  assert.deepEqual(await storeCounts(repo), before, 'nothing was written');
}

/* ------------------------------------------------------------- the room -- */

describe('an import makes a closed room the professor owns', () => {
  test('every answer, review, vote, class question, profile and attendance mark, as on the laptop', async () => {
    const laptop = await laptopRoom();
    const { repo, target, roster } = await cloud();
    const out = await importRoomArchive(repo, prof, { archive: laptop.archive, ...target }, { now: new Date(T0 + 2000 * 1000) });
    assert.equal(out.status, 201);
    assert.equal(out.body.imported, true);
    assert.match(out.body.message, /^Room LPT234 was imported as a closed room: 5 answers from 2 students, 2 attendance marks\. /);
    // Never presented as checked for more than its shape (the review of 19 Nov 2026).
    assert.match(out.body.message, /It is shown as imported wherever it appears: BloomLoop checked that the file is a room it can read, not that it is unchanged since the laptop saved it\.$/);
    assert.equal(out.body.importedFrom?.sourceCode, 'LPT234');
    assert.match(out.body.importedFrom?.note ?? '', /not that it is unchanged since the laptop saved it/);
    assert.equal(await isImportedRoom(repo, out.body.room.sessionId), true);

    const room = await repo.getSession(out.body.room.sessionId);
    assert.equal(room.code, 'LPT234');
    assert.equal(room.status, 'closed');
    assert.equal(room.ownerId, PROF);
    assert.equal(room.contentId, target.contentId);
    assert.equal(room.classId, target.classId);
    assert.equal(room.startedAt, at(0));
    assert.equal(room.closedAt, at(900));

    // Answers: every field as recorded on the laptop, but for the ids of this store.
    const was = await laptop.repo.listAnswers({ sessionId: laptop.session._id });
    const now = await repo.listAnswers({ sessionId: room._id });
    const strip = ({ _id, sessionId, questionId, contentId, classQuestionId, ...rest }) => rest;
    assert.deepEqual(now.map(strip), was.map(strip));
    assert.ok(now.every((a) => a.questionId === null && a.contentId === target.contentId), 'laptop question ids are not this chapter\'s');
    assert.deepEqual(now.map((a) => a.questionSnapshot.id), was.map((a) => String(a.questionId)), 'the question as shown keeps its id');

    // The class question, closed, its votes pointing at its new id.
    const [cq] = await repo.listClassQuestions(room._id);
    assert.equal(cq.state, 'closed');
    assert.equal(cq.revealed, true);
    assert.equal(cq.seq, 1);
    assert.equal(cq.startedAt, at(500));
    assert.deepEqual(now.filter((a) => a.round === 1).map((a) => a.classQuestionId), [cq._id, cq._id]);

    // The review log, tied to its answer here.
    const [review] = await repo.listAnswerReviews({ sessionId: room._id });
    assert.equal(review.answerId, now.find((a) => a.answerKey === 'k3')._id);
    assert.deepEqual([review.decision, review.correct, review.score, review.note, review.reviewedAt], ['override', true, 1, 'Full marks', at(400)]);

    // Profiles, with their history; Ravi's signals gone (decision 8: under 18 on this roster).
    const profiles = await repo.listProfiles(room._id);
    assert.deepEqual(profiles.map((p) => [p.rollNo, p.name, p.workingLevel, p.history.length]),
      [['23BIO01', 'Asha', 'understand', 2], ['23BIO02', 'Ravi', 'remember', 1]]);
    assert.deepEqual(profiles.find((p) => p.rollNo === '23BIO02').integrity, []);

    // Attendance: tied to this roster by roll number; Meera is not on it, so her mark is listed and kept in the archive only.
    const marks = await repo.listAttendance(room._id);
    assert.deepEqual(marks.map((m) => [m.classStudentId, m.status, m.source, m.rollNo, m.markedAt]).sort(),
      [[roster[0]._id, 'present', 'joined', '23BIO01', at(5)], [roster[1]._id, 'present', 'joined', '23BIO02', at(6)]].sort());
    assert.deepEqual(out.body.import.summary.attendance, { imported: 2, notOnRoster: ['23BIO03'] });
    assert.ok(out.body.import.summary.sentences.some((s) => /23BIO03/.test(s)));
    assert.ok(out.body.import.summary.sentences.some((s) => /teacher records made on the laptop/.test(s)));

    // The import record: from which laptop run, when, the file kept (without Ravi's signals).
    const rec = await repo.getRoomImportBySource(laptop.session._id);
    assert.equal(rec.sessionId, room._id);
    assert.deepEqual(rec.source, LAPTOP);
    assert.equal(rec.importedAt, new Date(T0 + 2000 * 1000).toISOString());
    assert.equal(rec.importedBy, PROF);
    assert.equal(rec.ownerId, PROF);
    assert.equal(rec.sha256, archiveDigest(laptop.archive).sha256);
    assert.equal(rec.data, undefined, 'the list form carries no archive');
    const full = await repo.getRoomImport(rec._id);
    const kept = decodeRoomArchive(full.data);
    assert.deepEqual(kept.students.find((s) => s.rollNo === '23BIO02').integrity, []);
    assert.equal(kept.observations.length, 1, 'the laptop\'s teacher records are kept in the file');
    assert.equal(fromTable(full.data.attendance).length, 3, 'every mark, Meera\'s too');
    assert.deepEqual(out.body.import.laptop, LAPTOP);
    assert.equal('data' in out.body.import, false);
  });

  test('a room saved while it ran is closed as of the moment it was saved, and says so', async () => {
    const laptop = await laptopRoom({ status: 'open' });
    const { repo, target } = await cloud();
    const out = await importRoomArchive(repo, prof, { archive: laptop.archive, ...target });
    const room = await repo.getSession(out.body.room.sessionId);
    assert.equal(room.status, 'closed');
    assert.equal(room.closedAt, laptop.archive.archivedAt);
    assert.equal(out.body.import.summary.roomWasRunning, true);
    assert.ok(out.body.import.summary.sentences.some((s) => /still running/.test(s)));
  });

  test('the shared teacher key imports too, as an unowned room only the key reaches', async () => {
    const laptop = await laptopRoom();
    const { repo, target } = await cloud({ owner: null });
    const out = await importRoomArchive(repo, keyTeacher, { archive: laptop.archive, ...target });
    assert.equal(out.status, 201);
    assert.equal((await repo.getSession(out.body.room.sessionId)).ownerId, null);
    const again = await importRoomArchive(repo, prof, { archive: laptop.archive, ...target }).catch((e) => e);
    assert.equal(again.status, 409, 'a signed-in professor cannot read it, so it is "from somewhere else" to them');
    assert.equal(again.message, ELSEWHERE);
  });
});

/* ------------------------------------- packs and the grace window (merge) -- */

describe('answers that waited on a phone (question packs and the grace window)', () => {
  /** The laptop room, plus two answers that reached the laptop after its close at 900 s, and its archive again. */
  async function lateRoom() {
    const laptop = await laptopRoom();
    const sid = laptop.session._id;
    const [q] = await laptop.repo.listQuestions(laptop.session.contentId);
    const late = (key, extra) => laptop.repo.recordAnswer({
      sessionId: sid, answerKey: key, rollNo: '23BIO02', accountId: null, questionId: q._id, contentId: laptop.session.contentId,
      topic: q.topic, bloom: q.bloom, kind: q.kind, questionSnapshot: snap(q), servedAt: at(100), ...extra,
    });
    // Packed before the close and arriving inside the window: marked and counted.
    await late('late-counted', {
      response: 1, correct: true, score: 1, autoCorrect: true, autoScore: 1, answeredAt: at(905), deviceAnsweredAt: at(850),
    });
    // Never given to this phone before the close: kept, not counted.
    await late('late-kept', {
      response: 0, final: false, correct: null, score: null, autoCorrect: false, autoScore: 0, detail: AFTER_CLOSE_DETAIL,
      answeredAt: at(910), deviceAnsweredAt: at(860),
    });
    const { doc } = await buildRoomArchive(laptop.repo, await laptop.repo.getSession(sid), { now: new Date(T0 + 1000 * 1000) });
    return { ...laptop, archive: { ...doc.data, laptop: LAPTOP } };
  }

  test('keep the phone\'s own time, and one the laptop kept and did not count stays kept and not counted', async () => {
    const laptop = await lateRoom();
    const { repo, target } = await cloud();
    const out = await importRoomArchive(repo, prof, { archive: laptop.archive, ...target });
    assert.equal(out.status, 201);
    const rows = await repo.listAnswers({ sessionId: out.body.room.sessionId });
    const counted = rows.find((a) => a.answerKey === 'late-counted');
    const kept = rows.find((a) => a.answerKey === 'late-kept');
    assert.equal(counted.deviceAnsweredAt, at(850), 'the phone\'s time, as the laptop kept it');
    assert.equal(counted.answeredAt, at(905), 'and the laptop\'s own arrival time, which is the one that counts');
    assert.equal(keptNotCounted(counted), false);
    assert.equal(kept.deviceAnsweredAt, at(860));
    assert.deepEqual([kept.final, kept.correct, kept.score, kept.detail], [false, null, null, AFTER_CLOSE_DETAIL]);
    assert.equal(keptNotCounted(kept), true, 'every report leaves it out here as on the laptop');
    assert.ok(rows.filter((a) => !a.answerKey.startsWith('late-')).every((a) => a.deviceAnsweredAt === null),
      'an answer that never waited on a phone has no phone time');
    // Every field as the laptop recorded it, but for the ids of this store.
    const was = await laptop.repo.listAnswers({ sessionId: laptop.session._id });
    const strip = ({ _id, sessionId, questionId, contentId, classQuestionId, ...rest }) => rest;
    assert.deepEqual(rows.map(strip), was.map(strip));
  });

  test('a phone time that is not a time is refused with a sentence, and nothing written', async () => {
    const { archive } = await lateRoom();
    const { repo, target } = await cloud();
    const bad = copy(archive);
    const col = bad.answers.cols.indexOf('deviceAnsweredAt');
    assert.ok(col >= 0, 'the archive carries the phone\'s time');
    bad.answers.rows.find((r) => r[col] !== null && r[col] !== undefined)[col] = 'soon';
    await refused(repo, prof, { archive: bad, ...target }, 400, /times are not times\. Nothing was imported\.$/);
  });

  test('the live loop can tell an imported room from any other, so none takes deliveries', async () => {
    const laptop = await laptopRoom();
    const { repo, target, content } = await cloud();
    const plain = await repo.createSession({
      code: 'CLD001', contentId: content._id, status: 'closed', ownerId: PROF, masteryGoal: 0.8, reattempts: 0, redemption: false,
      closedAt: at(900),
    });
    const out = await importRoomArchive(repo, prof, { archive: laptop.archive, ...target });
    assert.equal(await isImportedRoom(repo, out.body.room.sessionId), true);
    assert.equal(await isImportedRoom(repo, plain._id), false);
    assert.equal(await isImportedRoom(repo, null), false);
    // Deleted since: its record names no room, and nothing is that room any more.
    await repo.deleteSession(out.body.room.sessionId);
    assert.equal(await isImportedRoom(repo, out.body.room.sessionId), false);
  });
});

/* ------------------------------------------------------------ idempotent -- */

describe('idempotent by the laptop\'s room id', () => {
  test('the same file again changes nothing, and says so', async () => {
    const laptop = await laptopRoom();
    const { repo, target } = await cloud();
    const first = await importRoomArchive(repo, prof, { archive: laptop.archive, ...target });
    const before = await storeCounts(repo);
    const second = await importRoomArchive(repo, prof, { archive: copy(laptop.archive), ...target });
    assert.equal(second.status, 200);
    assert.equal(second.body.imported, false);
    assert.equal(second.body.alreadyImported, true);
    assert.equal(second.body.same, true);
    assert.equal(second.body.import.room.sessionId, first.body.room.sessionId);
    assert.match(second.body.message, /^Room LPT234 was imported on \d{4}-\d\d-\d\d, so nothing was changed\.$/);
    assert.deepEqual(await storeCounts(repo), before);
  });

  test('a later save of the same room is not merged in: nothing changes, and the reply says the file differs', async () => {
    const laptop = await laptopRoom();
    const { repo, target } = await cloud();
    await importRoomArchive(repo, prof, { archive: laptop.archive, ...target });
    const answersBefore = copy(await repo.listAnswers({}));
    const later = copy(laptop.archive);
    later.archivedAt = at(5000);
    later.answers.rows.push([...later.answers.rows[0]].map((v, i) => (later.answers.cols[i] === 'answerKey' ? 'k-late' : v)));
    later.counts.answers += 1;
    const out = await importRoomArchive(repo, prof, { archive: later, ...target });
    assert.equal(out.status, 200);
    assert.equal(out.body.same, false);
    assert.match(out.body.message, /not the one imported then/);
    assert.deepEqual(await repo.listAnswers({}), answersBefore);
  });

  test('without a chapter, an already imported room still answers "already imported", not "choose a chapter"', async () => {
    const laptop = await laptopRoom();
    const { repo, target } = await cloud();
    await importRoomArchive(repo, prof, { archive: laptop.archive, ...target });
    const out = await importRoomArchive(repo, prof, { archive: laptop.archive });
    assert.equal(out.body.alreadyImported, true);
  });

  test('two imports of one room at once make one room', async () => {
    const laptop = await laptopRoom();
    const { repo, target } = await cloud();
    const queue = new Map();
    const lock = async (key) => {
      const before = queue.get(key) ?? Promise.resolve();
      let release;
      const mine = new Promise((r) => { release = r; });
      queue.set(key, before.then(() => mine));
      await before;
      return release;
    };
    const results = await Promise.all([1, 2].map(() => importRoomArchive(repo, prof, { archive: copy(laptop.archive), ...target }, { lock })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
    assert.equal((await repo.listSessions()).length, 1);
  });

  test('a store that refuses the second record (another process won) is "from somewhere else", and leaves no room behind', async () => {
    const laptop = await laptopRoom();
    const { repo, target } = await cloud();
    const real = repo.importRoom.bind(repo);
    repo.importRoom = async () => { throw Object.assign(new Error('That room was already imported.'), { code: 'IMPORT_EXISTS' }); };
    await assert.rejects(importRoomArchive(repo, prof, { archive: laptop.archive, ...target }), (err) => err.status === 409 && err.message === ELSEWHERE);
    repo.importRoom = real;
    assert.equal((await repo.listSessions()).length, 0);
  });
});

/* -------------------------------------------------------------- refusals -- */

describe('refused with a sentence, and nothing written', () => {
  test('anything that is not a room archive from laptop mode', async () => {
    const { archive } = await laptopRoom();
    const { repo, target } = await cloud();
    const bad = (mutate) => { const a = copy(archive); mutate(a); return a; };
    await refused(repo, prof, { archive: 'a string', ...target }, 400, /not a room archive BloomLoop can import: it is not a JSON object\. Nothing was imported\.$/);
    await refused(repo, prof, { archive: [], ...target }, 400, /not a JSON object/);
    await refused(repo, prof, { archive: bad((a) => { a.format = 'other'; }), ...target }, 400, /not a BloomLoop room archive/);
    await refused(repo, prof, { archive: bad((a) => { a.version = 2; }), ...target }, 400, /version 2, and this server reads version 1/);
    // The sentence says what the mark is, and claims nothing it cannot check.
    await refused(repo, prof, { archive: bad((a) => { delete a.laptop; }), ...target }, 400,
      /^This file does not carry the mark laptop mode puts on the rooms it saves, so it is not one to import here\. The mark says where a file came from, not that it is unchanged, so every imported room is shown as imported\. Nothing was imported\.$/);
    await refused(repo, prof, { archive: bad((a) => { a.laptop.run = 'MACHINE-NAME'; }), ...target }, 400, /laptop mode/);
    await refused(repo, prof, { archive: bad((a) => { a.room.code = 'ab/..'; }), ...target }, 400, /its room has no code/);
    await refused(repo, prof, { archive: bad((a) => { a.room.id = '../x'; }), ...target }, 400, /its room has no id/);
    await refused(repo, prof, { archive: bad((a) => { a.room.status = 'exploded'; }), ...target }, 400, /no status/);
    await refused(repo, prof, { archive: bad((a) => { a.room.settings.masteryGoal = 0.1; }), ...target }, 400, /setting "masteryGoal"/);
    await refused(repo, prof, { archive: bad((a) => { a.timeBase = 'yesterday'; }), ...target }, 400, /times are not times/);
    await refused(repo, prof, { archive: bad((a) => { a.counts.answers += 1; }), ...target }, 400, /does not hold the rows its counts say/);
    await refused(repo, prof, { archive: bad((a) => { a.answers.rows[0].pop(); }), ...target }, 400, /row 1 of its answers list does not match its columns/);
    await refused(repo, prof, { archive: bad((a) => { a.answers.rows[0][a.answers.cols.indexOf('q')] = 99; }), ...target }, 400, /points at no question/);
    await refused(repo, prof, { archive: bad((a) => { a.reviews.rows[0][a.reviews.cols.indexOf('a')] = 42; }), ...target }, 400, /points at no answer/);
    await refused(repo, prof, { archive: bad((a) => { a.derived.answers.push('response'); }), ...target }, 400, /derives a column/);
    await refused(repo, prof, { archive: bad((a) => {
      const k = a.answers.cols.indexOf('answerKey'); a.answers.rows[1][k] = a.answers.rows[0][k];
    }), ...target }, 400, /two answers share the key k1/);
    await refused(repo, prof, { archive: bad((a) => { a.answers.rows[0][a.answers.cols.indexOf('score')] = 7; }), ...target }, 400, /score is not from 0 to 1/);
    await refused(repo, prof, { archive: bad((a) => { a.answers.rows[0][a.answers.cols.indexOf('confidence')] = 'very'; }), ...target }, 400, /confidence tap/);
    await refused(repo, prof, { archive: bad((a) => {
      const r = a.answers.cols.indexOf('round'); a.answers.rows[3][r] = null;
    }), ...target }, 400, /class question without a round/);
    await refused(repo, prof, { archive: bad((a) => { a.attendance.rows[0][a.attendance.cols.indexOf('status')] = 'absent'; }), ...target }, 400, /says a join marked a student absent/);
  });

  test('an archive over the 1 MB an archive may be is a 413 with a sentence', async () => {
    const { archive } = await laptopRoom();
    const { repo, target } = await cloud();
    const big = copy(archive);
    big.questions[0].text = 'x'.repeat(1024 * 1024);
    await refused(repo, prof, { archive: big, ...target }, 413, /^This archive is 1\.\d\d MB, over the 1 MB a room archive may be\. Nothing was imported\.$/);
  });

  test('another teacher\'s room, or a room id or code already here from another source', async () => {
    const { archive } = await laptopRoom();
    const { repo, target, content } = await cloud();
    const owned = copy(archive);
    owned.room.ownerId = OTHER;
    await refused(repo, prof, { archive: owned, ...target }, 403, /another teacher owns/);

    // A live room here with the same code, and no way to draw a code: refused.
    const live = await repo.createSession({ code: 'LPT234', contentId: content._id, ownerId: PROF });
    await refused(repo, prof, { archive, ...target }, 409, /^A room with this archive's id or code is already in BloomLoop from somewhere else/);
    await repo.deleteSession(live._id);

    // A room here whose id is the archive's (a cloud room's file passed off as a laptop's).
    const sameId = copy(archive);
    sameId.room.code = 'OTH234';
    const here = await repo.createSession({ code: 'HER234', contentId: content._id, ownerId: PROF });
    sameId.room.id = String(here._id);
    await refused(repo, prof, { archive: sameId, ...target }, 409, /from somewhere else/);

    // A deleted room's archive here with that id.
    const { doc } = await buildRoomArchive(repo, here);
    await repo.saveRoomArchive(doc);
    await repo.deleteSession(here._id);
    await refused(repo, prof, { archive: sameId, ...target }, 409, /from somewhere else/);
  });

  test('a code already taken here is no refusal: the room gets a fresh code, the import keeps the laptop\'s', async () => {
    // Someone read LPT234 off the wall and imported a file of their own under it
    // first (any room holding the code will do): the real room still imports.
    const { archive } = await laptopRoom();
    const { repo, target, content } = await cloud();
    const squatter = await repo.createSession({ code: 'LPT234', contentId: content._id, ownerId: OTHER, status: 'closed' });
    const out = await importRoomArchive(repo, prof, { archive, ...target }, { drawCode: async () => 'NEW234' });
    assert.equal(out.status, 201);
    assert.equal(out.body.room.code, 'NEW234');
    assert.match(out.body.message, /^Room LPT234 was imported as a closed room with the code NEW234, since LPT234 is another room's here: /);
    assert.equal(out.body.import.room.code, 'LPT234', 'the import record keeps the laptop\'s code');
    assert.equal((await repo.getSession(out.body.room.sessionId)).code, 'NEW234');
    assert.equal(String((await repo.getSessionByCode('LPT234'))._id), String(squatter._id), 'the other room is untouched');
    // The same file again is "imported already", by the room's id, whatever its code.
    const again = await importRoomArchive(repo, prof, { archive, ...target }, { drawCode: async () => 'XXX234' });
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyImported, true);
  });

  test('a room another professor imported is "from somewhere else", never "already imported"', async () => {
    const { archive } = await laptopRoom();
    const { repo, target } = await cloud();
    await importRoomArchive(repo, prof, { archive, ...target });
    const content2 = await repo.createContent({ title: 'Theirs', kind: 'syllabus', rawText: '', topics: [], ownerId: OTHER });
    await refused(repo, other, { archive, contentId: String(content2._id) }, 409, /from somewhere else/);
  });

  test('the chapter and the class must be the caller\'s: one 404 for "not yours" and "not there"', async () => {
    const { archive } = await laptopRoom();
    const { repo, target } = await cloud();
    await refused(repo, prof, { archive, classId: target.classId }, 400, /Choose the chapter in your account/);
    const theirs = await repo.createContent({ title: 'Theirs', kind: 'syllabus', rawText: '', topics: [], ownerId: OTHER });
    const notYours = await importRoomArchive(repo, prof, { archive, contentId: String(theirs._id), classId: target.classId }).catch((e) => e);
    const notThere = await importRoomArchive(repo, prof, { archive, contentId: 'ffffffffffffffffffffffff', classId: target.classId }).catch((e) => e);
    assert.deepEqual([notYours.status, notYours.message], [404, 'That chapter was not found.']);
    assert.deepEqual([notThere.status, notThere.message], [404, 'That chapter was not found.']);

    await refused(repo, prof, { archive, contentId: target.contentId }, 400, /Choose the class in your account/);
    const theirClass = await repo.createClass({ courseName: 'Theirs', section: 'B', ownerId: OTHER });
    const classNotYours = await importRoomArchive(repo, prof, { archive, ...target, classId: String(theirClass._id) }).catch((e) => e);
    const classNotThere = await importRoomArchive(repo, prof, { archive, ...target, classId: 'not-an-id' }).catch((e) => e);
    assert.deepEqual([classNotYours.status, classNotYours.message], [404, 'That class was not found.']);
    assert.deepEqual([classNotThere.status, classNotThere.message], [404, 'That class was not found.']);
    assert.equal((await repo.listSessions()).length, 0);
  });
});

/* --------------------------------------------------------- store failure -- */

describe('a store failure part way', () => {
  test('leaves no room behind, and the same file imports cleanly afterwards', async () => {
    const { archive } = await laptopRoom();
    const { repo, target } = await cloud();
    const real = repo.saveAttendance;
    repo.saveAttendance = async () => { throw new Error('disk on fire'); };
    await assert.rejects(importRoomArchive(repo, prof, { archive, ...target }), /disk on fire/);
    assert.deepEqual(await storeCounts(repo), { sessions: 0, answers: 0, imports: 0 });
    assert.deepEqual(await repo.listClassQuestions('anything'), []);
    repo.saveAttendance = real;
    const out = await importRoomArchive(repo, prof, { archive, ...target });
    assert.equal(out.status, 201);
    assert.equal((await repo.listAnswers({})).length, 5);
  });
});
