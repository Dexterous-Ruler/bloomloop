// The owner's decisions of 19 Nov 2026, end to end.
//
//   node server/scripts/decisions.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with real phones over Socket.io, and
// checks what the decisions changed (docs/PRODUCT_DECISIONS.md):
//
//   phone row     (a) the phone's own row, result and question carry no staff
//                 field and no sentence naming a band; the teacher's are as before
//   identity      (7) a typed roll number exposes nothing of a student's own
//                 history, an old-style link included; the signed-in student's
//                 token at join does, and only for the answers that phone sent
//   under 18      (8) the mark is set by the owner and read from a CSV column;
//                 no integrity signal is recorded or shown for such a student,
//                 not even one recorded before the mark
//   teacher       a professor's own question is stored, and answered, as 'teacher'
//   regenerate    the old question keeps serving until the replacement is
//                 approved; every way of approving retires it; a reject keeps it
//   classes       the class list carries canCreate; projector:state carries how
//                 the room runs; people-facing sentences name no API detail
//   boot probe    names the migration to apply when a column is missing
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. So,
// as server/scripts/roster.mjs does, the server is pointed at
// http://supabase.invalid and every request to it is answered here, in-process;
// any other request off this machine is refused outright. Everything else runs
// on the in-process store. Never calls Gemini, Supabase or any network service.
// Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { SAMPLE } = await import(`${SRC}sampleContent.js`);

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
// HOD (CSE) <- professor A <- Asha (21CS01), Bilal (21CS02); professor B under
// another HOD <- Omar, who also holds roll number 21CS01 in his department.

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'd0000000-0000-4000-8000-000000000001',
  profA: 'd0000000-0000-4000-8000-000000000002',
  profB: 'd0000000-0000-4000-8000-000000000003',
  hodOther: 'd0000000-0000-4000-8000-000000000004',
  asha: 'd0000000-0000-4000-8000-000000000005',
  bilal: 'd0000000-0000-4000-8000-000000000006',
  omar: 'd0000000-0000-4000-8000-000000000007',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-TEST1${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
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
const TOKENS = { hod: 'tok-hod', profA: 'tok-prof-a', profB: 'tok-prof-b', asha: 'tok-asha', bilal: 'tok-bilal', omar: 'tok-omar' };
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
    throw new Error(`decisions.mjs refuses to reach ${url.origin}`);
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
    const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
    return reply(ACCOUNTS.has(id) ? [ACCOUNTS.get(id)] : []);
  }
  if (url.pathname === '/rest/v1/rpc/accounts_below') {
    return reply(below(JSON.parse(init.body ?? '{}').root));
  }
  return reply({ message: `not answered by decisions.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'decisions-test-service-key';

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
async function call(method, path, { body, as = 'profA', type } = {}) {
  const headers = {};
  if (as === 'key') headers['x-teacher-key'] = config.teacherKey;
  else if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = type ?? 'application/json';
  const res = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  return { status: res.status, body: parsed };
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

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

const phones = [];
/**
 * A phone joins; resolves with the socket, its accepted payload and the first
 * question (or exhausted). Every payload the phone receives is kept in `heard`.
 */
async function join(code, rollNo, { name = '', token } = {}) {
  const s = await connect();
  phones.push(s);
  const heard = [];
  s.onAny((event, payload) => heard.push({ event, payload }));
  const accepted = either(s, ['session:accepted', 'session:rejected', 'session:teacher-led']);
  const first = either(s, ['server:question', 'server:exhausted', 'server:waiting']);
  s.emit('student:join', { code, rollNo, name, ...(token ? { token } : {}) });
  const a = await accepted;
  return { s, heard, accepted: a.payload, first: a.name === 'session:accepted' ? (await first) : null };
}

/** Answer the question on the phone: right, wrong, or a set response; resolves with the result. */
async function answer(phone, question, { right = true, key }) {
  const q = await repo.getQuestion(question._id);
  const response = right ? q.answerIdx : (q.answerIdx + 1) % 4;
  const result = either(phone.s, ['server:result', 'session:rejected']);
  phone.s.emit('student:answer', { questionId: question._id, response, answerId: key });
  return (await result).payload;
}

/** Ask for the next question. */
async function nextQuestion(phone) {
  const got = either(phone.s, ['server:question', 'server:exhausted']);
  phone.s.emit('student:next', {});
  return got;
}

/** A chapter of professor A's with active mcqs at Understand and Remember. */
async function chapter(title, n = 10) {
  const content = await repo.createContent({ title, kind: 'syllabus', rawText: '', topics: ['Layers'], ownerId: ID.profA });
  await repo.insertQuestions(Array.from({ length: n }, (_, i) => ({
    contentId: content._id, topic: 'Layers', text: `${title}: which layer is ${i}?`, kind: 'mcq',
    options: ['Network', 'Transport', 'Link', 'Physical'], answerIdx: 1, bloom: i % 2 ? 'remember' : 'understand',
    source: 'llm', status: 'active',
  })));
  return content;
}

// Words no phone may be shown about its own place (decision (a)). Not "support"
// alone: the phone is told its own accommodations, under `supports`.
const LABELS = /band|below-40|40%|slow ?learner|needs support|integrity|Left the page|faster than|two connections/i;
// masteryBasis since Phase 5 (honest indicators): band-free, percentage-free.
const PHONE_KEYS = '["answered","counted","levels","mastered","masteryBasis","masteryGoal","name","next","online","rollNo","total","withdrawn","workingLevel"]';
const keysOf = (o) => JSON.stringify(Object.keys(o ?? {}).sort());

// ---------------------------------------------------- (a) the phone's row --

console.log('\n(a) what a phone is told about itself');
{
  const content = await chapter('Phone row');
  const opened = await post('/api/session', { contentId: content._id });
  const code = opened.body.code;
  const teacher = await connect();
  const grids = collect(teacher, 'teacher:grid');
  teacher.emit('teacher:watch', { code, token: TOKENS.profA });
  await grids.until(() => true);

  const p = await join(code, 'P1', { name: 'Pia' });
  check('session:accepted carries the student subset of the row, with `next`',
    keysOf(p.accepted.profile) === PHONE_KEYS && typeof p.accepted.profile.next?.why === 'string', keysOf(p.accepted.profile));
  check('and the first question\'s reason is the phone\'s own sentence', p.first.payload?.reason === 'This question is at Understand, the level you are working at.',
    p.first.payload?.reason);
  // Four wrong: inside the below-40% band.
  let q = p.first.payload.question;
  let result = null;
  for (let i = 0; i < 4; i += 1) {
    result = await answer(p, q, { right: false, key: `phone-row-${i}-000` });
    const nx = await nextQuestion(p);
    if (nx.name !== 'server:question') break;
    q = nx.payload.question;
  }
  check('every result\'s row is the student subset', keysOf(result?.profile) === PHONE_KEYS, keysOf(result?.profile));
  check('inside the band, the phone is told the next levels without the band',
    JSON.stringify(result?.profile?.next?.levels) === '["remember","understand"]' && /to build a firm base/.test(result?.reason ?? ''),
    result?.reason);
  const said = JSON.stringify(p.heard.filter((h) => h.event !== 'server:question').map((h) => h.payload))
    + JSON.stringify(p.heard.filter((h) => h.event === 'server:question').map((h) => h.payload.reason));
  check('nothing the phone heard names a band or carries slowLearner, the signals or the professor\'s reason',
    !LABELS.test(said) && !/"slowLearner"|"integrity"/.test(said), said.match(LABELS)?.[0] ?? '');
  const g = await grids.until((x) => x.rows?.some((r) => r.rollNo === 'P1' && r.slowLearner === true));
  const row = g.rows.find((r) => r.rollNo === 'P1');
  check('the teacher\'s row is unchanged: slowLearner, the signals and the band\'s sentence are all there',
    row.slowLearner === true && /below-40% band/.test(row.reason) && 'integrity' in row && !('next' in row), JSON.stringify(row).slice(0, 160));
  teacher.disconnect();

  const capped = await post('/api/session', { contentId: content._id, questionsPerStudent: 1 });
  const c = await join(capped.body.code, 'P2');
  await answer(c, c.first.payload.question, { key: 'phone-row-cap-0001' });
  const done = await nextQuestion(c);
  check('server:exhausted carries the student subset too', done.name === 'server:exhausted' && keysOf(done.payload.profile) === PHONE_KEYS,
    keysOf(done.payload?.profile));
}

// ------------------------------------------------------- 7, the identity --

console.log('\n7: a typed roll number exposes nothing of a student\'s history; a sign-in does');
{
  const content = await chapter('Identity');
  const r1 = await post('/api/session', { contentId: content._id });
  const r2 = await post('/api/session', { contentId: content._id });
  const mine = () => get(`/api/analytics/${ID.asha}/answers`, 'asha');
  const professorSees = () => get(`/api/analytics/${ID.asha}/answers?limit=200`, 'profA');

  const typed = await join(r1.body.code, '21CS01', { name: 'Asha' });
  check('a phone with a typed roll number joins as always, unlinked', typed.accepted.linked === false && !typed.accepted.linkNote
    && Boolean(typed.first?.payload?.question));
  await answer(typed, typed.first.payload.question, { key: 'typed-0000001' });
  let q = (await nextQuestion(typed)).payload.question;
  await answer(typed, q, { key: 'typed-0000002' });
  {
    const prof = await repo.getProfile(r1.body.sessionId, '21CS01');
    const rows = await repo.listAnswers({ sessionId: r1.body.sessionId });
    check('its profile and its answers are linked to nobody', prof.accountId === null && prof.accountVerified === false
      && rows.every((a) => a.accountId === null && a.accountVerified === false));
  }
  let read = await mine();
  check('the student reads none of those answers in their own history', read.status === 200 && read.body.items?.length === 0,
    `HTTP ${read.status} ${read.body.items?.length}`);
  const dash = await get('/api/dashboard', 'asha');
  check('nor in their dashboard, which says why, and carries no band',
    dash.status === 200 && dash.body.sessions?.length === 0 && /signed in/.test(dash.body.note ?? '') && !('banded' in dash.body),
    JSON.stringify(dash.body).slice(0, 200));
  const ana = await get(`/api/analytics/${ID.asha}`, 'asha');
  check('nor in their analytics', ana.status === 200 && ana.body.timeline?.length === 0 && ana.body.topicLevels?.counted?.answers === 0
    && /signed in/.test(ana.body.note ?? ''));
  check('the professor still reads them, by the roll number', (await professorSees()).body.items?.length === 2);

  // A link made the old way, from the roll number alone, before 0022: kept, unverified.
  {
    const old = await post('/api/session', { contentId: content._id });
    const { _id, ...prof } = await repo.getProfile(r1.body.sessionId, '21CS01');
    await repo.saveProfile({ ...prof, sessionId: old.body.sessionId, accountId: ID.asha });
    await repo.recordAnswer({
      sessionId: old.body.sessionId, answerKey: 'old-link-0001', rollNo: '21CS01', accountId: ID.asha, bloom: 'understand',
      kind: 'mcq', final: true, correct: true, score: 1, questionId: q._id, topic: 'Layers',
    });
    read = await mine();
    check('an old-style link from a typed roll number, kept on the rows, exposes nothing either',
      read.body.items?.length === 0 && (await get('/api/dashboard', 'asha')).body.sessions?.length === 0);
    check('and is kept, marked unverified, for the professor', (await repo.getProfile(old.body.sessionId, '21CS01')).accountVerified === false
      && (await professorSees()).body.items?.some((i) => i.answerId && i.student?.accountId === ID.asha));
  }

  const signed = await join(r2.body.code, '21CS01', { name: 'Asha', token: TOKENS.asha });
  check('the signed-in student\'s token at join links the room, verified', signed.accepted.linked === true && !signed.accepted.linkNote);
  {
    const prof = await repo.getProfile(r2.body.sessionId, '21CS01');
    check('the profile is linked to her account and marked verified', prof.accountId === ID.asha && prof.accountVerified === true);
  }
  await answer(signed, signed.first.payload.question, { key: 'signed-000001' });
  q = (await nextQuestion(signed)).payload.question;
  await answer(signed, q, { key: 'signed-000002', right: false });
  read = await mine();
  check('now her own history holds exactly the answers that phone sent', read.body.items?.length === 2
    && read.body.items.every((i) => i.room?.code === r2.body.code && !('snapshot' in i)), JSON.stringify(read.body.items?.map((i) => i.room?.code)));
  // A classmate typing her roll number into the same, verified, room.
  const classmate = await join(r2.body.code, '21CS01', { name: 'not Asha' });
  check('a classmate typing her roll number into that room joins unlinked, and does not unlink it',
    classmate.accepted.linked === false && (await repo.getProfile(r2.body.sessionId, '21CS01')).accountVerified === true);
  const cq = classmate.first?.payload?.question ?? (await nextQuestion(classmate)).payload.question;
  await answer(classmate, cq, { key: 'classmate-0001' });
  const rows = await repo.listAnswers({ sessionId: r2.body.sessionId });
  check('the classmate\'s answer is stored, under her account, unverified', rows.length === 3
    && rows.find((a) => a.answerKey === 'classmate-0001')?.accountVerified === false
    && rows.filter((a) => a.accountVerified === true).length === 2);
  read = await mine();
  check('and never reaches her history', read.body.items?.length === 2);
  const dash2 = await get('/api/dashboard', 'asha');
  check('her dashboard has the signed-in room, and no band anywhere in it',
    dash2.body.sessions?.length === 1 && dash2.body.sessions[0].code === r2.body.code
    && !JSON.stringify(dash2.body).includes('banded'), JSON.stringify(dash2.body.sessions?.map((s) => s.code)));
  const ana2 = await get(`/api/analytics/${ID.asha}`, 'asha');
  check('her analytics too, counting only her verified answers', ana2.body.timeline?.length === 1 && ana2.body.topicLevels?.counted?.answers === 2
    && !JSON.stringify(ana2.body.timeline).includes('banded'), JSON.stringify(ana2.body.topicLevels?.counted));
  const profView = await get(`/api/analytics/${ID.asha}`, 'profA');
  check('the professor\'s view of her still carries the band flag', profView.body.timeline?.every((t) => 'banded' in t));

  // The residual of decision 7: inside the room she signed in to, the profile
  // also holds the classmate's answer. What she reads of herself must not.
  const seen = (report) => (report ?? []).reduce((n, b) => n + b.seen, 0);
  const s2 = dash2.body.sessions?.[0];
  check('her dashboard counts only her own two answers: the room, its trail, the totals and the level tally',
    s2?.answered === 2 && s2.history?.length === 2 && s2.history.every((h) => ['signed-000001', 'signed-000002'].includes(h.answerId))
    && dash2.body.counts?.answered === 2 && dash2.body.counts.correct === 1 && seen(dash2.body.bloom) === 2,
    JSON.stringify({ answered: s2?.answered, trail: s2?.history?.map((h) => h.answerId), counts: dash2.body.counts }));
  check('and the room\'s level, which the classmate\'s answer helped set, is not shown as hers',
    s2?.workingLevel === null && dash2.body.workingLevel === null, JSON.stringify([s2?.workingLevel, dash2.body.workingLevel]));
  const t2 = ana2.body.timeline?.[0];
  check('her analytics: the timeline, the counts, the level tally and the current level, the same way',
    t2?.answered === 2 && t2.correct === 1 && t2.workingLevel === null && ana2.body.counts?.answered === 2
    && seen(ana2.body.bloom) === 2 && ana2.body.currentLevel === null, JSON.stringify({ t2, counts: ana2.body.counts }));
  check('the professor still reads the whole room under her roll number, all three answers',
    profView.body.timeline?.find((t) => t.code === r2.body.code)?.answered === 3);

  // A guest typed her roll number into a room before she first signed in to it.
  const r4 = await post('/api/session', { contentId: content._id });
  const guest = await join(r4.body.code, '21CS01', { name: 'a guest' });
  await answer(guest, guest.first.payload.question, { key: 'guest-first-0001' });
  await answer(guest, (await nextQuestion(guest)).payload.question, { key: 'guest-first-0002', right: false });
  guest.s.disconnect();
  await settle();
  const later = await join(r4.body.code, '21CS01', { name: 'Asha', token: TOKENS.asha });
  check('she then joins that room signed in, and it is linked to her, verified', later.accepted.linked === true
    && (await repo.getProfile(r4.body.sessionId, '21CS01')).accountVerified === true);
  const dash3 = await get('/api/dashboard', 'asha');
  const s4 = dash3.body.sessions?.find((s) => s.code === r4.body.code);
  check('the guest\'s answers there are not hers: the room shows none of them, and no level',
    s4?.answered === 0 && s4.history?.length === 0 && s4.workingLevel === null && dash3.body.counts?.answered === 2,
    JSON.stringify({ s4, counts: dash3.body.counts }));
  const ana3 = await get(`/api/analytics/${ID.asha}`, 'asha');
  check('nor in her analytics', ana3.body.timeline?.find((t) => t.code === r4.body.code)?.answered === 0
    && ana3.body.counts?.answered === 2 && ana3.body.topicLevels?.counted?.answers === 2, JSON.stringify(ana3.body.counts));
  later.s.disconnect();

  // Sign-ins that do not qualify: told so in one sentence, and let in as guests.
  for (const [label, token, roll] of [
    ['another student\'s sign-in for this roll number', TOKENS.bilal, '21CS01'],
    ['a student of another professor with the same roll number', TOKENS.omar, '21CS01'],
    ['a professor\'s sign-in', TOKENS.profA, '21CS01'],
    ['an expired sign-in', 'tok-expired', '21CS01'],
  ]) {
    const room = await post('/api/session', { contentId: content._id });
    const ph = await join(room.body.code, roll, { token });
    const prof = await repo.getProfile(room.body.sessionId, roll);
    check(`${label}: not linked, told why, still served`, ph.accepted.linked === false && /not linked to your account/.test(ph.accepted.linkNote ?? '')
      && Boolean(ph.first?.payload?.question) && prof.accountId === null && prof.accountVerified === false,
    `${ph.accepted.linked} ${ph.accepted.linkNote}`);
  }
}

// ------------------------------------------------------ 8, under 18 ------

console.log('\n8: the under-18 mark');
let classId;
{
  const made = await post('/api/classes', { courseName: 'Biology', section: 'FY-A' });
  classId = made.body.class?.id;
  const added = await post(`/api/classes/${classId}/students`, {
    students: [{ roll: 'M01', name: 'Meera', under18: true }, { roll: 'N01', name: 'Nikhil' }, { roll: 'X01', name: 'Xavi', under18: 'maybe' }],
  });
  check('a list may carry the mark; anything but yes or no refuses the row', added.status === 200
    && JSON.stringify(added.body.added?.map((s) => [s.rollNo, s.under18])) === '[["M01",true],["N01",false]]'
    && added.body.refused?.[0]?.code === undefined && /yes or no/.test(added.body.refused?.[0]?.reason ?? '')
    && /a lawyer must confirm/.test(added.body.under18Note ?? ''), JSON.stringify(added.body.refused));
  const csv = 'Roll No,Name,Under 18,Date of birth\nM02,Mira,yes,2009-03-01\nN02,Neel,,2004-01-01\nN01,Nikhil,yes,\n';
  const dry = await call('POST', `/api/classes/${classId}/students/import?dryRun=true`, { body: csv, type: 'text/csv' });
  check('the import reads an under-18 column and never the date of birth',
    dry.status === 200 && dry.body.read?.columns?.under18 === 'Under 18' && JSON.stringify(dry.body.ignoredColumns) === '["Date of birth"]'
    && JSON.stringify(dry.body.wouldAdd?.map((r) => [r.rollNo, r.under18])) === '[["M02",true],["N02",false]]', JSON.stringify(dry.body.wouldAdd));
  check('and says a student already on the roster keeps their mark: an import only adds',
    /An import does not change a student already on it/.test(dry.body.under18 ?? '') && /a lawyer must confirm/.test(dry.body.under18Note ?? ''));
  const done = await call('POST', `/api/classes/${classId}/students/import`, { body: csv, type: 'text/csv' });
  check('importing adds them with the mark', done.status === 200 && done.body.added?.find((s) => s.rollNo === 'M02')?.under18 === true
    && !JSON.stringify(await repo.listClassStudents(classId)).includes('2009'));

  const ownerRead = await get(`/api/classes/${classId}`);
  const roster = ownerRead.body.students;
  const idOf = (roll) => roster.find((s) => s.rollNo === roll)?.id;
  // Phase 5 follow-up: the class's read carries the sentence whenever a student
  // on it is marked, so a screen opened fresh, or an HOD's, says it too.
  const hodRead = await get(`/api/classes/${classId}`, 'hod');
  const plain = await post('/api/classes', { courseName: 'Chemistry', section: 'FY-B' });
  await post(`/api/classes/${plain.body.class?.id}/students`, { students: [{ roll: 'C01', name: 'Chetan' }] });
  const plainRead = await get(`/api/classes/${plain.body.class?.id}`);
  check('the class read carries the under-18 sentence when a student on it is marked, for the owner and the HOD alike, and not otherwise',
    /a lawyer must confirm/.test(ownerRead.body.under18Note ?? '') && hodRead.status === 200 && hodRead.body.under18Note === ownerRead.body.under18Note
    && plainRead.status === 200 && plainRead.body.students?.length === 1 && !('under18Note' in plainRead.body),
    JSON.stringify([ownerRead.body.under18Note, hodRead.status, hodRead.body.under18Note, plainRead.body.under18Note]));
  const hod = await patch(`/api/classes/${classId}/students/${idOf('N02')}`, { under18: true }, 'hod');
  const other = await patch(`/api/classes/${classId}/students/${idOf('N02')}`, { under18: true }, 'profB');
  const bad = await patch(`/api/classes/${classId}/students/${idOf('N02')}`, { under18: 'yes' });
  check('only the owner sets it: an HOD gets 403, another professor the class\'s 404, a non-boolean 400',
    hod.status === 403 && other.status === 404 && bad.status === 400, `${hod.status} ${other.status} ${bad.status}`);

  const content = await chapter('Minors');
  const opened = await post('/api/session', { contentId: content._id, classId });
  const code = opened.body.code;
  const sessionId = opened.body.sessionId;
  const teacher = await connect();
  const grids = collect(teacher, 'teacher:grid');
  teacher.emit('teacher:watch', { code, token: TOKENS.profA });
  await grids.until(() => true);

  // Each of the two: three times away from the page, a paste, an answer faster
  // than it could be read, and a second phone on the same roll number.
  async function noisy(roll) {
    const ph = await join(code, roll);
    for (let i = 0; i < 3; i += 1) ph.s.emit('student:signal', { kind: 'hidden', awayMs: 4000 });
    ph.s.emit('student:signal', { kind: 'paste' });
    await settle(200);
    await answer(ph, ph.first.payload.question, { key: `noisy-${roll}-0001` });
    await join(code, roll);
    await settle(200);
    return ph;
  }
  await noisy('M01');
  await noisy('N01');
  const minor = await repo.getProfile(sessionId, 'M01');
  const adult = await repo.getProfile(sessionId, 'N01');
  check('nothing is recorded for the student marked under 18', minor.integrity.length === 0, JSON.stringify(minor.integrity));
  check('everything is, as before, for the student who is not',
    ['hidden', 'paste', 'too-fast', 'second-socket'].every((k) => adult.integrity.some((e) => e.kind === k)),
    adult.integrity.map((e) => e.kind).join(','));
  const g = await grids.until((x) => x.rows?.length === 2 && x.rows.find((r) => r.rollNo === 'N01')?.integrity?.events > 0);
  check('the live grid shows no signal for them, and the other student\'s as before',
    g.rows.find((r) => r.rollNo === 'M01')?.integrity === null && g.rows.find((r) => r.rollNo === 'N01')?.integrity?.level === 'watch');
  const trail = await get(`/api/session/${code}/integrity/M01`);
  check('their signal trail is empty and says why', trail.status === 200 && trail.body.signalsOff === true && trail.body.events?.length === 0
    && trail.body.summary === null);
  const exported = await call('GET', `/api/session/${code}/export`, { as: 'profA' });
  const lineOf = (roll) => (exported.body.text ?? '').split('\r\n').find((l) => l.startsWith(roll)) ?? '';
  check('the room\'s CSV carries no signal for them', !/Left the page|Pasted/.test(lineOf('M01')) && /Left the page 3 times/.test(lineOf('N01')),
    lineOf('M01'));

  // Marked under 18 after signals were recorded: shown nowhere from then on.
  const marked = await patch(`/api/classes/${classId}/students/${idOf('N01')}`, { under18: true });
  check('the owner marks the other student under 18', marked.status === 200 && marked.body.student?.under18 === true);
  const rest = await get(`/api/session/${code}/grid`);
  const trail2 = await get(`/api/session/${code}/integrity/N01`);
  check('their signals already recorded are shown nowhere: not on the grid, not in the trail',
    rest.body.rows?.find((r) => r.rollNo === 'N01')?.integrity === null && trail2.body.signalsOff === true && trail2.body.events?.length === 0);
  const second = phones.at(-1); // N01's second phone, still in the room
  const before = (await repo.getProfile(sessionId, 'N01')).integrity.length;
  second.emit('student:signal', { kind: 'hidden', awayMs: 1000 });
  await settle(200);
  check('and nothing more is recorded for them', (await repo.getProfile(sessionId, 'N01')).integrity.length === before);
  teacher.disconnect();

  // A room deleted while a student was not yet marked: its archive was written
  // with their signals. Marked afterwards, the archive is served without them.
  {
    const room = await post('/api/session', { contentId: content._id, classId });
    const ph = await join(room.body.code, 'N02');
    for (let i = 0; i < 3; i += 1) ph.s.emit('student:signal', { kind: 'hidden', awayMs: 4000 });
    await settle(200);
    check('a student not marked under 18: their signals are recorded', (await repo.getProfile(room.body.sessionId, 'N02')).integrity.length === 3);
    ph.s.disconnect();
    await settle();
    const gone = await del(`/api/session/${room.body.code}?confirm=${room.body.code}`);
    const signalsIn = async () => {
      const served = await get(`/api/session/archives/${gone.body.archive?.id}`);
      const t = served.body.students ?? { cols: [], rows: [] };
      return t.rows.find((r) => r[t.cols.indexOf('rollNo')] === 'N02')?.[t.cols.indexOf('integrity')] ?? null;
    };
    check('the deleted room\'s archive keeps them while the student is not marked', gone.status === 200 && (await signalsIn())?.length === 3);
    const marked2 = await patch(`/api/classes/${classId}/students/${idOf('N02')}`, { under18: true });
    const after = await signalsIn();
    check('marked under 18 afterwards: the archive is served with none of their signals', marked2.status === 200
      && Array.isArray(after) && after.length === 0, JSON.stringify(after));
    const stored = await repo.getRoomArchive(gone.body.archive?.id);
    check('the stored archive itself is not rewritten: the mark is applied as it is served',
      JSON.stringify(stored?.data?.students).includes('"hidden"'));
  }
}

// -------------------------------------------- a professor's own question --

console.log('\na professor\'s own question is the professor\'s');
{
  const content = await chapter('Own');
  const own = await post(`/api/bank/${content._id}/questions`, {
    topic: 'Layers', text: 'Which layer routes packets between networks?', bloom: 'remember', kind: 'mcq',
    options: ['Network.', 'Link.', 'Physical.', 'Session.'], answerIdx: 0,
  });
  check('it is stored with source teacher', own.status === 201 && own.body.question?.source === 'teacher', `${own.status} ${own.body.error ?? ''}`);
  const room = await post('/api/session', { contentId: content._id, questionIds: [own.body.question._id] });
  const ph = await join(room.body.code, 'T1');
  check('a room serves it', ph.first?.payload?.question?._id === own.body.question._id);
  await answer(ph, ph.first.payload.question, { key: 'own-question-01' });
  const [row] = await repo.listAnswers({ sessionId: room.body.sessionId });
  check('and the answer row says who wrote the question: teacher', row?.questionSource === 'teacher', row?.questionSource);
}

// ------------------------------------------------- regenerate keeps serving --

console.log('\nregenerating an active question keeps it serving until the replacement is approved');
{
  const made = await post('/api/content', { title: 'Regenerate', text: SAMPLE.rawText });
  const contentId = made.body.contentId;
  await post('/api/generate', { contentId, topics: SAMPLE.topics.slice(0, 2), plan: { perTopic: 12 } });
  await post(`/api/bank/${contentId}/approve-all`);
  const room = await post('/api/session', { contentId });
  const servable = async () => (await get(`/api/session/${room.body.code}`, null)).body.bankCount;
  const n = await servable();
  const active = (await get(`/api/bank/${contentId}`)).body.questions.filter((q) => q.status === 'active');
  // One question at each of four levels, so the offline generator is never
  // asked twice for the same topic and level.
  const at = (level) => active.find((q) => q.bloom === level);
  const [x, y, z, w] = [at('apply'), at('analyse'), at('understand'), at('remember')];

  const rx = await post(`/api/bank/question/${x._id}/regenerate`);
  check('a regenerate of an active question writes a draft naming it, and says the old one stays in rooms',
    rx.status === 200 && rx.body.question?.status === 'draft' && rx.body.question?.replacesId === String(x._id)
    && /stays in rooms until you approve its replacement/.test(rx.body.note ?? ''), `${rx.status} ${rx.body.error ?? ''}`);
  check('the old question is still active, and the room still serves as many', (await repo.getQuestion(x._id)).status === 'active'
    && (await servable()) === n, `${await servable()} of ${n}`);
  const ph = await join(room.body.code, 'R1');
  check('a phone joining now is told the same bank size', ph.accepted.bankCount === n);
  const ok = await post(`/api/bank/question/${rx.body.question._id}/approve`);
  check('approving the replacement retires the old one, and says so', ok.status === 200 && ok.body.retired === String(x._id)
    && (await repo.getQuestion(x._id)).status === 'discarded' && (await servable()) === n);

  const ry = await post(`/api/bank/question/${y._id}/regenerate`);
  await post(`/api/bank/question/${ry.body.question._id}/reject`);
  check('rejecting the replacement leaves the old one serving', (await repo.getQuestion(y._id)).status === 'active');

  const rz = await post(`/api/bank/question/${z._id}/regenerate`);
  const all = await post(`/api/bank/${contentId}/approve-all`);
  check('approve-all retires what its drafts replace', all.status === 200 && all.body.retired?.includes(String(z._id))
    && (await repo.getQuestion(z._id)).status === 'discarded' && (await repo.getQuestion(rz.body.question._id)).status === 'active');

  const rw = await post(`/api/bank/question/${w._id}/regenerate`);
  const restored = await patch(`/api/bank/question/${rw.body.question._id}`, { status: 'active' });
  check('so does the older restore, which approves', restored.body.retired === String(w._id)
    && (await repo.getQuestion(w._id)).status === 'discarded');

  const draft = (await post(`/api/bank/question/${y._id}/regenerate`, { direction: 'harder' })).body.question;
  const rd = await post(`/api/bank/question/${draft._id}/regenerate`);
  check('a draft being replaced served nothing, so it is discarded at once, as before, with no link',
    (await repo.getQuestion(draft._id)).status === 'discarded' && rd.body.question?.replacesId === null && !rd.body.replaces);

  // A replacement regenerated again, and a rejected one regenerated: the link
  // passes to the new draft, so the active question is still retired at approval.
  const v = active.find((q) => q.bloom === 'evaluate' && q.topic !== y.topic) ?? active.find((q) => q.bloom === 'create');
  const d1 = (await post(`/api/bank/question/${v._id}/regenerate`)).body.question;
  const d2 = await post(`/api/bank/question/${d1._id}/regenerate`);
  check('regenerating a replacement draft passes its link on: the new draft names the active question, the first is discarded',
    d2.status === 200 && d2.body.question?.replacesId === String(v._id) && d2.body.replaces === String(v._id)
    && (await repo.getQuestion(d1._id)).status === 'discarded' && (await repo.getQuestion(v._id)).status === 'active',
    `${d2.status} ${d2.body.error ?? ''} ${d2.body.question?.replacesId}`);
  await post(`/api/bank/question/${d2.body.question._id}/reject`);
  const d3 = await post(`/api/bank/question/${d2.body.question._id}/regenerate`);
  check('so does regenerating one the professor rejected', d3.status === 200 && d3.body.question?.replacesId === String(v._id)
    && (await repo.getQuestion(v._id)).status === 'active', `${d3.status} ${d3.body.error ?? ''}`);
  const ok3 = await post(`/api/bank/question/${d3.body.question._id}/approve`);
  check('approving the last one retires the active question, so the two never both serve',
    ok3.status === 200 && ok3.body.retired === String(v._id) && (await repo.getQuestion(v._id)).status === 'discarded'
    && (await repo.getQuestion(d3.body.question._id)).status === 'active');
}

// ----------------------------------------- the class list, the projector --

console.log('\nthe class list says who may create; the projector is told how the room runs');
{
  const prof = await get('/api/classes');
  const hod = await get('/api/classes', 'hod');
  const key = await get('/api/classes', 'key');
  check('canCreate: a professor yes, an HOD no, the shared key yes', prof.body.canCreate === true && hod.body.canCreate === false
    && key.body.canCreate === true, `${prof.body.canCreate} ${hod.body.canCreate} ${key.body.canCreate}`);

  const content = await chapter('Wall');
  for (const [mode, extra] of [['teacher-led', { classId }], ['devices', {}]]) {
    const room = await post('/api/session', { contentId: content._id, mode, ...extra });
    const link = await post(`/api/session/${room.body.code}/projector/links`, {});
    const p = await connect();
    phones.push(p);
    const got = either(p, ['projector:state', 'projector:refused']);
    p.emit('projector:watch', { token: link.body.token });
    const state = await got;
    check(`a ${mode} room's projector:state carries roomMode ${mode}`, state.name === 'projector:state' && state.payload?.roomMode === mode
      && state.payload?.mode === 'question', JSON.stringify(state.payload).slice(0, 160));
  }
}

