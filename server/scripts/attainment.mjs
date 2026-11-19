// Phase 4 - attainment and the marks register, end to end.
//
//   node server/scripts/attainment.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, and checks, against counts worked out by
// hand below:
//
//   setup       a class whose roster comes from a CSV file, two course outcomes
//               mapped to topics, and THREE rooms opened for the class, each on
//               its own question set
//   phones      scripted phones answer over Socket.io: objective answers in all
//               three rooms, written answers in the third (two left provisional,
//               one reviewed through POST /api/review), a question repeated
//               across rooms, a phone whose roll number is not on the roster, a
//               student absent from one room and one absent from all
//   reports     the class report (per student and outcome, per outcome, Bloom
//               levels and bands, answer totals, what is unmapped), one student's
//               report with the answers behind it, and the marks register with
//               attendance, all equal to the hand counts
//   formula     no formula saved: the default example, said to be one; saving a
//               preset, a threshold, best attempts and a room weight each change
//               the result AND the methodology text; the same save twice writes
//               nothing; a bad one is a 400 that saves nothing
//   records     an observation and a tally appear beside the figures and move
//               none of them
//   roll numbers a student's roll number corrected on the roster after they
//               answered: their answers stay theirs, through each room's
//               attendance mark (0021), in the report and the register
//   who         another professor gets the same 404 as for nothing at all; the
//               HOD reads and gets 403 on a save; a student account 403; no
//               credentials 401
//   privacy     nothing about attainment reaches a phone or the room's public
//               read; students are listed in roll order, never ranked
//
// Signed-in accounts need Supabase Auth, which this suite must never reach: as in
// roster.mjs and outcomes.mjs, the server is pointed at http://supabase.invalid
// and the three calls it makes about accounts are answered here, in-process. Any
// other request off this machine is refused outright.
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
  hod: 'b0000000-0000-4000-8000-000000000001',
  profA: 'b0000000-0000-4000-8000-000000000002',
  profB: 'b0000000-0000-4000-8000-000000000003',
  hodOther: 'b0000000-0000-4000-8000-000000000004',
  student: 'b0000000-0000-4000-8000-000000000005',
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
    throw new Error(`attainment.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by attainment.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'attainment-test-service-key';

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

/** `as`: one of the TOKENS' names, or null for no credentials. `type` sends `body` as that content type, unencoded. */
async function call(method, path, { body, as = 'profA', type } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  let payload;
  if (type) { headers['content-type'] = type; payload = body; } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = (path, as) => call('GET', path, { as });
const post = (path, body, as) => call('POST', path, { body, as });
const put = (path, body, as) => call('PUT', path, { body, as });

const NOWHERE = 'ffffffffffffffffffffffff'; // a well-formed id no store holds
const same404 = (label, a, b) => check(label, a.status === 404 && b.status === 404 && a.body.error === b.body.error,
  `${a.status} "${a.body.error}" / ${b.status} "${b.body.error}"`);

// ---------------------------------------------------------------- phones --

/** Every payload any phone was sent, for the privacy check at the end. */
const phoneSaw = [];

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  s.onAny((event, payload) => phoneSaw.push({ event, payload }));
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
 * selector serves them in does not matter: every count below is per question.
 * Returns the question ids it answered.
 */
async function phone(code, rollNo, name, plan) {
  const s = await connect();
  const first = either(s, ['server:question', 'server:exhausted', 'session:rejected']);
  s.emit('student:join', { code, rollNo, name });
  let got = await first;
  const answered = [];
  while (got.name === 'server:question') {
    const q = got.payload.question;
    if (!(q._id in plan)) throw new Error(`${rollNo} has no plan for ${q._id} in ${code}`);
    keyN += 1;
    const result = either(s, ['server:result', 'session:rejected']);
    // Not "attain-...": since Phase 7 a reply names the phone's own answer id,
    // and the privacy check below looks for that word in what phones received.
    s.emit('student:answer', { questionId: q._id, response: plan[q._id], answerId: `att-${String(keyN).padStart(4, '0')}` });
    const r = await result;
    if (r.name !== 'server:result') throw new Error(`${rollNo}'s answer in ${code} was refused: ${JSON.stringify(r.payload)}`);
    answered.push(q._id);
    const nextOne = either(s, ['server:question', 'server:exhausted']);
    s.emit('student:next');
    got = await nextOne;
  }
  s.disconnect();
  return answered;
}

// ------------------------------------------------------------ fixtures --

console.log('\na class, its roster from a CSV file, two outcomes, three rooms');

const RUBRIC = ['context switch saves registers', 'scheduler picks next process'];
const FULL = 'a context switch saves registers, then the scheduler picks the next process'; // 2 of 2: 1
const PARTIAL = 'a context switch saves registers'; // 1 of 2: 0.5, provisional, then reviewed to 0.8
const NONE = 'no idea'; // 0 of 2: 0

