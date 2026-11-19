// Phase 7 (decision O4) - laptop mode and the import back to the cloud, end to end.
//
//   node server/scripts/laptop.mjs
//
// The laptop is the real server, started the documented way (server/src/index.js
// --laptop) as its own process on a free port, with every network service blank
// in its environment and a preload that refuses any fetch it makes (counted in
// refusedOffMachine). The cloud is this process: a fresh server on the
// in-process store, with signed-in accounts answered by an in-process stand-in
// for Supabase Auth, as server/scripts/roster.mjs does. Checks:
//
//   laptop      the mode says so (in-process store, no model, no Supabase), and
//               says where its archives go; LAN origins are let in, others not,
//               for the API and the socket
//   a class     on the laptop with the shared key: a chapter, six questions
//               written by hand, a class of four with a course outcome, a room
//               for it; three phones join and answer, a class question with
//               votes, one student marked absent by hand
//   close       nothing is written before (the interval is an hour); the room's
//               file is there at once after the close, closed, and decodes to
//               what the laptop's own reports said
//   crash       a second laptop run with a one-second interval: a running room's
//               file appears without a close, the process is killed, and the
//               file is whole and imports as a room closed when it was saved
//   import      into the cloud by the professor, with her chapter and class: the
//               room, every answer, its class question and votes, and its
//               attendance read back through the existing reports (answers,
//               grid, attendance, topics, item statistics, class questions,
//               confidence, attainment, the marks register) exactly as the
//               laptop read them, ids aside; marked as imported (which laptop
//               run, when)
//   again       the same file again: 200, nothing changed, every report the same
//   who         no credentials 401, an HOD 403 (reads the list, imports nothing),
//               another professor 409 with the "from somewhere else" sentence; a
//               body that is not JSON, or too big, refused with a sentence
//   offline     (the Phase 7 parts together) a third laptop run: a phone takes a
//               question pack with no key in it; the console counts a hand with a
//               replay key, sent twice, once; the room closes with the phone
//               away; it comes back inside the grace window and sends a packed
//               answer (counted) and one it was never given (kept, not
//               counted); the laptop's file is saved again with both, the
//               phone's own times kept. Imported: both as the laptop kept them,
//               and the imported room takes no delivery, though the laptop's
//               close leaves its window open
//
// Never calls Gemini, Supabase or any network service. Exits non-zero on any failure.

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));
const { initStore, getRepo } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { decodeRoomArchive } = await import(`${SRC}services/archive.js`);
const { ELSEWHERE, IMPORTED_NOTE } = await import(`${SRC}services/roomImport.js`);
/** The imported-room note, as the server says it: never matched by its absence. */
const isNote = (n) => typeof n === 'string' && n.length > 0 && n === IMPORTED_NOTE;
const { lanAddresses } = await import(`${SRC}laptop.js`);
const { KEY_BLOCKED_MESSAGE, KEY_TRIES } = await import(`${SRC}teacherAuth.js`);
const {
  AFTER_CLOSE_DETAIL, DELIVER_IMPORTED_REASON, GRACE_MS, LATE_COUNTED_MESSAGE, LATE_NOT_SERVED_MESSAGE, keptNotCounted,
} = await import(`${SRC}services/offline.js`);

// The cloud stand-in: the in-process store and no model, whatever .env says.
config.supabase.url = '';
config.supabase.serviceKey = '';
config.supabase.anonKey = '';
config.mongoUri = '';
config.gemini.apiKey = '';
await initStore({ log: () => {} });
const repo = getRepo();

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` - ${String(detail).slice(0, 1500)}` : ''}`);
  if (ok) pass += 1; else fail += 1;
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------- the accounts stand-in --
//
// HOD (BIO) <- professor A, and professor B under another HOD.

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'd0000000-0000-4000-8000-000000000001',
  profA: 'd0000000-0000-4000-8000-000000000002',
  profB: 'd0000000-0000-4000-8000-000000000003',
  hodOther: 'd0000000-0000-4000-8000-000000000004',
};
const account = (id, role, department, reportsTo) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-LAPT0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: null, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'BIO', null),
  account(ID.profA, 'professor', 'BIO', ID.hod),
  account(ID.hodOther, 'hod', 'CHEM', null),
  account(ID.profB, 'professor', 'CHEM', ID.hodOther),
].map((a) => [a.id, a]));
const TOKENS = { hod: 'tok-hod', profA: 'tok-prof-a', profB: 'tok-prof-b' };
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
    throw new Error(`laptop.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by laptop.mjs: ${url.pathname}` }, 404);
};
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'laptop-test-service-key';

// -------------------------------------------------------------- servers --

// Laptop mode refuses a TEACHER_KEY under 16 characters (the review of 19 Nov 2026).
const KEY = 'LAPTOP-KEY-7-E2E-0001';

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

// Loaded into the laptop process before anything else: any fetch it makes (the
// Supabase client, the model's SDK) is refused and printed, for the count below.
const NO_NETWORK = `data:text/javascript,${encodeURIComponent(
  'globalThis.fetch = async (u) => { console.log("[laptop.mjs] refused a fetch to " + String(u && u.url ? u.url : u)); '
  + 'throw new Error("laptop mode reaches no network service"); };',
)}`;

/** The real server, in laptop mode, as its own process. Resolves once it prints its banner. */
async function startLaptop({ dir, seconds, key = KEY }) {
  const port = await freePort();
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(SUPABASE_|MONGO|GEMINI_|GOOGLE_|TEACHER_KEY$|CORS_ORIGINS$|PORT$|LAPTOP_|BLOOMLOOP_)/i.test(k)) delete env[k];
  }
  // Blank rather than absent, so server/.env (read by dotenv, which never
  // overrides a variable already set) cannot fill them in.
  Object.assign(env, {
    SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: '', MONGO_URI: '', GEMINI_API_KEY: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
    TEACHER_KEY: key, PORT: String(port), LAPTOP_ARCHIVE_DIR: dir, LAPTOP_ARCHIVE_SECONDS: String(seconds),
  });
  const child = spawn(process.execPath, ['--import', NO_NETWORK, ENTRY, '--laptop'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((r) => child.once('exit', r));
  for (let i = 0; i < 100 && !/LAPTOP MODE/.test(output) && child.exitCode === null; i += 1) await wait(100);
  if (!/={10,}\s*$/m.test(output)) await wait(200);
  return { child, port, base: `http://127.0.0.1:${port}`, output: () => output, exited };
}

async function stopLaptop(laptop) {
  if (laptop.child.exitCode === null) laptop.child.kill('SIGKILL');
  await laptop.exited;
  const refused = (laptop.output().match(/\[laptop\.mjs\] refused a fetch/g) ?? []).length;
  refusedOffMachine += refused;
}

