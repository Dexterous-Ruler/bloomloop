// Phase 6: Get Ready, refresher paths, self-tests, goals and the hub home, end
// to end (decisions H9, H10, H16, H17).
//
//   node server/scripts/paths.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, against a clock this script sets, and
// checks:
//
//   accounts only     no token is a 401, the teacher key reaches nothing, staff
//                     on a student's route and a student on staff's are 403
//                     before anything is read, no Supabase is a 503
//   Get Ready         a check on a target asks its prerequisites nearest first,
//                     stops early by the rule, ends each one Ready, Needs review
//                     or Not sure yet with its counts, keeps every answer (mode
//                     getready, its check's id), shows feedback after each, and
//                     ends with a refresher path in dependency order that
//                     practice then moves along
//   self-tests        the list is fixed at the start; no mark, key or
//                     explanation anywhere (its replies, its view, the error
//                     log, the estimates) until it is handed in; then the
//                     feedback and a summary by topic and level; a time-out
//                     hands in what was answered and a late answer is kept but
//                     not counted; while it is open, practice opens no hint on
//                     its questions (the tutor), and its result carries the
//                     feedback on the option chosen
//   goals and home    a goal's progress; the home's mastery map by unit and
//                     topic, reviews, goals, paths and weeks, the sentence that
//                     the professor can see it, and never a rank, average or
//                     streak
//   staff             students per topic state in roll order; one student's Get
//                     Ready results; the HOD reads; another professor gets 404
//   who is refused    another student, another professor's student, another
//                     professor: the same 404, word for word
//   nothing else moves  the room's answers and profiles, attainment, the
//                     student report and the register are byte-identical
//                     before and after
//   boot probe        a database without 0028 keeps Supabase, and the log names
//                     the file and what fails until it is applied
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As
// server/scripts/roster.mjs, decisions.mjs, hub.mjs and practice.mjs do, the
// server is pointed at http://supabase.invalid and every request to it is
// answered here, in-process; any other request off this machine is refused and
// counted. Never calls Gemini, Supabase or any network service. Exits non-zero
// on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

// ----------------------------------------------------------- the clock --
//
// Every `new Date()` and Date.now() in this process reads this clock, so the
// server's time is the script's to set: a self-test's time runs out when it
// moves on, and nothing waits on a real minute.
const RealDate = Date;
let clockMs = RealDate.parse('2026-11-19T04:30:00.000Z'); // 10:00 in India, a Thursday
class ClockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(clockMs);
  }

  static now() { return clockMs; }
}
globalThis.Date = ClockDate;
const tick = (ms = 30000) => { clockMs += ms; };

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { MAX_CHECK_QUESTIONS } = await import(`${SRC}services/hubGetReady.js`);
const { EXAM_GRACE_SECONDS } = await import(`${SRC}services/hubHeld.js`);

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
// HOD (CSE) <- professor A <- Asha (21CS01) and Bilal (21CS02), on the roster;
// Dev (21CS04) is on the roster with no account. Another HOD (ECE) <-
// professor B <- Omar, who also holds roll number 21CS01, on B's roster.

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'f2000000-0000-4000-8000-000000000001',
  profA: 'f2000000-0000-4000-8000-000000000002',
  profB: 'f2000000-0000-4000-8000-000000000003',
  hodOther: 'f2000000-0000-4000-8000-000000000004',
  asha: 'f2000000-0000-4000-8000-000000000005',
  bilal: 'f2000000-0000-4000-8000-000000000006',
  omar: 'f2000000-0000-4000-8000-000000000008',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-PTH0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T04:00:00+00:00', updated_at: '2026-11-19T04:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.asha, 'student', 'CSE', ID.profA, '21cs01'),
  account(ID.bilal, 'student', 'CSE', ID.profA, '21CS02'),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
  account(ID.omar, 'student', 'ECE', ID.profB, '21CS01'),
].map((a) => [a.id, a]));
const TOKENS = Object.fromEntries(Object.keys(ID).map((who) => [who, `tok-${who}`]));
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

