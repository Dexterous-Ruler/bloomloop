// Phase 7, stage "Next" - a phone's question pack, its answers sent after an
// outage, and the grace window after the room closes, end to end.
//
//   node server/scripts/offline.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with scripted phones over Socket.io, and
// checks decisions O2 and O3 of 19 Nov 2026:
//
//   pack        after it joins, a phone asks for a pack: five approved questions
//               of its room at its working level and one either side, never the
//               one on its screen, each as the live loop sends a question (no
//               key); recorded before it is sent; asked again, the same pack
//   class       a question put to the class leaves every pack, while it runs
//               and once its key is revealed
//   offline     the phone drops, answers three packed questions with no
//               connection, and sends them later in one burst, its own clock
//               out of order; each is marked once, in the order the server
//               received them, the ladder moving as that order says; a wrong
//               one is final (no screen to retry on); the question on its screen
//               stays there; the phone's own times are kept for the record
//   replay      the same answer sent again makes no second row
//   room close  a phone with answers left rejoins the closed room only to send
//               them: one served before the close and arriving inside the
//               window counts; one never served to it is kept and not counted;
//               one arriving past the window is kept and not counted; each is
//               told so plainly; one to a question this room never asks is
//               refused for good and not stored; past the window the phone is
//               still let in to send, and its answer is stored, kept and not
//               counted (O2); it is never given a new question
//   long away   a phone away for hours from a room still open finds its place:
//               the same question on its screen and, within six hours, the same
//               pack; after that a pack chosen afresh; an answer to a question of
//               the expired pack is still one it was given
//   the cap     a pack is sized to the room's cap on questions per student; an
//               outbox answer that arrives once the cap is reached is stored,
//               kept and not counted, and the phone is told it has finished
//   keys        nothing any phone received carried a key field, and no phone
//               was sent a question's solution before its own answer to it was
//               marked; a kept answer is told no mark
//   archive     a deleted room's archive keeps each answer's phone time, and its
//               packs go with it
//
// And the fixes from the review of 19 Nov 2026:
//
//   case        a question id sent in upper case is the same question (the
//               hosted stores find it whatever the case): never marked twice
//   again       a second answer to a question already marked is stored, kept
//               and not counted, and told so with no mark
//   pin moved   a question the phone moved off (a failed save, then Next
//               question) is still one it was given: its answer counts inside
//               the window, and an outbox answer to it leaves the question on
//               the screen pinned
//   flood       one phone asking for packs without end holds up no other
//               phone's pack and no class question
//   records     asking for a new question and a pack, round after round, writes
//               no new pack record
//
// The professor signs in through a stand-in for Supabase Auth (as roster.mjs and
// decisions.mjs do): the server is pointed at http://supabase.invalid and every
// request to it is answered here, in-process. Any other request off this machine
// is refused outright.
//
// Never calls Gemini, Supabase or any network service. Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { applyAnswer, hydrate, sessionSettings } = await import(`${SRC}services/mastery.js`);
const { decodeRoomArchive } = await import(`${SRC}services/archive.js`);
const {
  AFTER_CLOSE_DETAIL, ANSWERED_AGAIN_DETAIL, ANSWERED_AGAIN_MESSAGE, DELIVER_MESSAGE, GRACE_MS, LATE_COUNTED_MESSAGE,
  LATE_NOT_SERVED_MESSAGE, LATE_TOO_LATE_MESSAGE, NOT_THIS_ROOM_MESSAGE, OVER_CAP_DETAIL, PACK_NOTE, PACK_SIZE, overCapMessage,
} = await import(`${SRC}services/offline.js`);

// The clock, moved on by hand. Waiting out a ten-minute window or a six-hour
// pack is not something a test can do, so the whole process's clock (the
// server's and this script's) is moved forward instead: every `new Date()` and
// `Date.now()` reads it, the answer rows and the verdicts alike. Only ever
// forward, so every record keeps its order.
const RealDate = Date;
let clockShift = 0;
class MovedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + clockShift);
    else super(...args);
  }

  static now() { return RealDate.now() + clockShift; }
}
globalThis.Date = MovedDate;
const moveClock = (ms) => { clockShift += ms; };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// The in-process store and no model, whatever .env says.
config.supabase.url = '';
config.supabase.serviceKey = '';
config.supabase.anonKey = '';
config.mongoUri = '';
config.gemini.apiKey = '';
await initStore({ log: () => {} });
const repo = getRepo();

// ------------------------------------------------- the accounts stand-in --

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'e7000000-0000-4000-8000-000000000001',
  profA: 'e7000000-0000-4000-8000-000000000002',
};
const account = (id, role, department, reportsTo) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-OFFL0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: null, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
].map((a) => [a.id, a]));
const TOKENS = { hod: 'tok-off-hod', profA: 'tok-off-prof-a' };
const BY_TOKEN = new Map(Object.entries(TOKENS).map(([who, token]) => [token, ID[who]]));
const below = (root) => {
  const out = [];
  const walk = (id) => { for (const a of ACCOUNTS.values()) if (a.reports_to === id) { out.push(a); walk(a.id); } };
  walk(root);
  return out;
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let refusedOffMachine = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  if (url.origin !== FAKE_ORIGIN) {
    refusedOffMachine += 1;
    throw new Error(`offline.mjs refuses to reach ${url.origin}`);
  }
  if (url.pathname === '/auth/v1/user') {
    const token = (new Headers(init.headers).get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const id = BY_TOKEN.get(token);
    return id ? reply({ id, aud: 'authenticated' }) : reply({ code: 401, msg: 'invalid JWT' }, 401);
  }
  if (url.pathname === '/rest/v1/accounts') {
    const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
    return reply(ACCOUNTS.has(id) ? [ACCOUNTS.get(id)] : []);
  }
  if (url.pathname === '/rest/v1/rpc/accounts_below') return reply(below(JSON.parse(init.body ?? '{}').root));
  return reply({ message: `not answered by offline.mjs: ${url.pathname}` }, 404);
};
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'offline-test-service-key';

// -------------------------------------------------------------- server --

const app = createApp();
const server = http.createServer(app);
// Pings every 100 ms: a phone's connection reads the same moved clock, and
// without a ping soon after a move it takes its own connection for dead.
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 100, pingTimeout: 2000 });
attachSockets(io);
app.set('io', io);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { body, as = 'profA' } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (path, body, as) => call('POST', path, { body, as });
const get = (path, as) => call('GET', path, { as });

