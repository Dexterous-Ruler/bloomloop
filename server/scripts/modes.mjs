// Phase 3 - how a room runs, end to end: its settings, the waiting room,
// Teacher-led and Mixed, and the classroom projector.
//
//   node server/scripts/modes.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with real phones, teacher screens and
// projectors over Socket.io, and checks:
//
//   defaults     a room that sets nothing runs exactly as before: open, phones
//                served, no time on a question, the grid's shape unchanged
//   adapt        with adapt off, right answers move nobody; with it on they do;
//                the start level is where students start
//   cap          questionsPerStudent ends a student's room with a reason
//   time         timePerQuestion goes out with each question, and a late answer
//                is taken
//   404s         another professor's room and no room at all are one 404, word
//                for word, on grid, pause, resume, close, integrity and delete
//   lobby        a waiting room serves nothing, says so, starts on the
//                professor's word (and only theirs), then serves the waiting
//                phones and anyone joining later; "N / M present" on the grid;
//                with the store slowed, a close during a start stays closed and
//                of two starts one is a 409, and each phone is served once
//   teacher-led  needs a class; a phone is told and never served; the records
//                work with no phone; it starts with nobody joined; "from joins"
//                attendance is refused; a bank question's key may go up
//   mixed        phones answer as usual and the teacher's grid carries the
//                records beside the answers, labelled; phones see none of it
//   projector    a link's token works once made, by the owner only, is stored
//                as a hash; the three screens; a revealed key and not before,
//                and never a bank question's key where phones may be served it;
//                counts per level only from five students answered; the pick's
//                first name; a diagram the projector can load with no
//                credential, in a waiting room too; revocation; a link's
//                12-hour lifetime; one connection is never a phone and a
//                projector at once; refused after
//                close; and the whitelist walk: every event any projector got
//                in the whole run is checked against a whitelist kept HERE, and
//                for names, keys, scores, observations and unrevealed answers
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As in
// roster.mjs, the server is pointed at http://supabase.invalid (a name that can
// never resolve) and the three account calls it makes are answered here,
// in-process. Any other request off this machine is refused outright and counted.
//
// Never calls Gemini, Supabase or any network service. Exits non-zero on any failure.

import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { mediaUrl } = await import(`${SRC}services/media.js`);
const projectorService = await import(`${SRC}services/projector.js`);

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
  hod: 'b0000000-0000-4000-8000-000000000001',
  profA: 'b0000000-0000-4000-8000-000000000002',
  profB: 'b0000000-0000-4000-8000-000000000003',
  hodOther: 'b0000000-0000-4000-8000-000000000004',
};
const account = (id, role, department, reportsTo) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-MODE0${id.slice(-1)}`,
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
  const walk = (id) => {
    for (const a of ACCOUNTS.values()) if (a.reports_to === id) { out.push(a); walk(a.id); }
  };
  walk(root);
  return out;
};

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

let refusedOffMachine = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  if (url.origin !== FAKE_ORIGIN) {
    refusedOffMachine += 1;
    throw new Error(`modes.mjs refuses to reach ${url.origin}`);
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
  if (url.pathname === '/rest/v1/rpc/accounts_below') {
    return reply(below(JSON.parse(init.body ?? '{}').root));
  }
  return reply({ message: `not answered by modes.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'modes-test-service-key';

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
const del = (path, as) => call('DELETE', path, { as });

const sockets = [];
function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function next(socket, event, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, on); reject(new Error(`timeout waiting for ${event}`)); }, ms);
    const on = (p) => { clearTimeout(timer); resolve(p); };
    socket.once(event, on);
  });
}

/** The first of these events to arrive, with its name. */
function either(socket, events, ms = 4000) {
  return new Promise((resolve, reject) => {
    const handlers = {};
    const done = (name, payload) => {
      clearTimeout(timer);
      for (const [e, h] of Object.entries(handlers)) socket.off(e, h);
      resolve({ name, payload });
    };
    for (const e of events) { handlers[e] = (p) => done(e, p); socket.on(e, handlers[e]); }
    const timer = setTimeout(() => {
      for (const [e, h] of Object.entries(handlers)) socket.off(e, h);
      reject(new Error(`timeout waiting for ${events.join(' / ')}`));
    }, ms);
  });
}

/** Every event a socket receives from now on, kept in `log`. */
function record(socket, log) {
  socket.onAny((event, ...args) => log.push({ event, payload: args[0] }));
  return log;
}

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

// Every event every phone receives.
const phoneEvents = [];
/** A phone joins; resolves with its socket, what it was told first and the first item (question, waiting...). */
async function join(code, rollNo, name = '') {
  const s = await connect();
  s.onAny((event, ...args) => phoneEvents.push({ rollNo, event, args }));
  const first = either(s, ['session:accepted', 'session:rejected', 'session:teacher-led']);
  const item = either(s, ['server:question', 'server:waiting', 'server:exhausted', 'session:paused']);
  s.emit('student:join', { code, rollNo, name });
  const told = await first;
  // A phone that was not accepted (a Teacher-led room) is never sent an item:
  // its wait times out unread, and must not end the run as an unhandled rejection.
  if (told.name !== 'session:accepted') item.catch(() => {});
  return { s, told, item: told.name === 'session:accepted' ? await item : null };
}

const answerKey = () => crypto.randomBytes(8).toString('hex');
/** Every fixture question's key is option 1, so this is always right. */
function answerRight(s, served) {
  const result = next(s, 'server:result');
  s.emit('student:answer', { questionId: served.question._id, response: 1, answerId: answerKey() });
  return result;
}
function askNext(s) {
  const got = either(s, ['server:question', 'server:exhausted', 'server:waiting']);
  s.emit('student:next', {});
  return got;
}

/** A teacher's screen watching a room. */
async function watch(code, as = 'profA') {
  const t = await connect();
  const grids = [];
  t.on('teacher:grid', (g) => grids.push(g));
  const status = next(t, 'teacher:status');
  t.emit('teacher:watch', { code, token: TOKENS[as] });
  await status;
  return { t, grids, last: () => grids.at(-1) };
}

