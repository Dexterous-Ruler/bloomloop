// Batch 8 - the design zip's server gaps for the live room, the wheel and
// analytics, end to end.
//
//   node server/scripts/zipgaps1.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store. A class of four runs two rooms on one
// chapter; phones answer through real sockets. Then it checks:
//
//   suggestions (L1, C2)  with no model: a plain sentence, nothing made up or
//                         kept. With a stand-in model (fixture replies through
//                         the real parsing): a move aimed at the stuck level,
//                         from counts only (no name or roll number reaches the
//                         model), kept with its basis and slide; a prompt for
//                         one activity kind; "Another idea" told the earlier
//                         ones; a reply that labels students refused whole;
//                         "Use it" recorded as an activity pointing back at it;
//                         who may read, ask and use
//   the class on the room (L2)   on the staff reads, never on the phones' read
//   the wheel (W2, gap 9)  "Question + student" draws a question with the
//                         student and keeps the draw; "Another" draws the next,
//                         never one already drawn for the pick, then says when
//                         none is left; a verbal question names none
//   analytics (A1, A3)    the latest room against the one before, level by
//                         level; the chapter on each hardest question
//   insights (gaps 2, 6)  each point of the timeline carries every level's
//                         figure; the threshold is the room's own goal; the
//                         support band against the class's previous room
//   the outbox's asks     every reply to an answer or a vote names its answerId,
//                         refusals and "not now" included; staff answer lists
//                         carry each row's answerKey
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As in
// roster.mjs, the server is pointed at http://supabase.invalid and the account
// calls are answered here, in-process. Any other request off this machine is
// refused outright and counted. Never calls Gemini, Supabase or any network
// service. Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { AI_LABEL, FAILED_MESSAGE, OFFLINE_MESSAGE, useModelForTests } = await import(`${SRC}services/teachingMoves.js`);

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
  hod: 'b0000000-0000-4000-8000-000000000001',
  profA: 'b0000000-0000-4000-8000-000000000002',
  profB: 'b0000000-0000-4000-8000-000000000003',
  hodOther: 'b0000000-0000-4000-8000-000000000004',
  student: 'b0000000-0000-4000-8000-000000000005',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-ZIPG0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.student, 'student', 'CSE', ID.profA, '21CS01'),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
].map((a) => [a.id, a]));
const TOKENS = { hod: 'tok-hod', profA: 'tok-prof-a', profB: 'tok-prof-b', hodOther: 'tok-hod-other', student: 'tok-student' };
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
    throw new Error(`zipgaps1.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by zipgaps1.mjs: ${url.pathname}` }, 404);
};
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'zipgaps1-test-service-key';

// -------------------------------------------------------------- server --

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------- sockets --

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
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

let keyN = 0;
const nextKey = () => `zipgaps-${String((keyN += 1)).padStart(6, '0')}`;
/** Every answerId a phone sent, by roll number, in order. */
const sentKeys = new Map();

/**
 * A phone that joins and answers up to `limit` questions, right or wrong as
 * `right(question)` says (read from the store's key), and stays connected.
 */
async function phone(code, rollNo, right, limit) {
  const s = await connect();
  const first = either(s, ['server:question', 'server:exhausted', 'session:rejected']);
  s.emit('student:join', { code, rollNo, name: `Student ${rollNo.slice(-2)}` });
  let got = await first;
  let answered = 0;
  while (got.name === 'server:question' && answered < limit) {
    const q = await repo.getQuestion(got.payload.question._id);
    const response = q.kind === 'poll' ? 0 : (right(q) ? q.answerIdx : (q.answerIdx + 1) % q.options.length);
    const answerId = nextKey();
    sentKeys.set(rollNo, [...(sentKeys.get(rollNo) ?? []), answerId]);
    const result = either(s, ['server:result', 'server:kept', 'session:rejected']);
    s.emit('student:answer', { questionId: String(q._id), response, answerId });
    const r = await result;
    if (r.name !== 'server:result' || r.payload.answerId !== answerId) {
      throw new Error(`${rollNo}'s answer in ${code}: ${r.name} ${JSON.stringify(r.payload).slice(0, 200)}`);
    }
    answered += 1;
    const nextOne = either(s, ['server:question', 'server:exhausted']);
    s.emit('student:next');
    got = await nextOne;
  }
  return { s, rollNo, answered, question: got.name === 'server:question' ? got.payload.question : null };
}