// Set at the end, for the boot probe: PostgREST's answers about the schema, with
// these pieces ("table" or "table.column") missing.
let schemaMissing = null;
let refusedOffMachine = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  if (url.origin !== FAKE_ORIGIN) {
    refusedOffMachine += 1;
    throw new Error(`paths.mjs refuses to reach ${url.origin}`);
  }
  if (schemaMissing) {
    const table = url.pathname.replace('/rest/v1/', '');
    const cols = (url.searchParams.get('select') ?? '*').split(',').map((c) => c.trim());
    if (schemaMissing.includes(table)) return reply({ code: 'PGRST205', message: `Could not find the table 'public.${table}'` }, 404);
    const gone = cols.find((c) => schemaMissing.includes(`${table}.${c}`));
    if (gone) return reply({ code: '42703', message: `column ${table}.${gone} does not exist` }, 400);
    return reply([]);
  }
  if (url.pathname === '/auth/v1/user') {
    const token = (new Headers(init.headers).get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const id = BY_TOKEN.get(token);
    return id ? reply({ id, aud: 'authenticated' }) : reply({ code: 401, msg: 'invalid JWT' }, 401);
  }
  if (url.pathname === '/rest/v1/accounts') {
    // getAccount, and the supports read at a signed-in join (getAccommodations: none here).
    const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
    return reply(ACCOUNTS.has(id) ? [ACCOUNTS.get(id)] : []);
  }
  if (url.pathname === '/rest/v1/rpc/accounts_below') {
    return reply(below(JSON.parse(init.body ?? '{}').root));
  }
  refusedOffMachine += 1;
  return reply({ message: `not answered by paths.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'paths-test-service-key';

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

/** `as`: one of the TOKENS' names, 'key' for the shared teacher key, or null for no credentials. */
async function call(method, path, { body, as = 'profA' } = {}) {
  const headers = {};
  if (as === 'key') headers['x-teacher-key'] = config.teacherKey;
  else if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  return { status: res.status, body: parsed, text };
}
const get = (path, as) => call('GET', path, { as });
// Batch 8: practice and lesson answers carry the serve token the hub's reply gave
// (services/serveTokens.js). This script tests other things, so it signs the
// token the server would have sent; server/scripts/zipgaps2.mjs tests the token itself.
const { serveToken: signServed } = await import(`${SRC}services/serveTokens.js`);
const served = (path, body, as) => {
  if (!body || typeof body !== 'object' || body.serveToken !== undefined || !ID[as]) return body;
  const lesson = /^\/api\/hub\/lessons\/[^/]+\/questions\/([^/]+)\/attempts$/.exec(path);
  if (lesson) return { ...body, serveToken: signServed({ accountId: ID[as], questionId: lesson[1], mode: 'lesson' }) };
  if (path === '/api/hub/practice/attempts' && body.questionId) {
    return { ...body, serveToken: signServed({ accountId: ID[as], questionId: body.questionId, mode: body.mode ?? 'practice' }) };
  }
  return body;
};
const post = (path, body, as) => call('POST', path, { body: served(path, body, as), as });
const put = (path, body, as) => call('PUT', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });
const del = (path, as) => call('DELETE', path, { as });
const keysOf = (o) => JSON.stringify(Object.keys(o ?? {}).sort());

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function next(socket, events, ms = 4000) {
  const list = Array.isArray(events) ? events : [events];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${list.join('/')}`)), ms);
    for (const e of list) socket.once(e, (p) => { clearTimeout(timer); resolve({ event: e, payload: p }); });
  });
}

// What a student may never be sent before an attempt (or, in a self-test, before it ends).
const KEYS = /answerIdx|answerIdxs|answerBool|"accept"|rubric|"sequence"|"pairs"|"buckets"|"value"|"explanation"|"solution"|misconception|"correct"|"score"/;
// What a student's hub never says.
const NEVER = /\brank|average|streak|leaderboard|\bcoins?\b|slow learner|Needs support|Excelling|Developing/i;

// ------------------------------------------------------------- the material --

console.log('\nsetting up: a chapter with five topics, a class, a room, and prerequisite links');

const TOPICS = ['Sets', 'Logic', 'Relations', 'Functions', 'Graphs'];
const made = await post('/api/content', { title: 'Discrete structures', text: TOPICS.join('\n') });
const contentId = made.body.contentId;
await patch(`/api/content/${contentId}`, { topics: TOPICS });
const T = Object.fromEntries((await repo.listChapterTopics(contentId)).map((t) => [t.name, String(t._id)]));
const LEVELS4 = ['remember', 'understand', 'apply', 'analyse'];
const inserted = await repo.insertQuestions(TOPICS.flatMap((topic) => LEVELS4.map((bloom, i) => ({
  contentId, topic, text: `${topic} ${bloom} ${i}: which holds for $x^2$?`, kind: 'mcq', options: ['right', 'wrong a', 'wrong b', 'wrong c'],
  answerIdx: 0, bloom, source: 'teacher', status: 'active',
}))));
const Q = Object.fromEntries(TOPICS.map((n) => [n, inserted.filter((q) => q.topic === n).map((q) => String(q._id))]));
const keyOf = async (questionId) => (await repo.getQuestion(questionId)).answerIdx;
await put(`/api/hub/questions/${Q.Sets[0]}/explanation`, { text: 'The slide on sets says so: $A \\cup B$ holds both.' });

const classId = (await post('/api/classes', { courseName: 'Discrete Maths', section: 'SY A' })).body.class.id;
await post(`/api/classes/${classId}/students`, { students: [{ roll: '21CS01', name: 'Asha' }, { roll: '21CS02', name: 'Bilal' }, { roll: '21CS04', name: 'Dev' }] });
const unit = await post(`/api/hub/classes/${classId}/units`, { name: 'Unit 1: Foundations' });
check('the chapter is placed on the class, in a unit', (await put(`/api/hub/classes/${classId}/chapters/${contentId}`, { unitId: unit.body.unit?.id ?? null })).status === 201,
  JSON.stringify(unit.body).slice(0, 200));
const theirClass = (await post('/api/classes', { courseName: 'Signals', section: 'EC A' }, 'profB')).body.class.id;
await post(`/api/classes/${theirClass}/students`, { students: [{ roll: '21CS01', name: 'Omar' }] }, 'profB');
const link = async (p, t) => (await post('/api/hub/links', { prerequisiteId: T[p], topicId: T[t] })).status === 201;
check('confirmed links: Logic and Relations before Functions, Sets before Relations',
  (await link('Logic', 'Functions')) && (await link('Relations', 'Functions')) && (await link('Sets', 'Relations')));