async function startCloud() {
  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  attachSockets(io);
  app.set('io', io);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, io, base: `http://127.0.0.1:${server.address().port}` };
}

/** One request. `as`: 'key' (the laptop's shared key), a TOKENS name, or null. */
async function call(base, method, url, { body, as = 'key', raw, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (as === 'key') headers['x-teacher-key'] = KEY;
  else if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, headers: res.headers };
}

// ------------------------------------------------------------- sockets --

function connect(base, extra = {}) {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false, ...extra });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', (err) => { s.close(); reject(err); });
  });
}

function next(socket, event, match = () => true, ms = 5000) {
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

async function join(base, code, rollNo, name) {
  const s = await connect(base);
  const p = { s, rollNo, question: null };
  s.on('server:question', (q) => { p.question = q.question; });
  const accepted = next(s, 'session:accepted');
  const first = next(s, 'server:question');
  s.emit('student:join', { code, rollNo, name });
  p.accepted = await accepted;
  await first;
  return p;
}

let answerSeq = 0;
/** Answer the phone's question right or wrong (the key read from the laptop's bank), then ask for the next. */
async function answer(p, bank, right, { more = true } = {}) {
  const q = bank.get(String(p.question._id));
  let response;
  if (q.kind === 'truefalse') response = right ? q.answerBool : !q.answerBool;
  else response = right ? q.answerIdx : (q.answerIdx + 1) % q.options.length;
  answerSeq += 1;
  const result = next(p.s, 'server:result');
  p.s.emit('student:answer', { questionId: String(q._id), response, answerId: `lap-${answerSeq}-${p.rollNo}` });
  const r = await result;
  if (more) {
    const n = next(p.s, 'server:question');
    p.s.emit('student:next');
    await n;
  }
  return r;
}

/** A chapter with six approved questions written by hand, on whichever server. */
async function chapter(base, as, title) {
  const made = await call(base, 'POST', '/api/content', { body: { title, text: 'Cells\nEnergy' }, as });
  const contentId = made.body.contentId;
  const qs = [
    { topic: 'Cells', text: 'Which organelle releases energy from food?', kind: 'mcq', options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Vacuole'], answerIdx: 1 },
    { topic: 'Cells', text: 'Which organelle holds the cell\'s DNA?', kind: 'mcq', options: ['Nucleus', 'Golgi body', 'Lysosome', 'Cell wall'], answerIdx: 0 },
    { topic: 'Cells', text: 'Plant cells have a cell wall.', kind: 'truefalse', answerBool: true },
    { topic: 'Energy', text: 'Which molecule carries energy in the cell?', kind: 'mcq', options: ['DNA', 'Glucose', 'ATP', 'Water'], answerIdx: 2 },
    { topic: 'Energy', text: 'Respiration releases energy.', kind: 'truefalse', answerBool: true },
    { topic: 'Energy', text: 'Where does photosynthesis happen?', kind: 'mcq', options: ['Chloroplast', 'Nucleus', 'Ribosome', 'Vacuole'], answerIdx: 0 },
  ];
  const ids = [];
  for (const q of qs) {
    const r = await call(base, 'POST', `/api/bank/${contentId}/questions`, { body: { ...q, bloom: 'remember' }, as });
    ids.push(r.body.question?._id);
  }
  return { contentId, made, ids };
}

/** A class of four, with CO1 mapped to Cells once `mapTo` is a chapter. */
async function classOf(base, as) {
  const made = await call(base, 'POST', '/api/classes', { body: { courseName: 'Biology', section: 'A' }, as });
  const classId = made.body.class?._id ?? made.body.class?.id;
  const roster = await call(base, 'POST', `/api/classes/${classId}/students`, {
    body: { students: [{ roll: '23BIO01', name: 'Asha' }, { roll: '23BIO02', name: 'Ravi' }, { roll: '23BIO03', name: 'Meera' }, { roll: '23BIO04', name: 'Kabir' }] },
    as,
  });
  const co = await call(base, 'POST', `/api/classes/${classId}/outcomes`, { body: { code: 'CO1', statement: 'Describe the parts of a cell.', targetLevel: 'remember' }, as });
  return { classId, made, roster, outcomeId: co.body.outcome?._id ?? co.body.outcome?.id, co };
}

const mapOutcome = (base, as, classId, outcomeId, contentId) =>
  call(base, 'PUT', `/api/classes/${classId}/outcomes/${outcomeId}/topics`, { body: { topics: [{ contentId, topic: 'Cells' }] }, as });

/** Every report the existing routes give for one room and its class. */
async function reports(base, as, code, classId) {
  const get = async (url) => {
    const r = await call(base, 'GET', url, { as });
    return r.status === 200 ? r.body : { status: r.status, error: r.body.error };
  };
  return {
    answers: await get(`/api/session/${code}/answers?limit=200`),
    grid: await get(`/api/session/${code}/grid`),
    attendance: await get(`/api/session/${code}/attendance`),
    topics: await get(`/api/session/${code}/topics`),
    items: await get(`/api/session/${code}/items`),
    classQuestions: await get(`/api/session/${code}/class-questions`),
    confidence: await get(`/api/session/${code}/confidence`),
    attainment: await get(`/api/classes/${classId}/attainment`),
    register: await get(`/api/classes/${classId}/register`),
    room: await get(`/api/session/${code}`),
  };
}

/**
 * Each store's ids as the same tokens, so two reports of one room from two
 * stores compare exactly: the room, the chapter, the class, the roster's
 * students (by roll), the outcome (by code), the class questions (by place) and
 * the answers (by who, when and what). Report times ("generated at") go.
 */
function idTokens({ sessionId, contentId, classId, students, outcomes, classQuestions, answers }) {
  const map = new Map([[String(sessionId), 'ROOM'], [String(contentId), 'CHAPTER'], [String(classId), 'CLASS']]);
  for (const s of students ?? []) map.set(String(s._id ?? s.id), `STUDENT:${s.rollNo}`);
  for (const o of outcomes ?? []) map.set(String(o._id ?? o.id), `OUTCOME:${o.code}`);
  for (const c of classQuestions ?? []) map.set(String(c._id ?? c.id), `CQ:${c.seq}`);
  for (const a of answers ?? []) map.set(String(a.answerId), `ANSWER:${a.student.rollNo}:${a.answeredAt}:${JSON.stringify(a.response)}`);
  return map;
}
const DROP = new Set(['generatedAt', 'asOf', 'now']);
function normalise(value, map) {
  if (Array.isArray(value)) return value.map((v) => normalise(v, map));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([k]) => !DROP.has(k))
      .map(([k, v]) => [map.get(k) ?? k, normalise(v, map)]));
  }
  if (typeof value === 'string') {
    let out = map.get(value) ?? value;
    // An id inside a longer string (a link, a file name).
    for (const [id, token] of map) if (id.length >= 20 && out.includes(id)) out = out.split(id).join(token);
    return out;
  }
  return value;
}
/** The first path where two values differ, for a failure message. */
function firstDifference(a, b, where = '') {
  if (same(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference(a[k], b[k], `${where}.${k}`);
      if (d) return d;
    }
  }
  return `${where || '(top)'}: laptop ${JSON.stringify(a)?.slice(0, 300)} / cloud ${JSON.stringify(b)?.slice(0, 300)}`;
}