// ------------------------------------------------------------ fixtures --

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const OPTIONS = ['Inorder', 'Preorder', 'Postorder', 'Level-order'];

/** A chapter of professor A's: six Understand and four Apply questions, an image one and a passage one, every key option 1. */
async function chapter(title) {
  const content = await repo.createContent({ title, kind: 'syllabus', rawText: '', topics: ['Trees'], ownerId: ID.profA });
  const media = await repo.createMedia({
    ownerId: ID.profA, contentId: content._id, mime: 'image/png', bytes: PNG.length,
    sha256: crypto.createHash('sha256').update(PNG).digest('hex'), data: PNG, alt: 'A binary tree with seven nodes',
  });
  const mcq = (i, bloom, extra = {}) => ({
    contentId: content._id, topic: 'Trees', text: `${title}: which traversal is step ${i}?`, kind: 'mcq',
    options: OPTIONS, answerIdx: 1, bloom, source: 'llm', status: 'active', ...extra,
  });
  const qs = await repo.insertQuestions([
    ...Array.from({ length: 6 }, (_, i) => mcq(i, 'understand')),
    ...Array.from({ length: 4 }, (_, i) => mcq(i + 6, 'apply')),
    mcq(10, 'remember', { stimulus: { kind: 'image', url: mediaUrl(media._id), alt: 'A binary tree with seven nodes', sourceRef: 'Unit 3 slide 4' } }),
    mcq(11, 'remember', { stimulus: { kind: 'passage', text: 'A tree is a connected graph with no cycles.' } }),
  ]);
  return { content, media, questions: qs, image: qs[10], passage: qs[11], first: qs[0] };
}

const NOWHERE = 'ZZZZZZ'; // a room code no store holds
const ROSTER = [{ roll: '21CS01', name: 'Asha Rao' }, { roll: '21CS02', name: 'Bilal Khan' }, { roll: '21CS03', name: 'Chitra Iyer' }];
const FIRST = ROSTER.map((r) => r.name.split(' ')[0]);
const LAST = ROSTER.map((r) => r.name.split(' ')[1]);

const made = await post('/api/classes', { courseName: 'Data Structures', section: 'SY-CS A' });
const classId = made.body.class?.id;
await post(`/api/classes/${classId}/students`, { students: ROSTER });
const sid = Object.fromEntries(((await get(`/api/classes/${classId}`)).body.students ?? []).map((s) => [s.rollNo, s.id]));
const A = await chapter('Trees');
check('fixtures: a class of three and a chapter of twelve', made.status === 201 && Object.keys(sid).length === 3 && A.questions.length === 12,
  `HTTP ${made.status}`);

const open = async (body, as = 'profA') => post('/api/session', { contentId: A.content._id, ...body }, as);

// ------------------------------------------------------------- defaults --

console.log('\na room that sets nothing runs exactly as before');
{
  const r = await open({});
  const s = r.body.settings ?? {};
  check('it opens, open, on Student devices, adapting, from Understand, with no cap and no time',
    r.status === 200 && r.body.status === 'open' && s.mode === 'devices' && s.adapt === true && s.startLevel === 'understand'
    && s.questionsPerStudent === null && s.timePerQuestion === null, JSON.stringify(r.body));
  const pub = await get(`/api/session/${r.body.code}`, null);
  check('the phones\' read of the room carries the settings it runs under', pub.body.session?.settings?.mode === 'devices'
    && pub.body.session?.status === 'open');
  const teacher = await watch(r.body.code);
  const phone = await join(r.body.code, '21CS09', 'Guest');
  check('a phone is served at once, with no time on the question', phone.item?.name === 'server:question'
    && !('timePerQuestion' in phone.item.payload) && phone.item.payload.question?.bloom === 'understand',
  JSON.stringify(phone.item));
  await settle();
  check('its live grid is still { rows, code }', JSON.stringify(Object.keys(teacher.last() ?? {}).sort()) === '["code","rows"]',
    JSON.stringify(Object.keys(teacher.last() ?? {})));
  const rest = await get(`/api/session/${r.body.code}/grid`);
  check('and its REST grid { rows, levels }', JSON.stringify(Object.keys(rest.body).sort()) === '["levels","rows"]');
  phone.s.disconnect();
  teacher.t.disconnect();
}

{
  const bad = await Promise.all([
    open({ mode: 'lecture' }), open({ adapt: 'no' }), open({ startLevel: 'analyze' }), open({ questionsPerStudent: 0 }),
    open({ questionsPerStudent: 2.5 }), open({ timePerQuestion: 5 }), open({ timePerQuestion: 601 }), open({ lobby: 'yes' }),
  ]);
  check('each setting outside its range is a 400 that names it', bad.every((r) => r.status === 400)
    && ['mode', 'adapt', 'startLevel', 'questionsPerStudent', 'questionsPerStudent', 'timePerQuestion', 'timePerQuestion', 'lobby']
      .every((k, i) => bad[i].body.error?.includes(k)), JSON.stringify(bad.map((r) => [r.status, r.body.error])));
}

{
  // "Not yours" and "not there" are one 404, word for word, on the room's
  // older routes as on every Phase 3 one: a reply must not say which codes exist.
  const code = (await open({})).body.code;
  const asked = [];
  for (const [method, tail] of [['GET', '/grid'], ['POST', '/pause'], ['POST', '/resume'], ['POST', '/close'], ['GET', '/integrity/21CS01']]) {
    const body = method === 'POST' ? {} : undefined;
    const theirs = await call(method, `/api/session/${code}${tail}`, { body, as: 'profB' });
    const nowhere = await call(method, `/api/session/${NOWHERE}${tail}`, { body });
    asked.push([tail, theirs.status, nowhere.status, theirs.body.error, nowhere.body.error]);
  }
  const theirs = await del(`/api/session/${code}?confirm=${code}`, 'profB');
  const nowhere = await del(`/api/session/${NOWHERE}?confirm=${NOWHERE}`);
  asked.push(['DELETE', theirs.status, nowhere.status, theirs.body.error, nowhere.body.error]);
  const differ = asked.filter(([, a, b, x, y]) => !(a === 404 && b === 404 && x === y));
  check('another professor\'s room and one that does not exist are one 404, word for word: grid, pause, resume, close, integrity, delete',
    differ.length === 0, JSON.stringify(differ));
  check('and the other professor changed nothing', (await repo.getSessionByCode(code))?.status === 'open');
}

