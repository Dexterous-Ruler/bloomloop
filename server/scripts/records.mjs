// Phase 3 - the teacher-record store, end to end.
//
//   node server/scripts/records.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with real phones over Socket.io, and
// checks:
//
//   teacher-led  a room opened for a class with no phone joined: the wheel draws
//                from the roster's attendance, and every record works
//   wheel        present only, no repeats, rounds kept, "N picked of M", the
//                pick's ask and its five responses, Absent carried into
//                attendance, a closed room draws nothing
//   observations one per student per class per day: setting replaces, clearing
//                is allowed, and every change stays in the day's log; shared by
//                the class's rooms of one day; one student across days
//   tally        counts per option never go below 0; "N of M present responded"
//   activities   the five kinds; a group challenge records groups, not students
//   insights     what was done about a flag, append-only
//   who          another professor gets the same 404 as for nothing at all; an
//                HOD of the department reads and cannot write; a student and
//                no credentials are refused
//   phones       a phone's socket receives no record of any kind (every event it
//                gets is kept and searched), GET /api/session/:code shows none,
//                and no record moves a student's level
//   no class     a room opened for no class keys records to its phones' roll numbers
//   archive      a deleted room's archive holds every record, its log included
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As in
// roster.mjs, the server is pointed at http://supabase.invalid (a name that can
// never resolve) and the three account calls it makes are answered here,
// in-process. Any other request off this machine is refused outright and counted.
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
  hod: 'a0000000-0000-4000-8000-000000000001',
  profA: 'a0000000-0000-4000-8000-000000000002',
  profB: 'a0000000-0000-4000-8000-000000000003',
  hodOther: 'a0000000-0000-4000-8000-000000000004',
  student: 'a0000000-0000-4000-8000-000000000005',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-TEST0${id.slice(-1)}`,
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
    throw new Error(`records.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by records.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'records-test-service-key';

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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
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

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
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

// Every event every phone receives, from the moment it connects.
const phoneEvents = [];
const phones = [];
/** A phone joins; resolves with the socket, its accepted payload and the first question. */
async function join(code, rollNo, name = '') {
  const s = await connect();
  phones.push(s);
  s.onAny((event, ...args) => phoneEvents.push({ rollNo, event, args }));
  const accepted = next(s, 'session:accepted');
  const first = next(s, 'server:question');
  s.emit('student:join', { code, rollNo, name });
  return { s, accepted: await accepted, first: await first };
}

const settle = () => new Promise((r) => setTimeout(r, 150));

// ------------------------------------------------------------ fixtures --

async function chapter(ownerId, title) {
  const content = await repo.createContent({ title, kind: 'syllabus', rawText: '', topics: ['Trees'], ownerId });
  const qs = await repo.insertQuestions(Array.from({ length: 8 }, (_, i) => ({
    contentId: content._id, topic: 'Trees', text: `Which traversal is number ${i}?`, kind: 'mcq',
    options: ['Inorder', 'Preorder', 'Postorder', 'Level-order'], answerIdx: 1, bloom: 'understand', source: 'llm', status: 'active',
  })));
  return { content, questions: qs };
}

const NOWHERE = 'ZZZZZZ'; // a room code no store holds

const made = await post('/api/classes', { courseName: 'Data Structures', section: 'SY-CS A', termLabel: 'Sem III 2026' });
const classId = made.body.class?.id;
const ROSTER = [
  { roll: '21CS01', name: 'Asha Rao' }, { roll: '21CS02', name: 'Bilal Khan' }, { roll: '21CS03', name: 'Chitra Iyer' },
  { roll: '21CS04', name: 'Dev Patil' }, { roll: '21CS05', name: 'Esha Nair' }, { roll: '21CS06', name: 'Farhan Shaikh' },
];
await post(`/api/classes/${classId}/students`, { students: ROSTER });
const rosterRead = await get(`/api/classes/${classId}`);
const sid = Object.fromEntries((rosterRead.body.students ?? []).map((s) => [s.rollNo, s.id]));
const { content: chapterA, questions: bankA } = await chapter(ID.profA, 'Trees and traversals');
const { questions: bankB } = await chapter(ID.profB, 'Signals');
check('fixtures: a class of six and a chapter of eight', made.status === 201 && Object.keys(sid).length === 6 && bankA.length === 8,
  `HTTP ${made.status}`);

const openRoom = async (body) => (await post('/api/session', { contentId: chapterA._id, ...body })).body;

// --------------------------------------------- a Teacher-led room, no phones --

console.log('\na room for the class with no phone joined: the wheel');

const led = await openRoom({ classId, title: 'Trees, teacher-led' });
const L = `/api/session/${led.code}`;
const wheelOf = async (path = L) => (await get(`${path}/wheel`)).body;
{
  const w = await wheelOf();
  check('before anything: round 1, present only and no repeats, not yet started',
    w.round?.number === 1 && w.round?.started === false && w.round?.presentOnly === true && w.round?.noRepeat === true && w.picks?.length === 0,
    JSON.stringify(w.round));
  check('nobody is marked present, so the wheel is empty and says why', w.pool?.left === 0 && /marked present/.test(w.pool?.empty ?? ''),
    JSON.stringify(w.pool));
  const none = await post(`${L}/wheel/draw`, {});
  check('a draw from an empty wheel is a 409 with that reason', none.status === 409 && /marked present/.test(none.body.error ?? ''));
}

