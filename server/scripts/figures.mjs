// Batch 8 - figures, end to end.
//
//   node server/scripts/figures.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with Supabase Auth answered by a
// stand-in on this machine for the accounts the hub needs, and checks:
//
//   slides      a .pptx upload keeps its PNG, JPEG and WebP pictures with their
//               slide numbers and metadata stripped, skips and counts the rest;
//               a typed chapter says it has none; another professor gets 404
//   editor      what the engines accept, a preview (and a step of it), and a
//               refusal in a sentence for a broken spec
//   bank        a professor saves a figure question of every type; a broken
//               SMILES string, a 26-box diagram, a ready-made SVG and an unknown
//               key are refused; a draft with a figure is approved; a slide
//               picture goes on a question with regions; the bank shows each
//               figure drawn
//   room        a phone is served the figure questions: the drawing, its
//               description and table, never the spec, the steps or a key, and
//               every SVG passes the safety check
//   projector   a stepped figure on the wall, moved step by step by the console;
//               a step out of range and a figure with no steps are refused
//   archive     a room's archive carries each figure as drawn
//   print       the chapter's printable page carries the same drawing
//   lesson      a stepped figure added to a lesson as a new draft version; an
//               HOD may not, another professor gets 404
//
// Never calls Gemini, Supabase or any network service: every request that is
// not to this machine or the stand-in is refused and counted. Exits non-zero on
// any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { buildRoomArchive } = await import(`${SRC}services/archive.js`);
const { writeLessonDraft } = await import(`${SRC}services/hubLessons.js`);
const { safeSvg } = await import(`${SRC}figures/common.js`);
const { SPECS, PNG_WITH_TEXT, JPEG, EMF, SVG_PICTURE, bigPng, deckWithPictures } = await import(new URL('../test/fixtures/figures.js', import.meta.url).href);

config.supabase.url = '';
config.supabase.serviceKey = '';
config.supabase.anonKey = '';
config.mongoUri = '';
config.gemini.apiKey = '';
await initStore({ log: () => {} });
const repo = getRepo();

// ------------------------------------------------- accounts (a stand-in) --

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'f8000000-0000-4000-8000-000000000001',
  profA: 'f8000000-0000-4000-8000-000000000002',
  hodOther: 'f8000000-0000-4000-8000-000000000003',
  profB: 'f8000000-0000-4000-8000-000000000004',
};
const account = (id, role, department, reportsTo) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-FIG0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: null, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
].map((a) => [a.id, a]));
const TOKENS = Object.fromEntries(Object.keys(ID).map((who) => [who, `tok-${who}`]));
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
    throw new Error(`figures.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by figures.mjs: ${url.pathname}` }, 404);
};
// After the store is chosen, so the store stays in-process; only Auth goes to the stand-in.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'figures-test-service-key';

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
  if (as === 'key') headers['x-teacher-key'] = config.teacherKey;
  else if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  return { status: res.status, body: parsed, type: res.headers.get('content-type') ?? '' };
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
function either(socket, events, ms = 5000) {
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

/** Every key anywhere in a payload. */
const keysIn = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => keysIn(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysIn(x, out); }
  return out;
};
/** Every SVG string anywhere in a payload. */
const svgsIn = (v, out = []) => {
  if (typeof v === 'string' && v.startsWith('<svg')) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => svgsIn(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => svgsIn(x, out));
  return out;
};

// -------------------------------------------------------------- slides --

console.log('\nslide pictures kept from a deck');

const deck = deckWithPictures(
  [
    { n: 1, text: 'Leaves and photosynthesis', media: ['leaf.png', 'chart.emf'] },
    { n: 3, text: 'Inside a cell', media: ['cell.jpeg', 'icon.svg', 'huge.png'] },
    { n: 4, text: 'Summary', media: ['leaf.png'] },
  ],
  { 'leaf.png': PNG_WITH_TEXT, 'chart.emf': EMF, 'cell.jpeg': JPEG, 'icon.svg': SVG_PICTURE, 'huge.png': bigPng(config.media.maxBytes + 10) },
);
// The text pass needs words on the slides; the deck builder gives each one line.
const form = new FormData();
form.append('file', new Blob([deck]), 'Biology unit 2.pptx');
const uploaded = await (async () => {
  const res = await fetch(`${base}/api/content?ocr=off`, { method: 'POST', headers: { authorization: `Bearer ${TOKENS.profA}` }, body: form });
  return { status: res.status, body: await res.json() };
})();
check('the deck uploads', uploaded.status === 201, JSON.stringify(uploaded.body));
const contentId = uploaded.body.contentId;
const sp = uploaded.body.slidePictures;
check('the upload says what it kept: 2 pictures, 2 of other kinds and 1 too large left out',
  sp?.kept === 2 && sp?.skippedType === 2 && sp?.skippedLarge === 1 && /2 pictures kept/.test(sp?.note ?? ''), JSON.stringify(sp));