// ---------------------------------------------------------------- adapt --

console.log('\nthe adapt switch and the start level');
{
  const on = await open({});
  const off = await open({ adapt: false });
  const levelsAfterFive = async (code, roll) => {
    const p = await join(code, roll, roll);
    let served = p.item.payload;
    const levels = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await answerRight(p.s, served);
      levels.push(res.workingLevel);
      const got = await askNext(p.s);
      served = got.payload;
    }
    p.s.disconnect();
    return levels;
  };
  const climbing = await levelsAfterFive(on.body.code, '21CS21');
  const held = await levelsAfterFive(off.body.code, '21CS22');
  check('with adapt on, right answers promote (the control)', climbing.includes('apply'), climbing.join(', '));
  check('with adapt off, five right answers leave the student at the start level', held.every((l) => l === 'understand'), held.join(', '));
  const profile = await repo.getProfile(off.body.sessionId, '21CS22');
  check('and the answers are still recorded', profile?.levels?.understand?.seen === 5 && profile?.levels?.understand?.correct === 5,
    JSON.stringify(profile?.levels));
  check('the reason says the level is held', /Adaptive levels are off in this room/.test(profile?.reason ?? ''), profile?.reason);

  const fromApply = await open({ adapt: false, startLevel: 'apply' });
  const p = await join(fromApply.body.code, '21CS23', 'x');
  check('a room from Apply starts its students at Apply and serves Apply',
    p.told.payload?.profile?.workingLevel === 'apply' && p.item?.payload?.question?.bloom === 'apply',
    `${p.told.payload?.profile?.workingLevel} / ${p.item?.payload?.question?.bloom}`);
  p.s.disconnect();
}

// ------------------------------------------------- the cap and the time --

console.log('\nquestions per student, and time per question');
{
  const r = await open({ questionsPerStudent: 2, timePerQuestion: 60 });
  check('the room reports both', r.body.settings?.questionsPerStudent === 2 && r.body.settings?.timePerQuestion === 60);
  const p = await join(r.body.code, '21CS31', 'x');
  check('each question goes out with its seconds', p.item?.payload?.timePerQuestion === 60, JSON.stringify(p.item?.payload));

  // Late: the question was served five minutes ago, far past its 60 seconds.
  const stored = await repo.getProfile(r.body.sessionId, '21CS31');
  const late = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await repo.saveProfile({ ...stored, served: { ...stored.served, at: late } });
  const first = await answerRight(p.s, p.item.payload);
  check('a late answer is taken and marked like any other', first.correct === true && !first.retry, JSON.stringify(first));
  const [row] = await repo.listAnswers({ sessionId: r.body.sessionId, rollNo: '21CS31' });
  check('and its row says how long it took', Date.parse(row.answeredAt) - Date.parse(row.servedAt) > 4 * 60 * 1000,
    `${row.servedAt} -> ${row.answeredAt}`);

  const second = await askNext(p.s);
  check('the second question comes, with its seconds', second.name === 'server:question' && second.payload.timePerQuestion === 60);
  await answerRight(p.s, second.payload);
  const third = await askNext(p.s);
  check('after two the student is done, and told why', third.name === 'server:exhausted'
    && /asks each student 2 questions, and you have answered them all/.test(third.payload?.reason ?? ''), JSON.stringify(third.payload));
  const answered = new Set((await repo.listAnswers({ sessionId: r.body.sessionId })).map((a) => String(a.questionId)));
  const unserved = A.questions.find((q) => !answered.has(String(q._id)));
  const refused = either(p.s, ['server:exhausted', 'server:result']);
  p.s.emit('student:answer', { questionId: String(unserved._id), response: 1, answerId: answerKey() });
  const r2 = await refused;
  check('an answer to a question never served, past the cap, is not taken', r2.name === 'server:exhausted'
    && (await repo.listAnswers({ sessionId: r.body.sessionId })).length === 2, r2.name);
  p.s.disconnect();
}

// ------------------------------------------------------- the waiting room --

console.log('\nthe waiting room');
{
  const r = await open({ lobby: true });
  const code = r.body.code;
  check('a room opened with a waiting room is waiting', r.status === 200 && r.body.status === 'waiting', JSON.stringify(r.body));
  const pub = await get(`/api/session/${code}`, null);
  check('and says so to the phones\' read of it', pub.body.session?.status === 'waiting');
  const early = await post(`/api/session/${code}/start`, {});
  check('it cannot start with nobody in it', early.status === 409 && /No phone has joined/.test(early.body.error ?? ''), early.body.error);

  const teacher = await watch(code);
  const a = await join(code, '21CS41', 'Waiting A');
  check('a phone joins it and is told to wait, with no question', a.told.name === 'session:accepted' && a.item?.name === 'server:waiting'
    && typeof a.item.payload?.message === 'string', JSON.stringify(a.item));
  const nudge = await askNext(a.s);
  check('asking for a question while waiting is told to wait again', nudge.name === 'server:waiting');
  const answerEarly = either(a.s, ['server:waiting', 'server:result']);
  a.s.emit('student:answer', { questionId: String(A.first._id), response: 1, answerId: answerKey() });
  check('and an answer sent while waiting is not taken', (await answerEarly).name === 'server:waiting'
    && (await repo.listAnswers({ sessionId: r.body.sessionId })).length === 0);
  await settle();
  const w = teacher.last()?.waiting;
  check('the teacher\'s grid says who is waiting', w?.joinedN === 1 && w?.summary === '1 joined' && w?.canStart === true, JSON.stringify(w));
  const rest = await get(`/api/session/${code}/grid`);
  check('the REST grid too', rest.body.waiting?.joinedN === 1);

  const paused = await post(`/api/session/${code}/pause`, {});
  check('a waiting room cannot be paused', paused.status === 409, `${paused.status}`);
  const [hodStart, otherStart, nowhere] = await Promise.all([
    post(`/api/session/${code}/start`, {}, 'hod'), post(`/api/session/${code}/start`, {}, 'profB'), post(`/api/session/${NOWHERE}/start`, {}),
  ]);
  check('an HOD may not start it (403)', hodStart.status === 403, `${hodStart.status}`);
  check('another professor gets the same 404 as a room that does not exist', otherStart.status === 404
    && otherStart.body.error === nowhere.body.error, `${otherStart.body.error} / ${nowhere.body.error}`);

  const served = next(a.s, 'server:question');
  const status = next(teacher.t, 'teacher:status');
  const started = await post(`/api/session/${code}/start`, {});
  check('the professor starts it', started.status === 200 && started.body.session?.status === 'open', JSON.stringify(started.body));
  const q = await served.catch(() => null);
  check('the waiting phone gets its first question', Boolean(q?.question?._id));
  check('the teacher\'s screens hear it is open', (await status.catch(() => null))?.status === 'open');
  const b = await join(code, '21CS42', 'Late B');
  check('a late joiner is served at once', b.item?.name === 'server:question');
  const again = await post(`/api/session/${code}/start`, {});
  check('starting it again is a 409', again.status === 409 && /already started/.test(again.body.error ?? ''));
  await settle();
  check('once open, the grid no longer carries the waiting line', !('waiting' in (teacher.last() ?? {})));
  a.s.disconnect();
  b.s.disconnect();
  teacher.t.disconnect();
}

