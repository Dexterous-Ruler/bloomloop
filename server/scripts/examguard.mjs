// Batch 9, decision E5 (and E7) - exam integrity, end to end.
//
//   node server/scripts/examguard.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with scripted phones, a staff console
// and a projector over Socket.io, and checks:
//
//   setting     a room opened in exam mode, checked; the open room route and
//               the join tell a phone what to enforce and the consent notice,
//               never the Safe Exam Browser keys; a room without it is as before
//   live        signals reach the console at once (teacher:integrity), as
//               counts and the latest signal, worded as signals; the exam kinds
//               are refused in a room without exam mode; a phone's flood is cut
//               to the rate; a phone cannot claim an observed kind
//   screen      no answer is taken before the whole screen is shared; a declined
//               share is noted once and nothing more; a stopped one is a signal
//   pictures    one per interval, a JPEG by its bytes, metadata gone, at most
//               about 80 KB; the newest per student to the room's staff only;
//               overdue pictures noted once per gap; purged two hours after the
//               close (the clock run forward), and at once on delete
//   devices     a second device on the same roll number is second_device
//   under 18    a student the roster marks under 18 is asked for nothing that
//               watches, sends no picture, and has nothing recorded or shown
//   SEB         a room that requires Safe Exam Browser turns other browsers away
//               with a sentence; SEB's header or its JavaScript value lets one in
//   collusion   matching wrong answers close together are listed, in roll order,
//               as signals; a student under 18 never is
//   nowhere     nothing of it reaches the projector, a phone's other events, the
//               archive or the CSV; staff routes refuse phones and outsiders
//
// Signed-in accounts need Supabase Auth, which this suite must never reach: as in
// roster.mjs, the server is pointed at http://supabase.invalid and the few calls
// it makes about accounts are answered here. Any other request off this machine
// is refused and counted (refusedOffMachine, which must end at 0).
//
// Never calls Gemini, Supabase or any network service. Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { examTick, sweepSnapshots } = await import(`${SRC}sockets/examGuard.js`);
const { sebConfigKeyHash, snapshots, SNAPSHOT_KEEP_MS, SNAPSHOT_MAX_BYTES } = await import(`${SRC}services/examGuard.js`);
const { config } = await import(`${SRC}config.js`);

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
  hod: 'e0000000-0000-4000-8000-000000000001',
  profA: 'e0000000-0000-4000-8000-000000000002',
  profB: 'e0000000-0000-4000-8000-000000000003',
  hodOther: 'e0000000-0000-4000-8000-000000000004',
  student: 'e0000000-0000-4000-8000-000000000005',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-EXAM0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-20T08:00:00+00:00', updated_at: '2026-11-20T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.student, 'student', 'CSE', ID.profA, 'A01'),
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
    throw new Error(`examguard.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by examguard.mjs: ${url.pathname}` }, 404);
};
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'examguard-test-service-key';

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
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { body, as = 'profA' } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let parsed = {};
  try { parsed = JSON.parse(buf.toString('utf8')); } catch { parsed = { text: buf.toString('utf8') }; }
  return { status: res.status, body: parsed, buf, headers: res.headers };
}
const get = (path, as) => call('GET', path, { as });
const post = (path, body, as) => call('POST', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });
const del = (path, as) => call('DELETE', path, { as });

function connect(opts = {}) {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false, ...opts });
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

/** Every payload of one event on one socket, and a way to wait for one that matches. */
function collect(socket, event) {
  const seen = [];
  const waiting = [];
  socket.on(event, (p) => {
    seen.push(p);
    for (const w of [...waiting]) {
      if (w.match(p)) { waiting.splice(waiting.indexOf(w), 1); clearTimeout(w.timer); w.resolve(p); }
    }
  });
  return {
    seen,
    until(match, ms = 4000) {
      const hit = seen.find(match);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        w.timer = setTimeout(() => { waiting.splice(waiting.indexOf(w), 1); reject(new Error(`timeout waiting for ${event}`)); }, ms);
        waiting.push(w);
      });
    },
  };
}

