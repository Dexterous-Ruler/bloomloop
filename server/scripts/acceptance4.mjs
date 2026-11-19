// Phase 4 acceptance: "a professor can conduct multiple sessions and generate a
// meaningful course-outcome attainment report without manually compiling quiz
// results." End to end, exactly that.
//
//   node server/scripts/acceptance4.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, as a signed-in professor, over HTTP and
// Socket.io only, with one exception said where it happens (each room's
// opening day is moved back by a week through the store, since no route can
// open a room in the past):
//
//   1. the professor writes a chapter's question bank (approved as written),
//      makes a class and imports its roster from a CSV file (a phone column left
//      unread, a name beginning with "=", a name in Devanagari)
//   2. defines three course outcomes (one statement holding "<script>") and maps
//      them to topics of the bank, one topic left unmapped
//   3. runs three rooms on three different days with scripted phones: students
//      absent from some rooms, one absent from all, a roll number not on the
//      roster, written answers left provisional, one reviewed by the professor;
//      a projector watches the last room
//   4. asks for the attainment report, the Bloom sheet, the marks register, one
//      student's report and the outcome list, as JSON, CSV and printable HTML
//
// and checks every figure against the numbers worked out by hand below (no
// figure is computed here from the answers), that each file is the JSON of the
// same query, the methodology paragraph, the CSV's formula-injection guard,
// BOM, CRLF and unquoted numbers, the HTML's escaping and self-containment,
// who may fetch what, and that no phone and no projector socket is ever sent
// any of it.
//
// Signed-in accounts need Supabase Auth, which this suite must never reach: as in
// roster.mjs and attainment.mjs, the server is pointed at http://supabase.invalid
// and the three calls it makes about accounts are answered here, in-process. Any
// other request off this machine is refused outright.
//
// Never calls Gemini, Supabase or any network service. Exits non-zero on any failure.

import fs from 'node:fs';
import http from 'node:http';
import path_ from 'node:path';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { parseCsv } = await import(`${SRC}services/csv.js`);
const { escapeHtml } = await import(`${SRC}services/printable.js`);

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
// HOD (CSE) <- professor A <- a student; professor B under another HOD (ECE).

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'c0000000-0000-4000-8000-000000000001',
  profA: 'c0000000-0000-4000-8000-000000000002',
  profB: 'c0000000-0000-4000-8000-000000000003',
  hodOther: 'c0000000-0000-4000-8000-000000000004',
  student: 'c0000000-0000-4000-8000-000000000005',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-ACCP0${id.slice(-1)}`,
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
    throw new Error(`acceptance4.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by acceptance4.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'acceptance-test-service-key';

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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `as`: one of the TOKENS' names, or null for no credentials. `type` sends `body`
 * unencoded as that content type. `raw`: keep the body as text and bytes (a CSV
 * or a page) rather than reading JSON.
 */
async function call(method, path, { body, as = 'profA', type, raw = false, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  let payload;
  if (type) { headers['content-type'] = type; payload = body; } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers, body: payload });
  if (raw) {
    const bytes = Buffer.from(await res.arrayBuffer());
    // ACCEPTANCE4_DUMP=<folder> keeps each file fetched, to look at by eye.
    if (DUMP && res.status === 200 && /filename="([^"]+)"/.test(res.headers.get('content-disposition') ?? '')) {
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition'))[1].replace(/\d{4}-\d{2}-\d{2}/, `${as ?? 'key'}-${++dumped}`);
      fs.writeFileSync(path_.join(DUMP, name), bytes);
    }
    return { status: res.status, headers: res.headers, bytes, text: bytes.toString('utf8'), body: (() => { try { return JSON.parse(bytes.toString('utf8')); } catch { return {}; } })() };
  }
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) };
}
const get = (path, as) => call('GET', path, { as });
const file = (path, as) => call('GET', path, { as, raw: true });
const post = (path, body, as) => call('POST', path, { body, as });
const put = (path, body, as) => call('PUT', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });

const NOWHERE = 'ffffffffffffffffffffffff'; // a well-formed id no store holds

const DUMP = process.env.ACCEPTANCE4_DUMP || '';
if (DUMP) fs.mkdirSync(DUMP, { recursive: true });
let dumped = 0;

// ---------------------------------------------------------------- sockets --

/** Every payload any phone was sent, and everything the projector was sent. */
const phoneSaw = [];
const wallSaw = [];

function connect(log) {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  s.onAny((event, payload) => log.push({ event, payload }));
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });
}