{
  // A class room's waiting line counts attendance: "1 / 2 present".
  const r = await open({ lobby: true, classId });
  await post(`/api/session/${r.body.code}/attendance`, { marks: [{ studentId: sid['21CS01'], status: 'present' }, { studentId: sid['21CS02'], status: 'late' }] });
  const a = await join(r.body.code, '21CS01', 'Asha Rao');
  const grid = await get(`/api/session/${r.body.code}/grid`);
  check('a class room\'s waiting line is "joined / present"', grid.body.waiting?.summary === '1 / 2 present'
    && grid.body.waiting?.classSize === 3, JSON.stringify(grid.body.waiting));
  const closed = next(a.s, 'session:closed');
  await post(`/api/session/${r.body.code}/close`, {});
  check('a waiting room can be closed, and its phones are told', Boolean(await closed.catch(() => null)));
  a.s.disconnect();
}

console.log('\nstarting a waiting room, against a close and against itself');
/** Run `fn` with every listProfiles slowed by 80 ms, as a Supabase round trip would be. */
async function slowStore(fn) {
  const listProfiles = repo.listProfiles;
  repo.listProfiles = async (...args) => { await settle(80); return listProfiles.apply(repo, args); };
  try {
    return await fn();
  } finally {
    repo.listProfiles = listProfiles;
  }
}
{
  const r = await open({ lobby: true });
  const code = r.body.code;
  const a = await join(code, '21CS44', 'Race A');
  const heard = record(a.s, []);
  const [start, close] = await slowStore(async () => {
    const starting = post(`/api/session/${code}/start`, {});
    await settle(20);
    const closing = await post(`/api/session/${code}/close`, {});
    return [await starting, closing];
  });
  await settle(300);
  const stored = await repo.getSessionByCode(code);
  check('a close that lands while a start is at work leaves the room closed: closed is final',
    close.status === 200 && stored?.status === 'closed' && Boolean(stored?.closedAt),
    `close ${close.status}, start ${start.status} ${start.body.error ?? ''}, stored ${stored?.status}`);
  const events = heard.map((e) => e.event);
  const shut = events.indexOf('session:closed');
  check('and the phone is never served after it was told the room closed', shut >= 0 && !events.slice(shut).includes('server:question'),
    events.join(', '));
  a.s.disconnect();
}
{
  const r = await open({ lobby: true });
  const code = r.body.code;
  const a = await join(code, '21CS45', 'Race B');
  const heard = record(a.s, []);
  const both = await slowStore(() => Promise.all([post(`/api/session/${code}/start`, {}), post(`/api/session/${code}/start`, {})]));
  await settle(400);
  check('two starts at once: one starts the room, the other is a 409', JSON.stringify(both.map((x) => x.status).sort()) === '[200,409]',
    both.map((x) => `${x.status} ${x.body.error ?? ''}`).join(' / '));
  check('and the waiting phone is served once', heard.filter((e) => e.event === 'server:question').length === 1,
    heard.map((e) => e.event).join(', '));
  a.s.disconnect();
  await post(`/api/session/${code}/close`, {});
}

// ------------------------------------------------------------ Teacher-led --