const made = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomloop-laptop-e2e-'));
  made.push(dir);
  return dir;
};
const filesIn = (dir) => fs.readdirSync(dir).sort();
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// ================================================================ laptop ==

console.log('\nlaptop mode: the real server, its own process, no network');

const folder = tempDir();
const laptop = await startLaptop({ dir: folder, seconds: 3600 });
const L = laptop.base;
const banner = laptop.output();
check('it starts and prints the laptop banner: the join address, where the archives go, what is unavailable',
  /LAPTOP MODE/.test(banner) && banner.includes(folder) && /Not available here:/.test(banner) && /every 3600 s/.test(banner), banner.slice(0, 2000));

const health = await call(L, 'GET', '/api/health', { as: null });
check('the in-process store, no model, no Supabase or Mongo configured',
  health.body.store === 'memory' && health.body.gemini === 'fallback' && health.body.supabase === 'not-configured' && health.body.mongo === 'not-configured',
  JSON.stringify(health.body));
const status = await call(L, 'GET', '/api/laptop');
check('the console is told it is a laptop: the folder, the interval, what is not available',
  status.body.laptop === true && status.body.archives?.folder === fs.realpathSync(folder) && status.body.archives?.intervalSeconds === 3600
  && status.body.unavailable?.length >= 3 && /^[0-9a-f]{8}$/.test(status.body.run ?? ''), JSON.stringify(status.body));
check('and only the console: no key, a 401', (await call(L, 'GET', '/api/laptop', { as: null })).status === 401);

// Origins: a page on this laptop's own address and port is let in; another
// device's address on the same network, on the same port, is not, nor is
// another site (the review of 19 Nov 2026: any private address used to pass).
{
  const own = lanAddresses()[0]?.address ?? 'localhost';
  const lan = `http://${own}:${laptop.port}`;
  // Another device on the hotspot: an address of the network that is not this laptop's.
  const strangerHost = lanAddresses().some((a) => a.address === '192.168.137.77') ? '192.168.137.78' : '192.168.137.77';
  const stranger = `http://${strangerHost}:${laptop.port}`;
  const ok = await call(L, 'GET', '/api/health', { as: null, headers: { origin: lan } });
  const other = await call(L, 'GET', '/api/health', { as: null, headers: { origin: stranger } });
  const evil = await call(L, 'GET', '/api/health', { as: null, headers: { origin: 'http://evil.example' } });
  check('the API lets this laptop\'s own address on this port in (CORS), and not another device\'s, nor another site',
    ok.headers.get('access-control-allow-origin') === lan && !other.headers.get('access-control-allow-origin')
    && !evil.headers.get('access-control-allow-origin'),
    `${ok.headers.get('access-control-allow-origin')} / ${other.headers.get('access-control-allow-origin')} / ${evil.headers.get('access-control-allow-origin')}`);
  const sock = await connect(L, { extraHeaders: { origin: lan } }).then((s) => { s.close(); return true; }, () => false);
  const near = await connect(L, { extraHeaders: { origin: stranger } }).then((s) => { s.close(); return true; }, () => false);
  const bad = await connect(L, { extraHeaders: { origin: 'http://evil.example' } }).then((s) => { s.close(); return true; }, () => false);
  check('and so does the socket: a page of this laptop connects, another device\'s or another site\'s does not',
    sock && !near && !bad, `${sock} ${near} ${bad}`);
}

// A short TEACHER_KEY: the console's only guard on a Wi-Fi the class has joined.
{
  const shortKey = await startLaptop({ dir: tempDir(), seconds: 3600, key: 'mango' });
  // A laptop that starts anyway is stopped below, never waited on for good.
  await Promise.race([shortKey.exited, wait(5000)]);
  check('a TEACHER_KEY under 16 characters stops laptop mode at the start, with a sentence that says what to do',
    shortKey.child.exitCode === 1 && /TEACHER_KEY is 5 characters, and laptop mode needs at least 16/.test(shortKey.output())
    && !/LAPTOP MODE/.test(shortKey.output()), shortKey.output().slice(0, 600));
  await stopLaptop(shortKey);
}

console.log('\na class on the laptop');

const lap = await chapter(L, 'key', 'Cells');
check('a chapter and six questions written by hand', lap.made.status === 201 && lap.ids.every(Boolean), JSON.stringify(lap.made.body));
const lapClass = await classOf(L, 'key');
check('a class of four with a course outcome', lapClass.made.status === 201 && lapClass.roster.body.added?.length === 4 && lapClass.outcomeId,
  JSON.stringify([lapClass.made.body, lapClass.roster.body, lapClass.co.body]).slice(0, 600));
const lapMap = await mapOutcome(L, 'key', lapClass.classId, lapClass.outcomeId, lap.contentId);
check('CO1 mapped to the Cells topic', lapMap.status === 200, JSON.stringify(lapMap.body));
const opened = await call(L, 'POST', '/api/session', { body: { contentId: lap.contentId, classId: lapClass.classId, startLevel: 'remember' } });
const code = opened.body.code;
check('a room for the class', opened.status === 200 && /^[A-Z0-9]{6}$/.test(code ?? ''), JSON.stringify(opened.body));

const bankBody = (await call(L, 'GET', `/api/bank/${lap.contentId}`)).body;
const bank = new Map((bankBody.questions ?? []).map((q) => [String(q._id), q]));
check('the professor\'s bank carries the keys the scripted phones answer from', bank.size === 6, JSON.stringify(bankBody).slice(0, 300));

const phones = [];
for (const [roll, name] of [['23BIO01', 'Asha'], ['23BIO02', 'Ravi'], ['23BIO03', 'Meera']]) phones.push(await join(L, code, roll, name));
const pattern = { '23BIO01': [true, true, false], '23BIO02': [false, true, true], '23BIO03': [true, false, false] };
for (const p of phones) {
  for (const right of pattern[p.rollNo]) await answer(p, bank, right);
}
check('three phones joined and answered three questions each', phones.every((p) => p.accepted?.code === code || p.accepted));

