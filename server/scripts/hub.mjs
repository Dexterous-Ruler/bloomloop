// Phase 6: the Learning Hub's content backbone, end to end (decisions H1 to H4, H15).
//
//   node server/scripts/hub.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, and checks:
//
//   accounts only   no token is a 401, the teacher key reaches nothing, and a
//                   server without Supabase answers 503
//   material        a deck uploaded now keeps each slide's words; an older
//                   chapter says it cites slide numbers only; topic records are
//                   made on upload and kept in step with the chapter's list,
//                   retiring a topic that has questions, rewriting no question
//   units           the owner adds, renames, reorders and removes units and
//                   places chapters; chapters in no unit are "Other chapters"
//   links           the owner adds and confirms links; a loop is refused with a
//                   sentence; the offline generator proposes none and says so;
//                   chains are nearest first, from confirmed links only
//   who sees what   a rostered student sees their class's units, chapters and
//                   live topics and nothing else; a removed student, another
//                   professor's student and a student not on the roster get the
//                   same 404 as a class that does not exist; an HOD reads and
//                   is refused every write; another professor gets the 404
//   the phone       a room phone's question carries the additive `rich` field
//                   and every other field as before, and reaches no hub route
//   boot probe      a database without 0025 keeps Supabase, and the log names
//                   the file and what fails until it is applied
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As
// server/scripts/roster.mjs and decisions.mjs do, the server is pointed at
// http://supabase.invalid and every request to it is answered here,
// in-process; any other request off this machine is refused and counted.
// Never calls Gemini, Supabase or any network service. Exits non-zero on any
// failure.

import http from 'node:http';
import AdmZip from 'adm-zip';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { forStudent } = await import(`${SRC}questionTypes.js`);
const { OFFLINE_NOTE } = await import(`${SRC}services/hubProposals.js`);

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
  hod: 'e0000000-0000-4000-8000-000000000001',
  profA: 'e0000000-0000-4000-8000-000000000002',
  profB: 'e0000000-0000-4000-8000-000000000003',
  hodOther: 'e0000000-0000-4000-8000-000000000004',
  asha: 'e0000000-0000-4000-8000-000000000005',
  bilal: 'e0000000-0000-4000-8000-000000000006',
  cara: 'e0000000-0000-4000-8000-000000000007',
  omar: 'e0000000-0000-4000-8000-000000000008',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-HUB0${id.slice(-1)}`,
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
    throw new Error(`hub.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by hub.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'hub-test-service-key';

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
const post = (path, body, as) => call('POST', path, { body, as });
const put = (path, body, as) => call('PUT', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });
const del = (path, as) => call('DELETE', path, { as });
const keysOf = (o) => JSON.stringify(Object.keys(o ?? {}).sort());
const NO_CLASS = JSON.stringify({ error: 'That class was not found.' });
const FENCE = '`'.repeat(3);

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

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function next(socket, event, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (p) => { clearTimeout(timer); resolve(p); });
  });
}

// ---------------------------------------------------------- accounts only --

console.log('\naccounts only (H1)');
{
  check('no credentials: 401', (await get('/api/hub', null)).status === 401);
  const key = await get('/api/hub', 'key');
  check('the shared teacher key reaches nothing here: 401', key.status === 401, JSON.stringify(key.body));
}

// --------------------------------------------------------------- material --

console.log('\nmaterial: per-slide text and topic records (H3, H4)');