function either(socket, events, ms = 5000) {
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
/**
 * A phone that joins a room and answers whatever it is served, from `plan`
 * (question id -> response), until the room's set runs out. The order the
 * selector serves them in does not matter: every count below is per question,
 * and the plans keep every student out of the below-40% band while questions
 * above Understand are left (the ceiling would otherwise hold those back).
 * Returns how many it answered. `stay` keeps the socket open afterwards.
 */
async function phone(code, rollNo, name, plan, { stay = false } = {}) {
  const s = await connect(phoneSaw);
  const first = either(s, ['server:question', 'server:exhausted', 'session:rejected']);
  s.emit('student:join', { code, rollNo, name });
  let got = await first;
  let answered = 0;
  while (got.name === 'server:question') {
    const q = got.payload.question;
    if (!(q._id in plan)) throw new Error(`${rollNo} has no plan for ${q._id} in ${code}`);
    keyN += 1;
    const result = either(s, ['server:result', 'session:rejected']);
    s.emit('student:answer', { questionId: q._id, response: plan[q._id], answerId: `accept-${String(keyN).padStart(4, '0')}` });
    const r = await result;
    if (r.name !== 'server:result') throw new Error(`${rollNo}'s answer in ${code} was refused: ${JSON.stringify(r.payload)}`);
    answered += 1;
    const nextOne = either(s, ['server:question', 'server:exhausted']);
    s.emit('student:next');
    got = await nextOne;
  }
  if (!stay) s.disconnect();
  return { answered, socket: s };
}

// -------------------------------------------- 1. the bank and the class --

console.log('\n1. the professor\'s bank, a class, and its roster from a CSV file');

const chapter = await post('/api/content', {
  title: 'Operating Systems: Unit 1',
  text: 'Processes and their states. CPU scheduling. Memory management and paging. Deadlock.',
});
const contentId = chapter.body.contentId;
const topics = await patch(`/api/content/${contentId}`, { topics: ['Processes', 'Scheduling', 'Memory', 'Deadlock'] });
check('a chapter, with its four topics', chapter.status === 201 && topics.status === 200
  && same(topics.body.content?.topics, ['Processes', 'Scheduling', 'Memory', 'Deadlock']), `${chapter.status} ${topics.status}`);

const RUBRIC = ['context switch saves registers', 'scheduler picks next process'];
const FULL = 'a context switch saves registers, then the scheduler picks the next process'; // 2 of 2: 1, provisional
const PARTIAL = 'a context switch saves registers'; // 1 of 2: 0.5, provisional, then reviewed to 1
const NONE = 'no idea'; // 0 of 2: 0, provisional

const Q = {};
const R = {}; // the right response to each question
const W = {}; // a wrong one
for (const [name, body, right, wrong] of [
  ['P1', { topic: 'Processes', bloom: 'remember', kind: 'mcq', text: 'Which state is a process in while it waits for I/O?',
    options: ['Running', 'Blocked', 'Ready', 'Terminated'], answerIdx: 1 }, 1, 0],
  ['P2', { topic: 'Processes', bloom: 'remember', kind: 'truefalse', text: 'A process and a program are the same thing.',
    answerBool: false }, false, true],
  ['P3', { topic: 'Processes', bloom: 'apply', kind: 'numeric', value: 5, tolerance: 0, unit: 'processes',
    text: 'A process is created every 5 ms, the first at 0 ms. How many exist by 20 ms?' }, '5', '4'],
  ['W1', { topic: 'Processes', bloom: 'create', kind: 'open', text: 'Describe what happens in a context switch.', rubric: RUBRIC }, null, null],
  ['S1', { topic: 'Scheduling', bloom: 'remember', kind: 'mcq', text: 'Which policy runs the shortest job first?',
    options: ['FCFS', 'SJF', 'Round robin', 'Priority'], answerIdx: 1 }, 1, 0],
  ['S2', { topic: 'Scheduling', bloom: 'apply', kind: 'numeric', value: 3, tolerance: 0, unit: 'ms',
    text: 'Jobs of 3, 3 and 6 ms arrive together. What is the average waiting time under SJF?' }, '3', '4'],
  ['S3', { topic: 'Scheduling', bloom: 'apply', kind: 'blank', accept: ['round robin'],
    text: 'A policy that gives each process a fixed time slice in turn is called ____ .' }, 'round robin', 'first come'],
  ['M1', { topic: 'Memory', bloom: 'remember', kind: 'mcq', text: 'Which unit translates virtual addresses?',
    options: ['ALU', 'MMU', 'DMA', 'PIC'], answerIdx: 1 }, 1, 0],
  ['M2', { topic: 'Memory', bloom: 'apply', kind: 'numeric', value: 5, tolerance: 0, unit: 'pages',
    text: 'Pages are 4 KB. How many pages does a 20 KB process need?' }, '5', '4'],
  ['D1', { topic: 'Deadlock', bloom: 'remember', kind: 'mcq', text: 'Which of these is a condition for deadlock?',
    options: ['Preemption', 'Circular wait', 'Paging', 'Spooling'], answerIdx: 1 }, 1, 0],
]) {
  const r = await post(`/api/bank/${contentId}/questions`, body);
  if (r.status !== 201) check(`writing ${name}`, false, `HTTP ${r.status} ${r.body.error ?? ''}`);
  Q[name] = String(r.body.question?._id);
  R[Q[name]] = right;
  W[Q[name]] = wrong;
}
{
  const bank = await get(`/api/bank/${contentId}`);
  check('ten questions written by the professor, every one approved (active) and none a draft',
    bank.status === 200 && bank.body.active === 10 && bank.body.drafts === 0, `HTTP ${bank.status} ${bank.body.active}`);
}

const made = await post('/api/classes', { courseName: 'Operating Systems', section: 'TY-CS A', termLabel: 'Sem V' });
const classId = made.body.class?.id;
check('a professor makes a class', made.status === 201 && Boolean(classId));

const HYPER = '=HYPERLINK("http://evil.invalid","Dev")';
const MEERA = 'मीरा जोशी';
const ROSTER_CSV = '﻿Roll No,Student Name,Mobile\r\n'
  + '21CS01,Asha Rao,9845012345\r\n'
  + '21CS02,Bilal Khan,\r\n'
  + '21CS03,Chitra Iyer,\r\n'
  + `21CS04,"${HYPER.replace(/"/g, '""')}",\r\n`
  + `21CS05,${MEERA},\r\n`;
{
  const dry = await call('POST', `/api/classes/${classId}/students/import?dryRun=true`, { body: ROSTER_CSV, type: 'text/csv' });
  check('the dry run reads five students and leaves the Mobile column unread, adding nobody',
    dry.status === 200 && dry.body.wouldAdd?.length === 5 && same(dry.body.ignoredColumns, ['Mobile']) && dry.body.size === 0,
    `HTTP ${dry.status} ${dry.body.error ?? ''}`);
  const real = await call('POST', `/api/classes/${classId}/students/import`, { body: ROSTER_CSV, type: 'text/csv' });
  check('the import adds them: the "=" name and the Devanagari name exactly as written',
    real.status === 200 && real.body.added?.length === 5 && real.body.added.some((s) => s.name === HYPER)
    && real.body.added.some((s) => s.name === MEERA), `HTTP ${real.status} ${real.body.error ?? ''}`);
}
const roster = await repo.listClassStudents(classId);
const studentId = (roll) => String(roster.find((s) => s.rollNo === roll)?._id);
check('the roster keeps a roll number and a name only (no mobile number anywhere)',
  roster.length === 5 && !JSON.stringify(roster).includes('9845012345'));

// ------------------------------------------- 2. outcomes and mappings --

console.log('\n2. three course outcomes, mapped to topics of the bank');

const STATEMENT = {
  CO1: 'Explain how an operating system manages processes.',
  CO2: 'Apply <script>alert("co2")</script> scheduling policies to a set of jobs.',
  CO3: 'Analyse memory allocation with paging.',
};
const CO = {};
for (const [code, topic, weight] of [['CO1', 'Processes', 1], ['CO2', 'Scheduling', 1], ['CO3', 'Memory', 2]]) {
  const r = await post(`/api/classes/${classId}/outcomes`, { code, statement: STATEMENT[code], targetLevel: code === 'CO3' ? 'analyse' : null });
  CO[code] = r.body.outcome?.id;
  const m = await put(`/api/classes/${classId}/outcomes/${CO[code]}/topics`, { topics: [{ contentId, topic, weight }] });
  check(`${code} made and mapped to ${topic}${weight !== 1 ? ` (weight ${weight})` : ''}`, r.status === 201 && m.status === 200
    && m.body.outcome?.topics?.[0]?.topic === topic, `${r.status} ${m.status} ${m.body.error ?? ''}`);
}

// --------------------------------------------------- 3. three rooms --

console.log('\n3. three rooms on three days, scripted phones, a projector');

const rooms = {};
for (const [name, set, day] of [
  ['A', ['P1', 'P2', 'P3', 'S1'], '2026-11-03T04:00:00.000Z'],
  ['B', ['S2', 'S3', 'M1', 'M2', 'D1'], '2026-11-10T04:00:00.000Z'],
  ['C', ['W1', 'P1', 'M1'], '2026-11-17T04:00:00.000Z'],
]) {
  const r = await post('/api/session', { contentId, classId, questionIds: set.map((q) => Q[q]), title: `Week ${name}` });
  if (r.status !== 200) check(`opening room ${name}`, false, `HTTP ${r.status} ${r.body.error ?? ''}`);
  // The one step behind the API: no route opens a room in the past.
  await repo.updateSession(r.body.sessionId, { startedAt: day });
  rooms[name] = { code: r.body.code, id: r.body.sessionId };
}
check('three rooms opened for the class, each on its own question set', Object.values(rooms).every((r) => r.code));

// A projector on room C, on the class's progress, so it is pushed after every answer there.
const link = await post(`/api/session/${rooms.C.code}/projector/links`, {});
const wall = await connect(wallSaw);
{
  const watched = either(wall, ['projector:state', 'projector:refused']);
  wall.emit('projector:watch', { token: link.body.token });
  const w = await watched;
  const mode = await patch(`/api/session/${rooms.C.code}/projector`, { mode: 'progress' });
  check('a projector watches room C, showing progress', link.status === 201 && w.name === 'projector:state' && mode.status === 200,
    `${link.status} ${w.name} ${mode.status}`);
}

// Who answered what, by hand (1 right, 0 wrong):
//   21CS01 Asha    A: P1 1, P2 1, S1 1, P3 1   B: M1 1, D1 1, S2 1, S3 0, M2 1   C: W1 full (1, provisional), P1 1, M1 1
//   21CS02 Bilal   A: P1 1, P2 1, S1 0, P3 0   B: M1 1, D1 1, S2 0, S3 1, M2 0   C: W1 partial (0.5, reviewed to 1), P1 0, M1 1
//   21CS03 Chitra  A: P1 1, P2 1, S1 1, P3 0   B: absent                         C: W1 none (0, provisional), P1 0, M1 1
//   21CS04 (=)     A: P1 0, P2 1, S1 1, P3 1   B: M1 1, D1 1, S2 0, S3 0, M2 0   C: absent
//   21CS05 Meera   absent from all three
//   VISIT9         A: all four right (a roll number not on the roster)
const plan = (rights, wrongs, written = {}) => ({
  ...Object.fromEntries(rights.map((q) => [Q[q], R[Q[q]]])),
  ...Object.fromEntries(wrongs.map((q) => [Q[q], W[Q[q]]])),
  ...Object.fromEntries(Object.entries(written).map(([q, text]) => [Q[q], text])),
});
{
  const runs = [
    [rooms.A.code, '21CS01', 'Asha', plan(['P1', 'P2', 'S1', 'P3'], [])],
    [rooms.A.code, '21CS02', 'Bilal', plan(['P1', 'P2'], ['S1', 'P3'])],
    [rooms.A.code, '21CS03', 'Chitra', plan(['P1', 'P2', 'S1'], ['P3'])],
    [rooms.A.code, '21CS04', 'Dev', plan(['P2', 'S1', 'P3'], ['P1'])],
    [rooms.A.code, 'VISIT9', 'Visitor', plan(['P1', 'P2', 'S1', 'P3'], [])],
    [rooms.B.code, '21CS01', 'Asha', plan(['M1', 'D1', 'S2', 'M2'], ['S3'])],
    [rooms.B.code, '21CS02', 'Bilal', plan(['M1', 'D1', 'S3'], ['S2', 'M2'])],
    [rooms.B.code, '21CS04', 'Dev', plan(['M1', 'D1'], ['S2', 'S3', 'M2'])],
    [rooms.C.code, '21CS01', 'Asha', plan(['P1', 'M1'], [], { W1: FULL })],
    [rooms.C.code, '21CS02', 'Bilal', plan(['M1'], ['P1'], { W1: PARTIAL })],
    [rooms.C.code, '21CS03', 'Chitra', plan(['M1'], ['P1'], { W1: NONE })],
  ];
  const answered = [];
  for (const [code, roll, name, p] of runs) answered.push((await phone(code, roll, name, p)).answered);
  check('every phone is served its room\'s whole set and answers it: 4 x 5, 5 x 3, 3 x 3',
    same(answered, [4, 4, 4, 4, 4, 5, 5, 5, 3, 3, 3]), JSON.stringify(answered));
  const stored = (await repo.listAnswers({ sessionIds: Object.values(rooms).map((r) => r.id) })).length;
  check('44 answers are stored, with nobody compiling anything', stored === 44, `${stored}`);
}
for (const r of Object.values(rooms)) {
  const marked = await post(`/api/session/${r.code}/attendance`, { fromJoins: true });
  if (marked.status !== 200) check(`attendance in ${r.code}`, false, `HTTP ${marked.status} ${marked.body.error ?? ''}`);
}
// A phone left in room C (Asha again: her set is done, so she is told so and stays).
const { socket: stayingPhone } = await phone(rooms.C.code, '21CS01', 'Asha', {}, { stay: true });

// ------------------------------------------------ 4. the report, by hand --

console.log('\n4. the attainment report, against the hand count');

const reportPath = `/api/classes/${classId}/attainment`;
const studentRow = (r, roll) => r.body.students?.find((s) => s.rollNo === roll);
const coOf = (row, code) => row?.outcomes?.find((o) => o.code === code);
const counts = (cell) => [cell?.state, cell?.answers, cell?.obtained, cell?.possible];

{
  // Before the review: Bilal's written answer is provisional, so not counted.
  //   CO1 Bilal: P1 1, P2 1, P3 0 (A), P1 0 (C) = 2 of 4 = 50%: not attained
  const before = await get(reportPath);
  check('before any review: Bilal 2 of 4 on CO1 (his written answer provisional, not counted), not attained; CO1 at level 1',
    same(counts(coOf(studentRow(before, '21CS02'), 'CO1')), ['not-attained', 4, 2, 4]) && coOf(before.body, 'CO1')?.attainmentLevel === 1,
    JSON.stringify(coOf(studentRow(before, '21CS02'), 'CO1')));
  const queue = await get(`/api/review?code=${rooms.C.code}`);
  const bilal = (queue.body.items ?? []).find((i) => i.student?.rollNo === '21CS02');
  const reviewed = await post(`/api/review/${bilal?.answerId}`, { decision: 'override', score: 1, note: 'Both steps are there.' });
  check('the professor reviews Bilal\'s written answer through the review queue: 0.5 becomes 1',
    queue.body.items?.length === 3 && reviewed.status === 200 && reviewed.body.item?.reviewStatus === 'overridden',
    `HTTP ${reviewed.status} ${reviewed.body.error ?? ''}`);
}

const report = await get(reportPath);
const b = report.body;
{
  check('the report answers 200, over the three rooms in date order, under the default example formula',
    report.status === 200 && same(b.rooms?.map((r) => r.code), [rooms.A.code, rooms.B.code, rooms.C.code])
    && same(b.rooms?.map((r) => r.day), ['2026-11-03', '2026-11-10', '2026-11-17'])
    && b.formula?.source === 'example' && b.formula?.version === 0, `HTTP ${report.status} ${b.error ?? ''}`);
  check('students in roll order: the roster, then the roll number not on it; never ranked',
    same(b.students?.map((s) => [s.rollNo, s.status]), [['21CS01', 'active'], ['21CS02', 'active'], ['21CS03', 'active'],
      ['21CS04', 'active'], ['21CS05', 'active'], ['VISIT9', 'not-on-roster']]));
  // 44 answers: 41 digital, the two written answers left provisional, the one reviewed.
  // Deadlock (D1, three answers) is mapped to no outcome.
  // Every question was written by the professor (POST /api/bank/:contentId/questions), which since
  // 19 Nov 2026 (0022) stores question_source 'teacher': all 44 are on professor-written questions.
  check('answers: 44, 41 digital, 2 provisional, 1 reviewed; 41 reach an outcome, 3 none, adding up; all on the professor\'s questions',
    same(b.answers, { rows: 44, setAside: 0, chosen: 44, ungraded: 0, graded: 44,
      byType: { digital: 41, aiProvisional: 2, humanReviewed: 1, revote: 0 }, mapped: 41, excluded: 0, unmapped: 3,
      bySource: { aiGenerated: 0, professorWritten: 44, offlineTemplate: 0 } }), JSON.stringify(b.answers));
  check('what reaches no outcome is named: Deadlock, 3 answers',
    b.unmapped?.length === 1 && b.unmapped[0].topic === 'Deadlock' && b.unmapped[0].answers === 3);

  // CO1 (Processes: P1, P2, P3 in A; W1 and P1 again in C)
  //   Asha    1 + 1 + 1 + 1 = 4 of 4 (her provisional written 1 not counted)    attained
  //   Bilal   1 + 1 + 0 + 0 + the reviewed 1 = 3 of 5 = exactly 60%            attained
  //   Chitra  1 + 1 + 0 + 0 = 2 of 4 (her provisional 0 not counted) = 50%      not attained
  //   21CS04  0 + 1 + 1 = 2 of 3                                                attained
  //   Meera   nothing                                                           not enough evidence
  //   class   3 of 4 counted = 75%: level 3; the visitor's 3 answers beside it
  check('CO1 per student: 4 of 4; exactly 60% after the review; 2 of 4; 2 of 3; none',
    same(counts(coOf(studentRow(report, '21CS01'), 'CO1')), ['attained', 4, 4, 4])
    && same(counts(coOf(studentRow(report, '21CS02'), 'CO1')), ['attained', 5, 3, 5])
    && same(counts(coOf(studentRow(report, '21CS03'), 'CO1')), ['not-attained', 4, 2, 4])
    && same(counts(coOf(studentRow(report, '21CS04'), 'CO1')), ['attained', 3, 2, 3])
    && same(counts(coOf(studentRow(report, '21CS05'), 'CO1')), ['not-enough-evidence', 0, 0, 0]));
  const co1 = coOf(b, 'CO1');
  check('CO1 for the class: 3 of 4 counted (75%): level 3; Meera not enough evidence; the visitor outside',
    same(co1?.students, { roster: 5, counted: 4, attained: 3, notAttained: 1, notEnoughEvidence: 1, withNoAnswers: 1 })
    && co1?.share === 0.75 && co1?.attainmentLevel === 3
    && same(co1?.outside?.removed, { students: 0, answers: 0 }) && same(co1?.outside?.notOnRoster, { students: 1, answers: 3 })
    // Meera is the one short of evidence, with no answer: nothing of the roster's is outside the share.
    && co1?.outside?.notEnoughEvidence?.students === 0 && co1?.outside?.notEnoughEvidence?.answers === 0, JSON.stringify(co1?.students));
  // The share's evidence: Asha 4, Bilal 4 + the reviewed 1, Chitra 4, 21CS04 3 = 15 digital (4 + 2 + 2 + 2 = 10 marks);
  // the provisional two are Asha's 1 and Chitra's 0.
  check('CO1 rests on 15 digital answers (10 marks) and 1 reviewed (1), with 2 provisional (1 mark) shown apart',
    same([co1?.marks?.digital?.answers, co1?.marks?.digital?.obtained, co1?.marks?.humanReviewed?.answers, co1?.marks?.humanReviewed?.obtained,
      co1?.marks?.aiProvisional?.answers, co1?.marks?.aiProvisional?.obtained, co1?.marks?.aiProvisional?.counted], [15, 10, 1, 1, 2, 1, false])
    && co1?.summary === '3 of 4 students counted attained CO1 (75%): level 3. 1 on the roster has not enough evidence (fewer than 3 '
      + 'counted answers). Rests on 16 counted answers from the 4 students counted: 15 digital and 1 reviewed written. 2 provisional '
      + 'written answers are shown but not counted.', co1?.summary);
  // CO2 (Scheduling: S1 in A; S2, S3 in B): Asha 2 of 3; Bilal 1 of 3; Chitra 1 answer (absent from B); 21CS04 1 of 3
  const co2 = coOf(b, 'CO2');
  check('CO2: Asha 2 of 3 attained, Bilal and 21CS04 1 of 3 not, Chitra one answer (absent from B): 1 of 3 counted, level 0',
    same(co2?.students, { roster: 5, counted: 3, attained: 1, notAttained: 2, notEnoughEvidence: 2, withNoAnswers: 1 })
    && co2?.share === 0.3333 && co2?.attainmentLevel === 0
    && same(counts(coOf(studentRow(report, '21CS03'), 'CO2')), ['not-enough-evidence', 1, 1, 1]), JSON.stringify(co2?.students));
  // CO3 (Memory, weight 2: M1, M2 in B; M1 in C): Asha 6 of 6; Bilal 4 of 6; Chitra 1 answer; 21CS04 2 answers
  // The share rests on the two counted: Asha 3 answers (6 of 6) and Bilal 3 (4 of 6) = 6 answers, 10 of 12.
  // Outside it, short of evidence: Chitra M1 (C) 1 = 2 of 2 and 21CS04 M1 1, M2 0 (B) = 2 of 4: 3 answers, 4 of 6.
  const co3 = coOf(b, 'CO3');
  check('CO3, weight 2: Asha 6 of 6, Bilal 4 of 6 (66.7%) attained; Chitra and 21CS04 under 3 answers: 2 of 2, level 3',
    same(counts(coOf(studentRow(report, '21CS01'), 'CO3')), ['attained', 3, 6, 6])
    && same(counts(coOf(studentRow(report, '21CS02'), 'CO3')), ['attained', 3, 4, 6])
    && same(counts(coOf(studentRow(report, '21CS04'), 'CO3')), ['not-enough-evidence', 2, 2, 4])
    && same(co3?.students, { roster: 5, counted: 2, attained: 2, notAttained: 0, notEnoughEvidence: 3, withNoAnswers: 1 })
    && co3?.attainmentLevel === 3
    && same([co3?.marks?.digital?.answers, co3?.marks?.digital?.obtained, co3?.marks?.digital?.possible], [6, 10, 12])
    && same([co3?.outside?.notEnoughEvidence?.students, co3?.outside?.notEnoughEvidence?.answers,
      co3?.outside?.notEnoughEvidence?.marks?.digital?.obtained, co3?.outside?.notEnoughEvidence?.marks?.digital?.possible], [2, 3, 4, 6])
    && /Rests on 6 counted answers from the 2 students counted: 6 digital\. Outside the share: 3 counted answers from 2 students with not enough evidence\./
      .test(co3?.summary ?? ''), JSON.stringify([co3?.students, co3?.marks?.digital, co3?.summary]));
  check('each outcome says what it is mapped to', same(b.outcomes?.map((o) => [o.code, o.topics?.map((t) => [t.topic, t.weight])]),
    [['CO1', [['Processes', 1]]], ['CO2', [['Scheduling', 1]]], ['CO3', [['Memory', 2]]]]));
  // Bloom. Remember: Asha 7 of 7, Bilal 5 of 7, Chitra 4 of 5, 21CS04 4 of 5: 4 of 4, level 3.
  // Apply: Asha 3 of 4, Bilal 1 of 4, 21CS04 1 of 4, Chitra one answer: 1 of 3, level 0.
  // Create: only written answers, none of them three: nobody counted, no level.
  const band = (id) => b.bloom?.bands?.find((x) => x.id === id);
  check('Bloom bands: lower 4 of 4 (level 3), middle 1 of 3 (level 0), higher nobody counted (no level)',
    band('lower')?.students?.counted === 4 && band('lower')?.attainmentLevel === 3
    && band('middle')?.students?.counted === 3 && band('middle')?.students?.attained === 1 && band('middle')?.attainmentLevel === 0
    && band('higher')?.students?.counted === 0 && band('higher')?.attainmentLevel === null,
    JSON.stringify(b.bloom?.bands?.map((x) => [x.id, x.students?.counted, x.attainmentLevel])));
}

{
  const m = b.methodology ?? '';
  check('the methodology: the default example, not a standard; 60%; 3 answers; every level; provisional marks not counted; records apart',
    m.startsWith('No formula has been saved for this class, so this report uses "Example: 60% of marks; levels at 50 / 60 / 70% of students"')
    && m.includes('not as an institutional standard')
    && m.includes('at least 60% of the marks on the questions mapped to it')
    && m.includes('Students with fewer than 3 such answers on an outcome are shown as not enough evidence, never as not attained.')
    && m.includes('level 3 from 70%, level 2 from 60%, level 1 from 50% and level 0 below 50%')
    && m.includes('Written answers given only a provisional machine mark (a keyword match against the rubric, not AI) and not yet '
      + 'reviewed are shown but not counted.')
    && m.includes('Only rooms opened for this class are counted')
    && m.includes('Teacher observations, wheel picks and hand tallies are reported in their own section and never enter a mark or move a level.')
    && m.includes('a student\'s share is of the marks on the questions they were actually given'), m);
}

// ---------------------------------------------- teacher records beside --

{
  const obs = await post(`/api/session/${rooms.C.code}/observations`, {
    rollNo: '21CS03', kind: 'revision', note: 'Mixed up <b>ready</b> & blocked states',
  });
  const tally = await post(`/api/session/${rooms.A.code}/tallies`, { text: 'Which state waits for I/O?', counts: [2, 1, 0, 0] });
  const after = await get(reportPath);
  const strip = (x) => JSON.stringify([x.outcomes, x.bloom, x.answers, x.students?.map(({ records, ...s }) => s)]);
  check('an observation and a tally appear in their own section and move no figure',
    obs.status === 200 && tally.status === 201 && after.body.teacherRecords?.observations?.counts?.revision === 1
    && after.body.teacherRecords?.tallies?.hands === 3 && strip(after.body) === strip(b), `${obs.status} ${tally.status}`);
}
const final = await get(reportPath);

// ------------------------------------------------------ 5. the CSV files --

console.log('\n5. the sheets: each the JSON of the same query');

/** A sheet read back: its leading rows by label, then each table by its title, rows keyed by column name. */
function readSheet(text) {
  const rows = parseCsv(text).records.map((r) => r.cells);
  const blank = (r) => r.length === 1 && r[0] === '';
  const meta = new Map();
  let i = 0;
  for (; i < rows.length && !blank(rows[i]); i += 1) meta.set(rows[i][0], rows[i][1]);
  const tables = new Map();
  while (i < rows.length) {
    if (blank(rows[i])) { i += 1; continue; }
    const title = rows[i][0];
    const header = rows[i + 1] ?? [];
    const body = [];
    for (i += 2; i < rows.length && !blank(rows[i]); i += 1) body.push(Object.fromEntries(header.map((h, k) => [h, rows[i][k]])));
    tables.set(title, { header, rows: body });
  }
  return { meta, tables };
}
const num = (cell) => (cell === '' || cell === undefined ? null : Number(cell));
const pctOf = (share) => (share === null ? null : Math.round(share * 10000) / 100);
/** What a name looks like in a sheet: as written, or with the guard's apostrophe when it starts like a formula. */
const asSheet = (text) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);
const FILENAME = (kind, ext) => new RegExp(`^bloomloop-${kind}-operating-systems-ty-cs-a-[0-9a-f]{8}-\\d{4}-\\d{2}-\\d{2}\\.${ext}$`);
const nameIn = (disposition) => /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? '';

