// Phase 3 - the class roster, a room opened for a class, and attendance, end to end.
//
//   node server/scripts/roster.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with real phones over Socket.io, and
// checks:
//
//   roster      a professor creates a class and adds students from a list; bad
//               rows come back refused with a reason, and nothing but a roll
//               number and a name is stored
//   room        a room opened for the class; a class that is not the caller's
//               is the same 404 as one that does not exist
//   joins       phones join with roster and non-roster roll numbers; nobody is
//               locked out, roster students are marked present by the join, the
//               rest are reported as not on the roster
//   marks       the professor marks one or many, and "joined present, the rest
//               absent"; the professor's mark wins over a later join
//   grid        the teacher's grid carries each row's roster name and the
//               present count; nothing of it reaches a phone
//   who         another professor gets the same 404 as for nothing at all; an
//               HOD of the department reads and cannot write
//   removal     removing a student keeps their answers, attendance and record
//   archive     a deleted class room's archive keeps its class and attendance
//   unchanged   a room opened without a class answers exactly as before
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. So
// the server is pointed at http://supabase.invalid (a name that can never
// resolve) and every request to it is answered here, in-process, by a stand-in
// for the three calls the server makes about accounts: GET /auth/v1/user (whose
// token is this?), GET /rest/v1/accounts (that account) and
// POST /rest/v1/rpc/accounts_below (an HOD's department). Any other request off
// this machine is refused outright. Everything else runs on the in-process store.
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
    throw new Error(`roster.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by roster.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'roster-test-service-key';

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

/** `as`: one of the TOKENS' names, 'key' for the shared teacher key, or null for no credentials. */
async function call(method, path, { body, as = 'profA' } = {}) {
  const headers = {};
  if (as === 'key') headers['x-teacher-key'] = config.teacherKey;
  else if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
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
    last: () => seen.at(-1),
    until(match, ms = 4000) {
      const latest = seen.at(-1);
      if (latest && match(latest)) return Promise.resolve(latest);
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        w.timer = setTimeout(() => { waiting.splice(waiting.indexOf(w), 1); reject(new Error(`timeout waiting for ${event}`)); }, ms);
        waiting.push(w);
      });
    },
  };
}

const phones = [];
/** A phone joins; resolves with the socket, its accepted payload and the first question. */
async function join(code, rollNo, name = '') {
  const s = await connect();
  phones.push(s);
  const accepted = next(s, 'session:accepted');
  const first = next(s, 'server:question');
  s.emit('student:join', { code, rollNo, name });
  return { s, accepted: await accepted, first: await first };
}

// ------------------------------------------------------------ fixtures --

async function chapter(ownerId, title) {
  const content = await repo.createContent({ title, kind: 'syllabus', rawText: '', topics: ['Layers'], ownerId });
  await repo.insertQuestions(Array.from({ length: 8 }, (_, i) => ({
    contentId: content._id, topic: 'Layers', text: `Which layer is ${i}?`, kind: 'mcq',
    options: ['Network', 'Transport', 'Link', 'Physical'], answerIdx: 1, bloom: 'understand', source: 'llm', status: 'active',
  })));
  return content;
}

const NOWHERE = 'ffffffffffffffffffffffff'; // a well-formed id no store holds

// ---------------------------------------------------------- the roster --

console.log('\nclasses: a professor makes one and adds students from a list');

const made = await post('/api/classes', { courseName: 'Computer Networks', section: 'TY-CSF B', termLabel: 'Sem V 2026' });
check('a professor creates a class: owned by them, empty, theirs to edit',
  made.status === 201 && made.body.class?.courseName === 'Computer Networks' && made.body.class?.section === 'TY-CSF B'
  && made.body.class?.ownerId === ID.profA && made.body.class?.size === 0 && made.body.class?.canEdit === true,
  `HTTP ${made.status} ${JSON.stringify(made.body.class ?? made.body)}`);
const classId = made.body.class?.id;
{
  const noSection = await post('/api/classes', { courseName: 'Computer Networks' });
  check('a class with no section is a 400 that says so', noSection.status === 400 && /section/.test(noSection.body.error ?? ''));
  const byHod = await post('/api/classes', { courseName: 'X', section: 'A' }, 'hod');
  check('an HOD may not create a class', byHod.status === 403, `HTTP ${byHod.status}`);
}

const list = [
  { roll: '21CS01', name: 'Asha Rao' },
  { roll: ' 21cs02 ', name: '  Bilal   Khan ' },
  { roll: '21CS03', name: 'Chitra' },
  { rollNo: '21CS04', name: 'Dev' },
  { roll: '21cs01', name: 'Asha twice' },
  { roll: '', name: 'No roll number' },
  { roll: '21CS#9', name: 'Bad shape' },
  { roll: '21CS05', name: '' },
  { roll: '21CS06', name: 'asha@example.com' },
  { roll: '21CS07', name: 'Ravi 98450 12345' },
  { roll: '21CS08', name: 'Esha', phone: '9845012345', dob: '2004-05-12' },
  'Farhan, 21CS09',
];
const bulk = await post(`/api/classes/${classId}/students`, { students: list });
check('the list is answered with what was added and what was refused', bulk.status === 200, `HTTP ${bulk.status} ${bulk.body.error ?? ''}`);
check('rows a phone can join with are added, in the room\'s form, names tidied',
  JSON.stringify(bulk.body.added?.map((s) => [s.rollNo, s.name])) === JSON.stringify([
    ['21CS01', 'Asha Rao'], ['21CS02', 'Bilal Khan'], ['21CS03', 'Chitra'], ['21CS04', 'Dev'], ['21CS08', 'Esha']]),
  JSON.stringify(bulk.body.added?.map((s) => s.rollNo)));
{
  const why = Object.fromEntries((bulk.body.refused ?? []).map((r) => [r.index, r.reason]));
  check('each refused row comes back with its position and a reason',
    JSON.stringify(Object.keys(why).map(Number)) === JSON.stringify([4, 5, 6, 7, 8, 9, 11])
    && /more than once/.test(why[4]) && /missing/.test(why[5]) && /phone can join/.test(why[6]) && /name is missing/.test(why[7])
    && /email/.test(why[8]) && /phone number/.test(why[9]) && /not a \{ roll, name \}/.test(why[11]),
    JSON.stringify(why));
  check('fields other than a roll number and a name are not stored, and are named',
    JSON.stringify(bulk.body.ignoredFields) === '["dob","phone"]' && /Not stored: dob, phone/.test(bulk.body.note ?? ''));
  check('the class size is the roster: 5', bulk.body.size === 5 && bulk.body.class?.size === 5);
}
const rosterOf = async (as = 'profA') => get(`/api/classes/${classId}`, as);
let read = await rosterOf();
const idOf = (roll) => [...(read.body.students ?? []), ...(read.body.removed ?? [])].find((s) => s.rollNo === roll)?.id;
check('reading the class gives its roster: a roll number and a name per student, nothing else',
  read.status === 200 && read.body.students?.length === 5 && read.body.removed?.length === 0
  && read.body.students.every((s) => JSON.stringify(Object.keys(s).sort()) === '["active","addedAt","id","name","removedAt","rollNo"]'),
  JSON.stringify(read.body.students?.[0]));
{
  const stored = await repo.listClassStudents(classId);
  check('and the store holds no phone number, date of birth or email for anyone',
    stored.length === 5 && stored.every((s) => !('phone' in s) && !('dob' in s) && !JSON.stringify(s).includes('9845012345')));
  const again = await post(`/api/classes/${classId}/students`, { students: [{ roll: '21cs01', name: 'Asha again' }] });
  check('adding a roll number already on the roster refuses it, adds nothing',
    again.status === 200 && again.body.added?.length === 0 && /already on this class's roster/.test(again.body.refused?.[0]?.reason ?? ''));
  const renamed = await patch(`/api/classes/${classId}`, { termLabel: 'Sem V, 2026-27' });
  check('the class can be edited', renamed.status === 200 && renamed.body.class?.termLabel === 'Sem V, 2026-27'
    && renamed.body.class?.courseName === 'Computer Networks');
  const bad = await patch(`/api/classes/${classId}`, { section: '' });
  check('but not left without a section', bad.status === 400);
  const named = await patch(`/api/classes/${classId}/students/${idOf('21CS02')}`, { name: 'Bilal Ahmed Khan' });
  check('one student can be edited', named.status === 200 && named.body.student?.name === 'Bilal Ahmed Khan');
  const clash = await patch(`/api/classes/${classId}/students/${idOf('21CS02')}`, { rollNo: '21cs01' });
  check('a roll number another student holds is a 409', clash.status === 409, `HTTP ${clash.status} ${clash.body.error ?? ''}`);
  const listed = await get('/api/classes');
  check('the class is in the professor\'s list, with its size',
    listed.status === 200 && listed.body.classes?.some((c) => c.id === classId && c.size === 5 && c.canEdit === true));
}

// ------------------------------------------------- a room for the class --

console.log('\na room opened for the class');

const contentA = await chapter(ID.profA, 'Transport layer');
const opened = await post('/api/session', { contentId: contentA._id, classId });
check('a professor opens a room for their class, and is told its class',
  opened.status === 200 && opened.body.classId === classId, `HTTP ${opened.status} ${opened.body.error ?? ''}`);
const code = opened.body.code;
const plainOpened = await post('/api/session', { contentId: contentA._id });
check('a room opened without a class says so: classId null', plainOpened.status === 200 && plainOpened.body.classId === null);

const madeB = await post('/api/classes', { courseName: 'Signals', section: 'SY-ECE A' }, 'profB');
const classB = madeB.body.class?.id;
check('another professor makes their own class', madeB.status === 201 && madeB.body.class?.ownerId === ID.profB);
{
  const theirs = await post('/api/session', { contentId: contentA._id, classId: classB });
  const nothing = await post('/api/session', { contentId: contentA._id, classId: NOWHERE });
  check('a room for someone else\'s class is the same 404 as for a class that does not exist',
    theirs.status === 404 && nothing.status === 404 && theirs.body.error === nothing.body.error,
    `${theirs.status} "${theirs.body.error}" / ${nothing.status} "${nothing.body.error}"`);
  const malformed = await post('/api/session', { contentId: contentA._id, classId: 'not-an-id' });
  check('a malformed classId is a 400', malformed.status === 400);
  const rooms = await get('/api/session');
  check('the room list carries each room\'s class',
    rooms.body.rooms?.find((r) => r.code === code)?.classId === classId
    && rooms.body.rooms?.find((r) => r.code === plainOpened.body.code)?.classId === null);
}

// --------------------------------------------------------- phones join --

console.log('\nphones join: roster and non-roster roll numbers');

const teacher = await connect();
const grids = collect(teacher, 'teacher:grid');
teacher.emit('teacher:watch', { code, token: TOKENS.profA });
const firstGrid = await grids.until(() => true);
check('the professor watches the room: the grid says 0 / 5 present before anyone joins',
  firstGrid.attendance?.present === 0 && firstGrid.attendance?.classSize === 5 && firstGrid.rows?.length === 0,
  JSON.stringify(firstGrid.attendance));

const asha = await join(code, ' 21cs01 ', 'asha');
const bilal = await join(code, '21CS02', 'Bilal');
const guest = await join(code, 'GUEST99', 'Visitor');
check('a roll number off the roster still joins, as today', guest.accepted?.profile?.rollNo === 'GUEST99' && Boolean(guest.first?.question));
{
  const phonePayloads = JSON.stringify([asha.accepted, asha.first, bilal.accepted, guest.accepted]);
  check('nothing of the roster or attendance reaches a phone',
    !/rosterName|attendance|Asha Rao|present/.test(phonePayloads), phonePayloads.slice(0, 160));
  const publicRoom = await get(`/api/session/${code}`, null);
  check('nor GET /api/session/:code, which any phone may read',
    publicRoom.status === 200 && !/class|attendance|roster/i.test(JSON.stringify(publicRoom.body)), JSON.stringify(publicRoom.body).slice(0, 200));
}
{
  const live = await grids.until((g) => g.rows?.length === 3);
  const row = (roll) => live.rows.find((r) => r.rollNo === roll);
  check('the live grid names each row from the roster, and null for a roll number off it',
    row('21CS01')?.rosterName === 'Asha Rao' && row('21CS01')?.name === 'asha' && row('21CS02')?.rosterName === 'Bilal Ahmed Khan'
    && row('GUEST99')?.rosterName === null, JSON.stringify(live.rows.map((r) => [r.rollNo, r.rosterName])));
  check('and carries the present count: 2 / 5', live.attendance?.present === 2 && live.attendance?.classSize === 5
    && live.attendance?.summary === '2 / 5 present', JSON.stringify(live.attendance));
  check('students who have not joined are not grid rows', live.rows.every((r) => ['21CS01', '21CS02', 'GUEST99'].includes(r.rollNo)));
  check('every row keeps the fields it always had', ['rollNo', 'name', 'workingLevel', 'levels', 'total', 'answered', 'online', 'integrity', 'counted', 'mastered']
    .every((k) => k in row('21CS01')));
}

const attendance = (as) => get(`/api/session/${code}/attendance`, as);
let att = await attendance();
const statusOf = (body, roll) => body.students?.find((s) => s.rollNo === roll);
check('joining marks a roster student present, by the join',
  att.status === 200 && statusOf(att.body, '21CS01')?.status === 'present' && statusOf(att.body, '21CS01')?.source === 'joined'
  && statusOf(att.body, '21CS02')?.status === 'present', `HTTP ${att.status} ${att.body.error ?? ''}`);
check('a student nobody has marked is unmarked, not absent',
  statusOf(att.body, '21CS03')?.status === 'unmarked' && statusOf(att.body, '21CS03')?.joined === false);
check('a roll number off the roster is reported as not on the roster, so it can be added',
  JSON.stringify(att.body.notOnRoster) === JSON.stringify([{ rollNo: 'GUEST99', name: 'Visitor', removedFromRoster: false }]));
check('counts and "N / M present"', att.body.summary === '2 / 5 present' && att.body.counts?.unmarked === 3
  && att.body.counts?.classSize === 5 && att.body.counts?.notOnRoster === 1, JSON.stringify(att.body.counts));
check('with the caveat that a typed roll number is not proof of identity', /not proof/.test(att.body.caveat ?? ''));
{
  const grid = await get(`/api/session/${code}/grid`);
  check('the REST grid carries the same roster names and count',
    grid.body.attendance?.summary === '2 / 5 present' && grid.body.rows?.find((r) => r.rollNo === '21CS01')?.rosterName === 'Asha Rao');
}

// --------------------------------------------------- the professor marks --

console.log('\nthe professor marks attendance');

{
  const marked = await post(`/api/session/${code}/attendance`, {
    marks: [{ studentId: idOf('21CS03'), status: 'absent' }, { studentId: idOf('21CS04'), status: 'late' }],
  });
  check('one or many students are marked at once', marked.status === 200 && marked.body.changed === 2
    && statusOf(marked.body, '21CS03')?.status === 'absent' && statusOf(marked.body, '21CS03')?.source === 'teacher'
    && statusOf(marked.body, '21CS04')?.status === 'late', `HTTP ${marked.status} ${marked.body.error ?? ''}`);
  check('late counts as present: 3 / 5', marked.body.summary === '3 / 5 present');
  const pushed = await grids.until((g) => g.attendance?.present === 3);
  check('and every teacher screen watching hears the new count', pushed.attendance?.summary === '3 / 5 present');
}
{
  const late = await join(code, '21CS03', 'Chitra');
  check('a student marked absent can still join', Boolean(late.accepted?.profile));
  att = await attendance();
  check('but the professor\'s mark wins over the later join: still absent, and shown as joined',
    statusOf(att.body, '21CS03')?.status === 'absent' && statusOf(att.body, '21CS03')?.source === 'teacher'
    && statusOf(att.body, '21CS03')?.joined === true);
}
{
  await post(`/api/session/${code}/attendance`, { marks: [{ studentId: idOf('21CS02'), status: 'absent' }] });
  bilal.s.disconnect();
  await new Promise((r) => setTimeout(r, 100));
  await join(code, '21CS02', 'Bilal');
  att = await attendance();
  check('a professor overriding a join is not undone by that phone rejoining',
    statusOf(att.body, '21CS02')?.status === 'absent' && statusOf(att.body, '21CS02')?.source === 'teacher');
}
{
  const before = JSON.stringify((await repo.listAttendance(opened.body.sessionId)).map((m) => [m.classStudentId, m.status]).sort());
  const badStatus = await post(`/api/session/${code}/attendance`, { marks: [{ studentId: idOf('21CS08'), status: 'excused' }] });
  const theirStudent = (await post(`/api/classes/${classB}/students`, { students: [{ roll: 'EC01', name: 'Gita' }] }, 'profB')).body.added?.[0]?.id;
  const outside = await post(`/api/session/${code}/attendance`, {
    marks: [{ studentId: idOf('21CS08'), status: 'present' }, { studentId: theirStudent, status: 'present' }],
  });
  const after = JSON.stringify((await repo.listAttendance(opened.body.sessionId)).map((m) => [m.classStudentId, m.status]).sort());
  check('a status other than present, absent or late is a 400', badStatus.status === 400);
  check('a list naming a student off this class\'s roster changes nobody',
    outside.status === 400 && /Nothing was changed/.test(outside.body.error ?? '') && before === after);
}
{
  const filled = await post(`/api/session/${code}/attendance`, { fromJoins: true });
  check('"joined present, the rest absent" keeps every hand mark and fills the rest',
    filled.status === 200 && filled.body.kept === 3 && filled.body.changed === 2
    && statusOf(filled.body, '21CS01')?.status === 'present' && statusOf(filled.body, '21CS01')?.source === 'teacher'
    && statusOf(filled.body, '21CS08')?.status === 'absent' && statusOf(filled.body, '21CS04')?.status === 'late'
    && statusOf(filled.body, '21CS02')?.status === 'absent',
    JSON.stringify(filled.body.students?.map((s) => [s.rollNo, s.status, s.source])));
  check('and nobody is left unmarked: 2 / 5 present', filled.body.counts?.unmarked === 0 && filled.body.summary === '2 / 5 present');
}
{
  const plainCode = plainOpened.body.code;
  const r = await get(`/api/session/${plainCode}/attendance`);
  const w = await post(`/api/session/${plainCode}/attendance`, { fromJoins: true });
  check('a room opened for no class has no attendance to read or mark (409)', r.status === 409 && w.status === 409);
}

// ------------------------------------------- another professor, the HOD --

console.log('\nanother professor, the shared key and the HOD');

{
  const same = (label, a, b) => check(label, a.status === 404 && b.status === 404 && a.body.error === b.body.error,
    `${a.status} "${a.body.error}" / ${b.status} "${b.body.error}"`);
  same('another professor reading the class: the same 404 as no class at all',
    await get(`/api/classes/${classId}`, 'profB'), await get(`/api/classes/${NOWHERE}`, 'profB'));
  same('editing it', await patch(`/api/classes/${classId}`, { section: 'Z' }, 'profB'), await patch(`/api/classes/${NOWHERE}`, { section: 'Z' }, 'profB'));
  same('adding to its roster', await post(`/api/classes/${classId}/students`, { students: [{ roll: 'X1', name: 'X' }] }, 'profB'),
    await post(`/api/classes/${NOWHERE}/students`, { students: [{ roll: 'X1', name: 'X' }] }, 'profB'));
  same('editing one of its students', await patch(`/api/classes/${classId}/students/${idOf('21CS03')}`, { name: 'X' }, 'profB'),
    await patch(`/api/classes/${NOWHERE}/students/${idOf('21CS03')}`, { name: 'X' }, 'profB'));
  same('removing one', await del(`/api/classes/${classId}/students/${idOf('21CS03')}`, 'profB'),
    await del(`/api/classes/${NOWHERE}/students/${idOf('21CS03')}`, 'profB'));
  same('reading the room\'s attendance', await get(`/api/session/${code}/attendance`, 'profB'), await get('/api/session/ZZZZZZ/attendance', 'profB'));
  same('marking it', await post(`/api/session/${code}/attendance`, { fromJoins: true }, 'profB'),
    await post('/api/session/ZZZZZZ/attendance', { fromJoins: true }, 'profB'));
  same('the shared key reading a signed-in professor\'s class', await get(`/api/classes/${classId}`, 'key'), await get(`/api/classes/${NOWHERE}`, 'key'));
  same('a student\'s class through another class\'s id', await patch(`/api/classes/${classB}/students/${idOf('21CS03')}`, { name: 'X' }, 'profB'),
    await patch(`/api/classes/${classB}/students/${NOWHERE}`, { name: 'X' }, 'profB'));
  const theirList = await get('/api/classes', 'profB');
  check('the class is not in another professor\'s list', theirList.status === 200 && !theirList.body.classes?.some((c) => c.id === classId)
    && theirList.body.classes?.some((c) => c.id === classB));
  const other = await get(`/api/classes/${classId}`, 'hodOther');
  check('an HOD of another department gets the 404 too', other.status === 404);
  const asStudent = await get('/api/classes', 'student');
  check('a student account may not reach classes at all', asStudent.status === 403, `HTTP ${asStudent.status}`);
  const anon = await get('/api/classes', null);
  check('nor may anyone without credentials', anon.status === 401, `HTTP ${anon.status}`);
}
{
  const hodRead = await get(`/api/classes/${classId}`, 'hod');
  check('the HOD reads a class in their department, roster and all, and may not edit it',
    hodRead.status === 200 && hodRead.body.students?.length === 5 && hodRead.body.class?.canEdit === false);
  const hodList = await get('/api/classes', 'hod');
  check('it is in the HOD\'s list, marked read-only', hodList.body.classes?.some((c) => c.id === classId && c.canEdit === false)
    && !hodList.body.classes?.some((c) => c.id === classB));
  const hodAtt = await get(`/api/session/${code}/attendance`, 'hod');
  check('the HOD reads the room\'s attendance', hodAtt.status === 200 && hodAtt.body.summary === '2 / 5 present');
  const before = JSON.stringify(await repo.listClassStudents(classId));
  const beforeMarks = JSON.stringify(await repo.listAttendance(opened.body.sessionId));
  const writes = [
    await patch(`/api/classes/${classId}`, { section: 'Z' }, 'hod'),
    await post(`/api/classes/${classId}/students`, { students: [{ roll: 'H1', name: 'H' }] }, 'hod'),
    await patch(`/api/classes/${classId}/students/${idOf('21CS03')}`, { name: 'H' }, 'hod'),
    await del(`/api/classes/${classId}/students/${idOf('21CS03')}`, 'hod'),
    await post(`/api/session/${code}/attendance`, { fromJoins: true }, 'hod'),
  ];
  check('every HOD write is refused (403) and changes nothing',
    writes.every((w) => w.status === 403) && before === JSON.stringify(await repo.listClassStudents(classId))
    && beforeMarks === JSON.stringify(await repo.listAttendance(opened.body.sessionId)),
    writes.map((w) => w.status).join(', '));
}

// ------------------------------------------------- removal keeps history --

console.log('\nremoving a student keeps their history');

{
  const q = asha.first.question;
  const result = next(asha.s, 'server:result');
  asha.s.emit('student:answer', { questionId: q._id, response: 1, answerId: 'roster-answer-0001' });
  await result;
  const removed = await del(`/api/classes/${classId}/students/${idOf('21CS01')}`);
  check('a student is removed, and the reply says nothing they did is deleted',
    removed.status === 200 && removed.body.removed === true && removed.body.student?.active === false
    && /Nothing they did is deleted/.test(removed.body.message ?? ''));
  read = await rosterOf();
  check('the class lists them as removed, and its size drops to 4',
    read.body.class?.size === 4 && !read.body.students?.some((s) => s.rollNo === '21CS01')
    && read.body.removed?.some((s) => s.rollNo === '21CS01' && s.removedAt));
  const stored = (await repo.listClassStudents(classId)).find((s) => s.rollNo === '21CS01');
  check('the roster row is kept, marked removed, not deleted', Boolean(stored?.removedAt) && stored?.name === 'Asha Rao');
  const answers = await get(`/api/session/${code}/answers?rollNo=21CS01`);
  check('their answers are all still there', answers.status === 200 && answers.body.items?.length === 1, `${answers.body.items?.length} answers`);
  att = await attendance();
  check('their attendance in the room is kept, shown apart, and not counted',
    att.body.removed?.some((s) => s.rollNo === '21CS01' && s.status === 'present') && att.body.counts?.classSize === 4
    && !att.body.students?.some((s) => s.rollNo === '21CS01'));
  check('and their phone shows as not on the roster', att.body.notOnRoster?.some((s) => s.rollNo === '21CS01' && s.removedFromRoster === true));
  const readd = await post(`/api/classes/${classId}/students`, { students: [{ roll: '21CS01', name: 'Asha Rao' }] });
  check('adding them again is refused with "restore"', /restore/.test(readd.body.refused?.[0]?.reason ?? ''));
  const restored = await patch(`/api/classes/${classId}/students/${idOf('21CS01')}`, { active: true });
  read = await rosterOf();
  check('restoring puts the same row back: size 5', restored.status === 200 && restored.body.student?.active === true
    && read.body.class?.size === 5 && read.body.students?.find((s) => s.rollNo === '21CS01')?.id === stored?._id);
}

// ------------------------------------------------------------- archive --

console.log('\na deleted class room\'s archive keeps its class and attendance');

{
  const sessionId = opened.body.sessionId;
  const gone = await del(`/api/session/${code}?confirm=${code}`);
  check('the room is deleted', gone.status === 200, `HTTP ${gone.status} ${gone.body.error ?? ''}`);
  const archive = decodeRoomArchive((await repo.getRoomArchive(gone.body.archive?.id)).data);
  const mark = (roll) => archive.attendance?.find((m) => m.rollNo === roll);
  check('the archive keeps the room\'s class', archive.room?.classId === classId);
  check('and every mark, with the roll number and name the roster held',
    archive.attendance?.length === 5 && mark('21CS03')?.status === 'absent' && mark('21CS03')?.source === 'teacher'
    && mark('21CS03')?.name === 'Chitra' && mark('21CS04')?.status === 'late' && mark('21CS03')?.markedBy === ID.profA,
    JSON.stringify(archive.attendance?.map((m) => [m.rollNo, m.status])));
  check('the live marks went with the room; the roster stays',
    (await repo.listAttendance(sessionId)).length === 0 && (await repo.listClassStudents(classId)).length === 5);
}

// ------------------------------------------------- unchanged without one --

console.log('\na room opened without a class answers exactly as before');

{
  const plainCode = plainOpened.body.code;
  const watcher = await connect();
  const plainGrids = collect(watcher, 'teacher:grid');
  watcher.emit('teacher:watch', { code: plainCode, token: TOKENS.profA });
  await plainGrids.until(() => true);
  await join(plainCode, '21CS01', 'Asha');
  const g = await plainGrids.until((p) => p.rows?.length === 1);
  check('its live grid is { rows, code } and its rows carry no roster name',
    JSON.stringify(Object.keys(g).sort()) === '["code","rows"]' && !('rosterName' in g.rows[0]));
  const rest = await get(`/api/session/${plainCode}/grid`);
  check('its REST grid is { rows, levels }', JSON.stringify(Object.keys(rest.body).sort()) === '["levels","rows"]');
  check('and nothing joined it into attendance', (await repo.listAttendance(plainOpened.body.sessionId)).length === 0);
  watcher.disconnect();
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
for (const s of phones) s.disconnect();
teacher.disconnect();
globalThis.fetch = realFetch;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