const SLIDES = [
  ['Sets', 'A set is a collection of distinct objects', 'Membership is written $x \\in S$'],
  ['Relations', 'A relation pairs elements of two sets'],
  ['Functions', 'A function maps each input to one output'],
];
const up = await upload('Discrete structures.pptx', SLIDES);
const deckId = up.body.contentId;
check('a deck uploads, its reply as before', up.status === 201
  && keysOf(up.body) === '["chars","contentId","kind","ocr","readBy","slideCount","title","topics","warnings"]'
  && JSON.stringify(up.body.topics) === '["Sets","Relations","Functions"]', JSON.stringify(up.body));
{
  const stored = await repo.getContent(deckId);
  check('each slide\'s own words are kept with the chapter (0025)', JSON.stringify(stored.slideTexts?.map((s) => s.slide)) === '[1,2,3]'
    && /Membership is written/.test(stored.slideTexts[0].text), JSON.stringify(stored.slideTexts));
  const records = await repo.listChapterTopics(deckId);
  check('its topic records are made on upload, in its order', JSON.stringify(records.map((t) => [t.name, t.position]))
    === '[["Sets",1],["Relations",2],["Functions",3]]');
}
// A deck uploaded before Phase 6: slide numbers only, no records yet.
const older = await repo.createContent({
  title: 'Logic', kind: 'pptx', rawText: 'Propositions\nTruth tables', topics: ['Propositions', 'Truth tables'],
  topicSlides: { Propositions: [1], 'Truth tables': [2] }, ownerId: ID.profA,
});
const pasted = await post('/api/content', { title: 'Proofs', text: 'Direct proof\nInduction\nContradiction' });
const pastedId = pasted.body.contentId;
check('a pasted chapter answers as before, and gets topic records', pasted.status === 201
  && keysOf(pasted.body) === '["chars","contentId","kind","title","topics"]' && (await repo.listChapterTopics(pastedId)).length === 3);
const unplaced = await repo.createContent({ title: 'Secret chapter', kind: 'syllabus', rawText: 'hidden words', topics: ['Hidden topic'], ownerId: ID.profA });
const theirs = await repo.createContent({ title: 'Signals', kind: 'syllabus', rawText: '', topics: ['Fourier'], ownerId: ID.profB });

// A question per topic of the pasted chapter, to see the sync keep them.
await repo.insertQuestions(['Direct proof', 'Induction'].map((topic) => ({
  contentId: pastedId, topic, text: `About ${topic}?`, kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, bloom: 'remember',
  source: 'teacher', status: 'active',
})));
{
  const questionsBefore = JSON.stringify(await repo.listQuestions(pastedId, { includeDiscarded: true }));
  const edited = await patch(`/api/content/${pastedId}`, { topics: ['Direct proof', 'Contradiction', 'Pigeonhole'] });
  const records = await repo.listChapterTopics(pastedId);
  const by = Object.fromEntries(records.map((t) => [t.name, t]));
  check('a topic edit answers as before', edited.status === 200 && JSON.stringify(edited.body.content?.topics) === '["Direct proof","Contradiction","Pigeonhole"]');
  check('the records follow: Induction (it has a question) is retired, Pigeonhole is added, in the list\'s order',
    by.Induction?.retiredAt && !by['Direct proof'].retiredAt && by.Pigeonhole?.position === 3 && by.Contradiction?.position === 2,
    JSON.stringify(records.map((t) => [t.name, t.position, Boolean(t.retiredAt)])));
  check('and no question row is rewritten', JSON.stringify(await repo.listQuestions(pastedId, { includeDiscarded: true })) === questionsBefore);
  await patch(`/api/content/${pastedId}`, { topics: ['Direct proof', 'Contradiction'] });
  check('a topic with nothing hanging off it is removed when it leaves the list',
    !(await repo.listChapterTopics(pastedId)).some((t) => t.name === 'Pigeonhole'));
}

// ------------------------------------------------------------------ units --

console.log('\nunits and chapters (H3)');

const made = await post('/api/classes', { courseName: 'Discrete Maths', section: 'SY A' });
const classId = made.body.class.id;
const otherClass = (await post('/api/classes', { courseName: 'Discrete Maths', section: 'SY B' })).body.class.id;
await post(`/api/classes/${classId}/students`, { students: [{ roll: '21CS01', name: 'Asha' }, { roll: '21CS02', name: 'Bilal' }] });
{
  const bilalRow = (await repo.listClassStudents(classId)).find((s) => s.rollNo === '21CS02');
  await del(`/api/classes/${classId}/students/${bilalRow._id}`);
}
const theirClass = (await post('/api/classes', { courseName: 'Signals', section: 'EC A' }, 'profB')).body.class.id;
await post(`/api/classes/${theirClass}/students`, { students: [{ roll: '21CS01', name: 'Omar' }] }, 'profB');