console.log('\nTeacher-led: no phones');
let tlCode;
{
  const noClass = await open({ mode: 'teacher-led' });
  check('Teacher-led with no class is a 400 that says why', noClass.status === 400 && /needs a class/.test(noClass.body.error ?? ''),
    noClass.body.error);
  const r = await open({ mode: 'teacher-led', classId, lobby: true });
  tlCode = r.body.code;
  check('Teacher-led for a class opens', r.status === 200 && r.body.settings?.mode === 'teacher-led' && r.body.status === 'waiting');

  const phone = await join(tlCode, '21CS02', 'Bilal Khan');
  check('a phone that tries to join is told the room is teacher-led', phone.told.name === 'session:teacher-led'
    && /teacher-led/.test(phone.told.payload?.message ?? ''), JSON.stringify(phone.told));
  const refused = either(phone.s, ['session:rejected', 'server:result', 'server:question']);
  phone.s.emit('student:answer', { questionId: String(A.first._id), response: 1, answerId: answerKey() });
  check('and is never served or marked', (await refused).name === 'session:rejected'
    && (await repo.listProfiles(r.body.sessionId)).length === 0
    && (await repo.listAnswers({ sessionId: r.body.sessionId })).length === 0
    && (await repo.listAttendance(r.body.sessionId)).length === 0);
  phone.s.disconnect();

  const started = await post(`/api/session/${tlCode}/start`, {});
  check('it starts with no phone joined', started.status === 200 && started.body.session?.status === 'open', JSON.stringify(started.body));
  const fromJoins = await post(`/api/session/${tlCode}/attendance`, { fromJoins: true });
  check('"everyone who joined present, the rest absent" is refused here: no phone joins, so it would mark the whole class absent',
    fromJoins.status === 409 && /Teacher-led/.test(fromJoins.body.error ?? '') && (await repo.listAttendance(r.body.sessionId)).length === 0,
    `${fromJoins.status} ${fromJoins.body.error ?? ''}`);
  const teacher = await watch(tlCode);
  await post(`/api/session/${tlCode}/attendance`, { marks: ROSTER.map((s) => ({ studentId: sid[s.roll], status: 'present' })) });
  const draw = await post(`/api/session/${tlCode}/wheel/draw`, {});
  const obs = await post(`/api/session/${tlCode}/observations`, { rollNo: '21CS03', kind: 'revision', note: 'Mixed up the traversals' });
  const tally = await post(`/api/session/${tlCode}/tallies`, { questionId: String(A.first._id) });
  const act = await post(`/api/session/${tlCode}/activities`, { kind: 'think', outcome: 'Most could explain preorder' });
  check('the wheel, an observation, a tally and an activity all work with no phone',
    draw.status === 201 && obs.status === 200 && tally.status === 201 && act.status === 201,
    [draw, obs, tally, act].map((x) => x.status).join(', '));
  await settle();
  const feed = teacher.last()?.feed;
  check('the teacher\'s grid carries the records under their own label, and no digital answers',
    feed?.mode === 'teacher-led' && feed?.teacher?.label === 'Teacher records' && feed?.teacher?.observations?.revision === 1
    && feed?.teacher?.wheel?.picks === 1 && feed?.teacher?.tallies === 1 && feed?.teacher?.activities === 1 && !('digital' in feed),
    JSON.stringify(feed));
  const level = await repo.listProfiles(r.body.sessionId);
  check('and no record made anyone a profile or a level', level.length === 0);
  const put = await patch(`/api/session/${tlCode}/projector`, { mode: 'question', question: { questionId: String(A.first._id) } });
  const key = await patch(`/api/session/${tlCode}/projector`, { revealed: true });
  check('no phone is served here, so a bank question\'s key may go on the wall', put.status === 200 && key.status === 200
    && JSON.stringify(key.body.shows?.question?.correct) === '["B"]', `${key.status} ${key.body.error ?? ''}`);
  teacher.t.disconnect();
}

// ------------------------------------------------------------------ Mixed --

console.log('\nMixed: phones and teacher records together');
let mixed;
{
  mixed = (await open({ mode: 'mixed', classId })).body;
  await post(`/api/session/${mixed.code}/attendance`, { marks: ROSTER.map((s) => ({ studentId: sid[s.roll], status: 'present' })) });
  const teacher = await watch(mixed.code);
  const asha = await join(mixed.code, '21CS01', 'Asha Rao');
  check('a phone joins and is served as on Student devices', asha.item?.name === 'server:question');
  const res = await answerRight(asha.s, asha.item.payload);
  check('and its answer is marked', res.correct === true);
  await post(`/api/session/${mixed.code}/observations`, { rollNo: '21CS01', kind: 'participated' });
  await settle();
  const feed = teacher.last()?.feed;
  check('the teacher\'s grid shows the digital answers and the teacher records apart, each labelled',
    feed?.mode === 'mixed' && feed?.digital?.label === 'Digital answers' && feed?.digital?.answered === 1
    && feed?.teacher?.label === 'Teacher records' && feed?.teacher?.observations?.participated === 1, JSON.stringify(feed));
  const row = teacher.last()?.rows?.find((x) => x.rollNo === '21CS01');
  check('and the record never touched the student\'s level or accuracy', row?.total?.seen === 1 && row?.total?.correct === 1);
  mixed.asha = asha;
  teacher.t.disconnect();
}

// -------------------------------------------------------------- projector --

console.log('\nthe projector');
const wallEvents = []; // every event every projector connection received, with which connection
async function projector(label) {
  const p = await connect();
  p.onAny((event, ...args) => wallEvents.push({ label, event, payload: args[0] }));
  return p;
}
const watchWith = (p, token) => {
  const got = either(p, ['projector:state', 'projector:refused']);
  p.emit('projector:watch', { token });
  return got;
};