const listed = await get(`/api/figures/content/${contentId}/slide-pictures`);
check('the chapter lists its slide pictures in slide order, with their urls',
  listed.status === 200 && listed.body.pictures?.map((p) => [p.slide, p.mime]).join() === '1,image/png,2,image/jpeg'
  && listed.body.pictures.every((p) => /^\/api\/media\/[0-9a-f]{24}$/.test(p.url)), JSON.stringify(listed.body));
const leafUrl = listed.body.pictures?.[0]?.url;
const leafBytes = Buffer.from(await (await realFetch(base + leafUrl, { headers: { authorization: `Bearer ${TOKENS.profA}` } })).arrayBuffer());
check('a kept picture has its metadata taken out', leafBytes.length > 0 && !leafBytes.includes(Buffer.from('Dr Secret Person')));
check('the HOD reads the list', (await get(`/api/figures/content/${contentId}/slide-pictures`, 'hod')).status === 200);
const theirs = await get(`/api/figures/content/${contentId}/slide-pictures`, 'profB');
const nowhere = await get('/api/figures/content/0123456789abcdef01234567/slide-pictures', 'profB');
check('another professor gets the same 404 as a chapter that is not there',
  theirs.status === 404 && JSON.stringify(theirs.body) === JSON.stringify(nowhere.body));
const typed = await post('/api/content', { title: 'Typed notes', text: 'Photosynthesis\nRespiration\nTranspiration' });
const typedList = await get(`/api/figures/content/${typed.body.contentId}/slide-pictures`);
check('a typed chapter has no slide pictures, and says so', typedList.body.kept === false && typedList.body.pictures?.length === 0
  && /uploaded before slide pictures were kept, or was typed in/.test(typedList.body.note ?? ''), JSON.stringify(typedList.body));
check('a phone (no credential) never reaches the list', (await get(`/api/figures/content/${contentId}/slide-pictures`, null)).status === 401);

// -------------------------------------------------------------- editor --

console.log('\nthe editor: kinds and preview');

const kinds = await get('/api/figures/kinds');
check('the kinds the engines accept', kinds.status === 200 && kinds.body.types?.length === 9 && kinds.body.limits?.nodes === 25);
const preview = await post('/api/figures/preview', { spec: SPECS.diagram, step: 1 });
check('a preview draws the figure and a step of it', preview.status === 200 && safeSvg(preview.body.figure?.svg)
  && preview.body.atStep?.caption === 'Check the base case first.' && preview.body.figure?.stepCount === 2, JSON.stringify(preview.body).slice(0, 300));
const badPreview = await post('/api/figures/preview', { spec: { type: 'molecule', smiles: 'C1CC(' } });
check('a broken figure previews as a sentence', badPreview.status === 400 && /not a molecule the chemistry engine can read/.test(badPreview.body.error ?? ''));

// ---------------------------------------------------------------- bank --

console.log('\nfigure questions in the bank');

const mcq = (text, stimulus) => ({
  text, bloom: 'remember', kind: 'mcq', options: ['First choice.', 'Second choice.', 'Third choice.', 'Fourth choice.'], answerIdx: 1, stimulus,
});
const made = {};
for (const [name, spec] of Object.entries(SPECS)) {
  const r = await post(`/api/bank/${contentId}/questions`, { ...mcq(`Which statement fits the ${name} figure?`, { kind: 'figure', spec }), topic: 'Leaves and photosynthesis' });
  if (r.status === 201) made[name] = r.body.question._id;
  else check(`the ${name} figure question saves`, false, JSON.stringify(r.body));
}
check(`a professor saves a figure question of every type (${Object.keys(made).length} of ${Object.keys(SPECS).length})`, Object.keys(made).length === Object.keys(SPECS).length);

