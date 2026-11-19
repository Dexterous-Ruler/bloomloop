// Phase 3 - live insights, the student card and class analytics, end to end.
//
//   node server/scripts/insights.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with real phones, a teacher screen and a
// projector over Socket.io. A class of six; a Mixed room in which four phones
// answer a scripted run of right and wrong answers and the professor records
// observations, a wheel pick, a tally and an activity; then a second room of the
// class. It checks, against counts worked out by hand in this file:
//
//   bands      each student's band, and "not enough answers yet" below three
//   cards      Focus, Support and Participation: their text, ids and actions;
//              a dismissal holds while the evidence stands and lifts when it
//              changes
//   KPIs       class accuracy, the support count and participation, each with
//              its change since the start, and the series
//   records    the teacher records' own counts in a Mixed room, never added in
//   push       teacher:insights reaches the teacher screen, throttled, and ends
//              on the state the route reads
//   card       one student's band, level, accuracy per level, last answers,
//              planned next set and records; a roster student with no phone
//   analytics  the class across its two rooms: trend, histogram, level bands,
//              attendance, the hardest questions; empty for a class with no room
//   access     an HOD reads all of it; another professor, an HOD of another
//              department and a student get nothing, in the same words as for
//              something that does not exist
//   privacy    nothing of it reaches a phone or the projector
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
const { INSIGHTS_PRIVACY, INSIGHTS_PUSH_MS } = await import(`${SRC}services/insights.js`);

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
const account = (id, role, department, reportsTo) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-INSG0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: role === 'student' ? '21CS01' : null, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.student, 'student', 'CSE', ID.profA),
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
    throw new Error(`insights.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by insights.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'insights-test-service-key';

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
const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;

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

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** Poll until `fn` gives something truthy, or give up after `ms`. */
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got || Date.now() > end) return got;
    await settle(100);
  }
}

// Every event every phone receives, and every event every projector receives.
const phoneEvents = [];
const wallEvents = [];

/** A phone joins; resolves with its socket and the first question. */
async function join(code, rollNo, name = '') {
  const s = await connect();
  s.onAny((event, ...args) => phoneEvents.push({ rollNo, event, args }));
  const first = either(s, ['session:accepted', 'session:rejected', 'session:teacher-led']);
  const item = either(s, ['server:question', 'server:waiting', 'server:exhausted']);
  s.emit('student:join', { code, rollNo, name });
  const told = await first;
  return { s, rollNo, told, served: told.name === 'session:accepted' ? (await item).payload : null };
}

const answerKey = () => crypto.randomBytes(8).toString('hex');

/**
 * One phone answers its scripted run: true is right (every fixture question's
 * key is option 1), false is wrong (option 0). Asks for the next question after
 * each answer but the last, so no question is left pinned.
 */
async function answerRun(phone, run) {
  const levels = [];
  for (let i = 0; i < run.length; i += 1) {
    const result = next(phone.s, 'server:result');
    phone.s.emit('student:answer', { questionId: phone.served.question._id, response: run[i] ? 1 : 0, answerId: answerKey() });
    const r = await result;
    levels.push(phone.served.question.bloom);
    if (r.retry) throw new Error('a retry: this room has no reattempts');
    if (i < run.length - 1) {
      const got = either(phone.s, ['server:question', 'server:exhausted']);
      phone.s.emit('student:next', {});
      phone.served = (await got).payload;
    }
  }
  return levels;
}

// ------------------------------------------------------------ fixtures --

const OPTIONS = ['Inorder', 'Preorder', 'Postorder', 'Level-order'];

/** A chapter of professor A's: two Remember, six Understand and four Apply questions, every key option 1. */
async function chapter(title) {
  const content = await repo.createContent({ title, kind: 'syllabus', rawText: '', topics: ['Trees'], ownerId: ID.profA });
  const mcq = (i, bloom) => ({
    contentId: content._id, topic: 'Trees', text: `${title}: which traversal is step ${i}?`, kind: 'mcq',
    options: OPTIONS, answerIdx: 1, bloom, source: 'llm', status: 'active',
  });
  const qs = await repo.insertQuestions([
    ...Array.from({ length: 2 }, (_, i) => mcq(i, 'remember')),
    ...Array.from({ length: 6 }, (_, i) => mcq(i + 2, 'understand')),
    ...Array.from({ length: 4 }, (_, i) => mcq(i + 8, 'apply')),
  ]);
  return { content, questions: qs };
}

const NOWHERE = 'ZZZZZZ';
const NO_CLASS = 'ffffffffffffffffffffffff';
const ROSTER = [
  { roll: '21CS01', name: 'Asha Rao' }, { roll: '21CS02', name: 'Bilal Khan' }, { roll: '21CS03', name: 'Chitra Iyer' },
  { roll: '21CS04', name: 'Dev Menon' }, { roll: '21CS05', name: 'Esha Pillai' }, { roll: '21CS06', name: 'Farhan Ali' },
];

const made = await post('/api/classes', { courseName: 'Data Structures', section: 'SY-CS A' });
const classId = made.body.class?.id;
await post(`/api/classes/${classId}/students`, { students: ROSTER });
const sid = Object.fromEntries(((await get(`/api/classes/${classId}`)).body.students ?? []).map((s) => [s.rollNo, s.id]));
const A = await chapter('Trees');
check('fixtures: a class of six and a chapter of twelve', made.status === 201 && Object.keys(sid).length === 6 && A.questions.length === 12,
  `HTTP ${made.status}`);

// ------------------------------------------------------------ room one --

console.log('\nroom one: a Mixed class room, scripted');
const one = (await post('/api/session', { contentId: A.content._id, classId, mode: 'mixed' })).body;
const code = one.code;

// A teacher screen, collecting every grid and insights push.
const teacher = await connect();
const pushes = [];
let grids = 0;
teacher.on('teacher:insights', (p) => pushes.push({ at: Date.now(), p }));
teacher.on('teacher:grid', () => { grids += 1; });
const firstPush = next(teacher, 'teacher:insights');
teacher.emit('teacher:watch', { code, token: TOKENS.profA });
const atWatch = await firstPush.catch(() => null);
check('a teacher screen gets teacher:insights as soon as it watches', Boolean(atWatch?.kpis) && atWatch?.privacy === INSIGHTS_PRIVACY);

// The projector, on the class's progress, so it is pushed after every answer.
const link = await post(`/api/session/${code}/projector/links`, {});
const wall = await connect();
wall.onAny((event, ...args) => wallEvents.push({ event, payload: args[0] }));
const watched = next(wall, 'projector:state');
wall.emit('projector:watch', { token: link.body.token });
await watched;
await patch(`/api/session/${code}/projector`, { mode: 'progress' });

// Attendance before any phone: 01 to 05 present, 06 absent. 05 never joins.
await post(`/api/session/${code}/attendance`, {
  marks: [...ROSTER.slice(0, 5).map((s) => ({ studentId: sid[s.roll], status: 'present' })), { studentId: sid['21CS06'], status: 'absent' }],
});

const phones = {};
for (const s of ROSTER.slice(0, 4)) phones[s.roll] = await join(code, s.roll, s.name.split(' ')[0]);
check('four phones join and are served', Object.values(phones).every((p) => p.served?.question?._id));

// The script. 01's run comes first, so the first graded answer in the room is
// right (class accuracy's start is 100%) and the first band is 01's Excelling
// (the support count's start is 0).
//   01  R R R R R   5/5   Excelling, promoted to Apply after three
//   02  R W W R W   2/5   Developing (40% exactly), at Understand
//   03  W W W       0/3   Needs support, held at Understand
//   04  W R         1/2   no band yet: two answers
//   05  present, no phone: has not answered
const SCRIPT = {
  '21CS01': [true, true, true, true, true],
  '21CS02': [true, false, false, true, false],
  '21CS03': [false, false, false],
  '21CS04': [false, true],
};
const gridsBefore = grids;
const pushesBefore = pushes.length;
const t0 = Date.now();
const levelsSeen = {};
for (const [roll, run] of Object.entries(SCRIPT)) levelsSeen[roll] = await answerRun(phones[roll], run);
const burst = Date.now() - t0;
check('01 was served Understand three times, then Apply twice', levelsSeen['21CS01'].join() === 'understand,understand,understand,apply,apply',
  levelsSeen['21CS01'].join());
check('02, 03 and 04 were served Understand only', ['21CS02', '21CS03', '21CS04'].every((r) => levelsSeen[r].every((l) => l === 'understand')),
  JSON.stringify(levelsSeen));

let ins = (await get(`/api/session/${code}/insights`)).body;
const st = Object.fromEntries((ins.students ?? []).map((s) => [s.rollNo, s]));

console.log('\nbands, against the hand counts');
check('01 Excelling (5 of 5), 02 Developing (2 of 5, 40% exactly), 03 Needs support (0 of 3)',
  st['21CS01']?.band === 'excelling' && st['21CS02']?.band === 'developing' && st['21CS03']?.band === 'needs-support'
  && st['21CS02']?.accuracy === 0.4, JSON.stringify(Object.values(st).map((s) => [s.rollNo, s.band, s.correct, s.answers])));
check('04, with two answers, has no band: not enough answers yet', st['21CS04']?.band === null
  && /2 graded answers so far; a band needs at least 3/.test(st['21CS04']?.reason ?? ''), st['21CS04']?.reason);
check('the counts', JSON.stringify(ins.counts) === JSON.stringify({ 'needs-support': 1, developing: 1, excelling: 1, notEnough: 1, students: 4 }),
  JSON.stringify(ins.counts));
check('the roster\'s names, and who is present', st['21CS02']?.rosterName === 'Bilal Khan' && Object.values(st).every((s) => s.present));
check('the three sort orders', JSON.stringify(ins.sort?.orders) === JSON.stringify({
  band: ['21CS03', '21CS02', '21CS01', '21CS04'],
  lowest: ['21CS03', '21CS02', '21CS04', '21CS01'],
  roll: ['21CS01', '21CS02', '21CS03', '21CS04'],
}), JSON.stringify(ins.sort?.orders));
check('the cut points and the floor travel with the read', ins.thresholds?.needsSupportBelow === 0.4
  && ins.thresholds?.excellingFrom === 0.6 && ins.thresholds?.minAnswers === 3);

console.log('\nthe cards, against the hand counts');
const card = (kind, body = ins) => body.cards?.find((c) => c.kind === kind);
// Working levels: 01 Apply; 02, 03, 04 Understand. Understand answers: 3 + 5 + 3 + 2 = 13, right 3 + 2 + 0 + 1 = 6.
const grid = (await get(`/api/session/${code}/grid`)).body.rows;
const working = Object.fromEntries(grid.map((r) => [r.rollNo, r.workingLevel]));
check('the grid agrees on the working levels', JSON.stringify(working)
  === JSON.stringify({ '21CS01': 'apply', '21CS02': 'understand', '21CS03': 'understand', '21CS04': 'understand' }), JSON.stringify(working));
check('Focus: 3 at Understand, 6 of 13 right there, "Ask Understand"', card('focus')?.text
  === '3 students are working at Understand, the most at any level. 6 of the 13 Understand answers in this room were right.'
  && card('focus')?.action?.label === 'Ask Understand' && card('focus')?.flagId === 'focus:understand', card('focus')?.text);
check('Support: 1 below 40%, 1 more than at the start (0, when 01 was first banded), "Show them"', card('support')?.text
  === '1 student is below 40% overall, 1 more than at the start.' && card('support')?.action?.label === 'Show them'
  && /^support:[0-9a-f]{16}$/.test(card('support')?.flagId ?? ''), card('support')?.text);
check('Participation: 05 is present and has not answered', card('participation')?.text
  === '1 present student has not answered yet in this room.' && card('participation')?.evidence === `5 present · room ${code}`,
card('participation')?.text);
check('no card is dismissed yet, and none predicts', ins.cards?.every((c) => c.dismissed === false && c.lastAction === null)
  && !/risk|fail|likely|will |slow|predict/i.test(JSON.stringify(ins.cards)));

console.log('\nthe KPIs and the change since the start');
const k = ins.kpis ?? {};
// Accuracy: mean of 5/5, 2/5, 0/3, 1/2 = 0.475; its start was 01's first answer, right: 1.
check('class accuracy 47.5% (the mean of each student\'s), from 15 answers by 4 students; started at 100% from 1 answer',
  near(k.accuracy?.value, 0.475) && k.accuracy?.answers === 15 && k.accuracy?.students === 4
  && k.accuracy?.start?.value === 1 && k.accuracy?.start?.answers === 1 && near(k.accuracy?.change, -0.525), JSON.stringify(k.accuracy));
check('Needs support 1, of 3 with a band; started at 0', k.support?.value === 1 && k.support?.banded === 3
  && k.support?.start?.value === 0 && k.support?.change === 1, JSON.stringify(k.support));
check('participation 4 of 5 present; started at 0 when attendance was taken', near(k.participation?.value, 0.8)
  && k.participation?.present === 5 && k.participation?.answered === 4 && k.participation?.start?.value === 0
  && near(k.participation?.change, 0.8), JSON.stringify(k.participation));
const lastPoint = ins.series?.points?.at(-1);
check('the series is per minute and ends on the figures now', ins.series?.interval === 'minute' && ins.series?.points?.length >= 1
  && near(lastPoint?.accuracy, 0.475) && lastPoint?.support === 1 && near(lastPoint?.participation, 0.8), JSON.stringify(ins.series));

console.log('\nthe push to the teacher screen');
const settled = await until(() => {
  const last = pushes.at(-1)?.p;
  return last && near(last.kpis?.accuracy?.value, 0.475) && last.counts?.notEnough === 1 ? last : null;
});
check('teacher:insights arrives after the answers and ends on what the route reads', Boolean(settled)
  && JSON.stringify(settled.cards) === JSON.stringify(ins.cards) && JSON.stringify(settled.counts) === JSON.stringify(ins.counts));
const during = pushes.length - pushesBefore;
const gridDuring = grids - gridsBefore;
check(`throttled: ${during} pushes for ${gridDuring} grid updates over ${burst} ms`, during >= 1 && during < gridDuring
  && during <= Math.ceil(burst / INSIGHTS_PUSH_MS) + 2, `${during} / ${gridDuring}`);

console.log('\nteacher records, counted apart');
await post(`/api/session/${code}/observations`, { rollNo: '21CS03', kind: 'support', note: 'Mixed up the traversals' });
await post(`/api/session/${code}/observations`, { rollNo: '21CS01', kind: 'understood' });
const draw = await post(`/api/session/${code}/wheel/draw`, {});
await patch(`/api/session/${code}/wheel/picks/${draw.body.pick?.id}`, { status: 'answered' });
const tally = await post(`/api/session/${code}/tallies`, { text: 'Which traversal gives sorted output?', labels: OPTIONS, correct: 'A' });
for (const option of ['A', 'A', 'B']) await post(`/api/session/${code}/tallies/${tally.body.tally?.id}/increment`, { option });
await post(`/api/session/${code}/activities`, { kind: 'think', outcome: 'Most could explain preorder' });
ins = (await get(`/api/session/${code}/insights`)).body;
const tr = ins.teacherRecords ?? {};
check('hands raised, answered aloud and observations by kind, under their own label',
  tr.label === 'Teacher records' && tr.handsRaised?.questions === 1 && tr.handsRaised?.hands === 3 && tr.answeredAloud === 1
  && tr.observations?.support === 1 && tr.observations?.understood === 1 && tr.observations?.observed === 2 && tr.activities === 1,
  JSON.stringify(tr));
check('and none of it moved a band, a card or a KPI', near(ins.kpis?.accuracy?.value, 0.475) && ins.kpis?.support?.value === 1
  && JSON.stringify(ins.counts) === JSON.stringify({ 'needs-support': 1, developing: 1, excelling: 1, notEnough: 1, students: 4 })
  && card('support', ins)?.text === '1 student is below 40% overall, 1 more than at the start.');

console.log('\nthe student card');
{
  const c = (await get(`/api/session/${code}/students/21CS02/card`)).body;
  check('02: name from the roster, Developing from 2 of 5, on Understand', c.student?.name === 'Bilal Khan' && c.band?.id === 'developing'
    && c.band?.answers === 5 && c.band?.correct === 2 && c.serving?.level === 'understand' && c.serving?.ceiling === false,
  JSON.stringify([c.student, c.band, c.serving]));
  const u = c.levels?.find((l) => l.level === 'understand');
  check('accuracy per level, with the answers behind each, and the class\'s beside it', c.levels?.length === 6
    && u?.answers === 5 && u?.correct === 2 && u?.class?.answers === 13 && u?.class?.correct === 6
    && c.levels.filter((l) => l.level !== 'understand').every((l) => l.answers === 0), JSON.stringify(u));
  check('the last answers, newest first, in the professor\'s view (with the snapshot)', c.lastAnswers?.items?.length === 5
    && c.lastAnswers.items.map((a) => a.correct).join() === 'false,true,false,false,true'
    && c.lastAnswers.items.every((a) => a.student?.rollNo === '21CS02' && a.snapshot && a.final), JSON.stringify(c.lastAnswers?.items?.map((a) => a.correct)));
  // 02 has seen five of the six Understand questions and is out of the band: one
  // Understand, then the cushion level below (both Remember), then up to Apply.
  check('the next set is the selector\'s plan, marked as a plan', c.nextSet?.planned === true
    && c.nextSet?.summary === '1 Understand · 2 Remember review · 2 Apply stretch' && /plan, not a promise/.test(c.nextSet?.note ?? ''),
  c.nextSet?.summary);

  const c3 = (await get(`/api/session/${code}/students/21CS03/card`)).body;
  check('03: Needs support, under the ceiling; the plan never goes above Understand', c3.band?.id === 'needs-support'
    && c3.serving?.ceiling === true && JSON.stringify(c3.serving?.eligible) === '["remember","understand"]'
    && c3.nextSet?.summary === '3 Understand · 2 Remember review', JSON.stringify([c3.serving, c3.nextSet?.summary]));
  check('03\'s card carries this room\'s observation of them, staff-only', c3.records?.observation?.current?.kind === 'support'
    && c3.records?.observation?.current?.note === 'Mixed up the traversals' && typeof c3.records?.privacy === 'string');
  const picked = draw.body.pick?.rollNo;
  const pc = (await get(`/api/session/${code}/students/${encodeURIComponent(picked)}/card`)).body;
  check('the picked student\'s card carries the pick and how they responded', pc.records?.picks?.length === 1
    && pc.records.picks[0].statusLabel === 'Answered', `${picked}: ${JSON.stringify(pc.records?.picks)}`);

  const c5 = await get(`/api/session/${code}/students/21CS05/card`);
  check('05, on the roster with no phone: a card with no band, no level and no plan', c5.status === 200
    && c5.body.student?.joined === false && c5.body.student?.attendance === 'present' && c5.body.band?.id === null
    && c5.body.serving === null && c5.body.nextSet === null && c5.body.lastAnswers?.items?.length === 0);
  const lower = await get(`/api/session/${code}/students/${encodeURIComponent(' 21cs02 ')}/card`);
  check('a roll number typed in any case and spacing finds the same student', lower.body.student?.rollNo === '21CS02');
  const nobody = await get(`/api/session/${code}/students/ZZ99/card`);
  check('a roll number neither joined nor on the roster is a 404', nobody.status === 404 && nobody.body.error === 'That student was not found.');
}

console.log('\ndismissing a card');
{
  const support = card('support');
  const focus = card('focus');
  for (const c of [support, focus]) {
    await post(`/api/session/${code}/insights/actions`, { flagId: c.flagId, action: 'dismissed', note: 'Seen it' });
  }
  ins = (await get(`/api/session/${code}/insights`)).body;
  check('dismissed cards say so, with what was done and when', card('support', ins)?.dismissed === true
    && card('support', ins)?.lastAction?.action === 'dismissed' && card('focus', ins)?.dismissed === true
    && card('participation', ins)?.dismissed === false);

  // 04 answers two more, both wrong: 1 of 4, so 04 enters Needs support. The
  // bottleneck stays Understand.
  const levels4 = await (async () => {
    const got = either(phones['21CS04'].s, ['server:question', 'server:exhausted']);
    phones['21CS04'].s.emit('student:next', {});
    phones['21CS04'].served = (await got).payload;
    return answerRun(phones['21CS04'], [false, false]);
  })();
  ins = (await get(`/api/session/${code}/insights`)).body;
  check('04 was served Understand and is now in Needs support', levels4.every((l) => l === 'understand')
    && ins.students?.find((s) => s.rollNo === '21CS04')?.band === 'needs-support');
  check('a student entering Needs support is new evidence: the Support card is back, with a new id', card('support', ins)?.dismissed === false
    && card('support', ins)?.flagId !== support.flagId && card('support', ins)?.text === '2 students are below 40% overall, 2 more than at the start.',
  card('support', ins)?.text);
  check('the bottleneck did not move: Focus stays dismissed though its counts moved', card('focus', ins)?.flagId === focus.flagId
    && card('focus', ins)?.dismissed === true && /15 Understand answers/.test(card('focus', ins)?.text ?? ''), card('focus', ins)?.text);
  await post(`/api/session/${code}/insights/actions`, { flagId: focus.flagId, action: 'acted', note: 'Asked an Understand question aloud' });
  ins = (await get(`/api/session/${code}/insights`)).body;
  check('acting on a dismissed card ends the dismissal: the latest action wins', card('focus', ins)?.dismissed === false
    && card('focus', ins)?.lastAction?.action === 'acted');
  check('the KPIs moved with the answers: accuracy 41.25%, support 2', near(ins.kpis?.accuracy?.value, (1 + 0.4 + 0 + 0.25) / 4)
    && ins.kpis?.support?.value === 2 && ins.kpis?.support?.change === 2);
}

// ------------------------------------------------------------ room two --

console.log('\nroom two, and the class across both');
const two = (await post('/api/session', { contentId: A.content._id, classId })).body;
{
  // Attendance by joining: 01, 02, 03 and 05; 04 and 06 never come.
  //   01  R R R   3/3      02  R R W   2/3      03  W W R   1/3      05  R W   1/2
  const SCRIPT2 = { '21CS01': [true, true, true], '21CS02': [true, true, false], '21CS03': [false, false, true], '21CS05': [true, false] };
  for (const [roll, run] of Object.entries(SCRIPT2)) {
    const p = await join(two.code, roll, roll);
    await answerRun(p, run);
    p.s.disconnect();
  }
  // A room of nobody's class, which the class's analytics must not count.
  const loose = (await post('/api/session', { contentId: A.content._id })).body;
  const lp = await join(loose.code, '21CS01', 'Asha');
  await answerRun(lp, [false, false, false]);
  lp.s.disconnect();
}

const an = (await get(`/api/classes/${classId}/analytics`)).body;
const [r1, r2] = an.rooms ?? [];
check('the class\'s two rooms, oldest first; the room with no class is not one of them', an.last === 4 && an.rooms?.length === 2
  && r1?.code === code && r2?.code === two.code, JSON.stringify(an.rooms?.map((r) => r.code)));
check('accuracy per room, with the answers behind it: 41.25% from 17, then 62.5% from 11', near(r1?.accuracy?.value, 0.4125)
  && r1?.accuracy?.answers === 17 && near(r2?.accuracy?.value, (1 + 2 / 3 + 1 / 3 + 0.5) / 4) && r2?.accuracy?.answers === 11,
JSON.stringify([r1?.accuracy, r2?.accuracy]));
check('the trend: up 21.25 points over the two rooms', near(an.trend?.accuracy?.change, 0.625 - 0.4125)
  && near(an.trend?.participation?.first, 0.8) && near(an.trend?.participation?.last, 1), JSON.stringify(an.trend));
check('attendance per room: "5 / 6 present" by hand, "4 / 6 present" by joining', r1?.attendance?.summary === '5 / 6 present'
  && r1?.attendance?.absent === 1 && r2?.attendance?.summary === '4 / 6 present' && r2?.attendance?.unmarked === 2,
JSON.stringify([r1?.attendance, r2?.attendance]));
check('participation per room: 4 of 5 present answered, then 4 of 4', near(r1?.participation?.value, 0.8)
  && r1?.participation?.notAnswered === 1 && near(r2?.participation?.value, 1) && r2?.participation?.present === 4);
check('the bands per room', JSON.stringify(r1?.bands) === JSON.stringify({ 'needs-support': 2, developing: 1, excelling: 1, notEnough: 0 })
  && JSON.stringify(r2?.bands) === JSON.stringify({ 'needs-support': 1, developing: 0, excelling: 2, notEnough: 1 }),
JSON.stringify([r1?.bands, r2?.bands]));
// Pooled over both rooms: 01 8/8, 02 4/8, 03 1/6, 04 1/4; 05 has 2 answers.
const buckets = an.histogram?.buckets?.map((b) => b.students).join();
check('the histogram pools each student over both rooms: buckets 1, 2, 5 and 9, and 05 below the floor',
  buckets === '0,1,1,0,0,1,0,0,0,1' && an.histogram?.notEnough === 1 && an.histogram?.answers === 26
  && an.histogram?.legend?.map((l) => l.students).join() === '2,1,1', `${buckets} ${JSON.stringify(an.histogram?.legend)}`);
const lv = (r, level) => r?.levels?.find((l) => l.level === level);
const lb = (r, id) => r?.levelBands?.find((b) => b.id === id);
check('level by level per room, and the three level bands: 6 of 15 Understand then 7 of 11',
  lv(r1, 'understand')?.answers === 15 && lv(r1, 'understand')?.correct === 6 && lv(r1, 'apply')?.correct === 2
  && lv(r2, 'understand')?.answers === 11 && lv(r2, 'understand')?.correct === 7
  && lb(r1, 'lower')?.answers === 15 && lb(r1, 'middle')?.answers === 2 && lb(r1, 'higher')?.answers === 0
  && lb(an, 'lower')?.answers === 26 && lb(an, 'lower')?.correct === 13, JSON.stringify([lv(r1, 'understand'), lv(r2, 'understand')]));
// The hardest questions, worked out here from the answer rows themselves.
{
  const rows = await repo.listAnswers({ sessionIds: [one.sessionId, two.sessionId], final: true });
  const per = new Map();
  for (const a of rows) {
    const t = per.get(String(a.questionId)) ?? { id: String(a.questionId), n: 0, right: 0 };
    t.n += 1;
    if (a.correct === true) t.right += 1;
    per.set(t.id, t);
  }
  const want = [...per.values()].filter((t) => t.n >= 5)
    .sort((a, b) => a.right / a.n - b.right / b.n || b.n - a.n || a.id.localeCompare(b.id)).slice(0, 10).map((t) => t.id);
  const got = an.hardest?.items?.map((i) => i.questionId) ?? [];
  check(`the hardest questions, from at least 5 answers each, lowest share right first (${got.length})`, got.length > 0
    && JSON.stringify(got) === JSON.stringify(want) && an.hardest.items.every((i) => i.attempts >= 5 && !('distribution' in i)),
  `${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
}
check('decision 6 is left to the screen: both views, and what each band is', an.levels?.length === 6 && an.levelBands?.length === 3
  && an.definitions?.levelBands?.length === 3 && an.definitions?.accuracyBands?.length === 3);
const an8 = await get(`/api/classes/${classId}/analytics?last=8`);
const an5 = await get(`/api/classes/${classId}/analytics?last=5`);
check('?last=8 takes up to eight rooms; anything but 4 or 8 is a 400', an8.status === 200 && an8.body.rooms?.length === 2
  && an5.status === 400 && /last must be 4 or 8/.test(an5.body.error ?? ''));
const empty = await post('/api/classes', { courseName: 'Algorithms', section: 'SY-CS B' });
const anEmpty = await get(`/api/classes/${empty.body.class?.id}/analytics`);
check('a class with no rooms answers empty series, not an error', anEmpty.status === 200 && anEmpty.body.rooms?.length === 0
  && anEmpty.body.histogram?.students === 0 && anEmpty.body.hardest?.items?.length === 0 && anEmpty.body.trend?.accuracy?.change === null);

// ---------------------------------------------------------------- access --

console.log('\nwho may read it');
{
  const paths = [`/api/session/${code}/insights`, `/api/session/${code}/students/21CS02/card`];
  const nowhere = [`/api/session/${NOWHERE}/insights`, `/api/session/${NOWHERE}/students/21CS02/card`];
  for (let i = 0; i < paths.length; i += 1) {
    const [other, missing, hod, hodOther, student, none] = await Promise.all([
      get(paths[i], 'profB'), get(nowhere[i], 'profA'), get(paths[i], 'hod'), get(paths[i], 'hodOther'),
      get(paths[i], 'student'), get(paths[i], null),
    ]);
    check(`${paths[i].split('/').slice(4).join('/')}: another professor gets the same 404 as a room that does not exist`,
      other.status === 404 && missing.status === 404 && other.body.error === missing.body.error
      && other.body.error === 'That room was not found.', `${other.status} ${other.body.error} / ${missing.body.error}`);
    check('  an HOD of the department reads it; an HOD of another gets the 404; a student 403; nobody 401',
      hod.status === 200 && hodOther.status === 404 && hodOther.body.error === missing.body.error && student.status === 403 && none.status === 401,
      [hod, hodOther, student, none].map((r) => r.status).join(', '));
  }
  const apath = `/api/classes/${classId}/analytics`;
  const [other, missing, hod, hodOther, bad] = await Promise.all([
    get(apath, 'profB'), get(`/api/classes/${NO_CLASS}/analytics`, 'profA'), get(apath, 'hod'), get(apath, 'hodOther'),
    get(`/api/classes/${classId}/analytics?last=5`, 'profB'),
  ]);
  check('class analytics: another professor gets the same 404 as a class that does not exist', other.status === 404
    && other.body.error === missing.body.error && other.body.error === 'That class was not found.', `${other.body.error} / ${missing.body.error}`);
  check('  an HOD of the department reads it, one of another does not; a bad ?last= from an outsider is still the 404',
    hod.status === 200 && hod.body.rooms?.length === 2 && hodOther.status === 404 && bad.status === 404);
}

// ------------------------------------------------------------ Teacher-led --

console.log('\na Teacher-led room');
{
  const led = (await post('/api/session', { contentId: A.content._id, classId, mode: 'teacher-led' })).body;
  await post(`/api/session/${led.code}/attendance`, { marks: ROSTER.slice(0, 3).map((s) => ({ studentId: sid[s.roll], status: 'present' })) });
  await post(`/api/session/${led.code}/observations`, { rollNo: '21CS02', kind: 'participated' });
  const body = (await get(`/api/session/${led.code}/insights`)).body;
  check('no digital answers, so no card, band or digital figure, and it says so; its records are counted',
    Array.isArray(body.cards) && body.cards.length === 0 && /Teacher-led/.test(body.cardsNote ?? '')
    && body.kpis?.accuracy?.value === null && body.kpis?.participation?.value === null
    && body.teacherRecords?.observations?.participated === 1, JSON.stringify([body.cards, body.kpis]));
  const c = await get(`/api/session/${led.code}/students/21CS02/card`);
  check('a roster student\'s card works with no phone in the room', c.status === 200 && c.body.records?.observation?.current?.kind === 'participated'
    && c.body.nextSet === null);
}

// ------------------------------------------------------------- privacy --

console.log('\nnothing of it reaches a phone or the projector');
{
  // Labels, ids, keys and sentences only the insights carry. Not the word
  // "band" alone: the engine's own reason sentence on a phone says "below-40%
  // band", as it has since before this work.
  const WORDS = ['Needs support', 'Developing', 'Excelling', 'Show them', 'Spin the wheel', 'Ask Understand', 'flagId',
    'focus:', 'support:', 'participation:', '"kpis"', '"cards"', '"teacherRecords"', '"nextSet"', 'the most at any level',
    'below 40% overall', 'Teacher records', INSIGHTS_PRIVACY];
  const leaks = (events) => events.flatMap((e, i) => {
    const text = JSON.stringify(e.args ?? e.payload ?? {});
    return WORDS.filter((w) => text.includes(w)).map((w) => `#${i} ${e.event}: ${w}`);
  });
  check(`no phone event is teacher:insights or carries an insight (${phoneEvents.length} events)`,
    phoneEvents.length > 20 && phoneEvents.every((e) => !e.event.startsWith('teacher:')) && leaks(phoneEvents).length === 0,
    leaks(phoneEvents).slice(0, 5).join('; '));
  check(`the projector got projector events only, none carrying an insight (${wallEvents.length} events)`,
    wallEvents.length > 5 && wallEvents.every((e) => e.event.startsWith('projector:')) && leaks(wallEvents).length === 0
    && !wallEvents.some((e) => /accuracy|band|score/i.test(JSON.stringify(Object.keys(e.payload?.progress ?? {})))),
    leaks(wallEvents).slice(0, 5).join('; '));
  check('the projector was live through the answers (it shows the class\'s progress as counts)',
    wallEvents.some((e) => e.payload?.progress?.answered === 4));
  const pub = await get(`/api/session/${code}`, null);
  check('the phones\' own read of the room carries none of it', pub.status === 200 && leaks([{ payload: pub.body }]).length === 0);
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
for (const s of sockets) s.disconnect();
globalThis.fetch = realFetch;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