await post(`${L}/attendance`, {
  marks: [
    { studentId: sid['21CS01'], status: 'present' }, { studentId: sid['21CS02'], status: 'present' },
    { studentId: sid['21CS03'], status: 'present' }, { studentId: sid['21CS04'], status: 'late' },
    { studentId: sid['21CS05'], status: 'absent' },
  ],
});
{
  const w = await wheelOf();
  check('attendance marked by hand: the four present (late counts) are on the wheel, "0 picked of 4"',
    w.pool?.total === 4 && w.pool?.summary === '0 picked of 4'
    && JSON.stringify(w.pool?.onWheel?.map((p) => p.rollNo)) === '["21CS01","21CS02","21CS03","21CS04"]',
    JSON.stringify(w.pool));
}

const drawn = [];
for (let i = 0; i < 4; i += 1) {
  const d = await post(`${L}/wheel/draw`, {});
  if (d.status === 201) drawn.push(d.body.pick);
  else check(`draw ${i + 1}`, false, `HTTP ${d.status} ${d.body.error ?? ''}`);
}
check('four draws with no repeats: each present student exactly once, never anyone absent or unmarked',
  drawn.length === 4 && new Set(drawn.map((p) => p.rollNo)).size === 4
  && drawn.every((p) => ['21CS01', '21CS02', '21CS03', '21CS04'].includes(p.rollNo)), JSON.stringify(drawn.map((p) => p.rollNo)));
check('each pick is stored in order, with how many were on the wheel when it was drawn',
  JSON.stringify(drawn.map((p) => [p.round, p.order, p.poolSize])) === '[[1,1,4],[1,2,3],[1,3,2],[1,4,1]]'
  && drawn.every((p) => p.status === 'pending' && p.statusLabel === 'Pending' && p.ask === 'bank' && p.pickedBy === ID.profA),
  JSON.stringify(drawn.map((p) => [p.round, p.order, p.poolSize])));
check('a pick names the roster student it drew', drawn.every((p) => p.name === ROSTER.find((r) => r.roll === p.rollNo)?.name
  && p.classStudentId === sid[p.rollNo]));
{
  const fifth = await post(`${L}/wheel/draw`, {});
  check('a fifth draw: everyone has had a turn this round (409)', fifth.status === 409 && /had a turn this round/.test(fifth.body.error ?? ''));
  const w = await wheelOf();
  check('"4 picked of 4", nobody left', w.pool?.summary === '4 picked of 4' && w.pool?.left === 0);
  const stored = await repo.listWheelPicks(led.sessionId);
  check('the picks are in the store, drawn before the reply', stored.length === 4 && stored.every((p) => p.poolSize >= 1));
}
{
  const off = await patch(`${L}/wheel`, { presentOnly: false });
  check('present only off: everyone on the roster is on the wheel, "4 picked of 6", the two left are the absent and the unmarked',
    off.status === 200 && off.body.round?.presentOnly === false && off.body.pool?.summary === '4 picked of 6'
    && JSON.stringify(off.body.pool?.onWheel?.map((p) => p.rollNo)) === '["21CS05","21CS06"]', JSON.stringify(off.body.pool));
  const d = await post(`${L}/wheel/draw`, {});
  check('and a draw comes from those two', d.status === 201 && ['21CS05', '21CS06'].includes(d.body.pick?.rollNo) && d.body.pick?.poolSize === 2);
  drawn.push(d.body.pick);
}
{
  const r2 = await post(`${L}/wheel/rounds`, {});
  check('start a new round: round 2, the settings carried over, everyone back on the wheel',
    r2.status === 201 && r2.body.round?.number === 2 && r2.body.round?.presentOnly === false && r2.body.pool?.summary === '0 picked of 6');
  check('and every pick of round 1 is still there', r2.body.picks?.length === 5 && r2.body.picks.every((p) => p.round === 1)
    && r2.body.rounds?.length === 2);
  const r3 = await post(`${L}/wheel/rounds`, { presentOnly: true, noRepeat: false });
  const a = await post(`${L}/wheel/draw`, {});
  const b = await post(`${L}/wheel/draw`, {});
  const c = await post(`${L}/wheel/draw`, {});
  const d = await post(`${L}/wheel/draw`, {});
  const e = await post(`${L}/wheel/draw`, {});
  check('round 3 with repeats allowed: five draws from four present students, the wheel never empties',
    r3.body.round?.number === 3 && [a, b, c, d, e].every((x) => x.status === 201 && x.body.pick?.poolSize === 4 && x.body.pick?.round === 3),
    [a, b, c, d, e].map((x) => `${x.status}:${x.body.pick?.rollNo}`).join(' '));
  const bad = await post(`${L}/wheel/draw`, { noRepeat: 'yes' });
  check('a setting that is not true or false is a 400', bad.status === 400);
}

console.log('\nthe pick: what was asked, and how they responded');