// A class question: every phone votes, the professor closes it with the key shown.
const cqQuestion = [...bank.values()].find((q) => q.kind === 'mcq');
const cqStarts = phones.map((p) => next(p.s, 'class:question'));
const started = await call(L, 'POST', `/api/session/${code}/class-questions`, { body: { questionId: String(cqQuestion._id) } });
const cqId = started.body.classQuestion?.id ?? started.body.classQuestion?._id ?? started.body.id;
await Promise.all(cqStarts);
check('a class question put to the class', started.status === 201 && cqId, JSON.stringify(started.body).slice(0, 400));
let vote = 0;
for (const [i, p] of phones.entries()) {
  vote += 1;
  const ack = next(p.s, 'class:vote');
  p.s.emit('student:vote', { classQuestionId: cqId, round: 1, response: i === 2 ? (cqQuestion.answerIdx + 1) % 4 : cqQuestion.answerIdx, answerId: `vote-${vote}-${p.rollNo}` });
  await ack;
}
const cqClosed = await call(L, 'POST', `/api/session/${code}/class-questions/${cqId}/close`, { body: { reveal: true } });
check('three votes, and the class question closed with its key shown', cqClosed.status === 200, JSON.stringify(cqClosed.body).slice(0, 300));

// Kabir never joined: the professor marks him absent.
const kabir = lapClass.roster.body.added.find((s) => s.rollNo === '23BIO04');
const marked = await call(L, 'POST', `/api/session/${code}/attendance`, { body: { marks: [{ studentId: kabir.id ?? kabir._id, status: 'absent' }] } });
check('one student marked absent by hand', marked.status === 200, JSON.stringify(marked.body).slice(0, 300));

check('nothing is written before the room closes: the interval is an hour', filesIn(folder).length === 0, filesIn(folder).join(', '));

console.log('\nthe room closes');

const closing = await call(L, 'POST', `/api/session/${code}/close`, {});
check('the room closes', closing.status === 200 && closing.body.session?.status === 'closed');
let files = [];
for (let i = 0; i < 40 && !(files = filesIn(folder)).length; i += 1) await wait(50);
const sessionId = String(opened.body.sessionId);
const fileName = `room-${code}-${sessionId}.json`;
check('its file is there at once, named after the room, and nothing else is in the folder', same(files, [fileName]), files.join(', '));
const saved = files.length ? readJson(path.join(folder, fileName)) : {};
check('the file is the room\'s archive, closed, with the laptop\'s run',
  saved.format === 'bloomloop.room-archive' && saved.room?.status === 'closed' && saved.laptop?.run === status.body.run
  && saved.laptop?.startedAt === status.body.startedAt, JSON.stringify(saved.laptop));
const decoded = saved.format ? decodeRoomArchive(saved) : { answers: [], attendance: [], classQuestions: [] };
check('it holds every answer (9 of their own and 3 votes), the class question, and all four attendance marks',
  decoded.answers.length === 12 && decoded.classQuestions.length === 1 && decoded.attendance.length === 4,
  JSON.stringify([decoded.answers.length, decoded.classQuestions.length, decoded.attendance.length]));

for (const p of phones) p.s.close();
await wait(300);
const lapReports = await reports(L, 'key', code, lapClass.classId);
const lapStudents = lapClass.roster.body.added;
const lapOutcomes = [{ _id: lapClass.outcomeId, code: 'CO1' }];
check('the laptop\'s own reports read the room', lapReports.answers.items?.length === 12 && lapReports.grid && lapReports.attainment?.status === undefined,
  JSON.stringify(Object.fromEntries(Object.entries(lapReports).map(([k, v]) => [k, v?.status ?? 'ok']))));

await stopLaptop(laptop);

// ============================================================ crash ======

console.log('\na crash while a room runs (one-second interval)');

const crashFolder = tempDir();
const crashLaptop = await startLaptop({ dir: crashFolder, seconds: 1 });
const C = crashLaptop.base;
const crashChapter = await chapter(C, 'key', 'Cells');
const crashRoom = await call(C, 'POST', '/api/session', { body: { contentId: crashChapter.contentId, startLevel: 'remember' } });
const crashBank = new Map(((await call(C, 'GET', `/api/bank/${crashChapter.contentId}`)).body.questions ?? []).map((q) => [String(q._id), q]));
const crashPhones = [await join(C, crashRoom.body.code, '23BIO01', 'Asha'), await join(C, crashRoom.body.code, '23BIO02', 'Ravi')];
for (const p of crashPhones) { await answer(p, crashBank, true); await answer(p, crashBank, false, { more: false }); }
const crashFile = path.join(crashFolder, `room-${crashRoom.body.code}-${crashRoom.body.sessionId}.json`);
let crashSaved = null;
for (let i = 0; i < 60; i += 1) {
  if (fs.existsSync(crashFile)) {
    crashSaved = readJson(crashFile);
    if (decodeRoomArchive(crashSaved).answers.length === 4) break;
  }
  await wait(100);
}
check('a running room\'s file appears on the interval, without a close, with every answer so far',
  crashSaved?.room?.status === 'open' && decodeRoomArchive(crashSaved).answers.length === 4, crashSaved ? JSON.stringify(crashSaved.room) : 'no file');
for (const p of crashPhones) p.s.close();
crashLaptop.child.kill('SIGKILL');
await crashLaptop.exited;
await stopLaptop(crashLaptop);
let afterCrash = null;
try { afterCrash = readJson(crashFile); } catch { /* checked below */ }
check('after the process is killed the file is whole, and no temporary file is left',
  afterCrash && decodeRoomArchive(afterCrash).answers.length === 4 && same(filesIn(crashFolder), [path.basename(crashFile)]), filesIn(crashFolder).join(', '));

// ===================================================== offline, on a laptop ==
//
// The three Phase 7 parts meet here: a laptop room hands out question packs and
// honours the grace window after its close (the live loop is the same server),
// the console's replay keys work on the laptop's store, and the file the laptop
// saves carries what arrived after the close.

console.log('\noffline on the laptop: a pack, a replayed count, answers sent after the close (one-second interval)');

/** The first reply about one answer (server:result, server:kept or server:refused), found by its answerId. */
function sendSaved(s, { questionId, response, answerId, deviceAnsweredAt }) {
  const mine = (r) => r?.answerId === answerId;
  const reply = Promise.race(['server:result', 'server:kept', 'server:refused']
    .map((event) => next(s, event, mine).then((r) => ({ event, ...r }))));
  s.emit('student:answer', { questionId, response, answerId, deviceAnsweredAt });
  return reply;
}
const rightFor = (q) => (q.kind === 'truefalse' ? q.answerBool : q.answerIdx);