const chapter = await repo.createContent({
  title: 'Operating Systems: Unit 1', kind: 'syllabus', rawText: '', ownerId: ID.profA,
  topics: ['Processes', 'Scheduling', 'Memory'],
});
const mcq = (topic, n, bloom) => ({
  contentId: chapter._id, topic, text: `${topic} question ${n}?`, kind: 'mcq', options: ['A', 'B', 'C', 'D'], answerIdx: 1,
  bloom, source: 'llm', status: 'active',
});
const made = await repo.insertQuestions([
  mcq('Processes', 1, 'understand'), mcq('Processes', 2, 'understand'), mcq('Processes', 3, 'understand'),
  mcq('Memory', 1, 'remember'),
  mcq('Scheduling', 1, 'apply'), mcq('Scheduling', 2, 'apply'), mcq('Scheduling', 3, 'apply'),
  { contentId: chapter._id, topic: 'Processes', text: 'What happens in a context switch?', kind: 'open', rubric: RUBRIC,
    bloom: 'create', source: 'llm', status: 'active' },
]);
const [P1, P2, P3, M1, S1, S2, S3, W1] = made.map((q) => String(q._id));
const RIGHT = 1;
const WRONG = 0;

const newClass = await post('/api/classes', { courseName: 'Operating Systems', section: 'TY-CS A', termLabel: 'Sem V' });
const classId = newClass.body.class?.id;
check('a professor makes a class', newClass.status === 201 && Boolean(classId));
{
  const csv = 'Roll No,Student Name,Phone\n21CS01,Asha Rao,9845012345\n21CS02,Bilal Khan,\n21CS03,Chitra Iyer,\n21CS04,Dev Patel,\n';
  const imported = await call('POST', `/api/classes/${classId}/students/import`, { body: csv, type: 'text/csv' });
  check('its roster is imported from a CSV file, the phone column left unread',
    imported.status === 200 && imported.body.added?.length === 4 && same(imported.body.ignoredColumns, ['Phone']),
    `HTTP ${imported.status} ${imported.body.error ?? ''}`);
}
const roster = await repo.listClassStudents(classId);
const studentId = (roll) => String(roster.find((s) => s.rollNo === roll)?._id);

const CO = {};
for (const [code, statement, topic] of [
  ['CO1', 'Explain how an operating system manages processes.', 'Processes'],
  ['CO2', 'Apply scheduling algorithms to a set of jobs.', 'Scheduling'],
]) {
  const r = await post(`/api/classes/${classId}/outcomes`, { code, statement });
  CO[code] = r.body.outcome?.id;
  const m = await put(`/api/classes/${classId}/outcomes/${CO[code]}/topics`, { topics: [{ contentId: String(chapter._id), topic }] });
  if (r.status !== 201 || m.status !== 200) check(`making ${code}`, false, `${r.status} ${m.status} ${m.body.error ?? ''}`);
}

const rooms = {};
for (const [name, set, day] of [
  ['A', [P1, P2, P3, M1], '2026-11-02T04:00:00.000Z'],
  ['B', [S1, S2, S3], '2026-11-09T04:00:00.000Z'],
  ['C', [W1, P2], '2026-11-16T04:00:00.000Z'],
]) {
  const r = await post('/api/session', { contentId: String(chapter._id), classId, questionIds: set, title: `Week ${name}` });
  if (r.status !== 200) check(`opening room ${name}`, false, `HTTP ${r.status} ${r.body.error ?? ''}`);
  // Three class meetings a week apart, so a date range can pick them out.
  await repo.updateSession(r.body.sessionId, { startedAt: day });
  rooms[name] = { code: r.body.code, id: r.body.sessionId };
}
check('three rooms are opened for the class, each on its own question set', Object.values(rooms).every((r) => r.code));

// ------------------------------------------------------------- the class --

console.log('\nphones answer in the three rooms');