const pickPath = (p) => `${L}/wheel/picks/${p.id}`;
{
  const statuses = ['answered', 'passed', 'help', 'skipped'];
  const results = [];
  for (let i = 0; i < 4; i += 1) results.push(await patch(pickPath(drawn[i]), { status: statuses[i] }));
  check('the four responses: Answered, Passed to partner, Needs help, Skipped, each with when and by whom',
    JSON.stringify(results.map((r) => r.body.pick?.statusLabel)) === '["Answered","Passed to partner","Needs help","Skipped"]'
    && results.every((r) => r.status === 200 && r.body.pick?.statusAt && r.body.pick?.statusBy === ID.profA),
    results.map((r) => `${r.status} ${r.body.error ?? r.body.pick?.statusLabel}`).join(', '));
  const pending = await patch(pickPath(drawn[0]), { status: 'pending' });
  const late = await patch(pickPath(drawn[0]), { status: 'late' });
  check('pending is only where a pick starts, and nothing outside the five is taken', pending.status === 400 && late.status === 400);
  const who = await patch(pickPath(drawn[0]), { rollNo: '21CS06' });
  check('who was drawn cannot be changed: a body naming only a roll number changes nothing (400)', who.status === 400
    && (await repo.listWheelPicks(led.sessionId)).find((p) => String(p._id) === drawn[0].id)?.rollNo === drawn[0].rollNo);
  const missing = await patch(`${L}/wheel/picks/ffffffffffffffffffffffff`, { status: 'answered' });
  check('a pick that is not this room\'s is a 404', missing.status === 404);
}
{
  const q = bankA[2];
  const bank = await patch(pickPath(drawn[1]), { ask: 'bank', questionId: q._id });
  check('a bank ask names one of the room\'s questions, and the pick carries its text and level',
    bank.status === 200 && bank.body.pick?.questionId === String(q._id) && bank.body.pick?.question?.text === q.text
    && bank.body.pick?.question?.bloom === 'understand', `HTTP ${bank.status} ${bank.body.error ?? ''}`);
  const theirs = await patch(pickPath(drawn[1]), { questionId: bankB[0]._id });
  check('another professor\'s question is refused (400)', theirs.status === 400);
  const diagram = await patch(pickPath(drawn[2]), { ask: 'diagram', questionId: q._id });
  check('a diagram ask names no question (400)', diagram.status === 400);
  const demo = await patch(pickPath(drawn[1]), { ask: 'demo' });
  check('turning the bank ask into a demo drops its question', demo.body.pick?.ask === 'demo' && demo.body.pick?.questionId === null
    && demo.body.pick?.askLabel === 'Demo');
}
{
  const target = drawn[2];
  const before = (await get(`${L}/attendance`)).body.students?.find((s) => s.rollNo === target.rollNo);
  const absent = await patch(pickPath(target), { status: 'absent' });
  const after = (await get(`${L}/attendance`)).body.students?.find((s) => s.rollNo === target.rollNo);
  check('"Absent" on a pick marks the student absent in the room\'s attendance, as the professor\'s mark',
    absent.status === 200 && absent.body.pick?.statusLabel === 'Absent' && absent.body.attendance?.marked === true
    && before?.status !== 'absent' && after?.status === 'absent' && after?.source === 'teacher' && after?.markedBy === ID.profA,
    `${before?.status} -> ${after?.status}; ${JSON.stringify(absent.body.attendance)}`);
  const w = await wheelOf();
  check('so they leave the present-only wheel', !w.pool?.onWheel?.some((p) => p.rollNo === target.rollNo) && w.pool?.total === 3);
  const kept = drawn[3];
  const keep = await patch(pickPath(kept), { status: 'absent', markAttendance: false });
  const still = (await get(`${L}/attendance`)).body.students?.find((s) => s.rollNo === kept.rollNo);
  check('with markAttendance: false the pick says Absent and attendance is left alone',
    keep.body.pick?.status === 'absent' && keep.body.attendance === undefined && still?.status !== 'absent', still?.status);
}

console.log('\nobservations: one per student per class per day, every change kept');

const obs = (path, body, as) => post(`${path}/observations`, body, as);
{
  const first = await obs(L, { studentId: sid['21CS01'], kind: 'understood', note: 'Explained inorder with a family tree' });
  check('a professor marks Asha understood, with a note, in a room nobody joined',
    first.status === 200 && first.body.changed === true && first.body.current?.kind === 'understood'
    && first.body.current?.label === 'Understood' && first.body.current?.observedBy === ID.profA && first.body.day,
    `HTTP ${first.status} ${first.body.error ?? ''}`);
  const second = await obs(L, { rollNo: '21cs01', kind: 'revision' });
  check('setting another replaces the day\'s mark, and the one replaced stays in the log',
    second.body.current?.kind === 'revision' && second.body.replaced?.kind === 'understood'
    && JSON.stringify(second.body.history?.map((h) => h.kind)) === '["understood","revision"]');
  const same = await obs(L, { rollNo: '21CS01', kind: 'revision' });
  check('the same mark again writes nothing', same.body.changed === false && same.body.history?.length === 2);
  const cleared = await obs(L, { rollNo: '21CS01', kind: null });
  check('clearing it leaves no mark, and the log keeps all three', cleared.body.current === null
    && JSON.stringify(cleared.body.history?.map((h) => h.kind)) === '["understood","revision",null]');
  await obs(L, { studentId: sid['21CS05'], kind: 'support' });
  await obs(L, { studentId: sid['21CS02'], kind: 'participated' });
  const read = await get(`${L}/observations`);
  const row = (roll) => read.body.students?.find((x) => x.rollNo === roll);
  check('the room\'s read: the whole roster, each with the mark in force and the log behind it',
    read.status === 200 && read.body.students?.length === 6 && row('21CS01')?.current === null && row('21CS01')?.history?.length === 3
    && row('21CS05')?.current?.label === 'Needs additional support' && row('21CS06')?.current === null
    && row('21CS01')?.name === 'Asha Rao', JSON.stringify(read.body.counts));
  check('with the counts per kind, counted apart from anything else',
    JSON.stringify(read.body.counts) === JSON.stringify({ understood: 0, participated: 1, revision: 0, support: 1, observed: 2, students: 6 })
    && JSON.stringify(read.body.kinds?.map((k) => k.label)) === '["Understood","Participated","Needs revision","Needs additional support"]'
    && /never move a Bloom level/.test(read.body.privacy ?? ''));
  const stored = await repo.listObservations({ sessionId: led.sessionId });
  check('the store holds every set and clear as its own row', stored.length === 5);

  const bad = await Promise.all([
    obs(L, { rollNo: 'GUEST1', kind: 'understood' }),
    obs(L, { rollNo: '21CS01', kind: 'slow learner' }),
    obs(L, { rollNo: '21CS01' }),
    obs(L, { rollNo: '21CS01', kind: 'understood', note: 'n'.repeat(281) }),
    obs(L, { rollNo: '21CS01', kind: 'understood', note: 'call parent on 98450 12345' }),
    obs(L, { rollNo: '21CS01', kind: null, note: 'why' }),
  ]);
  check('refused: a roll number off the roster, a kind outside the four, no kind, a long note, a phone number, a clear with a note',
    bad.every((b) => b.status === 400), bad.map((b) => b.status).join(', '));
  check('and nothing was written by any of them', (await repo.listObservations({ sessionId: led.sessionId })).length === 5);
}