// ------------------------------------------------------------ fixtures --

console.log('\nfixtures: a class of four, a chapter with slides, two rooms');

const made = await post('/api/classes', { courseName: 'Data Structures', section: 'SY-CS A', termLabel: 'Sem III 2026' });
const classId = made.body.class?.id;
const ROSTER = [
  { roll: '21CS01', name: 'Asha Rao' }, { roll: '21CS02', name: 'Bilal Khan' },
  { roll: '21CS03', name: 'Chitra Iyer' }, { roll: '21CS04', name: 'Dev Patil' },
];
await post(`/api/classes/${classId}/students`, { students: ROSTER });
const content = await repo.createContent({
  title: 'Trees', kind: 'pptx', ownerId: ID.profA,
  rawText: 'Trees. Traversals visit every node: preorder, inorder, postorder. Heaps keep the largest key at the root.',
  topics: ['Traversals', 'Heaps'],
  topicSlides: { Traversals: [4, 5], Heaps: [7] },
  slideTexts: [
    { slide: 4, text: 'Preorder visits the root first, then the left and right subtrees.' },
    { slide: 5, text: 'Postorder visits the root last.' },
    { slide: 7, text: 'A max-heap keeps the largest key at the root.' },
  ],
});
const CONTENT = String(content._id);
const mcq = (bloom, i, topic) => ({
  contentId: content._id, topic, text: `${bloom} question ${i} on ${topic}`, kind: 'mcq', bloom, source: 'llm', status: 'active',
  options: ['w', 'x', 'y', 'z'], answerIdx: i % 4,
});
await repo.insertQuestions([
  ...Array.from({ length: 5 }, (_, i) => mcq('remember', i, i % 2 ? 'Heaps' : 'Traversals')),
  ...Array.from({ length: 5 }, (_, i) => mcq('understand', i, i % 2 ? 'Heaps' : 'Traversals')),
  ...Array.from({ length: 3 }, (_, i) => mcq('apply', i, 'Traversals')),
  { contentId: content._id, topic: 'Heaps', text: 'Which did you enjoy?', kind: 'poll', bloom: 'remember', source: 'teacher',
    status: 'active', options: ['a', 'b', 'c', 'd'] },
  { ...mcq('apply', 9, 'Heaps'), status: 'draft' },
]);
const DRAWABLE = 13; // approved, not polls
check('fixtures: a class of four and a chapter of 13 approved questions, a poll and a draft',
  made.status === 201 && (await repo.listClassStudents(classId)).length === 4
  && (await repo.listQuestions(content._id)).length === 14);

const open = (title, extra = {}) => post('/api/session', { contentId: CONTENT, classId, title, ...extra });
const r1 = await open('Trees, last week');
await wait(15);
const r2 = await open('Trees, today', { masteryGoal: 0.9 });
const R1 = `/api/session/${r1.body.code}`;
const R2 = `/api/session/${r2.body.code}`;
check('two rooms for the class, one after the other', r1.status === 200 && r2.status === 200, `${r1.status} ${r2.status} ${r2.body.error ?? ''}`);

// Last week: 21CS01 got 2 of 5 right, 21CS02 all 5.
{
  let n = 0;
  const p1 = await phone(r1.body.code, '21CS01', () => (n += 1) <= 2, 5);
  const p2 = await phone(r1.body.code, '21CS02', () => true, 5);
  check('last week: two phones answered five each', p1.answered === 5 && p2.answered === 5);
  p1.s.disconnect();
  p2.s.disconnect();
  const closed = await post(`${R1}/close`, {});
  check('last week\'s room is closed', closed.status === 200, JSON.stringify(closed.body).slice(0, 200));
}

// ------------------------------------------------- suggestions, no model --

console.log('\nsuggestions with no model on the server');
{
  const asked = await post(`${R2}/teaching-moves`, {});
  check('a plain sentence that suggestions need the model; nothing made up', asked.status === 200 && asked.body.state === 'offline'
    && asked.body.suggestion === null && asked.body.message === OFFLINE_MESSAGE, JSON.stringify(asked.body));
  const list = await get(`${R2}/teaching-moves`);
  check('nothing kept, and the list says the model is not ready', list.status === 200 && list.body.modelReady === false
    && list.body.suggestions.length === 0 && list.body.offline === OFFLINE_MESSAGE && list.body.label === AI_LABEL);
  check('the sentence names no path, field or verb', !/\/api\/|POST|GET|kind|topic|requestId/.test(OFFLINE_MESSAGE));
}