const refuse = async (label, stimulus, pattern) => {
  const r = await post(`/api/bank/${contentId}/questions`, mcq('A question that should not save.', stimulus));
  check(label, r.status === 400 && pattern.test(r.body.error ?? ''), JSON.stringify(r.body));
};
await refuse('a broken SMILES string is refused with a sentence', { kind: 'figure', spec: { type: 'molecule', smiles: 'C1CC(' } }, /not saved: The structure "C1CC\(" is not a molecule/);
await refuse('a diagram of 26 boxes is refused', { kind: 'figure', spec: { type: 'diagram', nodes: Array.from({ length: 26 }, (_, i) => ({ id: `n${i}`, label: `Box ${i}` })) } }, /at most 25 boxes/);
await refuse('a ready-made SVG is refused', { kind: 'figure', svg: '<svg onload="alert(1)"/>' }, /must be described as a set of named values|carries svg/);
await refuse('an SVG beside a spec is refused', { kind: 'figure', spec: SPECS.pie, svg: '<svg/>' }, /carries svg, which it cannot use/);
await refuse('an attribute a figure does not know is refused', { kind: 'figure', spec: { ...SPECS.pie, onclick: 'x' } }, /"onclick", which a figure cannot use/);
await refuse('a stated formula that does not match is refused', { kind: 'figure', spec: { type: 'molecule', smiles: 'CCO', formula: 'CH4' } }, /does not match the structure drawn, which is C2H6O/);

// A generated question waits for approval like any other.
const [draft] = await repo.insertQuestions([{
  contentId, topic: 'Leaves and photosynthesis', ...mcq('Which number continues the pattern?', { kind: 'figure', spec: SPECS.pattern }), source: 'llm', status: 'draft', model: 'stand-in',
}]);
const approved = await post(`/api/bank/question/${draft._id}/approve`, {});
check('a draft carrying a figure is approved through the gate', approved.status === 200 && approved.body.question?.status === 'active', JSON.stringify(approved.body).slice(0, 200));

// A slide picture on a question, with regions for later interactions.
const imageQ = await post(`/api/bank/${contentId}/questions`, mcq('Which part of the leaf is marked?', null));
const regions = [{ id: 'stoma', label: 'Stoma', points: [[10, 10], [30, 10], [20, 30]] }, { id: 'vein', label: 'Vein', points: [[50, 50], [70, 50], [60, 80], [50, 70]] }];
const attached = await patch(`/api/bank/question/${imageQ.body.question?._id}`, { stimulus: { kind: 'image', url: leafUrl, alt: 'A leaf with a stoma and a vein marked.', regions } });
check('a slide picture goes on a question as an image, with its regions', attached.status === 200
  && attached.body.question?.stimulus?.regions?.length === 2 && attached.body.question?.stimulus?.url === leafUrl, JSON.stringify(attached.body).slice(0, 300));
const badRegion = await patch(`/api/bank/question/${imageQ.body.question?._id}`, { stimulus: { kind: 'image', url: leafUrl, alt: 'A leaf.', regions: [{ id: 'x', label: 'X', points: [[0, 0], [200, 0], [0, 5]] }] } });
check('a region outside the picture is refused', badRegion.status === 400 && /percentages/.test(badRegion.body.error ?? ''));
const undescribed = await post(`/api/bank/${contentId}/questions`, mcq('Which part is this?', { kind: 'image', url: leafUrl }));
check('a slide picture with no description of its own is refused', undescribed.status === 400 && /Describe this picture/.test(undescribed.body.error ?? ''),
  JSON.stringify(undescribed.body));

const bank = await get(`/api/bank/${contentId}`);
const withFigure = (bank.body.questions ?? []).filter((q) => q.figure);
check('the bank shows every figure question drawn, with its parts', withFigure.length === Object.keys(made).length + 1
  && withFigure.every((q) => q.figure.ok && safeSvg(q.figure.svg) && Array.isArray(q.figure.parts)), `${withFigure.length}`);
check('the bank shows the molecule\'s worked-out formula', withFigure.find((q) => String(q._id) === String(made.molecule))?.figure?.formula === 'C2H6O');

// ---------------------------------------------------------------- room --

console.log('\na room serves figures to a phone');