// A room for the class before any of this (on Graphs and Sets): Asha joins
// signed in and answers once, so the room has evidence the hub must leave alone.
const room = await post('/api/session', { contentId, classId, questionIds: [...Q.Graphs, ...Q.Sets.slice(0, 2)] });
check('a room opens for the class', room.status === 201 || room.status === 200, JSON.stringify(room.body).slice(0, 200));
{
  const phone = await connect();
  const first = next(phone, ['server:question', 'server:exhausted']);
  phone.emit('student:join', { code: room.body.code, rollNo: '21CS01', name: 'Asha', token: TOKENS.asha });
  const q = (await first).payload.question;
  const result = next(phone, 'server:result');
  phone.emit('student:answer', { questionId: q._id, response: await keyOf(q._id), answerId: 'room-asha-p001' });
  await result;
  phone.disconnect();
  await new Promise((r) => setTimeout(r, 200));
}
tick();

const roster = await repo.listClassStudents(classId);
const ashaRow = roster.find((s) => s.rollNo === '21CS01');
const devRow = roster.find((s) => s.rollNo === '21CS04');
const untouched = async () => JSON.stringify({
  answers: await repo.listAnswers({ sessionId: room.body.sessionId }),
  profiles: await repo.listProfiles(room.body.sessionId),
  attendance: await repo.listAttendance(room.body.sessionId),
  attainment: (await get(`/api/classes/${classId}/attainment`)).text,
  student: (await get(`/api/classes/${classId}/attainment/students/${ashaRow._id}`)).text,
  register: (await get(`/api/classes/${classId}/register`)).text,
});
const before = await untouched();
check('attainment, the student report and the register read before (200s)', JSON.parse(before).register.startsWith('{'));

// ---------------------------------------------------------- accounts only --

console.log('\naccounts only, and who reaches which side (H1, H17)');
{
  const noToken = await Promise.all(['/api/hub/home', '/api/hub/getready', '/api/hub/exams', '/api/hub/goals'].map((p) => get(p, null)));
  check('no credentials: 401 on every student route', noToken.every((r) => r.status === 401), noToken.map((r) => r.status).join(','));
  check('the shared teacher key reaches nothing here: 401', (await get('/api/hub/home', 'key')).status === 401
    && (await get(`/api/hub/classes/${classId}/states`, 'key')).status === 401);
  const staffOnStudent = [await get('/api/hub/home', 'profA'), await post('/api/hub/getready', { clientRunId: 'staff-check-1', targetTopicId: T.Functions }, 'profA'),
    await post('/api/hub/exams', { clientRunId: 'staff-exam-01', topicIds: [T.Sets] }, 'hod'), await get('/api/hub/goals', 'hod')];
  check('staff on a student\'s own route: 403, saying it is for a student account',
    staffOnStudent.every((r) => r.status === 403 && /student account/.test(r.body.error)), staffOnStudent.map((r) => r.status).join(','));
  const studentOnStaff = [await get(`/api/hub/classes/${classId}/states`, 'asha'), await get(`/api/hub/classes/${classId}/students/${ashaRow._id}/getready`, 'asha')];
  check('a student on a staff route: 403 before anything is read', studentOnStaff.every((r) => r.status === 403), studentOnStaff.map((r) => r.status).join(','));
}

// -------------------------------------------------------------- Get Ready --