// Today: 21CS01 gets every one wrong (below 40%), 21CS02 every one right, 21CS03 joins and answers nothing.
const today = {
  p1: await phone(r2.body.code, '21CS01', () => false, 4),
  p2: await phone(r2.body.code, '21CS02', () => true, 4),
  p3: await phone(r2.body.code, '21CS03', () => true, 0),
};

// -------------------------------------------------- the outbox's asks --

console.log('\nthe phone outbox: every reply names its answerId');
{
  const stranger = await connect();
  const k = nextKey();
  const got = either(stranger, ['session:rejected']);
  stranger.emit('student:answer', { questionId: 'x', response: 1, answerId: k });
  const r = await got;
  check('an answer from a phone that has not joined: refused, naming its answerId', r.payload.answerId === k && r.payload.questionId === 'x',
    JSON.stringify(r.payload));
  const v = nextKey();
  const gotVote = either(stranger, ['session:rejected']);
  stranger.emit('student:vote', { classQuestionId: 'cq-1', response: 0, answerId: v });
  const rv = await gotVote;
  check('a vote from a phone that has not joined: refused, naming its answerId and class question',
    rv.payload.answerId === v && rv.payload.classQuestionId === 'cq-1', JSON.stringify(rv.payload));
  stranger.disconnect();

  await post(`${R2}/pause`, {});
  const kp = nextKey();
  const paused = either(today.p2.s, ['session:paused']);
  today.p2.s.emit('student:answer', { questionId: String(today.p2.question?._id ?? 'none'), response: 0, answerId: kp });
  const rp = await paused;
  check('an answer while the room is paused: "paused", naming its answerId', rp.payload.answerId === kp, JSON.stringify(rp.payload));
  await post(`${R2}/resume`, {});

  const answers = await get(`${R2}/answers?rollNo=21CS01`);
  const keys = answers.body.items?.map((a) => a.answerKey).sort();
  check('the staff answer list carries each row\'s answerKey: the phone\'s own answerId',
    answers.status === 200 && same(keys, [...(sentKeys.get('21CS01') ?? [])].slice(-4).sort()), JSON.stringify(keys));
  const phoneRead = await get(`/api/session/${r2.body.code}`, null);
  check('the phones\' own read of the room carries no class, no classId', phoneRead.status === 200
    && !('class' in phoneRead.body.session) && !JSON.stringify(phoneRead.body).includes('Data Structures'));
}

// ------------------------------------------------- the class on the room --

console.log('\nthe class\'s course and section on the room (L2)');
{
  const rooms = await get('/api/session');
  const row = rooms.body.rooms?.find((r) => r.code === r2.body.code);
  check('the room list names the class', same(row?.class, { id: classId, courseName: 'Data Structures', section: 'SY-CS A', termLabel: 'Sem III 2026' }),
    JSON.stringify(row?.class));
  const head = await get(`${R2}/answers`);
  check('the room head of the evidence reads names it too', head.body.room?.class?.courseName === 'Data Structures');
  const ins = await get(`${R2}/insights`);
  check('and the insights read', ins.body.room?.class?.section === 'SY-CS A');
}

// ------------------------------------------------------------- insights --

console.log('\ninsights: per-level points, the room\'s goal, the support band last time');
{
  const ins = await get(`${R2}/insights`);
  const points = ins.body.series?.points ?? [];
  const last = points.at(-1);
  const sum = Object.values(last?.levels ?? {}).reduce((n, l) => n + l.answers, 0);
  check('the latest point carries all six levels, each with its counts', last && Object.keys(last.levels ?? {}).length === 6
    && sum === 8 && Object.values(last.levels).every((l) => l.accuracy === null || (l.accuracy >= 0 && l.accuracy <= 1)),
  JSON.stringify(last?.levels));
  check('the threshold is the room\'s own goal (90% here), never a fixed 60', ins.body.series?.threshold?.goal === 0.9
    && /90%/.test(ins.body.series.threshold.sentence), JSON.stringify(ins.body.series?.threshold));
  const prev = ins.body.kpis?.support?.previousRoom;
  check('21CS01 is below 40% now: set against last week, the same student only', ins.body.kpis?.support?.value === 1
    && prev?.room?.code === r1.body.code && prev.compared === 1 && prev.then?.correct === 2 && prev.then?.answers === 5
    && prev.now?.correct === 0 && prev.now?.answers === 4 && prev.change === -40, JSON.stringify(prev));
  check('with a sentence and no name', /answered in the previous room/.test(prev?.sentence ?? '')
    && !/Asha|21CS01/.test(JSON.stringify(prev)), prev?.sentence);
}

