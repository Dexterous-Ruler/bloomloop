// Phase 6: the hub's tutor, end to end (decision H13, under decisions 1 and 5).
//
//   node server/scripts/tutor.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, against a clock this script sets, and
// checks:
//
//   accounts only     no token is a 401, the teacher key reaches nothing, staff on
//                     a student's route and a student on staff's are 403 before
//                     anything is read, no Supabase is a 503
//   writing hints     the professor writes a ladder and feedback on a wrong
//                     option, each approved as written and citing its slides; a
//                     hint holding the answer (the right option, the value, the
//                     claim's truth) is refused, saying why; feedback goes on a
//                     wrong option only
//   AI drafts         drafted by a stand-in model through the real parser (a
//                     leaking one refused, with why); stored as AI drafts; on the
//                     professor's button with no model key, none, and the run
//                     says so; approval checks each draft again
//   approval gating   drafts reach no student; once approved they do
//   practice          hints one at a time, each recorded, never the key; asking
//                     again returns the same hint; the attempt records how many
//                     were opened; then the hints are closed; the option's
//                     feedback after a wrong answer; on the next attempt at that
//                     question, that feedback first, in place of the nudge
//   never in a self-test or Get Ready   400 for those modes, nothing recorded,
//                     and a self-test attempt records no hints
//   lessons           a lesson's question offers hints; one opened is recorded
//                     in mode 'lesson' and counted on the lesson's attempt
//   languages         an approved Hindi hint is shown to a student who chose
//                     Hindi; one that would give the answer away never is
//   who is refused    another professor's student, a student not on the roster,
//                     another professor and another department's HOD: the same
//                     404, word for word; the HOD reads and writes nothing
//   nothing else moves  no answers row is written; attainment and the register
//                     read the same before and after
//   boot probe        a database without 0029 keeps Supabase, and the log names
//                     the file and what fails until it is applied
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As
// server/scripts/practice.mjs, roster.mjs and decisions.mjs do, the server is
// pointed at http://supabase.invalid and every request to it is answered here,
// in-process; any other request off this machine is refused and counted.
// Never calls Gemini, Supabase or any network service. Exits non-zero on any
// failure.

import http from 'node:http';
import AdmZip from 'adm-zip';
import { Server } from 'socket.io';