let link1;
let madeUpRefusal; // the sentence a token that never existed is refused with
{
  const code = mixed.code;
  const [hodMake, otherMake, nowhereMake] = await Promise.all([
    post(`/api/session/${code}/projector/links`, {}, 'hod'),
    post(`/api/session/${code}/projector/links`, {}, 'profB'),
    post(`/api/session/${NOWHERE}/projector/links`, {}),
  ]);
  check('an HOD may not make a projector link (403)', hodMake.status === 403);
  check('another professor gets the same 404 as a room that does not exist', otherMake.status === 404 && otherMake.body.error === nowhereMake.body.error);
  link1 = await post(`/api/session/${code}/projector/links`, {});
  check('the owner makes a link: a 43-character token, once', link1.status === 201 && /^[A-Za-z0-9_-]{43}$/.test(link1.body.token ?? '')
    && link1.body.link?.active === true, JSON.stringify(link1.body));
  const stored = await repo.listProjectorLinks(mixed.sessionId);
  check('the store keeps its SHA-256 and never the token', stored.length === 1
    && stored[0].tokenHash === crypto.createHash('sha256').update(link1.body.token).digest('hex')
    && !JSON.stringify(stored).includes(link1.body.token));
  const hodRead = await get(`/api/session/${code}/projector`, 'hod');
  check('an HOD may see what it shows, and no read carries a token', hodRead.status === 200
    && !JSON.stringify(hodRead.body).includes(link1.body.token) && hodRead.body.links?.length === 1);

  const p1 = await projector('p1');
  const bad = await watchWith(p1, 'not-a-token');
  check('a made-up token is refused', bad.name === 'projector:refused');
  madeUpRefusal = bad.payload?.reason;
  const first = await watchWith(p1, link1.body.token);
  check('the token connects the projector to the room\'s screen', first.name === 'projector:state' && first.payload?.code === code
    && first.payload?.mode === 'question' && first.payload?.question === null, JSON.stringify(first.payload));

  // A projector connection that tries to be a phone or a teacher hears nothing.
  p1.emit('student:join', { code, rollNo: '21CS02', name: 'Bilal Khan' });
  p1.emit('teacher:watch', { code, token: TOKENS.profA });
  await settle(300);
  check('a projector connection is never a phone or a teacher\'s screen', wallEvents.every((e) => e.event.startsWith('projector:'))
    && !(await repo.getProfile(mixed.sessionId, '21CS02')));

  // Question: options, no key until revealed.
  let up = next(p1, 'projector:state');
  const set = await patch(`/api/session/${code}/projector`, { mode: 'question', question: { questionId: String(A.first._id) } });
  let shown = await up;
  check('a bank question goes up with its options and no key', set.status === 200 && shown.question?.text === A.first.text
    && shown.question?.options?.map((o) => o.label).join() === OPTIONS.join() && shown.question?.correct === null
    && shown.question?.revealed === false, JSON.stringify(shown.question));
  check('the professor\'s reply shows exactly what the wall shows', JSON.stringify(set.body.shows) === JSON.stringify(shown));
  // The phones of a Mixed room may still be served it: its key stays off the wall.
  const early = await patch(`/api/session/${code}/projector`, { revealed: true });
  const still = await get(`/api/session/${code}/projector`);
  check('a bank question\'s key is refused on the wall while the room\'s phones may still be served it (409, saying why)',
    early.status === 409 && /phone/.test(early.body.error ?? '') && still.body.shows?.question?.correct === null
    && still.body.screen?.revealed === false, `${early.status} ${early.body.error ?? ''}`);

  // A question asked aloud from the bank carries the bank's key: the same refusal.
  const fromBank = await post(`/api/session/${code}/tallies`, { questionId: String(A.first._id) });
  up = next(p1, 'projector:state');
  await patch(`/api/session/${code}/projector`, { question: { tallyId: fromBank.body.tally?.id } });
  await up;
  const fromBankKey = await patch(`/api/session/${code}/projector`, { revealed: true });
  check('and so is the key of a question asked aloud from the bank', fromBank.status === 201 && fromBankKey.status === 409,
    `${fromBank.status} / ${fromBankKey.status} ${fromBankKey.body.error ?? ''}`);

  // A question asked aloud.
  const tally = await post(`/api/session/${code}/tallies`, { text: 'Which traversal visits the root last?', labels: ['Pre', 'In', 'Post', 'Level'], correct: 'C' });
  up = next(p1, 'projector:state');
  await patch(`/api/session/${code}/projector`, { question: { tallyId: tally.body.tally?.id } });
  shown = await up;
  check('a question asked aloud goes up, unrevealed, with no hands', shown.question?.source === 'tally' && shown.question?.correct === null
    && shown.question?.options?.[2]?.label === 'Post', JSON.stringify(shown.question));
  up = next(p1, 'projector:state');
  await patch(`/api/session/${code}/projector`, { revealed: true });
  check('and its key once revealed', JSON.stringify((await up).question?.correct) === '["C"]');

  // Diagram: an image of the room's, which the projector loads with no credential.
  const noStimulus = await patch(`/api/session/${code}/projector`, { mode: 'diagram', diagram: { questionId: String(A.first._id) } });
  check('a question with nothing to show is refused as a diagram', noStimulus.status === 400);
  up = next(p1, 'projector:state');
  await patch(`/api/session/${code}/projector`, { mode: 'diagram', diagram: { questionId: String(A.image._id) } });
  shown = await up;
  check('a diagram goes up: the picture and its description, never its citation', shown.diagram?.stimulus?.kind === 'image'
    && shown.diagram?.stimulus?.url === mediaUrl(A.media._id) && shown.question === null && !JSON.stringify(shown).includes('Unit 3'),
  JSON.stringify(shown.diagram));
  const img = await realFetch(base + shown.diagram.stimulus.url);
  check('the projector can load it with no credential while the room runs', img.status === 200 && img.headers.get('content-type') === 'image/png');
  up = next(p1, 'projector:state');
  await patch(`/api/session/${code}/projector`, { diagram: { questionId: String(A.passage._id) } });
  check('a passage goes up as text', (await up).diagram?.stimulus?.text === 'A tree is a connected graph with no cycles.');

  // Class progress: counts that move as the class answers.
  up = next(p1, 'projector:state');
  await patch(`/api/session/${code}/projector`, { mode: 'progress' });
  shown = await up;
  check('class progress is present and answered; one student\'s answers are never shown per level', shown.progress?.present === 3
    && shown.progress?.classSize === 3 && shown.progress?.answered === 1 && shown.progress?.levels === null
    && shown.progress?.minAnswered === 5, JSON.stringify(shown.progress));
  const bilal = await join(code, '21CS02', 'Bilal Khan');
  up = next(p1, 'projector:state');
  await answerRight(bilal.s, bilal.item.payload);
  let moved = await up;
  while (moved.progress?.answered !== 2) moved = await next(p1, 'projector:state');
  check('and moves when a phone answers, still with no count per level under five', moved.progress?.answered === 2
    && moved.progress.levels === null);

  // The wheel's pick.
  up = next(p1, 'projector:state');
  const draw = await post(`/api/session/${code}/wheel/draw`, { presentOnly: false });
  shown = await up;
  const picked = ROSTER.find((s) => s.roll === draw.body.pick?.rollNo);
  check('a draw puts the pick up as a roll number and a first name', draw.status === 201 && shown.pick?.rollNo === picked?.roll
    && shown.pick?.firstName === picked?.name.split(' ')[0], JSON.stringify(shown.pick));
  up = next(p1, 'projector:state');
  await patch(`/api/session/${code}/projector`, { showNames: false });
  check('with names off, the roll number alone', (await up).pick?.firstName === null);
  await patch(`/api/session/${code}/projector`, { showNames: true });
  // Absent on the pick, and an observation of them: neither reaches the wall.
  await patch(`/api/session/${code}/wheel/picks/${draw.body.pick.id}`, { status: 'help' });
  await post(`/api/session/${code}/observations`, { rollNo: picked.roll, kind: 'support', note: 'Struggled with recursion' });

  // HOD: reads the wall, cannot change it.
  const hodChange = await patch(`/api/session/${code}/projector`, { mode: 'question' }, 'hod');
  check('an HOD may not change the wall (403)', hodChange.status === 403);

  // Revocation: one link's projectors go dark, another's keep going.
  const link2 = await post(`/api/session/${code}/projector/links`, {});
  const p2 = await projector('p2');
  await watchWith(p2, link2.body.token);
  const dark = next(p1, 'projector:closed');
  const revoked = await del(`/api/session/${code}/projector/links/${link1.body.link.id}`);
  check('revoking a link tells its projector', revoked.status === 200 && revoked.body.link?.active === false
    && /turned off/.test((await dark.catch(() => ({})))?.reason ?? ''));
  const p1Before = wallEvents.filter((e) => e.label === 'p1').length;
  up = next(p2, 'projector:state');
  await patch(`/api/session/${code}/projector`, { mode: 'question', question: { questionId: String(A.questions[1]._id) } });
  await up;
  await settle();
  check('the other link\'s projector keeps going; the revoked one gets nothing more',
    wallEvents.filter((e) => e.label === 'p1').length === p1Before);
  const again = await watchWith(p1, link1.body.token);
  check('the revoked token is refused, in the words a made-up one gets', again.name === 'projector:refused'
    && again.payload?.reason === bad.payload?.reason);
  const twice = await del(`/api/session/${code}/projector/links/${link1.body.link.id}`);
  check('revoking it again changes nothing', twice.status === 200 && twice.body.link?.revokedAt === revoked.body.link?.revokedAt);

  // Closed: every link stops.
  const closing = next(p2, 'projector:closed');
  mixed.asha.s.disconnect();
  bilal.s.disconnect();
  await post(`/api/session/${code}/close`, {});
  check('closing the room tells its projectors', /closed/.test((await closing.catch(() => ({})))?.reason ?? ''));
  const after = await watchWith(p2, link2.body.token);
  check('and its links are refused from then on', after.name === 'projector:refused' && /closed/.test(after.payload?.reason ?? ''));
  const late = await post(`/api/session/${code}/projector/links`, {});
  const lateChange = await patch(`/api/session/${code}/projector`, { mode: 'progress' });
  check('a closed room takes no new link and no change of screen', late.status === 409 && lateChange.status === 409);
}