// ------------------------------------------------------------ the wheel --

console.log('\nthe wheel: "Question + student", "Another", a verbal question');
let firstPick;
{
  const bad = await post(`${R2}/wheel/draw`, { withQuestion: 'yes' });
  check('withQuestion must be true or false', bad.status === 400);
  const drawn = await post(`${R2}/wheel/draw`, { withQuestion: true });
  firstPick = drawn.body.pick;
  check('a student and a question drawn together, the question kept on the pick', drawn.status === 201 && Boolean(firstPick?.questionId)
    && firstPick.ask === 'bank' && Boolean(firstPick.question?.text) && firstPick.questionDraw?.order === 1
    && firstPick.questionDraw.poolSize === DRAWABLE, JSON.stringify(firstPick));
  const q = await repo.getQuestion(firstPick.questionId);
  check('an approved question of the room, never the poll or the draft', q.status === 'active' && q.kind === 'mcq');

  const seen = new Set([firstPick.questionId]);
  let another;
  let repeats = 0;
  for (let i = 0; i < DRAWABLE - 1; i += 1) {
    another = await post(`${R2}/wheel/picks/${firstPick.id}/next-question`, {});
    if (another.status !== 200) break;
    if (seen.has(another.body.pick.questionId)) repeats += 1;
    seen.add(another.body.pick.questionId);
  }
  check('"Another" draws the next question for the same pick, never one drawn for it, until every one has been',
    another.status === 200 && repeats === 0 && seen.size === DRAWABLE && another.body.draw?.order === DRAWABLE,
    `${another.status} ${JSON.stringify(another.body).slice(0, 200)} seen=${seen.size}`);
  const none = await post(`${R2}/wheel/picks/${firstPick.id}/next-question`, {});
  check('then it says none is left, and changes nothing', none.status === 409 && /drawn for this pick already/.test(none.body.error ?? '')
    && (await repo.listWheelQuestionDraws(r2.body.sessionId)).length === DRAWABLE);
  const draws = await repo.listWheelQuestionDraws(r2.body.sessionId);
  check('every draw is kept, in order, each with how many it was drawn from', same(draws.map((d) => d.drawOrder),
    Array.from({ length: DRAWABLE }, (_, i) => i + 1)) && draws[0].poolSize === DRAWABLE && draws.at(-1).poolSize === 1);

  const verbal = await patch(`${R2}/wheel/picks/${firstPick.id}`, { ask: 'verbal' });
  check('a verbal question: a fourth ask, naming no bank question', verbal.status === 200 && verbal.body.pick?.ask === 'verbal'
    && verbal.body.pick.askLabel === 'Verbal question' && verbal.body.pick.questionId === null, JSON.stringify(verbal.body).slice(0, 200));
  const onVerbal = await post(`${R2}/wheel/picks/${firstPick.id}/next-question`, {});
  check('"Another" on a verbal pick is refused with a sentence', onVerbal.status === 409 && /other than a bank question/.test(onVerbal.body.error ?? ''));
  const withQ = await patch(`${R2}/wheel/picks/${firstPick.id}`, { ask: 'verbal', questionId: firstPick.questionId });
  check('a verbal ask naming a question is a 400', withQ.status === 400);
  const wheel = await get(`${R2}/wheel`);
  check('the wheel lists the four asks', same(wheel.body.asks?.map((a) => a.id), ['bank', 'diagram', 'demo', 'verbal']));

  const second = await post(`${R2}/wheel/draw`, { withQuestion: true });
  check('a second pick\'s question is drawn too (every question has been asked, so the pool widens)', second.status === 201
    && Boolean(second.body.pick?.questionId) && second.body.pick.questionDraw?.poolSize === DRAWABLE);
  const plain = await post(`${R2}/wheel/draw`, {});
  check('a draw without the option is as before: no question', plain.status === 201 && plain.body.pick?.questionId === null
    && plain.body.pick.questionDraw === null);

  check('an HOD may not draw or ask for another', (await post(`${R2}/wheel/draw`, { withQuestion: true }, 'hod')).status === 403
    && (await post(`${R2}/wheel/picks/${second.body.pick.id}/next-question`, {}, 'hod')).status === 403);
  const other = await post(`${R2}/wheel/picks/${second.body.pick.id}/next-question`, {}, 'profB');
  check('another professor gets the same 404 as for nothing at all', other.status === 404
    && other.body.error === (await post('/api/session/ZZZZZZ/wheel/picks/x/next-question', {})).body.error);
  const noPick = await post(`${R2}/wheel/picks/${'f'.repeat(24)}/next-question`, {});
  check('a pick that is not there: 404', noPick.status === 404);
}

