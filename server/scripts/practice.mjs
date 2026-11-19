// Phase 6: practice in the Learning Hub, end to end (decisions H5 to H8, H14, H17).
//
//   node server/scripts/practice.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, against a clock this script sets, and
// checks:
//
//   accounts only     no token is a 401, the teacher key reaches nothing, staff
//                     on a student's route and a student on staff's are 403
//                     before anything is read, no Supabase is a 503
//   practice          a student practises a topic: the question comes with no
//                     key and no explanation; the right answer and the approved
//                     explanation come only once an attempt exists; a draft
//                     explanation never reaches a student
//   idempotency       the same attempt id again is 200 with the stored result
//                     and still one row; a self-test's attempt id resent to
//                     practice shows nothing
//   mastery           the topic's state moves with N: Not started, Not sure yet,
//                     In progress, Mastered
//   error log         a wrong answer opens an entry (with the question as shown,
//                     the response, what was right, the explanation and the
//                     confirmed prerequisites); another question right at that
//                     level or above clears it; a wrong VERIFIED room answer
//                     comes in "from class", a typed roll number's never
//   review            with the clock moved on, the topic comes due ("Needs
//                     review"); a review set sends it ahead again
//   consistency       days practised and rested this week, no streak
//   staff             the owner and the HOD read the class in roll order with
//                     states, N, open errors and activity; the HOD writes no
//                     explanation; another professor gets the 404
//   explanations      written by the professor, an AI draft approved, and none
//                     drafted offline (the reply says so)
//   who is refused    another professor's student, a student not on the
//                     roster, another professor: the same 404, word for word
//   nothing else moves  the room's answers and profiles, attainment, the
//                     student report and the register are byte-identical
//                     before and after all of the hub practice
//   boot probe        a database without 0026 keeps Supabase, and the log names
//                     the file and what fails until it is applied
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As
// server/scripts/roster.mjs, decisions.mjs and hub.mjs do, the server is pointed
// at http://supabase.invalid and every request to it is answered here,
// in-process; any other request off this machine is refused and counted.
// Never calls Gemini, Supabase or any network service. Exits non-zero on any
// failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