// ------------------------------------------------------------- sockets --

/** Every event every phone received, in order, for the key scan at the end. */
const phoneLog = [];

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

/** The next event of one name that matches, registered before the act that causes it. */
function next(socket, event, match = () => true, ms = 4000) {
  return new Promise((resolve, reject) => {
    const on = (p) => {
      if (!match(p)) return;
      clearTimeout(timer);
      socket.off(event, on);
      resolve(p);
    };
    const timer = setTimeout(() => { socket.off(event, on); reject(new Error(`timeout waiting for ${event}`)); }, ms);
    socket.on(event, on);
  });
}

/** Resolves with every event of these names that arrives within `ms`. */
function gather(socket, events, ms = 300) {
  const got = [];
  const on = (event, payload) => { if (events.includes(event)) got.push({ event, payload }); };
  socket.onAny(on);
  return wait(ms).then(() => { socket.offAny(on); return got; });
}

/**
 * A phone's socket. Sends student:join and resolves once the room has answered:
 * accepted (and, unless `deliver`, its first server:question, as `served`, its
 * question as `question`) or rejected.
 */
async function phone(code, rollNo, { deliver = false, expectQuestion = !deliver } = {}) {
  const s = await connect();
  s.onAny((event, payload) => phoneLog.push({ rollNo, event, payload, at: phoneLog.length }));
  const accepted = next(s, 'session:accepted').catch(() => null);
  const rejected = next(s, 'session:rejected').catch(() => null);
  const first = expectQuestion ? next(s, 'server:question').catch(() => null) : null;
  s.emit('student:join', { code, rollNo, name: `Student ${rollNo.slice(-2)}`, ...(deliver ? { deliver: true } : {}) });
  const outcome = await Promise.race([accepted.then((a) => a && { accepted: a }), rejected.then((r) => r && { rejected: r })]);
  const served = outcome?.accepted && first ? await first : null;
  return { s, rollNo, ...outcome, served, question: served?.question ?? null };
}

const ask = async (p) => {
  const got = next(p.s, 'server:pack');
  p.s.emit('student:pack', {});
  return got;
};

/** The right or a wrong response to a bank question, read from the store's key. */
async function responseFor(questionId, right) {
  const q = await repo.getQuestion(questionId);
  if (q.kind === 'truefalse') return right ? q.answerBool : !q.answerBool;
  return right ? q.answerIdx : (q.answerIdx + 1) % q.options.length;
}

/** Send an answer; resolves with the first reply about it (server:result or server:kept), by its answerId. */
function send(p, { questionId, response, answerId, deviceAnsweredAt }) {
  const mine = (r) => r?.answerId === answerId;
  const reply = Promise.race([
    next(p.s, 'server:result', mine).then((r) => ({ event: 'server:result', ...r })),
    next(p.s, 'server:kept', mine).then((r) => ({ event: 'server:kept', ...r })),
  ]);
  p.s.emit('student:answer', { questionId, response, answerId, ...(deviceAnsweredAt ? { deviceAnsweredAt } : {}) });
  return reply;
}

// ------------------------------------------------------------ fixtures --

const content = await repo.createContent({ title: 'Sets', kind: 'syllabus', rawText: '', topics: ['Sets'], ownerId: ID.profA });
const make = (bloom, i, kind = 'mcq') => ({
  contentId: content._id, topic: 'Sets', text: `${bloom} question ${i}`, kind, bloom, source: 'llm', status: 'active',
  approvedAt: '2026-11-19T08:00:00.000Z', approvedBy: ID.profA,
  ...(kind === 'truefalse' ? { answerBool: i % 2 === 0 } : { options: ['w', 'x', 'y', 'z'], answerIdx: i % 4 }),
});
await repo.insertQuestions([
  ...Array.from({ length: 8 }, (_, i) => make('understand', i)),
  ...Array.from({ length: 4 }, (_, i) => make('remember', i, i % 2 ? 'truefalse' : 'mcq')),
  ...Array.from({ length: 4 }, (_, i) => make('apply', i)),
  ...Array.from({ length: 3 }, (_, i) => make('analyse', i)),
  // A draft and a discarded question: never servable, never packed.
  { ...make('understand', 90), status: 'draft' },
  { ...make('understand', 91), status: 'discarded' },
]);
const bank = await repo.listQuestions(content._id, { includeDiscarded: true });
const byId = new Map(bank.map((q) => [String(q._id), q]));
// Another chapter's question: never this room's to take an answer to.
const elsewhere = await repo.createContent({ title: 'Elsewhere', kind: 'syllabus', rawText: '', topics: ['X'], ownerId: ID.profA });
const [OTHER] = await repo.insertQuestions([{ ...make('understand', 50), contentId: elsewhere._id, topic: 'X' }]);
const KEY_FIELDS = /"(answerIdx|answerIdxs|answerBool|pairs|sequence|accept|rubric|buckets|misconceptions|checks|levelCheck)"/;

const room = await post('/api/session', { contentId: String(content._id), reattempts: 1 });
const code = room.body.code;
const sessionId = room.body.sessionId;
check('the professor opens a room that allows one retry', room.status === 200 && Boolean(code), JSON.stringify(room.body));

// ---------------------------------------------------------------- pack --

console.log('\na phone takes a pack');

const A = await phone(code, '21CS01');
const P0 = String(A.question?._id ?? '');
check('the phone joins and is served its first question at its working level', Boolean(P0) && A.question.bloom === 'understand');
const pack1 = await ask(A);
const ids1 = (pack1.questions ?? []).map((x) => String(x.question._id));
const levels1 = (pack1.questions ?? []).map((x) => x.question.bloom);
check(`a pack of ${PACK_SIZE}: three at its working level (Understand), one below, one above`,
  ids1.length === PACK_SIZE && same(levels1, ['understand', 'understand', 'understand', 'remember', 'apply']), JSON.stringify(levels1));