const graceFolder = tempDir();
const graceLaptop = await startLaptop({ dir: graceFolder, seconds: 1 });
const G = graceLaptop.base;
const graceChapter = await chapter(G, 'key', 'Cells');
// Two levels above where the room starts: never packed for a student at
// Remember, so never given to the phone below before the close.
const applyMade = await call(G, 'POST', `/api/bank/${graceChapter.contentId}/questions`, {
  body: {
    topic: 'Energy', text: 'A cell respires 2 glucose molecules, each giving 38 ATP. How many ATP is that?', kind: 'numeric', value: 76,
    tolerance: 0, unit: 'ATP', bloom: 'apply',
  },
});
const applyId = String(applyMade.body.question?._id ?? '');
const graceRoom = await call(G, 'POST', '/api/session', { body: { contentId: graceChapter.contentId, startLevel: 'remember' } });
const graceCode = graceRoom.body.code;
const graceBank = new Map(((await call(G, 'GET', `/api/bank/${graceChapter.contentId}`)).body.questions ?? []).map((q) => [String(q._id), q]));
check('a room on a chapter of seven questions, one of them at Apply',
  graceRoom.status === 200 && graceBank.size === 7 && graceBank.get(applyId)?.bloom === 'apply', JSON.stringify(applyMade.body).slice(0, 300));

const asha = await join(G, graceCode, '23BIO01', 'Asha');
const pinnedId = String(asha.question?._id ?? '');
const packReply = next(asha.s, 'server:pack');
asha.s.emit('student:pack', {});
const pack = await packReply.catch(() => ({}));
const packIds = (pack.questions ?? []).map((p) => String(p.question?._id ?? ''));
check('the laptop hands the phone a pack: five Remember questions, not the one on its screen, not the Apply one',
  packIds.length === 5 && packIds.every((id) => graceBank.get(id)?.bloom === 'remember') && !packIds.includes(pinnedId)
  && !packIds.includes(applyId), JSON.stringify(pack).slice(0, 600));
check('with no key in it: no answer, no rubric, nothing to mark with',
  pack.questions?.length > 0 && !/"(answerIdx|answerBool|rubric|misconceptions)"/.test(JSON.stringify(pack)), JSON.stringify(pack).slice(0, 600));

// The console counts a hand with a replay key, and its outbox sends it again.
const graceTally = await call(G, 'POST', `/api/session/${graceCode}/tallies`, { body: { text: 'Who has seen a cell under a microscope?' } });
const tallyStep = () => call(G, 'POST', `/api/session/${graceCode}/tallies/${graceTally.body.tally?.id}/increment`, {
  body: { option: 'A' }, headers: { 'idempotency-key': 'laptop-tally-0001' },
});
const stepOnce = await tallyStep();
const stepAgain = await tallyStep();
const talliesNow = (await call(G, 'GET', `/api/session/${graceCode}/tallies`)).body.tallies ?? [];
check('the console\'s replay key works on the laptop: the hand is counted once, the repeat answered from the kept reply',
  graceTally.status === 201 && stepOnce.status === 200 && stepAgain.status === 200 && stepAgain.headers.get('idempotent-replayed') === 'true'
  && same(stepAgain.body, stepOnce.body) && talliesNow[0]?.options?.[0]?.count === 1 && talliesNow[0]?.total === 1,
  JSON.stringify([stepOnce.status, stepAgain.status, stepAgain.headers.get('idempotent-replayed'), talliesNow[0]?.options]));

// The phone loses its connection; the professor closes the room.
asha.s.close();
await wait(100);
const graceClosed = await call(G, 'POST', `/api/session/${graceCode}/close`, {});
check('the room closes while the phone is away', graceClosed.status === 200 && graceClosed.body.session?.status === 'closed');

const back = await connect(G);
const backAccepted = next(back, 'session:accepted').catch(() => null);
back.emit('student:join', { code: graceCode, rollNo: '23BIO01', name: 'Asha', deliver: true });
const backIn = await backAccepted;
check('back inside the window with answers to send, the phone is let in only to send them', backIn?.deliverOnly === true,
  JSON.stringify(backIn).slice(0, 300));
const packedQ = graceBank.get(packIds[0]);
const LATE = {
  packed: { questionId: packIds[0], response: packedQ ? rightFor(packedQ) : 0, answerId: 'lap-late-packed', deviceAnsweredAt: '2026-11-19T10:02:00.000Z' },
  never: { questionId: applyId, response: '76', answerId: 'lap-late-never', deviceAnsweredAt: '2026-11-19T10:03:00.000Z' },
};
const rPacked = await sendSaved(back, LATE.packed).catch((err) => ({ error: err.message }));
check('a packed answer arriving after the close, inside the window: marked by the laptop and counted',
  rPacked.event === 'server:result' && rPacked.correct === true && rPacked.message === LATE_COUNTED_MESSAGE, JSON.stringify(rPacked));
const rNever = await sendSaved(back, LATE.never).catch((err) => ({ error: err.message }));
check('an answer to a question it was never given: kept, not counted, and told no mark',
  rNever.event === 'server:kept' && rNever.counted === false && rNever.message === LATE_NOT_SERVED_MESSAGE && !('correct' in rNever),
  JSON.stringify(rNever));
back.close();

const graceFile = path.join(graceFolder, `room-${graceCode}-${graceRoom.body.sessionId}.json`);
let graceSaved = null;
let graceRows = [];
for (let i = 0; i < 60; i += 1) {
  try {
    graceSaved = readJson(graceFile);
    graceRows = decodeRoomArchive(graceSaved).answers.filter((a) => a.answerKey.startsWith('lap-late-'));
    if (graceSaved.room?.status === 'closed' && graceRows.length === 2) break;
  } catch { /* not written yet, or being renamed into place */ }
  await wait(100);
}
const savedRow = (key) => graceRows.find((a) => a.answerKey === key) ?? {};
check('the laptop saves the closed room again with both: the counted one as counted, the kept one as kept, each with the phone\'s time',
  graceRows.length === 2 && savedRow('lap-late-packed').final !== false && !keptNotCounted(savedRow('lap-late-packed'))
  && savedRow('lap-late-never').final === false && savedRow('lap-late-never').detail === AFTER_CLOSE_DETAIL
  && savedRow('lap-late-packed').deviceAnsweredAt === LATE.packed.deviceAnsweredAt
  && savedRow('lap-late-never').deviceAnsweredAt === LATE.never.deviceAnsweredAt, JSON.stringify(graceRows).slice(0, 800));