console.log('\nGet Ready: nearest first, stopping early, each prerequisite with its counts (H9)');
let checkId = null;
{
  const started = await post('/api/hub/getready', { clientRunId: 'asha-check-0001', targetTopicId: T.Functions }, 'asha');
  checkId = started.body.check?.id;
  check('Asha starts a check on Functions: 201, open, its rule said', started.status === 201 && started.body.check.status === 'open'
    && started.body.check.maxQuestions === MAX_CHECK_QUESTIONS && /two right/i.test(started.body.check.rule), JSON.stringify(started.body).slice(0, 300));
  check('its prerequisites, nearest first: Logic and Relations, then Sets',
    JSON.stringify(started.body.prerequisites.map((p) => [p.topic.name, p.depth, p.status])) === JSON.stringify([['Logic', 1, 'asking'], ['Relations', 1, 'waiting'], ['Sets', 2, 'waiting']]),
    JSON.stringify(started.body.prerequisites.map((p) => [p.topic.name, p.depth, p.status])));
  check('the question: on Logic, with no key or mark, and no hints', started.body.question?.topic?.name === 'Logic'
    && !KEYS.test(JSON.stringify(started.body.question)) && started.body.question.hints.available === 0 && /<math>/.test(started.body.question.question.rich?.text ?? ''),
  JSON.stringify(started.body.question).slice(0, 300));
  const again = await post('/api/hub/getready', { clientRunId: 'asha-check-0001', targetTopicId: T.Sets }, 'asha');
  check('the same start resent: 200, the same check', again.status === 200 && again.body.check.id === checkId && again.body.duplicate === true);

  // Logic: right, right (Ready). Relations: wrong, wrong (Needs review). Sets: right, wrong, wrong (Needs review, 1 of 3).
  const plan = [true, true, false, false, true, false, false];
  let last = started.body;
  const replies = [];
  for (const [i, right] of plan.entries()) {
    tick(20000);
    const q = last.question.question;
    const key = await keyOf(q._id);
    const sent = await post(`/api/hub/getready/${checkId}/answers`, {
      attemptId: `asha-ready-${String(i).padStart(4, '0')}`, questionId: q._id, response: right ? key : (key + 1) % 4, timeTakenMs: 4000,
    }, 'asha');
    replies.push(sent);
    last = sent.body.check;
  }
  check('every answer: 201, marked on the server, the right answer and the check after it',
    replies.every((r, i) => r.status === 201 && r.body.correct === plan[i] && r.body.solution === 0 && r.body.check), replies.map((r) => r.status).join(','));
  const done = replies[replies.length - 1].body.check;
  check('it stops early: 7 questions of at most 12, complete',
    done.check.status === 'complete' && done.check.asked === 7 && done.question === null && done.check.endedAt, JSON.stringify(done.check));
  check('each prerequisite ends with its counts: Logic Ready 2 of 2, Relations Needs review 0 of 2, Sets Needs review 1 of 3',
    JSON.stringify(done.prerequisites.map((p) => [p.topic.name, p.label, p.right, p.answers])) === JSON.stringify([
      ['Logic', 'Ready', 2, 2], ['Relations', 'Needs review', 0, 2], ['Sets', 'Needs review', 1, 3]])
    && done.prerequisites[2].sentence === 'Needs review: you got 1 of 3 right.', JSON.stringify(done.prerequisites.map((p) => p.sentence)));
  check('the refresher path: Sets, then Relations (which needs it), ending at Functions',
    JSON.stringify(done.path.steps.map((s) => s.topic.name)) === '["Sets","Relations"]' && done.path.target.topic.name === 'Functions'
    && done.path.next === T.Sets, JSON.stringify(done.path).slice(0, 400));
  check('each step says why, in her own counts', /you got 1 of 3 right on it in the Get Ready check\. It comes before "Relations", on the way to "Functions"\./.test(done.path.steps[0].why)
    && /you got 0 of 2 right on it.*"Functions" builds on it directly/.test(done.path.steps[1].why), done.path.steps.map((s) => s.why).join(' | '));
  const rows = await repo.listHubAttempts({ accountId: ID.asha });
  check('every answer kept once, mode getready, filed under the check, no hints', rows.length === 7
    && rows.every((a) => a.mode === 'getready' && a.runId === checkId && a.hintsUsed === 0 && a.timeTakenMs === 4000));
  const resend = await post(`/api/hub/getready/${checkId}/answers`, { attemptId: 'asha-ready-0000', questionId: 'resent', response: 3 }, 'asha');
  check('an answer id resent: 200, the stored result, no second row', resend.status === 200 && resend.body.duplicate === true && resend.body.correct === true
    && (await repo.listHubAttempts({ accountId: ID.asha })).length === 7, JSON.stringify(resend.body).slice(0, 200));
  const closed = await post(`/api/hub/getready/${checkId}/answers`, { attemptId: 'asha-ready-0099', questionId: Q.Sets[3], response: 0 }, 'asha');
  check('a complete check takes no more answers: 409', closed.status === 409, `${closed.status} ${closed.text}`);
  const listed = await get('/api/hub/getready', 'asha');
  check('her checks list it, complete, with its counts', listed.status === 200 && listed.body.checks[0]?.id === checkId
    && JSON.stringify(listed.body.checks[0].counts) === JSON.stringify({ ready: 1, 'needs-review': 2, 'not-sure': 0 }));
}

console.log('\nthe refresher path moves with practice (H9)');
{
  for (let i = 0; i < 2; i += 1) {
    tick(60000);
    const served = await get(`/api/hub/practice/next?topicId=${T.Sets}`, 'asha');
    await post('/api/hub/practice/attempts', { attemptId: `asha-sets-pr-${i}`, questionId: served.body.question._id, topicId: T.Sets,
      response: await keyOf(served.body.question._id) }, 'asha');
  }
  const view = await get(`/api/hub/getready/${checkId}`, 'asha');
  const [sets, relations] = view.body.path?.steps ?? [];
  check('two right in practice since the check: the Sets step is done, Relations is next', sets?.status === 'done' && sets.answers === 2
    && relations?.status === 'to-do' && view.body.path.next === T.Relations, JSON.stringify(view.body.path?.steps));
}

console.log('\nGet Ready: who is refused (H1)');
{
  const NO_CHECK = JSON.stringify({ error: 'That Get Ready check was not found.' });
  const refusals = {
    'Bilal reading Asha\'s check': await get(`/api/hub/getready/${checkId}`, 'bilal'),
    'Bilal answering in it': await post(`/api/hub/getready/${checkId}/answers`, { attemptId: 'bilal-in-ash-1', questionId: Q.Sets[0], response: 0 }, 'bilal'),
    'another professor\'s student with the same roll number': await get(`/api/hub/getready/${checkId}`, 'omar'),
    'a check that does not exist': await get('/api/hub/getready/0123456789abcdef01234567', 'asha'),
  };
  for (const [who, r] of Object.entries(refusals)) check(`${who}: 404, word for word`, r.status === 404 && JSON.stringify(r.body) === NO_CHECK, `${r.status} ${r.text}`);
  const omar = await post('/api/hub/getready', { clientRunId: 'omar-check-01', targetTopicId: T.Functions }, 'omar');
  check('Omar starting a check on professor A\'s topic: the topic\'s 404', omar.status === 404 && omar.body.error === 'That topic was not found.');
  check('a start with no usable id: 400', (await post('/api/hub/getready', { clientRunId: 'x', targetTopicId: T.Functions }, 'asha')).status === 400);
}