// ----------------------------------------------------------- the clock --
//
// Every `new Date()` and Date.now() in this process reads this clock, so the
// order of attempts is the script's to set. `new Date(value)` is untouched.
const RealDate = Date;
let clockMs = RealDate.parse('2026-11-19T04:30:00.000Z');
class ClockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(clockMs);
  }

  static now() { return clockMs; }
}
globalThis.Date = ClockDate;
const tick = (ms = 30000) => { clockMs += ms; };

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { recordAttempt } = await import(`${SRC}services/hubPractice.js`);
const { hintsOffered, hintsUsedOn } = await import(`${SRC}services/hubHintHook.js`);
const { OFFLINE_NOTE, WHY, writeTutorDrafts } = await import(`${SRC}services/hubTutor.js`);

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
// HOD (CSE) <- professor A <- Asha (21CS01) and Bilal (21CS02), on the roster;
// Cara (21CS03), never on it. Another HOD (ECE) <- professor B <- Omar, who
// also holds roll number 21CS01, on B's roster.

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'f0000000-0000-4000-8000-000000000001',
  profA: 'f0000000-0000-4000-8000-000000000002',
  profB: 'f0000000-0000-4000-8000-000000000003',
  hodOther: 'f0000000-0000-4000-8000-000000000004',
  asha: 'f0000000-0000-4000-8000-000000000005',
  bilal: 'f0000000-0000-4000-8000-000000000006',
  cara: 'f0000000-0000-4000-8000-000000000007',
  omar: 'f0000000-0000-4000-8000-000000000008',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-TUT0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T04:00:00+00:00', updated_at: '2026-11-19T04:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.asha, 'student', 'CSE', ID.profA, '21cs01'),
  account(ID.bilal, 'student', 'CSE', ID.profA, '21CS02'),
  account(ID.cara, 'student', 'CSE', ID.profA, '21CS03'),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
  account(ID.omar, 'student', 'ECE', ID.profB, '21CS01'),
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
    throw new Error(`tutor.mjs refuses to reach ${url.origin}`);
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
  refusedOffMachine += 1;
  return reply({ message: `not answered by tutor.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'tutor-test-service-key';

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

/** `as`: one of the TOKENS' names, 'key' for the shared teacher key, or null for no credentials. */
async function call(method, path, { body, as = 'profA' } = {}) {
  const headers = {};
  if (as === 'key') headers['x-teacher-key'] = config.teacherKey;
  else if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  return { status: res.status, body: parsed, text };
}
const get = (path, as) => call('GET', path, { as });
const post = (path, body, as) => call('POST', path, { body, as });
const put = (path, body, as) => call('PUT', path, { body, as });
const del = (path, as) => call('DELETE', path, { as });

/** Poll a run until it is no longer running. */
async function settle(path, as = 'profA') {
  for (let i = 0; i < 100; i += 1) {
    const r = await get(path, as);
    if (r.status !== 200 || r.body.run?.state !== 'running') return r;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { status: 0, body: { error: 'the run never finished' } };
}

/** A .pptx of the given slides, each [title, ...lines]. */
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

// What a student may never be sent before an attempt: a key, a rubric, an
// explanation, a solution, a misconception label.
const KEYS_BEFORE = /answerIdx|answerIdxs|answerBool|"accept"|rubric|"sequence"|"pairs"|"buckets"|"value"|explanation|"solution"|misconception/;
const NO_QUESTION = JSON.stringify({ error: 'That question was not found.' });
const NO_TOPIC = JSON.stringify({ error: 'That topic was not found.' });
const NO_LESSON = JSON.stringify({ error: 'That lesson was not found.' });

// ------------------------------------------------------------- the material --

console.log('\nsetting up: a deck with its slides, a class, questions on Sets');

const form = new FormData();
form.append('file', new Blob([deck([
  ['Sets', 'A set holds each element once.', 'Braces write a set: {1, 2}.'],
  ['Sets', 'Round brackets write an ordered pair; square brackets a list.'],
  ['Relations', 'A relation pairs elements of two sets.'],
])]), 'Discrete structures.pptx');
const up = await fetch(`${base}/api/content?ocr=off`, { method: 'POST', headers: { authorization: `Bearer ${TOKENS.profA}` }, body: form });
const deckId = (await up.json()).contentId;
const T = Object.fromEntries((await repo.listChapterTopics(deckId)).map((t) => [t.name, String(t._id)]));
check('a deck uploads with its topics as records', up.status === 201 && Boolean(T.Sets && T.Relations), JSON.stringify(Object.keys(T)));

const [QSET, QNUM, QTF, QDRAFT, QPOLL] = await repo.insertQuestions([
  { topic: 'Sets', text: 'Which of these is a set?', kind: 'mcq', options: ['{1, 2}', '{1, 1}', '(1, 2)', '[1, 2]'], answerIdx: 0, bloom: 'remember',
    status: 'active', source: 'teacher' },
  { topic: 'Sets', text: 'How many elements has {1, 2, 3}?', kind: 'numeric', value: 3, tolerance: 0, bloom: 'apply', status: 'active', source: 'teacher' },
  { topic: 'Sets', text: 'Every set holds some element twice.', kind: 'truefalse', answerBool: false, bloom: 'understand', status: 'active', source: 'teacher' },
  { topic: 'Sets', text: 'A draft nobody approved', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'remember', status: 'draft', source: 'llm', model: 'm' },
  { topic: 'Sets', text: 'How sure are you?', kind: 'poll', options: ['Sure', 'Not sure'], bloom: 'remember', status: 'active', source: 'teacher' },
].map((q) => ({ ...q, contentId: deckId })));
const Q = { set: String(QSET._id), num: String(QNUM._id), tf: String(QTF._id), draft: String(QDRAFT._id), poll: String(QPOLL._id) };

const classId = (await post('/api/classes', { courseName: 'Discrete Maths', section: 'SY A' })).body.class.id;
await post(`/api/classes/${classId}/students`, { students: [{ roll: '21CS01', name: 'Asha' }, { roll: '21CS02', name: 'Bilal' }] });
check('the chapter is placed on the class', (await put(`/api/hub/classes/${classId}/chapters/${deckId}`, {})).status === 201);
const theirClass = (await post('/api/classes', { courseName: 'Signals', section: 'EC A' }, 'profB')).body.class.id;
await post(`/api/classes/${theirClass}/students`, { students: [{ roll: '21CS01', name: 'Omar' }] }, 'profB');

// Everything the tutor must leave alone, read before any of it.
const untouched = async () => JSON.stringify({
  answers: await repo.listAnswers({}),
  attainment: (await get(`/api/classes/${classId}/attainment`)).text,
  register: (await get(`/api/classes/${classId}/register`)).text,
});
const before = await untouched();

// ---------------------------------------------------------- accounts only --

console.log('\naccounts only, and who reaches which side (H1)');
{
  const hintPath = '/api/hub/practice/hints';
  check('no credentials: 401', (await post(hintPath, {}, null)).status === 401);
  check('the shared teacher key reaches nothing here: 401', (await get(`/api/hub/chapters/${deckId}/hints`, 'key')).status === 401);
  const staffOnStudent = [await post(hintPath, { attemptId: 'staff-0001' }, 'profA'), await get(`${hintPath}?attemptId=staff-0001`, 'hod')];
  check('staff on a student\'s hint route: 403, saying it is for a student account',
    staffOnStudent.every((r) => r.status === 403 && /student account/.test(r.body.error)), staffOnStudent.map((r) => r.status).join(','));
  const studentOnStaff = [await get(`/api/hub/chapters/${deckId}/hints`, 'asha'), await get(`/api/hub/questions/${Q.set}/hints`, 'asha'),
    await put(`/api/hub/questions/${Q.set}/hints/1`, { text: 'x' }, 'asha'), await post(`/api/hub/chapters/${deckId}/hints/generate`, {}, 'asha'),
    await post(`/api/hub/questions/${Q.set}/hints/approve`, {}, 'asha')];
  check('a student on a staff route: 403 before anything is read', studentOnStaff.every((r) => r.status === 403), studentOnStaff.map((r) => r.status).join(','));
}

// --------------------------------------------------------- writing hints --

console.log('\nthe professor writes a ladder and feedback (H13)');
{
  const ladder = [
    'Look again at the first slide: what may a set never hold twice?',
    'Check each choice for a repeated element, then for the kind of brackets it uses.',
    '{1, 1} repeats 1, and (1, 2) and [1, 2] use other brackets. One choice is left.',
  ];
  const first = await put(`/api/hub/questions/${Q.set}/hints/1`, { text: ladder[0] });
  const nudge = first.body.question?.hints?.[0];
  check('step 1: 201, the professor\'s, approved as written, citing the topic\'s slides', first.status === 201 && nudge?.provenance === 'professor'
    && nudge.status === 'approved' && nudge.statusLabel === 'Written by the professor' && nudge.cite === 'Slides 1 and 2', JSON.stringify(nudge));
  await put(`/api/hub/questions/${Q.set}/hints/2`, { text: ladder[1], slides: [1, 2] });
  const third = await put(`/api/hub/questions/${Q.set}/hints/3`, { text: ladder[2], slides: [2] });
  check('steps 2 and 3, the last citing one slide', third.status === 201 && third.body.question.hints.length === 3
    && third.body.question.hints[2].cite === 'Slide 2' && third.body.question.missingSteps.length === 0);
  const rewrite = await put(`/api/hub/questions/${Q.set}/hints/1`, { text: `${ladder[0]} ` });
  check('writing step 1 again rewrites it: 200', rewrite.status === 200 && rewrite.body.question.hints.length === 3);

  const leaks = {
    'the right option\'s words': await put(`/api/hub/questions/${Q.set}/hints/1`, { text: 'The answer is {1, 2}.' }),
    'its letter': await put(`/api/hub/questions/${Q.set}/hints/2`, { text: 'Go with option A.' }),
    'the value': await put(`/api/hub/questions/${Q.num}/hints/1`, { text: 'It has 3 elements.' }),
    'the claim\'s truth': await put(`/api/hub/questions/${Q.tf}/hints/1`, { text: 'The statement is false.' }),
  };
  for (const [what, r] of Object.entries(leaks)) {
    check(`a hint holding ${what}: 400, saying why`, r.status === 400 && /^This hint was not saved\. It gives the answer away: /.test(r.body.error), r.body.error);
  }
  check('and nothing was changed by them', (await repo.listQuestionHints([Q.set])).find((h) => h.step === 1).text === ladder[0]);
  check('a fourth step: 400', (await put(`/api/hub/questions/${Q.set}/hints/4`, { text: 'More.' })).status === 400);

  const fb = await put(`/api/hub/questions/${Q.set}/feedback/1`, { text: 'A set holds each element once, so {1, 1} is really the set {1}.' });
  const opt = fb.body.question?.options?.find((o) => o.optionIdx === 1);
  check('feedback on a wrong option: 201, on that option, approved', fb.status === 201 && opt?.feedback?.status === 'approved' && opt.option === '{1, 1}');
  check('feedback on the right answer: 400', (await put(`/api/hub/questions/${Q.set}/feedback/0`, { text: 'Well done.' })).status === 400);
  check('feedback on a numeric question: 400', (await put(`/api/hub/questions/${Q.num}/feedback/0`, { text: 'x' })).status === 400);
  check('hints on a poll: 400', (await put(`/api/hub/questions/${Q.poll}/hints/1`, { text: 'Think.' })).status === 400);
}

// ------------------------------------------------------------- AI drafts --

console.log('\nAI drafts: a stand-in model through the real parser; offline, none');
{
  const content = await repo.getContent(deckId);
  const out = await writeTutorDrafts(repo, {
    items: [{ question: await repo.getQuestion(Q.num), content }, { question: await repo.getQuestion(Q.tf), content }],
    viewer: { id: ID.profA },
    callModel: async () => JSON.stringify({ items: [
      { question: 'Q1', hints: [
        { step: 1, text: 'What does a set never hold twice?', slides: [1] },
        { step: 2, text: 'List the elements and count each one once.', slides: [1] },
        { step: 3, text: 'So it has 3 elements.', slides: [1] },
      ] },
      { question: 'Q2', hints: [{ step: 1, text: 'Is {1, 1} written with a repeat? What set is it really?', slides: [1, 2] }],
        feedback: [{ text: 'A set holds each element once; repeats are counted once.', slides: [1] }] },
    ] }),
  });
  check('the drafts are stored, and the leaking step 3 is refused with why', out.written === 4
    && out.skipped.some((s) => s.questionId === Q.num && s.what === 'hint 3' && /gave the answer away \(it holds the answer's value, 3\)/.test(s.why)),
  JSON.stringify(out.skipped));
  const listed = await get(`/api/hub/questions/${Q.num}/hints`);
  check('as AI drafts, labelled so, with the model named', listed.status === 200 && listed.body.question.hints.length === 2
    && listed.body.question.hints.every((h) => h.provenance === 'ai' && h.status === 'draft' && h.model === 'stand-in'
      && h.statusLabel === 'AI draft: not shown to students until approved'), JSON.stringify(listed.body.question?.hints));
  // A draft that holds the answer reaches the store some other way (here, directly): approval checks it again.
  await repo.addQuestionHint({ questionId: Q.tf, step: 3, text: 'So the statement is false.', provenance: 'ai', status: 'draft', model: 'stand-in' });

  const pressed = await post(`/api/hub/chapters/${deckId}/hints/generate`, {});
  check('on the professor\'s button with no model key: 202 at once, and a sentence saying none will be drafted', pressed.status === 202
    && pressed.body.state === 'running' && pressed.body.note === OFFLINE_NOTE
    && pressed.body.skipped.some((s) => s.questionId === Q.draft && /not approved/.test(s.why))
    && pressed.body.skipped.some((s) => s.questionId === Q.poll && /poll/.test(s.why)), JSON.stringify(pressed.body).slice(0, 400));
  const run = await settle(`/api/hub/hints/run/${pressed.body.runId}`);
  check('its run finishes with nothing written, readable by its owner only', run.body.run?.state === 'done' && run.body.run.written === 0
    && run.body.run.error.includes(OFFLINE_NOTE) && (await get(`/api/hub/hints/run/${pressed.body.runId}`, 'hod')).status === 404, JSON.stringify(run.body));
  check('the HOD may not press it: 403', (await post(`/api/hub/chapters/${deckId}/hints/generate`, {}, 'hod')).status === 403);
}

// ------------------------------------------------------- approval gating --

console.log('\nonly approved hints and feedback reach a student (H2, H13)');
{
  const before = await post('/api/hub/practice/hints', { attemptId: 'asha-num-0001', questionId: Q.num, topicId: T.Sets }, 'asha');
  check('a question with only AI drafts: no hint, and a plain sentence', before.status === 200 && before.body.hint === null
    && before.body.message === WHY.none, JSON.stringify(before.body));
  check('and nothing was recorded', (await repo.listHintViews({ accountId: ID.asha })).length === 0);
  check('the HOD may not approve: 403', (await post(`/api/hub/questions/${Q.num}/hints/approve`, {}, 'hod')).status === 403);
  const approved = await post(`/api/hub/questions/${Q.num}/hints/approve`, {});
  check('the owner approves the drafts', approved.status === 200 && approved.body.approved.length === 2
    && approved.body.question.hints.every((h) => h.status === 'approved' && h.statusLabel === 'Drafted by AI, approved by the professor'));
  const tf = await post(`/api/hub/questions/${Q.tf}/hints/approve`, {});
  check('approving checks each draft again: the one holding the answer is refused, with why; the rest approved', tf.status === 200
    && tf.body.approved.length === 2 && tf.body.refused.length === 1 && tf.body.refused[0].step === 3
    && /It gives the answer away: it says the statement is false\./.test(tf.body.refused[0].why), JSON.stringify(tf.body.refused));
  const after = await post('/api/hub/practice/hints', { attemptId: 'asha-num-0001', questionId: Q.num, topicId: T.Sets }, 'asha');
  check('once approved, the student opens the first: 201, a nudge, labelled as written with AI help', after.status === 201
    && after.body.hint.kind === 'nudge' && after.body.hint.byLabel === 'Written with AI help and checked by your professor.', JSON.stringify(after.body));
}

// ------------------------------------------------------------- practice --

console.log('\npractice: hints one at a time, recorded, and counted on the answer (H13)');
{
  tick();
  const next = await get(`/api/hub/practice/next?topicId=${T.Sets}`, 'asha');
  check('the next question says how many hints it has and that each is noted, and holds no key', next.status === 200
    && next.body.hints.available > 0 && /noted with your answer/.test(next.body.hints.note) && !KEYS_BEFORE.test(JSON.stringify(next.body)),
  JSON.stringify(next.body.hints));
  tick();
  const path = '/api/hub/practice/hints';
  const ask = (body = {}, as = 'asha') => post(path, { attemptId: 'asha-set-0001', questionId: Q.set, topicId: T.Sets, ...body }, as);
  const one = await ask();
  check('hint 1: 201, the nudge, with its slides and who wrote it, and nothing that tells the answer', one.status === 201
    && one.body.hint.position === 1 && one.body.hint.kind === 'nudge' && one.body.hint.cite === 'Slides 1 and 2'
    && one.body.hint.byLabel === 'Written by your professor.' && one.body.hintsUsed === 1 && one.body.remaining === 2
    && one.body.why === WHY.plain && !KEYS_BEFORE.test(one.text), one.text.slice(0, 300));
  const two = await ask();
  check('hint 2: the strategy', two.status === 201 && two.body.hint.kind === 'strategy' && two.body.hintsUsed === 2);
  const again = await ask({ step: 1 });
  check('asking for hint 1 again: 200, the same hint, nothing new recorded', again.status === 200 && again.body.duplicate === true
    && again.body.hint.text === one.body.hint.text && (await repo.listHintViews({ clientAttemptId: 'asha-set-0001' })).length === 2);
  check('asking for hint 4 out of turn: 400', (await ask({ step: 4 })).status === 400);
  const three = await ask({ step: 3 });
  const done = await ask();
  check('hint 3, the worked step; then no more, said plainly', three.status === 201 && three.body.hint.kind === 'worked'
    && three.body.remaining === 0 && done.status === 200 && done.body.hint === null && /last hint/.test(done.body.message));
  const reload = await get(`${path}?attemptId=asha-set-0001&questionId=${Q.set}&topicId=${T.Sets}`, 'asha');
  check('a screen that reloads reads the three it opened', reload.status === 200 && reload.body.hints.map((h) => h.kind).join() === 'nudge,strategy,worked'
    && reload.body.remaining === 0);
  const views = await repo.listHintViews({ clientAttemptId: 'asha-set-0001' });
  check('each hint opened is a row: the attempt id, the mode, its place, the words shown, the plan', views.length === 3
    && views.every((v) => v.mode === 'practice' && v.accountId === ID.asha && v.questionId === Q.set && v.topicId === T.Sets && v.text)
    && views.map((v) => v.position).join() === '1,2,3' && views[0].plan.items.length === 3);

  tick();
  const answered = await post('/api/hub/practice/attempts', { attemptId: 'asha-set-0001', questionId: Q.set, topicId: T.Sets, response: 1, timeTakenMs: 9000 }, 'asha');
  check('the answer: wrong, recording the 3 hints opened, with the feedback on the option chosen after it', answered.status === 201
    && answered.body.correct === false && answered.body.attempt.hintsUsed === 3 && answered.body.optionFeedback?.length === 1
    && answered.body.optionFeedback[0].option === '{1, 1}' && answered.body.optionFeedback[0].cite === 'Slides 1 and 2', JSON.stringify(answered.body).slice(0, 400));
  check('the stored attempt says 3 hints', (await repo.getHubAttemptByKey(ID.asha, 'asha-set-0001')).hintsUsed === 3);
  const late = await ask();
  check('after the answer, its hints are closed: 409', late.status === 409 && /answered already/.test(late.body.error));

  tick();
  const back = await ask({ attemptId: 'asha-set-0002' });
  check('the question again: the feedback on the option chosen comes first, in place of the nudge, and says why', back.status === 201
    && back.body.hint.kind === 'feedback' && back.body.hint.label === 'About the option you chose last time' && back.body.why === WHY.feedback
    && /\{1, 1\} is really the set \{1\}/.test(back.body.hint.text), JSON.stringify(back.body));
  const then = await ask({ attemptId: 'asha-set-0002' });
  check('then the ladder past the hints that were not enough last time: the worked step', then.body.hint?.kind === 'worked' && then.body.remaining === 0,
    JSON.stringify(then.body));
  const other = await post(path, { attemptId: 'asha-set-0002', questionId: Q.num, topicId: T.Sets }, 'asha');
  check('the same attempt id for another question: 409', other.status === 409);
}

console.log('\nnever in a self-test or Get Ready (H9, H10)');
{
  const path = '/api/hub/practice/hints';
  const exam = await post(path, { attemptId: 'asha-exam-0001', questionId: Q.set, topicId: T.Sets, mode: 'exam' }, 'asha');
  const ready = await post(path, { attemptId: 'asha-ready-0001', questionId: Q.set, topicId: T.Sets, mode: 'getready' }, 'asha');
  check('mode exam: 400, no hints in a self-test', exam.status === 400 && /No hints in a self-test/.test(exam.body.error), JSON.stringify(exam.body));
  check('mode getready: 400, no hints in Get Ready', ready.status === 400 && /No hints in Get Ready/.test(ready.body.error), JSON.stringify(ready.body));
  check('nothing recorded for either', (await repo.listHintViews({ accountId: ID.asha })).every((v) => !/exam|ready/.test(v.clientAttemptId)));
  const asha = { id: ID.asha, role: 'student', reportsTo: ID.profA, rollNo: '21cs01', active: true };
  const offered = await Promise.all(['exam', 'getready'].map((mode) => hintsOffered(repo, { account: asha, question: QSET, topicId: T.Sets, mode })));
  check('the hook offers none in either mode', offered.every((o) => o.available === 0), JSON.stringify(offered));
  // Hints opened in practice under an id that a self-test then uses: the self-test's attempt still records none.
  await post(path, { attemptId: 'asha-mixed-0001', questionId: Q.tf, topicId: T.Sets }, 'asha');
  const used = await hintsUsedOn(repo, { account: asha, questionId: Q.tf, attemptId: 'asha-mixed-0001', mode: 'exam' });
  const { attempt } = await recordAttempt(repo, asha, { attemptId: 'asha-mixed-0001', questionId: Q.tf, topicId: T.Sets, response: false, mode: 'exam' },
    { hintsUsed: used });
  check('a self-test attempt records 0 hints, whatever was opened under its id', used === 0 && attempt.hintsUsed === 0 && attempt.mode === 'exam');
  tick();
  const review = await post(path, { attemptId: 'asha-review-0001', questionId: Q.num, topicId: T.Sets, mode: 'review' }, 'asha');
  check('a review set offers them, as practice does', review.status === 201 && (await repo.listHintViews({ clientAttemptId: 'asha-review-0001' }))[0]?.mode === 'review');
}

// --------------------------------------------------------------- lessons --

console.log('\na lesson\'s questions offer hints too, recorded in mode lesson');
let lessonId;
{
  const started = await post(`/api/hub/topics/${T.Sets}/lessons/generate`, {});
  await settle(`/api/hub/lessons/run/${started.body.runId}`);
  const [draft] = (await get(`/api/hub/topics/${T.Sets}/lessons`)).body.drafts ?? [];
  const draftHint = await post(`/api/hub/lessons/${draft?.id}/questions/${Q.set}/hints`, { attemptId: 'bilal-lesson-0000' }, 'bilal');
  check('a draft lesson\'s question: the lesson\'s 404', JSON.stringify(draftHint.body) === NO_LESSON, JSON.stringify(draftHint.body));
  await post(`/api/hub/lessons/${draft?.id}/approve`, {});
  lessonId = draft?.id;
  const read = await get(`/api/hub/topics/${T.Sets}/lesson`, 'bilal');
  const q = read.body.lesson?.steps?.find((s) => s.type === 'questions')?.questions?.find((x) => x._id === Q.set);
  check('the student\'s lesson: its question says how many hints it has, with no key', q?.hints?.available === 3 && !KEYS_BEFORE.test(JSON.stringify(read.body)),
    JSON.stringify(q?.hints));
  const preview = await get(`/api/hub/topics/${T.Sets}/lesson`);
  const pq = preview.body.lesson?.steps?.find((s) => s.type === 'questions')?.questions?.[0];
  check('the professor\'s preview opens none, and says so', pq?.hints?.available === 0 && /student sees the hints/.test(pq?.hints?.note ?? ''));
  const opened = await post(`/api/hub/lessons/${lessonId}/questions/${Q.set}/hints`, { attemptId: 'bilal-lesson-0001' }, 'bilal');
  check('a hint opened in the lesson: 201, the nudge', opened.status === 201 && opened.body.hint.kind === 'nudge');
  const answer = await post(`/api/hub/lessons/${lessonId}/questions/${Q.set}/attempts`, { attemptId: 'bilal-lesson-0001', response: 3 }, 'bilal');
  const row = await repo.getHubAttemptByKey(ID.bilal, 'bilal-lesson-0001');
  check('the lesson\'s answer records the hint opened, in mode lesson', answer.status === 201 && row?.mode === 'lesson' && row.hintsUsed === 1,
    JSON.stringify({ status: answer.status, row: row && { mode: row.mode, hints: row.hintsUsed } }));
  check('and no feedback after it on an option that has none ([1, 2] has none)', Array.isArray(answer.body.optionFeedback) && answer.body.optionFeedback.length === 0);
  check('staff do not open a lesson\'s hints: 403', (await post(`/api/hub/lessons/${lessonId}/questions/${Q.set}/hints`, { attemptId: 'prof-lesson-0001' })).status === 403);
  check('a student never on the roster: the lesson\'s 404, word for word',
    JSON.stringify((await post(`/api/hub/lessons/${lessonId}/questions/${Q.set}/hints`, { attemptId: 'cara-lesson-0001' }, 'cara')).body) === NO_LESSON);
}

// ------------------------------------------------------------- languages --

console.log('\nlanguages: an approved Hindi hint; never one that gives the answer away (H12)');
{
  await put('/api/hub/language', { language: 'hi' }, 'bilal');
  // Bilal answered this question wrong in the lesson after one hint, so his
  // hints now start at the strategy: that is the one translated well here, and
  // the worked step is translated so that it gives the answer away.
  const rows = await repo.listQuestionHints([Q.set]);
  const strategy = rows.find((h) => h.step === 2);
  const worked = rows.find((h) => h.step === 3);
  const write = (row, words) => post('/api/hub/translations', { itemKind: 'hint', itemId: String(row._id), language: 'hi', fields: { hint: words } });
  const hi = await write(strategy, 'हर विकल्प में दोहराया गया element देखें, फिर उसके brackets देखें।');
  const bad = await write(worked, 'उत्तर {1, 2} है, बाकी को छोड़ दें।');
  check('the professor writes Hindi hints by hand: drafts', hi.status === 201 && bad.status === 201 && hi.body.translation.status === 'draft');
  const ok1 = await post(`/api/hub/translations/${hi.body.translation.id}/approve`, { confirmFlags: true });
  const ok2 = await post(`/api/hub/translations/${bad.body.translation.id}/approve`, { confirmFlags: true });
  check('and approves them', ok1.status === 200 && ok2.status === 200, JSON.stringify([ok1.body, ok2.body]));
  const listed = await get(`/api/hub/chapters/${deckId}/translations?language=hi`);
  check('the chapter\'s translations list hints and feedback as items', listed.status === 200
    && listed.body.items.some((i) => i.kind === 'hint') && listed.body.items.some((i) => i.kind === 'feedback'));
  tick();
  const first = await post('/api/hub/practice/hints', { attemptId: 'bilal-hi-0001', questionId: Q.set, topicId: T.Sets }, 'bilal');
  check('his lesson answer counts: wrong after one hint, so his hints start at the strategy, and he is told why',
    first.status === 201 && first.body.hint.kind === 'strategy' && first.body.why === WHY.question(1), JSON.stringify(first.body));
  check('Bilal, who chose Hindi, reads the approved Hindi hint', first.body.hint?.language === 'hi' && /विकल्प/.test(first.body.hint.text),
    JSON.stringify(first.body.hint));
  const second = await post('/api/hub/practice/hints', { attemptId: 'bilal-hi-0001', questionId: Q.set, topicId: T.Sets }, 'bilal');
  check('a Hindi hint that would give the answer away is never shown: English, with a plain note', second.status === 201
    && second.body.hint.kind === 'worked' && second.body.hint.language === 'en' && second.body.hint.text === worked.text
    && /not in Hindi yet/.test(second.body.hint.languageNote ?? ''), JSON.stringify(second.body.hint));
  const views = await repo.listHintViews({ clientAttemptId: 'bilal-hi-0001' });
  check('what was shown, in which language, is what is recorded', views.map((v) => v.language).join() === 'hi,en' && views[1].text === worked.text);
}

console.log('\nhints used are the hints opened on the question since the last answer, under any attempt id (H13)');
{
  // Bilal opened two hints on this question under 'bilal-hi-0001' (above) and answers under another id.
  tick();
  const answered = await post('/api/hub/practice/attempts', { attemptId: 'bilal-hi-0002', questionId: Q.set, topicId: T.Sets, response: 1 }, 'bilal');
  check('the answer records the two hints, though they were opened under another id', answered.status === 201 && answered.body.attempt.hintsUsed === 2
    && (await repo.getHubAttemptByKey(ID.bilal, 'bilal-hi-0002')).hintsUsed === 2, JSON.stringify(answered.body.attempt));
  tick();
  const again = await post('/api/hub/practice/attempts', { attemptId: 'bilal-hi-0003', questionId: Q.set, topicId: T.Sets, response: 1 }, 'bilal');
  check('the next answer counts none of them again', again.status === 201 && again.body.attempt.hintsUsed === 0, JSON.stringify(again.body.attempt));
}

// ------------------------------------------------------- who is refused --

console.log('\nwho is refused (H1): the same 404, word for word');
{
  const path = '/api/hub/practice/hints';
  const refusals = {
    'another professor\'s student with the same roll number': await post(path, { attemptId: 'omar-0000001', questionId: Q.set, topicId: T.Sets }, 'omar'),
    'a student never on the roster': await post(path, { attemptId: 'cara-0000001', questionId: Q.set, topicId: T.Sets }, 'cara'),
  };
  for (const [who, r] of Object.entries(refusals)) check(`${who}: the topic's 404`, r.status === 404 && JSON.stringify(r.body) === NO_TOPIC, `${r.status} ${r.text}`);
  const q404 = [await post(path, { attemptId: 'asha-draft-0001', questionId: Q.draft, topicId: T.Sets }, 'asha'),
    await post(path, { attemptId: 'asha-poll-0001', questionId: Q.poll, topicId: T.Sets }, 'asha'),
    await post(path, { attemptId: 'asha-rel-0001', questionId: Q.set, topicId: T.Relations }, 'asha')];
  check('a draft, a poll, or a question sent under another topic: the question\'s 404', q404.every((r) => r.status === 404 && r.text === NO_QUESTION),
    q404.map((r) => r.status).join(','));
  const staff = [await get(`/api/hub/questions/${Q.set}/hints`, 'profB'), await put(`/api/hub/questions/${Q.set}/hints/1`, { text: 'x' }, 'profB'),
    await get(`/api/hub/questions/${Q.set}/hints`, 'hodOther'), await post(`/api/hub/questions/${Q.set}/hints/approve`, {}, 'profB')];
  check('another professor, another department\'s HOD: the question\'s 404, never 403', staff.every((r) => r.status === 404 && r.text === NO_QUESTION),
    staff.map((r) => `${r.status} ${r.text}`).join(' | '));
  const chapter = await get(`/api/hub/chapters/${deckId}/hints`, 'profB');
  check('and the chapter\'s 404', chapter.status === 404 && chapter.body.error === 'That chapter was not found.');
}

// ------------------------------------------------------------ staff read --

console.log('\nstaff read the chapter\'s hints, and how often each was opened');
{
  const hod = await get(`/api/hub/chapters/${deckId}/hints`, 'hod');
  check('the HOD reads it, read-only', hod.status === 200 && hod.body.canEdit === false);
  check('the HOD writes nothing: 403', (await put(`/api/hub/questions/${Q.set}/hints/1`, { text: 'Look at the first slide again.' }, 'hod')).status === 403
    && (await del(`/api/hub/questions/${Q.set}/hints/1`, 'hod')).status === 403);
  const view = await get(`/api/hub/chapters/${deckId}/hints`);
  const set = view.body.questions?.find((q) => q.questionId === Q.set);
  check('per question: the ladder with how often each was opened, feedback per wrong option, counts', view.status === 200
    && set.hints[0].opened >= 2 && set.options.find((o) => o.optionIdx === 1).feedback.opened === 1 && set.counts.hints.approved === 3
    && !view.body.questions.some((q) => q.questionId === Q.poll), JSON.stringify(set?.counts));
  check('the notes say plainly what a student is shown, and when', /never in a self-test or Get Ready/.test(view.body.notes.modes)
    && /recorded with their answer/.test(view.body.notes.order));
  const progress = await get(`/api/hub/classes/${classId}/progress`);
  const ashaRow = progress.body.students?.find((s) => s.rollNo === '21CS01');
  check('the class\'s progress counts each student\'s hints opened on their answers, as counts only', progress.status === 200
    && ashaRow?.activity?.hintsUsed === 3 && ashaRow.activity.attemptsWithHints === 1, JSON.stringify(ashaRow?.activity));
  const removed = await del(`/api/hub/questions/${Q.num}/hints/2`);
  check('the owner removes a step: 200, then 404 for a second removal', removed.status === 200 && (await del(`/api/hub/questions/${Q.num}/hints/2`)).status === 404);
}

// ------------------------------------------------- nothing else moved --

console.log('\nnothing else moves (H5)');
{
  check('no answers row, and attainment and the register read the same', (await untouched()) === before);
  check('hub attempts are the only answers kept here', (await repo.listAnswers({})).length === 0);
}

console.log('\nwithout Supabase');
{
  const saved = config.supabase.url;
  config.supabase.url = '';
  const r = await post('/api/hub/practice/hints', { attemptId: 'asha-none-0001', questionId: Q.set, topicId: T.Sets }, 'asha');
  config.supabase.url = saved;
  check('the tutor answers 503, saying accounts are not set up', r.status === 503 && /accounts/.test(r.body.error ?? ''), JSON.stringify(r.body));
}

io.close();
server.close();

// ----------------------------------------------------------- boot probe --

console.log('\nthe boot probe names 0029 when it is missing, and rooms keep Supabase');
{
  const boot = async (missing) => {
    schemaMissing = missing;
    const lines = [];
    await initStore({ log: (l) => lines.push(l) });
    return { lines, kind: getRepo().kind };
  };
  const without = await boot(['question_hints', 'option_feedback', 'hub_hint_views']);
  check('the tutor\'s tables missing: Supabase is kept, and the log names 0029 and what fails',
    without.kind === 'supabase'
    && without.lines.some((l) => /WARNING: the question_hints table is missing: apply supabase\/migrations\/0029_hub_tutor\.sql .*no hint can be written/.test(l))
    && without.lines.some((l) => /WARNING: the option_feedback table is missing: apply supabase\/migrations\/0029_hub_tutor\.sql/.test(l))
    && without.lines.some((l) => /WARNING: the hub_hint_views table is missing: apply supabase\/migrations\/0029_hub_tutor\.sql .*recorded with the answer/.test(l)),
    without.lines.join(' | '));
  const whole = await boot([]);
  check('with everything there, no warning', whole.kind === 'supabase' && !whole.lines.some((l) => /WARNING|missing/.test(l)), whole.lines.join(' | '));
  schemaMissing = null;
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.fetch = realFetch;
globalThis.Date = RealDate;
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
