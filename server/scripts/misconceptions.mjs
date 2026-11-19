// Phase 5 - misconception labels on wrong options, end to end.
//
//   node server/scripts/misconceptions.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with phones over Socket.io, a
// projector, and signed-in staff, and checks:
//
//   labels      the owner labels wrong options of a Choose one, a Choose all and
//               a True or false question; a right answer, a poll, an over-long
//               label and one holding contact details are refused, and nothing
//               is written; an approved question stays approved, a draft stays
//               a draft, and approving a draft does not confirm its AI labels
//   who         an HOD of the department reads every report and the labels and
//               is refused every write (403); another professor, and an HOD of
//               another department, get the same 404 as for a room, class or
//               question that does not exist, word for word; no credentials, 401
//   rooms       three rooms of one class: six phones answer a Choose one and a
//               True or false, five a Choose all, two the Choose one again; each
//               chooses by the text on its own screen
//   reports     the room's, the class's and the question's counts held to a hand
//               count of who chose what: distinct students (one student in two
//               rooms of a class is one student, two answers), the AI drafts
//               marked as drafts, a label added after the answers saying so, the
//               item report carrying each option's label, a class question's
//               votes never counted
//   edits       a label reworded, the options reordered, a labelled option
//               reworded (its label removed, and the reply says so), an AI label
//               confirmed, a label cleared: the reports follow each one
//   phones      nothing a phone or the projector received ever carried a label,
//               and no stored answer or class question snapshot holds one
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. So,
// as server/scripts/roster.mjs does, the server is pointed at
// http://supabase.invalid (a name that can never resolve) and every request to
// it is answered here, in-process, by a stand-in for the three calls the server
// makes about accounts. Any other request off this machine is refused outright.
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
const { stampLabels } = await import(`${SRC}services/misconceptions.js`);

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
  hod: 'd0000000-0000-4000-8000-000000000001',
  profA: 'd0000000-0000-4000-8000-000000000002',
  profB: 'd0000000-0000-4000-8000-000000000003',
  hodOther: 'd0000000-0000-4000-8000-000000000004',
};
const account = (id, role, department, reportsTo) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-MCTS0${id.slice(-1)}`,
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
    throw new Error(`misconceptions.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by misconceptions.mjs: ${url.pathname}` }, 404);
};
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'misconceptions-test-service-key';

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

// ------------------------------------------------------------- sockets --

/** Every event every phone and the projector received, to look for a label in afterwards. */
const phoneLog = [];
const wallLog = [];

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

/** Resolves with whichever of the events arrives first. */
function either(socket, events, ms = 4000) {
  return new Promise((resolve, reject) => {
    const handlers = {};
    const timer = setTimeout(() => {
      for (const [e, h] of Object.entries(handlers)) socket.off(e, h);
      reject(new Error(`timeout waiting for ${events.join(' / ')}`));
    }, ms);
    for (const e of events) {
      handlers[e] = (p) => {
        clearTimeout(timer);
        for (const [e2, h] of Object.entries(handlers)) socket.off(e2, h);
        resolve({ name: e, payload: p });
      };
      socket.on(e, handlers[e]);
    }
  });
}

/** What the phone sends for the student's choice, read off its own screen: option words, or true/false. */
function respond(shown, choice) {
  if (typeof choice === 'boolean') return choice;
  if (Array.isArray(choice)) return choice.map((t) => shown.options.indexOf(t));
  return shown.options.indexOf(choice);
}

/**
 * Join, then answer every question served until the room has nothing left,
 * choosing from `plan` (question text -> roll number -> choice). The phone stays
 * connected, so a class question can still reach it.
 */
async function sit(code, rollNo, plan) {
  const s = await connect();
  s.onAny((event, payload) => phoneLog.push({ rollNo, event, payload }));
  const accepted = either(s, ['session:accepted', 'session:rejected']);
  let next = either(s, ['server:question', 'server:exhausted']);
  s.emit('student:join', { code, rollNo, name: `Student ${rollNo}` });
  await accepted;
  const served = [];
  let error = null;
  try {
    for (let k = 0; k < 10; k += 1) {
      const ev = await next;
      if (ev.name === 'server:exhausted') break;
      const q = ev.payload.question;
      served.push(q.text);
      const choice = plan[q.text]?.[rollNo];
      const result = either(s, ['server:result', 'session:rejected']);
      s.emit('student:answer', { questionId: q._id, response: choice === undefined ? 0 : respond(q, choice), answerId: `${code}-${rollNo}-${k}` });
      await result;
      next = either(s, ['server:question', 'server:exhausted']);
      s.emit('student:next');
    }
  } catch (err) {
    error = err.message;
  }
  return { s, served, error };
}

// ------------------------------------------------------------ fixtures --

console.log('\nthe bank, a class and its roster');

const content = await repo.createContent({ title: 'Transport layer', kind: 'syllabus', rawText: '', topics: ['UDP'], ownerId: ID.profA });
const [QM, QT, QX, QP] = await repo.insertQuestions([
  { contentId: content._id, topic: 'UDP', text: 'Which protocol is connectionless?', kind: 'mcq', options: ['TCP', 'UDP', 'SCTP', 'QUIC'],
    answerIdx: 1, bloom: 'remember', source: 'teacher', status: 'active', approvedBy: ID.profA, approvedAt: '2026-11-19T07:00:00.000Z' },
  { contentId: content._id, topic: 'UDP', text: 'UDP guarantees delivery.', kind: 'truefalse', answerBool: false, bloom: 'remember',
    source: 'teacher', status: 'active' },
  { contentId: content._id, topic: 'UDP', text: 'Which does UDP give an application?', kind: 'multi',
    options: ['Ports', 'Checksums', 'Retransmission', 'A handshake', 'Ordering'], answerIdxs: [0, 1], bloom: 'analyse', source: 'llm',
    model: 'test-model', status: 'active', approvedBy: ID.profA, approvedAt: '2026-11-19T07:00:00.000Z',
    // As the generator stores what the model proposed: AI drafts.
    misconceptions: stampLabels([
      { option: 'Retransmission', label: 'Thinks UDP resends lost datagrams', provenance: 'ai' },
      { option: 'A handshake', label: 'Carries TCP\'s handshake over to UDP', provenance: 'ai' },
    ]) },
  { contentId: content._id, topic: 'UDP', text: 'Have you used UDP before?', kind: 'poll', options: ['Yes', 'No'], bloom: 'remember',
    source: 'teacher', status: 'active' },
]);
const [QD] = await repo.insertQuestions([{
  contentId: content._id, topic: 'UDP', text: 'Which header field does UDP use to find the process?', kind: 'mcq',
  options: ['Port', 'Checksum', 'Length', 'Window'], answerIdx: 0, bloom: 'remember', source: 'llm', model: 'test-model', status: 'draft',
  misconceptions: stampLabels([
    { option: 'Window', label: 'Carries TCP\'s window field over to UDP', provenance: 'ai' },
    { option: 'Checksum', label: 'Takes the checksum for an address', provenance: 'ai' },
  ]),
}]);

const made = await post('/api/classes', { courseName: 'Computer Networks', section: 'TY-A' });
const classId = made.body.class?.id;
const ROSTER = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07'];
const added = await post(`/api/classes/${classId}/students`, { students: ROSTER.map((roll) => ({ roll, name: `Student ${roll}` })) });
check('the professor makes a class of seven', made.status === 201 && added.status === 200 && added.body.added?.length === 7,
  `${made.status} ${added.status} ${JSON.stringify(added.body.refused ?? made.body)}`);

const LABEL = {
  tcp: 'Thinks TCP is connectionless',
  sctp: 'Takes SCTP for a datagram protocol',
  tf: 'Thinks UDP acknowledges each datagram',
  retrans: 'Thinks UDP resends lost datagrams',
  shake: 'Carries TCP\'s handshake over to UDP',
  tcp2: 'Believes TCP sends without setting up a connection',
};
const labelsPath = (q) => `/api/bank/question/${q._id}/misconceptions`;
const stored = async (q) => (await repo.getQuestion(q._id)).misconceptions;

// --------------------------------------------------------------- labels --

console.log('\nlabels: the owner adds them; refusals write nothing');

{
  const r = await patch(labelsPath(QM), { misconceptions: [{ option: 0, label: LABEL.tcp }, { option: 2, label: LABEL.sctp }] });
  check('the owner labels two wrong options of a Choose one: 200, each the professor\'s',
    r.status === 200 && same(r.body.misconceptions?.map((l) => [l.optionIdx, l.option, l.label, l.provenance]),
      [[0, 'TCP', LABEL.tcp, 'professor'], [2, 'SCTP', LABEL.sctp, 'professor']])
    && same(r.body.changed, [{ optionIdx: 0, action: 'added' }, { optionIdx: 2, action: 'added' }]) && r.body.canEdit === true,
    JSON.stringify(r.body));
  const q = await repo.getQuestion(QM._id);
  check('a label changes no mark, so the approved question stays approved: same status, approval and checks',
    q.status === 'active' && q.approvedAt === QM.approvedAt && q.approvedBy === QM.approvedBy && same(q.checks, QM.checks)
    && same(q.options, QM.options) && q.answerIdx === 1, JSON.stringify({ status: q.status, approvedAt: q.approvedAt }));
  check('and the reply says so in a sentence that names no field', /does not send an approved question back to draft/.test(r.body.note ?? '')
    && !/misconceptions|answerIdx|PATCH|\/api/.test(r.body.note ?? ''), r.body.note);

  const before = JSON.stringify(await stored(QM));
  const key = await patch(labelsPath(QM), { misconceptions: [{ option: 1, label: 'On the key' }] });
  const long = await patch(labelsPath(QM), { misconceptions: [{ option: 3, label: 'x'.repeat(121) }] });
  const contact = await patch(labelsPath(QM), { misconceptions: [{ option: 3, label: 'Ask me on 98765 43210' }] });
  const mixed = await patch(labelsPath(QM), { misconceptions: [{ option: 3, label: 'Fine on its own' }, { option: 1, label: 'Not fine' }] });
  const poll = await patch(labelsPath(QP), { misconceptions: [{ option: 1, label: 'Has not used it' }] });
  check('a label on the right answer is refused with a sentence: 400', key.status === 400 && /right answer/.test(key.body.error ?? ''), key.body.error);
  check('an over-long label and one holding a phone number are refused', long.status === 400 && /at most 120 characters/.test(long.body.error ?? '')
    && contact.status === 400 && /not a person/.test(contact.body.error ?? ''), `${long.body.error} | ${contact.body.error}`);
  check('one bad change refuses the lot', mixed.status === 400);
  check('a poll takes none: it has no wrong answer', poll.status === 400 && /A poll has no wrong answer/.test(poll.body.error ?? ''), poll.body.error);
  check('none of the refusals wrote anything', JSON.stringify(await stored(QM)) === before && (await stored(QP)).length === 0);
}

console.log('\nwho may read and write them');

{
  const before = JSON.stringify(await stored(QM));
  const hodWrite = await patch(labelsPath(QM), { misconceptions: [{ option: 3, label: 'An HOD\'s label' }] }, 'hod');
  check('an HOD of the department is refused: 403, and nothing is written', hodWrite.status === 403 && JSON.stringify(await stored(QM)) === before,
    `HTTP ${hodWrite.status}`);
  const hodRead = await get(labelsPath(QM), 'hod');
  check('the HOD reads the labels, told they may not edit them', hodRead.status === 200 && hodRead.body.canEdit === false
    && hodRead.body.misconceptions?.length === 2, JSON.stringify(hodRead.body.canEdit));
  const nowhere = await patch('/api/bank/question/ffffffffffffffffffffffff/misconceptions', { misconceptions: [{ option: 0, label: 'x' }] });
  const outsider = await patch(labelsPath(QM), { misconceptions: [{ option: 3, label: 'x' }] }, 'profB');
  check('another professor writing gets the same 404 as a question that does not exist, word for word',
    nowhere.status === 404 && outsider.status === 404 && same(outsider.body, nowhere.body), JSON.stringify([outsider.body, nowhere.body]));
  const nowhereRead = await get('/api/bank/question/ffffffffffffffffffffffff/misconceptions');
  check('and reading, for a professor or an HOD of another department', same((await get(labelsPath(QM), 'profB')).body, nowhereRead.body)
    && same((await get(labelsPath(QM), 'hodOther')).body, nowhereRead.body) && nowhereRead.status === 404);
  check('no credentials (a phone has none): 401', (await get(labelsPath(QM), null)).status === 401
    && (await patch(labelsPath(QM), { misconceptions: [{ option: 3, label: 'x' }] }, null)).status === 401);
  check('nothing changed', JSON.stringify(await stored(QM)) === before);
}

console.log('\na draft: its AI labels stay drafts until confirmed, whatever happens to the question');

{
  const confirm = await patch(labelsPath(QD), { misconceptions: [{ option: 3, confirm: true }] });
  const q = await repo.getQuestion(QD._id);
  check('confirming one AI label on a draft: it is the professor\'s now, the other still an AI draft, and the draft stays a draft',
    confirm.status === 200 && same(confirm.body.misconceptions?.map((l) => [l.option, l.provenance, l.provenanceLabel]),
      [['Checksum', 'ai', 'AI draft'], ['Window', 'professor', 'Professor\'s label']])
    && q.status === 'draft' && q.approvedAt === null, JSON.stringify({ body: confirm.body.misconceptions, status: q.status }));
  const approve = await post(`/api/bank/question/${QD._id}/approve`, {});
  check('approving the question lets it into rooms and confirms no label', approve.status === 200 && approve.body.question?.status === 'active'
    && same((await stored(QD)).map((l) => [l.option, l.provenance]), [['Checksum', 'ai'], ['Window', 'professor']]),
    JSON.stringify(await stored(QD)));
  const bank = await get(`/api/bank/${content._id}`);
  check('the bank says which kinds take a label and how long one may be',
    bank.status === 200 && same(bank.body.misconceptionLabels?.kinds, ['mcq', 'multi', 'truefalse']) && bank.body.misconceptionLabels?.maxLength === 120);
}

// ---------------------------------------------------------------- rooms --

console.log('\nthree rooms of the class, phones choosing by what their own screens show');

const PLAN1 = {
  [QM.text]: { S01: 'TCP', S02: 'TCP', S03: 'UDP', S04: 'SCTP', S05: 'QUIC', S06: 'TCP' },
  [QT.text]: { S01: true, S02: false, S03: true, S04: false, S05: false, S06: true },
};
const PLAN2 = {
  [QX.text]: {
    S01: ['Ports', 'Checksums', 'Retransmission'], S02: ['Ports', 'Retransmission', 'A handshake'], S03: ['Ports', 'Checksums'],
    S04: ['Retransmission'], S05: ['Ports', 'Checksums', 'A handshake'],
  },
};
const PLAN3 = { [QM.text]: { S01: 'TCP', S07: 'SCTP' } };

const open = (questionIds, startLevel) => post('/api/session', {
  contentId: String(content._id), classId, questionIds: questionIds.map((q) => String(q._id)), startLevel,
});
const room1 = await open([QM, QT], 'remember');
const room2 = await open([QX], 'analyse');
const room3 = await open([QM], 'remember');
check('three rooms open for the class, each on its own set', [room1, room2, room3].every((r) => r.status === 200 && r.body.classId === classId),
  JSON.stringify([room1, room2, room3].map((r) => [r.status, r.body.error])));
const [code1, code2, code3] = [room1.body.code, room2.body.code, room3.body.code];

const phones1 = {};
const errors = [];
for (const roll of ROSTER.slice(0, 6)) {
  phones1[roll] = await sit(code1, roll, PLAN1);
  if (phones1[roll].error || phones1[roll].served.length !== 2) errors.push(`${roll}: ${phones1[roll].error ?? phones1[roll].served.length}`);
}
const others = [];
for (const roll of ROSTER.slice(0, 5)) others.push({ roll, ...(await sit(code2, roll, PLAN2)) });
for (const roll of ['S01', 'S07']) others.push({ roll, ...(await sit(code3, roll, PLAN3)) });
for (const o of others) {
  if (o.error || o.served.length !== 1) errors.push(`${o.roll}: ${o.error ?? o.served.length}`);
  o.s.close();
}
check('every phone was served every question of its room\'s set, and answered it', errors.length === 0, errors.join('; '));

// -------------------------------------------------------------- reports --

console.log('\nthe reports, against a hand count');

const optionsOf = (report, q) => report.body.questions?.find((x) => x.questionId === String(q._id))?.options ?? [];
const counts = (report, q) => optionsOf(report, q).map((o) => [o.option, o.students, o.answers]);

{
  const r = await get(`/api/session/${code1}/misconceptions`);
  check('room 1: three students chose the option linked to TCP\'s misunderstanding, one SCTP\'s; the true/false has no label yet, so is not listed',
    r.status === 200 && same(r.body.questions?.map((q) => q.questionId), [String(QM._id)])
    && same(counts(r, QM), [['TCP', 3, 3], ['SCTP', 1, 1]]), JSON.stringify(r.body.questions));
  const tcp = optionsOf(r, QM)[0];
  check('in the report\'s own words', tcp?.sentence === `3 students chose the option linked to the misunderstanding "${LABEL.tcp}".` && tcp?.note === null,
    tcp?.sentence);
  check('the question\'s own figures: six answers from six students, none to another wording',
    same(['answers', 'students', 'otherWording'].map((k) => r.body.questions?.[0]?.[k]), [6, 6, 0]));
  check('the method and the privacy note come with it', /final answer/.test(r.body.method ?? '') && /never shown on a phone or the projector/.test(r.body.privacy ?? ''));
}

// The true/false's label is written after room 1's answers.
const tfLabel = await patch(labelsPath(QT), { misconceptions: [{ option: 0, label: LABEL.tf }] });
check('the owner labels the true/false\'s wrong answer, True, after the room has answered', tfLabel.status === 200
  && same(tfLabel.body.misconceptions?.map((l) => [l.optionIdx, l.option]), [[0, 'True']]), JSON.stringify(tfLabel.body));

{
  const r = await get(`/api/session/${code1}/misconceptions`);
  const tf = optionsOf(r, QT)[0];
  check('room 1 now lists it: three students chose True, and the label was added after these answers',
    same(counts(r, QT), [['True', 3, 3]]) && tf?.note === 'Label added after these answers.' && tf?.beforeLabel === 3, JSON.stringify(tf));
}

let classBefore;
{
  const r = await get(`/api/classes/${classId}/misconceptions`);
  classBefore = r;
  check('the class, over its three rooms: TCP\'s misunderstanding is three students in four answers (S01 chose it in two rooms), SCTP\'s two',
    r.status === 200 && same(counts(r, QM), [['TCP', 3, 4], ['SCTP', 2, 2]]) && same(r.body.rooms?.map((x) => x.code), [code1, code2, code3]),
    JSON.stringify(counts(r, QM)));
  check('the choose-all: three ticked Retransmission, two A handshake, both marked as AI drafts',
    same(counts(r, QX), [['Retransmission', 3, 3], ['A handshake', 2, 2]])
    && optionsOf(r, QX).every((o) => o.provenance === 'ai' && /AI draft label, not yet confirmed/.test(o.sentence)), JSON.stringify(optionsOf(r, QX)));
  check('the true/false: three, as in its room', same(counts(r, QT), [['True', 3, 3]]));
  // 8 answers to the Choose one (six in room 1, two in room 3), 6 to the true/false, 5 to the choose-all.
  check('its summary: three questions, nineteen answers, five labels, two AI drafts, the most-chosen first',
    same(r.body.counted, { questions: 3, labels: 5, aiDrafts: 2, answers: 19 })
    && same(r.body.top?.map((t) => [t.option, t.students]), [['True', 3], ['TCP', 3], ['Retransmission', 3], ['SCTP', 2], ['A handshake', 2]]),
    JSON.stringify({ counted: r.body.counted, top: r.body.top?.map((t) => [t.option, t.students]) }));
  const windowed = await get(`/api/classes/${classId}/misconceptions?rooms=${code3}`);
  check('narrowed to one room, as the attainment reports narrow: room 3 alone', windowed.status === 200
    && same(counts(windowed, QM), [['TCP', 1, 1], ['SCTP', 1, 1]]) && windowed.body.questions?.length === 1, JSON.stringify(counts(windowed, QM)));
  check('a room that is not the class\'s is a 400 that says so', (await get(`/api/classes/${classId}/misconceptions?rooms=ZZZZZZ`)).status === 400);
}

{
  const r = await get(labelsPath(QM));
  check('the question, across its chapter\'s rooms (a roll number once per room): TCP four, SCTP two',
    r.status === 200 && same(r.body.report?.questions?.[0]?.options?.map((o) => [o.option, o.students]), [['TCP', 4], ['SCTP', 2]])
    && r.body.rooms?.length === 3 && same(r.body.wrongOptions, [0, 2, 3]), JSON.stringify(r.body.report?.questions?.[0]?.options));
}

{
  const r = await get(`/api/session/${code1}/items`);
  const qm = r.body.items?.find((i) => i.questionId === String(QM._id));
  check('the room\'s item report shows each option\'s label beside its count, and none on the key',
    same(qm?.distribution?.rows?.[0]?.options?.map((o) => [o.text, o.count, o.misconception?.label ?? null, o.misconception?.provenance ?? null]),
      [['TCP', 3, LABEL.tcp, 'professor'], ['UDP', 1, null, null], ['SCTP', 1, LABEL.sctp, 'professor'], ['QUIC', 1, null, null]]),
    JSON.stringify(qm?.distribution?.rows?.[0]?.options));
}

console.log('\nwho may read the reports');

{
  const hodRoom = await get(`/api/session/${code1}/misconceptions`, 'hod');
  const hodClass = await get(`/api/classes/${classId}/misconceptions`, 'hod');
  check('an HOD of the department reads the room\'s and the class\'s', hodRoom.status === 200 && hodClass.status === 200
    && same(counts(hodClass, QM), counts(classBefore, QM)));
  const nowhereRoom = await get('/api/session/ZZZZZZ/misconceptions');
  const nowhereClass = await get('/api/classes/ffffffffffffffffffffffff/misconceptions');
  check('another professor, and an HOD of another department, get the same 404 as a room or class that does not exist, word for word',
    nowhereRoom.status === 404 && nowhereClass.status === 404
    && same((await get(`/api/session/${code1}/misconceptions`, 'profB')).body, nowhereRoom.body)
    && same((await get(`/api/session/${code1}/misconceptions`, 'hodOther')).body, nowhereRoom.body)
    && same((await get(`/api/classes/${classId}/misconceptions`, 'profB')).body, nowhereClass.body)
    && same((await get(`/api/classes/${classId}/misconceptions`, 'hodOther')).body, nowhereClass.body),
    JSON.stringify([nowhereRoom.body, nowhereClass.body]));
  check('no credentials: 401', (await get(`/api/session/${code1}/misconceptions`, null)).status === 401
    && (await get(`/api/classes/${classId}/misconceptions`, null)).status === 401);
}

// ------------------------------------------- a class question and the wall --

console.log('\na class question on the labelled question, and the projector');

const link = await post(`/api/session/${code1}/projector/links`, {});
const wall = await connect();
wall.onAny((event, payload) => wallLog.push({ event, payload }));
{
  const first = either(wall, ['projector:state']);
  wall.emit('projector:watch', { token: link.body.token });
  await first;
}
const onWall = await patch(`/api/session/${code1}/projector`, { question: { questionId: String(QM._id) } });
check('the professor puts the labelled question on the wall', onWall.status === 200 && onWall.body.shows?.question?.text === QM.text,
  JSON.stringify(onWall.body.shows ?? onWall.body));
const reached = ROSTER.slice(0, 3).map((r) => either(phones1[r].s, ['class:question']));
const cq = await post(`/api/session/${code1}/class-questions`, { questionId: String(QM._id) });
await Promise.all(reached);
check('and puts it to the class', cq.status === 201, JSON.stringify(cq.body));
await patch(`/api/session/${code1}/projector`, { question: { classQuestionId: cq.body.id } });
for (const [roll, choice] of [['S01', 'TCP'], ['S02', 'TCP'], ['S03', 'SCTP']]) {
  const ack = either(phones1[roll].s, ['class:vote']);
  phones1[roll].s.emit('student:vote', { classQuestionId: cq.body.id, round: 1, response: QM.options.indexOf(choice), answerId: `vote-${roll}` });
  await ack;
}
await post(`/api/session/${code1}/class-questions/${cq.body.id}/close`, { reveal: true });
{
  const r = await get(`/api/session/${code1}/misconceptions`);
  check('its three votes are kept as answers and never counted: TCP still three, SCTP one',
    same(counts(r, QM), [['TCP', 3, 3], ['SCTP', 1, 1]])
    && (await repo.listAnswers({ classQuestionId: cq.body.id })).length === 3, JSON.stringify(counts(r, QM)));
}

// ---------------------------------------------------------------- edits --

console.log('\nedits: the reports follow');

{
  const r = await patch(labelsPath(QM), { misconceptions: [{ option: 0, label: LABEL.tcp2 }] });
  const c = await get(`/api/classes/${classId}/misconceptions`);
  const tcp = optionsOf(c, QM)[0];
  check('the TCP label reworded: the class report shows the new words, the same counts, and says the label changed after the answers',
    r.status === 200 && same(r.body.changed, [{ optionIdx: 0, action: 'edited' }]) && tcp?.label === LABEL.tcp2
    && tcp?.students === 3 && tcp?.answers === 4 && tcp?.note === 'Label reworded after 4 of these answers.', JSON.stringify(tcp));
}

{
  const r = await patch(`/api/bank/question/${QM._id}`, { options: ['QUIC', 'SCTP', 'UDP', 'TCP'], answerIdx: 2 });
  const view = await get(labelsPath(QM));
  const c = await get(`/api/classes/${classId}/misconceptions`);
  check('the options reordered: each label follows its option, none is removed, and the question stays approved',
    r.status === 200 && !('misconceptionsRemoved' in r.body) && r.body.question?.status === 'active'
    && same(view.body.misconceptions?.map((l) => [l.optionIdx, l.option]), [[1, 'SCTP'], [3, 'TCP']]), JSON.stringify(view.body.misconceptions));
  check('and every earlier answer still lands on its option by its words: the same counts',
    same(counts(c, QM), [['SCTP', 2, 2], ['TCP', 3, 4]]) && optionsOf(c, QM).every((o) => o.optionIdx === (o.option === 'TCP' ? 3 : 1)),
    JSON.stringify(counts(c, QM)));
}

{
  const r = await patch(`/api/bank/question/${QM._id}`, { options: ['QUIC', 'SCTP (stream control)', 'UDP', 'TCP'] });
  const c = await get(`/api/classes/${classId}/misconceptions`);
  const qm = c.body.questions?.find((x) => x.questionId === String(QM._id));
  check('a labelled option reworded: its label is removed with the edit, and the reply names it in a sentence',
    r.status === 200 && same(r.body.misconceptionsRemoved, [{ option: 'SCTP', label: LABEL.sctp, provenance: 'professor' }])
    && /no longer applied and was removed/.test(r.body.misconceptionsNote ?? '') && !/misconceptions|PATCH|\/api/.test(r.body.misconceptionsNote ?? ''),
    JSON.stringify(r.body.misconceptionsRemoved));
  check('the class report keeps TCP\'s counts, drops SCTP, and says the eight answers were to an earlier wording',
    same(counts(c, QM), [['TCP', 3, 4]]) && qm?.otherWording === 8 && /earlier wording/.test(qm?.otherWordingNote ?? ''),
    JSON.stringify({ counts: counts(c, QM), other: qm?.otherWording }));
}

{
  // A Choose one that still holds a Choose all's keys from an earlier edit (an edit
  // keeps fields the new kind does not use), so a retag to Analyse lands as a valid
  // Choose all on which option A is a right answer.
  const [RQ] = await repo.insertQuestions([{
    contentId: content._id, topic: 'UDP', text: 'Which of these are transport-layer protocols?', kind: 'mcq',
    options: ['UDP', 'TCP', 'IP', 'ARP'], answerIdx: 1, answerIdxs: [0, 1], bloom: 'remember', source: 'teacher', status: 'active',
  }]);
  await patch(labelsPath(RQ), { misconceptions: [{ option: 0, label: 'Thinks UDP is not a transport protocol' }, { option: 2, label: 'Puts IP at the transport layer' }] });
  const r = await post('/api/bank/bulk', { ids: [String(RQ._id)], action: 'bloom', bloom: 'analyse' });
  check('a bulk retag that makes a labelled option a right answer removes that label, keeps the other, and says so',
    r.status === 200 && r.body.changed === 1 && same(r.body.misconceptionsRemoved?.map((x) => [x.id, x.labels.map((l) => l.option)]), [[String(RQ._id), ['UDP']]])
    && /^One misconception label no longer applied/.test(r.body.misconceptionsNote ?? '')
    && same((await stored(RQ)).map((l) => l.option), ['IP']) && (await repo.getQuestion(RQ._id)).kind === 'multi',
    JSON.stringify({ status: r.status, removed: r.body.misconceptionsRemoved, refused: r.body.refused }));
}

{
  const r = await patch(labelsPath(QX), { misconceptions: [{ option: 2, confirm: true }] });
  const c = await get(`/api/classes/${classId}/misconceptions`);
  check('an AI draft confirmed: the professor\'s now, one AI draft left, the counts unchanged',
    r.status === 200 && same(r.body.changed, [{ optionIdx: 2, action: 'confirmed' }])
    && same(optionsOf(c, QX).map((o) => [o.option, o.provenance, o.students]), [['Retransmission', 'professor', 3], ['A handshake', 'ai', 2]])
    && c.body.counted?.aiDrafts === 1, JSON.stringify(optionsOf(c, QX)));
}

{
  const r = await patch(labelsPath(QT), { misconceptions: [{ option: 0, label: null }] });
  const c = await get(`/api/classes/${classId}/misconceptions`);
  check('a label cleared: the true/false leaves the report', r.status === 200 && same(r.body.misconceptions, [])
    && !c.body.questions?.some((x) => x.questionId === String(QT._id)) && c.body.counted?.labels === 3, JSON.stringify(c.body.counted));
}

// --------------------------------------------------- never on a phone --

console.log('\nnever on a phone or the projector');

{
  const texts = [...Object.values(LABEL), 'Carries TCP\'s window field over to UDP', 'Takes the checksum for an address'];
  const leaks = (log) => log.filter(({ payload }) => {
    const s = JSON.stringify(payload ?? null);
    return /misconception/i.test(s) || texts.some((t) => s.includes(t));
  });
  check(`no event any phone received (${phoneLog.length}) carried a label or the word for one`, phoneLog.length > 20 && leaks(phoneLog).length === 0,
    JSON.stringify(leaks(phoneLog).slice(0, 2)));
  check(`no event the projector received (${wallLog.length}) did either`, wallLog.length > 1 && leaks(wallLog).length === 0,
    JSON.stringify(leaks(wallLog).slice(0, 2)));
  const rows = await repo.listAnswers({});
  check(`no stored answer's snapshot (${rows.length}) holds a label`, rows.length > 20
    && rows.every((a) => !('misconceptions' in (a.questionSnapshot ?? {}))));
  const asked = await repo.listClassQuestions(room1.body.sessionId);
  check('nor the class question\'s', asked.length === 1 && !('misconceptions' in (asked[0].questionSnapshot ?? {})));
  const phoneRoom = await get(`/api/session/${code1}`, null);
  check('the room as a phone reads it carries none', phoneRoom.status === 200 && !/misconception/i.test(JSON.stringify(phoneRoom.body)));
}

check('nothing was sent off this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

for (const p of Object.values(phones1)) p.s.close();
wall.close();
io.close();
server.close();
await closeStore();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