console.log('\nthe raised-hands tally');

const T = `${L}/tallies`;
let tallyId;
{
  const made1 = await post(T, { text: 'Which traversal of a BST gives sorted output?', labels: ['Inorder', 'Preorder', 'Postorder', 'Level-order'] });
  tallyId = made1.body.tally?.id;
  check('a question asked aloud, with its four options', made1.status === 201 && made1.body.tally?.seq === 1
    && JSON.stringify(made1.body.tally?.options?.map((o) => [o.key, o.label, o.count])) === '[["A","Inorder",0],["B","Preorder",0],["C","Postorder",0],["D","Level-order",0]]');
  for (const o of ['A', 'A', 'A', 'b']) await post(`${T}/${tallyId}/increment`, { option: o });
  const down = await post(`${T}/${tallyId}/decrement`, { option: 'C' });
  check('a decrement at 0 stays at 0 and says so', down.status === 200 && down.body.clamped === true
    && JSON.stringify(down.body.tally?.options?.map((o) => o.count)) === '[3,1,0,0]');
  const one = await post(`${T}/${tallyId}/decrement`, { option: 'A' });
  check('hands up and down, per option', JSON.stringify(one.body.tally?.options?.map((o) => o.count)) === '[2,1,0,0]' && one.body.clamped === false);
  const neg = await patch(`${T}/${tallyId}`, { counts: [2, -1, 0, 0] });
  check('counts set below 0 are refused (400)', neg.status === 400 && /never goes below 0/.test(neg.body.error ?? ''));
  const badOpt = await post(`${T}/${tallyId}/increment`, { option: 'E' });
  check('an option past D is refused (400)', badOpt.status === 400);
  const set = await patch(`${T}/${tallyId}`, { counts: [2, 0, 1, 0], revealed: true, correct: 'A' });
  const att = await get(`${L}/attendance`);
  const present = att.body.counts.present + att.body.counts.late;
  check('set the counts, reveal, mark the right option: "N of M present responded" from attendance',
    set.status === 200 && set.body.tally?.revealed === true && set.body.tally?.correct === 'A' && set.body.tally?.total === 3
    && present === 3 && set.body.tally?.present === 3 && set.body.tally?.summary === '3 of 3 present responded',
    `${set.body.tally?.summary}; attendance ${att.body.summary}`);
  const over = await patch(`${T}/${tallyId}`, { counts: [14, 1, 2, 0] });
  check('more hands than students marked present is said in words', over.body.tally?.summary === '17 responded, more than the 3 marked present',
    over.body.tally?.summary);
  const stored = (await repo.listTallies(led.sessionId))[0];
  check('the store never holds a count below 0', stored.counts.every((n) => n >= 0) && JSON.stringify(stored.counts) === '[14,1,2,0]');
  const fromBank = await post(T, { questionId: bankA[0]._id });
  check('a question from the room\'s bank brings its text, options and key', fromBank.status === 201 && fromBank.body.tally?.seq === 2
    && fromBank.body.tally?.text === bankA[0].text && fromBank.body.tally?.options?.[1]?.label === 'Preorder' && fromBank.body.tally?.correct === 'B');
  const theirs = await post(T, { questionId: bankB[0]._id });
  const empty = await post(T, {});
  check('another professor\'s question, and no question at all, are refused (400)', theirs.status === 400 && empty.status === 400);
  const list = await get(T);
  check('the room\'s tallies, in the order asked', list.body.tallies?.length === 2 && list.body.tallies[0].seq === 1 && list.body.tallies[1].seq === 2);
}

console.log('\nno-device activities');