const u1 = await post(`/api/hub/classes/${classId}/units`, { name: 'Unit 1: Sets of $\\mathbb{N}$' });
const u2 = await post(`/api/hub/classes/${classId}/units`, { name: 'Unit 2' });
const u3 = await post(`/api/hub/classes/${classId}/units`, { name: 'Unit 3' });
check('the owner adds units: 201, each at the end', u1.status === 201 && u2.status === 201 && u3.body.unit?.position === 3,
  JSON.stringify(u1.body.unit));
check('a unit\'s name carries its formula as HTML', /<math>/.test(u1.body.hub?.units?.[0]?.nameHtml ?? ''));
check('a second unit of the same name, in another case, is a 409', (await post(`/api/hub/classes/${classId}/units`, { name: 'unit 2' })).status === 409);
check('a blank name is a 400 that says what to send', (await post(`/api/hub/classes/${classId}/units`, { name: ' ' })).status === 400);
const renamed = await patch(`/api/hub/classes/${classId}/units/${u2.body.unit.id}`, { name: 'Unit 2: Relations and functions' });
check('renamed', renamed.status === 200 && renamed.body.unit.name === 'Unit 2: Relations and functions');
const order = await put(`/api/hub/classes/${classId}/units/order`, { unitIds: [u2.body.unit.id, u1.body.unit.id, u3.body.unit.id] });
check('reordered', order.status === 200 && JSON.stringify(order.body.hub.units.map((u) => u.id))
  === JSON.stringify([u2.body.unit.id, u1.body.unit.id, u3.body.unit.id]));
check('a reorder that leaves a unit out is a 400', (await put(`/api/hub/classes/${classId}/units/order`, { unitIds: [u1.body.unit.id] })).status === 400);

const placeDeck = await put(`/api/hub/classes/${classId}/chapters/${deckId}`, { unitId: u1.body.unit.id });
const placeOlder = await put(`/api/hub/classes/${classId}/chapters/${older._id}`, { unitId: u2.body.unit.id });
const placePasted = await put(`/api/hub/classes/${classId}/chapters/${pastedId}`, {});
check('chapters are placed: 201 when new', placeDeck.status === 201 && placeOlder.status === 201 && placePasted.status === 201);
check('a chapter from before the hub gets its topic records when first placed',
  JSON.stringify(placeOlder.body.topics?.added) === '["Propositions","Truth tables"]', JSON.stringify(placeOlder.body.topics));
await put(`/api/hub/classes/${classId}/chapters/${older._id}`, { unitId: u3.body.unit.id });
const moved = await put(`/api/hub/classes/${classId}/chapters/${older._id}`, { unitId: u2.body.unit.id, position: 1 });
check('a chapter moves between units: 200', moved.status === 200);
{
  const hub = moved.body.hub;
  const placed = Object.fromEntries(hub.units.map((u) => [u.name, u.chapters.map((c) => c.title)]));
  check('each unit holds its chapters; a chapter in no unit is under "Other chapters"',
    JSON.stringify(placed) === JSON.stringify({ 'Unit 2: Relations and functions': ['Logic'], 'Unit 1: Sets of $\\mathbb{N}$': ['Discrete structures'], 'Unit 3': [] })
    && hub.otherChapters.label === 'Other chapters' && JSON.stringify(hub.otherChapters.chapters.map((c) => c.title)) === '["Proofs"]',
    JSON.stringify({ placed, other: hub.otherChapters }));
  const deckView = hub.units[1].chapters[0];
  const olderView = hub.units[0].chapters[0];
  check('the staff view says the deck kept its slides\' words, and the older deck that it cites slide numbers only',
    deckView.slides.perSlideText === true && olderView.slides.perSlideText === false && /by number/.test(olderView.slides.note));
  check('the owner is offered the chapters not yet on the class, and only theirs',
    JSON.stringify(hub.available.map((c) => c.title)) === '["Secret chapter"]', JSON.stringify(hub.available));
}
check('another professor\'s chapter cannot be placed: the 404', (await put(`/api/hub/classes/${classId}/chapters/${theirs._id}`, {})).status === 404);
check('a unit of another class is the unit\'s 404',
  (await put(`/api/hub/classes/${otherClass}/chapters/${deckId}`, { unitId: u1.body.unit.id })).status === 404);
{
  const spare = await post(`/api/hub/classes/${classId}/units`, { name: 'Spare' });
  await put(`/api/hub/classes/${classId}/chapters/${unplaced._id}`, { unitId: spare.body.unit.id });
  const removed = await del(`/api/hub/classes/${classId}/units/${spare.body.unit.id}`);
  check('removing a unit leaves its chapter on the class, under "Other chapters", and says so',
    removed.status === 200 && removed.body.hub.otherChapters.chapters.some((c) => c.title === 'Secret chapter')
    && /Other chapters/.test(removed.body.message), removed.body.message);
  const off = await del(`/api/hub/classes/${classId}/chapters/${unplaced._id}`);
  check('and a chapter is taken off the class, the chapter itself unchanged',
    off.status === 200 && !off.body.hub.otherChapters.chapters.some((c) => c.title === 'Secret chapter') && Boolean(await repo.getContent(unplaced._id)));
}