// Who answered what. The comments are the marks each answer earns.
//   21CS01 Asha    A: P1 1, P2 1, P3 1, M1 1   B: S1 1, S2 1, S3 0   C: W1 full (1, provisional), P2 1
//   21CS02 Bilal   A: P1 1, P2 0, P3 0, M1 0   B: S1 1, S2 0, S3 0   C: W1 partial (0.5, reviewed to 0.8), P2 1
//   21CS03 Chitra  A: P1 1, P2 1, P3 0, M1 1   B: absent             C: W1 none (0, provisional), P2 0
//   21CS04 Dev     absent from all three
//   VISIT1         A: P1 1, P2 1, P3 1, M1 1 (a roll number not on the roster)
{
  const runs = [
    [rooms.A.code, '21CS01', 'Asha', { [P1]: RIGHT, [P2]: RIGHT, [P3]: RIGHT, [M1]: RIGHT }],
    [rooms.A.code, '21CS02', 'Bilal', { [P1]: RIGHT, [P2]: WRONG, [P3]: WRONG, [M1]: WRONG }],
    [rooms.A.code, '21CS03', 'Chitra', { [P1]: RIGHT, [P2]: RIGHT, [P3]: WRONG, [M1]: RIGHT }],
    [rooms.A.code, 'VISIT1', 'Visitor', { [P1]: RIGHT, [P2]: RIGHT, [P3]: RIGHT, [M1]: RIGHT }],
    [rooms.B.code, '21CS01', 'Asha', { [S1]: RIGHT, [S2]: RIGHT, [S3]: WRONG }],
    [rooms.B.code, '21CS02', 'Bilal', { [S1]: RIGHT, [S2]: WRONG, [S3]: WRONG }],
    [rooms.C.code, '21CS01', 'Asha', { [W1]: FULL, [P2]: RIGHT }],
    [rooms.C.code, '21CS02', 'Bilal', { [W1]: PARTIAL, [P2]: RIGHT }],
    [rooms.C.code, '21CS03', 'Chitra', { [W1]: NONE, [P2]: WRONG }],
  ];
  const answered = [];
  for (const [code, roll, name, plan] of runs) answered.push((await phone(code, roll, name, plan)).length);
  check('every phone is served its room\'s whole set and answers it: 4 + 4 + 4 + 4 + 3 + 3 + 2 + 2 + 2',
    same(answered, [4, 4, 4, 4, 3, 3, 2, 2, 2]), JSON.stringify(answered));
  const stored = (await repo.listAnswers({ sessionIds: Object.values(rooms).map((r) => r.id) })).length;
  check('28 answers are stored', stored === 28, `${stored}`);
}
for (const r of Object.values(rooms)) {
  const marked = await post(`/api/session/${r.code}/attendance`, { fromJoins: true });
  if (marked.status !== 200) check(`attendance in ${r.code}`, false, `HTTP ${marked.status} ${marked.body.error ?? ''}`);
}
{
  const queue = await get(`/api/review?code=${rooms.C.code}`);
  const items = queue.body.items ?? [];
  check('room C\'s three written answers wait in the review queue, provisional',
    queue.status === 200 && items.length === 3 && items.every((i) => i.reviewStatus === 'provisional'), `HTTP ${queue.status}`);
  const bilal = items.find((i) => i.student?.rollNo === '21CS02');
  const reviewed = await post(`/api/review/${bilal?.answerId}`, { decision: 'override', score: 0.8, note: 'The scheduler step is implied.' });
  check('the professor reviews Bilal\'s written answer through the review route: 0.5 becomes 0.8',
    reviewed.status === 200 && reviewed.body.item?.reviewStatus === 'overridden' && reviewed.body.item?.score === 0.8,
    `HTTP ${reviewed.status} ${reviewed.body.error ?? ''}`);
}

// ------------------------------------------------- the report, by hand --

console.log('\nthe class report, against the hand count (the default example formula)');

const reportOf = async (query = '', as) => get(`/api/classes/${classId}/attainment${query}`, as);
const studentRow = (r, roll) => r.body.students?.find((s) => s.rollNo === roll);
const coOf = (row, code) => row?.outcomes?.find((o) => o.code === code);
const counts = (cell) => [cell?.state, cell?.answers, cell?.obtained, cell?.possible];

