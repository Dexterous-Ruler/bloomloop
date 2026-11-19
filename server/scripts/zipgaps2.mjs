// Batch 8: the design-zip gaps for material, the bank and the hub's concept
// panel, end to end (docs/UI_ZIP_AUDIT.md M1, M2, M3, M5, H9a, H9b, the older
// file's H5, and the shared question bank decided after the Phase 6 review).
//
//   node server/scripts/zipgaps2.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, and checks:
//
//   material      the content read names each topic's slides (or line), the
//                 levels the material supports for every topic with a reason,
//                 and when the chapter was last used (the newest room on it)
//   writer        Generate with the built-in writer on purpose says which ran
//   rooms only    the owner keeps a question for rooms (an HOD and another
//                 professor cannot); practice, a lesson, a self-test and the
//                 student's error log never offer, show or explain it; staff
//                 still see it; rooms still serve it
//   practised     a room serves a signed-in student, at the level chosen, a
//                 question they have not practised in the hub first; the
//                 student card and their attainment note the answer to one
//                 they had; an unverified phone is not noted
//   serve tokens  practice and a lesson count an answer (mark it, show its key)
//                 only with the token the reply that served it carried; one
//                 without is kept as unproven, counted nowhere and told no
//                 mark or key, on every resend too; a resend of a counted
//                 answer needs no token
//   Get Ready     a student ends a check early: its undecided prerequisites are
//                 Not sure yet and its question is open again; "why this path"
//                 names what the evidence changed (Ready and skipped, on the
//                 path, a step marked done)
//   concept panel a lesson written by a stand-in model (in process, through the
//                 real parser) carries its cited sections as an AI draft; once
//                 approved a student reads them, in Hindi where the approved
//                 translation has them; a slides-only lesson has none and says so;
//                 a stepped figure added to it (the Batch 8 merge seam with the
//                 figure engines) keeps the sections, and the panel's Visual
//                 points at the figure's step
//   boot probe   a database without 0035 keeps Supabase, and the log names it
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As
// the other hub scripts do, the server is pointed at http://supabase.invalid and
// every request to it is answered here, in-process; any other request off this
// machine is refused and counted. Never calls Gemini, Supabase or any network
// service. Exits non-zero on any failure.

import http from 'node:http';
import AdmZip from 'adm-zip';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { writeLessonDraft } = await import(`${SRC}services/hubLessons.js`);
const { connectAttemptStore, PRACTICE_STORE } = await import(`${SRC}services/hubAttemptBridge.js`);
const { closedQuestions } = await import(`${SRC}services/hubClosed.js`);
const { UNPROVEN_NOTE } = await import(`${SRC}services/serveTokens.js`);
const { PRACTISED_NOTE, ROOMS_ONLY_SENTENCE } = await import(`${SRC}services/bankShare.js`);

// The in-process store and no model, whatever .env says.
config.supabase.url = '';
config.supabase.serviceKey = '';
config.supabase.anonKey = '';
config.mongoUri = '';
config.gemini.apiKey = '';
await initStore({ log: () => {} });
const repo = getRepo();
// Lesson answers go to practice's store (hub_attempts), as on a live server.
connectAttemptStore(PRACTICE_STORE);

// ------------------------------------------------- the accounts stand-in --
//
// HOD (CSE) <- professor A <- Asha (21CS01) and Bilal (21CS02), both on the
// roster. Another HOD (ECE) <- professor B.

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'e0000000-0000-4000-8000-000000000001',
  profA: 'e0000000-0000-4000-8000-000000000002',
  profB: 'e0000000-0000-4000-8000-000000000003',
  hodOther: 'e0000000-0000-4000-8000-000000000004',
  asha: 'e0000000-0000-4000-8000-000000000005',
  bilal: 'e0000000-0000-4000-8000-000000000006',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-ZG20${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.asha, 'student', 'CSE', ID.profA, '21CS01'),
  account(ID.bilal, 'student', 'CSE', ID.profA, '21CS02'),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
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
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let schemaMissing = null;
let refusedOffMachine = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  if (url.origin !== FAKE_ORIGIN) {
    refusedOffMachine += 1;
    throw new Error(`zipgaps2.mjs refuses to reach ${url.origin}`);
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
  if (url.pathname === '/rest/v1/rpc/accounts_below') return reply(below(JSON.parse(init.body ?? '{}').root));
  refusedOffMachine += 1;
  return reply({ message: `not answered by zipgaps2.mjs: ${url.pathname}` }, 404);
};
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'zipgaps2-test-service-key';

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

async function call(method, path, { body, as = 'profA' } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  return { status: res.status, body: parsed };
}
// No serve token is ever added for the caller here: this script tests them.
const get = (path, as) => call('GET', path, { as });
const post = (path, body, as) => call('POST', path, { body, as });
const put = (path, body, as) => call('PUT', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });

