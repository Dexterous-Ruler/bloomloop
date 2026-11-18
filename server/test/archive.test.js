// The room archive: a deleted room kept as one JSON document under 1 MB.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_LIMIT_BYTES,
  buildRoomArchive,
  decodeRoomArchive,
  fromTable,
  toTable,
} from '../src/services/archive.js';

const LEVELS = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'];

/** A room far bigger than a real class: 80 students, 60 attempts each. */
async function bigRoom(repo, { students = 80, perStudent = 60 } = {}) {
  const content = await repo.createContent({ title: 'Archive fixture', kind: 'syllabus', rawText: '', topics: ['Cells'] });
  const qs = await repo.insertQuestions(Array.from({ length: 40 }, (_, i) => ({
    contentId: content._id,
    topic: `Topic ${i % 5}`,
    bloom: LEVELS[i % 6],
    kind: i % 3 === 0 ? 'open' : 'mcq',
    text: `Question ${i}: explain the role of the mitochondrion in cellular respiration, step ${i}.`,
    options: i % 3 === 0 ? undefined : ['Alpha option text', 'Beta option text', 'Gamma option text', 'Delta option text'],
    answerIdx: i % 3 === 0 ? undefined : i % 4,
  })));
  const start = Date.parse('2026-11-18T09:00:00.000Z');
  const session = await repo.createSession({
    code: 'ARCH01', contentId: content._id, title: 'Archive fixture', status: 'closed', ownerId: null,
    masteryGoal: 0.9, reattempts: 1, redemption: true,
  });
  session.startedAt = new Date(start).toISOString();
  await repo.updateSession(session._id, { startedAt: session.startedAt });

  for (let s = 0; s < students; s += 1) {
    const rollNo = `23CS${String(s).padStart(3, '0')}`;
    const history = [];
    for (let a = 0; a < perStudent; a += 1) {
      const q = qs[(s + a) % qs.length];
      const { _id, contentId, createdAt, status, ...rest } = q;
      const at = new Date(start + (s * perStudent + a) * 1000).toISOString();
      const correct = (s + a) % 3 !== 0;
      const answerKey = `a${s}-${a}-0000000`;
      await repo.recordAnswer({
        sessionId: session._id, answerKey, rollNo, questionId: q._id, contentId,
        topic: q.topic, bloom: q.bloom, kind: q.kind, questionSnapshot: { id: String(_id), ...rest },
        response: q.kind === 'open'
          ? 'The mitochondrion releases energy from glucose through respiration, producing ATP for the cell.'
          : (q.answerIdx + (correct ? 0 : 1)) % 4,
        correct, score: correct ? 1 : 0, detail: correct ? '' : 'Not the expected answer',
        reviewStatus: q.kind === 'open' ? 'provisional' : 'auto', autoCorrect: correct, autoScore: correct ? 1 : 0,
        servedAt: at, answeredAt: at,
      });
      history.push({ questionId: String(q._id), bloom: q.bloom, topic: q.topic, kind: q.kind, answerId: answerKey, correct, score: correct ? 1 : 0, at });
    }
    await repo.saveProfile({
      sessionId: session._id, rollNo, name: `Student ${s}`, accountId: null,
      levels: { understand: { seen: 3, correct: 2 } }, workingLevel: 'apply', reason: 'Two of three right.',
      history, served: null, integrity: [],
    });
  }
  return session;
}

test('toTable drops columns nobody has a value for, and fromTable restores the rest', () => {
  const rows = [{ a: 1, b: '', c: null }, { a: 2, b: '', c: 'x' }];
  const t = toTable(rows);
  assert.deepEqual(t.cols, ['a', 'c']);
  assert.deepEqual(fromTable(t), [{ a: 1, c: null }, { a: 2, c: 'x' }]);
});