const emitAck = (s, event, payload, ms = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no acknowledgement of ${event}`)), ms);
  s.emit(event, payload, (body) => { clearTimeout(timer); resolve(body); });
});

const phoneLog = []; // every event every phone heard
const phones = [];
/** A phone joins; resolves with the socket, its accepted payload and its first question (or a refusal). */
async function join(code, rollNo, { opts = {}, extra = {}, expectQuestion = true } = {}) {
  const s = await connect(opts);
  phones.push(s);
  s.onAny((event, payload) => phoneLog.push({ rollNo, event, payload }));
  const questions = collect(s, 'server:question');
  const accepted = new Promise((resolve) => {
    s.once('session:accepted', (p) => resolve({ accepted: p }));
    s.once('session:rejected', (p) => resolve({ rejected: p }));
  });
  s.emit('student:join', { code, rollNo, name: rollNo, ...extra });
  const result = await accepted;
  const first = result.accepted && expectQuestion ? await questions.until(() => true) : null;
  return { s, ...result, first, questions };
}

let keyN = 0;
const answerKey = (roll) => `exam-${roll}-${String((keyN += 1)).padStart(4, '0')}`;
/** Answer the question on this phone's screen; resolves with the first reply about it. */
function answer(ph, question, response) {
  const replies = ['server:result', 'exam:screen-needed', 'server:kept', 'session:rejected', 'server:exhausted'];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no reply to an answer')), 4000);
    const handlers = replies.map((event) => [event, (p) => {
      clearTimeout(timer);
      for (const [e, h] of handlers) ph.s.off(e, h);
      resolve({ event, payload: p });
    }]);
    for (const [e, h] of handlers) ph.s.on(e, h);
    ph.s.emit('student:answer', { questionId: question._id, response, answerId: answerKey(ph.rollNo ?? 'x') });
  });
}

// ------------------------------------------------------------ fixtures --

// Long enough that an answer straight away is under the reading time: about 30 seconds of reading.
const LONG = 'In a reliable transport protocol, each segment carries a sequence number. '.repeat(10);
async function chapter(ownerId, title, n = 8) {
  const content = await repo.createContent({ title, kind: 'syllabus', rawText: '', topics: ['Transport'], ownerId });
  await repo.insertQuestions(Array.from({ length: n }, (_, i) => ({
    contentId: content._id, topic: 'Transport', text: `${LONG} Which layer is meant (${i})?`, kind: 'mcq',
    options: ['Network', 'Transport', 'Link', 'Physical'], answerIdx: 1, bloom: 'understand', source: 'llm', status: 'active',
  })));
  return content;
}

// A JPEG the server walks but never decodes: Exif and a comment to strip, and
// pixels with a marker this suite looks for in every place a picture must not be.
const seg = (marker, body) => {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(b.length + 2, 2);
  return Buffer.concat([head, b]);
};
const PIXELS = 'EXAMGUARD-SCREEN-PIXELS-7731';
const PICTURE = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  seg(0xe0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])])),
  seg(0xe1, 'Exif\0\0GPS 18.52N 73.85E owner EXIF-OWNER-NAME'),
  seg(0xfe, 'COMMENT-WITH-A-NAME'),
  seg(0xdb, Buffer.alloc(65, 1)),
  seg(0xc0, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
  seg(0xc4, Buffer.alloc(20, 0)),
  seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
  Buffer.from(PIXELS, 'latin1'),
  Buffer.from([0xff, 0xd9]),
]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const KEY = '5'.repeat(64);
const NOWHERE = 'ZZZZZZ';

// ---------------------------------------------------------- the class --

console.log('\nsetting: a room opened in exam mode');

const made = await post('/api/classes', { courseName: 'Computer Networks', section: 'TY-CSF A' });
const classId = made.body.class?.id;
await post(`/api/classes/${classId}/students`, {
  students: [{ roll: 'A01', name: 'Asha' }, { roll: 'A02', name: 'Bilal' }, { roll: 'A03', name: 'Chitra' }, { roll: 'M01', name: 'Meera', under18: true }],
});
const content = await chapter(ID.profA, 'Transport layer');
const EXAM = { on: true, fullscreen: true, screenShare: true, snapshotSeconds: 30 };

{
  const bad = await post('/api/session', { contentId: content._id, classId, examMode: { on: true, snapshotSeconds: 30 } });
  check('pictures without screen share are refused with a 400 that says so', bad.status === 400 && /screen sharing/i.test(bad.body.error ?? ''),
    `${bad.status} ${bad.body.error}`);
  const odd = await post('/api/session', { contentId: content._id, examMode: { on: true, screenShare: true, snapshotSeconds: 45 } });
  check('an interval the product does not offer is a 400, not clamped', odd.status === 400);
  const led = await post('/api/session', { contentId: content._id, classId, mode: 'teacher-led', examMode: { on: true } });
  check('exam mode in a Teacher-led room is a 400: no phone joins it', led.status === 400 && /Teacher-led/.test(led.body.error ?? ''));
}
const opened = await post('/api/session', { contentId: content._id, classId, examMode: EXAM });
const code = opened.body.code;
const sessionId = opened.body.sessionId;
check('the owner opens a room in exam mode, and reads back what it will run under',
  opened.status === 200 && opened.body.examMode?.on === true && opened.body.examMode?.snapshotSeconds === 30
  && opened.body.examMode?.screenShare === true && opened.body.examMode?.seb?.required === false && Boolean(opened.body.examHelp?.honesty),
  `${opened.status} ${JSON.stringify(opened.body.examMode ?? opened.body)}`);
check('the help says plainly that no website can stop screenshots or Google Lens, or truly lock a tab',
  /No website can stop screenshots, Google Lens/.test(opened.body.examHelp?.honesty ?? '') && /truly lock/.test(opened.body.examHelp?.honesty ?? ''));
{
  const open = await get(`/api/session/${code}`, null);
  check('the open room route carries the rules and the consent notice for a phone to read before joining',
    open.status === 200 && open.body.exam?.screenShare === true && open.body.exam?.snapshotSeconds === 30 && /This room is an exam/.test(open.body.exam?.notice ?? '')
    && !('watched' in (open.body.exam ?? {})), JSON.stringify(open.body.exam));
  const list = await get('/api/session');
  check('the room list says which rooms are exams, without any key',
    list.body.rooms?.find((r) => r.code === code)?.examMode?.on === true && list.body.rooms?.find((r) => r.code === code)?.examMode?.seb?.keys === 0);
}
const plain = await post('/api/session', { contentId: content._id });
{
  check('a room opened without it is off, and its open route has no exam field',
    plain.status === 200 && plain.body.examMode?.on === false && !('exam' in (await get(`/api/session/${plain.body.code}`, null)).body));
}

// ------------------------------------------------------ the live console --

console.log('\nlive: the console hears each signal as it happens');

const teacher = await connect();
const feed = collect(teacher, 'teacher:integrity');
{
  const grid = next(teacher, 'teacher:grid');
  teacher.emit('teacher:watch', { code, token: TOKENS.profA });
  await grid;
  const first = await feed.until((p) => p.full === true);
  check('watching an exam room starts with the whole room (nobody yet), the summary and the honesty sentence',
    first.code === code && Array.isArray(first.students) && first.examMode?.on === true && /signals, not proof/.test(first.honesty ?? ''));
}
const hodScreen = await connect();
const hodFeed = collect(hodScreen, 'teacher:integrity');
{
  const grid = next(hodScreen, 'teacher:grid');
  hodScreen.emit('teacher:watch', { code, token: TOKENS.hod });
  await grid;
}

// The projector, listening to everything it is sent.
const wallLog = [];
const link = await post(`/api/session/${code}/projector/links`, {});
const wall = await connect();
wall.onAny((event, payload) => wallLog.push({ event, payload }));
{
  const first = next(wall, 'projector:state');
  wall.emit('projector:watch', { token: link.body.token });
  await first;
}

const asha = await join(code, 'A01');
asha.rollNo = 'A01';
{
  const m = asha.accepted?.examMode;
  check('the phone is told what to enforce: copy guard, watermark, fullscreen, whole-screen sharing, a picture every 30 seconds',
    m?.copyGuard === true && m?.watermark === true && m?.fullscreen === true && m?.screenShare === true && m?.snapshotSeconds === 30
    && m?.snapshotMaxBytes === SNAPSHOT_MAX_BYTES && m?.watched === true, JSON.stringify(m));
  check('with a plain consent notice to show before the first question',
    /This room is an exam/.test(m?.notice ?? '') && /every 30 seconds/.test(m?.notice ?? '') && /not as proof/.test(m?.notice ?? ''));
  const plainPhone = await join(plain.body.code, 'P01');
  check('a phone in a room without exam mode is told nothing new (no examMode)', plainPhone.accepted && !('examMode' in plainPhone.accepted));
  plainPhone.s.emit('student:signal', { kind: 'copy_attempt' });
  plainPhone.s.emit('student:signal', { kind: 'screenshot_attempt', method: 'printscreen' });
  await settle();
  check('and the exam kinds are refused there, so nothing changes for such a room',
    (await repo.getProfile(plain.body.sessionId, 'P01')).integrity.length === 0);
}

console.log('\nscreen: nothing is answered before the whole screen is shared');
{
  const blocked = await answer(asha, asha.first.question, 3);
  check('an answer before sharing is not taken: the phone is told why, in a sentence', blocked.event === 'exam:screen-needed'
    && /share your whole screen/i.test(blocked.payload.message ?? '') && blocked.payload.questionId === asha.first.question._id,
    JSON.stringify(blocked));
  check('and nothing was stored', (await repo.listAnswers({ sessionId })).length === 0);
  const windowOnly = await emitAck(asha.s, 'student:screen', { state: 'started', surface: 'window' });
  check('sharing a window, not the whole screen, does not count', windowOnly.ok === false && /whole screen/.test(windowOnly.message ?? ''));
  const shared = await emitAck(asha.s, 'student:screen', { state: 'started', surface: 'monitor' });
  check('sharing the whole screen is acknowledged', shared.ok === true);
  const marked = await answer(asha, asha.first.question, 3);
  check('then the answer is taken and marked', marked.event === 'server:result' && marked.payload.correct === false, JSON.stringify(marked).slice(0, 200));
  const live = await feed.until((p) => !p.full && p.students?.[0]?.rollNo === 'A01' && p.students[0].summary?.counts?.timing_anomaly === 1);
  check('an answer sooner than the question could be read reaches the console at once, as timing_anomaly',
    live.students[0].summary.latest?.kind === 'timing_anomaly' && live.students[0].summary.level === 'watch');
  const kinds = (await repo.getProfile(sessionId, 'A01')).integrity.map((e) => e.kind);
  check('an exam room records timing_anomaly, never also too-fast', kinds.includes('timing_anomaly') && !kinds.includes('too-fast'), kinds.join(','));
}

console.log('\nlive: reported signals, the rate, and what a phone may not claim');
{
  for (const [kind, extra] of [['copy_attempt'], ['context_menu'], ['screenshot_attempt', { method: 'printscreen' }], ['focus_lost'],
    ['visibility_hidden', { awayMs: 4000 }], ['fullscreen_exit'], ['hidden', { awayMs: 2000 }]]) {
    asha.s.emit('student:signal', { kind, ...(extra ?? {}) });
  }
  const got = await feed.until((p) => !p.full && p.students?.[0]?.rollNo === 'A01' && p.students[0].summary?.counts?.hidden === 1);
  const counts = got.students[0].summary.counts;
  check('each reported signal reaches the console, counted by kind, the old kinds as before',
    ['copy_attempt', 'context_menu', 'screenshot_attempt', 'focus_lost', 'visibility_hidden', 'fullscreen_exit', 'hidden'].every((k) => counts[k] === 1),
    JSON.stringify(counts));
  const notes = got.students[0].summary.notes.join(' ');
  check('worded as signals: what was seen, never what it means',
    /Page left: possibly Google Lens, a screenshot tool or another app/.test(notes) && /The page sees the key, not whether a picture was taken/.test(notes)
    && !/cheat|fraud|guilty|dishonest/i.test(notes), notes);
  check('the HOD\'s console, reading the department\'s rooms, hears it too',
    Boolean(await hodFeed.until((p) => p.students?.some((s) => s.rollNo === 'A01' && s.summary?.counts?.copy_attempt === 1))
      .catch(() => null)), JSON.stringify(hodFeed.seen.map((p) => p.students?.map((s) => s.summary?.counts))));
  const before = (await repo.getProfile(sessionId, 'A01')).integrity.length;
  for (let i = 0; i < 40; i += 1) asha.s.emit('student:signal', { kind: 'copy_attempt' });
  asha.s.emit('student:signal', { kind: 'second_device' });
  asha.s.emit('student:signal', { kind: 'snapshot_missing' });
  asha.s.emit('student:signal', { kind: 'screenshare_not_started' });
  asha.s.emit('student:signal', { kind: 'exam-answers-please' });
  await settle(400);
  const after = (await repo.getProfile(sessionId, 'A01')).integrity;
  check('forty copies in a burst are cut to the rate (one a second of a kind): none more inside the second',
    after.filter((e) => e.kind === 'copy_attempt').length <= 2 && after.length - before <= 1, `${after.length - before} added`);
  check('a phone cannot claim an observed kind, nor "not started", nor an unknown one',
    !after.some((e) => ['second_device', 'snapshot_missing', 'screenshare_not_started', 'exam-answers-please'].includes(e.kind)));
}

console.log('\npictures: one per interval, a JPEG, metadata gone, staff only');
let pictureAt = null;
{
  const ok = await emitAck(asha.s, 'student:snapshot', { jpeg: PICTURE });
  check('a picture of the shared screen is taken', ok.ok === true, JSON.stringify(ok));
  const live = await feed.until((p) => !p.full && p.students?.[0]?.rollNo === 'A01' && p.students[0].snapshotAt);
  pictureAt = live.students[0].snapshotAt;
  check('the console hears that it arrived, and never its bytes', !JSON.stringify(feed.seen).includes(PIXELS)
    && !JSON.stringify(feed.seen).includes(PICTURE.toString('base64').slice(0, 40)));
  const soon = await emitAck(asha.s, 'student:snapshot', { jpeg: PICTURE });
  check('a second inside the interval is refused (too soon)', soon.ok === false && soon.reason === 'too-soon');

  const shot = await get(`/api/session/${code}/exam/snapshots/A01`);
  check('the owner sees the newest picture, as a JPEG, not cached',
    shot.status === 200 && shot.headers.get('content-type') === 'image/jpeg' && /no-store/.test(shot.headers.get('cache-control') ?? '')
    && shot.buf.includes(PIXELS), `${shot.status} ${shot.headers.get('content-type')}`);
  check('with the metadata taken out: no Exif, no comment', !shot.buf.includes('EXIF-OWNER-NAME') && !shot.buf.includes('COMMENT-WITH-A-NAME'));
  const hod = await get(`/api/session/${code}/exam/snapshots/A01`, 'hod');
  const other = await get(`/api/session/${code}/exam/snapshots/A01`, 'profB');
  const nowhere = await get(`/api/session/${NOWHERE}/exam/snapshots/A01`, 'profB');
  check('the department\'s HOD sees it too (the read rule)', hod.status === 200 && hod.buf.includes(PIXELS));
  check('another professor gets the same 404 as a room that does not exist, word for word',
    other.status === 404 && nowhere.status === 404 && other.body.error === nowhere.body.error, `${other.body.error} / ${nowhere.body.error}`);
  check('a phone (no credentials) is 401 and a student account 403',
    (await get(`/api/session/${code}/exam/snapshots/A01`, null)).status === 401 && (await get(`/api/session/${code}/exam/snapshots/A01`, 'student')).status === 403);
  check('a student with no picture is a 404 that says so',
    (await get(`/api/session/${code}/exam/snapshots/A02`)).status === 404);

  const room = await get(`/api/session/${code}/exam`);
  const row = room.body.students?.find((s) => s.rollNo === 'A01');
  check('the exam route lists each student\'s signals and when their newest picture arrived, with the keys for the owner',
    room.status === 200 && row?.snapshotAt === pictureAt && row?.summary?.counts?.copy_attempt >= 1 && Array.isArray(room.body.examMode?.seb?.configKeyHashes));
  const card = await get(`/api/session/${code}/students/A01/card`);
  check('the student card carries the signals and the picture\'s time', card.status === 200 && card.body.integrity?.counts?.timing_anomaly === 1
    && card.body.exam?.snapshotAt === pictureAt && /signals, not proof/.test(card.body.integrityNote ?? ''));
  const grid = await get(`/api/session/${code}/grid`);
  check('the live grid\'s summary includes the exam kinds', grid.body.rows?.find((r) => r.rollNo === 'A01')?.integrity?.counts?.screenshot_attempt === 1);
}

console.log('\npictures overdue, and a second device');
{
  const before = (await repo.getProfile(sessionId, 'A01')).integrity.filter((e) => e.kind === 'snapshot_missing').length;
  await examTick(io, Date.now() + 69_000);
  check('one interval late is not a gap', (await repo.getProfile(sessionId, 'A01')).integrity.filter((e) => e.kind === 'snapshot_missing').length === before);
  await examTick(io, Date.now() + 75_000);
  const live = await feed.until((p) => !p.full && p.students?.[0]?.summary?.counts?.snapshot_missing === 1);
  check('two intervals and ten seconds without a picture is snapshot_missing, on the console at once',
    live.students[0].rollNo === 'A01' && /did not arrive/.test(live.students[0].summary.notes.join(' ')));
  await examTick(io, Date.now() + 200_000);
  check('noted once per gap, not on every look',
    (await repo.getProfile(sessionId, 'A01')).integrity.filter((e) => e.kind === 'snapshot_missing').length === before + 1);

  const second = await join(code, 'A01');
  const dev = await feed.until((p) => !p.full && p.students?.[0]?.rollNo === 'A01' && p.students[0].summary?.counts?.second_device === 1);
  const kinds = (await repo.getProfile(sessionId, 'A01')).integrity.map((e) => e.kind);
  check('a second device on the same roll number is second_device, on the console at once, never also second-socket',
    Boolean(dev) && !kinds.includes('second-socket'), kinds.join(','));
  check('and the latest signal carries no socket id', !JSON.stringify(dev.students[0].summary.latest).includes(second.s.id));
  second.s.disconnect();
  await settle();
}

console.log('\nscreen declined, and stopped');
const bilal = await join(code, 'A02');
bilal.rollNo = 'A02';
{
  const notSharing = await emitAck(bilal.s, 'student:snapshot', { jpeg: PICTURE });
  check('a phone that is not sharing may send no picture', notSharing.ok === false && notSharing.reason === 'not-sharing');
  await emitAck(bilal.s, 'student:screen', { state: 'declined' });
  await emitAck(bilal.s, 'student:screen', { state: 'declined' });
  await feed.until((p) => !p.full && p.students?.[0]?.rollNo === 'A02');
  await settle();
  const p = await repo.getProfile(sessionId, 'A02');
  check('a declined share is recorded once as "not started", and nothing more',
    p.integrity.length === 1 && p.integrity[0].kind === 'screenshare_not_started', JSON.stringify(p.integrity));
  const blocked = await answer(bilal, bilal.first.question, 1);
  check('and the phone cannot answer: it gets the sentence', blocked.event === 'exam:screen-needed');
  const summary = (await get(`/api/session/${code}/grid`)).body.rows?.find((r) => r.rollNo === 'A02')?.integrity;
  check('no penalty beyond that: the level is clear, the ladder untouched', summary?.level === 'clear' && (await repo.getProfile(sessionId, 'A02')).history.length === 0);

  await emitAck(bilal.s, 'student:screen', { state: 'started', surface: 'monitor' });
  const png = await emitAck(bilal.s, 'student:snapshot', { jpeg: PNG });
  check('a picture that is not a JPEG by its bytes is refused', png.ok === false && png.reason === 'type');
  const big = Buffer.concat([PICTURE.subarray(0, PICTURE.length - 2), Buffer.alloc(SNAPSHOT_MAX_BYTES, 0x11), Buffer.from([0xff, 0xd9])]);
  const huge = await emitAck(bilal.s, 'student:snapshot', { jpeg: big });
  check('one over about 80 KB is refused', huge.ok === false && huge.reason === 'size');
  const cut = await emitAck(bilal.s, 'student:snapshot', { jpeg: PICTURE.subarray(0, 60) });
  check('half a JPEG is refused', cut.ok === false && cut.reason === 'shape');
  check('none of them was kept', snapshots.latest(sessionId, 'A02') === null);
  const marked = await answer(bilal, bilal.first.question, 1);
  check('sharing now, the answer is taken', marked.event === 'server:result' && marked.payload.correct === true);
  await emitAck(bilal.s, 'student:screen', { state: 'stopped' });
  const stopped = await feed.until((p) => !p.full && p.students?.[0]?.rollNo === 'A02' && p.students[0].summary?.counts?.screenshare_stopped === 1);
  check('stopping the share is a signal, on the console at once', Boolean(stopped));
  const again = await answer(bilal, bilal.first.question, 1);
  check('and answering pauses until it is shared again', again.event === 'exam:screen-needed');
  await emitAck(bilal.s, 'student:screen', { state: 'started', surface: 'monitor' });
  bilal.s.emit('student:signal', { kind: 'screenshare_stopped' });
  const viaSignal = await answer(bilal, bilal.first.question, 1);
  check('a stop reported as a signal pauses answering too', viaSignal.event === 'exam:screen-needed');
}

console.log('\nunder 18: asked for nothing that watches, nothing recorded or shown');
const meera = await join(code, 'M01');
meera.rollNo = 'M01';
{
  const m = meera.accepted?.examMode;
  check('the phone is told: no fullscreen, no screen share, no pictures, and that nothing about it is recorded',
    m?.fullscreen === false && m?.screenShare === false && m?.snapshotSeconds === 0 && m?.watched === false
    && /nothing about how you use the page is recorded/.test(m?.notice ?? ''), JSON.stringify(m));
  check('the copy guard and the watermark still apply: they record nothing', m?.copyGuard === true && m?.watermark === true);
  check('and the notice does not say why', !/\b18\b|\bage\b|\bminor\b/i.test(m?.notice ?? ''));
  const marked = await answer(meera, meera.first.question, 3);
  check('they answer without sharing anything', marked.event === 'server:result');
  for (const kind of ['copy_attempt', 'focus_lost', 'screenshot_attempt', 'hidden']) meera.s.emit('student:signal', { kind });
  const shot = await emitAck(meera.s, 'student:snapshot', { jpeg: PICTURE });
  check('a picture from them is not taken', shot.ok === false && shot.reason === 'not-asked');
  await emitAck(meera.s, 'student:screen', { state: 'declined' });
  const twin = await join(code, 'M01');
  await settle(400);
  check('nothing is recorded: not a signal, not a second device, not a declined share, not a fast answer',
    (await repo.getProfile(sessionId, 'M01')).integrity.length === 0, JSON.stringify((await repo.getProfile(sessionId, 'M01')).integrity));
  check('no picture is held for them, and the route has none', snapshots.latest(sessionId, 'M01') === null
    && (await get(`/api/session/${code}/exam/snapshots/M01`)).status === 404);
  check('the console never heard of them', ![...feed.seen, ...hodFeed.seen].some((p) => p.students?.some((s) => s.rollNo === 'M01')));
  const grid = await get(`/api/session/${code}/grid`);
  const card = await get(`/api/session/${code}/students/M01/card`);
  const exam = await get(`/api/session/${code}/exam`);
  check('the grid, the card and the exam route show nothing for them',
    grid.body.rows?.find((r) => r.rollNo === 'M01')?.integrity === null && card.body.integrity === null && card.body.exam?.snapshotAt === null
    && !exam.body.students?.some((s) => s.rollNo === 'M01'));
  twin.s.disconnect();
}

console.log('\nSafe Exam Browser: required, other browsers turned away');
{
  const byHod = await patch(`/api/session/${code}/exam`, { examMode: { ...EXAM, seb: { required: true, configKeyHashes: [KEY] } } }, 'hod');
  const byOther = await patch(`/api/session/${code}/exam`, { examMode: { ...EXAM, seb: { required: true, configKeyHashes: [KEY] } } }, 'profB');
  check('an HOD may not change it (403); another professor gets the room\'s 404', byHod.status === 403 && byOther.status === 404);
  const noKey = await patch(`/api/session/${code}/exam`, { examMode: { ...EXAM, seb: { required: true } } });
  check('requiring it with no Config Key is a 400 that says what is missing', noKey.status === 400 && /Config Key/.test(noKey.body.error ?? ''));
  const told = next(asha.s, 'exam:mode');
  const changed = await patch(`/api/session/${code}/exam`, { examMode: { ...EXAM, seb: { required: true, configKeyHashes: [KEY.toUpperCase()] } } });
  check('the owner requires it while the room runs', changed.status === 200 && changed.body.examMode?.seb?.required === true
    && changed.body.examMode?.seb?.configKeyHashes?.[0] === KEY);
  const pushed = await told;
  check('the phones in the room are told at once, without the key', pushed.examMode?.sebRequired === true && !JSON.stringify(pushed).includes(KEY));
  const fresh = await feed.until((p) => p.full === true && p.examMode?.seb?.required === true);
  check('and the console starts again from the whole room, in roll order, without the key',
    JSON.stringify(fresh.students.map((s) => s.rollNo)) === '["A01","A02"]' && !JSON.stringify(fresh).includes(KEY), JSON.stringify(fresh.students?.map((s) => s.rollNo)));

  const refused = await join(code, 'A03');
  check('a phone not in Safe Exam Browser is turned away with a plain sentence', Boolean(refused.rejected)
    && /must be taken in Safe Exam Browser/.test(refused.rejected.reason ?? '') && !/header|hash|key/i.test(refused.rejected.reason ?? ''),
    JSON.stringify(refused.rejected));
  check('and nothing was written for it', (await repo.getProfile(sessionId, 'A03')) === null);
  const requestUrl = `${base}/socket.io/?EIO=4&transport=websocket`;
  const viaHeader = await join(code, 'A03', { opts: { extraHeaders: { 'X-SafeExamBrowser-ConfigKeyHash': sebConfigKeyHash(requestUrl, KEY) } } });
  check('Safe Exam Browser\'s header, hashed with the request\'s own URL and a listed key, lets it in', Boolean(viaHeader.accepted),
    JSON.stringify(viaHeader.rejected));
  const wrong = await join(code, 'A03', { opts: { extraHeaders: { 'X-SafeExamBrowser-ConfigKeyHash': sebConfigKeyHash(requestUrl, '6'.repeat(64)) } } });
  check('another configuration\'s header does not', Boolean(wrong.rejected));
  const page = `${base}/join?code=${code}`;
  const viaApi = await join(code, 'A03', { extra: { seb: { url: `${page}#start`, configKeyHash: sebConfigKeyHash(page, KEY) } } });
  check('nor does the value from SEB\'s JavaScript for another page; for this page it lets the phone in', Boolean(viaApi.accepted));
  const otherPage = await join(code, 'A03', { extra: { seb: { url: page, configKeyHash: sebConfigKeyHash(`${page}&x=1`, KEY) } } });
  check('a value for another page is turned away', Boolean(otherPage.rejected));
  const room = await get(`/api/session/${code}`, null);
  check('the open room route says SEB is required, and never names a key', room.body.exam?.sebRequired === true && !JSON.stringify(room.body).includes(KEY));
}

