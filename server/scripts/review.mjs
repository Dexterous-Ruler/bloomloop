// Phase 1 - the professor review queue for written answers.
//
//   node server/scripts/review.mjs
//
// Drives a REAL server on the in-process store (the same createApp and
// attachSockets the production server uses, on a random port) and checks:
//
//   queue       a written answer is listed with everything needed to judge it
//   access      the shared key cannot read or review a signed-in professor's room
//   evidence    confirm then override: the response and auto_* never change,
//               and every decision is a row in the log
//   numbers     the history entry and level tally follow the human mark, the
//               grid and the CSV agree, and the teacher's live grid is pushed
//   idempotent  the same decision twice writes nothing the second time
//   input       bad decisions, marks, notes and paging are refused
//   closed      a closed room can still be reviewed
//   keys        two students sending the same answer with no key, or with the
//               same key, are two rows, each reviewable on its own
//   resend      an entry rebuilt from a reviewed row keeps the review
//   delete      a review cannot slip between a room's archive and its delete
//   paging      walking the queue by its cursor while reviewing skips nothing
//
// Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { decodeRoomArchive } = await import(`${SRC}services/archive.js`);

// Force the in-process store whatever .env says: this suite must not touch a
// real database, and must not depend on one being reachable.
config.supabase.url = '';
config.supabase.serviceKey = '';
config.mongoUri = '';
await initStore({ log: () => {} });
const repo = getRepo();

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
attachSockets(io);
app.set('io', io);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const KEY = { 'x-teacher-key': config.teacherKey };

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

// ------------------------------------------------------------- plumbing --

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });
}

function next(socket, event, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, on); reject(new Error(`timeout waiting for ${event}`)); }, ms);
    const on = (p) => { clearTimeout(timer); resolve(p); };
    socket.once(event, on);
  });
}

/** The first `event` whose payload passes `test`. */
function until(socket, event, test, ms = 4000) {
  return new Promise((resolve, reject) => {
    const on = (p) => { if (test(p)) { clearTimeout(timer); socket.off(event, on); resolve(p); } };
    const timer = setTimeout(() => { socket.off(event, on); reject(new Error(`timeout waiting for ${event}`)); }, ms);
    socket.on(event, on);
  });
}

function either(socket, events, ms = 4000) {
  return new Promise((resolve, reject) => {
    const handlers = {};
    const done = (name, p) => {
      clearTimeout(timer);
      for (const [e, h] of Object.entries(handlers)) socket.off(e, h);
      resolve({ name, payload: p });
    };
    for (const e of events) { handlers[e] = (p) => done(e, p); socket.on(e, handlers[e]); }
    const timer = setTimeout(() => {
      for (const [e, h] of Object.entries(handlers)) socket.off(e, h);
      reject(new Error(`timeout waiting for ${events.join(' / ')}`));
    }, ms);
  });
}

