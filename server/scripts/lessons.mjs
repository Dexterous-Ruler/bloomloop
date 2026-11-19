// Phase 6: lessons from the professor's slides and the English/Hindi/Marathi
// switch, end to end (decisions H11 and H12, under decisions 1 and 5).
//
//   node server/scripts/lessons.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, and checks:
//
//   accounts only   no token is a 401, the teacher key reaches nothing, and a
//                   server without Supabase answers 503
//   lessons         on the professor's button, in the background (202 and a
//                   run): with no model key a "slides only" lesson of the
//                   professor's own slide text, cited slide by slide, and the
//                   topic's approved questions; a draft reaches no student; once
//                   approved a rostered student reads it, with no key; an older
//                   deck and pasted text say where their text came from
//   AI drafts       a lesson written by a stand-in model (in process, through
//                   the real parser) puts its questions into the bank as drafts,
//                   which students see only once approved in the bank
//   regenerating    keeps the approved lesson serving until the new one is
//                   approved; approving it retires the old; a draft is discarded
//   who sees what   an HOD reads and is refused every write; another professor,
//                   a removed student, a student never on the roster and another
//                   professor's student get the same 404, word for word
//   languages       a student chooses Hindi; with no approved translation they
//                   read English with a plain note; the check refuses a dropped
//                   option and holds a changed number for the professor; once
//                   approved the question and the lesson read in Hindi; an edit
//                   to the English puts it back to English
//   attempts        while no attempt store is connected an answer is refused
//                   (503), never taken and lost; connected to practice's store
//                   (hub_attempts), it records the language actually shown and
//                   the mode, is idempotent by the device's attempt id, and the
//                   key comes only after; it counts in the student's progress and
//                   error log like any hub attempt; no room evidence is written;
//                   statistics split by language
//   explanations    one written in practice is translated like any item, and a
//                   student who chose Hindi reads it after a practice answer;
//                   practice's next question carries the language and its note
//   boot probe      a database without 0027 keeps Supabase, and the log names
//                   the file and what fails until it is applied
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As
// server/scripts/hub.mjs, roster.mjs and decisions.mjs do, the server is pointed
// at http://supabase.invalid and every request to it is answered here,
// in-process; any other request off this machine is refused and counted.
// Never calls Gemini, Supabase or any network service. Exits non-zero on any
// failure.