// ------------------------------------------------------------------ links --

console.log('\nprerequisite links (H3)');

const T = {};
for (const t of [...await repo.listChapterTopics(deckId), ...await repo.listChapterTopics(older._id), ...await repo.listChapterTopics(pastedId)]) T[t.name] = String(t._id);
const l1 = await post('/api/hub/links', { prerequisiteId: T.Sets, topicId: T.Relations });
const l2 = await post('/api/hub/links', { prerequisiteId: T.Relations, topicId: T.Functions });
const l3 = await post('/api/hub/links', { prerequisiteId: T.Propositions, topicId: T.Sets });
check('the owner adds links across chapters: 201, confirmed, the professor\'s',
  [l1, l2, l3].every((l) => l.status === 201 && l.body.link.state === 'confirmed' && l.body.link.provenance === 'professor'),
  JSON.stringify(l1.body));
const loop = await post('/api/hub/links', { prerequisiteId: T.Functions, topicId: T.Propositions });
check('a loop is refused with a sentence naming the chain it would close', loop.status === 409
  && loop.body.error === '"Functions" cannot come before "Propositions": the confirmed links already put "Propositions" before "Sets" before '
    + '"Relations" before "Functions", so this link would make a loop. A topic cannot be needed before itself.', loop.body.error);
check('a topic before itself is refused', (await post('/api/hub/links', { prerequisiteId: T.Sets, topicId: T.Sets })).status === 409);
{
  const proposed = await post('/api/hub/links/propose', { contentIds: [deckId, older._id] });
  check('on the professor\'s button, the offline generator proposes none and says so',
    proposed.status === 200 && proposed.body.source === 'offline' && proposed.body.proposed.length === 0 && proposed.body.note === OFFLINE_NOTE,
    JSON.stringify(proposed.body));
  const run = await get(`/api/hub/links/run/${proposed.body.runId}`);
  check('its run reads back done for its owner, and 404 for anyone else', run.status === 200 && run.body.run.state === 'done'
    && (await get(`/api/hub/links/run/${proposed.body.runId}`, 'hod')).status === 404);
}
// What the model would have proposed (it is never called here): AI drafts.
const draft = await repo.addTopicLink({ ownerId: ID.profA, prerequisiteId: T['Truth tables'], topicId: T.Functions, provenance: 'ai', state: 'proposed', reason: 'Tables of values come first.', model: 'stand-in' });
const draft2 = await repo.addTopicLink({ ownerId: ID.profA, prerequisiteId: T['Direct proof'], topicId: T.Sets, provenance: 'ai', state: 'proposed', reason: 'Proofs about sets.', model: 'stand-in' });
const draftLoop = await repo.addTopicLink({ ownerId: ID.profA, prerequisiteId: T.Functions, topicId: T.Sets, provenance: 'ai', state: 'proposed', reason: 'Wrong way round.', model: 'stand-in' });
{
  const confirmed = await patch(`/api/hub/links/${draft._id}`, { state: 'confirmed' });
  check('the owner confirms an AI draft', confirmed.status === 200 && confirmed.body.link.state === 'confirmed'
    && confirmed.body.link.label === 'Proposed by AI, confirmed by the professor');
  const looped = await patch(`/api/hub/links/${draftLoop._id}`, { state: 'confirmed' });
  check('confirming a draft that would close a loop is refused with the sentence', looped.status === 409 && /would make a loop/.test(looped.body.error));
  const rejected = await patch(`/api/hub/links/${draftLoop._id}`, { state: 'rejected' });
  check('and rejects it', rejected.status === 200 && rejected.body.link.state === 'rejected');
  const listed = await get('/api/hub/links');
  check('the owner\'s links, counted by state', listed.status === 200
    && JSON.stringify(listed.body.counts) === '{"proposed":1,"confirmed":4,"rejected":1}', JSON.stringify(listed.body.counts));
  const chain = await get(`/api/hub/topics/${T.Functions}`);
  check('a topic\'s chain is its confirmed prerequisites, nearest first, across chapters',
    JSON.stringify(chain.body.prerequisites?.map((p) => [p.name, p.depth])) === '[["Relations",1],["Truth tables",1],["Sets",2],["Propositions",3]]',
    JSON.stringify(chain.body.prerequisites?.map((p) => [p.name, p.depth])));
  check('the staff view of a topic has its links in every state',
    chain.body.links?.prerequisites?.length === 2 && chain.body.links?.dependants?.some((l) => l.state === 'rejected'));
  const removed = await del(`/api/hub/links/${draft._id}`);
  check('the owner removes a link', removed.status === 200 && !(await repo.getTopicLink(draft._id)));
}