const first = await reportOf();
{
  const b = first.body;
  check('the report answers 200 for the owner, over the three rooms in date order',
    first.status === 200 && same(b.rooms?.map((r) => r.code), [rooms.A.code, rooms.B.code, rooms.C.code]), `HTTP ${first.status} ${b.error ?? ''}`);
  check('no formula saved: the default example, version 0, and the methodology says it is an example, not a standard',
    b.formula?.source === 'example' && b.formula?.version === 0 && b.formula?.preset?.id === 'example-60-50-60-70'
    && /No formula has been saved for this class/.test(b.methodology ?? '') && /not as an institutional standard/.test(b.methodology ?? ''));
  check('students in roll order: the roster, then the roll number not on it',
    same(b.students?.map((s) => [s.rollNo, s.status]), [['21CS01', 'active'], ['21CS02', 'active'], ['21CS03', 'active'],
      ['21CS04', 'active'], ['VISIT1', 'not-on-roster']]), JSON.stringify(b.students?.map((s) => s.rollNo)));
  // 28 answers: 25 digital, the two written answers left provisional, the one reviewed.
  // Mapped: Processes (CO1) and Scheduling (CO2); Memory (M1) is mapped to nothing.
  // Every question here was written by the model (source 'llm'), so every answer is on an AI-generated question.
  check('the answer totals: 28 counted, 25 digital, 2 provisional, 1 reviewed; 24 mapped, 4 unmapped, adding up; all 28 on AI-generated questions',
    same(b.answers, { rows: 28, setAside: 0, chosen: 28, ungraded: 0, graded: 28,
      byType: { digital: 25, aiProvisional: 2, humanReviewed: 1, revote: 0 }, mapped: 24, excluded: 0, unmapped: 4,
      bySource: { aiGenerated: 28, professorWritten: 0, offlineTemplate: 0 } }), JSON.stringify(b.answers));
  check('what reaches no outcome is named: Memory, 4 answers', b.unmapped?.length === 1 && b.unmapped[0].topic === 'Memory' && b.unmapped[0].answers === 4);

  // CO1 per student: Processes questions in A and C, and the written answer.
  //   Asha    P1 P2 P3 P2 = 4 of 4 (her provisional written answer shown, not counted): attained
  //   Bilal   1 + 0 + 0 + 1 = 2 of 4, and the reviewed 0.8: 2.8 of 5 = 56%: not attained
  //   Chitra  1 + 1 + 0 + 0 = 2 of 4 = 50% (her provisional 0 not counted): not attained
  //   Dev     nothing: not enough evidence
  check('CO1, Asha: 4 of 4 counted, attained; her provisional written mark shown, not counted',
    same(counts(coOf(studentRow(first, '21CS01'), 'CO1')), ['attained', 4, 4, 4])
    && coOf(studentRow(first, '21CS01'), 'CO1')?.marks?.aiProvisional?.answers === 1
    && coOf(studentRow(first, '21CS01'), 'CO1')?.marks?.aiProvisional?.counted === false);
  check('CO1, Bilal: 2.8 of 5 (the reviewed 0.8 counts), 56%: not attained',
    same(counts(coOf(studentRow(first, '21CS02'), 'CO1')), ['not-attained', 5, 2.8, 5])
    && coOf(studentRow(first, '21CS02'), 'CO1')?.marks?.humanReviewed?.obtained === 0.8, JSON.stringify(coOf(studentRow(first, '21CS02'), 'CO1')));
  check('CO1, Chitra: 2 of 4: not attained; Dev: no answers, not enough evidence (never "not attained")',
    same(counts(coOf(studentRow(first, '21CS03'), 'CO1')), ['not-attained', 4, 2, 4])
    && same(counts(coOf(studentRow(first, '21CS04'), 'CO1')), ['not-enough-evidence', 0, 0, 0]));
  const co1 = coOf(b, 'CO1');
  check('CO1 for the class: 1 of 3 counted attained (33.3%): level 0; Dev not counted; the visitor beside, not in it',
    same(co1?.students, { roster: 4, counted: 3, attained: 1, notAttained: 2, notEnoughEvidence: 1, withNoAnswers: 1 })
    && co1?.share === 0.3333 && co1?.attainmentLevel === 0
    && same(co1?.outside?.removed, { students: 0, answers: 0 }) && same(co1?.outside?.notOnRoster, { students: 1, answers: 3 })
    // Dev, short of evidence, has no answer, so nothing of the roster's is outside the share.
    && co1?.outside?.notEnoughEvidence?.students === 0 && co1?.outside?.notEnoughEvidence?.answers === 0, JSON.stringify(co1?.students));
  // The share's evidence is the three counted students' (Asha, Bilal, Chitra): Dev has none, so it is every roster answer.
  check('CO1 rests on 12 digital answers (8 marks), 1 reviewed (0.8), with 2 provisional shown apart',
    co1?.marks?.digital?.answers === 12 && co1?.marks?.digital?.obtained === 8 && co1?.marks?.humanReviewed?.answers === 1
    && co1?.marks?.aiProvisional?.answers === 2 && co1?.marks?.aiProvisional?.counted === false
    && /Rests on 13 counted answers from the 3 students counted: 12 digital and 1 reviewed written\. 2 provisional written answers are shown but not counted\./.test(co1?.summary ?? ''),
    co1?.summary);
  // CO2: Asha S 2 of 3 attained; Bilal 1 of 3 not; Chitra and Dev absent from room B.
  const co2 = coOf(b, 'CO2');
  check('CO2 for the class: 1 of 2 counted (50%): level 1, two on the roster without evidence',
    same(co2?.students, { roster: 4, counted: 2, attained: 1, notAttained: 1, notEnoughEvidence: 2, withNoAnswers: 2 })
    && co2?.share === 0.5 && co2?.attainmentLevel === 1, JSON.stringify(co2?.students));
  // Bloom: Understand is CO1's questions without the written one; Remember is M1 alone.
  //   lower band (Remember and Understand): Asha 5 of 5; Bilal 2 of 5; Chitra 3 of 5 = exactly 60%: attained
  const lower = b.bloom?.bands?.find((x) => x.id === 'lower');
  const chitraLower = studentRow(first, '21CS03')?.bloom?.bands?.find((x) => x.id === 'lower');
  check('Bloom, lower band: Chitra\'s 3 of 5 is exactly 60%, attained; the class 2 of 3: level 2',
    same(counts(chitraLower), ['attained', 5, 3, 5]) && lower?.students?.attained === 2 && lower?.students?.counted === 3
    && lower?.attainmentLevel === 2, JSON.stringify(chitraLower));
  const apply = b.bloom?.levels?.find((x) => x.level === 'apply');
  check('Bloom, Apply: Asha 2 of 3, Bilal 1 of 3: level 1', apply?.students?.counted === 2 && apply?.attainmentLevel === 1);
  check('every figure says what it rests on, and the report carries its definitions and privacy line',
    ['digital', 'aiProvisional', 'humanReviewed', 'ungraded'].every((t) => co1?.marks?.[t] !== undefined)
    && typeof b.definitions?.states === 'string' && /staff only/.test(b.privacy ?? ''));
  check('no ranks and no labels anywhere in the report', !/"rank"|slow learner|weak student|topper/i.test(JSON.stringify(b)));
}