check('every packed question is approved, of this room, and not the one on its screen',
  ids1.every((id) => byId.get(id)?.status === 'active' && String(byId.get(id)?.contentId) === String(content._id)) && !ids1.includes(P0),
  JSON.stringify(ids1));
check('each goes as a live question does: its text, its options, the phone\'s provenance and a sentence; no key at any depth',
  pack1.questions.every((x) => x.question.text && x.question.provenance?.text && typeof x.reason === 'string')
  && !KEY_FIELDS.test(JSON.stringify(pack1)) && !/"(solution|correct|score)"/.test(JSON.stringify(pack1)), JSON.stringify(pack1).slice(0, 300));
check('its expiry is six hours after it was sent, with the grace window and a plain note',
  Date.parse(pack1.expiresAt) - Date.parse(pack1.issuedAt) === 6 * 3600 * 1000 && pack1.graceMinutes === 10 && pack1.note === PACK_NOTE);
{
  const records = await repo.listQuestionPacks(sessionId, '21CS01');
  check('the pack was recorded for this phone before it was sent, its questions in order',
    records.length === 1 && same(records[0].questionIds.map(String), ids1) && records[0].issuedAt === pack1.issuedAt, JSON.stringify(records));
  const again = await ask(A);
  const after = await repo.listQuestionPacks(sessionId, '21CS01');
  check('asked again, the same pack: the same questions and times, and no second record',
    same(again.questions.map((x) => String(x.question._id)), ids1) && again.issuedAt === pack1.issuedAt && after.length === 1);
}

// ------------------------------------------------- a class question --

console.log('\na question put to the class leaves every pack');

let packNow = ids1;
{
  const asked = ids1[0];
  const classQ = next(A.s, 'class:question');
  const cq = await post(`/api/session/${code}/class-questions`, { questionId: asked });
  await classQ.catch(() => null);
  const during = await ask(A);
  const duringIds = during.questions.map((x) => String(x.question._id));
  check('while it runs, a pack never holds it; the rest of the pack is kept, first and in order',
    cq.status === 201 && !duringIds.includes(asked) && same(duringIds.slice(0, 4), ids1.slice(1)) && duringIds.length === PACK_SIZE,
    JSON.stringify({ status: cq.status, duringIds }));
  const closed = next(A.s, 'class:closed');
  const shut = await post(`/api/session/${code}/class-questions/${cq.body.id}/close`, { reveal: true });
  await closed.catch(() => null);
  const afterReveal = await ask(A);
  packNow = afterReveal.questions.map((x) => String(x.question._id));
  check('once its key is revealed to the class, it is never packed again', shut.status === 200 && !packNow.includes(asked)
    && same(packNow, duringIds), JSON.stringify(packNow));
}

// ------------------------------------------------------------ offline --

console.log('\noffline: three packed questions answered, sent later in one burst');

const before = hydrate(await repo.getProfile(sessionId, '21CS01'));
const issuedAtOf = async (qid) => (await repo.listQuestionPacks(sessionId, '21CS01'))
  .find((p) => p.questionIds.map(String).includes(qid))?.issuedAt;
A.s.disconnect();
await wait(100);

// What the phone did with no connection: Q1 right, Q2 wrong, Q3 right. Its clock
// says Q2 came first and Q1 last; the server receives Q1, Q2, Q3.
const [Q1, Q2, Q3] = packNow.slice(0, 3);
const offline = [
  { questionId: Q1, response: await responseFor(Q1, true), answerId: 'off-21CS01-q1', deviceAnsweredAt: '2026-11-19T10:03:00.000Z', right: true },
  { questionId: Q2, response: await responseFor(Q2, false), answerId: 'off-21CS01-q2', deviceAnsweredAt: '2026-11-19T10:01:00.000Z', right: false },
  { questionId: Q3, response: await responseFor(Q3, true), answerId: 'off-21CS01-q3', deviceAnsweredAt: '2026-11-19T10:02:00.000Z', right: true },
];

const A2 = await phone(code, '21CS01', { deliver: true });
{
  const quiet = await gather(A2.s, ['server:question'], 300);
  check('it rejoins with answers waiting: accepted, and served nothing until they are in', Boolean(A2.accepted)
    && !A2.accepted.deliverOnly && quiet.length === 0, JSON.stringify(quiet));
}
const replies = await Promise.all(offline.map((a) => send(A2, a)));
{
  check('each answer is replied to once, by its own answer id and question',
    replies.every((r, i) => r.event === 'server:result' && r.answerId === offline[i].answerId && r.questionId === offline[i].questionId),
    JSON.stringify(replies.map((r) => [r.event, r.answerId, r.questionId])));
  check('marked on the server: right, wrong, right', same(replies.map((r) => r.correct), [true, false, true]));
  check('the wrong one is final at its first go, though the room allows a retry: there was no screen to retry on',
    replies[1].retry !== true && replies[1].attempts === 1 && replies[1].solution !== undefined, JSON.stringify(replies[1]));
  check('none of them is called late', replies.every((r) => r.late === undefined));
  const rows = await repo.listAnswers({ sessionId, rollNo: '21CS01' });
  const mine = offline.map((a) => rows.filter((r) => r.answerKey === a.answerId));
  check('one row each, final', mine.every((m) => m.length === 1 && m[0].final === true), JSON.stringify(mine.map((m) => m.length)));
  const arrived = mine.map((m) => Date.parse(m[0].answeredAt));
  check('stored in the order they arrived, the server\'s clock, whatever the phone\'s said',
    arrived[0] <= arrived[1] && arrived[1] <= arrived[2], JSON.stringify(mine.map((m) => m[0].answeredAt)));
  check('each keeps the phone\'s own time beside it, for the record',
    same(mine.map((m) => m[0].deviceAnsweredAt), offline.map((a) => a.deviceAnsweredAt)), JSON.stringify(mine.map((m) => m[0].deviceAnsweredAt)));
  const served = await Promise.all(offline.map((a) => issuedAtOf(a.questionId)));
  check('each is taken as served when its pack was sent', same(mine.map((m) => m[0].servedAt), served), JSON.stringify({ rows: mine.map((m) => m[0].servedAt), served }));

  const after = hydrate(await repo.getProfile(sessionId, '21CS01'));
  const added = after.history.slice(before.history.length);
  check('the ladder took them in arrival order: Q1, Q2, Q3', same(added.map((h) => String(h.questionId)), [Q1, Q2, Q3])
    && same(added.map((h) => h.answerId), offline.map((a) => a.answerId)), JSON.stringify(added.map((h) => h.questionId)));
  // The same three, applied by hand in the order they arrived, give the stored profile.
  const settings = sessionSettings(await repo.getSession(sessionId));
  let byHand = before;
  for (const [i, a] of offline.entries()) {
    const qq = byId.get(a.questionId);
    byHand = applyAnswer(byHand, {
      questionId: a.questionId, bloom: qq.bloom, topic: qq.topic, kind: qq.kind, answerId: a.answerId, correct: a.right,
      score: a.right ? 1 : 0, at: mine[i][0].answeredAt, tries: 1, redemption: settings.redemption, adapt: settings.adapt,
    }).profile;
  }
  check('and moved it as they say in that order: levels and working level by hand',
    same(byHand.levels, after.levels) && byHand.workingLevel === after.workingLevel, JSON.stringify({ hand: byHand.workingLevel, stored: after.workingLevel }));
  check('the question on its screen is still pinned there', String(after.served?.questionId) === P0, JSON.stringify(after.served));

  // The outbox sends the first again: the stored result, no second row.
  const again = await send(A2, offline[0]);
  const rows2 = await repo.listAnswers({ sessionId, rollNo: '21CS01' });
  const after2 = await repo.getProfile(sessionId, '21CS01');
  check('sent again, the same answer: the stored result, no second row, the ladder unmoved',
    again.correct === true && rows2.filter((r) => r.answerKey === offline[0].answerId).length === 1 && rows2.length === rows.length
    && after2.history.length === after.history.length, JSON.stringify({ again, rows: rows2.length }));

  const resumed = next(A2.s, 'server:question');
  A2.s.emit('student:next');
  const q = await resumed;
  check('then it asks for its next question: the one still on its screen, resumed', String(q.question._id) === P0 && q.resumed === true);

  const packAfter = await ask(A2);
  const idsAfter = packAfter.questions.map((x) => String(x.question._id));
  check('its next pack holds none of what it answered, nor the question on its screen',
    !idsAfter.some((id) => [Q1, Q2, Q3, P0].includes(id)) && idsAfter.length > 0, JSON.stringify(idsAfter));
  packNow = idsAfter;
}