// --------------------------------------------------------- who sees what --

console.log('\nwho sees what (H1, H2)');
const FORBIDDEN = /Membership is written|hidden words|Secret chapter|Hidden topic|answerIdx|About Direct proof|Induction|Tables of values|Proofs about sets|Wrong way round|slideTexts|topicSlides|rawText|"questions"|"links"|proposed|rejected|retired|misconception/;
{
  const home = await get('/api/hub', 'asha');
  check('a rostered student\'s hub: their one class, with the notice that their professor can see their progress',
    home.status === 200 && home.body.role === 'student' && home.body.classes.length === 1 && home.body.classes[0].class.id === classId
    && /professor can see your progress/.test(home.body.notice), JSON.stringify(home.body).slice(0, 300));
  const cls = home.body.classes[0];
  check('units, chapters and topics in the professor\'s order, "Other chapters" for the rest',
    JSON.stringify(cls.units.map((u) => [u.name, u.chapters.map((c) => [c.title, c.topics.map((t) => t.name)])]))
      === JSON.stringify([['Unit 2: Relations and functions', [['Logic', ['Propositions', 'Truth tables']]]],
        ['Unit 1: Sets of $\\mathbb{N}$', [['Discrete structures', ['Sets', 'Relations', 'Functions']]]], ['Unit 3', []]])
    && JSON.stringify(cls.otherChapters.chapters.map((c) => [c.title, c.topics.map((t) => t.name)])) === '[["Proofs",["Direct proof","Contradiction"]]]',
    JSON.stringify(cls.units.map((u) => u.name)));
  check('field by field, nothing else of the professor\'s: no slide words, question, draft, retired topic or other chapter',
    keysOf(cls) === '["class","otherChapters","units"]' && keysOf(cls.units[0]) === '["chapters","id","name","nameHtml"]'
    && keysOf(cls.units[0].chapters[0]) === '["id","title","titleHtml","topics"]' && keysOf(cls.units[0].chapters[0].topics[0]) === '["id","name","nameHtml"]'
    && !FORBIDDEN.test(JSON.stringify(home.body)), JSON.stringify(home.body).match(FORBIDDEN)?.[0]);
  const one = await get(`/api/hub/classes/${classId}`, 'asha');
  check('the class on its own reads the same', one.status === 200 && JSON.stringify(one.body.units) === JSON.stringify(cls.units));
  const chapter = await get(`/api/hub/chapters/${deckId}`, 'asha');
  check('a placed chapter: its title and topics only', chapter.status === 200 && keysOf(chapter.body.chapter) === '["id","title","titleHtml","topics"]');
  check('a chapter of the professor\'s not on the class is the chapter\'s 404', (await get(`/api/hub/chapters/${unplaced._id}`, 'asha')).status === 404);
  const topic = await get(`/api/hub/topics/${T.Functions}`, 'asha');
  check('a topic\'s chain for the student: confirmed links only, no link list, no draft',
    topic.status === 200 && JSON.stringify(topic.body.prerequisites.map((p) => p.name)) === '["Relations","Sets","Propositions"]'
    && topic.body.links === undefined && !FORBIDDEN.test(JSON.stringify(topic.body)), JSON.stringify(topic.body.prerequisites?.map((p) => p.name)));
  check('a retired topic is the topic\'s 404 to a student', (await get(`/api/hub/topics/${(await repo.listChapterTopics(pastedId)).find((t) => t.name === 'Induction')._id}`, 'asha')).status === 404);
  check('every prerequisite here is on her class', topic.body.prerequisites.every((p) => p.onYourClasses === true));
  // An earlier semester's chapter, on none of her classes, with a confirmed link into this one (H3).
  const earlier = (await post('/api/content', { title: 'Earlier semester', text: 'Counting' })).body.contentId;
  const counting = String((await repo.listChapterTopics(earlier))[0]._id);
  await post('/api/hub/links', { prerequisiteId: counting, topicId: T.Sets });
  const sets = await get(`/api/hub/topics/${T.Sets}`, 'asha');
  const far = sets.body.prerequisites?.find((p) => p.name === 'Counting');
  check('a confirmed prerequisite from a chapter on none of her classes is named, marked as such, and nothing else of it is sent',
    far?.onYourClasses === false && far.chapter.title === 'Earlier semester' && (await get(`/api/hub/chapters/${earlier}`, 'asha')).status === 404
    && (await get(`/api/hub/topics/${counting}`, 'asha')).status === 404, JSON.stringify(far));

  const bodies = {
    'another of the professor\'s classes she is not on': await get(`/api/hub/classes/${otherClass}`, 'asha'),
    'a class that does not exist': await get('/api/hub/classes/0123456789abcdef01234567', 'asha'),
    'the removed student': await get(`/api/hub/classes/${classId}`, 'bilal'),
    'a student never on the roster': await get(`/api/hub/classes/${classId}`, 'cara'),
    'another professor\'s student with the same roll number': await get(`/api/hub/classes/${classId}`, 'omar'),
    'another professor': await get(`/api/hub/classes/${classId}`, 'profB'),
    'another department\'s HOD': await get(`/api/hub/classes/${classId}`, 'hodOther'),
  };
  for (const [who, r] of Object.entries(bodies)) {
    check(`${who}: the same 404, word for word`, r.status === 404 && JSON.stringify(r.body) === NO_CLASS, `${r.status} ${JSON.stringify(r.body)}`);
  }
  const bilalHome = await get('/api/hub', 'bilal');
  check('the removed student\'s hub lists no class, and says why plainly', bilalHome.status === 200 && bilalHome.body.classes.length === 0
    && /roll number/.test(bilalHome.body.empty));
  const omarHome = await get('/api/hub', 'omar');
  check('another professor\'s student sees only their own professor\'s class', JSON.stringify(omarHome.body.classes.map((c) => c.class.id)) === JSON.stringify([theirClass]));
  const studentWrites = [
    await post(`/api/hub/classes/${classId}/units`, { name: 'Mine' }, 'asha'),
    await put(`/api/hub/classes/${classId}/chapters/${deckId}`, {}, 'asha'),
    await post('/api/hub/links', { prerequisiteId: T.Sets, topicId: T.Functions }, 'asha'),
    await post('/api/hub/links/propose', { contentIds: [deckId] }, 'asha'),
    await get('/api/hub/links', 'asha'),
    await patch(`/api/hub/links/${l1.body.link.id}`, { state: 'rejected' }, 'asha'),
  ];
  check('a student on any staff route: 403 before anything is read', studentWrites.every((r) => r.status === 403),
    studentWrites.map((r) => r.status).join(','));
  check('and a student never reaches the teacher\'s own routes', (await get(`/api/content/${deckId}`, 'asha')).status === 403
    && (await get(`/api/classes/${classId}`, 'asha')).status === 403);
}