// ------------------------------------------------------------- self-tests --

console.log('\nself-tests: the list fixed at the start, nothing shown until it is handed in (H10)');
let examId = null;
{
  const errorsBefore = (await get('/api/hub/errors', 'bilal')).body.entries.length;
  const stateBefore = JSON.stringify((await get('/api/hub/progress', 'bilal')).body.topics.map((t) => [t.id, t.state.state, t.state.answers]));
  tick();
  const started = await post('/api/hub/exams', { clientRunId: 'bilal-exam-0001', topicIds: [T.Sets, T.Logic], levels: ['remember', 'understand'], count: 4 }, 'bilal');
  examId = started.body.exam?.id;
  check('Bilal starts a self-test: 201, four questions, Remember and Understand only, mixed over both topics', started.status === 201
    && started.body.questions.length === 4 && started.body.questions.every((q) => ['remember', 'understand'].includes(q.question.bloom))
    && new Set(started.body.questions.map((q) => q.topic.id)).size === 2, JSON.stringify(started.body).slice(0, 300));
  check('open: no key, no mark, no explanation anywhere, and no hints', !KEYS.test(started.text) && started.body.hints.available === 0
    && started.body.exam.status === 'open', started.text.match(KEYS)?.[0]);
  const run = await repo.getHubRun(examId);
  check('the list is kept on the self-test when it starts', run.spec.questions.length === 4
    && JSON.stringify(run.spec.questions.map((x) => x.questionId)) === JSON.stringify(started.body.questions.map((q) => q.questionId)));
  const again = await post('/api/hub/exams', { clientRunId: 'bilal-exam-0001', topicIds: [T.Graphs] }, 'bilal');
  check('the same start resent: 200, the same self-test and list', again.status === 200 && again.body.exam.id === examId);

  const [q1, q2] = started.body.questions;
  const key1 = await keyOf(q1.questionId);
  tick();
  const wrong = await post(`/api/hub/exams/${examId}/answers`, { attemptId: 'bilal-exam-a001', questionId: q1.questionId, response: (key1 + 1) % 4 }, 'bilal');
  check('an answer: 201 "saved" and nothing else (no right or wrong, no score, no answer)', wrong.status === 201
    && keysOf(wrong.body) === '["answered","attempt","duplicate","late","saved","status","total"]' && !KEYS.test(wrong.text)
    && wrong.body.answered === 1 && wrong.body.total === 4, wrong.text);
  check('the error log shows nothing yet', (await get('/api/hub/errors', 'bilal')).body.entries.length === errorsBefore);
  check('nor do the estimates', JSON.stringify((await get('/api/hub/progress', 'bilal')).body.topics.map((t) => [t.id, t.state.state, t.state.answers])) === stateBefore);
  const during = await get(`/api/hub/exams/${examId}`, 'bilal');
  check('the open self-test gives back his answer (for a reload) and still no mark', during.status === 200 && !KEYS.test(during.text)
    && during.body.questions.find((q) => q.questionId === q1.questionId).answered === true, during.text.match(KEYS)?.[0]);
  // Where the tutor meets the self-test (H10 with H13): practice is no way round "no hints".
  const hintWhileOpen = await post('/api/hub/practice/hints', { attemptId: 'bilal-hint-0001', questionId: q2.questionId, topicId: q2.topic.id, mode: 'practice' }, 'bilal');
  check('a hint in practice on a question of his open self-test: 409, and why', hintWhileOpen.status === 409
    && /self-test you have not handed in/.test(hintWhileOpen.body.error) && !KEYS.test(hintWhileOpen.text), hintWhileOpen.text);
  const viaPractice =await post('/api/hub/practice/attempts', { attemptId: 'bilal-exam-a001', questionId: q1.questionId, topicId: q1.topic.id, response: 0 }, 'bilal');
  check('its attempt id resent to practice: 409, no mark in the reply', viaPractice.status === 409 && !/"correct"|solution/.test(viaPractice.text), viaPractice.text);
  const notListed = await post(`/api/hub/exams/${examId}/answers`, { attemptId: 'bilal-exam-a009', questionId: Q.Graphs[0], response: 0 }, 'bilal');
  check('a question not on the list: the question\'s 404', notListed.status === 404 && notListed.body.error === 'That question was not found.');

  tick();
  await post(`/api/hub/exams/${examId}/answers`, { attemptId: 'bilal-exam-a002', questionId: q1.questionId, response: key1 }, 'bilal');
  tick();
  const key2 = await keyOf(q2.questionId);
  await post(`/api/hub/exams/${examId}/answers`, { attemptId: 'bilal-exam-a003', questionId: q2.questionId, response: (key2 + 2) % 4 }, 'bilal');
  tick();
  const result = await post(`/api/hub/exams/${examId}/submit`, {}, 'bilal');
  const r1 = result.body.questions?.find((q) => q.questionId === q1.questionId);
  const r2 = result.body.questions?.find((q) => q.questionId === q2.questionId);
  const blank = result.body.questions?.filter((q) => !q.answered) ?? [];
  check('handed in: per question, right or wrong from the answer it ended with, the right answer and the mark\'s label',
    result.status === 200 && result.body.exam.endReason === 'submitted' && r1?.correct === true && r1.response === key1 && r1.solution === key1
    && r2?.correct === false && r2.solution === key2 && /computer/.test(r1.markLabel), JSON.stringify(result.body).slice(0, 400));
  check('an unanswered question is labelled not marked, and keeps its key and explanation', blank.length === 2
    && blank.every((q) => q.mark === 'unmarked' && q.solution === null && q.explanation === null && /Not answered/.test(q.markLabel)));
  check('each question carries the professor\'s feedback on the option chosen (none is approved here)',
    [r1, r2, ...blank].every((q) => Array.isArray(q?.optionFeedback) && q.optionFeedback.length === 0));
  const hintAfter = await post('/api/hub/practice/hints', { attemptId: 'bilal-hint-0002', questionId: q2.questionId, topicId: q2.topic.id, mode: 'practice' }, 'bilal');
  check('handed in, that question\'s hints are open in practice again (it has none approved, and says so)',
    hintAfter.status === 200 && hintAfter.body.hint === null && typeof hintAfter.body.message === 'string', hintAfter.text);
  check('the summary: overall, by topic and by level, with the counts', result.body.summary.overall.questions === 4
    && result.body.summary.overall.answered === 2 && result.body.summary.overall.right === 1
    && result.body.summary.byTopic.length === 2 && result.body.summary.byLevel.every((l) => ['remember', 'understand'].includes(l.level))
    && /1 of 4 questions right; 2 not answered\./.test(result.body.summary.overall.sentence), JSON.stringify(result.body.summary.overall));
  check('and says it counts nowhere official', /no class mark, attainment figure or register/.test(result.body.note));
  const log = (await get('/api/hub/errors', 'bilal')).body.entries;
  check('now the error log has the wrong final answer, and not the one he changed', log.length === errorsBefore + 1
    && log.some((e) => e.question.text === r2.question.text), JSON.stringify(log.map((e) => e.question.text)));
  check('and the estimates count his two final answers', (await get('/api/hub/progress', 'bilal')).body.topics
    .reduce((n, t) => n + t.state.answers, 0) === 2);
  check('handing in again changes nothing', (await post(`/api/hub/exams/${examId}/submit`, {}, 'bilal')).body.exam.endedAt === result.body.exam.endedAt);
  check('every answer kept, the changed one too', (await repo.listHubAttempts({ runIds: [examId] })).length === 3);
}