// --------------------------------------------------------- room close --

console.log('\nthe room closes with answers still on the phone');

{
  // Offline again, with three more answers: the question on its screen, a
  // packed one, and one no server ever gave it.
  const records = await repo.listQuestionPacks(sessionId, '21CS01');
  const packedEver = new Set(records.flatMap((p) => p.questionIds.map(String)));
  const answeredIds = new Set((await repo.getProfile(sessionId, '21CS01')).history.map((h) => String(h.questionId)));
  const asked = new Set((await repo.listClassQuestions(sessionId)).map((c) => String(c.questionId)));
  const Q4 = packNow[0];
  const F = bank.find((x) => x.status === 'active' && !packedEver.has(String(x._id)) && !answeredIds.has(String(x._id))
    && String(x._id) !== P0 && !asked.has(String(x._id)));
  const late = {
    pin: { questionId: P0, response: await responseFor(P0, true), answerId: 'late-21CS01-pin', deviceAnsweredAt: '2026-11-19T10:20:00.000Z' },
    never: { questionId: String(F._id), response: await responseFor(String(F._id), true), answerId: 'late-21CS01-never', deviceAnsweredAt: '2026-11-19T10:21:00.000Z' },
    packed: { questionId: Q4, response: await responseFor(Q4, true), answerId: 'late-21CS01-packed', deviceAnsweredAt: '2026-11-19T10:22:00.000Z' },
  };
  A2.s.disconnect();
  await wait(100);
  const shut = await post(`/api/session/${code}/close`, {});
  const closedAt = (await repo.getSession(sessionId)).closedAt;
  check('the professor closes the room while the phone is away', shut.status === 200 && Boolean(closedAt));

  const plain = await phone(code, '21CS01', { expectQuestion: false });
  check('back without saying it holds answers, the closed room refuses it, as before',
    plain.rejected?.reason === 'That session has already been closed.', JSON.stringify(plain.rejected));
  plain.s.disconnect();
  const stranger = await phone(code, '21CS99', { deliver: true });
  check('a roll number with nothing in the room cannot come in to send anything',
    stranger.rejected?.reason === 'That session has already been closed.', JSON.stringify(stranger.rejected));
  stranger.s.disconnect();

  const D = await phone(code, '21CS01', { deliver: true });
  check('back with answers to send, within the window: let in only to send them, and told so plainly',
    D.accepted?.deliverOnly === true && D.accepted.message === DELIVER_MESSAGE
    && Date.parse(D.accepted.deliverUntil) === Date.parse(closedAt) + GRACE_MS, JSON.stringify(D.accepted));
  const quiet = await gather(D.s, ['server:question'], 250);
  check('and given no new question', quiet.length === 0);

  const rPin = await send(D, late.pin);
  check('the question on its screen before the close, arriving inside the window: marked and counted, and told so',
    rPin.event === 'server:result' && rPin.correct === true && rPin.late === true && rPin.message === LATE_COUNTED_MESSAGE,
    JSON.stringify(rPin));
  const rNever = await send(D, late.never);
  check('a question it was never given: kept, not counted, told why, and told no mark',
    rNever.event === 'server:kept' && rNever.counted === false && rNever.late === true && rNever.message === LATE_NOT_SERVED_MESSAGE
    && !('correct' in rNever) && !('solution' in rNever) && !('score' in rNever), JSON.stringify(rNever));
  {
    const refused = next(D.s, 'server:refused');
    D.s.emit('student:answer', { questionId: String(OTHER._id), response: 0, answerId: 'late-21CS01-other' });
    const r = await refused.catch(() => null);
    const stored = (await repo.listAnswers({ sessionId })).some((a) => a.answerKey === 'late-21CS01-other');
    check('an answer to a question this room never asks: refused for good, said plainly, and not stored under the room',
      r?.answerId === 'late-21CS01-other' && r?.message === NOT_THIS_ROOM_MESSAGE && !stored, JSON.stringify(r));
  }

  // The window passes while the phone is still sending: the clock moves on 11
  // minutes, so the last answer reaches the server too late.
  moveClock(GRACE_MS + MINUTE);
  await wait(300);
  check('the phone\'s connection outlives the moved clock', D.s.connected === true);
  const rPacked = await send(D, late.packed);
  check('a packed question arriving past the window: kept, not counted, told why',
    rPacked.event === 'server:kept' && rPacked.counted === false && rPacked.message === LATE_TOO_LATE_MESSAGE
    && !('solution' in rPacked), JSON.stringify(rPacked));

  const rows = await repo.listAnswers({ sessionId, rollNo: '21CS01' });
  const row = (key) => rows.filter((r) => r.answerKey === key);
  check('all three are stored, one row each', ['pin', 'never', 'packed'].every((k) => row(late[k].answerId).length === 1));
  check('the counted one is final with its mark; the two not counted are kept with a plain detail and no mark',
    row(late.pin.answerId)[0].final === true && row(late.pin.answerId)[0].correct === true
    && [late.never, late.packed].every((a) => {
      const r = row(a.answerId)[0];
      return r.final === false && r.detail === AFTER_CLOSE_DETAIL && r.correct === null && r.score === null && r.autoCorrect === true;
    }), JSON.stringify(rows.slice(-3)));
  const prof = hydrate(await repo.getProfile(sessionId, '21CS01'));
  const histIds = prof.history.map((h) => String(h.questionId));
  check('only the counted one is in the ladder; the pin is spent', histIds.includes(P0) && !histIds.includes(late.never.questionId)
    && !histIds.includes(late.packed.questionId) && prof.served === null, JSON.stringify(prof.served));

  const countBefore = rows.length;
  const rPinAgain = await send(D, late.pin);
  const rPackedAgain = await send(D, late.packed);
  const rowsAgain = await repo.listAnswers({ sessionId, rollNo: '21CS01' });
  check('each sent again: the same answer as before, and no second row',
    rPinAgain.event === 'server:result' && rPinAgain.correct === true && rPackedAgain.event === 'server:kept'
    && rPackedAgain.message === LATE_TOO_LATE_MESSAGE && rowsAgain.length === countBefore, `${countBefore} -> ${rowsAgain.length}`);

  const nothing = next(D.s, 'session:closed');
  D.s.emit('student:pack', {});
  const closedPack = await nothing.then(() => true).catch(() => false);
  const nothingNext = next(D.s, 'session:closed');
  D.s.emit('student:next');
  check('a phone sending what it saved is given no pack and no question: the room is closed',
    closedPack && (await nothingNext.then(() => true).catch(() => false)));
  D.s.disconnect();

  // O2 (the review of 19 Nov 2026): every late answer that reaches the server is
  // stored, not only those inside the window; before, the phone was refused at
  // the door and its answers never reached the server at all.
  const tooLate = await phone(code, '21CS01', { deliver: true });
  check('past the window the room still lets it in, only to send what it saved, and told so plainly',
    tooLate.accepted?.deliverOnly === true && tooLate.accepted.message === DELIVER_MESSAGE && !tooLate.rejected,
    JSON.stringify(tooLate.rejected ?? tooLate.accepted));
  {
    const askedNow = new Set((await repo.listClassQuestions(sessionId)).map((c) => String(c.questionId)));
    const F2 = bank.find((x) => x.status === 'active' && !histIds.includes(String(x._id)) && String(x._id) !== late.never.questionId
      && String(x._id) !== late.packed.questionId && !askedNow.has(String(x._id)));
    const after = { questionId: String(F2._id), response: await responseFor(String(F2._id), true), answerId: 'late-21CS01-afterwindow',
      deviceAnsweredAt: '2026-11-19T10:23:00.000Z' };
    const r = tooLate.accepted ? await send(tooLate, after).catch(() => null) : null;
    const row = (await repo.listAnswers({ sessionId, rollNo: '21CS01' })).filter((a) => a.answerKey === after.answerId);
    check('an answer sent past the window is stored, kept and not counted, and the phone is told why with no mark',
      r?.event === 'server:kept' && r.counted === false && r.message === LATE_TOO_LATE_MESSAGE && !('solution' in r)
      && row.length === 1 && row[0].final === false && row[0].correct === null && row[0].detail === AFTER_CLOSE_DETAIL,
      JSON.stringify({ r, row }));
  }
  tooLate.s.disconnect();

  const record = await get(`/api/session/${code}/answers`);
  const kept = (record.body.items ?? []).filter((i) => i.detail === AFTER_CLOSE_DETAIL);
  check('the professor\'s record of the room keeps all three, saying why, with the machine\'s reading beside an empty mark',
    record.status === 200 && kept.length === 3 && kept.every((i) => i.final === false && i.correct === null && i.auto?.correct === true),
    JSON.stringify(kept.map((i) => [i.final, i.correct, i.auto])));
  const items = await get(`/api/session/${code}/items`);
  const counted = (await repo.listAnswers({ sessionId })).filter((r) => r.final !== false && !r.ungraded && !r.classQuestionId).length;
  check('and the item statistics count neither: only the final answers that counted',
    items.status === 200 && items.body.counted?.answers === counted
    && !(items.body.items ?? []).some((i) => i.questionId === late.never.questionId), JSON.stringify(items.body.counted));
}