test('a room far bigger than a class archives under 1 MB, with every answer in it', async () => {
  const repo = createMemoryRepo();
  const session = await bigRoom(repo);
  const answers = await repo.listAnswers({ sessionId: session._id, limit: 100000 });
  assert.equal(answers.length, 4800, 'fixture has more answers than one page');

  const { bytes, json, doc } = await buildRoomArchive(repo, await repo.getSessionByCode('ARCH01'), { archivedBy: null });
  assert.ok(bytes < ARCHIVE_LIMIT_BYTES, `archive is ${bytes} bytes`);
  assert.equal(Buffer.byteLength(json), bytes);
  assert.equal(doc.data.format, ARCHIVE_FORMAT);
  assert.equal(doc.data.counts.answers, 4800);
  assert.equal(doc.data.counts.students, 80);

  const back = decodeRoomArchive(JSON.parse(json));
  assert.equal(back.answers.length, 4800);
  // Field for field, apart from what the archive deliberately does not repeat
  // (row id, session id, account id and content id).
  const strip = ({ _id, sessionId, accountId, contentId, ...rest }) => rest;
  const blankless = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  for (let i = 0; i < answers.length; i += 1) {
    assert.deepEqual(blankless(back.answers[i]), blankless(strip(answers[i])), `answer ${i}`);
  }
  const profiles = await repo.listProfiles(session._id);
  for (const p of profiles) {
    const s = back.students.find((x) => x.rollNo === p.rollNo);
    assert.deepEqual(s.history, p.history, `history of ${p.rollNo}`);
    assert.equal(s.workingLevel, p.workingLevel);
    assert.deepEqual(s.levels, p.levels);
  }
  assert.deepEqual(back.room.settings, { masteryGoal: 0.9, reattempts: 1, redemption: true });
});

test('a room from before the evidence store keeps its questions from the bank', async () => {
  const repo = createMemoryRepo();
  const content = await repo.createContent({ title: 'Old', kind: 'syllabus', rawText: '', topics: ['T'] });
  const [q] = await repo.insertQuestions([{ contentId: content._id, topic: 'T', bloom: 'remember', kind: 'mcq', text: 'Old question', options: ['a', 'b'], answerIdx: 1 }]);
  const session = await repo.createSession({ code: 'OLD001', contentId: content._id, title: 'Old', status: 'closed' });
  await repo.saveProfile({
    sessionId: session._id, rollNo: '7', name: 'Seven', levels: {}, workingLevel: 'remember', reason: '',
    history: [{ questionId: String(q._id), bloom: 'remember', correct: true, at: '2026-01-01T10:00:00.000Z' }],
    served: null, integrity: [],
  });
  const { doc } = await buildRoomArchive(repo, session);
  assert.equal(doc.data.questions.length, 1);
  assert.equal(doc.data.questions[0].text, 'Old question');
  const back = decodeRoomArchive(doc.data);
  assert.equal(back.students[0].history[0].at, '2026-01-01T10:00:00.000Z');
});

test('a room\'s review log is archived with it, each decision against its answer', async () => {
  const repo = createMemoryRepo();
  const content = await repo.createContent({ title: 'Written', kind: 'syllabus', rawText: '', topics: ['T'] });
  const [q] = await repo.insertQuestions([{
    contentId: content._id, topic: 'T', bloom: 'create', kind: 'open', text: 'Explain osmosis.', rubric: ['water moves', 'across membrane'],
  }]);
  const session = await repo.createSession({ code: 'REV001', contentId: content._id, title: 'Written', status: 'closed' });
  const answer = async (answerKey, rollNo) => (await repo.recordAnswer({
    sessionId: session._id, answerKey, rollNo, questionId: q._id, topic: 'T', bloom: 'create', kind: 'open',
    questionSnapshot: { id: String(q._id), text: q.text, rubric: q.rubric }, response: 'Water moves.',
    correct: false, score: 0.5, autoCorrect: false, autoScore: 0.5, autoDetail: '1/2 rubric points', reviewStatus: 'provisional',
  })).answer;
  const a1 = await answer('key-0001', '01');
  const a2 = await answer('key-0002', '02');
  const review = (a, decision, correct, score, note, reviewedAt) => repo.addAnswerReview({
    answerId: a._id, sessionId: session._id, decision, correct, score, note, reviewedBy: null, reviewedAt,
  });
  await review(a1, 'confirm', false, 0.5, '', '2026-11-18T10:00:00.000Z');
  await review(a1, 'override', true, 0.9, 'Both points', '2026-11-18T10:05:00.000Z');
  await review(a2, 'override', true, 1, '', '2026-11-18T10:06:00.000Z');

  const { doc, json } = await buildRoomArchive(repo, session);
  assert.equal(doc.data.counts.reviews, 3);
  const back = decodeRoomArchive(JSON.parse(json));
  assert.deepEqual(
    back.reviews.map((r) => [r.answerKey, r.decision, r.correct, r.score, r.note ?? '', r.reviewedAt]),
    [
      ['key-0001', 'confirm', false, 0.5, '', '2026-11-18T10:00:00.000Z'],
      ['key-0001', 'override', true, 0.9, 'Both points', '2026-11-18T10:05:00.000Z'],
      ['key-0002', 'override', true, 1, '', '2026-11-18T10:06:00.000Z'],
    ],
  );

  // An archive written before reviews existed decodes with none.
  const { reviews, ...older } = doc.data;
  assert.deepEqual(decodeRoomArchive(older).reviews, []);

  // The live log goes with the room, which is why it is archived first.
  await repo.deleteSession(session._id);
  assert.equal((await repo.listAnswerReviews({ sessionId: session._id })).length, 0);
});