console.log('\na time limit: time-out hands in what was answered; a late answer is kept, not counted (H10)');
{
  tick();
  const started = await post('/api/hub/exams', { clientRunId: 'bilal-exam-0002', topicIds: [T.Graphs], count: 3, timeLimitMinutes: 5 }, 'bilal');
  const id = started.body.exam.id;
  check('a timed self-test: its deadline five minutes on, seconds left counting', started.status === 201 && started.body.exam.timeLimitMinutes === 5
    && started.body.exam.secondsLeft === 300, JSON.stringify(started.body.exam));
  const [a, b] = started.body.questions;
  tick(60000);
  await post(`/api/hub/exams/${id}/answers`, { attemptId: 'bilal-timed-0001', questionId: a.questionId, response: await keyOf(a.questionId) }, 'bilal');
  tick(5 * 60000); // six minutes in: past the limit and its grace
  const late = await post(`/api/hub/exams/${id}/answers`, { attemptId: 'bilal-timed-0002', questionId: b.questionId, response: await keyOf(b.questionId) }, 'bilal');
  check('an answer after the time ran out: kept (201), marked late, the self-test ended', late.status === 201 && late.body.late === true
    && late.body.status === 'ended' && /kept but not counted/.test(late.body.message), late.text);
  const result = await get(`/api/hub/exams/${id}`, 'bilal');
  const deadline = Date.parse(started.body.exam.deadlineAt);
  check('it timed out, ending at the limit plus the grace, with what was answered in time', result.body.exam.endReason === 'timed-out'
    && Date.parse(result.body.exam.endedAt) === deadline + EXAM_GRACE_SECONDS * 1000
    && result.body.summary.overall.answered === 1 && result.body.summary.overall.right === 1 && /1 answer reached the server after the end/.test(result.body.lateNote),
  JSON.stringify(result.body.exam));
  check('the late answer is stored', (await repo.listHubAttempts({ runIds: [id] })).length === 2);
  const list = await get('/api/hub/exams', 'bilal');
  check('his self-tests, newest first, right counts only once ended', list.status === 200 && list.body.exams[0].id === id
    && list.body.exams[0].right === 1 && list.body.exams[1].id === examId);
}