console.log('\nan HOD reads, and writes nothing; another professor gets the 404');
{
  const home = await get('/api/hub', 'hod');
  check('the HOD\'s hub lists the department\'s classes, none editable',
    home.status === 200 && home.body.classes.length === 2 && home.body.classes.every((c) => c.canEdit === false), JSON.stringify(home.body));
  const view = await get(`/api/hub/classes/${classId}`, 'hod');
  check('the HOD reads a class\'s hub, read-only', view.status === 200 && view.body.class.canEdit === false && view.body.class.access === 'reader'
    && view.body.available.length === 0);
  const writes = [
    await post(`/api/hub/classes/${classId}/units`, { name: 'HOD unit' }, 'hod'),
    await patch(`/api/hub/classes/${classId}/units/${u1.body.unit.id}`, { name: 'x' }, 'hod'),
    await del(`/api/hub/classes/${classId}/units/${u1.body.unit.id}`, 'hod'),
    await put(`/api/hub/classes/${classId}/units/order`, { unitIds: [] }, 'hod'),
    await put(`/api/hub/classes/${classId}/chapters/${deckId}`, {}, 'hod'),
    await del(`/api/hub/classes/${classId}/chapters/${deckId}`, 'hod'),
    await post('/api/hub/links', { prerequisiteId: T.Sets, topicId: T['Direct proof'] }, 'hod'),
    await patch(`/api/hub/links/${draft2._id}`, { state: 'confirmed' }, 'hod'),
    await del(`/api/hub/links/${l1.body.link.id}`, 'hod'),
    await post(`/api/hub/chapters/${deckId}/topics/sync`, {}, 'hod'),
    await post('/api/hub/links/propose', { contentIds: [deckId] }, 'hod'),
  ];
  check('every write by the HOD is a 403', writes.every((r) => r.status === 403), writes.map((r) => r.status).join(','));
  check('and the HOD changed nothing', (await repo.listClassUnits(classId)).length === 3 && (await repo.getTopicLink(draft2._id)).state === 'proposed');
  check('the HOD reads the department\'s links and topics', (await get('/api/hub/links', 'hod')).body.links?.length === 6
    && (await get(`/api/hub/topics/${T.Sets}`, 'hod')).status === 200);
  const profB = [
    await post(`/api/hub/classes/${classId}/units`, { name: 'B unit' }, 'profB'),
    await put(`/api/hub/classes/${classId}/chapters/${deckId}`, {}, 'profB'),
    await get(`/api/hub/chapters/${deckId}`, 'profB'),
    await get(`/api/hub/topics/${T.Sets}`, 'profB'),
    await patch(`/api/hub/links/${draft2._id}`, { state: 'confirmed' }, 'profB'),
    await post('/api/hub/links', { prerequisiteId: T.Sets, topicId: T.Functions }, 'profB'),
  ];
  check('another professor gets 404 on reads and writes alike, never 403', profB.every((r) => r.status === 404), profB.map((r) => r.status).join(','));
  const preview = await get(`/api/hub/classes/${classId}?view=student`);
  const asha = await get(`/api/hub/classes/${classId}`, 'asha');
  check('the owner previews the class as a student sees it', preview.status === 200
    && JSON.stringify(preview.body.units) === JSON.stringify(asha.body.units) && /as a student/.test(preview.body.preview));
}