const graceTallies = graceSaved ? decodeRoomArchive(graceSaved).tallies ?? [] : [];
check('and the hand counted once', graceTallies.length === 1 && graceTallies[0]?.counts?.[0] === 1, JSON.stringify(graceTallies));

// Wrong teacher keys (the review of 19 Nov 2026): every phone is on the laptop's
// Wi-Fi, so ten wrong keys from one address shut that address out of the key,
// the right key included, over HTTP and over the socket alike.
{
  const tries = [];
  const allowed = KEY_TRIES ?? 10;
  for (let i = 0; i < allowed; i += 1) {
    tries.push((await call(G, 'GET', '/api/content', { as: null, headers: { 'x-teacher-key': `WRONG-GUESS-${i}` } })).status);
  }
  const right = await call(G, 'GET', '/api/content');
  check(`${allowed} wrong keys from one address: refused, the last shuts it out, and then the right key is refused too, with a sentence`,
    tries.slice(0, -1).every((s) => s === 401) && tries.at(-1) === 429 && right.status === 429 && Boolean(KEY_BLOCKED_MESSAGE)
    && right.body.error === KEY_BLOCKED_MESSAGE,
    JSON.stringify({ tries, right: [right.status, right.body.error] }));
  const s = await connect(G);
  const refused = next(s, 'session:rejected').catch(() => null);
  s.emit('teacher:watch', { code: graceCode, key: KEY });
  const r = await refused;
  s.close();
  check('and the socket\'s way in with the key is shut to that address too', Boolean(r?.reason) && r.reason === KEY_BLOCKED_MESSAGE,
    JSON.stringify(r));
}
await stopLaptop(graceLaptop);

// ============================================================= cloud =====

console.log('\nthe cloud: the professor imports the room');

const cloud = await startCloud();
const K = cloud.base;
const cloudChapter = await call(K, 'POST', '/api/content', { body: { title: 'Cells', text: 'Cells\nEnergy' }, as: 'profA' });
const cloudContentId = cloudChapter.body.contentId;
const cloudClass = await classOf(K, 'profA');
check('her chapter and her class (the same four students, CO1) in the cloud', cloudChapter.status === 201 && cloudClass.roster.body.added?.length === 4,
  JSON.stringify(cloudClass.roster.body).slice(0, 300));
const target = { contentId: cloudContentId, classId: cloudClass.classId };
const before = { sessions: (await repo.listSessions()).length, answers: (await repo.listAnswers({})).length };

const noOne = await call(K, 'POST', '/api/imports/rooms', { body: { archive: saved, ...target }, as: null });
check('no credentials: 401', noOne.status === 401, JSON.stringify(noOne.body));
const hod = await call(K, 'POST', '/api/imports/rooms', { body: { archive: saved, ...target }, as: 'hod' });
check('an HOD: 403, with a sentence', hod.status === 403 && /HOD can read/.test(hod.body.error ?? ''), JSON.stringify(hod.body));
const notJson = await call(K, 'POST', '/api/imports/rooms', { raw: '{"archive": {', as: 'profA' });
check('a body that is not JSON: 400, with a sentence', notJson.status === 400 && /not readable JSON\. Nothing was imported\./.test(notJson.body.error ?? ''), JSON.stringify(notJson.body));
const huge = await call(K, 'POST', '/api/imports/rooms', { raw: JSON.stringify({ archive: { pad: 'x'.repeat(2200 * 1024) } }), as: 'profA' });
check('a body over the limit: 413, with a sentence', huge.status === 413 && /over the 1 MB a room archive may be/.test(huge.body.error ?? ''), JSON.stringify(huge.body));
const empty = await call(K, 'POST', '/api/imports/rooms', { body: { ...target }, as: 'profA' });
check('no file: 400, with a sentence that names no field', empty.status === 400 && /^Choose the room file laptop mode saved/.test(empty.body.error ?? ''), JSON.stringify(empty.body));
check('none of those wrote anything', same(before, { sessions: (await repo.listSessions()).length, answers: (await repo.listAnswers({})).length }));

const imported = await call(K, 'POST', '/api/imports/rooms', { body: { archive: saved, ...target }, as: 'profA' });
check('the professor imports it: 201, a closed room', imported.status === 201 && imported.body.room?.status === 'closed' && imported.body.room?.code === code,
  JSON.stringify(imported.body).slice(0, 600));
check('the reply says what came across in a sentence that names no field, and that the file was checked for shape only',
  /^Room [A-Z0-9]{6} was imported as a closed room: 12 answers from 3 students, 4 attendance marks\. It is shown as imported wherever it appears: BloomLoop checked that the file is a room it can read, not that it is unchanged since the laptop saved it\.$/
    .test(imported.body.message ?? ''), imported.body.message);
const room = imported.body.room?.sessionId ? await repo.getSession(imported.body.room.sessionId) : null;
check('owned by her, on her chapter and her class',
  room?.ownerId === ID.profA && room?.contentId === cloudContentId && room?.classId === cloudClass.classId && room?.status === 'closed');
check('marked as imported: which laptop run, when, by whom',
  imported.body.import?.laptop?.run === status.body.run && imported.body.import?.laptop?.startedAt === status.body.startedAt
  && imported.body.import?.importedBy === ID.profA && Boolean(imported.body.import?.importedAt) && imported.body.import?.sourceRoomId === sessionId,
  JSON.stringify(imported.body.import));

const cloudMap = await mapOutcome(K, 'profA', cloudClass.classId, cloudClass.outcomeId, cloudContentId);
check('CO1 mapped to Cells in the cloud too', cloudMap.status === 200, JSON.stringify(cloudMap.body));

const cloudReports = await reports(K, 'profA', code, cloudClass.classId);
const lapCqs = lapReports.classQuestions.classQuestions ?? lapReports.classQuestions.items ?? [];
const cloudCqs = cloudReports.classQuestions.classQuestions ?? cloudReports.classQuestions.items ?? [];
const lapTokens = idTokens({
  sessionId, contentId: lap.contentId, classId: lapClass.classId, students: lapStudents, outcomes: lapOutcomes,
  classQuestions: lapCqs, answers: lapReports.answers.items,
});
const cloudTokens = idTokens({
  sessionId: room?._id, contentId: cloudContentId, classId: cloudClass.classId, students: cloudClass.roster.body.added,
  outcomes: [{ _id: cloudClass.outcomeId, code: 'CO1' }], classQuestions: cloudCqs, answers: cloudReports.answers.items,
});

