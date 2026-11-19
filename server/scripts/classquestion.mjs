// Phase 5 - the confidence tap and a class question (pause, discuss, re-vote), end to end.
//
//   node server/scripts/classquestion.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with eight scripted phones over
// Socket.io, a teacher's screen and a projector, and checks:
//
//   who         another professor gets the same 404 as for a room that does
//               not exist, an HOD of the department reads and is refused every
//               write, a caller with no credentials is a 401, and a question
//               whose options no phone can vote on is refused with a sentence
//   round 1     the professor puts one approved question to every phone; seven
//               vote with confidence taps, one changes her vote; while it is
//               open the professor sees how many voted, not what; a phone that
//               reconnects is sent the question with its own vote
//   pause       round 1 closes: its distribution, share right and taps, worked
//               out by hand; each phone is told with its own vote (Phase 5
//               follow-up); a vote that comes after the pause is kept and not
//               counted; a phone that joins now is sent the question where it
//               stands
//   round 2     the re-vote: the phone that missed round 1 votes; a second
//               server over the same store sends a joining phone the question
//               as it stands (nothing of it is held in a server's memory)
//   close       with the key revealed: the changes, worked out by hand (2 wrong
//               to right, 1 right to wrong, 1 right both times, 1 the same
//               wrong, 1 another wrong, 1 in round 1 only, 1 in round 2 only)
//   evidence    every vote is a stored row, none overwritten: round, final,
//               the tap as stored, the late one; no level moved
//   key         nothing a phone or the projector received carried the key
//               before the reveal, and the question is never served to a phone
//               on its own in the room again; an answer a phone sends to it as
//               its own question afterwards is kept, never counted
//   confidence  the same answers with and without taps leave two students on
//               identical levels; the room's counts and the student card's,
//               by hand; a tap the server does not know is stored as none
//   room close  closes its running class question without a reveal; with the
//               store failing at that step, the close still answers and the
//               phones and the projector are still told (Phase 5 follow-up)
//   archive     a deleted room's archive keeps its class question and its votes
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. So,
// as server/scripts/roster.mjs does, the server is pointed at
// http://supabase.invalid (a name that can never resolve) and every request to
// it is answered here, in-process, by a stand-in for the three calls the server
// makes about accounts. Any other request off this machine is refused outright.
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
const { decodeRoomArchive } = await import(`${SRC}services/archive.js`);
const { LATE_DETAIL, OWN_QUESTION_DETAIL } = await import(`${SRC}services/classQuestions.js`);

// The in-process store and no model, whatever .env says.
config.supabase.url = '';
config.supabase.serviceKey = '';
config.supabase.anonKey = '';
config.mongoUri = '';
config.gemini.apiKey = '';
await initStore({ log: () => {} });
const repo = getRepo();

// ------------------------------------------------- the accounts stand-in --
//
// HOD (CSE) <- professor A; professor B under another HOD (ECE).

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'c0000000-0000-4000-8000-000000000001',
  profA: 'c0000000-0000-4000-8000-000000000002',
  profB: 'c0000000-0000-4000-8000-000000000003',
  hodOther: 'c0000000-0000-4000-8000-000000000004',
};
const account = (id, role, department, reportsTo) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-CQTS0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: null, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
].map((a) => [a.id, a]));
const TOKENS = { hod: 'tok-hod', profA: 'tok-prof-a', profB: 'tok-prof-b', hodOther: 'tok-hod-other' };
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
    throw new Error(`classquestion.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by classquestion.mjs: ${url.pathname}` }, 404);
};
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'classquestion-test-service-key';

// -------------------------------------------------------------- server --

async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  attachSockets(io);
  app.set('io', io);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, io, base: `http://127.0.0.1:${server.address().port}` };
}
const main = await startServer();
const base = main.base;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `as`: one of the TOKENS' names, or null for no credentials. */
async function call(method, path, { body, as = 'profA' } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = (path, as) => call('GET', path, { as });
const post = (path, body, as) => call('POST', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });

// ------------------------------------------------------------- sockets --

/** Every event every phone and projector received, to look for the key in afterwards. */
const phoneLog = [];
const wallLog = [];