// ---------------------------------------- sentences that name no API detail --

console.log('\npeople-facing sentences name no path, field or verb');
{
  const API = /\/api\/|PATCH|PUT |GET |POST |teacherRecords|\{ ?"/;
  const made = await post('/api/classes', { courseName: 'Words', section: 'W' });
  const id = made.body.class?.id;
  const add = await post(`/api/classes/${id}/students`, { students: [{ roll: 'W1', name: 'Wren' }] });
  const removed = await del(`/api/classes/${id}/students/${add.body.added[0].id}`);
  check('removing a student', removed.status === 200 && !API.test(removed.body.message) && /put back on the roster/.test(removed.body.message),
    removed.body.message);
  const imp = await call('POST', `/api/classes/${id}/students/import?dryRun=true`, { body: 'roll,name\nW1,Wren\n', type: 'text/csv' });
  check('the import\'s restore sentence', /not restored by an import/.test(imp.body.restore ?? '') && !API.test(imp.body.restore), imp.body.restore);
  const presets = await get('/api/attainment/presets');
  check('the presets\' note', presets.status === 200 && !API.test(presets.body.note) && /examples to start from/.test(presets.body.note),
    presets.body.note);
  const content = await chapter('Led');
  const led = await post('/api/session', { contentId: content._id, mode: 'teacher-led', classId });
  const insights = await get(`/api/session/${led.body.code}/insights`);
  check('a Teacher-led room\'s cards note', insights.status === 200 && /Teacher-led/.test(insights.body.cardsNote ?? '')
    && !API.test(insights.body.cardsNote), insights.body.cardsNote);
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

for (const s of phones) s.disconnect();
io.close();
server.close();

// ----------------------------------------------------------- boot probe --

console.log('\nthe boot probe names the migration to apply');
{
  // The server is closed; from here the store is chosen again, against a
  // stand-in for PostgREST that is missing what each case says.
  const boot = async (missing) => {
    schemaMissing = missing;
    const lines = [];
    await initStore({ log: (l) => lines.push(l) });
    return { lines, kind: getRepo().kind };
  };
  const route = await boot(['attendance.roll_no']);
  check('a column only attendance writes is missing: Supabase is kept, and the log names 0021 and what fails',
    route.kind === 'supabase' && route.lines.some((l) => /WARNING: attendance\.roll_no is missing: apply supabase\/migrations\/0021_attendance_roll\.sql .*Until it is applied, every attendance mark fails to save/.test(l)),
    route.lines.join(' | '));
  const tables = await boot(['course_outcomes', 'attainment_configs']);
  check('0019\'s and 0020\'s tables are checked now too, each named with its file',
    tables.kind === 'supabase' && tables.lines.some((l) => /the course_outcomes table is missing: apply supabase\/migrations\/0019_course_outcomes\.sql/.test(l))
    && tables.lines.some((l) => /the attainment_configs table is missing: apply supabase\/migrations\/0020_attainment_configs\.sql/.test(l)));
  const room = await boot(['answers.account_verified']);
  check('a column every answer writes is missing: the log names 0022, and the store falls back rather than fail mid-class',
    room.kind === 'memory' && room.lines.some((l) => /answers\.account_verified is missing: apply supabase\/migrations\/0022_owner_decisions\.sql/.test(l)),
    room.lines.join(' | '));
  const whole = await boot([]);
  check('with everything there, no warning', whole.kind === 'supabase' && !whole.lines.some((l) => /WARNING|missing/.test(l)), whole.lines.join(' | '));
  schemaMissing = null;
}

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.fetch = realFetch;
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