// The one deliberate difference: an answer's own question id. The laptop's
// questions are not in the cloud, so it is empty there; the question as shown
// keeps its id, and every report reads that one.
const lapItems = lapReports.answers.items ?? [];
const cloudItems = cloudReports.answers.items ?? [];
check('every answer keeps the question as it was shown, with the laptop\'s id; its own question id is empty here',
  cloudItems.length === 12 && cloudItems.every((i) => i.questionId === null)
  && same(cloudItems.map((i) => i.snapshot.id).sort(), lapItems.map((i) => String(i.questionId)).sort()));
// The same holds for what the reports say about the chapter's bank, not about
// the room: item statistics find none of the laptop's questions in the cloud
// chapter's bank (labelled as no longer in it, as for a question deleted after
// it was answered: no approval in force, no level check), a class question
// names no bank question, and the room's
// bank count is the cloud chapter's. Pinned here, and taken out of the exact
// comparison below; every other field of every report is compared exactly.
check('item statistics: every question is read off its answers, none is in the cloud chapter\'s bank',
  (cloudReports.items.items ?? []).length === (lapReports.items.items ?? []).length && (cloudReports.items.items ?? []).length > 0
  && cloudReports.items.items.every((i) => i.status === 'deleted' && i.provenance?.approval === 'discarded' && i.levelCheck === null)
  && lapReports.items.items.every((i) => i.status === 'active' && i.provenance?.approval === 'written' && i.levelCheck !== null),
  JSON.stringify((cloudReports.items.items ?? []).map((i) => [i.status, i.provenance?.approval])));
check('the class question keeps the question as asked; it names no bank question here',
  cloudCqs.length === 1 && cloudCqs[0].questionId === null && lapCqs[0]?.questionId === String(cqQuestion._id), JSON.stringify(cloudCqs[0]).slice(0, 300));
check('the room\'s bank count is the cloud chapter\'s own (none)', cloudReports.room.bankCount === 0 && lapReports.room.bankCount === 6);

// The other deliberate difference (the review of 19 Nov 2026): every staff view
// of the imported room says it was imported, and that the file was checked for
// its shape, not for being unchanged. Pinned here, and taken out of the exact
// comparison below.
const IMPORTED_SENTENCE = /One room counted here \([A-Z0-9]+\) was imported from a file saved by laptop mode\. BloomLoop checked that each such file is a room it can read, not that it is unchanged since the laptop saved it; a report can leave these rooms out\. /;
check('every staff view of the imported room says so: the grid, the answers, the attendance, the topics, the item statistics',
  [cloudReports.grid.importedFrom, cloudReports.answers.room?.importedFrom, cloudReports.attendance.room?.importedFrom,
    cloudReports.topics.room?.importedFrom, cloudReports.items.room?.importedFrom]
    .every((f) => Boolean(f?.note) && f.note === IMPORTED_NOTE && f.sourceCode === code && f.laptop?.run === status.body.run)
  && !lapReports.grid.importedFrom && !lapReports.answers.room?.importedFrom,
  JSON.stringify(cloudReports.grid.importedFrom));
check('and attainment and the marks register name it among the rooms they count, and say what was checked',
  isNote(cloudReports.attainment.rooms?.[0]?.importedFrom?.note) && IMPORTED_SENTENCE.test(cloudReports.attainment.methodology ?? '')
  && isNote(cloudReports.register.rooms?.[0]?.importedFrom?.note) && IMPORTED_SENTENCE.test(cloudReports.register.methodology ?? ''),
  (cloudReports.attainment.methodology ?? '').slice(-600));
{
  const left = await call(K, 'GET', `/api/classes/${cloudClass.classId}/attainment?imported=leave-out`, { as: 'profA' });
  const bad = await call(K, 'GET', `/api/classes/${cloudClass.classId}/attainment?imported=maybe`, { as: 'profA' });
  const roomsList = await call(K, 'GET', '/api/session', { as: 'profA' });
  const hodList = await call(K, 'GET', '/api/session', { as: 'hod' });
  check('a report can leave imported rooms out, and says it did; anything else asked is a 400 with a sentence',
    left.status === 200 && left.body.rooms?.length === 0 && /Rooms imported from files saved by laptop mode are left out of this report\./.test(left.body.methodology ?? '')
    && left.body.window?.imported === 'leave-out' && bad.status === 400 && /imported must be count or leave-out/.test(bad.body.error ?? ''),
    JSON.stringify([left.status, left.body.rooms, bad.status, bad.body.error]));
  check('the rooms list, the professor\'s and her HOD\'s, marks it imported',
    isNote(roomsList.body.rooms?.find((r) => r.code === code)?.importedFrom?.note)
    && isNote(hodList.body.rooms?.find((r) => r.code === code)?.importedFrom?.note),
    JSON.stringify(roomsList.body.rooms?.map((r) => [r.code, Boolean(r.importedFrom)])));
}
const importLabelsAside = (value) => {
  if (Array.isArray(value)) return value.map(importLabelsAside);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'importedFrom').map(([k, v]) => [k, importLabelsAside(v)]));
  }
  return typeof value === 'string' ? value.replace(IMPORTED_SENTENCE, '') : value;
};
const bankLinksAside = (raw) => {
  const r = importLabelsAside(raw);
  return {
    ...r,
    answers: { ...r.answers, items: (r.answers.items ?? []).map(({ questionId, ...rest }) => rest) },
    items: {
      ...r.items,
      // Who wrote it comes from the question as shown; where it stands at the
      // approval gate (approval, its label and sentence) is the bank's.
      items: (r.items.items ?? []).map(({ status: _s, levelCheck: _l, provenance, ...rest }) => ({
        ...rest, provenance: { source: provenance?.source, sourceLabel: provenance?.sourceLabel, model: provenance?.model },
      })),
    },
    classQuestions: { ...r.classQuestions, classQuestions: (r.classQuestions.classQuestions ?? []).map(({ questionId, ...rest }) => rest) },
    room: { ...r.room, bankCount: null },
  };
};
const lapView = normalise(bankLinksAside(lapReports), lapTokens);
const cloudView = normalise(bankLinksAside(cloudReports), cloudTokens);
for (const name of Object.keys(lapView)) {
  check(`${name}: read back exactly as on the laptop`, same(lapView[name], cloudView[name]), firstDifference(lapView[name], cloudView[name]));
}

console.log('\nthe same file again');