function connect(url = base) {
  const s = ioClient(url, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

/** The next event of one name on one socket that matches, registered before the act that causes it. */
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

const phones = new Map(); // rollNo -> { s, question }

/** A phone joins; resolves once it has its own question (and, with `expectClass`, the class question). */
async function join(code, rollNo, { url = base, expectClass = false } = {}) {
  const s = await connect(url);
  s.onAny((event, payload) => phoneLog.push({ rollNo, event, payload }));
  const p = { s, rollNo, question: null };
  s.on('server:question', (q) => { p.question = q.question; });
  const accepted = next(s, 'session:accepted');
  const first = next(s, 'server:question');
  const cls = expectClass ? next(s, 'class:question') : null;
  s.emit('student:join', { code, rollNo, name: `Student ${rollNo.slice(-1)}` });
  p.accepted = await accepted;
  await first;
  p.classState = cls ? await cls : null;
  phones.set(rollNo, p);
  return p;
}

/** Answer a phone's own question, right or wrong, read from the store's key. */
async function answerOwn(p, { right = true, confidence } = {}) {
  const q = await repo.getQuestion(p.question._id);
  let response;
  if (q.kind === 'truefalse') response = right ? q.answerBool : !q.answerBool;
  else if (q.kind === 'mcq' || q.kind === 'poll') response = right ? q.answerIdx : (q.answerIdx + 1) % q.options.length;
  else response = [0];
  const result = next(p.s, 'server:result');
  p.s.emit('student:answer', { questionId: String(q._id), response, answerId: `ans-${p.rollNo}-${q._id}`.slice(0, 64), ...(confidence !== undefined ? { confidence } : {}) });
  return { q, result: await result };
}

let voteSeq = 0;
/** One vote: resolves with the phone's acknowledgement. */
async function castVote(p, cqId, round, response, confidence) {
  voteSeq += 1;
  const ack = next(p.s, 'class:vote');
  p.s.emit('student:vote', {
    classQuestionId: cqId, round, response, answerId: `vote-${voteSeq}-${p.rollNo}`, ...(confidence ? { confidence } : {}),
  });
  return ack;
}

// ------------------------------------------------------------ fixtures --

const content = await repo.createContent({ title: 'Networks', kind: 'syllabus', rawText: '', topics: ['Layers'], ownerId: ID.profA });
const own = await repo.insertQuestions(Array.from({ length: 8 }, (_, i) => ({
  contentId: content._id, topic: 'Layers', text: `Which layer is number ${i}?`, kind: 'mcq',
  options: ['Network', 'Transport', 'Link', 'Physical'], answerIdx: 1, bloom: 'understand', source: 'llm', status: 'active',
})));
const [CQ_Q, TF_Q, MATCH_Q] = await repo.insertQuestions([
  { contentId: content._id, topic: 'Layers', text: 'Which layer routes packets between networks?', kind: 'mcq',
    options: ['Link', 'Transport', 'Network', 'Physical'], answerIdx: 2, bloom: 'remember', source: 'teacher', status: 'active' },
  { contentId: content._id, topic: 'Layers', text: 'TCP is a transport-layer protocol.', kind: 'truefalse', answerBool: true,
    bloom: 'remember', source: 'llm', status: 'active' },
  { contentId: content._id, topic: 'Layers', text: 'Match each protocol to its layer.', kind: 'match',
    pairs: [{ left: 'IP', right: 'Network' }, { left: 'TCP', right: 'Transport' }], bloom: 'create', source: 'llm', status: 'active' },
]);
const other = await repo.createContent({ title: 'Elsewhere', kind: 'syllabus', rawText: '', topics: ['X'], ownerId: ID.profA });
const [OTHER_Q] = await repo.insertQuestions([{ contentId: other._id, topic: 'X', text: 'Not this room\'s', kind: 'mcq',
  options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'remember', source: 'llm', status: 'active' }]);
const NOWHERE_CODE = 'ZZZZZZ';
const KEY_FIELDS = /answerIdx|answerBool|answerIdxs|"pairs"/;

// --------------------------------------------------- confidence, apart --

console.log('\nconfidence: information only');

const room2 = await post('/api/session', { contentId: String(content._id) });
const code2 = room2.body.code;
{
  // X1 taps on every answer; X2 sends a tap the server does not know, then none.
  // Both give the same answers: right, right, wrong, right.
  const x1 = await join(code2, '22CS01');
  const x2 = await join(code2, '22CS02');
  check('a phone is told the three confidence taps when it joins',
    same(x1.accepted.confidence?.map((c) => c.id), ['sure', 'think_so', 'guessing']), JSON.stringify(x1.accepted.confidence));
  const pattern = [true, true, false, true];
  const taps = ['sure', 'think_so', 'guessing', 'sure'];
  const r1 = [];
  const r2 = [];
  const asked = { '22CS01': [], '22CS02': [] };
  for (let i = 0; i < 4; i += 1) {
    const a1 = await answerOwn(x1, { right: pattern[i], confidence: taps[i] });
    r1.push(a1.result);
    asked['22CS01'].push(String(a1.q._id));
    const a2 = await answerOwn(x2, { right: pattern[i], ...(i === 0 ? { confidence: 'maybe' } : {}) });
    r2.push(a2.result);
    asked['22CS02'].push(String(a2.q._id));
    if (i < 3) {
      const n1 = next(x1.s, 'server:question');
      const n2 = next(x2.s, 'server:question');
      x1.s.emit('student:next');
      x2.s.emit('student:next');
      await Promise.all([n1, n2]);
    }
  }
  const strip = (r) => ({ correct: r.correct, score: r.score, workingLevel: r.workingLevel, levelChanged: r.levelChanged, profile: { ...r.profile, rollNo: null, name: null } });
  check('the phone is told the same result with a tap as without one', same(r1.map(strip), r2.map(strip)), JSON.stringify([r1.map(strip), r2.map(strip)]));
  const [p1, p2] = await Promise.all([repo.getProfile(room2.body.sessionId, '22CS01'), repo.getProfile(room2.body.sessionId, '22CS02')]);
  const ladder = (p) => ({ levels: p.levels, workingLevel: p.workingLevel, reason: p.reason, history: p.history.map((h) => [h.bloom, h.correct, h.score]) });
  check('the same answers with and without taps leave both on identical levels, working level and history',
    same(ladder(p1), ladder(p2)) && p1.history.length === 4, JSON.stringify([ladder(p1), ladder(p2)]));
  const rows = await repo.listAnswers({ sessionId: room2.body.sessionId });
  // Each phone's rows in the order it answered: the store lists rows by
  // answeredAt and then by a random id, so two in one millisecond can swap.
  const of = (roll) => rows.filter((a) => a.rollNo === roll)
    .sort((a, b) => asked[roll].indexOf(String(a.questionId)) - asked[roll].indexOf(String(b.questionId)));
  check('each tap is stored with its answer, in the stored spellings; no tap and an unknown tap are stored as none',
    same(of('22CS01').map((a) => a.confidence), ['sure', 'think', 'guess', 'sure']) && of('22CS02').every((a) => a.confidence === null),
    JSON.stringify(rows.map((a) => [a.rollNo, a.confidence])));
  check('and the marks are the same', same(of('22CS01').map((a) => [a.correct, a.score]), of('22CS02').map((a) => [a.correct, a.score])));
  const conf = await get(`/api/session/${code2}/confidence`);
  check('the room\'s counts by tap and by right and wrong, by hand: sure 2 right, think so 1 right, guessing 1 wrong, none 3 right 1 wrong',
    conf.status === 200 && conf.body.answers === 8 && conf.body.tapped === 4 && same(conf.body.counts, {
      sure: { answers: 2, correct: 2, wrong: 0, ungraded: 0 },
      think_so: { answers: 1, correct: 1, wrong: 0, ungraded: 0 },
      guessing: { answers: 1, correct: 0, wrong: 1, ungraded: 0 },
      none: { answers: 4, correct: 3, wrong: 1, ungraded: 0 },
    }), JSON.stringify(conf.body.counts));
  check('per question too, and no student is named in it', conf.body.questions?.length >= 1
    && conf.body.questions.reduce((n, q) => n + q.answers, 0) === 8 && !/22CS0|rollNo/.test(JSON.stringify(conf.body)));
  const card = await get(`/api/session/${code2}/students/22CS01/card`);
  check('the student card: counts only, by hand (sure 2, think so 1, guessing 1 wrong)', card.status === 200 && same(card.body.confidence?.counts, {
    sure: { answers: 2, correct: 2, wrong: 0, ungraded: 0 },
    think_so: { answers: 1, correct: 1, wrong: 0, ungraded: 0 },
    guessing: { answers: 1, correct: 0, wrong: 1, ungraded: 0 },
    none: { answers: 0, correct: 0, wrong: 0, ungraded: 0 },
  }) && card.body.lastAnswers.items.every((i) => !('confidence' in i)), JSON.stringify(card.body.confidence));
  const record = await get(`/api/session/${code2}/answers`);
  check('the room\'s record shows no tap beside any answer', record.status === 200 && record.body.items.length === 8
    && record.body.items.every((i) => !('confidence' in i) && i.classQuestion === null));
  const hod = await get(`/api/session/${code2}/confidence`, 'hod');
  const outsider = await get(`/api/session/${code2}/confidence`, 'profB');
  const nowhere = await get(`/api/session/${NOWHERE_CODE}/confidence`);
  check('the counts are staff-only: an HOD reads them; another professor gets the same 404 as no room; no credentials, 401',
    hod.status === 200 && outsider.status === 404 && same(outsider.body, nowhere.body)
    && (await get(`/api/session/${code2}/confidence`, null)).status === 401);
  x1.s.disconnect();
  x2.s.disconnect();
}

// ------------------------------------------------------------- the room --

console.log('\na room of eight phones, and who may run a class question');

const opened = await post('/api/session', { contentId: String(content._id) });
const code = opened.body.code;
const sessionId = opened.body.sessionId;
const ROLLS = ['21CS01', '21CS02', '21CS03', '21CS04', '21CS05', '21CS06', '21CS07'];
const S = {};
// Each answers its own first question, right, some with a tap.
const firstTaps = ['sure', undefined, 'think_so', 'sure', 'guessing', undefined, 'sure'];
for (const [i, roll] of ROLLS.entries()) {
  S[roll] = await join(code, roll);
  await answerOwn(S[roll], { right: true, confidence: firstTaps[i] });
  // Back on a question of their own, which a class question will park.
  const own2 = next(S[roll].s, 'server:question');
  S[roll].s.emit('student:next');
  await own2;
}
const teacher = await connect();
const teacherBodies = [];
teacher.on('teacher:class-question', (b) => teacherBodies.push(b));
const grid = next(teacher, 'teacher:grid');
teacher.emit('teacher:watch', { code, token: TOKENS.profA });
await grid;

const link = await post(`/api/session/${code}/projector/links`, {});
const wall = await connect();
wall.onAny((event, payload) => wallLog.push({ event, payload }));
{
  const first = next(wall, 'projector:state');
  wall.emit('projector:watch', { token: link.body.token });
  await first;
}

const profilesBefore = new Map((await repo.listProfiles(sessionId)).map((p) => [p.rollNo, p]));
const ladderOf = (p) => JSON.stringify({ levels: p.levels, workingLevel: p.workingLevel, reason: p.reason, history: p.history });

{
  const nowhere = await post(`/api/session/${NOWHERE_CODE}/class-questions`, { questionId: String(CQ_Q._id) });
  const outsider = await post(`/api/session/${code}/class-questions`, { questionId: String(CQ_Q._id) }, 'profB');
  check('another professor starting one gets the same 404 as a room that does not exist, word for word',
    nowhere.status === 404 && outsider.status === 404 && same(outsider.body, nowhere.body), JSON.stringify([outsider.body, nowhere.body]));
  const otherHod = await get(`/api/session/${code}/class-questions`, 'hodOther');
  const nowhereGet = await get(`/api/session/${NOWHERE_CODE}/class-questions`);
  check('so does reading them, for a professor or an HOD of another department', otherHod.status === 404 && same(otherHod.body, nowhereGet.body)
    && same((await get(`/api/session/${code}/class-questions`, 'profB')).body, nowhereGet.body));
  const hodStart = await post(`/api/session/${code}/class-questions`, { questionId: String(CQ_Q._id) }, 'hod');
  check('an HOD of the department is refused: 403', hodStart.status === 403, `HTTP ${hodStart.status}`);
  check('no credentials (a phone has none): 401', (await post(`/api/session/${code}/class-questions`, { questionId: String(CQ_Q._id) }, null)).status === 401);
  const matching = await post(`/api/session/${code}/class-questions`, { questionId: String(MATCH_Q._id) });
  check('a question whose options no phone can vote on is refused with a sentence that names its kind, not a field',
    matching.status === 400 && /"Match the pairs"/.test(matching.body.error ?? '') && !/questionId|kind:/.test(matching.body.error ?? ''), matching.body.error);
  const elsewhere = await post(`/api/session/${code}/class-questions`, { questionId: String(OTHER_Q._id) });
  check('a question of another chapter is refused', elsewhere.status === 400 && /not one this room may serve/.test(elsewhere.body.error ?? ''));
  check('nothing was started by any of them', (await repo.listClassQuestions(sessionId)).length === 0);
}

// --------------------------------------------------------------- round 1 --

console.log('\nround 1: one question to every phone, voted with confidence taps');

const toClass = ROLLS.map((r) => next(S[r].s, 'class:question'));
const started = await post(`/api/session/${code}/class-questions`, { questionId: String(CQ_Q._id) });
const cqId = started.body.id;
check('the owner puts it to the class: 201, round 1 open, nobody has voted yet',
  started.status === 201 && started.body.state === 'open' && started.body.round === 1 && started.body.voting === true
  && started.body.rounds?.[0]?.voted === 0 && same(started.body.question?.correct, ['C']), JSON.stringify(started.body));
{
  const got = await Promise.all(toClass);
  check('every phone is sent it: round 1, voting, four options lettered A to D, the three taps, no key',
    got.every((g) => g.id === cqId && g.round === 1 && g.voting === true && g.options?.length === 4 && g.confidence?.length === 3
      && g.question?.text === CQ_Q.text && !KEY_FIELDS.test(JSON.stringify(g))), JSON.stringify(got[0]));
  const again = await post(`/api/session/${code}/class-questions`, { questionId: String(TF_Q._id) });
  check('a second one while it runs is a 409 that says so', again.status === 409 && /still running/.test(again.body.error ?? ''));
}
const wallSet = await patch(`/api/session/${code}/projector`, { question: { classQuestionId: cqId }, showCounts: true });
check('the professor puts it on the wall with counts shown; while round 1 is open the wall has a count of votes and nothing else',
  wallSet.status === 200 && wallSet.body.shows?.question?.source === 'class' && wallSet.body.shows.question.voted === 0
  && wallSet.body.shows.question.counts?.before === null && wallSet.body.screen?.showCounts === true, JSON.stringify(wallSet.body.shows));
check('a class question\'s key cannot be put on the wall by hand', (await patch(`/api/session/${code}/projector`, { revealed: true })).status === 400);

const P = (r) => S[r];
// The worked example (test/classQuestions.test.js): the key is C (index 2).
const acks = [];
acks.push(await castVote(P('21CS01'), cqId, 1, 3, 'guessing'));
acks.push(await castVote(P('21CS01'), cqId, 1, 0, 'guessing'));
acks.push(await castVote(P('21CS02'), cqId, 1, 2, 'sure'));
acks.push(await castVote(P('21CS03'), cqId, 1, 1, 'sure'));
acks.push(await castVote(P('21CS04'), cqId, 1, 2, 'think_so'));
acks.push(await castVote(P('21CS05'), cqId, 1, 0));
acks.push(await castVote(P('21CS06'), cqId, 1, 3, 'guessing'));
acks.push(await castVote(P('21CS07'), cqId, 1, 2, 'sure'));
check('each vote comes back counted, with what was sent, and never whether it was right',
  acks.every((a) => a.counted === true && a.round === 1 && !('correct' in a) && !('score' in a) && !KEY_FIELDS.test(JSON.stringify(a)))
  && same(acks[1].mine, { response: 0, confidence: 'guessing' }) && same(acks[5].mine, { response: 0, confidence: null }), JSON.stringify(acks[1]));
{
  const open = await get(`/api/session/${code}/class-questions/${cqId}`);
  const r = open.body.rounds?.[0];
  check('while round 1 is open the professor sees 7 voted, 1 changed vote, and no distribution yet',
    open.status === 200 && r?.voted === 7 && r?.changedVotes === 1 && r?.distribution === null && r?.right === null, JSON.stringify(r));
  const hod = await get(`/api/session/${code}/class-questions/${cqId}`, 'hod');
  check('an HOD of the department reads it', hod.status === 200 && hod.body.rounds?.[0]?.voted === 7);
}
{
  // 21CS01 drops and comes back mid-round.
  P('21CS01').s.disconnect();
  const back = await join(code, '21CS01', { expectClass: true });
  check('a phone that reconnects mid-question is sent it where it stands, with its own vote in force',
    back.classState?.id === cqId && back.classState.state === 'open' && back.classState.voting === true
    && same(back.classState.mine, { response: 0, confidence: 'guessing' }), JSON.stringify(back.classState));
  S['21CS01'] = back;
}

// ----------------------------------------------------------------- pause --

console.log('\nthe pause: round 1 closes and the class discusses');

const pausedPhones = ROLLS.map((r) => next(S[r].s, 'class:question', (g) => g.state === 'paused'));
const paused = await post(`/api/session/${code}/class-questions/${cqId}/pause`, {});
{
  const r = paused.body.rounds?.[0];
  check('round 1, by hand: A 2, B 1, C 3, D 1; 3 of 7 right (0.4285); 1 changed vote',
    paused.status === 200 && paused.body.state === 'paused' && same(r?.distribution?.options?.map((o) => [o.key, o.votes]), [['A', 2], ['B', 1], ['C', 3], ['D', 1]])
    && same(r?.right, { students: 3, of: 7, share: 0.4285 }) && r?.changedVotes === 1, JSON.stringify(r));
  check('the taps by right and wrong, by hand: sure 2 right 1 wrong; think so 1 right; guessing 2 wrong; none 1 wrong', same(r?.confidence, {
    sure: { answers: 3, correct: 2, wrong: 1, ungraded: 0 },
    think_so: { answers: 1, correct: 1, wrong: 0, ungraded: 0 },
    guessing: { answers: 2, correct: 0, wrong: 2, ungraded: 0 },
    none: { answers: 1, correct: 0, wrong: 1, ungraded: 0 },
  }), JSON.stringify(r?.confidence));
  check('counts only: no roll number anywhere in the professor\'s view', !/21CS0/.test(JSON.stringify(paused.body)));
  const got = await Promise.all(pausedPhones);
  check('every phone is told voting is paused, to talk it over', got.every((g) => g.state === 'paused' && g.voting === false && /Talk it over/.test(g.message)));
  check('each with its own vote in round 1 (the changed vote\'s latest), never another phone\'s', same(got.map((g) => g.mine), [
    { response: 0, confidence: 'guessing' }, { response: 2, confidence: 'sure' }, { response: 1, confidence: 'sure' },
    { response: 2, confidence: 'think_so' }, { response: 0, confidence: null }, { response: 3, confidence: 'guessing' },
    { response: 2, confidence: 'sure' },
  ]), JSON.stringify(got.map((g) => g.mine)));
  const hodPause = await post(`/api/session/${code}/class-questions/${cqId}/revote`, {}, 'hod');
  check('an HOD may not open the re-vote: 403', hodPause.status === 403);
  check('another professor gets the 404 for it', (await post(`/api/session/${code}/class-questions/${cqId}/revote`, {}, 'profB')).status === 404);
}
{
  const shown = (await get(`/api/session/${code}/projector`)).body.shows?.question;
  check('the wall, with counts chosen: round 1 per option and its taps, never the share right or the key',
    same(shown?.counts?.before?.options, [{ key: 'A', votes: 2 }, { key: 'B', votes: 1 }, { key: 'C', votes: 3 }, { key: 'D', votes: 1 }])
    && same(shown?.counts?.before?.confidence, { sure: 3, think_so: 1, guessing: 2, none: 1 })
    && shown?.counts?.before?.correct === null && shown?.correct === null && shown?.revealed === false, JSON.stringify(shown));
}
{
  const late = await castVote(P('21CS05'), cqId, 1, 2, 'sure');
  check('a vote that comes after the pause is kept and not counted, and the phone is told so', late.counted === false && /kept but not counted/.test(late.message));
  const r = (await get(`/api/session/${code}/class-questions/${cqId}`)).body.rounds?.[0];
  check('round 1\'s counts do not move for it', r?.voted === 7 && r?.notCounted === 1 && r?.distribution?.options?.[2]?.votes === 3, JSON.stringify(r));
}
{
  const s8 = await join(code, '21CS08', { expectClass: true });
  S['21CS08'] = s8;
  check('a phone that joins during the pause is sent the question where it stands, with no vote of its own',
    s8.classState?.id === cqId && s8.classState.state === 'paused' && s8.classState.voting === false && s8.classState.mine === null,
    JSON.stringify(s8.classState));
}

// --------------------------------------------------------------- round 2 --

console.log('\nround 2: the re-vote after discussion');

const ALL = [...ROLLS, '21CS08'];
const reopened = ALL.map((r) => next(S[r].s, 'class:question', (g) => g.state === 'revote'));
const revote = await post(`/api/session/${code}/class-questions/${cqId}/revote`, {});
check('the re-vote opens: round 2, voting', revote.status === 200 && revote.body.state === 'revote' && revote.body.round === 2
  && revote.body.rounds?.[1]?.voted === 0 && revote.body.rounds?.[1]?.distribution === null);
check('every phone, the late joiner included, is sent round 2 to vote in',
  (await Promise.all(reopened)).every((g) => g.round === 2 && g.voting === true && !KEY_FIELDS.test(JSON.stringify(g))));
const acks2 = [];
acks2.push(await castVote(P('21CS01'), cqId, 2, 2, 'sure'));
acks2.push(await castVote(P('21CS02'), cqId, 2, 2, 'sure'));
acks2.push(await castVote(P('21CS03'), cqId, 2, 0, 'think_so'));
acks2.push(await castVote(P('21CS04'), cqId, 2, 1, 'think_so'));
acks2.push(await castVote(P('21CS05'), cqId, 2, 0, 'guessing'));
acks2.push(await castVote(P('21CS06'), cqId, 2, 2, 'sure'));
acks2.push(await castVote(P('21CS08'), cqId, 2, 2, 'think_so'));
check('every re-vote is counted, the phone that missed round 1 included', acks2.every((a) => a.counted === true && a.round === 2));
{
  // A second server over the same store, as after a restart: what a class
  // question is doing is read from the store, not from any server's memory.
  const second = await startServer();
  const s9 = await join(code, '21CS09', { url: second.base, expectClass: true });
  check('a second server over the same store sends a joining phone the question as it stands: round 2, voting',
    s9.classState?.id === cqId && s9.classState.state === 'revote' && s9.classState.round === 2 && s9.classState.voting === true,
    JSON.stringify(s9.classState));
  s9.s.disconnect();
  second.io.close();
  second.server.close();
  phones.delete('21CS09');
}
// 21CS07's own question is made the class question in the store, as if it had
// been served it before the class was asked: after the close it must get a new one.
{
  const p7 = await repo.getProfile(sessionId, '21CS07');
  await repo.saveProfile({ ...p7, served: { questionId: String(CQ_Q._id), at: new Date().toISOString(), reason: '', tries: 0, last: null } });
}

// ------------------------------------------------------- before the reveal --

console.log('\nthe key, before the reveal');

const classEventsSeen = phoneLog.filter((e) => e.event.startsWith('class:')).length;
check(`no phone was sent the key: no answer field, no answer, no correct option, in any of ${phoneLog.length} events (${classEventsSeen} of the class question's)`,
  classEventsSeen >= 30 && phoneLog.every((e) => !KEY_FIELDS.test(JSON.stringify(e.payload ?? {})))
  && phoneLog.filter((e) => e.event.startsWith('class:')).every((e) => e.payload?.answer == null && e.payload?.correct == null),
  JSON.stringify(phoneLog.find((e) => KEY_FIELDS.test(JSON.stringify(e.payload ?? {})))));
check('no phone was ever served the class question as its own question',
  phoneLog.filter((e) => e.event === 'server:question').every((e) => e.payload?.question?._id !== String(CQ_Q._id)));
check('the projector was sent no key, no share right and no changes, in any of the class question\'s screens it got',
  wallLog.filter((e) => e.payload?.question?.source === 'class').length >= 3
  && wallLog.every((e) => !KEY_FIELDS.test(JSON.stringify(e.payload ?? {}))
    && (e.payload?.question?.source !== 'class' || (e.payload.question.correct === null && e.payload.question.revealed === false
      && !e.payload.question.counts?.before?.correct && !e.payload.question.counts?.after?.correct && !e.payload.question.counts?.changes))),
  `${wallLog.length} events`);

// ----------------------------------------------------------------- close --

console.log('\nthe close, with the key revealed: the class-level changes');

const closing = ALL.map((r) => next(S[r].s, 'class:closed'));
const resumed7 = next(S['21CS07'].s, 'server:question');
const closed = await post(`/api/session/${code}/class-questions/${cqId}/close`, { reveal: true });
{
  const b = closed.body;
  const r2 = b.rounds?.[1];
  check('closed and revealed; round 2 by hand: A 2, B 1, C 4, D 0; 4 of 7 right (0.5714)',
    closed.status === 200 && b.state === 'closed' && b.revealed === true
    && same(r2?.distribution?.options?.map((o) => [o.key, o.votes]), [['A', 2], ['B', 1], ['C', 4], ['D', 0]])
    && same(r2?.right, { students: 4, of: 7, share: 0.5714 }), JSON.stringify(r2));
  check('the changes, by hand: 2 wrong to right, 1 right to wrong, 1 right both times, 1 the same wrong, 1 another wrong; '
    + '1 in round 1 only, 1 in round 2 only', same(b.changes, {
    both: 6, onlyBefore: 1, onlyAfter: 1, wrongToRight: 2, rightToWrong: 1, rightToRight: 1, wrongToSameWrong: 1, wrongToOtherWrong: 1,
  }), JSON.stringify(b.changes));
  check('confidence before and after, by hand: round 2 sure 3 right; think so 1 right 2 wrong; guessing 1 wrong', same(r2?.confidence, {
    sure: { answers: 3, correct: 3, wrong: 0, ungraded: 0 },
    think_so: { answers: 3, correct: 1, wrong: 2, ungraded: 0 },
    guessing: { answers: 1, correct: 0, wrong: 1, ungraded: 0 },
    none: { answers: 0, correct: 0, wrong: 0, ungraded: 0 },
  }), JSON.stringify(r2?.confidence));
  const got = await Promise.all(closing);
  check('every phone is told it closed, and only now the answer: C, index 2',
    got.every((g) => g.id === cqId && g.revealed === true && g.answer === 2 && same(g.correct, ['C'])), JSON.stringify(got[0]));
  const next7 = await resumed7;
  check('the phone whose own question was the class question is sent a new one of its own', next7.question?._id !== String(CQ_Q._id));
  check('closing twice is a 409', (await post(`/api/session/${code}/class-questions/${cqId}/close`, { reveal: true })).status === 409);
  await wait(1300);
  const lastTeacher = teacherBodies.at(-1);
  check('the professor\'s screen was pushed every change, ending closed, and never a roll number',
    teacherBodies.length >= 4 && lastTeacher?.state === 'closed' && lastTeacher?.changes?.wrongToRight === 2
    && !teacherBodies.some((x) => /21CS0/.test(JSON.stringify(x))), `${teacherBodies.length} pushes`);
  const shown = (await get(`/api/session/${code}/projector`)).body.shows?.question;
  check('the wall, now revealed: the key, the share right before and after, and the changes, all as counts',
    same(shown?.correct, ['C']) && same(shown?.counts?.before?.correct, { students: 3, share: 0.4285 })
    && same(shown?.counts?.after?.correct, { students: 4, share: 0.5714 }) && shown?.counts?.changes?.wrongToRight === 2
    && !/21CS0/.test(JSON.stringify(shown)), JSON.stringify(shown));
}

// -------------------------------------------------------------- evidence --

console.log('\nthe evidence: every vote stored, none overwritten; no level moved');

{
  const rows = await repo.listAnswers({ sessionId, classQuestionId: cqId });
  const r1 = rows.filter((a) => a.round === 1);
  const r2 = rows.filter((a) => a.round === 2);
  check('16 rows: 9 in round 1 (the changed vote and the late one included), 7 in round 2', rows.length === 16 && r1.length === 9 && r2.length === 7,
    `${rows.length}: ${r1.length} + ${r2.length}`);
  // In the order the server took them (`attempt`): two votes can share a millisecond.
  const s1 = r1.filter((a) => a.rollNo === '21CS01').sort((a, b) => a.attempt - b.attempt);
  check('21CS01\'s first vote is kept with final false, her second is in force', s1.length === 2
    && same(s1.map((a) => [a.response, a.final, a.attempt]), [[3, false, 1], [0, true, 2]]), JSON.stringify(s1.map((a) => [a.response, a.final, a.attempt])));
  const late = r1.filter((a) => a.rollNo === '21CS05');
  check('21CS05\'s late vote is kept, final false, saying so', late.length === 2 && late.some((a) => a.final === false && a.detail === LATE_DETAIL && a.response === 2));
  check('every vote carries its class question, its round, the question as asked and a mark: never a level',
    rows.every((a) => a.classQuestionId === cqId && [1, 2].includes(a.round) && a.questionSnapshot?.answerIdx === 2 && a.bloom === 'remember'
      && typeof a.correct === 'boolean' && a.reviewStatus === 'auto'));
  check('the taps are stored in the stored spellings', same(r2.map((a) => a.confidence).sort(), ['guess', 'sure', 'sure', 'sure', 'think', 'think', 'think']));
  const after = new Map((await repo.listProfiles(sessionId)).map((p) => [p.rollNo, p]));
  const moved = ROLLS.filter((r) => ladderOf(after.get(r)) !== ladderOf(profilesBefore.get(r)) && r !== '21CS07');
  const p7 = after.get('21CS07');
  const b7 = profilesBefore.get('21CS07');
  check('no vote moved any level: every profile\'s levels, working level, reason and history are as before',
    moved.length === 0 && same(p7.levels, b7.levels) && p7.workingLevel === b7.workingLevel && same(p7.history, b7.history)
    && after.get('21CS08').history.length === 0 && after.get('21CS09').history.length === 0, moved.join(', '));
  const record = await get(`/api/session/${code}/answers?limit=200`);
  const labelled = record.body.items?.filter((i) => i.classQuestion);
  check('the room\'s record lists every vote, labelled with its class question and round, with no tap beside it',
    labelled?.length === 16 && labelled.every((i) => i.classQuestion.id === cqId && !('confidence' in i)));
}

// ----------------------------------------------------- never served again --

console.log('\nonce asked to the class, never served on its own in this room');

{
  const p7 = S['21CS07'];
  const before = ladderOf(await repo.getProfile(sessionId, '21CS07'));
  const moved = next(p7.s, 'server:question');
  p7.s.emit('student:answer', { questionId: String(CQ_Q._id), response: 2, answerId: 'stale-own-answer-0001', confidence: 'sure' });
  await moved;
  const kept = await repo.getAnswerByKey(sessionId, 'stale-own-answer-0001');
  check('an answer a phone sends to it as its own question is kept with the class question, never counted, and the phone moves on',
    kept?.classQuestionId === cqId && kept.final === false && kept.detail === OWN_QUESTION_DETAIL && kept.round === 2
    && ladderOf(await repo.getProfile(sessionId, '21CS07')) === before, JSON.stringify(kept && { f: kept.final, d: kept.detail }));
  const r = (await get(`/api/session/${code}/class-questions/${cqId}`)).body.rounds?.[1];
  check('and it does not move the class question\'s counts', r?.voted === 7 && r?.notCounted === 1);
  // 21CS02 works through every question left to it.
  const p2 = S['21CS02'];
  const served = [];
  for (let i = 0; i < 20; i += 1) {
    if (!p2.question) break;
    served.push(String(p2.question._id));
    await answerOwn(p2, { right: true });
    const q = next(p2.s, 'server:question', () => true, 1500).catch(() => null);
    const done = next(p2.s, 'server:exhausted', () => true, 1500).catch(() => null);
    p2.question = null;
    p2.s.emit('student:next');
    const got = await Promise.race([q, done]);
    if (!got?.question) break;
  }
  check('a phone that works through the whole bank is never served it', served.length >= 8 && !served.includes(String(CQ_Q._id)),
    `${served.length} served`);
  const items = await get(`/api/session/${code}/items`);
  const topics = await get(`/api/session/${code}/topics`);
  check('the item and topic reports count the students\' own answers, never a vote',
    items.status === 200 && !items.body.items?.some((i) => String(i.questionId) === String(CQ_Q._id))
    && topics.body.counted?.answers === (await repo.listAnswers({ sessionId, final: true, classVotes: false })).length);
}

// ------------------------------------------------- a room that closes --

console.log('\na room closed with a class question running');

{
  const r3 = await post('/api/session', { contentId: String(content._id) });
  const ph = await join(r3.body.code, '23CS01');
  const toPhone = next(ph.s, 'class:question');
  const cq = await post(`/api/session/${r3.body.code}/class-questions`, { questionId: String(TF_Q._id) });
  const g = await toPhone;
  check('a true-or-false question goes to the class as A True, B False', cq.status === 201
    && same(g.options, [{ key: 'A', label: 'True' }, { key: 'B', label: 'False' }]) && !KEY_FIELDS.test(JSON.stringify(g)));
  // An older phone that sends no idempotency key goes False, True, then False again.
  for (const response of [false, true, false]) {
    const ack = next(ph.s, 'class:vote');
    ph.s.emit('student:vote', { classQuestionId: cq.body.id, round: 1, response, confidence: 'sure' });
    await ack;
  }
  {
    // In the order the server took them, under the student's lock (`attempt`):
    // the store lists rows by answeredAt and then by id, which is random on the
    // in-process store, and three votes this quick can share a millisecond.
    const rows = (await repo.listAnswers({ classQuestionId: cq.body.id })).sort((a, b) => a.attempt - b.attempt);
    check('a phone with no key that goes back to an earlier choice casts a new vote: three rows, the last in force',
      same(rows.map((a) => [a.response, a.final, a.attempt]), [[false, false, 1], [true, false, 2], [false, true, 3]]),
      JSON.stringify(rows.map((a) => [a.response, a.final, a.attempt])));
  }
  const shut = next(ph.s, 'session:closed');
  const close = await post(`/api/session/${r3.body.code}/close`, {});
  await shut;
  const after = await get(`/api/session/${r3.body.code}/class-questions/${cq.body.id}`);
  check('closing the room closes its class question, without revealing the key; it can still be read',
    close.status === 200 && after.status === 200 && after.body.state === 'closed' && after.body.revealed === false
    && after.body.rounds?.[0]?.voted === 1, JSON.stringify({ state: after.body.state, revealed: after.body.revealed }));
  const vote = (await repo.listAnswers({ classQuestionId: cq.body.id })).find((a) => a.final !== false);
  check('its vote in force is a truefalse row, marked wrong, stored as given', vote?.response === false && vote?.correct === false && vote?.kind === 'truefalse');
  ph.s.disconnect();
}

// Phase 5 follow-ups, with the store failing: while each phone is sent its own
// vote at a pause, and while the room's close is closing its class question. The
// room is closed by then, so the close still answers, and the phones and the
// projector are still told.
{
  const r4 = await post('/api/session', { contentId: String(content._id) });
  const ph = await join(r4.body.code, '24CS01');
  const toPhone = next(ph.s, 'class:question');
  const cq = await post(`/api/session/${r4.body.code}/class-questions`, { questionId: String(TF_Q._id) });
  await toPhone;
  const link4 = await post(`/api/session/${r4.body.code}/projector/links`, {});
  const wall4 = await connect();
  const watching = next(wall4, 'projector:state');
  wall4.emit('projector:watch', { token: link4.body.token });
  await watching;

  const realError = console.error;
  const logged = [];

  // First, the store fails reading the votes as the class question pauses: the
  // phone is still told it paused, with no vote, as before each phone was sent its own.
  const realList = repo.listAnswers;
  let failOnce = true;
  repo.listAnswers = async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('simulated read failure'); }
    return realList(...args);
  };
  console.error = (...args) => { logged.push(args.map((a) => String(a?.message ?? a)).join(' ')); };
  let pausedRes;
  let pausedTold;
  try {
    const told4 = next(ph.s, 'class:question', (g) => g.state === 'paused').catch(() => null);
    pausedRes = await post(`/api/session/${r4.body.code}/class-questions/${cq.body.id}/pause`, {});
    pausedTold = await told4;
  } finally {
    repo.listAnswers = realList;
    console.error = realError;
  }
  check('a store error reading the votes as the class question pauses: the pause holds, the phone is still told, with no vote',
    pausedRes.status === 200 && pausedTold?.state === 'paused' && pausedTold.mine === null && failOnce === false
    && logged.some((l) => /simulated read failure/.test(l)), JSON.stringify([pausedRes.status, pausedTold?.mine, logged]));
  logged.length = 0;

  const realUpdate = repo.updateClassQuestion;
  repo.updateClassQuestion = async () => { throw new Error('simulated store failure'); };
  console.error = (...args) => { logged.push(args.map((a) => String(a?.message ?? a)).join(' ')); };
  let close;
  let told;
  try {
    const shut = next(ph.s, 'session:closed').then(() => true, () => false);
    const wallShut = next(wall4, 'projector:closed').then(() => true, () => false);
    close = await post(`/api/session/${r4.body.code}/close`, {});
    told = await Promise.all([shut, wallShut]);
  } finally {
    repo.updateClassQuestion = realUpdate;
    console.error = realError;
  }
  check('a store error closing its class question does not turn the close into an error: 200, the room closed',
    close.status === 200 && close.body.session?.status === 'closed' && (await repo.getSession(r4.body.sessionId))?.status === 'closed',
    `HTTP ${close.status} ${JSON.stringify(close.body).slice(0, 160)}`);
  check('the phones and the projector are still told the room closed', told[0] === true && told[1] === true, JSON.stringify(told));
  check('and the error is logged, not sent to the professor as a failure', logged.some((l) => /simulated store failure/.test(l))
    && !logged.some((l) => /^\[api\]/.test(l)), JSON.stringify(logged));
  check('the class question can still be closed by hand afterwards', (await post(`/api/session/${r4.body.code}/class-questions/${cq.body.id}/close`, {})).status === 200);
  ph.s.disconnect();
  wall4.disconnect();
}