console.log('\ncollusion: matching wrong answers, close together, as signals');
let collusionCode = null;
{
  const qs = (await repo.listQuestions(content._id)).slice(0, 3).map((q) => String(q._id));
  const roomC = await post('/api/session', { contentId: content._id, classId, questionIds: qs, questionsPerStudent: 3 });
  collusionCode = roomC.body.code;
  const answerAll = async (roll, response) => {
    const ph = await join(collusionCode, roll);
    ph.rollNo = roll;
    let q = ph.first.question;
    const done = new Set();
    for (let i = 0; i < 3; i += 1) {
      await answer(ph, q, response);
      done.add(q._id);
      if (i === 2) break;
      // The phone asks for its next question, as the real one does after a result.
      const waitNext = ph.questions.until((p) => !done.has(p.question._id));
      ph.s.emit('student:next', {});
      q = (await waitNext).question;
    }
    ph.s.disconnect();
  };
  await answerAll('A02', 3);
  await answerAll('A01', 3);
  await answerAll('M01', 3);
  await answerAll('A03', 1);
  const report = await get(`/api/session/${collusionCode}/exam/collusion`);
  check('two students with the same wrong answer to the same three questions, close together, are listed once, in roll order',
    report.status === 200 && report.body.pairs?.length === 1
    && JSON.stringify(report.body.pairs[0].students.map((s) => s.rollNo)) === '["A01","A02"]' && report.body.pairs[0].matches === 3,
    JSON.stringify(report.body.pairs));
  check('named from the class list, as "signals worth a look, not proof", with the rule',
    report.body.pairs?.[0]?.students?.[0]?.name === 'Asha' && /Signals worth a look, not proof/.test(report.body.note ?? '')
    && report.body.rule?.minMatches === 3 && report.body.rule?.closeSeconds === 60);
  check('the student marked under 18, who gave the same answers, is in no pair', !JSON.stringify(report.body.pairs).includes('M01'));
  check('the right answers of a third student match nobody', !JSON.stringify(report.body.pairs).includes('A03'));
  const hod = await get(`/api/session/${collusionCode}/exam/collusion`, 'hod');
  const other = await get(`/api/session/${collusionCode}/exam/collusion`, 'profB');
  check('the HOD reads it; another professor gets the room\'s 404; a phone is 401',
    hod.status === 200 && other.status === 404 && (await get(`/api/session/${collusionCode}/exam/collusion`, null)).status === 401);
}