const A = `${L}/activities`;
{
  const think = await post(A, { kind: 'think', outcome: 'Three students gave everyday examples' });
  const group = await post(A, { kind: 'group', outcome: 'Most benches found the postorder',
    groups: [{ label: 'Bench 3', gotIt: 'yes' }, { label: 'Bench 4', gotIt: 'partly' }, { label: 'Bench 5', gotIt: 'no' }] });
  const quick = await post(A, { kind: 'check', tallyId });
  const diagram = await post(A, { kind: 'diagram' });
  const real = await post(A, { kind: 'real', outcome: 'Family trees, phone folders' });
  check('the five activities, each recorded in order', [think, group, quick, diagram, real].every((x) => x.status === 201)
    && JSON.stringify([think, group, quick, diagram, real].map((x) => [x.body.activity?.seq, x.body.activity?.label])) === JSON.stringify([
      [1, 'Think and explain'], [2, 'Group challenge'], [3, 'Quick knowledge check'], [4, 'Explain the diagram'], [5, 'Real-world application']]),
  [think, group, quick, diagram, real].map((x) => x.status).join(','));
  check('a group challenge records groups, not students', JSON.stringify(group.body.activity?.groups?.map((g) => [g.label, g.result]))
    === '[["Bench 3","Got it"],["Bench 4","Partly"],["Bench 5","Not yet"]]');
  check('a quick check points at its tally', quick.body.activity?.tallyId === tallyId);
  const bad = await Promise.all([
    post(A, { kind: 'think', groups: [{ label: 'Bench 1', gotIt: 'yes' }] }),
    post(A, { kind: 'group', groups: [{ label: 'Bench 1', gotIt: 'maybe' }] }),
    post(A, { kind: 'quiz' }),
    post(A, { kind: 'think', tallyId }),
  ]);
  check('refused: groups on anything but a group challenge, a result outside yes/partly/no, an unknown kind, a tally on a think',
    bad.every((b) => b.status === 400), bad.map((b) => b.status).join(', '));
  const edit = await patch(`${A}/${group.body.activity?.id}`, { groups: [{ label: 'Bench 3', gotIt: 'yes' }, { label: 'Bench 5', gotIt: 'yes' }] });
  check('groups can be filled in as the class goes', edit.status === 200 && edit.body.activity?.groups?.length === 2
    && edit.body.activity?.kind === 'group');
  const list = await get(A);
  check('the room\'s activities, in order, with the kinds and results the screen offers', list.body.activities?.length === 5
    && list.body.kinds?.length === 5 && list.body.results?.length === 3);
}

console.log('\ninsight actions');

const I = `${L}/insights/actions`;
{
  const a1 = await post(I, { flagId: 'focus:analyse', action: 'acted', note: 'Asked two Analyse questions aloud' });
  const a2 = await post(I, { flagId: 'support:0123456789abcdef', action: 'dismissed' });
  check('a professor acts on one flag and dismisses another', a1.status === 201 && a2.status === 201
    && a1.body.action?.actedBy === ID.profA && a1.body.action?.note === 'Asked two Analyse questions aloud');
  const list = await get(I);
  check('both are kept, in order', JSON.stringify(list.body.actions?.map((x) => [x.flagId, x.action])) === '[["focus:analyse","acted"],["support:0123456789abcdef","dismissed"]]');
  const bad = await post(I, { flagId: 'x', action: 'snoozed' });
  const editRoute = await patch(`${I}/${a1.body.action?.id}`, { action: 'dismissed' });
  const delRoute = await del(`${I}/${a1.body.action?.id}`);
  check('an action outside dismissed/acted is a 400, and there is no route to edit or delete one',
    bad.status === 400 && editRoute.status === 404 && delRoute.status === 404);
  // A flag id is the insights' own (focus:, support:, participation:), so no
  // free text about a student can ride in on one.
  const smuggled = await post(I, { flagId: '21CS01 Asha 9845012345', action: 'acted' });
  const contact = await Promise.all([
    post(T, { text: 'Asha, call 98450 12345' }),
    post(A, { kind: 'group', groups: [{ label: 'Asha Rao (absent, call 98450 12345)', gotIt: 'no' }] }),
  ]);
  check('refused: a flag id that is not a card\'s, and a phone number in a tally or a group\'s label (400); none is kept',
    smuggled.status === 400 && contact.every((c) => c.status === 400)
    && (await get(I)).body.actions?.length === 2 && !JSON.stringify(await get(T)).includes('98450'),
    [smuggled.status, ...contact.map((c) => c.status)].join(', '));
}

console.log('\na closed room');

{
  await post(`${L}/close`, {});
  const draw = await post(`${L}/wheel/draw`, {});
  const round = await post(`${L}/wheel/rounds`, {});
  check('a closed room draws nothing and starts no round (409)', draw.status === 409 && round.status === 409);
  const fill = await patch(pickPath(drawn[4]), { status: 'answered' });
  const mark = await obs(L, { rollNo: '21CS06', kind: 'participated' });
  check('but its picks and marks can still be filled in after the class', fill.status === 200 && mark.status === 200 && mark.body.changed === true);
}

// ------------------------------------------- one class, one day, two rooms --

console.log('\nthe class\'s day is one: a second room the same day, and another day');