// ----------------------------------------------------------- the clock --
//
// Every `new Date()` and Date.now() in this process reads this clock, so the
// server's time is the script's to set: reviews come due when it moves on,
// and nothing waits on a real minute. `new Date(value)` is untouched.
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
const { OFFLINE_NOTE } = await import(`${SRC}services/hubExplanations.js`);
const { recordAttempt } = await import(`${SRC}services/hubPractice.js`);

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
// Cara (21CS03), never on it. Another HOD (ECE) <- professor B <- Omar, who
// also holds roll number 21CS01, on B's roster.

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'f0000000-0000-4000-8000-000000000001',
  profA: 'f0000000-0000-4000-8000-000000000002',
  profB: 'f0000000-0000-4000-8000-000000000003',
  hodOther: 'f0000000-0000-4000-8000-000000000004',
  asha: 'f0000000-0000-4000-8000-000000000005',
  bilal: 'f0000000-0000-4000-8000-000000000006',
  cara: 'f0000000-0000-4000-8000-000000000007',
  omar: 'f0000000-0000-4000-8000-000000000008',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-PRC0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T04:00:00+00:00', updated_at: '2026-11-19T04:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.asha, 'student', 'CSE', ID.profA, '21cs01'),
  account(ID.bilal, 'student', 'CSE', ID.profA, '21CS02'),
  account(ID.cara, 'student', 'CSE', ID.profA, '21CS03'),
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
    throw new Error(`practice.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by practice.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'practice-test-service-key';

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

// What a student may never be sent before an attempt: a key, a rubric, an
// explanation, a solution, a misconception label.
const KEYS_BEFORE = /answerIdx|answerIdxs|answerBool|"accept"|rubric|"sequence"|"pairs"|"buckets"|"value"|explanation|solution|misconception/;

// ------------------------------------------------------------- the material --

console.log('\nsetting up: a chapter, a class, a room, and prerequisite links');

const made = await post('/api/content', { title: 'Discrete structures', text: 'Logic\nSets\nRelations' });
const contentId = made.body.contentId;
await patch(`/api/content/${contentId}`, { topics: ['Logic', 'Sets', 'Relations'] });
const records = Object.fromEntries((await repo.listChapterTopics(contentId)).map((t) => [t.name, String(t._id)]));
const SETS = records.Sets;
const LOGIC = records.Logic;

// Sets: six approved questions, one per level (two at Remember, none at Create),
// and things practice never serves: a poll, a draft, an image question.
const LEVELS_SETS = ['remember', 'remember', 'understand', 'apply', 'analyse', 'evaluate'];
const sets = await repo.insertQuestions(LEVELS_SETS.map((bloom, i) => ({
  contentId, topic: 'Sets', text: `Sets ${bloom} ${i}: which is $A \\cup B$?`, kind: 'mcq',
  options: ['all of A and B', 'only A', 'only B', 'neither'], answerIdx: 0, bloom, source: 'teacher', status: 'active',
})));
const [poll, draft, image] = await repo.insertQuestions([
  { contentId, topic: 'Sets', text: 'Do you like sets?', kind: 'poll', options: ['yes', 'no'], bloom: 'remember', source: 'teacher', status: 'active' },
  { contentId, topic: 'Sets', text: 'A draft about sets', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'apply', source: 'llm', model: 'm', status: 'draft' },
  { contentId, topic: 'Sets', text: 'Look at the diagram', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'apply', source: 'teacher', status: 'active',
    stimulus: { kind: 'image', url: '/api/media/0123456789abcdef01234567', alt: 'a Venn diagram' } },
]);
// Logic and Relations: enough approved questions for a room (it needs six).
await repo.insertQuestions(['Logic', 'Relations', 'Logic', 'Relations', 'Logic', 'Relations'].map((topic, i) => ({
  contentId, topic, text: `${topic} ${i}?`, kind: 'mcq', options: ['yes', 'no', 'maybe', 'never'], answerIdx: 1,
  bloom: i % 2 ? 'understand' : 'remember', source: 'teacher', status: 'active',
})));
const keyOf = async (questionId) => (await repo.getQuestion(questionId)).answerIdx;
const byId = new Map(sets.map((q) => [String(q._id), q]));

const classId = (await post('/api/classes', { courseName: 'Discrete Maths', section: 'SY A' })).body.class.id;
await post(`/api/classes/${classId}/students`, { students: [{ roll: '21CS01', name: 'Asha' }, { roll: '21CS02', name: 'Bilal' }, { roll: '21CS04', name: 'Dev' }] });
check('the chapter is placed on the class', (await put(`/api/hub/classes/${classId}/chapters/${contentId}`, {})).status === 201);
const theirClass = (await post('/api/classes', { courseName: 'Signals', section: 'EC A' }, 'profB')).body.class.id;
await post(`/api/classes/${theirClass}/students`, { students: [{ roll: '21CS01', name: 'Omar' }] }, 'profB');
check('a confirmed prerequisite link: Logic before Sets', (await post('/api/hub/links', { prerequisiteId: LOGIC, topicId: SETS })).status === 201);

// A room for the class, before any hub practice, on Logic and Relations only
// (its question set): Asha joins signed in (her answers are verified) and gets
// one wrong; Bilal joins by typing his roll number only (his are not).
const roomSet = (await repo.listQuestions(contentId)).filter((q) => q.topic !== 'Sets').map((q) => String(q._id));
const room = await post('/api/session', { contentId, classId, questionIds: roomSet });
check('a room opens for the class', room.status === 201 || room.status === 200, JSON.stringify(room.body));
let roomWrong = null;
{
  const phone = await connect();
  const first = next(phone, ['server:question', 'server:exhausted']);
  phone.emit('student:join', { code: room.body.code, rollNo: '21CS01', name: 'Asha', token: TOKENS.asha });
  const q = (await first).payload.question;
  const result = next(phone, 'server:result');
  const key = await keyOf(q._id);
  phone.emit('student:answer', { questionId: q._id, response: (key + 1) % 4, answerId: 'room-asha-0001' });
  await result;
  roomWrong = { questionId: q._id, topic: q.topic };
  tick();
  const typed = await connect();
  const second = next(typed, ['server:question', 'server:exhausted']);
  typed.emit('student:join', { code: room.body.code, rollNo: '21CS02', name: 'Bilal' });
  const tq = (await second).payload.question;
  const r2 = next(typed, 'server:result');
  typed.emit('student:answer', { questionId: tq._id, response: ((await keyOf(tq._id)) + 1) % 4, answerId: 'room-bilal-0001' });
  await r2;
  phone.disconnect();
  typed.disconnect();
  // Let the server see both phones go before anything is read.
  await new Promise((r) => setTimeout(r, 200));
  const rows = await repo.listAnswers({ sessionId: room.body.sessionId });
  check('the room kept a verified wrong answer for Asha and an unverified one for Bilal',
    rows.some((a) => a.accountId === ID.asha && a.accountVerified === true && a.correct === false)
    && rows.some((a) => a.rollNo === '21CS02' && a.accountVerified === false), JSON.stringify(rows.map((a) => [a.rollNo, a.accountVerified, a.correct])));
}
tick();

// Everything the hub must leave alone, read before any hub practice.
const roster = await repo.listClassStudents(classId);
const ashaRow = roster.find((s) => s.rollNo === '21CS01');
const untouched = async () => JSON.stringify({
  answers: await repo.listAnswers({ sessionId: room.body.sessionId }),
  profiles: await repo.listProfiles(room.body.sessionId),
  attendance: await repo.listAttendance(room.body.sessionId),
  attainment: (await get(`/api/classes/${classId}/attainment`)).text,
  student: (await get(`/api/classes/${classId}/attainment/students/${ashaRow._id}`)).text,
  register: (await get(`/api/classes/${classId}/register`)).text,
});
const before = await untouched();
check('attainment, the student report and the register read before the hub (200s)', JSON.parse(before).register.startsWith('{'));

// ---------------------------------------------------------- accounts only --

console.log('\naccounts only, and who reaches which side (H1, H17)');
{
  check('no credentials: 401', (await get(`/api/hub/practice/next?topicId=${SETS}`, null)).status === 401);
  check('the shared teacher key reaches nothing here: 401', (await get('/api/hub/progress', 'key')).status === 401);
  const staffOnStudent = [await get(`/api/hub/practice/next?topicId=${SETS}`, 'profA'), await get('/api/hub/progress', 'hod'),
    await post('/api/hub/practice/attempts', { attemptId: 'staff-0001' }, 'profA'), await get('/api/hub/errors', 'profA')];
  check('staff on a student\'s own route: 403, saying it is for a student account',
    staffOnStudent.every((r) => r.status === 403 && /student account/.test(r.body.error)), staffOnStudent.map((r) => r.status).join(','));
  const studentOnStaff = [await get(`/api/hub/classes/${classId}/progress`, 'asha'), await get(`/api/hub/chapters/${contentId}/explanations`, 'asha'),
    await put(`/api/hub/questions/${sets[0]._id}/explanation`, { text: 'x' }, 'asha'), await post('/api/hub/explanations/generate', { contentId }, 'asha')];
  check('a student on a staff route: 403 before anything is read', studentOnStaff.every((r) => r.status === 403), studentOnStaff.map((r) => r.status).join(','));
}

// --------------------------------------------------------- explanations --

console.log('\nexplanations (H14)');
const Q = { remember: String(sets[0]._id), evaluate: String(sets[5]._id) };
{
  const written = await put(`/api/hub/questions/${Q.remember}/explanation`, { text: 'The union $A \\cup B$ holds every element of A and of B.' });
  check('the professor writes one: 201, theirs and approved as written', written.status === 201 && written.body.explanation.provenance === 'professor'
    && written.body.explanation.status === 'approved' && /<math>/.test(written.body.explanation.textHtml), JSON.stringify(written.body));
  await repo.addQuestionExplanation({ questionId: Q.evaluate, text: 'An AI draft about unions.', provenance: 'ai', status: 'draft', model: 'stand-in' });
  const listed = await get(`/api/hub/chapters/${contentId}/explanations`);
  check('the chapter lists each question\'s explanation, the draft labelled as one', listed.status === 200
    && JSON.stringify(listed.body.counts) === JSON.stringify({ approved: 1, draft: 1, none: listed.body.questions.length - 2 })
    && listed.body.questions.find((q) => q.questionId === Q.evaluate).explanation.label === 'AI draft: not shown to students until approved'
    && !listed.body.questions.some((q) => q.questionId === String(poll._id)), JSON.stringify(listed.body.counts));
  const offline = await post('/api/hub/explanations/generate', { contentId });
  check('on the professor\'s button, the offline generator drafts none and says so', offline.status === 200 && offline.body.source === 'offline'
    && offline.body.drafted.length === 0 && offline.body.note === OFFLINE_NOTE
    && offline.body.skipped.some((s) => s.questionId === Q.remember && /already has/.test(s.why)), JSON.stringify(offline.body).slice(0, 300));
  const run = await get(`/api/hub/explanations/run/${offline.body.runId}`);
  check('its run reads back done for its owner, and 404 for anyone else', run.status === 200 && run.body.run.state === 'done'
    && (await get(`/api/hub/explanations/run/${offline.body.runId}`, 'hod')).status === 404);
  check('the HOD reads the explanations and writes none: 403', (await get(`/api/hub/chapters/${contentId}/explanations`, 'hod')).status === 200
    && (await put(`/api/hub/questions/${Q.remember}/explanation`, { text: 'x' }, 'hod')).status === 403
    && (await post(`/api/hub/questions/${Q.evaluate}/explanation/approve`, {}, 'hod')).status === 403);
  const theirs = [await put(`/api/hub/questions/${Q.remember}/explanation`, { text: 'x' }, 'profB'),
    await get(`/api/hub/chapters/${contentId}/explanations`, 'profB'), await post('/api/hub/explanations/generate', { questionIds: [Q.remember] }, 'profB')];
  check('another professor: the 404, word for word, never 403', theirs.every((r) => r.status === 404)
    && theirs[0].body.error === 'That question was not found.', theirs.map((r) => `${r.status} ${r.body.error}`).join(' | '));
  check('a poll takes no explanation: 400', (await put(`/api/hub/questions/${poll._id}/explanation`, { text: 'x' })).status === 400);
}

// ------------------------------------------------------------- practice --

console.log('\npractising a topic: feedback only after an attempt (H5, H10, H14)');
const attempts = [];
async function practise(as, { right, mode = 'practice', topicId = SETS, attemptId = null, gap = 30000 } = {}) {
  tick(gap);
  const served = await get(`/api/hub/practice/next?topicId=${topicId}&mode=${mode}`, as);
  if (served.status !== 200 || !served.body.question) return { served };
  const key = await keyOf(served.body.question._id);
  const id = attemptId ?? `${as}-${attempts.length + 1}-xxxxxxxx`;
  const response = right ? key : (key + 1) % 4;
  // The phone's shuffle is seeded, so the shown position is the one forStudent dealt: the
  // options here are in stored order for an mcq with no fewer-choices support.
  const sent = await post('/api/hub/practice/attempts', { attemptId: id, questionId: served.body.question._id, topicId, response, mode, timeTakenMs: 5000 }, as);
  attempts.push({ as, id, sent });
  return { served, sent, id, response };
}
const progressOf = async (as, topicId = SETS) => (await get('/api/hub/progress', as)).body.topics?.find((t) => t.id === topicId)?.state;

{
  const start = await progressOf('asha');
  check('before any practice: Not started, N 0', start?.state === 'not-started' && start.answers === 0, JSON.stringify(start));
  const first = await get(`/api/hub/practice/next?topicId=${SETS}`, 'asha');
  const q = first.body.question;
  check('the next question: approved, as forStudent sends it, with the rich field and who wrote it',
    first.status === 200 && keysOf(q) === '["_id","bloom","kind","options","provenance","rich","source","text","topic"]'
    && /<math>/.test(q.rich?.text ?? '') && q.provenance?.text === 'Written by your professor.', JSON.stringify(q));
  check('and nothing that tells the answer: no key, no explanation, no solution', !KEYS_BEFORE.test(JSON.stringify(first.body)),
    JSON.stringify(first.body).match(KEYS_BEFORE)?.[0]);
  check('never a poll, a draft or an image question', ![poll, draft, image].some((x) => String(x._id) === q._id));
  // Skill 0 against the Bloom seeds: Understand (-0.75) gives 0.68, nearest the 0.7 aimed at (Remember gives 0.78).
  check('a new student starts at Understand, the level whose chance is nearest 0.7, and is told why',
    byId.get(q._id)?.bloom === 'understand' && /not practised/.test(first.body.why), JSON.stringify({ bloom: byId.get(q._id)?.bloom, why: first.body.why }));
  check('hints are not offered yet (the hook says so)', first.body.hints?.available === 0);

  // A wrong answer to the question that has an explanation.
  tick();
  const wrong = await post('/api/hub/practice/attempts', { attemptId: 'asha-wrong-0001', questionId: Q.remember, topicId: SETS, response: 2, timeTakenMs: 9000 }, 'asha');
  check('the attempt: 201, marked wrong on the server, with the right answer and the approved explanation',
    wrong.status === 201 && wrong.body.correct === false && wrong.body.solution === 0
    && wrong.body.explanation?.label === 'Written by your professor.' && /<math>/.test(wrong.body.explanation?.textHtml ?? ''), JSON.stringify(wrong.body).slice(0, 300));
  check('and the topic\'s state after it: Not sure yet, N 1, provisional', wrong.body.topic?.state?.state === 'not-sure'
    && wrong.body.topic.state.answers === 1 && wrong.body.topic.state.provisional === true, JSON.stringify(wrong.body.topic?.state));
  const again = await post('/api/hub/practice/attempts', { attemptId: 'asha-wrong-0001', questionId: Q.remember, topicId: SETS, response: 0 }, 'asha');
  check('the same attempt id again: 200, the stored result (still wrong), marked a duplicate', again.status === 200 && again.body.duplicate === true
    && again.body.correct === false && again.body.attempt.id === wrong.body.attempt.id);
  check('and one row, never a second', (await repo.listHubAttempts({ accountId: ID.asha })).length === 1);
  const stored = (await repo.listHubAttempts({ accountId: ID.asha }))[0];
  check('the row: mode, language, hints, the device\'s time, the snapshot with its key, the class and topic',
    stored.mode === 'practice' && stored.language === 'en' && stored.hintsUsed === 0 && stored.timeTakenMs === 9000
    && stored.questionSnapshot.answerIdx === 0 && stored.classId === classId && stored.topicId === SETS, JSON.stringify(stored).slice(0, 300));

  const refused = [
    await post('/api/hub/practice/attempts', { attemptId: 'asha-poll-0001', questionId: String(poll._id), topicId: SETS, response: 0 }, 'asha'),
    await post('/api/hub/practice/attempts', { attemptId: 'asha-draft-0002', questionId: String(draft._id), topicId: SETS, response: 0 }, 'asha'),
    await post('/api/hub/practice/attempts', { attemptId: 'asha-other-0001', questionId: Q.remember, topicId: LOGIC, response: 0 }, 'asha'),
  ];
  check('a poll, a draft, or a question sent under another topic: the question\'s 404, nothing stored',
    refused.every((r) => r.status === 404 && r.body.error === 'That question was not found.')
    && (await repo.listHubAttempts({ accountId: ID.asha })).length === 1, refused.map((r) => r.status).join(','));
  check('an attempt with no usable id: 400', (await post('/api/hub/practice/attempts', { attemptId: 'x', questionId: Q.remember, topicId: SETS, response: 0 }, 'asha')).status === 400);
  check('a mode practice does not keep: 400', (await post('/api/hub/practice/attempts', { attemptId: 'asha-exam-0009', questionId: Q.remember, topicId: SETS, response: 0, mode: 'exam' }, 'asha')).status === 400);
}

console.log('\nthe error log fills and clears (H7)');
{
  const log = await get('/api/hub/errors', 'asha');
  const practiceEntry = log.body.entries?.find((e) => e.from === 'practice');
  const classEntry = log.body.entries?.find((e) => e.from === 'class');
  check('the wrong practice answer is an open entry: the question as shown (no key), the response, what was right, the explanation',
    practiceEntry?.status === 'open' && practiceEntry.question.text === byId.get(Q.remember).text && !/answerIdx/.test(JSON.stringify(practiceEntry.question))
    && practiceEntry.response === 2 && practiceEntry.solution === 0 && practiceEntry.explanation?.by === 'professor', JSON.stringify(practiceEntry).slice(0, 300));
  check('with the topic\'s confirmed prerequisites, nearest first', JSON.stringify(practiceEntry?.prerequisites?.map((p) => [p.name, p.depth])) === '[["Logic",1]]');
  check('Asha\'s verified wrong room answer is in it too, marked "From class"', classEntry?.status === 'open' && classEntry.fromLabel === 'From class'
    && classEntry.question?.text?.length > 0, JSON.stringify(log.body.entries?.map((e) => [e.from, e.status, e.topic?.name])));
  const bilalLog = await get('/api/hub/errors', 'bilal');
  check('Bilal\'s room answer (a typed roll number, unverified) never reaches his error log', bilalLog.status === 200 && bilalLog.body.entries.length === 0);
  // The same question right again does not clear it: that is memory of the answer just shown.
  tick();
  await post('/api/hub/practice/attempts', { attemptId: 'asha-same-0001', questionId: Q.remember, topicId: SETS, response: 0 }, 'asha');
  check('the same question right again leaves it open', (await get('/api/hub/errors?status=open', 'asha')).body.entries.some((e) => e.from === 'practice'));
  // Another question, at Evaluate (above Remember), answered right; its explanation is only an AI draft.
  tick();
  const onDraft = await post('/api/hub/practice/attempts', { attemptId: 'asha-draft-0001', questionId: Q.evaluate, topicId: SETS, response: 0 }, 'asha');
  check('a question whose explanation is only an AI draft: none is shown after the attempt', onDraft.status === 201 && onDraft.body.explanation === null
    && onDraft.body.correct === true);
  const after = await get('/api/hub/errors?status=cleared', 'asha');
  check('a later right answer to another question at that level or above clears it, and says how',
    after.body.entries.some((e) => e.from === 'practice' && e.clearedBy?.from === 'practice' && e.clearedBy?.bloom === 'evaluate'
      && /cleared when you got another Evaluate question/.test(e.sentence)), JSON.stringify(after.body.entries?.map((e) => e.sentence)));
  check('the class entry (another topic) stays open', (await get('/api/hub/errors?status=open', 'asha')).body.entries.some((e) => e.from === 'class'));
  // A self-test's attempt (the self-test builder calls recordAttempt with its mode): its id resent to practice shows nothing.
  tick();
  await recordAttempt(repo, { id: ID.asha, role: 'student', reportsTo: ID.profA, rollNo: '21cs01', active: true },
    { attemptId: 'asha-exam-0001', questionId: String(sets[2]._id), topicId: SETS, response: 0, mode: 'exam' });
  const leaked = await post('/api/hub/practice/attempts', { attemptId: 'asha-exam-0001', questionId: String(sets[2]._id), topicId: SETS, response: 0 }, 'asha');
  check('a self-test\'s attempt id resent to practice: 409, and no answer or explanation in the reply', leaked.status === 409 && !KEYS_BEFORE.test(leaked.text)
    && !/correct/.test(leaked.text), leaked.text);
}

console.log('\nthe state moves with N (H6)');
{
  const seen = [];
  let state = await progressOf('asha');
  seen.push([state.answers, state.state]);
  for (let i = 0; i < 4; i += 1) {
    const r = await practise('asha', { right: true });
    if (!r.sent) break;
    state = r.sent.body.topic.state;
    seen.push([state.answers, state.state]);
  }
  const ok = seen.every(([n, s]) => (n < 3 ? s === 'not-sure' : ['in-progress', 'mastered'].includes(s)));
  check('every state agrees with its N: under 3 Not sure yet; from 3 In progress or Mastered', ok, JSON.stringify(seen));
  check('with all six questions met (five right first time), the topic is Mastered, with N and a sentence; a repeat adds no N',
    state.state === 'mastered' && state.answers === 6 && state.attempts > 6 && /^Mastered: from your 6 answers/.test(state.sentence), JSON.stringify(state));
  const bilal = await progressOf('bilal');
  check('Bilal\'s state is his own: Not started (Asha\'s practice is not his)', bilal?.state === 'not-started' && bilal.answers === 0);
}

console.log('\nspaced review comes due with the clock (H8)');
{
  const due0 = await get('/api/hub/review/due', 'asha');
  check('just after practising, nothing is due', due0.status === 200 && due0.body.due.length === 0 && due0.body.setSize === 5 && /under 40% right/.test(due0.body.rule));
  tick(3 * 86400000); // three days on
  const due1 = await get('/api/hub/review/due', 'asha');
  const state = await progressOf('asha');
  check('three days on, Sets is due for review, and its state says so with N', due1.body.due.map((d) => d.id).includes(SETS)
    && state.state === 'needs-review' && state.answers === 6 && state.estimateState === 'mastered' && /^Due for review/.test(state.sentence),
    JSON.stringify({ due: due1.body.due, state }));
  const reviewQ = await get(`/api/hub/practice/next?topicId=${SETS}&mode=review`, 'asha');
  check('a review set: a question on the topic, and the set\'s size', reviewQ.status === 200 && reviewQ.body.mode === 'review' && reviewQ.body.setSize === 5);
  for (let i = 0; i < 3; i += 1) await practise('asha', { right: true, mode: 'review', gap: 20000 });
  const due2 = await get('/api/hub/review/due', 'asha');
  const after = await progressOf('asha');
  check('the review sends it ahead: not due now, coming up later', !due2.body.due.some((d) => d.id === SETS)
    && after.state !== 'needs-review' && Date.parse(after.review.dueAt) > Date.now(), JSON.stringify(after.review));
  check('review attempts are kept with their mode', (await repo.listHubAttempts({ accountId: ID.asha })).filter((a) => a.mode === 'review').length === 3);
}

console.log('\nweekly consistency: own data, rest days, no streak (H8, H16)');
{
  const weeks = await get('/api/hub/consistency?weeks=2', 'asha');
  const [now, last] = weeks.body.weeks ?? [];
  check('this week (Monday 16 Nov to Sunday 22 Nov): practised Thursday and Sunday, rest days named, days to come neither',
    weeks.status === 200 && now.start === '2026-11-16' && now.practisedDays === 2
    && now.days.find((d) => d.day === '2026-11-19').practised && now.days.find((d) => d.day === '2026-11-22').practised
    && now.restDays === 5 && now.days.every((d) => !d.upcoming), JSON.stringify(now));
  check('last week was all rest; nothing anywhere counts a streak', last.practisedDays === 0 && !/streak/i.test(JSON.stringify(weeks.body)));
  check('a week count out of range: 400', (await get('/api/hub/consistency?weeks=99', 'asha')).status === 400);
}

console.log('\nwho is refused (H1): the same 404, word for word');
{
  const NO_TOPIC = JSON.stringify({ error: 'That topic was not found.' });
  const refusals = {
    'another professor\'s student with the same roll number': await get(`/api/hub/practice/next?topicId=${SETS}`, 'omar'),
    'a student never on the roster': await get(`/api/hub/practice/next?topicId=${SETS}`, 'cara'),
    'a topic that does not exist': await get('/api/hub/practice/next?topicId=0123456789abcdef01234567', 'asha'),
    'an attempt by another professor\'s student': await post('/api/hub/practice/attempts', { attemptId: 'omar-0000001', questionId: Q.remember, topicId: SETS, response: 0 }, 'omar'),
  };
  for (const [who, r] of Object.entries(refusals)) check(`${who}: 404`, r.status === 404 && JSON.stringify(r.body) === NO_TOPIC, `${r.status} ${JSON.stringify(r.body)}`);
  const omar = await get('/api/hub/progress', 'omar');
  check('Omar\'s own progress lists none of professor A\'s topics', omar.status === 200 && !omar.body.topics.some((t) => t.id === SETS));
  const classRefusals = [await get(`/api/hub/classes/${classId}/progress`, 'profB'), await get(`/api/hub/classes/${classId}/progress`, 'hodOther'),
    await get(`/api/hub/classes/${classId}/students/${ashaRow._id}/progress`, 'profB')];
  check('another professor, another department\'s HOD: the class\'s 404', classRefusals.every((r) => r.status === 404
    && r.body.error === 'That class was not found.'), classRefusals.map((r) => r.status).join(','));
  check('Bilal\'s own attempt id may repeat Asha\'s: it is his', (await practise('bilal', { right: false, attemptId: 'asha-wrong-0001' })).sent?.status === 201);
}

console.log('\nstaff read the class in roll order (H17)');
{
  const view = await get(`/api/hub/classes/${classId}/progress`);
  check('the owner: every roster student in roll order, never ranked', view.status === 200
    && JSON.stringify(view.body.students.map((s) => s.rollNo)) === '["21CS01","21CS02","21CS04"]' && /roll order/.test(view.body.notes.order));
  const [a, b, d] = view.body.students;
  // Asha's rows: the wrong one, the same question again, the draft-explained one, the self-test's, and every practise() of hers.
  const ashaRows = attempts.filter((x) => x.as === 'asha' && x.sent?.status === 201).length + 4;
  check('each topic\'s state with N, open errors and activity', a.topics[SETS].state === 'mastered' && a.topics[SETS].answers === 6
    && a.topics[SETS].openErrors === 0 && a.activity.total === ashaRows && a.activity.byMode.review === 3 && a.activity.byMode.exam === 1
    && b.topics[SETS].state === 'not-sure' && b.topics[SETS].openErrors === 1, JSON.stringify({ a: a.topics[SETS], act: a.activity, b: b.topics[SETS] }));
  check('a roll number no account carries says so, with no data', d.accountId === null && /No student account/.test(d.note));
  const setsRow = view.body.topics.find((t) => t.id === SETS);
  check('per topic, students per state', setsRow.counts.mastered === 1 && setsRow.counts['not-sure'] === 1 && setsRow.openErrors === 1, JSON.stringify(setsRow.counts));
  check('Asha\'s class mistake is an open error on its own topic', a.topics[records[roomWrong.topic]].openErrors === 1, JSON.stringify(a.topics));
  const one = await get(`/api/hub/classes/${classId}/students/${ashaRow._id}/progress`);
  check('one student: states with N, activity, and the error log with the question\'s id', one.status === 200
    && one.body.student.rollNo === '21CS01' && one.body.topics.find((t) => t.id === SETS).state.answers === 6
    && one.body.errors.entries.every((e) => e.questionId) && one.body.errors.counts.open === 1 && one.body.errors.counts.cleared === 1,
    JSON.stringify(one.body.errors?.counts));
  const hod = await get(`/api/hub/classes/${classId}/progress`, 'hod');
  check('the department\'s HOD reads it too, read-only', hod.status === 200 && hod.body.class.access === 'reader' && hod.body.class.canEdit === false);
  check('a roster row of another class is that student\'s 404', (await get(`/api/hub/classes/${theirClass}/students/${ashaRow._id}/progress`, 'profB')).status === 404);
}

console.log('\nexplanations: an AI draft approved reaches a student; one removed does not');
{
  const approved = await post(`/api/hub/questions/${Q.evaluate}/explanation/approve`, {});
  check('the owner approves the AI draft', approved.status === 200 && approved.body.explanation.label === 'Drafted by AI, approved by the professor');
  tick();
  const seen = await post('/api/hub/practice/attempts', { attemptId: 'bilal-eval-0001', questionId: Q.evaluate, topicId: SETS, response: 1 }, 'bilal');
  check('and a student sees it after answering, labelled as written with AI help', seen.status === 201 && seen.body.explanation?.by === 'ai'
    && seen.body.explanation.label === 'Written with AI help and checked by your professor.');
  check('removing it: 200, then 404 for a second removal', (await del(`/api/hub/questions/${Q.evaluate}/explanation`)).status === 200
    && (await del(`/api/hub/questions/${Q.evaluate}/explanation`)).status === 404);
}

// ------------------------------------------------ a room's live question --

console.log('\na question a room is asking now stays closed in the hub (review fix)');
{
  // Another room on the chapter (for no class, so the class's register and
  // attainment are untouched), and a phone that joins it by typing a roll
  // number: it is served a question and has not answered it yet.
  const other = await post('/api/session', { contentId, questionIds: roomSet });
  const phone = await connect();
  const served = next(phone, ['server:question', 'server:exhausted']);
  phone.emit('student:join', { code: other.body.code, rollNo: '21CS77', name: 'A guest' });
  const pinned = (await served).payload?.question?._id ?? null;
  const live = pinned ? await repo.getQuestion(pinned) : null;
  const topicId = live ? records[live.topic] : null;
  check('a phone in an open room holds a question it was served and has not finished', Boolean(live && topicId)
    && (await repo.getProfile(other.body.sessionId, '21CS77'))?.served?.questionId === pinned, String(pinned));
  const kept = (await repo.listHubAttempts({})).length;
  const tried = await post('/api/hub/practice/attempts', { attemptId: 'asha-live-0001', questionId: pinned, topicId, response: live?.answerIdx }, 'asha');
  // Batch 9 (E1): the sentence says it is part of a class still running.
  check('practising it: 409, saying it is part of a class still running, with no key or mark, nothing stored', tried.status === 409
    && /part of a class that is still running/.test(tried.body.error) && !KEYS_BEFORE.test(tried.text) && !/correct/.test(tried.text)
    && (await repo.listHubAttempts({})).length === kept, tried.text);
  const hint = await post('/api/hub/practice/hints', { attemptId: 'asha-live-0002', questionId: pinned, topicId }, 'asha');
  check('a hint on it: 409, nothing recorded', hint.status === 409 && /part of a class that is still running/.test(hint.body.error)
    && (await repo.listHintViews({ clientAttemptId: 'asha-live-0002' })).length === 0, hint.text);
  // A phone in a room may be anyone's (decision 7): closed to every student, whoever it was served to.
  const bilal = await post('/api/hub/practice/attempts', { attemptId: 'bilal-live-0001', questionId: pinned, topicId, response: live?.answerIdx }, 'bilal');
  check('and to Bilal too', bilal.status === 409, bilal.text);
  phone.disconnect();
}

// ------------------------------------------------- nothing else moved --

console.log('\nrooms, attainment and the register are untouched (H5)');
{
  const after = await untouched();
  check('the room\'s answers, profiles and attendance, attainment, the student report and the register: byte-identical', after === before,
    'they differ');
  check('and hub attempts never became room answers', (await repo.listAnswers({ sessionId: room.body.sessionId })).length === 2);
}

console.log('\nwithout Supabase');
{
  const saved = config.supabase.url;
  config.supabase.url = '';
  const r = await get('/api/hub/progress', 'asha');
  config.supabase.url = saved;
  check('the hub\'s practice answers 503, saying accounts are not set up', r.status === 503 && /accounts/.test(r.body.error ?? ''), JSON.stringify(r.body));
}

io.close();
server.close();

// ----------------------------------------------------------- boot probe --

console.log('\nthe boot probe names 0026 when it is missing, and rooms keep Supabase');
{
  const boot = async (missing) => {
    schemaMissing = missing;
    const lines = [];
    await initStore({ log: (l) => lines.push(l) });
    return { lines, kind: getRepo().kind };
  };
  const without = await boot(['hub_attempts', 'question_explanations']);
  check('the practice tables missing: Supabase is kept, and the log names 0026 and what fails',
    without.kind === 'supabase'
    && without.lines.some((l) => /WARNING: the hub_attempts table is missing: apply supabase\/migrations\/0026_hub_practice\.sql .*Until it is applied, no practice answer/.test(l))
    && without.lines.some((l) => /WARNING: the question_explanations table is missing: apply supabase\/migrations\/0026_hub_practice\.sql .*still saved and marked/.test(l)),
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