import http from 'node:http';
import AdmZip from 'adm-zip';
import { Server } from 'socket.io';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { writeLessonDraft } = await import(`${SRC}services/hubLessons.js`);
const { OFFLINE_NOTE } = await import(`${SRC}services/hubLanguages.js`);
const { connectAttemptStore, NOT_CONNECTED, PRACTICE_STORE } = await import(`${SRC}services/hubAttemptBridge.js`);

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
// HOD (CSE) <- professor A <- Asha (21CS01, on the roster), Bilal (21CS02,
// removed from it), Cara (21CS03, never on it). Another HOD (ECE) <- professor
// B <- Omar, who also holds roll number 21CS01, on B's roster.

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
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-LSN0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
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
    throw new Error(`lessons.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by lessons.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'lessons-test-service-key';

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
  return { status: res.status, body: parsed };
}
const get = (path, as) => call('GET', path, { as });
// Batch 8: practice and lesson answers carry the serve token the hub's reply gave
// (services/serveTokens.js). This script tests other things, so it signs the
// token the server would have sent; server/scripts/zipgaps2.mjs tests the token itself.
const { serveToken: signServed } = await import(`${SRC}services/serveTokens.js`);
const served = (path, body, as) => {
  if (!body || typeof body !== 'object' || body.serveToken !== undefined || !ID[as]) return body;
  const lesson = /^\/api\/hub\/lessons\/[^/]+\/questions\/([^/]+)\/attempts$/.exec(path);
  if (lesson) return { ...body, serveToken: signServed({ accountId: ID[as], questionId: lesson[1], mode: 'lesson' }) };
  if (path === '/api/hub/practice/attempts' && body.questionId) {
    return { ...body, serveToken: signServed({ accountId: ID[as], questionId: body.questionId, mode: body.mode ?? 'practice' }) };
  }
  return body;
};
const post = (path, body, as) => call('POST', path, { body: served(path, body, as), as });
const put = (path, body, as) => call('PUT', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });

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

async function upload(name, slides, as = 'profA') {
  const form = new FormData();
  form.append('file', new Blob([deck(slides)]), name);
  const res = await fetch(`${base}/api/content?ocr=off`, { method: 'POST', headers: { authorization: `Bearer ${TOKENS[as]}` }, body: form });
  return { status: res.status, body: await res.json() };
}

const NO_TOPIC = JSON.stringify({ error: 'That topic was not found.' });
const NO_LESSON = JSON.stringify({ error: 'That lesson was not found.' });
const KEYS = /answerIdx|answerBool|"accept"|rubric|"solution"|misconception/;

// ---------------------------------------------------------- accounts only --

console.log('\naccounts only (H1)');
{
  check('no credentials: 401', (await get('/api/hub/language', null)).status === 401);
  check('the shared teacher key reaches nothing here: 401', (await get('/api/hub/topics/0123456789abcdef01234567/lessons', 'key')).status === 401);
}

// --------------------------------------------------------------- material --

console.log('\nmaterial, a class and its roster');

const SLIDES = [
  ['Sets', 'A set is a collection of distinct objects.', 'Membership is written $x \\in S$.'],
  ['Sets', 'The empty set has 0 elements.', 'The set {1, 2, 3} has 3 elements.'],
  ['Relations', 'A relation pairs elements of two sets.'],
];
const up = await upload('Discrete structures.pptx', SLIDES);
const deckId = up.body.contentId;
check('a deck uploads with its slides\' own words', up.status === 201 && (await repo.getContent(deckId)).slideTexts?.length === 3);
const records = await repo.listChapterTopics(deckId);
const T = Object.fromEntries(records.map((t) => [t.name, String(t._id)]));
check('its topics are records', Boolean(T.Sets && T.Relations), JSON.stringify(Object.keys(T)));

// The bank's questions on Sets: two approved (one names numbers), a draft, a poll.
const [QSET, QNUM, QDRAFT] = await repo.insertQuestions([
  { contentId: deckId, topic: 'Sets', text: 'Which of these is a set?', kind: 'mcq', options: ['{1, 1}', '{1, 2}', '(1, 2)', '[1, 2]'], answerIdx: 1,
    bloom: 'remember', source: 'teacher', status: 'active' },
  { contentId: deckId, topic: 'Sets', text: 'How many elements has {1, 2, 3}?', kind: 'mcq', options: ['1', '2', '3', '4'], answerIdx: 2,
    bloom: 'remember', source: 'teacher', status: 'active' },
  { contentId: deckId, topic: 'Sets', text: 'A draft nobody approved', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0,
    bloom: 'remember', source: 'llm', model: 'm', status: 'draft' },
  { contentId: deckId, topic: 'Sets', text: 'How sure are you?', kind: 'poll', options: ['Sure', 'Not sure'], bloom: 'remember', source: 'teacher', status: 'active' },
]);

const older = await repo.createContent({
  title: 'Logic', kind: 'pptx', ownerId: ID.profA, topics: ['Propositions', 'Truth tables'], topicSlides: { Propositions: [1], 'Truth tables': [2] },
  rawText: 'Propositions\nA proposition is true or false.\n\nTruth tables\nA table lists every case.',
});
const pasted = (await post('/api/content', { title: 'Proofs', text: 'Direct proof\nAssume P and show Q.\nInduction\nA base case and a step.' })).body.contentId;

const classId = (await post('/api/classes', { courseName: 'Discrete Maths', section: 'SY A' })).body.class.id;
await post(`/api/classes/${classId}/students`, { students: [{ roll: '21CS01', name: 'Asha' }, { roll: '21CS02', name: 'Bilal' }] });
{
  const bilalRow = (await repo.listClassStudents(classId)).find((s) => s.rollNo === '21CS02');
  await call('DELETE', `/api/classes/${classId}/students/${bilalRow._id}`);
}
const theirClass = (await post('/api/classes', { courseName: 'Signals', section: 'EC A' }, 'profB')).body.class.id;
await post(`/api/classes/${theirClass}/students`, { students: [{ roll: '21CS01', name: 'Omar' }] }, 'profB');
for (const id of [deckId, older._id, pasted]) await put(`/api/hub/classes/${classId}/chapters/${id}`, {});
const OLD = Object.fromEntries((await repo.listChapterTopics(older._id)).map((t) => [t.name, String(t._id)]));
const PASTED = Object.fromEntries((await repo.listChapterTopics(pasted)).map((t) => [t.name, String(t._id)]));
check('the chapters are on the class, with topic records', Boolean(OLD.Propositions && PASTED.Induction));

// ------------------------------------------------------- a slides-only lesson --

console.log('\na lesson on the professor\'s button, with no model key: slides only (H11)');
let v1;
{
  const started = await post(`/api/hub/topics/${T.Sets}/lessons/generate`, {});
  check('the button answers at once: 202, a run, and a sentence saying it is slides only',
    started.status === 202 && started.body.state === 'running' && /slides-only lesson/.test(started.body.note), JSON.stringify(started.body));
  const run = await settle(`/api/hub/lessons/run/${started.body.runId}`);
  check('the run finishes, readable by its owner only', run.body.run?.state === 'done'
    && (await get(`/api/hub/lessons/run/${started.body.runId}`, 'hod')).status === 404, JSON.stringify(run.body));
  const list = await get(`/api/hub/topics/${T.Sets}/lessons`);
  v1 = list.body.drafts?.[0];
  check('the staff list: one draft, nothing serving', list.status === 200 && list.body.serving === null && list.body.drafts.length === 1);
  check('it is slides only, a draft, and says students do not see it yet',
    v1.source === 'slides' && v1.status === 'draft' && /Slides only, not yet approved/.test(v1.statusLabel) && v1.model === null);
  check('its text is the slides\' own words, cited slide by slide',
    v1.steps[0].type === 'chunk' && v1.steps[0].cite === 'Slides 1 and 2' && v1.steps[0].text.includes('The set {1, 2, 3} has 3 elements.')
    && v1.basis.perSlideText === true, JSON.stringify(v1.steps[0]));
  check('no generated prose, and only the topic\'s approved questions that are answered at once',
    !v1.steps.some((s) => s.type === 'example')
    && JSON.stringify(v1.steps.find((s) => s.type === 'questions').questions.map((q) => q.id)) === JSON.stringify([String(QSET._id), String(QNUM._id)]));
  const busy = await post(`/api/hub/topics/${T.Sets}/lessons/generate`, {});
  const settled = await settle(`/api/hub/lessons/run/${busy.body.runId}`);
  check('a second press makes a second draft, numbered after the first', settled.body.run?.state === 'done'
    && (await repo.listTopicLessons({ topicId: T.Sets })).map((l) => l.version).join() === '1,2');
  const v2 = (await repo.listTopicLessons({ topicId: T.Sets })).find((l) => l.version === 2);
  const discarded = await post(`/api/hub/lessons/${v2._id}/discard`, {});
  check('the owner discards a draft', discarded.status === 200 && discarded.body.lesson.status === 'discarded' && /never saw it/.test(discarded.body.message));
  check('a discarded lesson cannot be approved: 409', (await post(`/api/hub/lessons/${v2._id}/approve`, {})).status === 409);
}

console.log('\na draft reaches no student; approved, it does (H2)');
{
  const before = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  check('a rostered student sees no lesson while it is a draft, and a plain sentence', before.status === 200 && before.body.lesson === null
    && /not published a lesson/.test(before.body.empty));
  const approved = await post(`/api/hub/lessons/${v1.id}/approve`, {});
  check('the owner approves it', approved.status === 200 && approved.body.lesson.status === 'approved' && /Students on your classes now read/.test(approved.body.message));
  const read = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  const lesson = read.body.lesson;
  check('the student reads it: the slides in steps, cited, with the formula rendered', read.status === 200
    && lesson.steps[0].type === 'chunk' && lesson.steps[0].cite === 'Slides 1 and 2' && /<math>/.test(lesson.steps[0].html)
    && lesson.label === 'Your professor\'s slides, in short steps.', JSON.stringify(lesson).slice(0, 300));
  const qs = lesson.steps.find((s) => s.type === 'questions')?.questions ?? [];
  check('its questions as a phone sees them: the professor\'s approved ones, no key, no draft, with who wrote them',
    qs.length === 2 && qs.every((q) => q.provenance?.text === 'Written by your professor.') && !KEYS.test(JSON.stringify(read.body))
    && !/A draft nobody approved|How sure/.test(JSON.stringify(read.body)), JSON.stringify(qs).slice(0, 300));
  check('field by field: no status, model, warning, basis or slide numbers list', JSON.stringify(Object.keys(lesson).sort())
    // 'sections' (Batch 8): the concept panel, empty for a slides-only lesson and saying so.
    === '["answering","approvedAt","id","label","language","sections","steps","version"]' && lesson.answering === true);
}

// ------------------------------------------------------------ who sees what --

console.log('\nwho sees what (H1, H2)');
{
  const lessonId = v1.id;
  const others = {
    'a student removed from the roster': await get(`/api/hub/topics/${T.Sets}/lesson`, 'bilal'),
    'a student never on the roster': await get(`/api/hub/topics/${T.Sets}/lesson`, 'cara'),
    'another professor\'s student with the same roll number': await get(`/api/hub/topics/${T.Sets}/lesson`, 'omar'),
    'another professor': await get(`/api/hub/topics/${T.Sets}/lessons`, 'profB'),
    'another department\'s HOD': await get(`/api/hub/topics/${T.Sets}/lesson`, 'hodOther'),
    'a topic that does not exist': await get('/api/hub/topics/0123456789abcdef01234567/lesson', 'asha'),
  };
  for (const [who, r] of Object.entries(others)) {
    check(`${who}: the same 404, word for word`, r.status === 404 && JSON.stringify(r.body) === NO_TOPIC, `${r.status} ${JSON.stringify(r.body)}`);
  }
  check('another professor on a lesson: the lesson\'s 404, word for word, on reads and writes alike',
    [await get(`/api/hub/lessons/${lessonId}`, 'profB'), await post(`/api/hub/lessons/${lessonId}/approve`, {}, 'profB'),
      await post(`/api/hub/topics/${T.Sets}/lessons/generate`, {}, 'profB')]
      .every((r, i) => r.status === 404 && (i === 2 || JSON.stringify(r.body) === NO_LESSON)));
  const hodRead = await get(`/api/hub/topics/${T.Sets}/lessons`, 'hod');
  check('the HOD reads the department\'s lessons, and may not change them', hodRead.status === 200 && hodRead.body.canEdit === false
    && hodRead.body.serving?.id === lessonId);
  const hodWrites = [
    await post(`/api/hub/topics/${T.Sets}/lessons/generate`, {}, 'hod'),
    await post(`/api/hub/lessons/${lessonId}/approve`, {}, 'hod'),
    await post(`/api/hub/lessons/${lessonId}/discard`, {}, 'hod'),
    await post(`/api/hub/chapters/${deckId}/translations/generate`, {}, 'hod'),
    await post('/api/hub/translations', { itemKind: 'question', itemId: String(QSET._id), language: 'hi', fields: { text: 'x' } }, 'hod'),
  ];
  check('every write by the HOD is a 403', hodWrites.every((r) => r.status === 403), hodWrites.map((r) => r.status).join(','));
  const studentStaff = [
    await get(`/api/hub/topics/${T.Sets}/lessons`, 'asha'),
    await get(`/api/hub/lessons/${lessonId}`, 'asha'),
    await post(`/api/hub/topics/${T.Sets}/lessons/generate`, {}, 'asha'),
    await post(`/api/hub/lessons/${lessonId}/approve`, {}, 'asha'),
    await get(`/api/hub/chapters/${deckId}/translations`, 'asha'),
    await get(`/api/hub/chapters/${deckId}/languages`, 'asha'),
    await post('/api/hub/translations', {}, 'asha'),
  ];
  check('a student on any staff route: 403 before anything is read', studentStaff.every((r) => r.status === 403), studentStaff.map((r) => r.status).join(','));
  const preview = await get(`/api/hub/topics/${T.Sets}/lesson`);
  check('the owner previews the lesson as a student reads it', preview.status === 200 && preview.body.lesson?.id === lessonId && /as a student/.test(preview.body.preview));
}

// --------------------------------------------------------- older material --

console.log('\nwhere an older deck\'s and pasted text\'s lessons come from (H4)');
{
  const a = await post(`/api/hub/topics/${OLD.Propositions}/lessons/generate`, {});
  await settle(`/api/hub/lessons/run/${a.body.runId}`);
  const oldList = await get(`/api/hub/topics/${OLD.Propositions}/lessons`);
  const oldLesson = oldList.body.drafts?.[0];
  check('an older deck: the chapter\'s text about the topic, citing its slides together, and saying so',
    oldLesson?.basis?.from === 'chapter-slides' && /uploaded before each slide's words were kept/.test(oldLesson.basis.note)
    && oldLesson.steps[0].cite === 'Slide 1' && !/Truth tables/.test(oldLesson.steps[0].text), JSON.stringify(oldLesson?.steps?.[0]));
  const b = await post(`/api/hub/topics/${PASTED.Induction}/lessons/generate`, {});
  await settle(`/api/hub/lessons/run/${b.body.runId}`);
  const pastedLesson = (await get(`/api/hub/topics/${PASTED.Induction}/lessons`)).body.drafts?.[0];
  check('pasted text: the topic\'s section, citing no slide, and saying so', pastedLesson?.basis?.from === 'chapter-text'
    && /pasted as text/.test(pastedLesson.basis.note) && pastedLesson.steps[0].cite === null
    && pastedLesson.steps[0].text === 'Induction\nA base case and a step.', JSON.stringify(pastedLesson?.steps?.[0]));
  check('a topic with no question approved says how to add some', /No approved question on this topic yet/.test(pastedLesson.warnings.join(' ')));
}

// ------------------------------------------------------------ languages --

console.log('\nthe language switch (H12)');
const SHOWN = {};
{
  const mine = await get('/api/hub/language', 'asha');
  check('a student\'s language starts as English, with the three choices', mine.status === 200 && mine.body.language === 'en'
    && JSON.stringify(mine.body.choices.map((c) => c.tag)) === '["en","hi","mr"]');
  check('anything but English, Hindi or Marathi is a 400', (await put('/api/hub/language', { language: 'fr' }, 'asha')).status === 400);
  check('the language is a student\'s own choice: staff get a 403', (await get('/api/hub/language')).status === 403);
  const chose = await put('/api/hub/language', { language: 'hi' }, 'asha');
  check('the student chooses Hindi', chose.status === 200 && chose.body.language === 'hi' && (await repo.getLanguageChoice(ID.asha)) === 'hi');
  const read = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  check('with nothing approved in Hindi: English, with a plain note, on the lesson and each question',
    read.body.lesson.language.language === 'en' && read.body.lesson.language.note === 'This lesson is not in Hindi yet, so it is shown in English.'
    && read.body.lesson.steps[1].questions.every((q) => q.language.language === 'en' && /not in Hindi yet/.test(q.language.note)));

  const view = await get(`/api/hub/chapters/${deckId}/translations`);
  const qItem = view.body.items?.find((i) => i.id === String(QNUM._id));
  check('staff see every item a student reads with its English: a question\'s wording and options, never its key',
    view.status === 200 && JSON.stringify(Object.keys(qItem?.english ?? {})) === '["text","options"]' && !KEYS.test(JSON.stringify(qItem.english))
    && view.body.items.some((i) => i.kind === 'lesson' && i.id === v1.id) && !view.body.items.some((i) => i.id === String(QDRAFT._id)),
    JSON.stringify(view.body.items?.map((i) => [i.kind, i.id])));
  const offline = await post(`/api/hub/chapters/${deckId}/translations/generate`, { languages: ['hi', 'mr'] });
  const offRun = await settle(`/api/hub/translations/run/${offline.body.runId}`);
  check('on the button with no model key: nothing is made, and the reply says so', offline.status === 202 && offline.body.note === OFFLINE_NOTE
    && offRun.body.run?.state === 'done' && offRun.body.run.written === 0 && (await repo.listItemTranslations({ contentId: deckId })).length === 0);
  check('a language other than Hindi or Marathi is a 400', (await post(`/api/hub/chapters/${deckId}/translations/generate`, { languages: ['ta'] })).status === 400);

  const dropped = await post('/api/hub/translations', {
    itemKind: 'question', itemId: String(QNUM._id), language: 'hi',
    fields: { text: '{1, 2, 3} में कितने elements हैं?', options: ['1', '2', '3'] },
  });
  check('a translation with a dropped option is saved as a draft, and the reply says it cannot be approved',
    dropped.status === 201 && dropped.body.translation.status === 'draft' && dropped.body.translation.blocking === 1
    && /cannot be approved yet/.test(dropped.body.message), JSON.stringify(dropped.body));
  const refused = await post(`/api/hub/translations/${dropped.body.translation.id}/approve`, { confirmFlags: true });
  check('approving it is refused, naming the count, even when confirmed', refused.status === 409
    && /The English question has 4 options, the translation 3\./.test(refused.body.error), refused.body.error);
  const numbers = await post('/api/hub/translations', {
    itemKind: 'question', itemId: String(QNUM._id), language: 'hi',
    fields: { text: '{1, 2, 4} में कितने elements हैं?', options: ['1', '2', '3', '4'] },
  });
  check('a changed number is flagged for the professor', numbers.status === 201 && numbers.body.translation.flags === 1
    && /the English has 1, 2, 3, the translation 1, 2, 4/.test(numbers.body.message), JSON.stringify(numbers.body));
  const unconfirmed = await post(`/api/hub/translations/${numbers.body.translation.id}/approve`, {});
  check('approving a flagged translation asks the professor to confirm they checked it', unconfirmed.status === 409
    && /Check these first/.test(unconfirmed.body.error) && /approve it again, confirming/.test(unconfirmed.body.error));
  const fixed = await patch(`/api/hub/translations/${numbers.body.translation.id}`, { fields: { text: '{1, 2, 3} में कितने elements हैं?' } });
  check('the professor fixes it: still a draft, now theirs, and the check finds nothing', fixed.status === 200
    && fixed.body.translation.status === 'draft' && fixed.body.translation.provenance === 'professor' && fixed.body.translation.flags === 0
    && /found nothing/.test(fixed.body.message), JSON.stringify(fixed.body));
  check('the HOD may not approve it: 403', (await post(`/api/hub/translations/${numbers.body.translation.id}/approve`, {}, 'hod')).status === 403);
  check('another professor: the translation\'s 404', (await post(`/api/hub/translations/${numbers.body.translation.id}/approve`, {}, 'profB')).status === 404);
  const ok = await post(`/api/hub/translations/${numbers.body.translation.id}/approve`, {});
  check('approved', ok.status === 200 && ok.body.translation.status === 'approved' && /Students who chose Hindi now see it/.test(ok.body.message));
  check('an approved translation can no longer be edited: 409', (await patch(`/api/hub/translations/${numbers.body.translation.id}`, { fields: { text: 'x' } })).status === 409);
  SHOWN.qnum = numbers.body.translation.id;

  const english = view.body.items.find((i) => i.kind === 'lesson' && i.id === v1.id).english;
  const lessonHi = await post('/api/hub/translations', {
    itemKind: 'lesson', itemId: v1.id, language: 'hi',
    fields: Object.fromEntries(Object.entries(english).map(([k]) => [k,
      'Sets\nset अलग-अलग objects का संग्रह है।\nसदस्यता $x \\in S$ लिखी जाती है।\n\nSets\nखाली set में 0 elements होते हैं।\nset {1, 2, 3} में 3 elements होते हैं।'])),
  });
  check('a lesson is translated in the same generic shape', lessonHi.status === 201 && lessonHi.body.translation.blocking === 0
    && lessonHi.body.translation.flags === 0, JSON.stringify(lessonHi.body));
  await post(`/api/hub/translations/${lessonHi.body.translation.id}/approve`, {});
  const hindi = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  const qn = hindi.body.lesson.steps[1].questions.find((q) => q._id === String(QNUM._id));
  const qs = hindi.body.lesson.steps[1].questions.find((q) => q._id === String(QSET._id));
  check('the student now reads the lesson in Hindi, its formula still rendered', hindi.body.lesson.language.language === 'hi'
    && /संग्रह/.test(hindi.body.lesson.steps[0].text) && /<math>/.test(hindi.body.lesson.steps[0].html));
  check('the approved question in Hindi, with its options in their places; the other in English, with its note',
    qn.language.language === 'hi' && qn.language.translationId === SHOWN.qnum && /कितने/.test(qn.text)
    && JSON.stringify(qn.options) === '["1","2","3","4"]' && qs.language.language === 'en' && /not in Hindi yet/.test(qs.language.note));
  check('and still no key', !KEYS.test(JSON.stringify(hindi.body)));
}

// ------------------------------------------------------------- attempts --

console.log('\nanswering a lesson\'s question (H5, H12)');
// The hub's own attempt store: the rows the practice loop writes (0026).
const kept = async () => repo.listHubAttempts({ accountId: ID.asha });
{
  const lessonId = v1.id;
  const qid = String(QNUM._id);
  const path = `/api/hub/lessons/${lessonId}/questions/${qid}/attempts`;
  const shown = { language: 'hi', translationId: SHOWN.qnum };
  connectAttemptStore(null);
  const refused = await post(path, { attemptId: 'attempt-0001', response: 2, shown }, 'asha');
  check('with no attempt store connected, the answer is refused (503) and nothing is taken', refused.status === 503
    && refused.body.error === NOT_CONNECTED && (await kept()).length === 0, JSON.stringify(refused.body));

  // What the merge connected: the practice loop's store, idempotent by (account, attempt id).
  connectAttemptStore(PRACTICE_STORE);
  check('a connected store makes the lesson answerable', (await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha')).body.lesson.answering === true);
  const first = await post(path, { attemptId: 'attempt-0001', response: 2, shown, timeMs: 8200 }, 'asha');
  check('the answer is marked on the server and the key comes now, after the attempt', first.status === 201 && first.body.correct === true
    && first.body.solution === 2 && first.body.duplicate === false, JSON.stringify(first.body));
  const [a] = await kept();
  check('the attempt is a hub attempt: the mode, the topic and its class, the language actually shown, no hints, the device\'s time',
    a?.mode === 'lesson' && a.clientAttemptId === 'attempt-0001' && a.topicId === T.Sets && a.topic === 'Sets' && a.classId === classId
    && a.contentId === deckId && a.language === 'hi' && a.hintsUsed === 0 && a.timeTakenMs === 8200 && a.questionSnapshot?.answerIdx === 2
    && a.reviewStatus === 'auto', JSON.stringify(a));
  const again = await post(path, { attemptId: 'attempt-0001', response: 0, shown }, 'asha');
  check('the same attempt id again is the first answer back, nothing added', again.status === 200 && again.body.duplicate === true
    && again.body.correct === true && (await kept()).length === 1);
  const english = await post(`/api/hub/lessons/${lessonId}/questions/${String(QSET._id)}/attempts`,
    { attemptId: 'attempt-0002', response: 0, shown: { language: 'hi', translationId: SHOWN.qnum } }, 'asha');
  check('a claim of a translation that is not this question\'s is replaced by what was really shown: English',
    english.status === 201 && english.body.correct === false && english.body.solution === 1 && english.body.language === 'en'
    && (await kept())[1]?.language === 'en');

  // The seam with practice: a lesson's answers count where every hub attempt does.
  const progress = await get('/api/hub/progress', 'asha');
  const sets = progress.body.topics?.find((t) => t.id === T.Sets);
  check('the lesson\'s two answers are the topic\'s evidence in the student\'s progress, provisional with N', progress.status === 200
    && sets?.state.answers === 2 && ['not-sure', 'needs-review'].includes(sets.state.state), JSON.stringify(sets?.state));
  const errors = await get('/api/hub/errors', 'asha');
  check('the wrong one opens an entry in their error log, with what was right only now', errors.status === 200
    && errors.body.entries?.length === 1 && errors.body.entries[0].question?.text === QSET.text && errors.body.entries[0].solution === 1,
    JSON.stringify(errors.body.entries?.[0] ?? errors.body).slice(0, 300));
  check('no room evidence is written by a lesson attempt', (await repo.listAnswers({})).length === 0);
  const bad = [
    await post(path, { attemptId: 'short', response: 2 }, 'asha'),
    await post(path, { attemptId: 'attempt-0003' }, 'asha'),
    await post(path, { attemptId: 'attempt-0004', response: 'x'.repeat(30000) }, 'asha'),
  ];
  check('a missing or malformed attempt id, a missing answer and an oversized one are 400s', bad.every((r) => r.status === 400), bad.map((r) => r.status).join(','));
  check('a question that is not the lesson\'s, and a draft, are the question\'s 404', (await post(`/api/hub/lessons/${lessonId}/questions/${String(QDRAFT._id)}/attempts`,
    { attemptId: 'attempt-0005', response: 0 }, 'asha')).status === 404);
  check('a removed student: the lesson\'s 404, word for word', JSON.stringify((await post(path, { attemptId: 'attempt-0006', response: 2 }, 'bilal')).body) === NO_LESSON);
  check('staff do not answer: 403', (await post(path, { attemptId: 'attempt-0007', response: 2 })).status === 403);

  // Batch 9 review: a question the lesson lists, changed in the bank since
  // into a written answer, then into a drawing (written straight to the store,
  // and put back after).
  const setPath = `/api/hub/lessons/${lessonId}/questions/${String(QSET._id)}/attempts`;
  const original = await repo.getQuestion(QSET._id);
  const before = (await kept()).length;
  await repo.updateQuestion(QSET._id, { kind: 'open', rubric: ['distinct objects', 'counted once'] });
  const listed = await post(setPath, { attemptId: 'attempt-0008', response: ['distinct objects counted once'] }, 'asha');
  const long = await post(setPath, { attemptId: 'attempt-0009', response: Array.from({ length: 61 }, (_, i) => `w${i}`).join(' ') }, 'asha');
  check('a lesson holds a written answer to its limit and to words, as practice does (Batch 9 review)',
    listed.status === 400 && /answered in words/.test(listed.body.error ?? '') && long.status === 400 && /has 61 words/.test(long.body.error ?? '')
    && (await kept()).length === before, JSON.stringify([listed.body, long.body]));
  await repo.updateQuestion(QSET._id, { kind: 'drawing', allowText: false });
  const drawn = await post(setPath, { attemptId: 'attempt-0010', response: { mediaId: 'abcdef123456' } }, 'asha');
  const read = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  check('a drawing is never asked in a lesson, and an answer to one is refused in a sentence, storing nothing (Batch 9 review)',
    drawn.status === 409 && /answered with a drawing/.test(drawn.body.error ?? '') && (await kept()).length === before
    && !JSON.stringify(read.body.lesson?.steps ?? []).includes(String(QSET._id)), JSON.stringify(drawn.body));
  await repo.updateQuestion(QSET._id, { kind: original.kind, rubric: original.rubric, allowText: original.allowText });

  const stats = await get(`/api/hub/chapters/${deckId}/languages`);
  const row = stats.body.items?.find((i) => i.questionId === qid);
  check('statistics by language from hub attempts: each student\'s first answer, by the language shown',
    stats.status === 200 && row?.students === 1 && row.languages?.[0]?.language === 'hi' && row.languages[0].correct === 1
    && /first answer/.test(stats.body.method), JSON.stringify(row));
}

console.log('\nan edit to the English puts a translation out of date');
{
  const edited = await patch(`/api/bank/question/${QNUM._id}`, { text: 'How many elements does {1, 2, 3} have?' });
  check('the professor edits the English question', edited.status === 200, JSON.stringify(edited.body).slice(0, 200));
  const read = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  const q = read.body.lesson.steps[1].questions.find((x) => x._id === String(QNUM._id));
  check('the student is shown English again, with the note', q.language.language === 'en' && /not in Hindi yet/.test(q.language.note) && /does \{1, 2, 3\} have/.test(q.text));
  const view = await get(`/api/hub/chapters/${deckId}/translations?language=hi`);
  const item = view.body.items.find((i) => i.id === String(QNUM._id));
  check('the staff view marks the approved translation out of date', item.translations.hi.serving?.stale === true
    && /out of date/.test(item.translations.hi.serving.statusLabel) && item.translations.hi.shown === 'en' && item.translations.mr === undefined);
}

// ------------------------------------------------------- AI drafts --

console.log('\nan AI lesson: its questions are bank drafts; regenerating keeps the approved lesson serving (H11)');
{
  const content = await repo.getContent(deckId);
  const topic = await repo.getChapterTopic(T.Sets);
  // The model is never called here: a stand-in returns a fixture reply through the real parser.
  const fixture = JSON.stringify({ parts: [{
    part: 'C1',
    example: { problem: 'Is {1, 1, 2} a set of 3 elements?', steps: ['A set holds distinct objects.', 'So 1 counts once.'], answer: 'No: 2 elements.' },
    questions: [
      { kind: 'mcq', bloom: 'remember', text: 'What does a set hold?', options: ['Distinct objects', 'Ordered pairs', 'Repeated values', 'Only numbers'], answerIdx: 0 },
      { kind: 'truefalse', bloom: 'remember', text: 'The empty set has one element.', answerBool: false },
    ],
  }] });
  const { lesson: ai, drafted } = await writeLessonDraft(repo, { content, topic, viewer: { id: ID.profA, role: 'professor' }, callModel: async () => fixture });
  check('the stand-in model\'s lesson is an AI draft, chunk then example then questions', ai.source === 'llm' && ai.status === 'draft'
    && JSON.stringify(ai.steps.map((s) => s.type)) === '["chunk","example","questions"]');
  check('its questions went into the bank as drafts, cited to the slides', drafted.length === 2
    && drafted.every((q) => q.status === 'draft' && q.source === 'llm' && JSON.stringify(q.sourceRef) === '{"kind":"slides","slides":[1,2]}'));
  const still = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  check('while it is a draft the student still reads the approved version 1', still.body.lesson.version === 1);
  const staff = await get(`/api/hub/topics/${T.Sets}/lessons`);
  check('the staff list: version 1 serving, version 3 a draft labelled AI draft', staff.body.serving?.version === 1
    && staff.body.drafts[0]?.version === 3 && /^AI draft/.test(staff.body.drafts[0].statusLabel)
    && staff.body.drafts[0].steps[1].label === 'AI draft');
  const approved = await post(`/api/hub/lessons/${ai._id}/approve`, {});
  check('approving it replaces version 1 and says which questions still wait in the bank', approved.status === 200
    && /in place of version 1/.test(approved.body.message) && /2 of this lesson's 2 questions wait for your approval in the bank/.test(approved.body.message),
    approved.body.message);
  const statuses = (await repo.listTopicLessons({ topicId: T.Sets })).map((l) => `${l.version}:${l.status}`).join(',');
  check('version 1 is retired, version 3 serves', statuses === '1:superseded,2:discarded,3:approved', statuses);
  let read = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  check('the student reads version 3: the worked example, labelled, and no question while each is a draft',
    read.body.lesson.version === 3 && read.body.lesson.steps[1].type === 'example' && /written with AI help/.test(read.body.lesson.steps[1].label)
    && !read.body.lesson.steps.some((s) => s.type === 'questions') && read.body.lesson.language.language === 'en');
  const bankApprove = await post(`/api/bank/question/${drafted[0]._id}/approve`, {});
  read = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  check('approved in the bank, the first question reaches the student; the other draft does not', bankApprove.status === 200
    && JSON.stringify(read.body.lesson.steps.find((s) => s.type === 'questions')?.questions.map((q) => q._id)) === JSON.stringify([String(drafted[0]._id)]));
  // The lesson still lists the other one; rejected in the bank, it was never approved, so never answerable.
  const rejected = await post(`/api/bank/question/${drafted[1]._id}/reject`, {});
  const onRejected = await post(`/api/hub/lessons/${ai._id}/questions/${String(drafted[1]._id)}/attempts`, { attemptId: 'attempt-0102', response: false }, 'asha');
  check('a draft the professor rejected in the bank is never answered in the lesson: the question\'s 404, no key, nothing kept',
    rejected.status === 200 && onRejected.status === 404 && !/solution/.test(JSON.stringify(onRejected.body))
    && !(await kept()).some((x) => x.clientAttemptId === 'attempt-0102'), `${onRejected.status} ${JSON.stringify(onRejected.body).slice(0, 200)}`);
  const late = await post(`/api/hub/lessons/${v1.id}/questions/${String(QSET._id)}/attempts`, { attemptId: 'attempt-0101', response: 1 }, 'asha');
  check('an answer sent to the replaced version, open on a phone, is still taken', late.status === 201
    && (await kept()).some((x) => x.clientAttemptId === 'attempt-0101' && x.mode === 'lesson'));
  const regen = await post(`/api/hub/topics/${T.Sets}/lessons/generate`, {});
  await settle(`/api/hub/lessons/run/${regen.body.runId}`);
  check('regenerating again leaves version 3 serving until the new one is approved',
    (await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha')).body.lesson.version === 3
    && (await repo.listTopicLessons({ topicId: T.Sets })).some((l) => l.version === 4 && l.status === 'draft'));
}

// ------------------------------------------------- explanations translated --

console.log('\nan explanation is translated like any item, and read after a practice answer (H12, H14)');
{
  const qid = String(QSET._id);
  const english = 'A set holds each object once, so b is right.';
  const wrote = await put(`/api/hub/questions/${qid}/explanation`, { text: english });
  check('the professor writes an explanation', wrote.status === 201, JSON.stringify(wrote.body).slice(0, 200));
  const view = await get(`/api/hub/chapters/${deckId}/translations?language=hi`);
  const item = view.body.items?.find((i) => i.kind === 'explanation' && i.id === qid);
  check('staff see it among the items to translate, named by its question, with its English',
    JSON.stringify(item?.english) === JSON.stringify({ explanation: english }) && item.translations.hi.shown === 'en', JSON.stringify(item));
  const made = await post('/api/hub/translations', {
    itemKind: 'explanation', itemId: qid, language: 'hi', fields: { explanation: 'set हर object को एक बार रखता है, इसलिए b सही है।' },
  });
  check('the professor writes its Hindi: a draft, and the check finds nothing', made.status === 201 && made.body.translation.status === 'draft'
    && made.body.translation.blocking === 0 && made.body.translation.flags === 0, JSON.stringify(made.body));
  check('the HOD may not approve it: 403', (await post(`/api/hub/translations/${made.body.translation.id}/approve`, {}, 'hod')).status === 403);
  check('the owner approves it', (await post(`/api/hub/translations/${made.body.translation.id}/approve`, {})).status === 200);
  const next = await get(`/api/hub/practice/next?topicId=${T.Sets}`, 'asha');
  check('practice speaks the student\'s language too: no current Hindi question here, so English with the plain note',
    next.status === 200 && next.body.language === 'en' && next.body.translationId === null
    && /^This question is not in Hindi yet, so it is shown in English\.$/.test(next.body.languageNote ?? ''), JSON.stringify(next.body).slice(0, 300));
  const answered = await post('/api/hub/practice/attempts', { attemptId: 'practice-x001', questionId: qid, topicId: T.Sets, response: 0 }, 'asha');
  check('after a practice answer, the student who chose Hindi reads the explanation in Hindi',
    answered.status === 201 && /इसलिए/.test(answered.body.explanation?.text ?? '') && answered.body.explanation.language?.language === 'hi',
    JSON.stringify(answered.body).slice(0, 300));
}

// ------------------------------------------------- the review's fixes --

console.log('\na lesson answer never shows another answer\'s result, nor a self-test question\'s answer while it is open');
{
  const onV1 = (q) => `/api/hub/lessons/${v1.id}/questions/${String(q._id)}/attempts`;
  const before = (await kept()).length;
  // 'practice-x001' is Asha's practice answer to QSET, above; 'attempt-0001' her lesson answer to QNUM.
  const practiceId = await post(onV1(QNUM), { attemptId: 'practice-x001', response: 2 }, 'asha');
  const otherQuestion = await post(onV1(QSET), { attemptId: 'attempt-0001', response: 1 }, 'asha');
  check('an id kept for a practice answer, or for another question\'s lesson answer: 409, with no mark and no key, nothing kept',
    [practiceId, otherQuestion].every((r) => r.status === 409 && r.body.error === 'That attempt id was used for another answer. Send this one with a new id.'
      && !/solution|correct|score/.test(JSON.stringify(r.body))) && (await kept()).length === before, `${practiceId.status} ${JSON.stringify(practiceId.body)} | ${otherQuestion.status} ${JSON.stringify(otherQuestion.body)}`);

  const exam = await post('/api/hub/exams', { clientRunId: 'lesson-exam-0001', topicIds: [T.Sets], count: 30 }, 'asha');
  const listed = (exam.body.questions ?? []).map((x) => x.questionId);
  check('a self-test on Sets holds both lesson questions', exam.status === 201 && listed.includes(String(QSET._id)) && listed.includes(String(QNUM._id)),
    JSON.stringify(exam.body).slice(0, 200));
  const saved = await post(`/api/hub/exams/${exam.body.exam.id}/answers`, { attemptId: 'exam-ans-0301', questionId: String(QNUM._id), response: 0 }, 'asha');
  const examId = await post(onV1(QNUM), { attemptId: 'exam-ans-0301', response: 2 }, 'asha');
  check('the self-test\'s answer id sent to the lesson: 409, and not a word of its mark while the self-test is open',
    saved.status === 201 && examId.status === 409 && !/solution|correct|score/.test(JSON.stringify(examId.body)), `${examId.status} ${JSON.stringify(examId.body)}`);
  const closed = await post(onV1(QSET), { attemptId: 'attempt-0301', response: 1 }, 'asha');
  check('a new lesson answer to a question on the open self-test: 409, saying why, nothing kept', closed.status === 409
    && /self-test you have not handed in/.test(closed.body.error) && !(await kept()).some((x) => x.clientAttemptId === 'attempt-0301'), JSON.stringify(closed.body));
  const lessonView = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  const shownQs = lessonView.body.lesson.steps.filter((s) => s.type === 'questions').flatMap((s) => s.questions);
  check('the lesson the student reads says so on each such question', shownQs.length > 0
    && shownQs.every((q) => !listed.includes(q._id) || q.closed?.reason === 'self-test'), JSON.stringify(shownQs).slice(0, 300));
  await post(`/api/hub/exams/${exam.body.exam.id}/submit`, {}, 'asha');
  const open = await post(onV1(QSET), { attemptId: 'attempt-0302', response: 1 }, 'asha');
  check('handed in, the lesson takes the answer again, with its key after it', open.status === 201 && open.body.solution === 1, JSON.stringify(open.body));
}

// -------------------------------------------------------- the room phone --

console.log('\nno room phone reaches the hub; without Supabase it answers 503');
{
  check('no token: 401 on every lesson and language route', [
    await get(`/api/hub/topics/${T.Sets}/lesson`, null),
    await post(`/api/hub/lessons/${v1.id}/questions/${String(QSET._id)}/attempts`, { attemptId: 'attempt-0201', response: 1 }, null),
    await put('/api/hub/language', { language: 'hi' }, null),
  ].every((r) => r.status === 401));
  const saved = config.supabase.url;
  config.supabase.url = '';
  const r = await get(`/api/hub/topics/${T.Sets}/lesson`, 'asha');
  config.supabase.url = saved;
  check('without Supabase: 503, saying accounts are not set up', r.status === 503 && /accounts/.test(r.body.error ?? ''), JSON.stringify(r.body));
}

connectAttemptStore(null);
io.close();
server.close();

// ----------------------------------------------------------- boot probe --

console.log('\nthe boot probe names 0027 when it is missing, and rooms keep Supabase');
{
  const boot = async (missing) => {
    schemaMissing = missing;
    const lines = [];
    await initStore({ log: (l) => lines.push(l) });
    return { lines, kind: getRepo().kind };
  };
  const without = await boot(['topic_lessons', 'item_translations', 'student_language_choices']);
  check('without 0027\'s tables Supabase is kept, and the log names the file and what fails',
    without.kind === 'supabase'
    && without.lines.some((l) => /WARNING: the topic_lessons table is missing: apply supabase\/migrations\/0027_lessons_and_languages\.sql .*no lesson can be made/.test(l))
    && without.lines.some((l) => /WARNING: the item_translations table is missing: .*0027.*students read English/.test(l)),
    without.lines.join(' | '));
  const whole = await boot([]);
  check('with everything there, no warning', whole.kind === 'supabase' && !whole.lines.some((l) => /WARNING|missing/.test(l)), whole.lines.join(' | '));
  schemaMissing = null;
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.fetch = realFetch;
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