// -------------------------------------------------------------- the phone --

console.log('\nthe room phone: the additive rich field, and no hub (H15)');
{
  const chapter = await repo.createContent({ title: 'Roots', kind: 'syllabus', rawText: '', topics: ['Roots'], ownerId: ID.profA });
  // A room needs six approved questions; each holds a formula and a block of code.
  await repo.insertQuestions(Array.from({ length: 6 }, (_, i) => ({
    contentId: chapter._id, topic: 'Roots', text: `If $x^2 = ${(i + 2) ** 2}$, which is a root?\n${FENCE}python\nprint(${i + 2} ** 2)\n${FENCE}`,
    kind: 'mcq', options: [`$${i + 2}$`, '3', '$\\sqrt{5}$', '5'], answerIdx: 0, bloom: 'understand', source: 'teacher', status: 'active',
  })));
  const room = await post('/api/session', { contentId: chapter._id });
  check('a room opens on them', room.status === 201 || room.status === 200, JSON.stringify(room.body));
  const phone = await connect();
  const first = next(phone, 'server:question');
  phone.emit('student:join', { code: room.body.code, rollNo: 'P1', name: 'Pia' });
  const got = await first;
  const q = await repo.getQuestion(got.question._id);
  const shown = forStudent(q, `P1:${q._id}`);
  const { rich, provenance, ...rest } = got.question;
  check('server:question carries `rich` beside every field it had, each unchanged',
    JSON.stringify(rest) === JSON.stringify(shown) && typeof provenance?.text === 'string', JSON.stringify(Object.keys(got.question)));
  check('`rich` holds MathML and highlighted code for the text, and each option',
    /<math>/.test(rich?.text ?? '') && /<pre class="shiki/.test(rich?.text ?? '') && rich?.options?.length === 4
    && /<math>/.test(rich.options[0]) && rich.options[1] === '3', JSON.stringify(rich).slice(0, 200));
  check('and never the key', !/answerIdx/.test(JSON.stringify(got)));

  const toClass = next(phone, 'class:question');
  const started = await post(`/api/session/${room.body.code}/class-questions`, { questionId: String(q._id) });
  const cq = await toClass;
  check('a class question to the phones carries it too', started.status === 201 && /<math>/.test(cq.question?.rich?.text ?? '')
    && cq.question.text === shown.text, JSON.stringify(cq.question?.rich ?? null).slice(0, 120));

  const plainChapter = await repo.createContent({ title: 'Plain', kind: 'syllabus', rawText: '', topics: ['Plain'], ownerId: ID.profA });
  await repo.insertQuestions(Array.from({ length: 6 }, () => ({ contentId: plainChapter._id, topic: 'Plain', text: 'Which costs $20 and $30?',
    kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'understand', source: 'teacher', status: 'active' })));
  const plainRoom = await post('/api/session', { contentId: plainChapter._id });
  const phone2 = await connect();
  const second = next(phone2, 'server:question');
  phone2.emit('student:join', { code: plainRoom.body.code, rollNo: 'P2' });
  const plain = await second;
  check('a question with prices and no formula: `rich` is {}, and the phone shows its text as before',
    keysOf(plain.question.rich) === '[]' && plain.question.text === 'Which costs $20 and $30?', JSON.stringify(plain.question.rich));
  check('a phone has no token, so every hub route is closed to it', (await get(`/api/hub/classes/${classId}`, null)).status === 401
    && (await get(`/api/hub/topics/${T.Sets}`, null)).status === 401);
  phone.disconnect();
  phone2.disconnect();
}