const second = await openRoom({ classId, title: 'Trees, second period' });
const S2 = `/api/session/${second.code}`;
{
  const read = await get(`${S2}/observations`);
  const esha = read.body.students?.find((x) => x.rollNo === '21CS05');
  check('a second room of the class the same day shows the marks already set that day, with the room they were set in',
    esha?.current?.kind === 'support' && esha?.current?.room === led.code, JSON.stringify(esha?.current));
  const set = await obs(S2, { rollNo: '21CS05', kind: 'participated' });
  check('a mark set here replaces the class\'s mark for the day', set.body.replaced?.kind === 'support' && set.body.current?.room === second.code);
  const back = (await get(`${L}/observations`)).body.students?.find((x) => x.rollNo === '21CS05');
  check('and the first room reads the same one mark, with both events', back?.current?.kind === 'participated' && back?.history?.length === 2);
}
{
  const yesterday = await openRoom({ classId, title: 'Trees, yesterday' });
  await repo.updateSession(yesterday.sessionId, { startedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString() });
  await obs(`/api/session/${yesterday.code}`, { rollNo: '21CS05', kind: 'understood' });
  const across = await get(`/api/classes/${classId}/students/${sid['21CS05']}/observations`);
  check('one student across days: newest first, each day with its own mark and log',
    across.status === 200 && across.body.days?.length === 2 && across.body.days[0].current?.kind === 'participated'
    && across.body.days[0].history?.length === 2 && across.body.days[1].current?.kind === 'understood'
    && across.body.days[0].day > across.body.days[1].day, JSON.stringify(across.body.days?.map((d) => [d.day, d.current?.kind])));
  check('with the days counted per kind, never as a score', JSON.stringify(across.body.counts)
    === JSON.stringify({ understood: 1, participated: 1, revision: 0, support: 0, days: 2 }) && /staff only/.test(across.body.privacy ?? ''));
}

// ------------------------------------------------------- phones and leaks --

console.log('\nphones: no record reaches one, and no record moves a level');

const live = await openRoom({ classId, title: 'Trees, phones' });
const P = `/api/session/${live.code}`;
const asha = await join(live.code, '21CS01', 'asha');
const bilal = await join(live.code, '21cs02', 'Bilal');
const guest = await join(live.code, 'GUEST7', 'Visitor');
{
  const result = next(asha.s, 'server:result');
  asha.s.emit('student:answer', { questionId: asha.first.question._id, response: 1, answerId: 'records-answer-0001' });
  await result;
}
await settle();
const levelsBefore = JSON.stringify((await repo.listProfiles(live.sessionId)).map((p) => [p.rollNo, p.workingLevel, p.levels, p.history.length]));
{
  // Every kind of record, with marks that would be easy to find in a payload.
  const w = await post(`${P}/wheel/draw`, {});
  check('the wheel draws from the phones that joined and were marked present by joining',
    w.status === 201 && ['21CS01', '21CS02'].includes(w.body.pick?.rollNo) && w.body.pool?.total === 2, `HTTP ${w.status} ${w.body.error ?? ''}`);
  await patch(`${P}/wheel/picks/${w.body.pick?.id}`, { status: 'help' });
  const off = await post(`${P}/wheel/draw`, { presentOnly: false, noRepeat: false });
  check('present only off: the roster and the phone off it', off.body.pool?.total === 7 && off.body.pool?.onWheel?.some((p) => p.rollNo === 'GUEST7'));
  await obs(P, { rollNo: '21CS01', kind: 'revision', note: 'LEAKMARK observation note' });
  await obs(P, { rollNo: '21CS02', kind: 'support' });
  const t = await post(`${P}/tallies`, { text: 'LEAKMARK tally question', labels: ['LEAKMARK-A', '', '', ''] });
  await post(`${P}/tallies/${t.body.tally?.id}/increment`, { option: 'A' });
  await post(`${P}/activities`, { kind: 'group', outcome: 'LEAKMARK outcome', groups: [{ label: 'LEAKMARK bench', gotIt: 'yes' }] });
  await post(`${P}/insights/actions`, { flagId: 'focus:leakmark', action: 'dismissed', note: 'LEAKMARK action' });
  const absent = await patch(`${P}/wheel/picks/${off.body.pick?.id}`, { status: 'absent' });
  check('a pick set absent in a room with phones', absent.status === 200);
  // The phones carry on after the records: an answer and a next question each.
  const r = next(bilal.s, 'server:result');
  bilal.s.emit('student:answer', { questionId: bilal.first.question._id, response: 0, answerId: 'records-answer-0002' });
  await r;
  const q = next(guest.s, 'server:question');
  guest.s.emit('student:next');
  await q.catch(() => null);
  await settle();
}
{
  const PHONE_EVENTS = new Set(['session:accepted', 'server:question', 'server:result', 'server:exhausted', 'session:paused',
    'session:resumed', 'session:closed', 'session:rejected']);
  const names = [...new Set(phoneEvents.map((e) => e.event))];
  check('every event a phone received is a phone event', names.every((n) => PHONE_EVENTS.has(n)) && phoneEvents.length >= 8,
    `${phoneEvents.length} events: ${names.join(', ')}`);
  const all = JSON.stringify(phoneEvents);
  const words = ['LEAKMARK', 'observation', 'Needs revision', 'Needs additional support', 'Understood', 'tally', 'Tally', 'wheel',
    'poolSize', 'pickedBy', 'Passed to partner', 'insight', 'flagId', 'rosterName', 'Asha Rao', 'attendance', 'privacy'];
  const leaked = words.filter((w) => all.includes(w));
  check('no phone received any record: no note, label, tally, pick, activity, flag or roster name', leaked.length === 0, leaked.join(', '));
  const publicRoom = await get(P, null);
  const pub = JSON.stringify(publicRoom.body);
  check('nor GET /api/session/:code, which any phone may read', publicRoom.status === 200 && !words.some((w) => pub.includes(w)), pub.slice(0, 160));
  const levelsAfter = JSON.stringify((await repo.listProfiles(live.sessionId)).map((p) => [p.rollNo, p.workingLevel, p.levels, p.history.length]));
  const ashaAfter = (await repo.listProfiles(live.sessionId)).find((p) => p.rollNo === '21CS01');
  const ashaBefore = JSON.parse(levelsBefore).find((p) => p[0] === '21CS01');
  check('no record moved a level: Asha\'s profile is exactly as before her "Needs revision" and her pick',
    JSON.stringify([ashaAfter.rollNo, ashaAfter.workingLevel, ashaAfter.levels, ashaAfter.history.length]) === JSON.stringify(ashaBefore),
    `${JSON.stringify(ashaBefore)} / ${levelsAfter.slice(0, 200)}`);
}