{
  // A waiting room's projector shows a diagram the phones have not seen yet.
  const W = await chapter('Heaps');
  const before = await realFetch(base + mediaUrl(W.media._id));
  const r = await open({ contentId: W.content._id, lobby: true });
  const link = await post(`/api/session/${r.body.code}/projector/links`, {});
  const p3 = await projector('p3');
  await watchWith(p3, link.body.token);
  const up = next(p3, 'projector:state');
  await patch(`/api/session/${r.body.code}/projector`, { mode: 'diagram', diagram: { questionId: String(W.image._id) } });
  const shown = await up;
  const img = await realFetch(base + shown.diagram?.stimulus?.url);
  check('in a waiting room, the projector can load its diagram with no credential (and nobody could before the room opened)',
    before.status === 404 && img.status === 200 && shown.status === 'waiting', `${before.status} -> ${img.status}`);
  await post(`/api/session/${r.body.code}/close`, {});
  const gone = await realFetch(base + mediaUrl(W.media._id));
  check('and once it closes, nobody can', gone.status === 404);
}

{
  // Counts per level only once five students have answered: under that, the
  // wall's counts would be one student's own answers.
  const r = await open({});
  const link = await post(`/api/session/${r.body.code}/projector/links`, {});
  const p4 = await projector('p4');
  await watchWith(p4, link.body.token);
  const up = next(p4, 'projector:state');
  await patch(`/api/session/${r.body.code}/projector`, { mode: 'progress' });
  await up;
  const phones = [];
  for (let i = 1; i <= 5; i += 1) {
    const ph = await join(r.body.code, `21CS6${i}`, `Phone ${i}`);
    await answerRight(ph.s, ph.item.payload);
    phones.push(ph);
  }
  await settle(300);
  const states = wallEvents.filter((e) => e.label === 'p4' && e.event === 'projector:state').map((e) => e.payload.progress);
  const four = states.filter((p) => p?.answered === 4);
  const last = states.at(-1);
  check('with four students answered the wall has no count per level; at five it has them', four.length > 0
    && four.every((p) => p.levels === null) && last?.answered === 5 && Array.isArray(last?.levels)
    && last.levels.reduce((n, l) => n + l.answers, 0) === 5, JSON.stringify(states.map((p) => [p?.answered, p?.levels ? 'levels' : null])));
  for (const ph of phones) ph.s.disconnect();
  await post(`/api/session/${r.body.code}/close`, {});
}

{
  // One connection that asks to be a phone and a projector in the same breath
  // is one or the other, never both: the first ask decides, at once.
  const r = await open({});
  const link = await post(`/api/session/${r.body.code}/projector/links`, {});
  const race = async (wallFirst) => {
    const s = await connect();
    const got = [];
    s.onAny((event) => got.push(event));
    const asPhone = () => s.emit('student:join', { code: r.body.code, rollNo: '21CS71', name: 'Racer' });
    const asWall = () => s.emit('projector:watch', { token: link.body.token });
    if (wallFirst) { asWall(); asPhone(); } else { asPhone(); asWall(); }
    await settle(400);
    s.disconnect();
    return got;
  };
  const phoneFirst = await race(false);
  check('a connection that joins as a phone and watches as a projector at once is the phone; the watch is refused',
    phoneFirst.includes('session:accepted') && phoneFirst.includes('projector:refused') && !phoneFirst.includes('projector:state'),
    phoneFirst.join(', '));
  const wallFirst = await race(true);
  check('the other way round it is the projector, and is sent nothing else', wallFirst.includes('projector:state')
    && wallFirst.every((e) => e.startsWith('projector:')), wallFirst.join(', '));
  await post(`/api/session/${r.body.code}/close`, {});
}