const csv = await file(`${reportPath}?format=csv`);
const sheet = readSheet(csv.text);
{
  check('the attainment sheet: 200, text/csv in UTF-8, an attachment named for the class and the day, never cached',
    csv.status === 200 && csv.headers.get('content-type') === 'text/csv; charset=utf-8'
    && /^attachment; filename="/.test(csv.headers.get('content-disposition') ?? '')
    && FILENAME('attainment', 'csv').test(nameIn(csv.headers.get('content-disposition'))) && csv.headers.get('cache-control') === 'no-store',
    `${csv.status} ${csv.headers.get('content-type')} ${csv.headers.get('content-disposition')}`);
  check('it starts with the UTF-8 byte-order mark and ends every row with CRLF',
    csv.bytes[0] === 0xef && csv.bytes[1] === 0xbb && csv.bytes[2] === 0xbf && csv.text.endsWith('\r\n')
    && !csv.text.replace(/\r\n/g, '').includes('\n') && !csv.text.replace(/\r\n/g, '').includes('\r'));
  check('its leading rows give the class, the period, the rooms, the formula and the methodology exactly as the JSON',
    sheet.meta.get('Class') === 'Operating Systems' && sheet.meta.get('Section') === 'TY-CS A'
    && sheet.meta.get('Period') === 'Every room of the class (no dates or rooms chosen)'
    && Number(sheet.meta.get('Rooms counted')) === 3 && [rooms.A.code, rooms.B.code, rooms.C.code].every((c) => sheet.meta.get('Rooms').includes(c))
    && sheet.meta.get('Methodology') === final.body.methodology && sheet.meta.get('Formula version') === '0'
    && /no formula has been saved/i.test(sheet.meta.get('Formula') ?? '')
    && sheet.meta.get('Formula, exactly as stored') === JSON.stringify(final.body.formula.config)
    && sheet.meta.get('Formula: Student threshold') === '60% of the marks possible');
  check('and say how the guard works', /begins with =, \+, -, @, a tab or a carriage return/.test(sheet.meta.get('Formula guard') ?? '')
    && /after a semicolon or a tab inside a cell/.test(sheet.meta.get('Formula guard') ?? ''));
  check('and how to keep roll numbers exactly: import them as text',
    /Data > From Text\/CSV, then set the Roll No column's type to Text/.test(sheet.meta.get('Roll numbers') ?? '')
    && sheet.meta.get('Roll numbers not on the roster') === final.body.rollNotes.map((n) => n.note).join(' ')
    && /^VISIT9 is not on the class roster, so its answers in [A-Z0-9]+ are listed apart/.test(sheet.meta.get('Roll numbers not on the roster') ?? ''));

  const cls = sheet.tables.get('Course outcomes: the class');
  const rowsOk = final.body.outcomes.every((o, i) => {
    const r = cls?.rows?.[i];
    return r?.['Course outcome'] === o.code && r?.Statement === o.statement
      && num(r?.['Students on the roster']) === o.students.roster && num(r?.['Counted (attained or not attained)']) === o.students.counted
      && num(r?.Attained) === o.students.attained && num(r?.['Not enough evidence']) === o.students.notEnoughEvidence
      && num(r?.['% of counted who attained']) === pctOf(o.share) && num(r?.['Attainment level']) === o.attainmentLevel
      && num(r?.['Digital answers behind the share (counted)']) === o.marks.digital.answers
      && num(r?.['Provisional written answers behind the share (not counted)']) === o.marks.aiProvisional.answers
      && num(r?.['Reviewed written answers behind the share (counted)']) === o.marks.humanReviewed.answers
      && num(r?.['Their counted answers']) === o.outside.notEnoughEvidence.answers
      && num(r?.['Counted answers behind the share on offline-template questions (and professor-written before 19 Nov 2026)'])
        === o.marks.questionSources.offlineTemplate.answers && r?.Summary === o.summary;
  });
  check('each outcome\'s class row and level equal the JSON: CO1 75% level 3, CO2 33.33% level 0, CO3 100% level 3',
    rowsOk && cls.rows.length === 3 && same(cls.rows.map((r) => [r['% of counted who attained'], r['Attainment level']]),
      [['75', '3'], ['33.33', '0'], ['100', '3']]), JSON.stringify(cls?.rows?.map((r) => r['Attainment level'])));
  check('the statement holding "<script>" is kept as text in a CSV, and CO3 names its mapping with the weight',
    cls?.rows?.[1]?.Statement === STATEMENT.CO2 && cls?.rows?.[2]?.['Mapped to'] === 'Operating Systems: Unit 1 / Memory (weight 2)');

  const st = sheet.tables.get('Students by course outcome, in roll-number order (never ranked)');
  const cellsOk = final.body.students.every((s, i) => {
    const r = st?.rows?.[i];
    return r?.['Roll No'] === s.rollNo && r?.Name === asSheet(s.name) && r?.Status === s.statusLabel
      && s.outcomes.every((o) => r?.[`${o.code} state`] === o.stateLabel && num(r?.[`${o.code} answers counted`]) === o.answers
        && num(r?.[`${o.code} marks obtained`]) === o.obtained && num(r?.[`${o.code} marks possible`]) === o.possible
        && num(r?.[`${o.code} %`]) === pctOf(o.share)
        && num(r?.[`${o.code} provisional written answers (not counted)`]) === o.marks.aiProvisional.answers);
  });
  check('every student\'s cell on every outcome equals the JSON, students in the same roll order',
    cellsOk && st.rows.length === 6, `${st?.rows?.length}`);
  check('numbers are numbers: Asha\'s row is unquoted digits',
    csv.text.includes('\r\n21CS01,Asha Rao,On the roster,Attained,4,4,4,100,4,1,0,'), csv.text.split('\r\n').find((l) => l.startsWith('21CS01')));
  check('the injection guard: the roster name starting with "=" comes out quoted and prefixed, never as a formula',
    csv.text.includes(`,"'=HYPERLINK(""http://evil.invalid"",""Dev"")",`) && !/(^|,)"?=HYPERLINK/m.test(csv.text));
  check('the Devanagari name comes through as written', csv.text.includes(`\r\n21CS05,${MEERA},On the roster,`));
  const rec = sheet.tables.get('Teacher records: reported beside the marks, never part of one');
  check('the teacher records are a table of their own at class level, with no student in it',
    rec?.rows?.some((r) => r.Kind === 'Needs revision' && r.Count === '1') && rec?.rows?.some((r) => r.Kind === 'Hands raised, in all' && r.Count === '3')
    && !rec.rows.some((r) => /21CS0|Chitra/.test(JSON.stringify(r))));
}

{
  const bloom = await file(`${reportPath}?format=csv&sheet=bloom`);
  const s = readSheet(bloom.text);
  const t = s.tables.get('Bloom level bands and levels: the class');
  const figures = [...final.body.bloom.bands, ...final.body.bloom.levels];
  check('the Bloom sheet: the three bands then the six levels, each class row equal to the JSON',
    bloom.status === 200 && FILENAME('bloom-attainment', 'csv').test(nameIn(bloom.headers.get('content-disposition')))
    && t?.rows?.length === 9 && figures.every((f, i) => t.rows[i]['Band or level'] === f.label
      && num(t.rows[i]['Counted (attained or not attained)']) === f.students.counted && num(t.rows[i]['Attainment level']) === f.attainmentLevel
      && num(t.rows[i]['% of counted who attained']) === pctOf(f.share))
    && t.rows[2]['Attainment level'] === '' && s.meta.get('Methodology') === final.body.methodology,
    `${bloom.status} ${t?.rows?.length}`);
  const st = s.tables.get('Students by Bloom level band and level, in roll-number order (never ranked)');
  check('and each student\'s band and level cells equal the JSON',
    final.body.students.every((stu, i) => [...stu.bloom.bands, ...stu.bloom.levels].every((c) => st?.rows?.[i]?.[`${c.label} state`] === c.stateLabel
      && num(st.rows[i][`${c.label} marks obtained`]) === c.obtained && num(st.rows[i][`${c.label} marks possible`]) === c.possible)));
}

const register = await get(`/api/classes/${classId}/register`);
{
  const reg = await file(`/api/classes/${classId}/register?format=csv`);
  const s = readSheet(reg.text);
  const t = s.tables.get('Marks register, in roll-number order (never ranked)');
  const row = (roll) => t?.rows?.find((r) => r['Roll No'] === roll);
  const cell = (roll, room, field) => row(roll)?.[`${rooms[room].code} ${{ A: '2026-11-03', B: '2026-11-10', C: '2026-11-17' }[room]} ${field}`];
  // By hand: Asha 4/4, 4/5, 2/2 = 10 of 11; Bilal 2/4, 3/5, 2/3 (the reviewed 1) = 7 of 12;
  // Chitra 3/4, absent, 1/2 = 4 of 6; 21CS04 3/4, 2/5, absent = 5 of 9; Meera absent from all.
  check('the register sheet: totals by hand (10 of 11, 7 of 12, 4 of 6, 5 of 9, nothing), equal to the JSON',
    reg.status === 200 && FILENAME('register', 'csv').test(nameIn(reg.headers.get('content-disposition')))
    && same(['21CS01', '21CS02', '21CS03', '21CS04', '21CS05'].map((r) => [row(r)?.['Total marks obtained'], row(r)?.['Total marks possible']]),
      [['10', '11'], ['7', '12'], ['4', '6'], ['5', '9'], ['0', '0']])
    && register.body.students.every((stu) => num(row(stu.rollNo)?.['Total marks obtained']) === stu.total.counted.obtained
      && num(row(stu.rollNo)?.['Total marks possible']) === stu.total.counted.possible), `${reg.status}`);
  check('absent is not zero: Chitra in room B is "Absent", 0 of 0, with no percentage; the register says why',
    cell('21CS03', 'B', 'attendance') === 'Absent' && cell('21CS03', 'B', 'marks possible') === '0' && cell('21CS03', 'B', '%') === ''
    && row('21CS05')?.Absent === '3' && /not a zero/.test(s.meta.get('No answers in a room') ?? '')
    && s.meta.get('Methodology') === register.body.methodology);
  check('the visitor has no attendance mark, and the register names no room weights or thresholds',
    cell('VISIT9', 'A', 'attendance') === '' && cell('VISIT9', 'A', 'marks obtained') === '4' && !s.meta.has('Formula: Student threshold'));
}

{
  const list = await file(`/api/classes/${classId}/outcomes?format=csv`);
  const json = await get(`/api/classes/${classId}/outcomes`);
  const s = readSheet(list.text);
  const t = s.tables.get('Course outcomes and what they are mapped to');
  check('the outcome list: one row per outcome and topic, equal to the JSON, with the formula in force',
    list.status === 200 && FILENAME('outcomes', 'csv').test(nameIn(list.headers.get('content-disposition')))
    && same(t?.rows?.map((r) => [r['Course outcome'], r.Statement, r['Mapped by'], r.Topic, r['Topic weight']]),
      json.body.outcomes.map((o) => [o.code, o.statement, 'Topic', o.topics[0].topic, String(o.topics[0].weight)]))
    && t.rows[2]['Target Bloom level'] === 'Analyse' && s.meta.get('Methodology') === final.body.methodology,
    `${list.status} ${JSON.stringify(t?.rows?.map((r) => r['Course outcome']))}`);
}

// ------------------------------------------------- 6. the printable pages --

console.log('\n6. the printable pages');

/** Nothing a page could load or run. */
const selfContained = (text) => !/<script|<img|<link|<iframe|<object|<embed|@import|url\(|\ssrc=|\shref=/i.test(text);

const page = await file(`${reportPath}?format=html`);
{
  const h = page.text;
  check('the attainment page: 200, text/html in UTF-8, shown inline under the class\'s filename, never cached, its own policy',
    page.status === 200 && page.headers.get('content-type') === 'text/html; charset=utf-8'
    && /^inline; filename="/.test(page.headers.get('content-disposition') ?? '')
    && FILENAME('attainment', 'html').test(nameIn(page.headers.get('content-disposition')))
    && page.headers.get('cache-control') === 'no-store' && /default-src 'none'/.test(page.headers.get('content-security-policy') ?? '')
    && h.startsWith('<!doctype html>') && h.includes('<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;'),
    `${page.status} ${page.headers.get('content-type')}`);
  check('self-contained: no script, image, stylesheet link, frame or font fetched', selfContained(h));
  check('the "<script>" in CO2\'s statement is printed as text', h.includes(escapeHtml(STATEMENT.CO2)) && h.includes('&lt;script&gt;alert(&quot;co2&quot;)'));
  check('the "=" name is printed as text, escaped', h.includes(escapeHtml(HYPER)) && h.includes(MEERA));
  check('it shows the class, the period, every room, the formula and the methodology paragraph',
    h.includes('Operating Systems, TY-CS A, Sem V') && h.includes('Every room of the class (no dates or rooms chosen)')
    && [rooms.A.code, rooms.B.code, rooms.C.code].every((c) => h.includes(c))
    && h.includes(escapeHtml('"Example: 60% of marks; levels at 50 / 60 / 70% of students". No formula has been saved'))
    && h.includes(escapeHtml(final.body.methodology)));
  check('the evidence types apart: digital, provisional, reviewed, polls and teacher records, each with its count and whether it counts',
    h.includes('<td>Digital answers</td>') && h.includes('<td>Provisional machine marks</td>') && h.includes('<td>Reviewed by a professor</td>')
    && h.includes('<td class="n">41</td><td>Counted</td>') && h.includes('<td class="n">2</td><td>Shown, not counted</td>')
    && h.includes('Never counted: reported in their own section'));
  check('levels and states say themselves in words, colour or not; "not enough evidence" is counted',
    h.includes('<span class="badge lv-3">Level 3</span>') && h.includes('<span class="badge lv-0">Level 0</span>')
    && h.includes('No level: nobody counted') && h.includes('>Not enough evidence</span>')
    && h.includes(escapeHtml(final.body.outcomes[0].summary)));
  check('a separate, labelled section for teacher records', h.includes('<h2>Teacher records</h2>')
    && h.includes('Teacher records: reported beside the marks, never part of one'));
  const matrix = h.slice(h.indexOf('<h2>Students by course outcome</h2>'));
  const at = ['21CS01', '21CS02', '21CS03', '21CS04', '21CS05', 'VISIT9'].map((r) => matrix.indexOf(`<td>${r}</td>`));
  // "never ranked" is said on the page; a rank column or a label is what must not be.
  check('students in roll order, never numbered or ranked', at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1]))
    && !/<th>(rank|position|#)|slow learner|topper|weak student/i.test(h), JSON.stringify(at));
  check('print rules: A4, a page break per part, repeated table headers, landscape matrices',
    h.includes('@page { size: A4;') && h.includes('break-before: page') && h.includes('thead { display: table-header-group; }')
    && h.includes('@page wide { size: A4 landscape;'));
}
{
  const p = await file(`/api/classes/${classId}/attainment/students/${studentId('21CS03')}?format=html`);
  const h = p.text;
  check('Chitra\'s printable report: her outcomes, her answers with their types, her observation note escaped, apart',
    p.status === 200 && FILENAME('student-report', 'html').test(nameIn(p.headers.get('content-disposition')))
    && !nameIn(p.headers.get('content-disposition')).includes('21cs03') && selfContained(h)
    && h.includes('21CS03 Chitra Iyer') && h.includes('Course outcomes: 0 attained, 1 not attained, 2 not enough evidence.')
    && h.includes('Shown, not counted: the formula does not count provisional machine marks.')
    && h.includes('Mixed up &lt;b&gt;ready&lt;/b&gt; &amp; blocked states') && h.includes('Needs revision'), `${p.status}`);
}
{
  const p = await file(`/api/classes/${classId}/register?format=html`);
  const h = p.text;
  check('the printable register: absent is "No answers" with its mark, the register\'s own methodology, records said apart',
    p.status === 200 && FILENAME('register', 'html').test(nameIn(p.headers.get('content-disposition'))) && selfContained(h)
    && h.includes('<td>No answers<small>Absent</small></td>') && h.includes(escapeHtml(register.body.methodology))
    && h.includes('Not part of the register.') && h.includes(escapeHtml(HYPER)), `${p.status}`);
}

// -------------------------------------- 7. the same query, the same file --

console.log('\n7. a changed formula and narrower queries: the file follows the JSON');
{
  const saved = await put(`/api/classes/${classId}/attainment/config`, { config: { studentThreshold: 0.5 } });
  const json = await get(reportPath);
  const s = readSheet((await file(`${reportPath}?format=csv`)).text);
  const st = s.tables.get('Students by course outcome, in roll-number order (never ranked)');
  // At 50%, Chitra's 2 of 4 on CO1 attains: CO1 4 of 4.
  check('a 50% threshold saved as version 1: Chitra attains CO1 in the JSON and in the sheet, which names version 1',
    saved.body.formula?.version === 1 && coOf(studentRow(json, '21CS03'), 'CO1')?.state === 'attained'
    && st?.rows?.find((r) => r['Roll No'] === '21CS03')?.['CO1 state'] === 'Attained' && s.meta.get('Formula version') === '1'
    && s.meta.get('Methodology') === json.body.methodology && /at least 50% of the marks/.test(s.meta.get('Methodology') ?? ''),
    `${saved.status} ${saved.body.error ?? ''}`);
}
for (const query of [`rooms=${rooms.A.code},${rooms.B.code}`, 'from=2026-11-09', 'to=2026-11-10']) {
  const json = await get(`${reportPath}?${query}`);
  const s = readSheet((await file(`${reportPath}?${query}&format=csv`)).text);
  const cls = s.tables.get('Course outcomes: the class');
  check(`?${query}: the sheet counts the JSON's rooms and figures`,
    json.status === 200 && Number(s.meta.get('Rooms counted')) === json.body.rooms.length
    && json.body.rooms.every((r) => s.meta.get('Rooms').includes(r.code)) && s.meta.get('Period') !== 'Every room of the class (no dates or rooms chosen)'
    && json.body.outcomes.every((o, i) => num(cls?.rows?.[i]?.Attained) === o.students.attained
      && num(cls.rows[i]['Attainment level']) === o.attainmentLevel), `${json.status} ${json.body.rooms?.length}`);
}
{
  const json = await get(`${reportPath}?rooms=${rooms.A.code},${rooms.B.code}`);
  check('rooms A and B alone hold 35 answers', json.body.answers?.rows === 35, `${json.body.answers?.rows}`);
}

// ---------------------------------------------------------- 8. who may --

console.log('\n8. who may fetch the files');
{
  const paths = [
    `${reportPath}?format=csv`, `${reportPath}?format=csv&sheet=bloom`, `${reportPath}?format=html`,
    `/api/classes/${classId}/register?format=csv`, `/api/classes/${classId}/register?format=html`,
    `/api/classes/${classId}/attainment/students/${studentId('21CS01')}?format=html`, `/api/classes/${classId}/outcomes?format=csv`,
  ];
  const nowhere = (p) => p.replace(classId, NOWHERE);
  let alike = 0;
  for (const p of paths) {
    const [mine, none] = [await file(p, 'profB'), await file(nowhere(p), 'profB')];
    if (mine.status === 404 && none.status === 404 && mine.body.error === none.body.error && mine.body.error === 'That class was not found.') alike += 1;
  }
  check('another professor gets "That class was not found." on all seven, word for word as for no class at all', alike === paths.length, `${alike}`);
  const hod = await Promise.all(paths.map((p) => file(p, 'hod')));
  check('the HOD of the department fetches all seven', hod.every((r) => r.status === 200), hod.map((r) => r.status).join());
  check('an HOD of another department gets the 404', (await file(paths[0], 'hodOther')).status === 404);
  const asStudent = await Promise.all(paths.map((p) => file(p, 'student')));
  const anon = await Promise.all(paths.map((p) => file(p, null)));
  check('a student account gets 403 on every one', asStudent.every((r) => r.status === 403), asStudent.map((r) => r.status).join());
  check('no credentials get 401 on every one', anon.every((r) => r.status === 401), anon.map((r) => r.status).join());

  const bad = await Promise.all([
    file(`${reportPath}?format=pdf`), file(`${reportPath}?format=csv&sheet=marks`), file(`${reportPath}?sheet=bloom`),
    file(`/api/classes/${classId}/attainment/students/${studentId('21CS01')}?format=csv`), file(`/api/classes/${classId}/outcomes?format=html`),
  ]);
  check('a format or sheet a route does not offer is a 400 that says which it does',
    bad.every((r) => r.status === 400) && /format must be one of json, csv, html/.test(bad[0].body.error ?? ''), bad.map((r) => r.status).join());
  check('and an outsider asking for one still gets the class\'s 404', (await file(`${reportPath}?format=pdf`, 'profB')).status === 404);

  // The shared key opens the files of a class nobody owns, from the x-teacher-key header only: a key in a
  // page's or a sheet's address would be printed on the page and kept in the browser's history.
  const KEY = config.teacherKey;
  const keyed = await realFetch(`${base}/api/classes`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-teacher-key': KEY },
    body: JSON.stringify({ courseName: 'Shared Key Course', section: 'X' }),
  }).then((r) => r.json());
  const keyId = keyed.class?.id;
  const keyPath = `/api/classes/${keyId}/attainment`;
  const byHeader = await call('GET', `${keyPath}?format=html`, { as: null, raw: true, headers: { 'x-teacher-key': KEY } });
  const pageByKey = await file(`${keyPath}?format=html&key=${encodeURIComponent(KEY)}`, null);
  const sheetByKey = await file(`${keyPath}?format=csv&key=${encodeURIComponent(KEY)}`, null);
  const registerByKey = await file(`/api/classes/${keyId}/register?format=csv&key=${encodeURIComponent(KEY)}`, null);
  const jsonByKey = await file(`${keyPath}?key=${encodeURIComponent(KEY)}`, null);
  const wrongKey = await file(`${keyPath}?format=html&key=WRONG`, null);
  const keyOnMine = await file(`${reportPath}?format=html&key=${encodeURIComponent(KEY)}`, null);
  check('the shared key in the header opens the page of a class nobody owns',
    Boolean(keyId) && byHeader.status === 200 && /^text\/html/.test(byHeader.headers.get('content-type') ?? ''), `${byHeader.status}`);
  check('in a page\'s or a sheet\'s address it is a 400 that says to send the header, and no file; JSON is not refused',
    [pageByKey, sheetByKey, registerByKey].every((r) => r.status === 400 && /x-teacher-key header/.test(r.body.error ?? '')
      && !/^text\/(html|csv)/.test(r.headers.get('content-type') ?? ''))
    && jsonByKey.status === 200, `${pageByKey.status} ${sheetByKey.status} ${registerByKey.status} ${jsonByKey.status}`);
  check('a wrong key is 401, and the key never reaches a professor\'s class', wrongKey.status === 401 && keyOnMine.status === 404,
    `${wrongKey.status} ${keyOnMine.status}`);
}