function deck(slides) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const zip = new AdmZip();
  slides.forEach((lines, i) => {
    zip.addFile(`ppt/slides/slide${i + 1}.xml`, Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>'
      + `${lines.map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`, 'utf8'));
  });
  return zip.toBuffer();
}
async function upload(name, slides, as = 'profA') {
  const form = new FormData();
  form.append('file', new Blob([deck(slides)]), name);
  const res = await fetch(`${base}/api/content?ocr=off`, { method: 'POST', headers: { authorization: `Bearer ${TOKENS[as]}` }, body: form });
  return { status: res.status, body: await res.json() };
}

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
const keyOf = async (questionId) => (await repo.getQuestion(questionId)).answerIdx;
const settleRun = async (path) => {
  for (let i = 0; i < 100; i += 1) {
    const r = await get(path);
    if (r.status !== 200 || r.body.run?.state !== 'running') return r;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { status: 0, body: {} };
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------- material --

console.log('\nmaterial: where each topic came from, the levels it supports, when it was last used (M1, M2, M5)');

const SLIDES = [
  ['Recursion', 'A recursive function calls itself on a smaller input.', 'A base case stops the calls.'],
  ['Recursion', 'Every call waits on the call stack until the one it made returns.'],
  ['Shared', 'A shared topic is practised in the hub and asked in rooms.'],
  ['Hubbed', 'A hubbed topic is one the student practises first.'],
  ['Basics', 'Basics come before everything else in this chapter.'],
  ['Target', 'The target topic builds on the basics.'],
];
const up = await upload('Recursion.pptx', SLIDES);
const deckId = up.body.contentId;
const T = Object.fromEntries((await repo.listChapterTopics(deckId)).map((t) => [t.name, String(t._id)]));
check('a deck uploads with its topics as records', up.status === 201 && Boolean(T.Recursion && T.Basics && T.Target), JSON.stringify(up.body));
{
  const read = await get(`/api/content/${deckId}`);
  const byTopic = Object.fromEntries((read.body.topicSources ?? []).map((s) => [s.topic, s]));
  check('the content read names each topic\'s slides, as ranges (M1)', read.status === 200
    && byTopic.Recursion?.label === 'Slides 1–2' && byTopic.Target?.label === 'Slide 6' && byTopic.Recursion?.from === 'topic-slides',
  JSON.stringify(read.body.topicSources));
  const supports = read.body.levelSupport?.topics ?? [];
  check('the levels the material supports, for EVERY topic, six levels each with a reason (M2)',
    supports.length === read.body.content.topics.length && supports.every((t) => t.levels.length === 6
      && t.levels.every((l) => /^(Supported:|Not supported by the material:)/.test(l.reason)))
    && /built-in question writer/.test(read.body.levelSupport.note), JSON.stringify(supports[0]).slice(0, 300));
  const thinId = (await post('/api/content', { title: 'Physics', text: 'Quantum chromodynamics.' })).body.contentId;
  const thin = (await get(`/api/content/${thinId}`)).body.levelSupport?.topics?.[0];
  check('a level the material cannot carry is said plainly to be not supported', thin?.levels?.some((l) => !l.supported
    && /^Not supported by the material: it does not give enough/.test(l.reason)), JSON.stringify(thin));
  check('a chapter no room has used: last used is null (M5)', read.body.lastUsed === null
    && (await get('/api/content')).body.contents.find((c) => c._id === deckId)?.lastUsed === null);
  check('the HOD reads it too; another professor gets the same 404', (await get(`/api/content/${deckId}`, 'hod')).status === 200
    && (await get(`/api/content/${deckId}`, 'profB')).status === 404);
}
const pasted = (await post('/api/content', { title: 'Lists', text: 'Linked lists\nA node points to the next one.\nArrays\nA block of memory.' })).body.contentId;
{
  const read = await get(`/api/content/${pasted}`);
  const lines = (read.body.topicSources ?? []).map((s) => s.label);
  check('pasted text: each topic\'s line', lines.includes('Line 1') && lines.includes('Line 3'), JSON.stringify(read.body.topicSources));
}

// ---------------------------------------------------------------- writer --

console.log('\nGenerate with the built-in writer on purpose (M3)');
{
  const asked = await post('/api/generate', { contentId: pasted, mode: 'append', writer: 'templates', plan: { total: 4 } });
  check('the reply says the templates wrote it, as asked', asked.status === 200 && asked.body.writer?.asked === 'templates'
    && asked.body.writer?.ran === 'templates' && asked.body.writer?.sentence === 'Written by the built-in templates, as you asked.', JSON.stringify(asked.body.writer ?? asked.body));
  const auto = await post('/api/generate', { contentId: pasted, mode: 'append', plan: { total: 4 } });
  check('without the flag and without a model: "AI unavailable", and which writer ran', auto.status === 200
    && auto.body.writer?.asked === 'auto' && auto.body.writer?.ran === 'templates' && /^AI unavailable/.test(auto.body.writer?.sentence), JSON.stringify(auto.body.writer));
  check('a writer that is neither: 400', (await post('/api/generate', { contentId: pasted, mode: 'append', writer: 'gpt' })).status === 400);
}

// ---------------------------------------------------- the bank and the class --

console.log('\nsetting up: the bank, a class, its roster and the chapter on the hub');

const mcq = (topic, text, bloom = 'remember') => ({
  contentId: deckId, topic, text, kind: 'mcq', options: ['one', 'two', 'three', 'four'], answerIdx: 1, bloom, source: 'teacher', status: 'active',
});
const [Q_SHARED, Q_ROOM, Q_HUB, Q_OTHER, B1, B2, B3, TG1, R1] = await repo.insertQuestions([
  mcq('Shared', 'Which is shared?'),
  mcq('Shared', 'Which is kept for rooms?'),
  mcq('Hubbed', 'Which was practised first?'),
  mcq('Shared', 'Which is the other one?'),
  mcq('Basics', 'Basics one?'),
  mcq('Basics', 'Basics two?'),
  mcq('Basics', 'Basics three?'),
  mcq('Target', 'Target one?'),
  mcq('Recursion', 'What stops the calls?'),
]);
const classId = (await post('/api/classes', { courseName: 'Programming', section: 'SY A' })).body.class.id;
await post(`/api/classes/${classId}/students`, { students: [{ roll: '21CS01', name: 'Asha' }, { roll: '21CS02', name: 'Bilal' }] });
const roster = await repo.listClassStudents(classId);
const ashaRow = roster.find((s) => s.rollNo === '21CS01');
check('the chapter is placed on the class', (await put(`/api/hub/classes/${classId}/chapters/${deckId}`, {})).status === 201);
check('a confirmed link: Basics before Target', (await post('/api/hub/links', { prerequisiteId: T.Basics, topicId: T.Target })).status === 201);

// ------------------------------------------------- serve tokens (practice) --

console.log('\npractice counts an answer only to a question it served to that student (serve tokens)');
let hubPractised = null;
{
  const served = await get(`/api/hub/practice/next?topicId=${T.Hubbed}`, 'asha');
  const q = served.body.question;
  check('the next question carries a serve token, and no key', served.status === 200 && q?._id === String(Q_HUB._id)
    && /^\d+\.[A-Za-z0-9_-]{43}$/.test(served.body.serveToken ?? '') && !/answerIdx/.test(JSON.stringify(served.body)), JSON.stringify(served.body).slice(0, 200));
  const body = { attemptId: 'zg2-hub-0001', questionId: q._id, topicId: T.Hubbed, response: 1 };
  // Review fix: nothing a student sends is discarded. An answer without the
  // token (a phone that queued it before tokens, or one that never got one) is
  // kept, counted nowhere, and told nothing that could be the key.
  const told = (r) => r.body.unproven === true && r.body.counted === false && r.body.note === UNPROVEN_NOTE
    && r.body.correct === null && r.body.score === null && r.body.solution === null && r.body.explanation === null;
  const keptAs = async (id) => (await repo.listHubAttempts({ accountId: ID.asha })).find((a) => a.clientAttemptId === id) ?? null;
  const bare = await post('/api/hub/practice/attempts', { ...body, attemptId: 'zg2-hub-0000' }, 'asha');
  check('without it: 201, kept as unproven, no mark, key or explanation', bare.status === 201 && told(bare)
    && (await keptAs('zg2-hub-0000'))?.unproven === true, JSON.stringify(bare.body));
  const bareAgain = await post('/api/hub/practice/attempts', { ...body, attemptId: 'zg2-hub-0000', serveToken: served.body.serveToken }, 'asha');
  check('sent again with a token: still the stored, unproven answer, still no key', bareAgain.status === 200 && bareAgain.body.duplicate === true
    && told(bareAgain), JSON.stringify(bareAgain.body));
  const theirs = await post('/api/hub/practice/attempts', { ...body, attemptId: 'zg2-bil-0001', serveToken: served.body.serveToken }, 'bilal');
  check('another student sending it: kept for them as unproven, no key', theirs.status === 201 && told(theirs), JSON.stringify(theirs.body));
  const otherQ = await post('/api/hub/practice/attempts', { ...body, attemptId: 'zg2-hub-0002', questionId: String(Q_SHARED._id), topicId: T.Shared, serveToken: served.body.serveToken }, 'asha');
  check('for another question: kept as unproven, no key', otherQ.status === 201 && told(otherQ), JSON.stringify(otherQ.body));
  const ok = await post('/api/hub/practice/attempts', { ...body, serveToken: served.body.serveToken }, 'asha');
  check('with it: 201, marked on the server, the key after', ok.status === 201 && ok.body.correct === true && ok.body.solution !== undefined, JSON.stringify(ok.body).slice(0, 200));
  const again = await post('/api/hub/practice/attempts', body, 'asha');
  check('a resend of the same answer needs no token: 200, the stored result', again.status === 200 && again.body.duplicate === true
    && again.body.correct === true, JSON.stringify(again.body).slice(0, 200));
  const progress = await get('/api/hub/progress', 'asha');
  const hubbed = progress.body.topics?.find((t) => t.id === T.Hubbed);
  check('the unproven answer counts nowhere: her topic reads the one counted answer', progress.status === 200
    && hubbed?.state?.answers === 1 && (await keptAs('zg2-hub-0001'))?.unproven === false, JSON.stringify(hubbed?.state ?? progress.body).slice(0, 300));
  hubPractised = String(Q_HUB._id);
}

// ------------------------------------------------------------ rooms only --

console.log('\nthe owner keeps a question for rooms only');
{
  const hod = await put(`/api/bank/question/${Q_ROOM._id}/rooms-only`, { roomsOnly: true }, 'hod');
  const other = await put(`/api/bank/question/${Q_ROOM._id}/rooms-only`, { roomsOnly: true }, 'profB');
  const missing = await put('/api/bank/question/0123456789abcdef01234567/rooms-only', { roomsOnly: true }, 'profB');
  check('the HOD may not (403); another professor gets the same 404 as a question that is not there',
    hod.status === 403 && other.status === 404 && JSON.stringify(other.body) === JSON.stringify(missing.body), `${hod.status} ${other.status} ${JSON.stringify(missing.body)}`);
  check('a body that does not say true or false: 400', (await put(`/api/bank/question/${Q_ROOM._id}/rooms-only`, { roomsOnly: 'yes' })).status === 400);
}

// A room on the chapter, before the switch: Asha (signed in) answers the
// rooms-only question wrong, so her error log has it "from class".
const roomA = await post('/api/session', { contentId: deckId, classId, questionIds: [String(Q_ROOM._id)] });
{
  const phone = await connect();
  const first = next(phone, ['server:question', 'server:exhausted']);
  phone.emit('student:join', { code: roomA.body.code, rollNo: '21CS01', name: 'Asha', token: TOKENS.asha });
  const q = (await first).payload.question;
  const result = next(phone, 'server:result');
  phone.emit('student:answer', { questionId: q._id, response: ((await keyOf(q._id)) + 1) % 4, answerId: 'zg2-room-0001' });
  await result;
  phone.disconnect();
  await pause(150);
  await post(`/api/session/${roomA.body.code}/close`, {});
}
const logBefore = await get('/api/hub/errors', 'asha');
check('before the switch, the student\'s error log has the room\'s wrong answer', logBefore.status === 200
  && logBefore.body.entries.some((e) => e.question?.text === 'Which is kept for rooms?'), JSON.stringify(logBefore.body).slice(0, 300));
{
  const on = await put(`/api/bank/question/${Q_ROOM._id}/rooms-only`, { roomsOnly: true });
  check('the owner turns it on: the reply says what it means', on.status === 200 && on.body.roomsOnly === true && on.body.changed === true
    && on.body.message === ROOMS_ONLY_SENTENCE.on && on.body.question.roomsOnly === true, JSON.stringify(on.body).slice(0, 300));
  const bank = await get(`/api/bank/${deckId}`);
  check('the bank read shows it', bank.body.questions.find((q) => q._id === String(Q_ROOM._id))?.roomsOnly === true
    && bank.body.questions.find((q) => q._id === String(Q_SHARED._id))?.roomsOnly === false);
  const seen = new Set();
  for (let i = 0; i < 4; i += 1) {
    const n = await get(`/api/hub/practice/next?topicId=${T.Shared}`, 'asha');
    seen.add(n.body.question?._id);
    await post('/api/hub/practice/attempts', {
      attemptId: `zg2-shared-${i}0001`, questionId: n.body.question?._id, topicId: T.Shared, response: 1, serveToken: n.body.serveToken,
    }, 'asha');
  }
  check('practice never serves it', !seen.has(String(Q_ROOM._id)) && seen.has(String(Q_SHARED._id)), JSON.stringify([...seen]));
  const log = await get('/api/hub/errors', 'asha');
  check('the student\'s error log no longer shows or explains it', !JSON.stringify(log.body).includes('Which is kept for rooms?'), JSON.stringify(log.body).slice(0, 300));
  const staff = await get(`/api/hub/classes/${classId}/students/${ashaRow._id}/progress`);
  check('staff still see it in her log', JSON.stringify(staff.body).includes('Which is kept for rooms?'), JSON.stringify(staff.body).slice(0, 200));
  const exam = await post('/api/hub/exams', { clientRunId: 'zg2-exam-0001', topicIds: [T.Shared], count: 30 }, 'asha');
  const listed = (exam.body.questions ?? []).map((x) => x.questionId);
  check('a self-test never holds it', exam.status === 201 && listed.includes(String(Q_SHARED._id)) && !listed.includes(String(Q_ROOM._id)), JSON.stringify(exam.body).slice(0, 200));
  await post(`/api/hub/exams/${exam.body.exam.id}/submit`, {}, 'asha');
  const gen = await post(`/api/hub/topics/${T.Shared}/lessons/generate`, {});
  await settleRun(`/api/hub/lessons/run/${gen.body.runId}`);
  const draft = (await get(`/api/hub/topics/${T.Shared}/lessons`)).body.drafts?.[0];
  const dealt = (draft?.steps ?? []).filter((s) => s.type === 'questions').flatMap((s) => s.questions.map((q) => q.id));
  check('a slides-only lesson never deals it', dealt.includes(String(Q_SHARED._id)) && !dealt.includes(String(Q_ROOM._id)), JSON.stringify(dealt));
  const roomB = await post('/api/session', { contentId: deckId, questionIds: [String(Q_ROOM._id)] });
  const guest = await connect();
  const got = next(guest, ['server:question', 'server:exhausted']);
  guest.emit('student:join', { code: roomB.body.code, rollNo: '21CS77', name: 'A guest' });
  check('a room still serves it', (await got).payload.question?._id === String(Q_ROOM._id));
  guest.disconnect();
  await post(`/api/session/${roomB.body.code}/close`, {});
  // Review fix: its replacement stays rooms only, so approving it never starts
  // serving the question in the hub.
  const regen = await post(`/api/bank/question/${Q_ROOM._id}/regenerate`, {});
  check('a regenerated replacement is kept for rooms too', regen.status === 200 && regen.body.question?.roomsOnly === true
    && (await repo.getQuestion(regen.body.question._id))?.roomsOnly === true, JSON.stringify(regen.body).slice(0, 300));
  if (regen.body.question?._id) await repo.updateQuestion(regen.body.question._id, { status: 'discarded' });
}

// --------------------------------------------------- serve tokens (lesson) --

console.log('\na lesson counts an answer only to a question it served to that student');
{
  const draft = (await get(`/api/hub/topics/${T.Shared}/lessons`)).body.drafts?.[0];
  await post(`/api/hub/lessons/${draft.id}/approve`, {});
  const read = await get(`/api/hub/topics/${T.Shared}/lesson`, 'asha');
  const qs = read.body.lesson.steps.filter((s) => s.type === 'questions').flatMap((s) => s.questions);
  const q = qs.find((x) => x._id === String(Q_SHARED._id));
  check('each question the lesson shows carries its serve token; the rooms-only one is not shown',
    Boolean(q?.serveToken) && !qs.some((x) => x._id === String(Q_ROOM._id)), JSON.stringify(qs).slice(0, 300));
  const path = `/api/hub/lessons/${draft.id}/questions/${q._id}/attempts`;
  const bare = await post(path, { attemptId: 'zg2-lsn-0000', response: 1 }, 'asha');
  check('without it: 201, kept as unproven, no mark or key', bare.status === 201 && bare.body.unproven === true && bare.body.counted === false
    && bare.body.solution === null && bare.body.correct === null
    && (await repo.listHubAttempts({ accountId: ID.asha })).find((a) => a.clientAttemptId === 'zg2-lsn-0000')?.unproven === true, JSON.stringify(bare.body));
  const ok = await post(path, { attemptId: 'zg2-lsn-0001', response: 1, serveToken: q.serveToken }, 'asha');
  check('with it: 201, and the key after', ok.status === 201 && ok.body.correct === true, JSON.stringify(ok.body));
  const roomOnly = await post(`/api/hub/lessons/${draft.id}/questions/${Q_ROOM._id}/attempts`, { attemptId: 'zg2-lsn-0002', response: 1, serveToken: q.serveToken }, 'asha');
  check('an answer to the rooms-only question in a lesson: the question\'s 404', roomOnly.status === 404, JSON.stringify(roomOnly.body));
}

// ------------------------------------------------------------- practised --

console.log('\na room avoids what a signed-in student already practised; staff screens note it');
// Her one practised question, and one she has never met (Recursion, at the same level).
const roomC = await post('/api/session', { contentId: deckId, classId, questionIds: [hubPractised, String(R1._id)] });
{
  const phone = await connect();
  const first = next(phone, ['server:question', 'server:exhausted']);
  phone.emit('student:join', { code: roomC.body.code, rollNo: '21CS01', name: 'Asha', token: TOKENS.asha });
  const q1 = (await first).payload.question;
  check('signed in, she is served the question she has not practised first', q1?._id === String(R1._id), JSON.stringify(q1));
  let r = next(phone, 'server:result');
  phone.emit('student:answer', { questionId: q1._id, response: await keyOf(q1._id), answerId: 'zg2-roomc-0001' });
  await r;
  const second = next(phone, ['server:question', 'server:exhausted']);
  phone.emit('student:next', {});
  const q2 = (await second).payload.question;
  check('with no other question of that level left, the practised one is served', q2?._id === hubPractised, JSON.stringify(q2));
  r = next(phone, 'server:result');
  phone.emit('student:answer', { questionId: q2._id, response: await keyOf(q2._id), answerId: 'zg2-roomc-0002' });
  await r;
  phone.disconnect();
  const typed = await connect();
  const tq = next(typed, ['server:question', 'server:exhausted']);
  typed.emit('student:join', { code: roomC.body.code, rollNo: '21CS02', name: 'Bilal' });
  const bq = (await tq).payload.question;
  r = next(typed, 'server:result');
  typed.emit('student:answer', { questionId: bq._id, response: await keyOf(bq._id), answerId: 'zg2-roomc-0003' });
  await r;
  typed.disconnect();
  await pause(150);
  const card = await get(`/api/session/${roomC.body.code}/students/21CS01/card`);
  const items = card.body.lastAnswers?.items ?? [];
  const noted = items.filter((a) => a.practisedInHub === true);
  check('the student card notes the answer to the question she had practised, and only that one', card.status === 200
    && noted.length === 1 && noted[0].practisedNote === PRACTISED_NOTE && items.length === 2, JSON.stringify(items).slice(0, 400));
  const bilalCard = await get(`/api/session/${roomC.body.code}/students/21CS02/card`);
  check('an unverified phone\'s answer is never noted', !JSON.stringify(bilalCard.body).includes('practisedInHub'));
  await post(`/api/session/${roomC.body.code}/close`, {});
  const report = await get(`/api/classes/${classId}/attainment/students/${ashaRow._id}`);
  const ans = report.body.answers ?? [];
  check('her attainment notes the same answer, and it still counts as usual', report.status === 200
    && ans.filter((a) => a.practisedInHub === true).length === 1 && ans.some((a) => a.practisedInHub === true && a.counts === true),
  JSON.stringify(ans.map((a) => [a.practisedInHub ?? false, a.counts])));
}

// -------------------------------------------------------------- Get Ready --

console.log('\nGet Ready: a student ends a check early; "why this path" names what changed');
{
  // Asha as the server reads her account (services/hubAccess.js reaches her classes through it).
  const ASHA = { id: ID.asha, role: 'student', reportsTo: ID.profA, rollNo: '21CS01', department: 'CSE' };
  const started = await post('/api/hub/getready', { clientRunId: 'zg2-check-0001', targetTopicId: T.Target }, 'asha');
  const asking = started.body.question?.question?._id;
  check('a check starts on Target, asking about Basics', started.status === 201 && [B1, B2, B3].some((b) => String(b._id) === asking),
    JSON.stringify(started.body).slice(0, 300));
  const closedBefore = await closedQuestions(repo, ASHA, { contentIds: [deckId] });
  check('its question is closed elsewhere in the hub while it is open', closedBefore.get(asking) === 'getready');
  check('staff cannot end it (403), nor another student (the check\'s 404)',
    (await post(`/api/hub/getready/${started.body.check.id}/end`, {})).status === 403
    && (await post(`/api/hub/getready/${started.body.check.id}/end`, {}, 'bilal')).status === 404);
  const ended = await post(`/api/hub/getready/${started.body.check.id}/end`, {}, 'asha');
  const basics = ended.body.prerequisites?.[0];
  check('ended: complete, said to be ended early; Basics is Not sure yet, saying the check ended', ended.status === 200
    && ended.body.changed === true && ended.body.check.status === 'complete' && ended.body.check.endedEarly === true
    && basics?.outcome === 'not-sure' && /check ended/.test(basics?.sentence ?? ''), JSON.stringify(ended.body).slice(0, 400));
  const closedAfter = await closedQuestions(repo, ASHA, { contentIds: [deckId] });
  check('its question is open again', !closedAfter.has(asking));
  const late = await post(`/api/hub/getready/${started.body.check.id}/answers`, { attemptId: 'zg2-gr-late1', questionId: asking, response: 1 }, 'asha');
  check('an answer to it now: 409', late.status === 409, JSON.stringify(late.body));
  const twice = await post(`/api/hub/getready/${started.body.check.id}/end`, {}, 'asha');
  check('ending it again changes nothing', twice.status === 200 && twice.body.changed === false);

  // A second check, both Basics answers wrong: Basics needs review.
  let view = (await post('/api/hub/getready', { clientRunId: 'zg2-check-0002', targetTopicId: T.Target }, 'asha')).body;
  for (let i = 0; i < 3 && view.question; i += 1) {
    const qid = view.question.question._id;
    const out = await post(`/api/hub/getready/${view.check.id}/answers`,
      { attemptId: `zg2-gr2-000${i}`, questionId: qid, response: ((await keyOf(qid)) + 1) % 4 }, 'asha');
    view = out.body.check;
  }
  check('the check finds Basics needs review, and the path says why, from her own counts', view.check.status === 'complete'
    && view.prerequisites[0].outcome === 'needs-review' && /"Basics" was 0 of 2 in the check, so it is on your path\./.test(view.path?.why?.sentence ?? '')
    && /^Your Get Ready check · /.test(view.path?.why?.source?.label ?? ''), JSON.stringify(view.path?.why ?? view).slice(0, 400));
  for (let i = 0; i < 4; i += 1) {
    const n = await get(`/api/hub/practice/next?topicId=${T.Basics}`, 'asha');
    if (!n.body.question) break;
    await post('/api/hub/practice/attempts', {
      attemptId: `zg2-basics-${i}001`, questionId: n.body.question._id, topicId: T.Basics,
      response: await keyOf(n.body.question._id), serveToken: n.body.serveToken,
    }, 'asha');
    const now = (await get(`/api/hub/getready/${view.check.id}`, 'asha')).body;
    if (now.path?.steps?.[0]?.status === 'done') { view = now; break; }
  }
  check('practised right since, the step is marked done, and "why this path" says so', view.path?.steps?.[0]?.status === 'done'
    && /so this step is marked done\./.test(view.path.steps[0].why)
    && /Since then you got \d of \d answers right on "Basics", so that step is marked done\./.test(view.path.why.sentence)
    && view.path.why.changes.some((c) => c.change === 'done'), JSON.stringify(view.path).slice(0, 500));
}

// ---------------------------------------------------------- concept panel --

console.log('\nthe concept panel: sections written with the lesson, cited, an AI draft until approved (H9a, H9b)');
{
  const content = await repo.getContent(deckId);
  const topic = (await repo.listChapterTopics(deckId)).find((t) => t.name === 'Recursion');
  const standIn = async () => JSON.stringify({
    parts: [{
      part: 'C1',
      example: { problem: 'What does fact(0) return?', steps: ['The base case answers directly.'], answer: 'One.' },
      questions: [
        { kind: 'truefalse', bloom: 'remember', text: 'A base case stops the calls.', answerBool: true },
        { kind: 'truefalse', bloom: 'remember', text: 'A recursive function never calls itself.', answerBool: false },
      ],
    }],
    concept: {
      intro: { text: 'Recursion solves a problem through smaller copies of itself.', parts: ['C1'] },
      facts: [{ kind: 'connects', text: 'It connects to the call stack.', parts: ['C1'] }],
      steps: [{ term: 'Base case', text: 'It stops the calls.', parts: ['C1'] }, { term: 'Call stack', text: 'Each call waits on it.', parts: ['C1'] }],
      example: { language: 'python', body: 'def fact(n):\n    return 1 if n == 0 else n * fact(n - 1)', caption: 'Factorial.', parts: ['C1'] },
      mistakes: [{ text: 'Forgetting the base case.', parts: ['C1'] }, { text: 'Uncited.', parts: [] }],
    },
  });
  const { lesson } = await writeLessonDraft(repo, { content, topic, viewer: { id: ID.profA, role: 'professor' }, callModel: standIn });
  const staff = await get(`/api/hub/lessons/${lesson._id}`);
  const s = staff.body.lesson?.sections;
  check('staff read the sections as an AI draft, each piece cited to its slides', staff.status === 200 && s?.aiDraft === true
    && /^AI draft/.test(s.label) && s.intro?.cite === 'Slides 1 and 2' && s.facts?.[0]?.label === 'Connects to' && s.steps?.length === 2
    && s.mistakes?.length === 1 && /<pre|<code/.test(s.example?.html ?? ''), JSON.stringify(s).slice(0, 400));
  check('the uncited piece was left out, and the warning says so', staff.body.lesson.warnings.some((w) => /named no part/.test(w)), JSON.stringify(staff.body.lesson.warnings));
  const draftView = await get(`/api/hub/topics/${T.Recursion}/lesson`, 'asha');
  check('a draft reaches no student', draftView.status === 200 && draftView.body.lesson === null);
  await post(`/api/hub/lessons/${lesson._id}/approve`, {});
  const read = await get(`/api/hub/topics/${T.Recursion}/lesson`, 'asha');
  const rs = read.body.lesson?.sections;
  check('approved, the student reads them, with who wrote them in their words and nothing of the draft', read.status === 200
    && rs?.available === true && rs.intro?.text?.startsWith('Recursion solves') && rs.example?.body?.includes('def fact')
    && /checked by your professor/.test(rs.label) && !/AI draft|aiDraft|"parts"|stand-in/.test(JSON.stringify(rs)), JSON.stringify(rs).slice(0, 300));

  // A Hindi translation of the lesson, its sections included.
  const english = await repo.getTopicLesson(lesson._id);
  const fields = {};
  english.steps.forEach((st, i) => {
    if (st.type === 'chunk') fields[`steps.${i}.text`] = 'पुनरावृत्ति: फ़ंक्शन स्वयं को बुलाता है।';
    if (st.type === 'example') {
      fields[`steps.${i}.problem`] = 'fact(0) क्या लौटाता है?';
      fields[`steps.${i}.steps`] = st.steps.map(() => 'आधार स्थिति सीधे उत्तर देती है।');
      fields[`steps.${i}.answer`] = 'एक।';
    }
  });
  Object.assign(fields, {
    'sections.intro': 'पुनरावृत्ति छोटी प्रतियों से समस्या हल करती है।',
    'sections.facts': ['यह call stack से जुड़ती है।'],
    'sections.steps': ['यह कॉल रोकती है।', 'हर कॉल उस पर प्रतीक्षा करती है।'],
    'sections.example.caption': 'फ़ैक्टोरियल।',
    'sections.mistakes': ['आधार स्थिति भूल जाना।'],
  });
  const made = await post('/api/hub/translations', { itemKind: 'lesson', itemId: String(lesson._id), language: 'hi', fields });
  const approved = await post(`/api/hub/translations/${made.body.translation?.id}/approve`, { confirmFlags: true });
  check('the professor writes and approves a Hindi version, its sections checked like any field', made.status === 201 && approved.status === 200,
    `${made.status} ${JSON.stringify(made.body).slice(0, 300)} | ${approved.status} ${JSON.stringify(approved.body).slice(0, 200)}`);
  await put('/api/hub/language', { language: 'hi' }, 'asha');
  const hi = await get(`/api/hub/topics/${T.Recursion}/lesson`, 'asha');
  const hs = hi.body.lesson?.sections;
  check('a student who chose Hindi reads the sections in Hindi; the terms and the code stay English',
    hi.body.lesson?.language?.language === 'hi' && hs?.intro?.text === 'पुनरावृत्ति छोटी प्रतियों से समस्या हल करती है।'
    && hs.steps[0].term === 'Base case' && hs.example.body.includes('def fact'), JSON.stringify(hi.body.lesson?.language) + JSON.stringify(hs).slice(0, 300));
  await put('/api/hub/language', { language: 'en' }, 'asha');

  const shared = await get(`/api/hub/topics/${T.Shared}/lesson`, 'asha');
  check('the slides-only lesson has no sections, and tells the student plainly', shared.body.lesson?.sections?.available === false
    && /slides in short steps/.test(shared.body.lesson.sections.note), JSON.stringify(shared.body.lesson?.sections));
  const staffShared = await get(`/api/hub/topics/${T.Shared}/lessons`);
  check('and tells the professor why', /no AI model wrote this version/.test(staffShared.body.serving?.sections?.note ?? ''), JSON.stringify(staffShared.body.serving?.sections));

  // ---- Batch 8 merge seam: the concept panel's Visual (H9c, from the figure
  // engines' branch) sits in the same sections as H9a and H9b. Adding a stepped
  // figure to the AI lesson writes a new draft version that keeps its sections,
  // and the panel points at the figure's step instead of drawing it twice.
  const STACK = {
    type: 'stack', title: 'fact(3)', frames: [{ id: 'main', label: 'main' }],
    steps: [
      { frames: [{ id: 'main', label: 'main' }, { id: 'f3', label: 'fact(3)', note: 'n = 3' }], caption: 'main calls fact(3).' },
      { frames: [{ id: 'main', label: 'main' }, { id: 'f3', label: 'fact(3)' }, { id: 'f2', label: 'fact(2)', note: 'n = 2' }], caption: 'fact(3) needs fact(2), so it waits.' },
      { frames: [{ id: 'main', label: 'main' }, { id: 'f3', label: 'fact(3)', note: 'returns 6' }], caption: 'fact(2) returns 2 and is popped.' },
    ],
  };
  const added = await post(`/api/hub/lessons/${lesson._id}/figures`, { spec: STACK, after: 0 });
  const v2 = added.body.lesson;
  const fig = v2?.sections?.visual?.figures?.[0];
  check('a figure added to the AI lesson: the new draft keeps its sections, and the Visual points at the figure step',
    added.status === 201 && v2.version === lesson.version + 1 && v2.sections?.available === true
    && v2.sections.intro?.text?.startsWith('Recursion solves') && v2.sections.steps?.length === 2 && v2.sections.visual.available === true
    && v2.steps?.[fig?.step]?.type === 'figure' && fig.stepCount === 3 && fig.title === 'fact(3)',
    `${added.status} ${JSON.stringify(v2?.sections?.visual)} ${JSON.stringify(v2?.steps?.map((x) => x.type))}`);
  check('the sections are stored on the new version itself', (await repo.getTopicLesson(v2?.id))?.sections?.intro?.text?.startsWith('Recursion solves'));
  const before = await get(`/api/hub/topics/${T.Recursion}/lesson`, 'asha');
  check('until it is approved, the student reads the approved version, which has no Visual and says so',
    before.body.lesson?.id === String(lesson._id) && before.body.lesson.sections?.visual?.available === false
    && /no figure to step through/.test(before.body.lesson.sections.visual.note ?? ''), JSON.stringify(before.body.lesson?.sections?.visual));
  const approvedV2 = await post(`/api/hub/lessons/${v2?.id}/approve`, {});
  const after = await get(`/api/hub/topics/${T.Recursion}/lesson`, 'asha');
  const sv = after.body.lesson?.sections;
  const shownStep = after.body.lesson?.steps?.[sv?.visual?.figures?.[0]?.step];
  check('approved, the student\'s panel has the sections and a Visual pointing at the figure, drawn with its steps and no spec',
    approvedV2.status === 200 && after.body.lesson?.id === v2?.id && sv?.available === true && sv.intro?.text?.startsWith('Recursion solves')
    && shownStep?.type === 'figure' && shownStep.figure?.steps?.length === 3 && /<svg/.test(shownStep.figure.svg ?? '')
    && !('spec' in shownStep) && !/"frames"/.test(JSON.stringify(after.body.lesson)),
    `${approvedV2.status} ${JSON.stringify(sv?.visual)} ${JSON.stringify(shownStep).slice(0, 200)}`);
  check('a lesson with no figure tells the professor how to give it a Visual',
    staffShared.body.serving?.sections?.visual?.available === false && /Add one to give it a Visual/.test(staffShared.body.serving.sections.visual.note ?? ''),
    JSON.stringify(staffShared.body.serving?.sections?.visual));
}

// --------------------------------------------------------- last used (M5) --

console.log('\nwhen the chapter was last used, once rooms have run on it (M5)');
{
  const read = await get(`/api/content/${deckId}`);
  const listed = (await get('/api/content')).body.contents.find((c) => c._id === deckId);
  check('the newest room opened on it', read.body.lastUsed?.code === roomC.body.code && listed?.lastUsed?.code === roomC.body.code
    && Boolean(Date.parse(read.body.lastUsed.at)), JSON.stringify(read.body.lastUsed));
}

io.close();
server.close();
connectAttemptStore(null);

// ----------------------------------------------------------- boot probe --

console.log('\nthe boot probe names 0035 when it is missing, and rooms keep Supabase');
{
  const boot = async (missing) => {
    schemaMissing = missing;
    const lines = [];
    await initStore({ log: (l) => lines.push(l) });
    return { lines, kind: getRepo().kind };
  };
  const without = await boot(['questions.rooms_only', 'topic_lessons.sections']);
  check('without 0035\'s columns Supabase is kept, and the log names the file and what fails',
    without.kind === 'supabase'
    && without.lines.some((l) => /questions\.rooms_only is missing: apply supabase\/migrations\/0035_bank_share_and_concept_panel\.sql .*kept for rooms only/.test(l))
    && without.lines.some((l) => /topic_lessons\.sections is missing: .*0035.*introduction, facts/.test(l)),
    without.lines.join(' | '));
  const whole = await boot([]);
  check('with everything there, no warning', whole.kind === 'supabase' && !whole.lines.some((l) => /WARNING|missing/.test(l)), whole.lines.join(' | '));
  schemaMissing = null;
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.fetch = realFetch;
process.exit(fail ? 1 : 0);