const setIds = [...Object.values(made), String(draft._id), String(imageQ.body.question._id)];
const opened = await post('/api/session', { contentId, title: 'Figures period', questionIds: setIds });
check('a room opens on the figure questions', opened.status === 201 || opened.status === 200, JSON.stringify(opened.body).slice(0, 200));
const code = opened.body.code;
const phoneSaw = [];
const s = await connect();
s.onAny((event, payload) => phoneSaw.push({ event, payload }));
let got = await (async () => {
  const first = either(s, ['server:question', 'server:exhausted', 'session:rejected']);
  s.emit('student:join', { code, rollNo: '21BIO01', name: 'Asha' });
  return first;
})();
const served = new Map();
let n = 0;
while (got.name === 'server:question' && n < 40) {
  const q = got.payload.question;
  served.set(String(q._id), q);
  n += 1;
  const result = either(s, ['server:result', 'session:rejected']);
  // A wrong answer each time, so the phone stays where the figures are.
  s.emit('student:answer', { questionId: q._id, response: (q.options ?? []).findIndex((o) => o !== 'Second choice.'), answerId: `fig-${String(n).padStart(4, '0')}` });
  await result;
  const next = either(s, ['server:question', 'server:exhausted']);
  s.emit('student:next');
  got = await next;
}
const packWait = either(s, ['server:pack']);
s.emit('student:pack', {});
await packWait.catch(() => null);
const figuresServed = [...served.values()].filter((q) => q.stimulus?.kind === 'figure');
const typesServed = new Set(figuresServed.map((q) => q.stimulus.type));
check(`the phone is served a figure of every type (${typesServed.size} of 9 types, ${figuresServed.length} figure questions)`,
  ['plot', 'chart', 'numberline', 'geometry', 'timeline', 'diagram', 'molecule', 'pattern', 'stack'].every((t) => typesServed.has(t)), [...typesServed].join());
check('each as its drawing, description and table, nothing else', figuresServed.every((q) =>
  Object.keys(q.stimulus).sort().join() === 'description,kind,svg,table,title,type' && q.stimulus.description && q.stimulus.table?.rows));
const imageServed = served.get(String(imageQ.body.question._id));
check('the slide picture reaches the phone without its regions', imageServed?.stimulus?.kind === 'image' && imageServed.stimulus.regions === undefined
  && imageServed.stimulus.url === leafUrl, JSON.stringify(imageServed?.stimulus));
const phoneKeys = keysIn(phoneSaw);
check('nothing the phone got carries a spec, steps, regions or a key',
  !['spec', 'steps', 'regions', 'answerIdx', 'answerIdxs', 'pieces', 'smiles', 'highlight'].some((k) => phoneKeys.has(k)), [...phoneKeys].filter((k) => ['spec', 'steps', 'regions', 'answerIdx', 'smiles'].includes(k)).join());
const phoneSvgs = svgsIn(phoneSaw);
check(`every SVG a phone got is drawing only (${phoneSvgs.length} checked)`, phoneSvgs.length > 0 && phoneSvgs.every(safeSvg));
check('no step caption reached the phone', !JSON.stringify(phoneSaw).includes('Check the base case first'));

// ----------------------------------------------------------- projector --

console.log('\nthe projector steps through a figure');

const link = await post(`/api/session/${code}/projector/links`, {});
check('a projector link is made', link.status === 201 && typeof link.body.token === 'string', JSON.stringify(link.body).slice(0, 200));
const wall = await connect();
const wallSaw = [];
wall.onAny((event, payload) => wallSaw.push({ event, payload }));
const firstState = either(wall, ['projector:state', 'projector:refused']);
wall.emit('projector:watch', { token: link.body.token });
await firstState;
const shown = either(wall, ['projector:state']);
const toDiagram = await patch(`/api/session/${code}/projector`, { mode: 'diagram', diagram: { questionId: made.diagram } });
const atZero = await shown;
check('the stepped diagram goes up at its first picture', toDiagram.status === 200
  && atZero.payload.diagram?.stimulus?.kind === 'figure' && atZero.payload.diagram.stimulus.step === 0 && atZero.payload.diagram.stimulus.stepCount === 2,
JSON.stringify(atZero.payload.diagram ?? toDiagram.body).slice(0, 300));
const stepped = either(wall, ['projector:state']);
const toStep = await patch(`/api/session/${code}/projector`, { step: 1 });
const atOne = await stepped;
check('the console moves it to step 1: the wall shows that step with its caption', toStep.status === 200 && toStep.body.screen?.step === 1
  && atOne.payload.diagram?.stimulus?.step === 1 && atOne.payload.diagram.stimulus.caption === 'Check the base case first.'
  && atOne.payload.diagram.stimulus.svg !== atZero.payload.diagram.stimulus.svg, JSON.stringify(toStep.body).slice(0, 300));