// -------------------------------------------------------------- archive --

console.log('\nthe deleted room\'s archive keeps the class question and every vote');

{
  for (const p of phones.values()) p.s.disconnect();
  await wait(100);
  const gone = await call('DELETE', `/api/session/${code}?confirm=${code}`);
  const archived = gone.status === 200 ? (await repo.getRoomArchive(gone.body.archive?.id)) : null;
  const back = archived ? decodeRoomArchive(archived.data) : null;
  const votes = back?.answers.filter((a) => a.classQuestionId === cqId) ?? [];
  check('the archive holds the class question, revealed, with the question as asked',
    gone.status === 200 && back?.classQuestions?.length === 1 && back.classQuestions[0].id === cqId && back.classQuestions[0].revealed === true
    && back.classQuestions[0].questionSnapshot?.answerIdx === 2 && archived.data.counts?.classQuestions === 1, JSON.stringify(back?.classQuestions));
  check('and all 17 rows filed with it: both rounds, the changed vote, the late one and the answer sent as a phone\'s own',
    votes.length === 17 && votes.filter((a) => a.round === 1).length === 9 && votes.filter((a) => a.final === false).length === 3,
    `${votes.length} rows`);
  check('the class question\'s rows left the live tables with the room', (await repo.listClassQuestions(sessionId)).length === 0
    && (await repo.listAnswers({ sessionId })).length === 0);
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
teacher.disconnect();
wall.disconnect();
globalThis.fetch = realFetch;
main.io.close();
main.server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