{
  // A link works for PROJECTOR_LINK_HOURS from when it was made, so one left on
  // a shared classroom machine does not show the room's wall for days.
  const hours = projectorService.PROJECTOR_LINK_HOURS ?? 12;
  const r = await open({});
  const linkMadeAgo = async (ms) => {
    const token = crypto.randomBytes(32).toString('base64url');
    await repo.addProjectorLink({
      sessionId: r.body.sessionId, tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      createdAt: new Date(Date.now() - ms).toISOString(), createdBy: ID.profA,
    });
    return token;
  };
  const p5 = await projector('p5');
  const old = await watchWith(p5, await linkMadeAgo((hours + 1) * 3600 * 1000));
  check(`a link made more than ${hours} hours ago is refused, in the words a made-up token gets`,
    old.name === 'projector:refused' && old.payload?.reason === madeUpRefusal, JSON.stringify(old));
  const p6 = await projector('p6');
  const ending = await watchWith(p6, await linkMadeAgo(hours * 3600 * 1000 - 1500));
  check('one inside its lifetime connects', ending.name === 'projector:state');
  await settle(1800);
  const told = next(p6, 'projector:closed');
  await patch(`/api/session/${r.body.code}/projector`, { mode: 'progress' });
  check('one that runs out while its projector watches: that projector is told at the next change, and dropped',
    /no longer works/.test((await told.catch(() => ({})))?.reason ?? ''));
  const listed = await get(`/api/session/${r.body.code}/projector`);
  check('the professor sees each link\'s expiry, and the ended ones as not active', listed.body.links?.length === 2
    && listed.body.links.every((l) => l.active === false && typeof l.expiresAt === 'string') && listed.body.watching === 0,
  JSON.stringify(listed.body.links));
  await post(`/api/session/${r.body.code}/close`, {});
}

// ------------------------------------------------------ the whitelist walk --

console.log('\nevery event any projector received, against the whitelist');
{
  // Kept here, apart from services/projector.js, so a field added there has to
  // be added here on purpose too. roomMode (19 Nov 2026): how the room runs, so
  // the wall can hide the join code in a Teacher-led room.
  const ALLOWED = {
    'projector:state': ['code', 'title', 'status', 'mode', 'roomMode', 'question', 'diagram', 'progress', 'pick'],
    'projector:state.question': ['source', 'text', 'kind', 'options', 'stimulus', 'revealed', 'correct'],
    'projector:state.question.options[]': ['key', 'label'],
    'projector:state.question.stimulus': ['kind', 'url', 'alt', 'text'],
    'projector:state.question.correct[]': [],
    'projector:state.diagram': ['stimulus'],
    'projector:state.diagram.stimulus': ['kind', 'url', 'alt', 'text'],
    'projector:state.progress': ['present', 'classSize', 'answered', 'levels', 'minAnswered'],
    'projector:state.progress.levels[]': ['level', 'label', 'answers'],
    'projector:state.pick': ['rollNo', 'firstName'],
    'projector:closed': ['code', 'reason'],
    'projector:refused': ['reason'],
  };
  const problems = [];
  const walk = (value, path, where) => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
    if (Array.isArray(value)) { value.forEach((v) => walk(v, `${path}[]`, where)); return; }
    const allowed = ALLOWED[path];
    if (!allowed) { problems.push(`${where}: an object at ${path}`); return; }
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) problems.push(`${where}: ${path}.${key} is not on the whitelist`);
      else walk(value[key], `${path}.${key}`, where);
    }
  };
  const OBSERVATION_WORDS = /Understood|Participated|Needs revision|Needs additional support|Struggled|Mixed up|\b(revision|support|participated)\b/;
  const SCORE_WORDS = /accuracy|score|band|slowLearner|mastered|workingLevel|rosterName|answerIdx|answerBool|rubric|solution/i;
  const modes = new Set();
  wallEvents.forEach((e, i) => {
    const where = `#${i} ${e.label} ${e.event}`;
    if (!e.event.startsWith('projector:')) { problems.push(`${where}: not a projector event`); return; }
    walk(e.payload, e.event, where);
    const text = JSON.stringify(e.payload ?? {});
    for (const last of LAST) if (text.includes(last)) problems.push(`${where}: carries a surname (${last})`);
    // A first name only as the pick's, and only the student picked.
    const pick = e.payload?.pick;
    const rest = pick ? JSON.stringify({ ...e.payload, pick: { ...pick, firstName: null } }) : text;
    for (const first of FIRST) if (rest.includes(first)) problems.push(`${where}: names ${first} outside the pick`);
    if (pick?.firstName && ROSTER.find((s) => s.roll === pick.rollNo)?.name.split(' ')[0] !== pick.firstName) {
      problems.push(`${where}: the pick's first name is not the picked student's`);
    }
    if (OBSERVATION_WORDS.test(text)) problems.push(`${where}: carries an observation`);
    if (SCORE_WORDS.test(text)) problems.push(`${where}: carries a score, band or key word`);
    const q = e.payload?.question;
    if (q && q.revealed !== true && q.correct !== null) problems.push(`${where}: a key before the reveal`);
    if (e.event === 'projector:state') modes.add(e.payload?.mode);
    if (e.payload?.pick) modes.add('pick');
    if (e.event !== 'projector:state') modes.add(e.event);
  });
  check(`the walk covered the three screens, a pick, a refusal and a close (${wallEvents.length} events)`,
    ['question', 'diagram', 'progress', 'pick', 'projector:refused', 'projector:closed'].every((m) => modes.has(m)),
    [...modes].join(', '));
  check('no key off the whitelist, no surname, no other name, no observation, no score, no key before the reveal',
    problems.length === 0, problems.slice(0, 8).join('\n        '));
  check('no phone ever received a projector event or a teacher record',
    phoneEvents.every((e) => !e.event.startsWith('projector:') && !e.event.startsWith('teacher:'))
    && !JSON.stringify(phoneEvents).includes('Teacher records'));
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
for (const s of sockets) s.disconnect();
globalThis.fetch = realFetch;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