// ------------------------------------------------- a room with no class --

console.log('\na room opened for no class');

{
  const plain = await openRoom({ title: 'No class' });
  const N = `/api/session/${plain.code}`;
  await join(plain.code, '7', 'Seven');
  await join(plain.code, '8', 'Eight');
  const w = await post(`${N}/wheel/draw`, {});
  check('the wheel draws from the phones that joined', w.status === 201 && ['7', '8'].includes(w.body.pick?.rollNo)
    && w.body.pick?.classStudentId === null && w.body.pool?.total === 2);
  const o = await obs(N, { rollNo: '7', kind: 'understood' });
  check('an observation is keyed to the room and the roll number', o.status === 200 && o.body.student?.studentId === null
    && o.body.student?.rollNo === '7');
  const off = await obs(N, { rollNo: '9', kind: 'understood' });
  const byId = await obs(N, { studentId: sid['21CS01'], kind: 'understood' });
  check('a roll number no phone joined with, and a roster id, are refused (400)', off.status === 400 && byId.status === 400);
  const t = await post(`${N}/tallies`, { text: 'Is a tree a graph?', labels: ['Yes', 'No'] });
  check('a tally counts the phones that joined as present', t.body.tally?.present === 2 && t.body.tally?.summary === '0 of 2 present responded');
  const absent = await patch(`${N}/wheel/picks/${w.body.pick?.id}`, { status: 'absent' });
  check('Absent on a pick there marks no attendance, and says why', absent.status === 200 && absent.body.attendance?.marked === false
    && /no class/.test(absent.body.attendance?.reason ?? ''));
  const read = await get(`${N}/observations`);
  check('its read lists the phones that joined', read.body.class === null && read.body.students?.map((x) => x.rollNo).join(',') === '7,8');
}

// ------------------------------------------- another professor, the HOD --

console.log('\nanother professor, the HOD, a student');

{
  const pickId = drawn[0].id;
  const routes = [
    ['GET', 'observations'], ['POST', 'observations', { rollNo: '21CS01', kind: 'understood' }],
    ['GET', 'wheel'], ['PATCH', 'wheel', { presentOnly: true }], ['POST', 'wheel/draw', {}], ['POST', 'wheel/rounds', {}],
    ['PATCH', `wheel/picks/${pickId}`, { status: 'answered' }],
    ['GET', 'tallies'], ['POST', 'tallies', { text: 'x' }], ['PATCH', `tallies/${tallyId}`, { revealed: false }],
    ['POST', `tallies/${tallyId}/increment`, { option: 'A' }], ['POST', `tallies/${tallyId}/decrement`, { option: 'A' }],
    ['GET', 'activities'], ['POST', 'activities', { kind: 'think' }],
    ['GET', 'insights/actions'], ['POST', 'insights/actions', { flagId: 'f', action: 'acted' }],
  ];
  const outsider = [];
  for (const [method, sub, body] of routes) {
    const theirs = await call(method, `${L}/${sub}`, { body, as: 'profB' });
    const nothing = await call(method, `/api/session/${NOWHERE}/${sub}`, { body, as: 'profB' });
    if (!(theirs.status === 404 && nothing.status === 404 && theirs.body.error === nothing.body.error)) {
      outsider.push(`${method} ${sub}: ${theirs.status} "${theirs.body.error}" / ${nothing.status} "${nothing.body.error}"`);
    }
  }
  check(`another professor gets the same 404 as for no room at all, on all ${routes.length} routes`, outsider.length === 0, outsider.join('; '));
  const hodOther = await get(`${L}/observations`, 'hodOther');
  check('an HOD of another department gets the 404 too', hodOther.status === 404);

  const beforeStore = JSON.stringify([
    await repo.listObservations({ sessionId: second.sessionId }), await repo.listWheelPicks(second.sessionId),
    await repo.listTallies(led.sessionId), await repo.listActivities(led.sessionId), await repo.listInsightActions(led.sessionId),
  ]);
  const hodReads = [];
  const hodWrites = [];
  for (const [method, sub, body] of routes) {
    // The second room is open, so every write here would succeed for its owner.
    const r = await call(method, `${S2}/${sub}`, { body, as: 'hod' });
    (method === 'GET' ? hodReads : hodWrites).push(r.status);
  }
  check('the HOD of the department reads every record', hodReads.every((s) => s === 200), hodReads.join(','));
  check('and every HOD write is refused (403)', hodWrites.every((s) => s === 403), hodWrites.join(','));
  const afterStore = JSON.stringify([
    await repo.listObservations({ sessionId: second.sessionId }), await repo.listWheelPicks(second.sessionId),
    await repo.listTallies(led.sessionId), await repo.listActivities(led.sessionId), await repo.listInsightActions(led.sessionId),
  ]);
  check('and nothing changed', beforeStore === afterStore);

  const across = await get(`/api/classes/${classId}/students/${sid['21CS05']}/observations`, 'profB');
  const nowhere = await get(`/api/classes/ffffffffffffffffffffffff/students/${sid['21CS05']}/observations`, 'profB');
  check('a student\'s observations across days: the same 404 for another professor as for no class',
    across.status === 404 && nowhere.status === 404 && across.body.error === nowhere.body.error);
  const hodAcross = await get(`/api/classes/${classId}/students/${sid['21CS05']}/observations`, 'hod');
  check('and the HOD reads them', hodAcross.status === 200 && hodAcross.body.days?.length === 2);

  const asStudent = await get(`${L}/observations`, 'student');
  const anon = await get(`${L}/wheel`, null);
  check('a student account is refused (403), and so is no credential at all (401)', asStudent.status === 403 && anon.status === 401,
    `${asStudent.status} / ${anon.status}`);
}