// ----------------------------------------------------- one student --

console.log('\none student\'s report, with the answers behind it');
{
  const r = await get(`/api/classes/${classId}/attainment/students/${studentId('21CS02')}`);
  const b = r.body;
  check('Bilal\'s report: CO1 2.8 of 5 not attained, CO2 1 of 3 not attained, as in the class report',
    r.status === 200 && same(counts(coOf(b, 'CO1')), ['not-attained', 5, 2.8, 5]) && same(counts(coOf(b, 'CO2')), ['not-attained', 3, 1, 3]),
    `HTTP ${r.status} ${b.error ?? ''}`);
  const written = b.answers?.find((a) => a.questionId === W1);
  check('all 9 of his answers, each with its type and whether it counted: the reviewed written one counts, with the professor\'s mark',
    b.answers?.length === 9 && written?.evidenceType === 'humanReviewed' && written?.counts === true && written?.score === 0.8
    && written?.review?.status === 'overridden' && written?.outcomes?.[0]?.code === 'CO1');
  const memory = b.answers?.find((a) => a.questionId === M1);
  check('an answer no outcome reaches says so', memory?.via === 'unmapped' && /No course outcome is mapped to its topic \("Memory"\)/.test(memory?.note ?? ''));
  const chitra = await get(`/api/classes/${classId}/attainment/students/${studentId('21CS03')}`);
  const her = chitra.body.answers?.find((a) => a.questionId === W1);
  check('Chitra\'s provisional written answer is shown, not counted, and says why',
    her?.evidenceType === 'aiProvisional' && her?.counts === false && /Shown, not counted/.test(her?.note ?? ''));
  const other = (await post('/api/classes', { courseName: 'Compilers', section: 'TY-CS B' })).body.class?.id;
  const elsewhere = (await post(`/api/classes/${other}/students`, { students: [{ roll: '21CS02', name: 'Bilal Khan' }] })).body.added?.[0]?.id;
  const wrongClass = await get(`/api/classes/${classId}/attainment/students/${elsewhere}`);
  const nobody = await get(`/api/classes/${classId}/attainment/students/${NOWHERE}`);
  check('a student of another class, and an id that names nobody, are the same 404',
    wrongClass.status === 404 && nobody.status === 404 && wrongClass.body.error === nobody.body.error
    && wrongClass.body.error === 'That student was not found.');
}

// ------------------------------------------------------- the register --

console.log('\nthe marks register');
{
  const r = await get(`/api/classes/${classId}/register`);
  const row = (roll) => r.body.students?.find((s) => s.rollNo === roll);
  const cell = (roll, i) => row(roll)?.rooms?.[i];
  const pair = (c) => [c?.counted?.obtained, c?.counted?.possible];
  check('a register over the three rooms, students in roll order',
    r.status === 200 && same(r.body.rooms?.map((x) => x.code), [rooms.A.code, rooms.B.code, rooms.C.code])
    && same(r.body.students?.map((s) => s.rollNo), ['21CS01', '21CS02', '21CS03', '21CS04', 'VISIT1']), `HTTP ${r.status} ${r.body.error ?? ''}`);
  // Asha: A 4 of 4, B 2 of 3, C 1 of 1 (her written answer provisional, shown apart): 7 of 8.
  check('Asha: 4 of 4, 2 of 3, 1 of 1, total 7 of 8, present at all three; the provisional written mark shown apart',
    same([pair(cell('21CS01', 0)), pair(cell('21CS01', 1)), pair(cell('21CS01', 2)), pair(row('21CS01')?.total)], [[4, 4], [2, 3], [1, 1], [7, 8]])
    && cell('21CS01', 2)?.marks?.aiProvisional?.answers === 1 && same(row('21CS01')?.total?.attendance, { present: 3, late: 0, absent: 0, unmarked: 0 }));
  // Bilal: A 1 of 4, B 1 of 3, C 1 + 0.8 of 2: 3.8 of 9.
  check('Bilal: 1 of 4, 1 of 3, 1.8 of 2 (the reviewed mark), total 3.8 of 9',
    same([pair(cell('21CS02', 0)), pair(cell('21CS02', 1)), pair(cell('21CS02', 2)), pair(row('21CS02')?.total)], [[1, 4], [1, 3], [1.8, 2], [3.8, 9]]));
  check('Chitra, absent from B: absent there with no marks, not a zero; total 3 of 5',
    cell('21CS03', 1)?.attendance === 'absent' && cell('21CS03', 1)?.answered === false && same(pair(cell('21CS03', 1)), [0, 0])
    && cell('21CS03', 1)?.counted?.share === null && same(pair(row('21CS03')?.total), [3, 5]));
  check('Dev, absent from all three: three absences, nothing marked', same(row('21CS04')?.total?.attendance, { present: 0, late: 0, absent: 3, unmarked: 0 })
    && same(pair(row('21CS04')?.total), [0, 0]));
  check('the visitor: 4 of 4 in A, joined, no attendance mark (not on the roster)',
    row('VISIT1')?.status === 'not-on-roster' && same(pair(cell('VISIT1', 0)), [4, 4]) && cell('VISIT1', 0)?.attendance === null && cell('VISIT1', 0)?.joined === true);
  check('the register says how it counts: absent is not zero, no room weights', /not a zero/.test(r.body.methodology ?? '')
    && /room weights do not apply here/.test(r.body.methodology ?? ''));
}