// ---------------------------------------------- a long interruption --

console.log('\na phone away for hours finds its place in a room still open');

{
  const room2 = await post('/api/session', { contentId: String(content._id) });
  const code2 = room2.body.code;
  const B = await phone(code2, '21CS02');
  const pinB = String(B.question?._id ?? '');
  const packB = await ask(B);
  B.s.disconnect();
  moveClock(5 * HOUR);
  const back = await phone(code2, '21CS02');
  const packBack = await ask(back);
  check('five hours later: the same question on its screen, resumed', pinB !== '' && String(back.question?._id) === pinB
    && back.served?.resumed === true);
  check('and the same pack, its questions and the time it was sent: it lasts six hours', packBack.issuedAt === packB.issuedAt
    && same(packBack.questions.map((x) => x.question._id), packB.questions.map((x) => x.question._id)));
  back.s.disconnect();
  moveClock(2 * HOUR);
  const later = await phone(code2, '21CS02');
  const fresh = await ask(later);
  const records = await repo.listQuestionPacks(room2.body.sessionId, '21CS02');
  check('seven hours later: still the same question on its screen, and a pack chosen afresh from where it stands',
    String(later.question?._id) === pinB && fresh.issuedAt !== packB.issuedAt && records.length === 2
    && Date.parse(fresh.issuedAt) - Date.parse(packB.issuedAt) >= 7 * HOUR, JSON.stringify(records.map((r) => r.issuedAt)));
  const pB = await repo.getProfile(room2.body.sessionId, '21CS02');
  check('the store held its place throughout: the pin on its profile, every pack as a record',
    String(pB.served?.questionId) === pinB);
  // An answer to a question from the expired pack is still one it was given.
  const old = String(packB.questions[0].question._id);
  const r = await send(later, { questionId: old, response: await responseFor(old, true), answerId: 'old-pack-21CS02-1' });
  const row = (await repo.listAnswers({ sessionId: room2.body.sessionId, rollNo: '21CS02' })).find((a) => a.answerKey === 'old-pack-21CS02-1');
  check('an answer to a question from the expired pack is still marked as served, from when that pack was sent',
    r.event === 'server:result' && r.correct === true && row?.final === true && row?.servedAt === packB.issuedAt, JSON.stringify(row?.servedAt));
  later.s.disconnect();
}