// ------------------------------------------------------------- archive --

console.log('\na deleted room\'s archive keeps its records');

{
  const counts = async (id) => [
    (await repo.listObservations({ sessionId: id })).length, (await repo.listWheelRounds(id)).length,
    (await repo.listWheelPicks(id)).length, (await repo.listTallies(id)).length,
    (await repo.listActivities(id)).length, (await repo.listInsightActions(id)).length,
  ];
  const live1 = await counts(led.sessionId);
  const otherBefore = await counts(second.sessionId);
  const gone = await del(`${L}?confirm=${led.code}`);
  check('the teacher-led room is deleted', gone.status === 200, `HTTP ${gone.status} ${gone.body.error ?? ''}`);
  const archived = await repo.getRoomArchive(gone.body.archive?.id);
  const back = decodeRoomArchive(archived.data);
  check('its archive holds every record: observations with their log, rounds, picks, tallies, activities, insight actions',
    JSON.stringify([back.observations.length, back.wheelRounds.length, back.wheelPicks.length, back.tallies.length,
      back.activities.length, back.insightActions.length]) === JSON.stringify(live1), `${JSON.stringify(live1)}`);
  const ashaLog = back.observations.filter((o) => o.rollNo === '21CS01');
  check('Asha\'s mark, replaced and cleared, is all there, with her name',
    JSON.stringify(ashaLog.map((o) => o.kind ?? null)) === '["understood","revision",null]' && ashaLog[0].name === 'Asha Rao'
    && ashaLog[0].note === 'Explained inorder with a family tree');
  check('every pick with its response and pool', back.wheelPicks.every((p) => p.poolSize >= 1 && p.rollNo)
    && back.wheelPicks.filter((p) => p.status === 'absent').length === 2);
  check('the tally with its counts, and the group challenge with its groups',
    JSON.stringify(back.tallies[0].counts) === '[14,1,2,0]' && back.activities.find((a) => a.kind === 'group')?.groups?.length === 2);
  check('the size is honest: the archive is under 1 MiB and records its own bytes', archived.bytes === Buffer.byteLength(JSON.stringify(archived.data))
    && archived.bytes < 1024 * 1024, `${archived.bytes} bytes`);
  check('the live records went with the room; the second room\'s are untouched',
    JSON.stringify(await counts(led.sessionId)) === '[0,0,0,0,0,0]' && JSON.stringify(await counts(second.sessionId)) === JSON.stringify(otherBefore));
}

{
  // A record being written when the delete arrives: the delete waits for it,
  // and a record sent while the delete runs is refused rather than lost.
  const { lockProfile } = await import(`${SRC}sockets/index.js`);
  const { RECORDS_LOCK } = await import(`${SRC}services/records.js`);
  const release = await lockProfile(second.sessionId, RECORDS_LOCK);
  let finished = false;
  const deleting = del(`${S2}?confirm=${second.code}`).then((r) => { finished = true; return r; });
  await settle();
  check('a room delete waits for a record being written', finished === false);
  const during = post(`${S2}/insights/actions`, { flagId: 'participation:sent-during-delete', action: 'acted' });
  await settle();
  // What a route holding the lock writes: it lands before the archive is read.
  await repo.addInsightAction({ sessionId: second.sessionId, flagId: 'in-flight', action: 'acted', actedAt: new Date().toISOString() });
  release();
  const gone = await deleting;
  const refused = await during;
  const back = decodeRoomArchive((await repo.getRoomArchive(gone.body.archive?.id)).data);
  check('the record written while it waited is in the archive', gone.status === 200
    && back.insightActions.some((a) => a.flagId === 'in-flight'), `HTTP ${gone.status}`);
  check('one sent while the room was being deleted is refused (409 or 404), never kept nowhere',
    [404, 409].includes(refused.status) && !back.insightActions.some((a) => a.flagId === 'participation:sent-during-delete')
    && (await repo.listInsightActions(second.sessionId)).length === 0, `HTTP ${refused.status} ${refused.body.error ?? ''}`);
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
for (const s of phones) s.disconnect();
globalThis.fetch = realFetch;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