// --------------------------------------------------------- no accounts --

console.log('\nwithout Supabase');
{
  const saved = config.supabase.url;
  config.supabase.url = '';
  const r = await get('/api/hub', 'asha');
  config.supabase.url = saved;
  check('the hub answers 503, saying accounts are not set up', r.status === 503 && /accounts/.test(r.body.error ?? ''), JSON.stringify(r.body));
}

io.close();
server.close();

// ----------------------------------------------------------- boot probe --

console.log('\nthe boot probe names 0025 when it is missing, and rooms keep Supabase');
{
  // The server is closed; from here the store is chosen again, against a
  // stand-in for PostgREST that is missing what each case says.
  const boot = async (missing) => {
    schemaMissing = missing;
    const lines = [];
    await initStore({ log: (l) => lines.push(l) });
    return { lines, kind: getRepo().kind };
  };
  const without = await boot(['chapter_topics', 'topic_links', 'contents.slide_texts']);
  check('the hub\'s tables and the slide-text column missing: Supabase is kept, and the log names 0025 and what fails',
    without.kind === 'supabase'
    && without.lines.some((l) => /WARNING: the chapter_topics table is missing: apply supabase\/migrations\/0025_hub_backbone\.sql .*Until it is applied/.test(l))
    && without.lines.some((l) => /WARNING: contents\.slide_texts is missing: apply supabase\/migrations\/0025_hub_backbone\.sql .*per-slide text/.test(l)),
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