// ------------------------------------------------------ suggestions (L1, C2) --

console.log('\nsuggestions with a stand-in model (fixture replies through the real parsing)');
const prompts = [];
let fixture = () => ({ activity: 'group', title: 'Benches trace it',
  text: 'Benches of four write the preorder sequence of the tree on slide 4 on paper, then compare with the bench behind.', slides: [4, 99] });
useModelForTests(async (prompt) => { prompts.push(prompt); return JSON.stringify(fixture()); });

async function settle(path, requestId, as = 'profA') {
  for (let i = 0; i < 200; i += 1) {
    const r = await get(`${path}/teaching-moves/requests/${requestId}`, as);
    if (r.status !== 200 || r.body.state !== 'running') return r;
    await wait(10);
  }
  return { status: 0, body: {} };
}

let move;
{
  // The topic is named here: which topic went worst in this room depends on the
  // questions the selector dealt the phones, which it picks at random within a
  // level, so leaving it to the server made this step pass or fail by luck.
  // chooseTopic's own rule is pinned by its unit tests (test/zipgaps1.test.js).
  const asked = await post(`${R2}/teaching-moves`, { topic: 'Traversals' });
  check('"Suggest a move": answered at once, the suggestion written in the background', asked.status === 202 && asked.body.state === 'running'
    && Boolean(asked.body.requestId) && asked.body.purpose === 'move' && asked.body.basis?.focus?.level, JSON.stringify(asked.body).slice(0, 300));
  const done = await settle(R2, asked.body.requestId);
  move = done.body.suggestion;
  check('it arrives: a group activity, marked as an AI suggestion, citing only the slide offered', done.status === 200 && done.body.state === 'done'
    && move?.kind === 'group' && move.label === 'AI suggestion, your call' && same(move.sourceRef?.slides, [4])
    && move.purpose === 'move' && Boolean(move.focus?.level), JSON.stringify(done.body).slice(0, 300));
  check('kept with the figures it rests on: counts, the support band, not answered', move?.basis?.support?.count === 1
    && move.basis.notAnswered === 1 && move.basis.present === 3 && /Based on /.test(move.basis.sentence ?? ''), JSON.stringify(move?.basis));
  const names = ROSTER.flatMap((s) => [s.name, s.roll]);
  check('no name or roll number reached the model, nor the basis kept', prompts.length === 1
    && names.every((n) => !prompts[0].includes(n)) && names.every((n) => !JSON.stringify(move?.basis).includes(n)));
  check('the model was given the chapter\'s own words for the topic', /Preorder visits the root first/.test(prompts[0])
    && /Trees/.test(prompts[0]));

  fixture = () => ({ activity: 'think', title: 'Pairs explain', text: 'Pairs explain to each other why postorder visits the root last.', slides: [5] });
  const again = await post(`${R2}/teaching-moves`, {});
  const second = await settle(R2, again.body.requestId);
  check('"Another idea": a second suggestion, the model told the first to avoid', second.body.state === 'done'
    && second.body.suggestion?.kind === 'think' && /Do not repeat/.test(prompts[1]) && prompts[1].includes('Benches trace it'));

  fixture = () => ({ activity: 'real', title: 'Folders', text: 'Ask where trees appear around them: phone folders, a family tree.', slides: [] });
  const c2 = await post(`${R2}/teaching-moves`, { kind: 'real' });
  const c2done = await settle(R2, c2.body.requestId);
  check('an activity\'s prompt written for the chapter (C2): the kind asked for', c2.status === 202 && c2.body.purpose === 'prompt'
    && c2done.body.suggestion?.kind === 'real' && c2done.body.suggestion.purpose === 'prompt'
    && /"Real-world application" activity on this chapter/.test(prompts[2]));

  fixture = () => ({ activity: 'think', text: 'This one is fine but the wrong kind.' });
  const wrongKind = await post(`${R2}/teaching-moves`, { kind: 'check' });
  const wk = await settle(R2, wrongKind.body.requestId);
  fixture = () => ({ activity: 'think', text: 'Let the weak students go first.' });
  const judging = await post(`${R2}/teaching-moves`, {});
  const jd = await settle(R2, judging.body.requestId);
  check('a reply of another kind, or one that labels students, is refused whole: nothing kept, a plain sentence',
    wk.body.state === 'failed' && jd.body.state === 'failed' && jd.body.message === FAILED_MESSAGE && jd.body.suggestion === null
    && (await repo.listTeachingMoves(r2.body.sessionId)).length === 3);

  check('a kind outside the five, or a topic not in the chapter, is a 400', (await post(`${R2}/teaching-moves`, { kind: 'quiz' })).status === 400
    && (await post(`${R2}/teaching-moves`, { topic: 'Graphs' })).status === 400);
  fixture = () => ({ activity: 'check', text: 'Hands up: which of these is a max-heap?', slides: [7] });
  const named = await post(`${R2}/teaching-moves`, { kind: 'check', topic: 'heaps' });
  const nd = await settle(R2, named.body.requestId);
  check('a topic the professor names is the one drawn on', nd.body.suggestion?.topic === 'Heaps' && same(nd.body.suggestion?.sourceRef?.slides, [7])
    && /A max-heap keeps the largest key/.test(prompts.at(-1)));

  const list = await get(`${R2}/teaching-moves`);
  check('the room\'s list: every kept suggestion, oldest first, staff only', list.status === 200 && list.body.modelReady === true
    && same(list.body.suggestions.map((s) => s.kind), ['group', 'think', 'real', 'check']) && /Staff only/.test(list.body.note));
}