console.log('\nnowhere else: the projector, the phones, the CSV, the archive; and the purge');
{
  const wallText = JSON.stringify(wallLog);
  check('the projector heard no signal, no picture and no exam setting',
    wallLog.length > 0 && !wallLog.some((e) => e.event === 'teacher:integrity')
    && !/integrity|snapshot|timing_anomaly|second_device|screenshot_attempt|configKey|notice/.test(wallText) && !wallText.includes(PIXELS) && !wallText.includes(KEY),
    wallLog.map((e) => e.event).join(','));
  const phoneText = JSON.stringify(phoneLog);
  check('no phone heard the staff feed, a signal, a picture or a key',
    !phoneLog.some((e) => e.event === 'teacher:integrity') && !phoneText.includes(PIXELS) && !phoneText.includes(KEY)
    && !/timing_anomaly|second_device|snapshot_missing|"integrity"/.test(phoneText));

  const csv = await get(`/api/session/${code}/export`);
  const text = csv.body.text ?? '';
  check('the CSV carries no picture, no key and nothing about the student marked under 18',
    csv.status === 200 && !text.includes(PIXELS) && !text.includes(PICTURE.toString('base64').slice(0, 40)) && !text.includes(KEY)
    && !/Copying was blocked/.test(text.split('\r\n').find((l) => l.startsWith('M01')) ?? ''), text.slice(0, 200));

  // The purge, with the clock run forward: kept while the room runs, kept for
  // two hours after the close, and gone after.
  await sweepSnapshots(Date.now() + 10 * SNAPSHOT_KEEP_MS);
  check('a running room keeps its pictures, whatever the clock says', snapshots.latest(sessionId, 'A01') !== null);
  const closed = await post(`/api/session/${code}/close`, {});
  const closedAt = Date.parse(closed.body.session?.closedAt ?? '');
  await sweepSnapshots(closedAt + SNAPSHOT_KEEP_MS - 60_000);
  check('a closed room keeps them for two hours', (await get(`/api/session/${code}/exam/snapshots/A01`)).status === 200);
  const late = await emitAck(asha.s, 'student:snapshot', { jpeg: PICTURE }).catch(() => ({ ok: false, reason: 'no reply' }));
  check('a closed room takes no new picture', late.ok === false);
  await sweepSnapshots(closedAt + SNAPSHOT_KEEP_MS);
  check('two hours after the close they are purged', snapshots.latest(sessionId, 'A01') === null
    && (await get(`/api/session/${code}/exam/snapshots/A01`)).status === 404);
  const shut = await patch(`/api/session/${code}/exam`, { examMode: { on: false } });
  check('a closed room\'s exam mode can no longer change (409)', shut.status === 409);

  // Delete: a second exam room with a picture, deleted; the picture goes at once,
  // and the archive holds none of it.
  const roomD = await post('/api/session', { contentId: content._id, examMode: EXAM });
  const ph = await join(roomD.body.code, 'D01');
  await emitAck(ph.s, 'student:screen', { state: 'started', surface: 'monitor' });
  const taken = await emitAck(ph.s, 'student:snapshot', { jpeg: PICTURE });
  check('a picture in another exam room', taken.ok === true && snapshots.latest(roomD.body.sessionId, 'D01') !== null);
  ph.s.emit('student:signal', { kind: 'copy_attempt' });
  await settle();
  ph.s.disconnect();
  await settle();
  const gone = await del(`/api/session/${roomD.body.code}?confirm=${roomD.body.code}`);
  check('deleting the room purges its pictures at once', gone.status === 200 && snapshots.latest(roomD.body.sessionId, 'D01') === null);
  const archive = await get(`/api/session/archives/${gone.body.archive?.id}`);
  const archived = JSON.stringify(archive.body);
  check('its archive keeps the signals as every archive does, and no picture, no picture time and no key',
    archive.status === 200 && archived.includes('copy_attempt') && !archived.includes(PIXELS) && !archived.includes(PICTURE.toString('base64').slice(0, 40))
    && !/snapshotAt|jpeg/.test(archived) && !archived.includes(KEY), archived.slice(0, 200));
  const goneA = await del(`/api/session/${code}?confirm=${code}`);
  const archiveA = JSON.stringify((await get(`/api/session/archives/${goneA.body.archive?.id}`)).body);
  check('nor does the first exam room\'s, its Safe Exam Browser key included', goneA.status === 200 && !archiveA.includes(PIXELS) && !archiveA.includes(KEY)
    && !/snapshotAt|configKeyHashes/.test(archiveA));
}

check('nothing left this machine (refusedOffMachine is 0)', refusedOffMachine === 0, String(refusedOffMachine));

for (const s of [...phones, teacher, hodScreen, wall]) s.disconnect();
io.close();
server.close();
await closeStore?.();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
