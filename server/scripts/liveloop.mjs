// Phase 0 regression suite for the live loop.
//
//   node server/scripts/liveloop.mjs
//
// Drives a REAL socket server on the in-process store (the same createApp and
// attachSockets the production server uses) and checks what Phase 0 changed:
//
//   ownership   a teacher may only watch rooms they may read
//   evidence    every attempt is stored with its response, topic and key
//   idempotent  a resend never counts twice, with or without a key
//   settings    reattempts, redemption and the mastery goal are applied
//   polls       an ungraded item never touches levels or accuracy
//   status      the teacher's screen hears pause, resume and close
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
const KEY = config.teacherKey;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

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

/** Resolves with whichever of the events arrives first. */
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

// ------------------------------------------------------------ fixtures --

const mcq = (i, bloom, topic, extra = {}) => ({
  text: `Question ${i} at ${bloom}?`,
  kind: 'mcq',
  options: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
  answerIdx: 1,
  bloom,
  topic,
  source: 'llm',
  ...extra,
});

// `poll: false` and `oneLevel: true` take chance out of the checks that need a
// particular question next: the first question served is drawn at random.
async function makeRoom({ ownerId = null, settings = {}, poll = true, oneLevel = false } = {}) {
  const content = await repo.createContent({ title: 'Live loop fixture', kind: 'syllabus', rawText: '', topics: ['Topic A', 'Topic B'], ownerId });
  const docs = [];
  for (let i = 0; i < 4; i += 1) docs.push(mcq(i, oneLevel ? 'understand' : 'remember', 'Topic A'));
  for (let i = 4; i < 10; i += 1) docs.push(mcq(i, 'understand', 'Topic B'));
  if (poll) docs.push({ text: 'How confident do you feel?', kind: 'poll', options: ['Very', 'Somewhat', 'Not yet'], bloom: 'understand', topic: 'Topic B', source: 'llm' });
  const questions = await repo.insertQuestions(docs.map((d) => ({ ...d, contentId: content._id })));
  const code = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z]/g, 'X').padEnd(6, 'X');
  const session = await repo.createSession({
    code, contentId: content._id, title: 'Fixture', status: 'open', ownerId,
    masteryGoal: 0.8, reattempts: 0, redemption: false, ...settings,
  });
  return { session, questions, poll: questions.find((q) => q.kind === 'poll') };
}

/** Join and return the socket plus the first served question. */
async function joinRoom(code, rollNo) {
  const s = await connect();
  const accepted = next(s, 'session:accepted');
  const first = next(s, 'server:question');
  s.emit('student:join', { code, rollNo, name: rollNo });
  return { s, accepted: await accepted, first: await first };
}

const answer = (s, payload) => {
  const result = either(s, ['server:result', 'session:rejected']);
  s.emit('student:answer', payload);
  return result;
};

const wrongFor = (q) => (q.options ? 0 : 'zzz');
const rightFor = (bankQ) => bankQ.answerIdx;

// ----------------------------------------------------------- ownership --

console.log('\nteacher:watch ownership');
{
  const unowned = await makeRoom();
  const owned = await makeRoom({ ownerId: '11111111-1111-1111-1111-111111111111' });

  const t1 = await connect();
  const grid = either(t1, ['teacher:grid', 'session:rejected']);
  t1.emit('teacher:watch', { code: unowned.session.code, key: KEY });
  const r1 = await grid;
  check('the shared key can watch a room nobody owns', r1.name === 'teacher:grid');

  const t2 = await connect();
  const refused = either(t2, ['teacher:grid', 'session:rejected']);
  t2.emit('teacher:watch', { code: owned.session.code, key: KEY });
  const r2 = await refused;
  check('the shared key cannot watch a signed-in professor\'s room', r2.name === 'session:rejected',
    r2.payload?.reason ?? '');
  check('and is told the same thing as for a code that does not exist',
    r2.payload?.reason === 'No session with that code.');

  const t3 = await connect();
  const anon = either(t3, ['teacher:grid', 'session:rejected']);
  t3.emit('teacher:watch', { code: unowned.session.code });
  check('no credentials, no grid', (await anon).name === 'session:rejected');
  [t1, t2, t3].forEach((t) => t.close());
}

// -------------------------------------------- evidence and idempotency --