// ------------------------------------------------------------ the cap --

console.log('\na pack is sized to the room\'s cap, and an answer past it is kept, not counted');

{
  const room3 = await post('/api/session', { contentId: String(content._id), questionsPerStudent: 3 });
  const C = await phone(room3.body.code, '21CS03');
  const pinC = String(C.question?._id ?? '');
  const packC = await ask(C);
  const idsC = packC.questions.map((x) => String(x.question._id));
  check('the room asks each student 3 questions: with one on its screen, the pack holds 2', idsC.length === 2 && !idsC.includes(pinC),
    JSON.stringify(idsC));
  // Two answers reach the server live after the pack was sent: the question on
  // its screen, and one more of the room's questions, sent here by id (another
  // of the student's devices would do the same). The pack's two then arrive
  // from the outbox, and only one of them fits.
  const other = bank.find((q) => q.status === 'active' && ![pinC, ...idsC].includes(String(q._id)));
  await send(C, { questionId: pinC, response: await responseFor(pinC, true), answerId: 'cap-21CS03-1' });
  await send(C, { questionId: String(other._id), response: await responseFor(String(other._id), true), answerId: 'cap-21CS03-2' });
  const finished = next(C.s, 'server:exhausted');
  const [fits, over] = await Promise.all(idsC.map(async (qid, i) => send(C, {
    questionId: qid, response: await responseFor(qid, true), answerId: `cap-21CS03-p${i}`, deviceAnsweredAt: '2026-11-19T10:00:00.000Z',
  })));
  const done = await finished.catch(() => null);
  check('the first fits and is marked', fits.event === 'server:result' && fits.correct === true, JSON.stringify(fits));
  check('the second is past the cap: kept, not counted, told why and told no mark; then told it has finished, as before',
    over.event === 'server:kept' && over.counted === false && over.message === overCapMessage(3) && !('solution' in over)
    && /3 questions/.test(done?.reason ?? ''), JSON.stringify({ over, done: done?.reason }));
  const rows = await repo.listAnswers({ sessionId: room3.body.sessionId, rollNo: '21CS03' });
  const row = rows.find((a) => a.answerKey === 'cap-21CS03-p1');
  const prof = await repo.getProfile(room3.body.sessionId, '21CS03');
  check('it is stored, not discarded: final false, a plain detail, no mark; the ladder holds 3',
    row?.final === false && row.detail === OVER_CAP_DETAIL && row.correct === null && row.autoCorrect === true
    && prof.history.length === 3, JSON.stringify({ row, n: prof.history.length }));
  const again = await send(C, { questionId: idsC[1], response: await responseFor(idsC[1], true), answerId: 'cap-21CS03-p1' });
  check('sent again: told the same, no second row', again.event === 'server:kept' && again.message === overCapMessage(3)
    && (await repo.listAnswers({ sessionId: room3.body.sessionId, rollNo: '21CS03' })).length === rows.length);
  C.s.disconnect();
}

// ---------------------------------------------------------------- keys --

console.log('\nwhat every phone received');

{
  const offenders = phoneLog.filter((e) => KEY_FIELDS.test(JSON.stringify(e.payload ?? {})));
  check(`no event any phone received (${phoneLog.length} of them) carried a key field`, offenders.length === 0,
    JSON.stringify(offenders.map((e) => e.event)));
  // A solution is told only in the reply to the phone's own answer to that question.
  const early = phoneLog.filter((e) => e.payload && 'solution' in e.payload && e.payload.solution !== null
    && !(e.event === 'server:result' && e.payload.questionId));
  check('a solution only ever came in the reply to that phone\'s own answer to that question', early.length === 0,
    JSON.stringify(early.map((e) => e.event)));
  const kept = phoneLog.filter((e) => e.event === 'server:kept');
  check('a kept answer was never told a mark', kept.length >= 3
    && kept.every((e) => !('solution' in e.payload) && !('correct' in e.payload) && !('score' in e.payload)), `${kept.length} kept`);
  const packs = phoneLog.filter((e) => e.event === 'server:pack');
  check('no pack carried a solution, a mark or a key', packs.length >= 5
    && packs.every((e) => !/"(solution|correct|score)"/.test(JSON.stringify(e.payload))), `${packs.length} packs`);
}

// ------------------------------------------------------------- archive --

// ------------------------------------------- the review of 19 Nov 2026 --

console.log('\nthe same question again: in upper case, or a second answer after it was marked');