// -------------------------------------------------------- 9. privacy --

console.log('\n9. nothing reaches a phone or the projector');
{
  // Give any stray broadcast time to arrive before reading what was received.
  await new Promise((r) => setTimeout(r, 300));
  const publicRead = await Promise.all(Object.values(rooms).map((r) => get(`/api/session/${r.code}`, null)));
  const LEAK = /attain|methodology|evidenceType|studentThreshold|not enough evidence|notEnoughEvidence|\bregister\b|\bCO[123]\b|bloomloop-|text\/csv|<!doctype|HYPERLINK|operating system manages processes|alert\(|memory allocation|Mixed up/i;
  const phones = JSON.stringify([phoneSaw, publicRead.map((r) => r.body)]);
  check(`no phone payload (${phoneSaw.length} of them, one phone still connected) and no public room read carries any of it`,
    phoneSaw.length > 40 && stayingPhone.connected && !LEAK.test(phones), (LEAK.exec(phones) ?? [])[0]);
  check(`the projector (${wallSaw.length} payloads, still connected) was sent only its own screen, none of it`,
    wallSaw.length > 3 && wall.connected && wallSaw.every((e) => e.event.startsWith('projector:')) && !LEAK.test(JSON.stringify(wallSaw)),
    (LEAK.exec(JSON.stringify(wallSaw)) ?? [])[0]);
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
stayingPhone.disconnect();
wall.disconnect();
globalThis.fetch = realFetch;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