// -------------------------------------------------- the teacher records --

console.log('\nteacher records beside the figures');
{
  const obs = await post(`/api/session/${rooms.C.code}/observations`, { rollNo: '21CS03', kind: 'support' });
  const tally = await post(`/api/session/${rooms.A.code}/tallies`, { text: 'Which state is a process in when it waits for I/O?', counts: [2, 1, 0, 0] });
  check('an observation and a hand tally are recorded', obs.status === 200 && tally.status === 201, `${obs.status} ${tally.status}`);
  const after = await reportOf();
  const t = after.body.teacherRecords;
  check('they appear in their own, labelled section', /never part of one/.test(t?.label ?? '')
    && t?.observations?.counts?.support === 1 && t?.tallies?.questions === 1 && t?.tallies?.hands === 3
    && studentRow(after, '21CS03')?.records?.observations?.support === 1);
  const strip = (b) => JSON.stringify([b.outcomes, b.bloom, b.answers, b.students?.map(({ records, ...s }) => s)]);
  check('and move no figure: every outcome, level and student is as before', strip(after.body) === strip(first.body));
}

// ---------------------------------------------------------- the formula --

console.log('\nthe formula: saved, changed, and every change shown');

const configPath = `/api/classes/${classId}/attainment/config`;
const methodology = async () => (await reportOf()).body.methodology ?? '';
{
  const presets = await get('/api/attainment/presets');
  check('the presets are examples, named as such, with the default named',
    presets.status === 200 && presets.body.presets?.length === 2 && presets.body.presets.every((p) => /^Example: /.test(p.name))
    && presets.body.default === 'example-60-50-60-70' && /not an institutional standard/.test(presets.body.note ?? ''));
  const read = await get(configPath);
  check('GET config: the default, version 0, editable by the owner, the same methodology as the report',
    read.status === 200 && read.body.formula?.version === 0 && read.body.canEdit === true && read.body.methodology === first.body.methodology);

  const before = await methodology();
  const v1 = await put(configPath, { preset: 'example-60-60-70-85' });
  const r1 = await reportOf();
  check('saving the stricter example: version 1; CO2\'s 50% is now under level 1 (60%), so level 0',
    v1.status === 200 && v1.body.changed === true && v1.body.formula?.version === 1 && coOf(r1.body, 'CO2')?.attainmentLevel === 0
    && r1.body.formula?.version === 1, `HTTP ${v1.status} ${v1.body.error ?? ''}`);
  check('and the methodology says so', r1.body.methodology !== before && /version 1 of this class's formula/.test(r1.body.methodology)
    && /level 3 from 85%/.test(r1.body.methodology) && /the same as the example/.test(r1.body.methodology));
  const again = await put(configPath, { preset: 'example-60-60-70-85' });
  check('the same save again writes nothing', again.status === 200 && again.body.changed === false && again.body.formula?.version === 1);

  const v2 = await put(configPath, { config: { studentThreshold: 0.5 } });
  const r2 = await reportOf();
  // Bilal's 56% and Chitra's 50% now reach 50%: CO1 3 of 3, level 3.
  check('a 50% threshold: Bilal (56%) and Chitra (exactly 50%) attain CO1, the class reaches level 3',
    v2.body.formula?.version === 2 && coOf(studentRow(r2, '21CS03'), 'CO1')?.state === 'attained'
    && coOf(studentRow(r2, '21CS02'), 'CO1')?.state === 'attained' && coOf(r2.body, 'CO1')?.attainmentLevel === 3,
    JSON.stringify(coOf(r2.body, 'CO1')?.students));
  check('the methodology: 50%, and this class\'s own formula', /at least 50% of the marks/.test(r2.body.methodology)
    && /version 2 of this class's own formula/.test(r2.body.methodology));

  const v3 = await put(configPath, { config: { attempts: 'best', studentThreshold: 0.6 } });
  const r3 = await reportOf();
  // Best attempts: P2 counts once per student. Bilal: P1 1, P2 1 (room C), P3 0, written 0.8: 2.8 of 4 = 70%.
  check('best attempts: P2, answered in two rooms, counts once; Bilal 2.8 of 4 (70%) now attains CO1; 3 attempts set aside',
    v3.body.formula?.version === 3 && same(counts(coOf(studentRow(r3, '21CS02'), 'CO1')), ['attained', 4, 2.8, 4])
    && r3.body.answers?.setAside === 3 && /only their best attempt at each question/.test(r3.body.methodology),
    JSON.stringify(coOf(studentRow(r3, '21CS02'), 'CO1')));

  const v4 = await put(configPath, { config: { roomWeights: [{ code: rooms.C.code.toLowerCase(), weight: 2 }] } });
  const r4 = await reportOf();
  // Room C counts double: Bilal 1 (A) + 1 x 2 (C) + 0 (A) + 0.8 x 2 (C) = 4.6 of 6.
  check('room C counting double: Bilal 4.6 of 6; the room list and the methodology name the weight',
    v4.body.formula?.version === 4 && same(counts(coOf(studentRow(r4, '21CS02'), 'CO1')), ['attained', 4, 4.6, 6])
    && r4.body.rooms?.[2]?.weight === 2 && r4.body.formula?.roomWeights?.[0]?.code === rooms.C.code
    && r4.body.methodology.includes(`Rooms are weighted: ${rooms.C.code} x 2`), JSON.stringify(coOf(studentRow(r4, '21CS02'), 'CO1')));

  const bad = await put(configPath, { config: { levels: [{ level: 1, minShare: 0.7 }, { level: 2, minShare: 0.6 }] } });
  const unknownRoom = await put(configPath, { config: { roomWeights: [{ code: 'ZZZZZZ', weight: 2 }] } });
  const records = await put(configPath, { config: { evidence: { observations: true } } });
  check('levels that do not increase, a room not of the class and counting observations are each a 400',
    bad.status === 400 && /strictly increase/.test(bad.body.error ?? '') && unknownRoom.status === 400
    && records.status === 400 && /decision 3/.test(records.body.error ?? ''), `${bad.status} ${unknownRoom.status} ${records.status}`);
  check('and none of them saved anything', (await get(configPath)).body.formula?.version === 4);
}

// ------------------------------------------------------- the windows --

console.log('\nwhich rooms a report counts');
{
  const onlyA = await reportOf(`?rooms=${rooms.A.code}`);
  check('?rooms= one code: that room only, 16 answers', onlyA.status === 200 && onlyA.body.rooms?.length === 1
    && onlyA.body.answers?.rows === 16 && same(onlyA.body.window?.rooms, [rooms.A.code]));
  // Formula version 4 weights room C, which ?rooms=A leaves out: it is named, and
  // said to be outside the report, never called deleted.
  const sheetA = await fetch(`${base}/api/classes/${classId}/attainment?rooms=${rooms.A.code}&format=csv`,
    { headers: { authorization: `Bearer ${TOKENS.profA}` } });
  const sheetText = await sheetA.text();
  check('a weighted room outside the window is named as such in the methodology, the formula and the sheet, never "deleted"',
    onlyA.body.methodology?.includes(`Rooms are weighted: ${rooms.C.code} x 2 (a room not in this report); every other room x 1.`)
    && same(onlyA.body.formula?.roomWeights?.map((w) => [w.code, w.found, w.inReport]), [[rooms.C.code, true, false]])
    && sheetText.includes(`${rooms.C.code} x 2 (a room not in this report); every other room x 1`)
    && !/since deleted/.test(`${onlyA.body.methodology} ${sheetText}`), onlyA.body.formula?.roomWeights && JSON.stringify(onlyA.body.formula.roomWeights));
  const late = await reportOf('?from=2026-11-05');
  check('?from= a date: the rooms opened from that day, B and C', same(late.body.rooms?.map((r) => r.code), [rooms.B.code, rooms.C.code]));
  const regLate = await get(`/api/classes/${classId}/register?to=2026-11-10`);
  check('the register takes the same window: A and B', same(regLate.body.rooms?.map((r) => r.code), [rooms.A.code, rooms.B.code]));
  const badCode = await reportOf('?rooms=ZZZZZZ');
  const badDay = await reportOf('?from=19-11-2026');
  check('a code not of this class and a date not as YYYY-MM-DD are 400s', badCode.status === 400 && badDay.status === 400);
}

// -------------------------------------------------------- who may ask --

console.log('\nanother professor, the HOD, a student, nobody');
{
  const paths = [
    `/api/classes/${classId}/attainment`, `/api/classes/${classId}/attainment/config`, `/api/classes/${classId}/register`,
    `/api/classes/${classId}/attainment/students/${studentId('21CS01')}`,
  ];
  const nowhere = (p) => p.replace(classId, NOWHERE);
  for (const p of paths) same404(`another professor: ${p.split(classId)[1]} is the same 404 as no class at all`, await get(p, 'profB'), await get(nowhere(p), 'profB'));
  same404('another professor\'s save: the same 404', await put(paths[1], { preset: 'example-60-50-60-70' }, 'profB'),
    await put(nowhere(paths[1]), { preset: 'example-60-50-60-70' }, 'profB'));
  const hodReads = await Promise.all(paths.map((p) => get(p, 'hod')));
  check('the HOD of the department reads all four', hodReads.every((r) => r.status === 200), hodReads.map((r) => r.status).join());
  check('marked read-only', hodReads[1].body.canEdit === false);
  const hodSave = await put(paths[1], { preset: 'example-60-50-60-70' }, 'hod');
  check('the HOD\'s save is a 403 and changes nothing', hodSave.status === 403 && (await get(paths[1])).body.formula?.version === 4);
  check('an HOD of another department gets the 404', (await get(paths[0], 'hodOther')).status === 404);
  const asStudent = await Promise.all([...paths.map((p) => get(p, 'student')), get('/api/attainment/presets', 'student')]);
  const anon = await Promise.all([...paths.map((p) => get(p, null)), get('/api/attainment/presets', null)]);
  check('a student account gets 403 on every one, the presets included', asStudent.every((r) => r.status === 403), asStudent.map((r) => r.status).join());
  check('no credentials get 401', anon.every((r) => r.status === 401), anon.map((r) => r.status).join());
}

// ----------------------------------------------- a corrected roll number --

console.log('\na roll number corrected after the student answered (0021)');
{
  // Chitra answered rooms A and C as 21CS03; her phone's join marked her present
  // under 21CS03, and the professor's "joined present" kept that roll number.
  const marksA = await repo.listAttendance(rooms.A.id);
  check('her mark in room A carries the roll number she joined with',
    marksA.find((m) => m.classStudentId === studentId('21CS03'))?.rollNo === '21CS03', JSON.stringify(marksA.map((m) => m.rollNo)));
  const before = await reportOf();
  const regBefore = await get(`/api/classes/${classId}/register`);
  const renamed = await call('PATCH', `/api/classes/${classId}/students/${studentId('21CS03')}`, { body: { rollNo: '21CS13' } });
  const after = await reportOf();
  const her = studentRow(after, '21CS13');
  check('the roster now holds 21CS13 for her', renamed.status === 200 && renamed.body.student?.rollNo === '21CS13',
    `HTTP ${renamed.status} ${renamed.body.error ?? ''}`);
  check('her answers stay in her own row: every outcome, level and band as before the correction',
    same([her?.outcomes, her?.bloom], [studentRow(before, '21CS03')?.outcomes, studentRow(before, '21CS03')?.bloom])
    && her?.status === 'active' && !studentRow(after, '21CS03'), JSON.stringify(her?.outcomes?.map((o) => [o.code, o.state, o.answers])));
  check('and in the class figures: every outcome, level and band as before',
    same(after.body.outcomes?.map((o) => [o.students, o.share, o.marks]), before.body.outcomes?.map((o) => [o.students, o.share, o.marks]))
    && same(after.body.bloom, before.body.bloom) && same(after.body.rollNotes?.map((n) => n.rollNo), ['VISIT1']));
  const reg = await get(`/api/classes/${classId}/register`);
  const row = reg.body.students?.find((s) => s.rollNo === '21CS13');
  check('the register: present in A and C with her marks, under 21CS13; no row is left under 21CS03',
    same(row?.rooms?.map((c) => [c.attendance, c.answered, c.counted]),
      regBefore.body.students?.find((s) => s.rollNo === '21CS03')?.rooms?.map((c) => [c.attendance, c.answered, c.counted]))
    && row?.rooms?.[0]?.answered === true && !reg.body.students?.some((s) => s.rollNo === '21CS03'));
  const one = await get(`/api/classes/${classId}/attainment/students/${studentId('21CS03')}`);
  check('her own report finds every answer, each saying the roll number it was given under',
    one.body.answers?.length === 6 && one.body.answers.every((a) => a.givenAs === '21CS03'), `${one.body.answers?.length}`);
  // The professor corrects room A's attendance afterwards: the mark keeps the roll number her answers were given under.
  const late = await post(`/api/session/${rooms.A.code}/attendance`, { marks: [{ studentId: studentId('21CS03'), status: 'late' }] });
  const again = await reportOf();
  check('a teacher mark made after the correction keeps the roll number the room\'s mark carried, and the answers stay hers',
    late.status === 200 && (await repo.listAttendance(rooms.A.id)).find((m) => m.classStudentId === studentId('21CS03'))?.rollNo === '21CS03'
    && same(studentRow(again, '21CS13')?.outcomes, her?.outcomes), `HTTP ${late.status} ${late.body.error ?? ''}`);
}

// ------------------------------------------------------------ privacy --

console.log('\nnothing reaches a phone');
{
  const publicRead = await Promise.all(Object.values(rooms).map((r) => get(`/api/session/${r.code}`, null)));
  const said = JSON.stringify([phoneSaw, publicRead.map((r) => r.body)]);
  // "register" as a whole word: the phone is shown a written question's rubric
  // once answered, and this one's says "saves registers".
  check(`no phone payload (${phoneSaw.length} of them) and no public room read mentions attainment, marks or the register`,
    phoneSaw.length > 20 && !/attain|methodology|evidenceType|studentThreshold|notEnoughEvidence|\bregister\b|\bCO[12]\b/i.test(said));
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.fetch = realFetch;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