{
  // Postgres finds a uuid, and Mongo an ObjectId, whatever the case of its
  // letters; the in-process store looks ids up exactly. Made to find them as
  // the hosted stores do, for this section only.
  const exactGet = repo.getQuestion;
  repo.getQuestion = async (id) => exactGet(String(id ?? '').toLowerCase());
  const roomU = await post('/api/session', { contentId: String(content._id), reattempts: 0 });
  const sidU = roomU.body.sessionId;
  const U = await phone(roomU.body.code, '21CS11');
  const qid = String(U.question?._id ?? '');
  const first = await send(U, { questionId: qid, response: await responseFor(qid, false), answerId: 'case-21CS11-1' });
  const upper = await send(U, { questionId: qid.toUpperCase(), response: await responseFor(qid, true), answerId: 'case-21CS11-2' })
    .catch(() => null);
  const prof = hydrate(await repo.getProfile(sidU, '21CS11'));
  const rows = await repo.listAnswers({ sessionId: sidU, rollNo: '21CS11' });
  check('marked wrong once; the same id in upper case with the right answer is the same question: kept, not counted, no mark',
    first.correct === false && upper?.event === 'server:kept' && upper.counted === false && upper.message === ANSWERED_AGAIN_MESSAGE
    && !('correct' in upper) && !('solution' in upper), JSON.stringify({ first: first.correct, upper }));
  check('one entry in the ladder and one final row for it; the second answer stored beside it, saying why, with no mark',
    prof.history.filter((h) => String(h.questionId).toLowerCase() === qid).length === 1 && prof.history.length === 1
    && rows.filter((r) => r.final !== false).length === 1
    && rows.some((r) => r.answerKey === 'case-21CS11-2' && r.final === false && r.detail === ANSWERED_AGAIN_DETAIL && r.correct === null
      && String(r.questionId) === qid && r.autoCorrect === true),
    JSON.stringify({ history: prof.history.map((h) => h.questionId), rows: rows.map((r) => [r.answerKey, r.final, r.detail]) }));

  // A packed question answered (from the outbox, say), then its other copy.
  const packU = await ask(U);
  const pq = String(packU.questions?.[0]?.question?._id ?? '');
  const once = await send(U, { questionId: pq, response: await responseFor(pq, true), answerId: 'again-21CS11-1' });
  const twice = await send(U, { questionId: pq, response: await responseFor(pq, false), answerId: 'again-21CS11-2',
    deviceAnsweredAt: '2026-11-19T11:00:00.000Z' });
  const rowsAfter = await repo.listAnswers({ sessionId: sidU, rollNo: '21CS11' });
  const kept = rowsAfter.find((r) => r.answerKey === 'again-21CS11-2');
  check('an answer to a question already marked is stored, not dropped: kept, not counted, told so and told no mark',
    once.correct === true && twice.event === 'server:kept' && twice.message === ANSWERED_AGAIN_MESSAGE && !('correct' in twice)
    && rowsAfter.length === rows.length + 2 && kept?.final === false && kept.detail === ANSWERED_AGAIN_DETAIL && kept.correct === null
    && kept.deviceAnsweredAt === '2026-11-19T11:00:00.000Z', JSON.stringify({ twice, kept }));
  const again = await send(U, { questionId: pq, response: await responseFor(pq, false), answerId: 'again-21CS11-2' });
  check('sent again under the same key: told the same, no second row',
    again.event === 'server:kept' && again.message === ANSWERED_AGAIN_MESSAGE
    && (await repo.listAnswers({ sessionId: sidU, rollNo: '21CS11' })).length === rowsAfter.length);
  // The same answer as the one marked, under a new key: a double-tap.
  const tap = await send(U, { questionId: pq, response: await responseFor(pq, true), answerId: 'again-21CS11-3' });
  const tapRow = (await repo.listAnswers({ sessionId: sidU, rollNo: '21CS11' })).find((r) => r.answerKey === 'again-21CS11-3');
  check('the same answer sent again under a new key (a double-tap) is told its mark, as always, and is stored, kept and not counted',
    tap.event === 'server:result' && tap.correct === true && tapRow?.final === false && tapRow.detail === ANSWERED_AGAIN_DETAIL
    && hydrate(await repo.getProfile(sidU, '21CS11')).history.length === 2, JSON.stringify({ tap: tap.event, tapRow }));
  const items = await get(`/api/session/${roomU.body.code}/items`);
  check('and no report counts it: the room\'s item statistics count the two marked answers only',
    items.status === 200 && items.body.counted?.answers === 2, JSON.stringify(items.body.counted));
  U.s.disconnect();
  repo.getQuestion = exactGet;
}

console.log('\na question the pin moved off is still one the phone was given');

{
  const roomS = await post('/api/session', { contentId: String(content._id), reattempts: 0 });
  const sidS = roomS.body.sessionId;
  // A phone whose answer to the question on its screen fails to save once (the
  // store refuses that one write), and which then taps Next question, as told.
  async function failThenNext(rollNo) {
    const p = await phone(roomS.body.code, rollNo);
    const q1 = String(p.question?._id ?? '');
    const servedQ1 = (await repo.getProfile(sidS, rollNo))?.served?.at;
    const realRecord = repo.recordAnswer;
    repo.recordAnswer = async () => { repo.recordAnswer = realRecord; throw new Error('the store refused one write'); };
    const refused = next(p.s, 'session:rejected');
    const answer = { questionId: q1, response: await responseFor(q1, true), answerId: `pin-${rollNo}-q1`, deviceAnsweredAt: '2026-11-19T11:10:00.000Z' };
    p.s.emit('student:answer', answer);
    const said = await refused.catch(() => null);
    repo.recordAnswer = realRecord;
    // The selector may hand the same question back; asked until it does not.
    let q2 = q1;
    for (let i = 0; i < 20 && q2 === q1; i += 1) {
      const nextQ = next(p.s, 'server:question');
      p.s.emit('student:next');
      q2 = String((await nextQ).question._id);
    }
    return { p, q1, q2, servedQ1, answer, said };
  }
  const S = await failThenNext('21CS12');
  const T = await failThenNext('21CS15');
  check('each phone was told its answer did not save, and moved on to another question',
    /did not save/.test(S.said?.reason ?? '') && S.q2 !== S.q1 && /did not save/.test(T.said?.reason ?? '') && T.q2 !== T.q1);

  // T's outbox sends its first answer while the room is open: counted, and the
  // question on its screen stays pinned.
  const tCounted = await send(T.p, T.answer);
  const tProfile = await repo.getProfile(sidS, '21CS15');
  check('an outbox answer to the question it moved off, while the room is open: counted, the screen\'s question still pinned',
    tCounted.event === 'server:result' && tCounted.correct === true && String(tProfile.served?.questionId) === T.q2,
    JSON.stringify({ tCounted, served: tProfile.served }));
  S.p.s.disconnect();
  T.p.s.disconnect();
  await wait(100);
  const shut = await post(`/api/session/${roomS.body.code}/close`, {});
  check('the room closes', shut.status === 200);

  const S2 = await phone(roomS.body.code, '21CS12', { deliver: true });
  const sLate = await send(S2, S.answer);
  const sRow = (await repo.listAnswers({ sessionId: sidS, rollNo: '21CS12' })).find((a) => a.answerKey === S.answer.answerId);
  check('its first answer arriving after the close, inside the window: a question it was given, so marked and counted',
    sLate.event === 'server:result' && sLate.correct === true && sLate.message === LATE_COUNTED_MESSAGE && sRow?.final === true,
    JSON.stringify({ sLate, sRow: sRow && [sRow.final, sRow.detail] }));
  check('and its row says when that question was served, not when the next one was',
    Boolean(S.servedQ1) && sRow?.servedAt === S.servedQ1, JSON.stringify({ row: sRow?.servedAt, servedQ1: S.servedQ1 }));
  S2.s.disconnect();
  const T2 = await phone(roomS.body.code, '21CS15', { deliver: true });
  const tLate = await send(T2, { questionId: T.q2, response: await responseFor(T.q2, true), answerId: 'pin-21CS15-q2' });
  check('the other phone\'s answer to the question still on its screen, inside the window: counted',
    tLate.event === 'server:result' && tLate.correct === true && tLate.message === LATE_COUNTED_MESSAGE, JSON.stringify(tLate));
  T2.s.disconnect();
}