const stepped2 = either(wall, ['projector:state']);
await patch(`/api/session/${code}/projector`, { step: 2 });
check('and on to step 2', (await stepped2).payload.diagram?.stimulus?.caption === 'n is 1, so return 1.');
const tooFar = await patch(`/api/session/${code}/projector`, { step: 3 });
check('a step past the last is refused in a sentence', tooFar.status === 400 && /2 steps: choose one from 0/.test(tooFar.body.error ?? ''));
await patch(`/api/session/${code}/projector`, { diagram: { questionId: made.pie } });
const flat = await patch(`/api/session/${code}/projector`, { step: 1 });
check('a figure with no steps cannot be stepped', flat.status === 400 && /no steps to move through/.test(flat.body.error ?? ''));
const stackUp = either(wall, ['projector:state']);
await patch(`/api/session/${code}/projector`, { mode: 'question', question: { questionId: made.stack } });
await stackUp;
const stackStep = either(wall, ['projector:state']);
await patch(`/api/session/${code}/projector`, { step: 2 });
const st = (await stackStep).payload.question?.stimulus;
check('a call stack on the question screen steps too (frames pushed and popped)', st?.step === 2 && /fact\(2\)/.test(st?.description ?? ''), JSON.stringify(st).slice(0, 200));
const wallKeys = keysIn(wallSaw);
check('the wall never got a spec or a key before the reveal', !wallKeys.has('spec') && !wallKeys.has('answerIdx') && svgsIn(wallSaw).every(safeSvg));
wall.close();
s.close();

// ------------------------------------------------------------- archive --

console.log('\nthe room\'s archive and the printable page');

const session = await repo.getSessionByCode(code).catch(() => null) ?? (await repo.listSessionsForContent(contentId)).find((x) => x.code === code);
const archive = await buildRoomArchive(repo, session);
const drawn = Object.values(archive.doc.data.figures ?? {});
check('the archive keeps every figure the room showed, drawn as the phones saw it', drawn.length >= 9 && drawn.every((f) => safeSvg(f.svg) && f.description),
  `${drawn.length} figures, ${archive.bytes} bytes`);
check('and stays within its limit', archive.bytes <= 1024 * 1024);

const page = await get(`/api/figures/content/${contentId}/print`);
check('the printable page carries the same drawings', page.status === 200 && /text\/html/.test(page.type)
  && figuresServed.every((q) => page.body.text.includes(q.stimulus.svg)), `${page.status}`);
check('and no script', !/<script/i.test(page.body.text ?? ''));

// -------------------------------------------------------------- lesson --

console.log('\na stepped figure in a lesson');

const topics = await repo.listChapterTopics(contentId);
const topic = topics.find((t) => /photosynthesis/i.test(t.name)) ?? topics[0];
const content = await repo.getContent(contentId);
const { lesson } = await writeLessonDraft(repo, { content, topic, viewer: { id: ID.profA, role: 'professor' } });
check('a slides-only lesson is written', Boolean(lesson?._id), JSON.stringify(topics.map((t) => t.name)));
const added = await post(`/api/hub/lessons/${lesson._id}/figures`, { spec: SPECS.stack, after: 0 });
const fig = added.body.lesson?.steps?.find((x) => x.type === 'figure');
check('the figure goes into a new draft version, after the first step', added.status === 201 && added.body.lesson?.version === lesson.version + 1
  && added.body.lesson.steps[1]?.type === 'figure' && fig?.figure?.steps?.length === 3 && /Students go on reading/.test(added.body.message ?? ''),
JSON.stringify(added.body).slice(0, 300));
check('the version students read is untouched', (await repo.getTopicLesson(lesson._id)).steps.every((x) => !x.figure));
const hodAdd = await post(`/api/hub/lessons/${lesson._id}/figures`, { spec: SPECS.stack }, 'hod');
check('an HOD reads but may not add', hodAdd.status === 403);
const otherAdd = await post(`/api/hub/lessons/${lesson._id}/figures`, { spec: SPECS.stack }, 'profB');
const noLesson = await post('/api/hub/lessons/0123456789abcdef01234567/figures', { spec: SPECS.stack }, 'profB');
check('another professor gets the same 404 as a lesson that is not there', otherAdd.status === 404 && JSON.stringify(otherAdd.body) === JSON.stringify(noLesson.body));
const badAdd = await post(`/api/hub/lessons/${lesson._id}/figures`, { spec: { type: 'stack' } });
check('a broken figure is not added, in a sentence', badAdd.status === 400 && /The figure was not added: The stack needs frames/.test(badAdd.body.error ?? ''));
check('the shared teacher key reaches no lesson', (await post(`/api/hub/lessons/${lesson._id}/figures`, { spec: SPECS.stack }, 'key')).status === 401);

// ------------------------------------------------------------------ end --

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);
console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore?.();
process.exit(fail ? 1 : 0);