console.log('\nevidence and idempotency');
{
  const room = await makeRoom({ poll: false });
  const { s, first } = await joinRoom(room.session.code, 'IDEM-1');
  const bankQ = room.questions.find((q) => String(q._id) === String(first.question._id));
  const answerId = 'test-key-0001';

  const r1 = await answer(s, { questionId: first.question._id, response: rightFor(bankQ), answerId });
  const r2 = await answer(s, { questionId: first.question._id, response: rightFor(bankQ), answerId });
  const rows = await repo.listAnswers({ sessionId: room.session._id, rollNo: 'IDEM-1' });
  const profile = await repo.getProfile(room.session._id, 'IDEM-1');
  check('a resend with the same key is answered with a result', r2.name === 'server:result' && r2.payload.correct === true);
  check('and stored once', rows.length === 1, `${rows.length} row(s)`);
  check('and counted once', profile.history.length === 1 && profile.levels[bankQ.bloom].seen === 1,
    `history ${profile.history.length}`);
  check('the stored row keeps the response, topic and key',
    rows[0]?.response === rightFor(bankQ) && rows[0]?.topic === bankQ.topic && rows[0]?.answerKey === answerId);
  check('the history entry carries the topic', profile.history[0]?.topic === bankQ.topic);
  check('a question snapshot is kept with the answer', rows[0]?.questionSnapshot?.text === bankQ.text);
  check('first result reports correctness', r1.payload.correct === true);

  // A phone from before keys existed: same answer twice, no key.
  const q2 = await next(s, 'server:question').catch(() => null) ?? null;
  s.emit('student:next');
  const served = q2 ?? await next(s, 'server:question');
  const bank2 = room.questions.find((q) => String(q._id) === String(served.question._id));
  await answer(s, { questionId: served.question._id, response: wrongFor(bank2) });
  await answer(s, { questionId: served.question._id, response: wrongFor(bank2) });
  const after = await repo.getProfile(room.session._id, 'IDEM-1');
  const legacyRows = (await repo.listAnswers({ sessionId: room.session._id, rollNo: 'IDEM-1' }))
    .filter((r) => String(r.questionId) === String(served.question._id));
  check('a keyless resend is recognised by its content', legacyRows.length === 1 && after.history.length === 2,
    `${legacyRows.length} row(s), history ${after.history.length}`);
  s.close();
}

// ------------------------------------------------------------ polls --

console.log('\npolls');
{
  const room = await makeRoom();
  const { s } = await joinRoom(room.session.code, 'POLL-1');
  const before = await repo.getProfile(room.session._id, 'POLL-1');
  const r = await answer(s, { questionId: room.poll._id, response: 0, answerId: 'poll-key-0001' });
  const after = await repo.getProfile(room.session._id, 'POLL-1');
  const seen = (p) => Object.values(p.levels).reduce((n, l) => n + l.seen, 0);
  check('a poll answer is acknowledged as ungraded', r.name === 'server:result' && r.payload.ungraded === true);
  check('it adds nothing to any level', seen(after) === seen(before), `${seen(before)} -> ${seen(after)}`);
  check('it is still recorded so it is not served again',
    after.history.some((h) => String(h.questionId) === String(room.poll._id) && h.ungraded));
  const row = (await repo.listAnswers({ sessionId: room.session._id, rollNo: 'POLL-1' }))[0];
  check('and its response is kept as evidence', row?.ungraded === true && row?.response === 0);
  s.close();
}

// -------------------------------------------------------- reattempts --

console.log('\nreattempts');
{
  const room = await makeRoom({ settings: { reattempts: 1 }, poll: false });
  const { s, first, accepted } = await joinRoom(room.session.code, 'RETRY-1');
  const bankQ = room.questions.find((q) => String(q._id) === String(first.question._id));
  check('the phone is told the room settings', accepted.session?.settings?.reattempts === 1);
  check('the first question says it has two goes', first.triesLeft === 2, `triesLeft ${first.triesLeft}`);

  const r1 = await answer(s, { questionId: first.question._id, response: wrongFor(bankQ), answerId: 'retry-a-0001' });
  const mid = await repo.getProfile(room.session._id, 'RETRY-1');
  check('a wrong first go with a retry left is a retry, not a mark', r1.payload.retry === true && r1.payload.triesLeft === 1);
  check('and does not reveal the answer', r1.payload.solution === undefined || r1.payload.solution === null);
  check('and does not count yet', mid.history.length === 0);

  const r1b = await answer(s, { questionId: first.question._id, response: wrongFor(bankQ), answerId: 'retry-a-0002' });
  const mid2 = await repo.getProfile(room.session._id, 'RETRY-1');
  check('the same wrong answer resent under a new key does not spend the retry',
    r1b.payload.retry === true && mid2.served?.tries === 1, `tries ${mid2.served?.tries}`);

  const r2 = await answer(s, { questionId: first.question._id, response: rightFor(bankQ), answerId: 'retry-a-0003' });
  const done = await repo.getProfile(room.session._id, 'RETRY-1');
  check('the second go is final and right', r2.payload.retry !== true && r2.payload.correct === true);
  check('history records it took two goes', done.history[0]?.tries === 2, JSON.stringify(done.history[0]));
  const rows = await repo.listAnswers({ sessionId: room.session._id, rollNo: 'RETRY-1' });
  check('both attempts are kept as evidence, only the last final',
    rows.length === 2 && rows[0].final === false && rows[1].final === true, `${rows.length} row(s)`);
  s.close();
}

// -------------------------------------------------------- redemption --