const countsOf = async () => ({
  sessions: (await repo.listSessions()).length,
  answers: (await repo.listAnswers({})).length,
  reviews: (await repo.listAnswerReviews({ sessionId: room?._id })).length,
  attendance: (await repo.listAttendance(room?._id)).length,
  classQuestions: (await repo.listClassQuestions(room?._id)).length,
  imports: (await repo.listRoomImports()).length,
});
const countsBefore = await countsOf();
const again = await call(K, 'POST', '/api/imports/rooms', { body: { archive: saved, ...target }, as: 'profA' });
check('200: imported already, the same file, nothing changed', again.status === 200 && again.body.alreadyImported === true && again.body.same === true
  && /so nothing was changed\.$/.test(again.body.message ?? ''), JSON.stringify(again.body).slice(0, 400));
check('the store holds exactly what it held', same(await countsOf(), countsBefore), JSON.stringify([countsBefore, await countsOf()]));
const reportsAgain = await reports(K, 'profA', code, cloudClass.classId);
check('and every report reads the same', same(normalise(reportsAgain, cloudTokens), normalise(cloudReports, cloudTokens)),
  firstDifference(normalise(cloudReports, cloudTokens), normalise(reportsAgain, cloudTokens)));

const theirChapter = await call(K, 'POST', '/api/content', { body: { title: 'Elsewhere', text: 'Cells' }, as: 'profB' });
const otherProf = await call(K, 'POST', '/api/imports/rooms', { body: { archive: saved, contentId: theirChapter.body.contentId }, as: 'profB' });
check('another professor: 409, "from somewhere else", never "already imported"', otherProf.status === 409 && otherProf.body.error === ELSEWHERE,
  JSON.stringify(otherProf.body));

const listA = await call(K, 'GET', '/api/imports/rooms', { as: 'profA' });
const listHod = await call(K, 'GET', '/api/imports/rooms', { as: 'hod' });
const listB = await call(K, 'GET', '/api/imports/rooms', { as: 'profB' });
check('the list: hers to her and her HOD, nothing to another professor, never the file itself',
  listA.body.imports?.length === 1 && listHod.body.imports?.length === 1 && listB.body.imports?.length === 0
  && !JSON.stringify(listA.body).includes('"data"'), JSON.stringify([listA.body, listB.body]).slice(0, 400));

console.log('\nthe crashed room');

const crashImport = await call(K, 'POST', '/api/imports/rooms', { body: { archive: afterCrash, contentId: cloudContentId }, as: 'profA' });
check('the file saved before the crash imports: closed as of the moment it was saved, and says so',
  crashImport.status === 201 && crashImport.body.room?.closedAt === afterCrash?.archivedAt
  && crashImport.body.import?.summary?.sentences?.some((s) => /still running/.test(s)), JSON.stringify(crashImport.body).slice(0, 500));
const crashAnswers = await call(K, 'GET', `/api/session/${crashRoom.body.code}/answers`, { as: 'profA' });
check('with its four answers', crashAnswers.body.items?.length === 4);

console.log('\nthe room whose phone sent answers after its close');

const graceImport = await call(K, 'POST', '/api/imports/rooms', { body: { archive: graceSaved, contentId: cloudContentId }, as: 'profA' });
check('it imports', graceImport.status === 201 && graceImport.body.room?.code === graceCode, JSON.stringify(graceImport.body).slice(0, 500));
const graceCloudRows = graceImport.body.room?.sessionId
  ? (await repo.listAnswers({ sessionId: graceImport.body.room.sessionId })).filter((a) => a.answerKey.startsWith('lap-late-'))
  : [];
const cloudRow = (key) => graceCloudRows.find((a) => a.answerKey === key) ?? {};
check('both answers as the laptop kept them: the phone\'s own times, the counted one counted, the kept one kept and not counted',
  graceCloudRows.length === 2 && cloudRow('lap-late-packed').deviceAnsweredAt === LATE.packed.deviceAnsweredAt
  && cloudRow('lap-late-never').deviceAnsweredAt === LATE.never.deviceAnsweredAt
  && cloudRow('lap-late-packed').final === true && cloudRow('lap-late-packed').correct === true
  && keptNotCounted(cloudRow('lap-late-never')), JSON.stringify(graceCloudRows).slice(0, 800));
{
  // The laptop closed the room moments ago, so the window its close leaves is
  // still open: an imported room takes no delivery all the same.
  const stillOpen = Date.now() - Date.parse(graceImport.body.room?.closedAt ?? '') < GRACE_MS;
  const s = await connect(K);
  const rejected = next(s, 'session:rejected').catch(() => null);
  const accepted = next(s, 'session:accepted', () => true, 1000).catch(() => null);
  s.emit('student:join', { code: graceCode, rollNo: '23BIO01', name: 'Asha', deliver: true });
  const [no, yes] = await Promise.all([rejected, accepted]);
  s.close();
  check('a phone asking to deliver to the imported room inside that window is refused, told why in a sentence',
    stillOpen && no?.reason === DELIVER_IMPORTED_REASON && !yes, JSON.stringify({ stillOpen, no, yes }));
}

console.log('\na file under a code already in use here');

{
  // Anyone can read a room's code off the wall, and write a file under it: the
  // code identifies nothing, so a clash draws a fresh code instead of shutting
  // the real room out for good (the review of 19 Nov 2026). Same file, another
  // room id, the code of the room imported above.
  const forged = JSON.parse(JSON.stringify(saved));
  forged.room.id = 'f0f0f0f0f0f0f0f0f0f0f0f0';
  const made2 = await call(K, 'POST', '/api/imports/rooms', { body: { archive: forged, ...target }, as: 'profA' });
  check('it imports under a code drawn afresh, says so, and keeps the laptop\'s code with the import',
    made2.status === 201 && /^[A-Z0-9]{6}$/.test(made2.body.room?.code ?? '') && made2.body.room.code !== code
    && made2.body.import?.room?.code === code
    && made2.body.message?.startsWith(`Room ${code} was imported as a closed room with the code ${made2.body.room.code}, since ${code} is another room's here: `),
    JSON.stringify(made2.body).slice(0, 500));
  const first = await call(K, 'GET', `/api/session/${code}/answers?limit=1`, { as: 'profA' });
  check('the room first imported under that code is untouched, and the new one is shown as imported too',
    first.status === 200 && first.body.room?.code === code
    && isNote((await call(K, 'GET', `/api/session/${made2.body.room?.code}/grid`, { as: 'profA' })).body.importedFrom?.note));
}

// ------------------------------------------------------------------ end --

await new Promise((r) => cloud.io.close(() => r()));
await new Promise((r) => cloud.server.close(() => r()));
for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
globalThis.fetch = realFetch;

check('refusedOffMachine is 0: neither the laptop nor this script reached a network service', refusedOffMachine === 0, String(refusedOffMachine));
console.log(`\n${pass} passed, ${fail} failed (refusedOffMachine=${refusedOffMachine})`);
process.exit(fail ? 1 : 0);