console.log('\n"Use it": the suggestion recorded as an activity');
{
  const used = await post(`${R2}/activities`, { suggestionId: move.id, outcome: 'Most benches got it' });
  check('recorded through the activities route, its kind the suggestion\'s, pointing back at it', used.status === 201
    && used.body.activity?.kind === 'group' && used.body.activity.suggestionId === move.id, JSON.stringify(used.body));
  const list = await get(`${R2}/teaching-moves`);
  check('the suggestion lists the activity run from it', same(list.body.suggestions[0].used, [used.body.activity?.id]));
  const wrong = await post(`${R2}/activities`, { suggestionId: move.id, kind: 'think' });
  check('recorded as another kind: a 400 with a sentence', wrong.status === 400 && /group challenge/.test(wrong.body.error ?? ''));
  const r3 = await post('/api/session', { contentId: CONTENT, title: 'Another room' });
  const elsewhere = await post(`/api/session/${r3.body.code}/activities`, { suggestionId: move.id });
  check('another room cannot use this room\'s suggestion', elsewhere.status === 400);
  const plainAct = await post(`${R2}/activities`, { kind: 'think' });
  check('an activity without a suggestion is as before', plainAct.status === 201 && plainAct.body.activity.suggestionId === null);

  // A room with no answers yet: no move to aim, but a prompt is fine.
  fixture = () => ({ activity: 'diagram', text: 'Project the tree on slide 4 and ask one bench to walk it.', slides: [4] });
  const early = await post(`/api/session/${r3.body.code}/teaching-moves`, {});
  check('a move before any graded answer: 409, nowhere to aim it', early.status === 409 && /No graded answers yet/.test(early.body.error ?? ''));
  const prompt = await post(`/api/session/${r3.body.code}/teaching-moves`, { kind: 'diagram' });
  check('but an activity prompt can be asked before any answer', prompt.status === 202
    && (await settle(`/api/session/${r3.body.code}`, prompt.body.requestId)).body.state === 'done');
}