// The live loop records on each answer which options a fewer-choices student was
// left with (`shownOptions`, different per student). Kept inside the question,
// it made the archive store one copy of the question per such student.
test('a question answered by fewer-choices students is stored once, and each answer gets its own shown list back', async () => {
  const repo = createMemoryRepo();
  const content = await repo.createContent({ title: 'Choices', kind: 'syllabus', rawText: '', topics: ['T'] });
  const [q] = await repo.insertQuestions([{
    contentId: content._id, topic: 'T', bloom: 'remember', kind: 'mcq', text: 'Which layer carries segments?',
    options: ['Network', 'Transport', 'Link', 'Physical'], answerIdx: 1,
  }]);
  const session = await repo.createSession({ code: 'FEW001', contentId: content._id, title: 'Choices', status: 'closed' });
  const snap = { id: String(q._id), topic: 'T', text: q.text, kind: 'mcq', bloom: 'remember', options: q.options, answerIdx: 1 };
  const shown = [[1, 3], [0, 1], null, [1, 2]];
  for (const [i, keep] of shown.entries()) {
    await repo.recordAnswer({
      sessionId: session._id, answerKey: `few-000${i}`, rollNo: `0${i}`, questionId: q._id, topic: 'T', bloom: 'remember', kind: 'mcq',
      questionSnapshot: keep ? { ...snap, shownOptions: keep } : snap, response: 0, correct: false, score: 0,
    });
  }

  const { doc, json } = await buildRoomArchive(repo, session);
  assert.equal(doc.data.questions.length, 1, 'one question, however many shorter lists it was shown as');
  assert.equal('shownOptions' in doc.data.questions[0], false);
  const back = decodeRoomArchive(JSON.parse(json));
  // By key: four answers stored in one millisecond come back in either order.
  const byKey = Object.fromEntries(back.answers.map((a) => [a.answerKey, a.questionSnapshot]));
  assert.deepEqual(shown.map((_, i) => byKey[`few-000${i}`].shownOptions), [[1, 3], [0, 1], undefined, [1, 2]]);
  assert.deepEqual(Object.values(byKey).map(({ shownOptions, ...rest }) => rest), shown.map(() => snap));
});

test('saving twice for one room keeps one archive', async () => {
  const repo = createMemoryRepo();
  const meta = { sessionId: 'abc', code: 'ROOM01', title: 'R', ownerId: null, archivedBy: null, archivedAt: '2026-11-18T10:00:00.000Z' };
  await repo.saveRoomArchive({ ...meta, bytes: 10, data: { n: 1 } });
  const second = await repo.saveRoomArchive({ ...meta, bytes: 12, data: { n: 2 } });
  const list = await repo.listRoomArchives();
  assert.equal(list.length, 1);
  assert.equal(list[0].data, undefined, 'the list carries no data');
  assert.deepEqual((await repo.getRoomArchive(second._id)).data, { n: 2 });
});