async function get(path, headers = KEY) {
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(answerId, body, headers = KEY) {
  const res = await fetch(`${base}/api/review/${answerId}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ------------------------------------------------------------ fixtures --

const RUBRIC = ['photosynthesis converts light', 'chlorophyll absorbs energy'];
// Makes the first rubric point and misses the second: 1/2, under the 70% pass mark.
const PARTIAL = 'photosynthesis converts light into sugar.';
const FULL = 'photosynthesis converts light; chlorophyll absorbs energy.';

/** A room whose bank is written questions only, so every question served is one. */
async function makeRoom({ ownerId = null } = {}) {
  const content = await repo.createContent({ title: 'Review fixture', kind: 'syllabus', rawText: '', topics: ['Plants'], ownerId });
  const questions = await repo.insertQuestions(Array.from({ length: 6 }, (_, i) => ({
    contentId: content._id, text: `Explain idea ${i} about plants in your own words.`, kind: 'open',
    rubric: RUBRIC, bloom: 'create', topic: 'Plants', source: 'llm',
  })));
  const code = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z]/g, 'X').padEnd(6, 'X');
  const session = await repo.createSession({
    code, contentId: content._id, title: 'Written answers', status: 'open', ownerId,
    masteryGoal: 0.8, reattempts: 0, redemption: false,
  });
  return { session, questions };
}

async function joinRoom(code, rollNo, name) {
  const s = await connect();
  const accepted = next(s, 'session:accepted');
  const first = next(s, 'server:question');
  s.emit('student:join', { code, rollNo, name });
  return { s, accepted: await accepted, first: await first };
}

const answer = (s, payload) => {
  const result = either(s, ['server:result', 'session:rejected']);
  s.emit('student:answer', payload);
  return result;
};

async function nextQuestion(s) {
  const q = next(s, 'server:question');
  s.emit('student:next');
  return q;
}

const entryOf = (profile, key) => profile.history.find((h) => h.answerId === key);

// ------------------------------------------------------------ the queue --

console.log('\nthe queue');
const room = await makeRoom();
const { s: phone, first } = await joinRoom(room.session.code, 'REV-1', 'Student One');
const bankQ = room.questions.find((q) => String(q._id) === String(first.question._id));
const r1 = await answer(phone, { questionId: first.question._id, response: PARTIAL, answerId: 'review-key-0001' });
check('the phone hears that a written answer\'s mark is provisional',
  r1.name === 'server:result' && r1.payload.provisional === true && r1.payload.correct === false && r1.payload.score === 0.5,
  JSON.stringify({ provisional: r1.payload?.provisional, correct: r1.payload?.correct, score: r1.payload?.score }));
const stored = await repo.getAnswerByKey(room.session._id, 'review-key-0001');
check('the answer is stored provisional, with the machine\'s mark beside it',
  stored?.reviewStatus === 'provisional' && stored.autoCorrect === false && stored.autoScore === 0.5
  && stored.autoDetail === '1/2 rubric points');

// Rows that must stay out of the queue: an automatically marked answer, and a
// written attempt that was followed by a retry and so never counted.
const mcqRow = (await repo.recordAnswer({
  sessionId: room.session._id, answerKey: 'review-mcq-0001', rollNo: 'REV-1', questionId: bankQ._id,
  topic: 'Plants', bloom: 'remember', kind: 'mcq', questionSnapshot: { text: 'Pick one' }, response: 1,
  correct: true, score: 1, autoCorrect: true, autoScore: 1, reviewStatus: 'auto',
})).answer;
const retriedRow = (await repo.recordAnswer({
  sessionId: room.session._id, answerKey: 'review-try-0001', rollNo: 'REV-1', questionId: bankQ._id,
  topic: 'Plants', bloom: 'create', kind: 'open', questionSnapshot: { text: bankQ.text, rubric: RUBRIC }, response: 'no idea',
  final: false, correct: false, score: 0, autoCorrect: false, autoScore: 0, reviewStatus: 'provisional',
})).answer;

const queue = await get('/api/review');
const item = queue.body?.items?.find((i) => i.answerId === String(stored._id));
check('the queue lists it', queue.status === 200 && Boolean(item), `HTTP ${queue.status}`);
check('with the room, the student and the question as it was shown',
  item?.room?.code === room.session.code && item?.room?.title === 'Written answers'
  && item?.student?.rollNo === 'REV-1' && item?.student?.name === 'Student One'
  && item?.topic === 'Plants' && item?.bloom === 'create' && item?.kind === 'open'
  && item?.question?.text === bankQ.text && item?.question?.rubric?.length === 2 && item?.question?.modelAnswer === null);
check('with the response, the machine\'s mark and the mark in force',
  item?.response === PARTIAL && item?.autoCorrect === false && item?.autoScore === 0.5
  && item?.autoDetail === '1/2 rubric points' && item?.correct === false && item?.score === 0.5
  && item?.reviewStatus === 'provisional' && item?.attempt === 1 && Boolean(item?.answeredAt));
check('an automatically marked answer is not in it',
  !queue.body.items.some((i) => i.answerId === String(mcqRow._id)));
check('nor a written attempt that was retried', !queue.body.items.some((i) => i.answerId === String(retriedRow._id)));
const byCode = await get(`/api/review?code=${room.session.code.toLowerCase()}`);
check('one room can be asked for by its code', byCode.status === 200 && byCode.body.items.length === 1
  && byCode.body.items[0].answerId === String(stored._id));
check('no credentials, no queue', (await get('/api/review', {})).status === 401);

// --------------------------------------------------------------- access --

console.log('\nanother professor\'s room');
const owned = await makeRoom({ ownerId: '33333333-3333-3333-3333-333333333333' });
const { s: ownPhone, first: ownFirst } = await joinRoom(owned.session.code, 'REV-OWN', 'Owned Student');
await answer(ownPhone, { questionId: ownFirst.question._id, response: PARTIAL, answerId: 'review-own-0001' });
ownPhone.close();
const ownedRow = await repo.getAnswerByKey(owned.session._id, 'review-own-0001');
const missing = await post('0123456789abcdef01234567', { decision: 'confirm' });
check('its written answer is not in the shared key\'s queue',
  !(await get('/api/review?status=all')).body.items.some((i) => i.answerId === String(ownedRow._id)));
check('cannot be read', (await get(`/api/review/${ownedRow._id}`)).status === 404);
const tried = await post(ownedRow._id, { decision: 'override', correct: true });
check('and cannot be reviewed: 404, word for word what an unknown answer gets',
  tried.status === 404 && missing.status === 404 && tried.body?.error === missing.body?.error, tried.body?.error);
check('its room cannot be named in the queue either', (await get(`/api/review?code=${owned.session.code}`)).status === 404);
check('and nothing was written', (await repo.getAnswer(ownedRow._id)).reviewStatus === 'provisional'
  && (await repo.listAnswerReviews({ answerId: ownedRow._id })).length === 0);

// ----------------------------------------------- confirm, then override --

console.log('\nconfirm, then override');
const teacher = await connect();
const watching = next(teacher, 'teacher:grid');
teacher.emit('teacher:watch', { code: room.session.code, key: config.teacherKey });
await watching;
const before = await repo.getProfile(room.session._id, 'REV-1');

const confirmed = await post(stored._id, { decision: 'confirm' });
const afterConfirm = await repo.getAnswer(stored._id);
const pConfirm = await repo.getProfile(room.session._id, 'REV-1');
check('confirm is accepted and logged', confirmed.status === 200 && confirmed.body.logged === true
  && confirmed.body.item?.reviewStatus === 'confirmed', `HTTP ${confirmed.status} ${confirmed.body?.error ?? ''}`);
check('it keeps the machine\'s mark', afterConfirm.correct === false && afterConfirm.score === 0.5
  && afterConfirm.reviewStatus === 'confirmed' && afterConfirm.reviewedBy === null && Boolean(afterConfirm.reviewedAt));
check('the history entry is marked confirmed and no number moves',
  entryOf(pConfirm, 'review-key-0001')?.review === 'confirmed'
  && JSON.stringify(pConfirm.levels) === JSON.stringify(before.levels));

const NOTE = 'Both points, in their own words.';
const pushed = until(teacher, 'teacher:grid', (p) => p.rows?.some((r) => r.rollNo === 'REV-1' && r.total?.correct === 1));
const overridden = await post(stored._id, { decision: 'override', correct: true, score: 0.9, note: NOTE });
const row = await repo.getAnswer(stored._id);
const log = await repo.listAnswerReviews({ answerId: stored._id });
const pOverride = await repo.getProfile(room.session._id, 'REV-1');
const entry = entryOf(pOverride, 'review-key-0001');
check('override is accepted', overridden.status === 200 && overridden.body.changed === true && overridden.body.logged === true
  && overridden.body.profile?.adjusted === true, `HTTP ${overridden.status} ${overridden.body?.error ?? ''}`);
check('it sets the professor\'s mark and note', row.correct === true && row.score === 0.9
  && row.reviewStatus === 'overridden' && row.reviewNote === NOTE);
check('and never touches the response or the machine\'s mark',
  row.response === PARTIAL && row.autoCorrect === false && row.autoScore === 0.5
  && row.autoDetail === stored.autoDetail && row.answeredAt === stored.answeredAt
  && JSON.stringify(row.questionSnapshot) === JSON.stringify(stored.questionSnapshot));
check('both decisions are in the log, oldest first',
  log.length === 2 && log[0].decision === 'confirm' && log[0].correct === false && log[0].score === 0.5
  && log[1].decision === 'override' && log[1].correct === true && log[1].score === 0.9 && log[1].note === NOTE,
  `${log.length} row(s)`);
check('the history entry carries the human mark', entry?.correct === true && entry?.score === 0.9 && entry?.review === 'overridden');
check('the level tally moves by one, the count does not',
  pOverride.levels.create.seen === before.levels.create.seen
  && pOverride.levels.create.correct === before.levels.create.correct + 1,
  JSON.stringify(pOverride.levels.create));
check('the working level is not rewound', pOverride.workingLevel === before.workingLevel && pOverride.reason === before.reason);
const live = await pushed.catch(() => null);
check('the teacher\'s live grid is pushed the corrected row', Boolean(live));
const grid = await get(`/api/session/${room.session.code}/grid`);
check('and the grid route agrees', grid.body?.rows?.find((r) => r.rollNo === 'REV-1')?.total?.correct === 1);
{
  const res = await fetch(`${base}/api/session/${room.session.code}/export`, { headers: KEY });
  const lines = (await res.text()).replace(/^﻿/, '').split('\r\n');
  const header = lines[0].split(',');
  const at = header.indexOf('Create Correct');
  const cells = lines.find((l) => l.startsWith('REV-1,'))?.split(',') ?? [];
  check('so does the CSV export', res.ok && at > 0 && cells[at] === '1', `Create Correct = ${cells[at]}`);
}
const one = await get(`/api/review/${stored._id}`);
check('one answer reads back with its whole log', one.status === 200 && one.body.item?.reviewStatus === 'overridden'
  && one.body.log?.length === 2 && one.body.log[0].decision === 'confirm');

// --------------------------------------------------------- idempotency --

console.log('\nrepeats');
const again = await post(stored._id, { decision: 'override', correct: true, score: 0.9, note: NOTE });
const pAgain = await repo.getProfile(room.session._id, 'REV-1');
check('the same override again changes nothing', again.status === 200 && again.body.changed === false
  && again.body.logged === false && again.body.profile?.adjusted === false);
check('logs nothing', (await repo.listAnswerReviews({ answerId: stored._id })).length === 2);
check('and counts nothing twice', pAgain.levels.create.correct === pOverride.levels.create.correct);
const noted = await post(stored._id, { decision: 'override', correct: true, score: 0.9, note: 'Re-read: still both points.' });
check('the same mark with a new note is a new decision: logged, nothing recounted',
  noted.body?.logged === true && noted.body?.profile?.adjusted === false
  && (await repo.listAnswerReviews({ answerId: stored._id })).length === 3
  && (await repo.getProfile(room.session._id, 'REV-1')).levels.create.correct === pOverride.levels.create.correct);

const replay = await answer(phone, { questionId: first.question._id, response: PARTIAL, answerId: 'review-key-0001' });
check('a resend after the review hears the professor\'s mark, no longer provisional',
  replay.payload?.correct === true && replay.payload?.provisional === undefined);

// The ladder's next decision reads the corrected history, and a later answer
// does not undo the review.
const q2 = await nextQuestion(phone);
await answer(phone, { questionId: q2.question._id, response: FULL, answerId: 'review-key-0002' });
const pLater = await repo.getProfile(room.session._id, 'REV-1');
check('a later answer keeps the review and the tallies add up',
  entryOf(pLater, 'review-key-0001')?.review === 'overridden' && entryOf(pLater, 'review-key-0001')?.correct === true
  && pLater.levels.create.seen === 2 && pLater.levels.create.correct === 2, JSON.stringify(pLater.levels.create));

// A review and a live answer from the same student arriving together. The
// in-process store answers in microseconds, so a profile read is slowed to a
// database round trip here; without the profile lock, whichever side wrote
// second would put back the profile it read before the other's change.
{
  const { s: racer, first: rf } = await joinRoom(room.session.code, 'REV-2', 'Student Two');
  await answer(racer, { questionId: rf.question._id, response: PARTIAL, answerId: 'review-race-0001' });
  const raceRow = await repo.getAnswerByKey(room.session._id, 'review-race-0001');
  const rq2 = await nextQuestion(racer);
  const realGetProfile = repo.getProfile;
  repo.getProfile = async (...args) => {
    const out = await realGetProfile.apply(repo, args);
    await new Promise((r) => setTimeout(r, 40));
    return out;
  };
  try {
    await Promise.all([
      post(raceRow._id, { decision: 'override', correct: true, score: 1 }),
      answer(racer, { questionId: rq2.question._id, response: FULL, answerId: 'review-race-0002' }),
    ]);
  } finally {
    repo.getProfile = realGetProfile;
  }
  const p = await repo.getProfile(room.session._id, 'REV-2');
  check('a review and an answer arriving together both land',
    entryOf(p, 'review-race-0001')?.review === 'overridden' && Boolean(entryOf(p, 'review-race-0002'))
    && p.levels.create.seen === 2 && p.levels.create.correct === 2, JSON.stringify(p.levels.create));
  racer.close();
}

// ---------------------------------------------------------------- input --

console.log('\nbad input');
const snapshotOf = async () => JSON.stringify([await repo.getAnswer(stored._id), await repo.listAnswerReviews({ answerId: stored._id })]);
const untouched = await snapshotOf();
for (const [label, body] of [
  ['an unknown decision', { decision: 'approve' }],
  ['no decision at all', {}],
  ['an override with no mark', { decision: 'override' }],
  ['a score above 1', { decision: 'override', score: 1.5 }],
  ['a negative score', { decision: 'override', score: -0.1 }],
  ['a score sent as text', { decision: 'override', score: '0.9' }],
  ['correct sent as text', { decision: 'override', correct: 'yes' }],
  ['a confirm that carries a mark of its own', { decision: 'confirm', correct: true }],
  ['a note that is not text', { decision: 'confirm', note: 42 }],
  ['a note over 1000 characters', { decision: 'confirm', note: 'x'.repeat(1001) }],
]) {
  const r = await post(stored._id, body);
  check(`refused: ${label}`, r.status === 400, `HTTP ${r.status} ${r.body?.error ?? ''}`);
}
check('refused: an answer that was marked automatically', (await post(mcqRow._id, { decision: 'confirm' })).status === 400);
check('refused: a written attempt that was retried', (await post(retriedRow._id, { decision: 'confirm' })).status === 400);
check('an id that does not exist is 404', missing.status === 404);
check('so is one that is not an id', (await post('not-an-id', { decision: 'confirm' })).status === 404);
check('none of it changed the answer or its log', (await snapshotOf()) === untouched);
for (const [label, path] of [
  ['an unknown status', '/api/review?status=pending'],
  ['a limit of 0', '/api/review?limit=0'],
  ['a limit over 200', '/api/review?limit=500'],
  ['a negative offset', '/api/review?offset=-1'],
  ['any offset at all (it pages by cursor)', '/api/review?offset=3'],
  ['a cursor it never issued', '/api/review?before=not-a-cursor'],
  ['a fractional limit', '/api/review?limit=2.5'],
]) {
  check(`queue refuses ${label}`, (await get(path)).status === 400);
}

// ---------------------------------------------------- filters and paging --

console.log('\nfilters and paging');
{
  const all = (await get(`/api/review?status=all&code=${room.session.code}`)).body.items;
  const times = all.map((i) => i.answeredAt);
  check('the whole room, newest first', all.length === 4
    && times.every((t, i) => i === 0 || times[i - 1] >= t), `${all.length} item(s)`);
  const pending = (await get(`/api/review?code=${room.session.code}`)).body.items;
  check('the default view is what still waits for a professor',
    pending.length === 2 && pending.every((i) => i.reviewStatus === 'provisional'), `${pending.length} item(s)`);
  const done = (await get(`/api/review?status=overridden&code=${room.session.code}`)).body.items;
  check('overridden answers can be listed on their own', done.length === 2 && done.every((i) => i.reviewStatus === 'overridden'));
  const p1 = (await get(`/api/review?status=all&code=${room.session.code}&limit=3`)).body;
  const p2 = (await get(`/api/review?status=all&code=${room.session.code}&limit=3&before=${p1.next}`)).body;
  check('pages follow on without overlap', p1.items.length === 3 && p1.hasMore === true && typeof p1.next === 'string'
    && p2.items.length === 1 && p2.hasMore === false && p2.next === null && p2.items[0].answerId === all[3].answerId);
}
phone.close();
teacher.close();

// --------------------------------------------------------- a closed room --

console.log('\na closed room');
{
  const closed = await makeRoom();
  const { s, first: f } = await joinRoom(closed.session.code, 'REV-C', 'Closed Student');
  await answer(s, { questionId: f.question._id, response: PARTIAL, answerId: 'review-closed-0001' });
  s.close();
  const shut = await fetch(`${base}/api/session/${closed.session.code}/close`, { method: 'POST', headers: KEY });
  const id = (await repo.getAnswerByKey(closed.session._id, 'review-closed-0001'))._id;
  const level = async () => (await repo.getProfile(closed.session._id, 'REV-C')).levels.create;

  const byScore = await post(id, { decision: 'override', score: 0.8 });
  check('a closed room can still be reviewed', shut.ok && byScore.status === 200 && (await level()).correct === 1,
    `HTTP ${byScore.status} ${byScore.body?.error ?? ''}`);
  check('a score alone at or over the 70% pass mark counts as right', byScore.body?.item?.correct === true);
  const low = await post(id, { decision: 'override', score: 0.6 });
  check('a score alone under it counts as wrong, and the tally follows',
    low.body?.item?.correct === false && (await level()).correct === 0);
  const right = await post(id, { decision: 'override', correct: true });
  check('right alone scores 1', right.body?.item?.correct === true && right.body?.item?.score === 1 && (await level()).correct === 1);
  const back = await post(id, { decision: 'confirm' });
  check('confirm after override puts the machine\'s mark back',
    back.body?.item?.correct === false && back.body?.item?.score === 0.5 && back.body?.item?.reviewStatus === 'confirmed'
    && (await level()).correct === 0 && (await level()).seen === 1);
  check('four decisions, four log rows', (await repo.listAnswerReviews({ answerId: id })).length === 4);
}

// ------------------------------------------- one key, two students --

console.log('\ntwo students, one answer key');
{
  const shared = await makeRoom();
  const code = shared.session.code;
  const { s: a, first: fa } = await joinRoom(code, 'LEG-A', 'Legacy A');
  const { s: b } = await joinRoom(code, 'LEG-B', 'Legacy B');
  // An older phone sends no key, so the server derives one. Both students give
  // the same written answer to the same question.
  const qid = fa.question._id;
  await answer(a, { questionId: qid, response: PARTIAL });
  const rb = await answer(b, { questionId: qid, response: PARTIAL });
  const rowOf = async (rollNo) => (await repo.listAnswers({ sessionId: shared.session._id, rollNo }))[0];
  const rowA = await rowOf('LEG-A');
  const rowB = await rowOf('LEG-B');
  check('with no key, the same answer from two students is two rows, one each',
    rb.name === 'server:result' && Boolean(rowA) && Boolean(rowB) && rowA.answerKey !== rowB.answerKey,
    `${(await repo.listAnswers({ sessionId: shared.session._id })).length} row(s)`);
  const pB = await repo.getProfile(shared.session._id, 'LEG-B');
  check('the second student\'s history points at their own row, not the first one\'s',
    Boolean(rowB && entryOf(pB, rowB.answerKey)) && !(rowA && entryOf(pB, rowA.answerKey)));
  const waiting = (await get(`/api/review?code=${code}`)).body.items.map((i) => i.student.rollNo);
  check('both are in the review queue', waiting.includes('LEG-A') && waiting.includes('LEG-B'), waiting.join(', '));
  if (rowA && rowB) {
    await post(rowA._id, { decision: 'override', correct: true });
    const [pA1, pB1] = [await repo.getProfile(shared.session._id, 'LEG-A'), await repo.getProfile(shared.session._id, 'LEG-B')];
    check('a review of one student\'s row moves that student only',
      pA1.levels.create.correct === 1 && pB1.levels.create.correct === 0, `${pA1.levels.create.correct}/${pB1.levels.create.correct}`);
    const own = await post(rowB._id, { decision: 'override', correct: true });
    check('and the other\'s is reviewed on its own', own.status === 200 && own.body.profile?.adjusted === true
      && (await repo.getProfile(shared.session._id, 'LEG-B')).levels.create.correct === 1);
  }

  // A phone chooses its own key, so one can arrive that another student's row
  // already holds. KEY-C is right; KEY-D sends a wrong answer under C's key.
  const { s: c, first: fc } = await joinRoom(code, 'KEY-C', 'Key C');
  const { s: d } = await joinRoom(code, 'KEY-D', 'Key D');
  await answer(c, { questionId: fc.question._id, response: FULL, answerId: 'shared-key-0001' });
  const rd = await answer(d, { questionId: fc.question._id, response: PARTIAL, answerId: 'shared-key-0001' });
  const rowsD = await repo.listAnswers({ sessionId: shared.session._id, rollNo: 'KEY-D' });
  const rowC = await repo.getAnswerByKey(shared.session._id, 'shared-key-0001');
  check('a key another student\'s row holds is never answered from that row',
    rd.payload?.correct === false && rowsD.length === 1 && rowsD[0].response === PARTIAL
    && rowC?.rollNo === 'KEY-C' && rowC?.response === FULL, `D told correct=${rd.payload?.correct}, ${rowsD.length} row(s) for D`);
  const rd2 = await answer(d, { questionId: fc.question._id, response: PARTIAL, answerId: 'shared-key-0001' });
  check('and that student\'s own resend finds their own row, once',
    rd2.payload?.correct === false && (await repo.listAnswers({ sessionId: shared.session._id, rollNo: 'KEY-D' })).length === 1);
  for (const sock of [a, b, c, d]) sock.close();
}

// -------------------------------------------- a resend after a review --

console.log('\na resend rebuilt from a reviewed row');
{
  const lost = await makeRoom();
  const { s, first: f } = await joinRoom(lost.session.code, 'MISS-1', 'Missing Write');
  // The answer row is written and the profile write behind it is lost.
  const realSave = repo.saveProfile;
  let tripped = false;
  repo.saveProfile = async (...args) => {
    if (!tripped) {
      tripped = true;
      throw new Error('simulated: the profile write was lost');
    }
    return realSave.apply(repo, args);
  };
  let sent;
  try {
    sent = await answer(s, { questionId: f.question._id, response: PARTIAL, answerId: 'miss-key-0001' });
  } finally {
    repo.saveProfile = realSave;
  }
  const row = await repo.getAnswerByKey(lost.session._id, 'miss-key-0001');
  check('fixture: the row is stored and its history entry is not',
    sent.name === 'session:rejected' && Boolean(row) && !entryOf(await repo.getProfile(lost.session._id, 'MISS-1'), 'miss-key-0001'));
  const over = await post(row._id, { decision: 'override', correct: true, score: 0.9 });
  check('fixture: the override lands with no entry to adjust', over.status === 200 && over.body.profile?.found === false);

  const resent = await answer(s, { questionId: f.question._id, response: PARTIAL, answerId: 'miss-key-0001' });
  const p = await repo.getProfile(lost.session._id, 'MISS-1');
  const rebuilt = entryOf(p, 'miss-key-0001');
  check('the resend rebuilds the entry with the professor\'s mark and the review',
    rebuilt?.correct === true && rebuilt?.review === 'overridden' && p.levels.create.correct === 1, JSON.stringify(rebuilt));
  check('and does not send the machine\'s reading beside the professor\'s mark',
    resent.payload?.correct === true && resent.payload?.detail === '' && resent.payload?.provisional === undefined,
    `detail "${resent.payload?.detail}"`);
  const tapped = await answer(s, { questionId: f.question._id, response: PARTIAL, answerId: 'miss-key-0002' });
  check('a double-tap under a new key is not told the reviewed mark is provisional',
    tapped.payload?.correct === true && tapped.payload?.provisional === undefined);
  s.close();
}

// ----------------------------------------- a review and the room's delete --

console.log('\na review and the room\'s delete');
{
  const roomWith = async (rollNo, key) => {
    const r = await makeRoom();
    const { s, first: f } = await joinRoom(r.session.code, rollNo, rollNo);
    await answer(s, { questionId: f.question._id, response: PARTIAL, answerId: key });
    s.close();
    return { ...r, row: await repo.getAnswerByKey(r.session._id, key) };
  };
  const remove = (code) => fetch(`${base}/api/session/${code}?confirm=${code}`, { method: 'DELETE', headers: KEY });
  const archived = async (res) => {
    try {
      return decodeRoomArchive((await repo.getRoomArchive((await res.json()).archive?.id)).data);
    } catch {
      return {}; // no archive: every check on it then fails
    }
  };

  // A review arriving after the archive has read the room and before the delete.
  const late = await roomWith('DEL-1', 'doomed-key-0001');
  const realSave = repo.saveRoomArchive;
  let between = null;
  repo.saveRoomArchive = async (doc) => {
    between = await post(late.row._id, { decision: 'override', correct: true });
    return realSave.call(repo, doc);
  };
  let gone;
  try {
    gone = await remove(late.session.code);
  } finally {
    repo.saveRoomArchive = realSave;
  }
  const kept = await archived(gone);
  check('a review sent while the room is being archived is refused, never answered as saved',
    between?.status === 409 && between.body?.logged === undefined, `HTTP ${between?.status} ${between?.body?.error ?? ''}`);
  check('and the archive is the room as it stood: provisional, no decision',
    gone.ok && kept.answers?.[0]?.reviewStatus === 'provisional' && kept.reviews?.length === 0);

  // A review already under way when the delete starts: the delete waits for it.
  const busy = await roomWith('DEL-2', 'flight-key-0001');
  const realAdd = repo.addAnswerReview;
  repo.addAnswerReview = async (doc) => {
    await new Promise((r) => setTimeout(r, 150));
    return realAdd.call(repo, doc);
  };
  let reviewed;
  let removed;
  try {
    const inFlight = post(busy.row._id, { decision: 'override', correct: true, note: 'In before the delete.' });
    await new Promise((r) => setTimeout(r, 40));
    removed = await remove(busy.session.code);
    reviewed = await inFlight;
  } finally {
    repo.addAnswerReview = realAdd;
  }
  const after = await archived(removed);
  check('a review under way when the delete starts finishes first, and is in the archive',
    reviewed?.status === 200 && removed.ok && after.reviews?.length === 1 && after.reviews[0].decision === 'override'
    && after.answers?.[0]?.reviewStatus === 'overridden', `review HTTP ${reviewed?.status}, ${after.reviews?.length} archived decision(s)`);
}

// ------------------------------------------------- walking the queue --

console.log('\nworking through the queue a page at a time');
{
  const busy = await makeRoom();
  const { s, first: f } = await joinRoom(busy.session.code, 'PAGE-1', 'Pager');
  let q = f.question;
  // Right answers, so the ladder keeps serving; every written answer is provisional either way.
  for (let i = 1; i <= 4; i += 1) {
    await answer(s, { questionId: q._id, response: FULL, answerId: `page-key-000${i}` });
    if (i < 4) q = (await nextQuestion(s)).question;
  }
  s.close();
  // What a screen does: confirm what is on the page, then ask for the next one.
  const reached = [];
  let path = `/api/review?code=${busy.session.code}&limit=1`;
  for (let guard = 0; path && guard < 10; guard += 1) {
    const page = (await get(path)).body;
    const it = page?.items?.[0];
    if (!it) break;
    reached.push(it.answerId);
    await post(it.answerId, { decision: 'confirm' });
    path = page.next ? `/api/review?code=${busy.session.code}&limit=1&before=${page.next}` : null;
  }
  const left = (await get(`/api/review?code=${busy.session.code}`)).body.items.length;
  check('confirming each page and moving on reaches every answer, none skipped',
    reached.length === 4 && new Set(reached).size === 4 && left === 0, `${reached.length} reached, ${left} still waiting`);
}

console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