console.log('\nwho may read, ask and use');
{
  check('an HOD reads the room\'s suggestions', (await get(`${R2}/teaching-moves`, 'hod')).status === 200);
  check('an HOD may not ask for one, nor record one', (await post(`${R2}/teaching-moves`, {}, 'hod')).status === 403
    && (await post(`${R2}/activities`, { suggestionId: move.id }, 'hod')).status === 403);
  const nothing = await get('/api/session/ZZZZZZ/teaching-moves');
  const theirs = await get(`${R2}/teaching-moves`, 'profB');
  check('another professor gets the same 404 as for nothing at all, word for word', theirs.status === 404
    && theirs.body.error === nothing.body.error && (await post(`${R2}/teaching-moves`, {}, 'profB')).status === 404);
  check('a student and no credentials are refused', [401, 403].includes((await get(`${R2}/teaching-moves`, 'student')).status)
    && (await get(`${R2}/teaching-moves`, null)).status === 401);
  const req = await post(`${R2}/teaching-moves`, { kind: 'think' });
  await settle(R2, req.body.requestId);
  const hodRead = await get(`${R2}/teaching-moves/requests/${req.body.requestId}`, 'hod');
  check('a request is its asker\'s: the HOD reading it gets a 404', hodRead.status === 404);
  await post(`${R2}/close`, {});
  check('a closed room takes no request', (await post(`${R2}/teaching-moves`, {})).status === 409
    && (await post(`${R2}/wheel/picks/${firstPick.id}/next-question`, {})).status === 409);
}
useModelForTests(null);

// ------------------------------------------------------------ analytics --

console.log('\nclass analytics: the latest room against the one before (A1), each hardest question\'s chapter (A3)');
{
  // Enough answers on one question for the hardest list's floor (five), as
  // last week's evidence rows: the phones above answered too few of any one.
  const [hard] = (await repo.listQuestions(content._id)).filter((q) => q.bloom === 'apply');
  for (const [i, rollNo] of ['21CS01', '21CS02', '21CS03', '21CS04', 'GUEST5'].entries()) {
    await repo.recordAnswer({
      sessionId: r1.body.sessionId, answerKey: `hard-${i}-000000`, rollNo, questionId: String(hard._id), contentId: CONTENT,
      topic: hard.topic, bloom: hard.bloom, kind: 'mcq', questionSnapshot: { id: String(hard._id), text: hard.text }, response: 0,
      attempt: 1, final: true, correct: i === 0, score: i === 0 ? 1 : 0, ungraded: false, answeredAt: '2026-11-19T09:30:00.000Z',
      language: 'en', questionSource: 'llm', detail: '', autoCorrect: i === 0, autoScore: i === 0 ? 1 : 0, autoDetail: '', reviewStatus: 'auto',
    });
  }
  const a = await get(`/api/classes/${classId}/analytics`);
  const c = a.body.comparison;
  check('the comparison: last week, then today', a.status === 200 && c?.previous?.code === r1.body.code && c?.latest?.code === r2.body.code,
    JSON.stringify(c).slice(0, 300));
  const roomsLevels = a.body.rooms.map((r) => r.levels.reduce((n, l) => n + l.answers, 0));
  check('each room carries its own level figures', same(roomsLevels, [10, 8]), JSON.stringify(roomsLevels));
  const withBoth = c?.levels.filter((l) => l.previous.answers && l.latest.answers) ?? [];
  check('a change in points wherever both rooms have answers at a level, and null where one has none',
    withBoth.every((l) => l.change === Math.round((l.latest.accuracy - l.previous.accuracy) * 1000) / 10)
    && c.levels.filter((l) => !l.previous.answers || !l.latest.answers).every((l) => l.change === null) && c.levelBands.length === 3,
    JSON.stringify(c?.levels));
  check('every hardest question names its chapter, so a screen can open it in the bank', a.body.hardest.items.length > 0
    && a.body.hardest.items.every((i) => i.contentId === CONTENT) && a.body.hardest.items.some((i) => i.questionId === String(hard._id)),
  JSON.stringify(a.body.hardest.items.map((i) => [i.questionId, i.contentId])));
}

for (const p of Object.values(today)) p.s.disconnect();
check('nothing left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
process.exit(fail ? 1 : 0);