console.log('\nself-tests: who is refused, and what is refused (H1, H10)');
{
  const NO_EXAM = JSON.stringify({ error: 'That self-test was not found.' });
  const refusals = {
    'Asha reading Bilal\'s self-test': await get(`/api/hub/exams/${examId}`, 'asha'),
    'Asha handing it in': await post(`/api/hub/exams/${examId}/submit`, {}, 'asha'),
    'Omar answering in it': await post(`/api/hub/exams/${examId}/answers`, { attemptId: 'omar-exam-a01', questionId: Q.Sets[0], response: 0 }, 'omar'),
    'a Get Ready check asked for as a self-test': await get(`/api/hub/exams/${checkId}`, 'asha'),
  };
  for (const [who, r] of Object.entries(refusals)) check(`${who}: 404, word for word`, r.status === 404 && JSON.stringify(r.body) === NO_EXAM, `${r.status} ${r.text}`);
  check('a self-test of more than 30 questions: 400', (await post('/api/hub/exams', { clientRunId: 'asha-exam-big1', topicIds: [T.Sets], count: 31 }, 'asha')).status === 400);
  const none = await post('/api/hub/exams', { clientRunId: 'asha-exam-cre1', topicIds: [T.Sets], levels: ['create'] }, 'asha');
  check('no approved question at the levels chosen: 400, saying so', none.status === 400 && /None of your professor's approved questions/.test(none.body.error));
  check('Omar on professor A\'s topics: the topic\'s 404', (await post('/api/hub/exams', { clientRunId: 'omar-exam-001', topicIds: [T.Sets] }, 'omar')).status === 404);
}

// ---------------------------------------------------------- goals and home --

console.log('\ngoals and the hub home: own progress only (H16, H17)');
{
  const made = await post('/api/hub/goals', { title: 'Mid-semester test', examDate: '2026-12-10', topicIds: [T.Sets, T.Relations, T.Functions] }, 'asha');
  check('Asha sets a goal: 201, with its progress over its topics, each with N, and the days left', made.status === 201
    && made.body.goal.daysLeft === 21 && made.body.goal.topics.length === 3 && made.body.goal.topics.every((t) => Number.isInteger(t.state.answers))
    && /of 3 topics mastered/.test(made.body.goal.sentence) && /21 days to go\./.test(made.body.goal.sentence), JSON.stringify(made.body).slice(0, 300));
  const goalId = made.body.goal.id;
  check('a date in the past: 400', (await post('/api/hub/goals', { examDate: '2026-11-18', topicIds: [T.Sets] }, 'asha')).status === 400);
  check('Omar naming professor A\'s topic: the topic\'s 404', (await post('/api/hub/goals', { examDate: '2026-12-01', topicIds: [T.Sets] }, 'omar')).status === 404);
  const changed = await patch(`/api/hub/goals/${goalId}`, { title: 'Mid-sem', topicIds: [T.Sets, T.Logic] }, 'asha');
  check('she changes it', changed.status === 200 && changed.body.goal.title === 'Mid-sem' && changed.body.goal.topics.length === 2);
  const NO_GOAL = JSON.stringify({ error: 'That goal was not found.' });
  const theirs = [await patch(`/api/hub/goals/${goalId}`, { title: 'x' }, 'bilal'), await del(`/api/hub/goals/${goalId}`, 'omar')];
  check('another student changing or removing it: 404, word for word', theirs.every((r) => r.status === 404 && JSON.stringify(r.body) === NO_GOAL));
  const spare = await post('/api/hub/goals', { examDate: '2026-12-01', topicIds: [T.Graphs] }, 'asha');
  check('removing one: 200, then 404', (await del(`/api/hub/goals/${spare.body.goal.id}`, 'asha')).status === 200
    && (await del(`/api/hub/goals/${spare.body.goal.id}`, 'asha')).status === 404);
  check('Bilal\'s goals are his own: none', (await get('/api/hub/goals', 'bilal')).body.goals.length === 0);

  const home = await get('/api/hub/home', 'asha');
  const map = home.body.classes?.[0];
  const topics = map?.units?.[0]?.chapters?.[0]?.topics ?? [];
  check('the home: her class, its unit, the chapter\'s topics with her state and N', home.status === 200
    && map.units[0].name === 'Unit 1: Foundations' && JSON.stringify(topics.map((t) => t.name)) === JSON.stringify(TOPICS)
    && topics.every((t) => t.state && Number.isInteger(t.state.answers) && t.state.sentence), JSON.stringify(map).slice(0, 300));
  check('it says plainly that her professor can see her progress', /professor can see your progress/.test(home.body.notice));
  check('with reviews, her goal, her refresher path and her weeks', Array.isArray(home.body.reviews.due) && home.body.goals.goals.length === 1
    && home.body.paths.paths[0]?.checkId === checkId && home.body.paths.paths[0].done === 1 && home.body.paths.paths[0].steps === 2
    && home.body.weeks.weeks.length === 4, JSON.stringify(home.body.paths));
  check('and never a rank, an average, a streak, coins or a band', !NEVER.test(home.text), home.text.match(NEVER)?.[0]);
  const omarHome = (await get('/api/hub/home', 'omar')).body;
  check('Omar\'s home holds his own class and none of professor A\'s', omarHome.classes.length === 1
    && omarHome.classes[0].class.id === theirClass && !JSON.stringify(omarHome).includes(contentId), JSON.stringify(omarHome.classes?.map((c) => c.class)));
}

// ------------------------------------------------------------------ staff --

console.log('\nstaff: students per topic state in roll order, and Get Ready results (H17)');
{
  const view = await get(`/api/hub/classes/${classId}/states`);
  const functions = view.body.topics?.find((t) => t.id === T.Functions);
  const sets = view.body.topics?.find((t) => t.id === T.Sets);
  check('the owner: per topic, the students in each state, with N', view.status === 200 && functions
    && Object.values(functions.students).flat().length === 2 && sets.students['not-sure'].concat(sets.students['in-progress'], sets.students.mastered)
      .every((s) => Number.isInteger(s.answers)), JSON.stringify(sets?.students));
  const everyone = Object.values(sets.students).flat().map((s) => s.rollNo).sort();
  check('every student with an account is in one state of each topic; Dev, with no account, apart with the reason',
    JSON.stringify(everyone) === '["21CS01","21CS02"]' && view.body.noAccount.map((s) => s.rollNo).join() === '21CS04'
    && /No student account/.test(view.body.noAccount[0].note));
  check('roll order, never ranked; said', /roll order/.test(view.body.notes.order));
  const hod = await get(`/api/hub/classes/${classId}/states`, 'hod');
  check('the department\'s HOD reads it, read-only', hod.status === 200 && hod.body.class.access === 'reader');
  const NO_CLASS = JSON.stringify({ error: 'That class was not found.' });
  const outsiders = [await get(`/api/hub/classes/${classId}/states`, 'profB'), await get(`/api/hub/classes/${classId}/states`, 'hodOther'),
    await get(`/api/hub/classes/${classId}/students/${ashaRow._id}/getready`, 'profB')];
  check('another professor, another department\'s HOD: the class\'s 404, word for word', outsiders.every((r) => r.status === 404 && JSON.stringify(r.body) === NO_CLASS),
    outsiders.map((r) => r.status).join(','));

  const ready = await get(`/api/hub/classes/${classId}/students/${ashaRow._id}/getready`);
  const c = ready.body.checks?.[0];
  check('one student\'s Get Ready results: each prerequisite with its outcome and counts, about them', ready.status === 200 && c?.id === checkId
    && JSON.stringify(c.prerequisites.map((p) => [p.topic.name, p.outcome, p.right, p.answers])) === JSON.stringify([
      ['Logic', 'ready', 2, 2], ['Relations', 'needs-review', 0, 2], ['Sets', 'needs-review', 1, 3]])
    && c.prerequisites[1].sentence === 'Needs review: they got 0 of 2 right.' && c.path.done === 1, JSON.stringify(c).slice(0, 300));
  check('the HOD reads them too', (await get(`/api/hub/classes/${classId}/students/${ashaRow._id}/getready`, 'hod')).status === 200);
  const dev = await get(`/api/hub/classes/${classId}/students/${devRow._id}/getready`);
  check('a roster row with no account: no results, and why', dev.status === 200 && dev.body.checks.length === 0 && /No student account/.test(dev.body.note));
  check('a roster row of another class: that student\'s 404', (await get(`/api/hub/classes/${theirClass}/students/${ashaRow._id}/getready`, 'profB')).status === 404);
}

// ------------------------------------------------- nothing else moved --

console.log('\nrooms, attainment and the register are untouched (H5, H10)');
{
  const after = await untouched();
  check('the room\'s answers, profiles and attendance, attainment, the student report and the register: byte-identical', after === before, 'they differ');
  check('and no hub attempt became a room answer', (await repo.listAnswers({ sessionId: room.body.sessionId })).length === 1);
}

console.log('\nwithout Supabase');
{
  const saved = config.supabase.url;
  config.supabase.url = '';
  const r = [await get('/api/hub/home', 'asha'), await get('/api/hub/getready', 'asha'), await get('/api/hub/exams', 'asha')];
  config.supabase.url = saved;
  check('the hub\'s paths, self-tests and home answer 503, saying accounts are not set up', r.every((x) => x.status === 503 && /accounts/.test(x.body.error ?? '')),
    r.map((x) => x.status).join(','));
}

io.close();
server.close();

// ----------------------------------------------------------- boot probe --

console.log('\nthe boot probe names 0028 when it is missing, and rooms keep Supabase');
{
  const boot = async (missing) => {
    schemaMissing = missing;
    const lines = [];
    await initStore({ log: (l) => lines.push(l) });
    return { lines, kind: getRepo().kind };
  };
  const without = await boot(['hub_runs', 'hub_goals', 'hub_attempts.run_id']);
  check('0028 missing: Supabase is kept, and the log names 0028 and what fails, practice answers still saved',
    without.kind === 'supabase'
    && without.lines.some((l) => /WARNING: the hub_runs table is missing: apply supabase\/migrations\/0028_hub_paths_and_goals\.sql .*no Get Ready check or self-test/.test(l))
    && without.lines.some((l) => /WARNING: hub_attempts\.run_id is missing: apply supabase\/migrations\/0028_hub_paths_and_goals\.sql .*practice answers still are/.test(l))
    && without.lines.some((l) => /WARNING: the hub_goals table is missing: apply supabase\/migrations\/0028_hub_paths_and_goals\.sql/.test(l)),
    without.lines.join(' | '));
  const whole = await boot([]);
  check('with everything there, no warning', whole.kind === 'supabase' && !whole.lines.some((l) => /WARNING|missing/.test(l)), whole.lines.join(' | '));
  schemaMissing = null;
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.fetch = realFetch;
globalThis.Date = RealDate;
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