console.log('\none phone asking for packs without end holds up nobody else');

{
  const roomF = await post('/api/session', { contentId: String(content._id) });
  const F = await phone(roomF.body.code, '21CS13');
  const G = await phone(roomF.body.code, '21CS14');
  // Each read of a phone's packs made slow, as a hosted store's round trips are.
  const realList = repo.listQuestionPacks;
  repo.listQuestionPacks = async (...args) => { await wait(20); return realList(...args); };
  const floodReplies = [];
  F.s.on('server:pack', (p) => floodReplies.push(p));
  for (let i = 0; i < 300; i += 1) F.s.emit('student:pack', {});
  await wait(60);
  const t0 = Date.now();
  const gPack = await ask(G).catch(() => null);
  const gMs = Date.now() - t0;
  const asked = bank.find((x) => x.status === 'active' && x.bloom === 'understand' && x.kind === 'mcq');
  const t1 = Date.now();
  const cq = await post(`/api/session/${roomF.body.code}/class-questions`, { questionId: String(asked._id) });
  const cqMs = Date.now() - t1;
  await wait(600);
  repo.listQuestionPacks = realList;
  check('another phone\'s pack comes back at once (under a second), not after the flood',
    Boolean(gPack?.questions?.length) && gMs < 1000, `${gMs} ms`);
  check('and the professor\'s class question starts at once (under a second)', cq.status === 201 && cqMs < 1000, `${cq.status}, ${cqMs} ms`);
  // One at a time per phone, and every ask that arrives meanwhile is one more
  // answer after it: two when all 300 land while the first is out, a few more
  // if the network spreads them out. Never one answer per ask.
  check('the flooding phone\'s 300 asks are folded into a handful of answers, not 300', floodReplies.length >= 1 && floodReplies.length <= 5,
    `${floodReplies.length} replies`);
  F.s.disconnect();
  G.s.disconnect();
}

console.log('\nasking for a new question and a pack, round after round, writes no new pack');

{
  const roomR = await post('/api/session', { contentId: String(content._id) });
  const H = await phone(roomR.body.code, '21CS16');
  const pins = new Set([String(H.question?._id ?? '')]);
  for (let i = 0; i < 60; i += 1) {
    const q = next(H.s, 'server:question');
    H.s.emit('student:next');
    pins.add(String((await q).question._id));
    await ask(H);
  }
  const records = await repo.listQuestionPacks(roomR.body.sessionId, '21CS16');
  const answered = (await repo.listAnswers({ sessionId: roomR.body.sessionId, rollNo: '21CS16' })).length;
  check('sixty rounds with no answer, the pin moving each time: one pack record, however often the pin met the pack',
    answered === 0 && records.length === 1 && pins.size > 1, `${records.length} records, ${pins.size} questions pinned`);
  H.s.disconnect();
}

{
  // The key scan above, again over everything every phone has received since.
  const offenders = phoneLog.filter((e) => KEY_FIELDS.test(JSON.stringify(e.payload ?? {}))
    || (e.event === 'server:kept' && ('solution' in e.payload || 'correct' in e.payload || 'score' in e.payload)));
  check(`still no key field in any event, and no mark on a kept answer (${phoneLog.length} events)`, offenders.length === 0,
    JSON.stringify(offenders.map((e) => e.event)));
}

console.log('\nthe deleted room\'s archive');

{
  const gone = await call('DELETE', `/api/session/${code}?confirm=${code}`);
  const archived = gone.status === 200 ? await repo.getRoomArchive(gone.body.archive?.id) : null;
  const back = archived ? decodeRoomArchive(archived.data) : null;
  const timed = (back?.answers ?? []).filter((a) => a.rollNo === '21CS01' && a.deviceAnsweredAt);
  const sent = ['10:01', '10:02', '10:03', '10:20', '10:21', '10:22', '10:23'].map((t) => `2026-11-19T${t}:00.000Z`);
  check('every answer that waited on the phone keeps the phone\'s own time, exactly as it was stored',
    gone.status === 200 && same(timed.map((a) => a.deviceAnsweredAt).sort(), sent), JSON.stringify(timed.map((a) => a.deviceAnsweredAt)));
  check('and the three not counted, as they were', (back?.answers ?? []).filter((a) => a.detail === AFTER_CLOSE_DETAIL).length === 3);
  check('the room\'s packs went with it', (await repo.listQuestionPacks(sessionId, '21CS01')).length === 0);
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.fetch = realFetch;
globalThis.Date = RealDate;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