console.log('\nredemption and the mastery goal');
{
  const room = await makeRoom({ settings: { redemption: true, masteryGoal: 0.9 }, poll: false, oneLevel: true });
  const { s, first, accepted } = await joinRoom(room.session.code, 'REDEEM-1');
  check('the grid row carries the room goal', accepted.profile?.masteryGoal === 0.9, `${accepted.profile?.masteryGoal}`);
  let served = first;
  let wrongDone = false;
  let redeemed = null;
  for (let i = 0; i < 6 && !redeemed; i += 1) {
    const bankQ = room.questions.find((q) => String(q._id) === String(served.question._id));
    const response = wrongDone ? rightFor(bankQ) : wrongFor(bankQ);
    const r = await answer(s, { questionId: served.question._id, response, answerId: `redeem-${i}-0000` });
    wrongDone = true;
    if (r.payload.redeemed) redeemed = r.payload.redeemed;
    const nextQ = next(s, 'server:question');
    s.emit('student:next');
    served = await nextQ.catch(() => null);
    if (!served) break;
  }
  const p = await repo.getProfile(room.session._id, 'REDEEM-1');
  check('a right first-time answer sets aside an earlier wrong one',
    Boolean(redeemed) && p.history.some((h) => h.redeemedBy), redeemed ?? 'no redemption');
  s.close();
}

// ------------------------------------------------------------ status --

console.log('\nteacher status');
{
  const room = await makeRoom();
  const t = await connect();
  const initial = next(t, 'teacher:status');
  t.emit('teacher:watch', { code: room.session.code, key: KEY });
  const first = await initial;
  check('watching sends the room status', first.status === 'open');
  const paused = next(t, 'teacher:status');
  const res = await fetch(`${base}/api/session/${room.session.code}/pause`, { method: 'POST', headers: { 'x-teacher-key': KEY } });
  const st = await paused;
  check('pausing over HTTP reaches the teacher\'s live screen', res.ok && st.status === 'paused');
  const resumed = next(t, 'teacher:status');
  await fetch(`${base}/api/session/${room.session.code}/resume`, { method: 'POST', headers: { 'x-teacher-key': KEY } });
  check('and so does resuming', (await resumed).status === 'open');
  t.close();
}

// ------------------------------------------------------- room archive --

console.log('\ndeleting a room keeps it as a JSON archive');
{
  const room = await makeRoom({ poll: false });
  const { s, first } = await joinRoom(room.session.code, 'ARCH-1');
  const bankQ = room.questions.find((q) => String(q._id) === String(first.question._id));
  await answer(s, { questionId: first.question._id, response: rightFor(bankQ), answerId: 'arch-key-0001' });
  s.close();
  const code = room.session.code;
  const H = { 'x-teacher-key': KEY };

  const noConfirm = await fetch(`${base}/api/session/${code}`, { method: 'DELETE', headers: H });
  check('a delete without the typed code is refused', noConfirm.status === 400);
  check('and deletes nothing', Boolean(await repo.getSessionByCode(code)));

  const del = await fetch(`${base}/api/session/${code}?confirm=${code}`, { method: 'DELETE', headers: H });
  const body = await del.json();
  check('a confirmed delete answers with the archive it wrote', del.ok && Boolean(body.archive?.id) && body.archive.bytes > 0,
    `${body.archive?.bytes} bytes`);
  check('the room is gone from the live tables', !(await repo.getSessionByCode(code))
    && (await repo.listAnswers({ sessionId: room.session._id })).length === 0
    && (await repo.listProfiles(room.session._id)).length === 0);

  const list = await (await fetch(`${base}/api/session/archives`, { headers: H })).json();
  check('the archive is listed, without its data', list.archives?.some((a) => a._id === body.archive.id && a.data === undefined));

  const file = await fetch(`${base}/api/session/archives/${body.archive.id}`, { headers: H });
  const data = await file.json();
  check('the archive downloads as a JSON file', file.ok
    && /attachment; filename="bloomloop-.*-archive-.*\.json"/.test(file.headers.get('content-disposition') ?? ''));
  check('it holds the answer the student gave', data.counts?.answers === 1 && data.answers?.rows?.length === 1
    && data.questions?.[0]?.text === bankQ.text);
  check('and is under 1 MB', Number(file.headers.get('content-length') ?? JSON.stringify(data).length) < 1024 * 1024);

  // Another professor's room: the shared key may neither list nor read its archive.
  const owned = await makeRoom({ ownerId: '22222222-2222-2222-2222-222222222222' });
  const { buildRoomArchive } = await import(`${SRC}services/archive.js`);
  const ownedArchive = await repo.saveRoomArchive((await buildRoomArchive(repo, owned.session)).doc);
  const list2 = await (await fetch(`${base}/api/session/archives`, { headers: H })).json();
  check('another teacher\'s archive is not listed', !list2.archives?.some((a) => a._id === ownedArchive._id));
  const peek = await fetch(`${base}/api/session/archives/${ownedArchive._id}`, { headers: H });
  check('and cannot be downloaded', peek.status === 404);
  const none = await fetch(`${base}/api/session/archives`);
  check('no credentials, no archives', none.status === 401 || none.status === 403);
}

console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
