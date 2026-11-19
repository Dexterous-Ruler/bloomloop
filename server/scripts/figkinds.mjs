// Batch 8 - the five kinds asked on a figure, end to end.
//
//   node server/scripts/figkinds.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with Supabase Auth answered by a
// stand-in on this machine for the accounts, and checks:
//
//   bank        a professor writes a question of each kind (tap a part of a
//               graph and of an uploaded picture, label a number line, plot
//               points, a line and a line drawn to conditions at Create, mark a
//               number line, set bars); what the validator refuses comes back
//               as its sentence; an HOD may read but not write, and another
//               professor gets the same 404 as a chapter that is not there
//   generation  offline, a plan asking for graph, number-line and bar-chart
//               questions makes them from numbers the material states and says
//               so; material with no such numbers makes none and says which
//   flags       a generated draft whose key the server read off its figure
//               reaches the professor with the sentence saying so; editing the
//               key clears it
//   room        phones answer every new kind through the real socket: right
//               answers are marked 1, a phone wrong on one kind gets 0 there,
//               every attempt is stored as evidence; and every payload a phone
//               got - questions, results, the offline pack - is scanned for the
//               stored answer fields and the parts' own names
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
const { loadFigureEngines } = await import(`${SRC}figures/index.js`);
const { safeSvg } = await import(`${SRC}figures/common.js`);
const { invalidReason, score } = await import(`${SRC}questionTypes.js`);
const { validateItems } = await import(`${SRC}services/generate.js`);
const { draftChecks } = await import(`${SRC}services/figureDrafts.js`);
const { PNG } = await import(new URL('../test/fixtures/figures.js', import.meta.url).href);

config.supabase.url = '';
config.supabase.serviceKey = '';
config.supabase.anonKey = '';
config.mongoUri = '';
config.gemini.apiKey = '';
await initStore({ log: () => {} });
await loadFigureEngines();
const repo = getRepo();

// ------------------------------------------------- accounts (a stand-in) --

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'f9000000-0000-4000-8000-000000000001',
  profA: 'f9000000-0000-4000-8000-000000000002',
  hodOther: 'f9000000-0000-4000-8000-000000000003',
  profB: 'f9000000-0000-4000-8000-000000000004',
};
const account = (id, role, department, reportsTo) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-FK0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: null, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'MATH', null),
  account(ID.profA, 'professor', 'MATH', ID.hod),
  account(ID.hodOther, 'hod', 'BIO', null),
  account(ID.profB, 'professor', 'BIO', ID.hodOther),
].map((a) => [a.id, a]));
const TOKENS = Object.fromEntries(Object.keys(ID).map((who) => [who, `tok-fk-${who}`]));
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
    throw new Error(`figkinds.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by figkinds.mjs: ${url.pathname}` }, 404);
};
// After the store is chosen, so the store stays in-process; only Auth goes to the stand-in.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'figkinds-test-service-key';

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
const get = (path, as) => call('GET', path, { as });
const post = (path, body, as) => call('POST', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });

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

/** The stored answer fields of every kind, and what a figure is made of: none may reach a phone. */
// Not `answers`: a grid's key, but also the count of answers a phone's own row
// rests on (PhoneRow.next.answers), and this room holds no grid.
const STORED = [
  'answerIds', 'placements', 'distractors', 'plotKey', 'lineKey', 'bars', 'values', 'spec', 'regions',
  'answerIdx', 'answerIdxs', 'answerBool', 'accept', 'rubric', 'pairs', 'buckets', 'blanks', 'sequence', 'tolerance',
];
const NEW = ['hotspot', 'label', 'plot', 'numberline', 'chart'];

// ------------------------------------------------------------- the bank --

console.log('\nthe bank: a professor writes a question of each kind');

const chapter = await post('/api/content', {
  title: 'Graphs and data',
  text: 'Straight lines\nA straight line can be written as y = mx + c.\nReading charts\nA bar chart shows one bar per category.',
});
check('a chapter is made', chapter.status === 201 || chapter.status === 200, JSON.stringify(chapter.body).slice(0, 200));
const contentId = chapter.body.contentId;

// A picture for the tap question, uploaded as any professor's image is.
const form = new FormData();
form.append('file', new Blob([PNG], { type: 'image/png' }), 'leaf.png');
form.append('contentId', contentId);
form.append('alt', 'A leaf with its stoma, a vein and its margin marked.');
const uploadRes = await fetch(`${base}/api/media`, { method: 'POST', headers: { authorization: `Bearer ${TOKENS.profA}` }, body: form });
const upload = (await uploadRes.json()).media ?? {};
check('a picture is uploaded for the chapter', uploadRes.status === 201 && /^\/api\/media\//.test(upload.url ?? ''), JSON.stringify(upload).slice(0, 200));

// Every part name is distinctive, so a name reaching a phone shows up in a plain search.
const GRAPH = {
  type: 'plot', title: 'Cells counted each day', x: { min: 0, max: 10, step: 1, label: 'Day' }, y: { min: 0, max: 20, step: 2, label: 'Cells' },
  functions: [{ id: 'trendline', family: 'linear', params: { m: 2, c: 0 } }],
  points: [{ id: 'dayonept', x: 1, y: 2 }, { id: 'oddreading', x: 4, y: 14 }, { id: 'daysixpt', x: 6, y: 12 }],
};
const SPEC = {
  hotspotGraph: {
    topic: 'Straight lines', bloom: 'analyse', kind: 'hotspot', text: 'Tap the reading that does not fit the trend.',
    stimulus: { kind: 'figure', spec: GRAPH }, answerIds: ['oddreading'],
  },
  hotspotPicture: {
    topic: 'Reading charts', bloom: 'remember', kind: 'hotspot', text: 'Tap the vein.',
    stimulus: {
      kind: 'image', url: upload.url, alt: 'A leaf with its stoma, a vein and its margin marked.',
      regions: [
        { id: 'stomazone', label: 'Stoma', points: [[10, 10], [30, 10], [20, 30]] },
        { id: 'veinzone', label: 'Vein', points: [[50, 50], [70, 50], [60, 80]] },
        { id: 'marginzone', label: 'Margin', points: [[80, 10], [95, 10], [90, 30]] },
      ],
    },
    answerIds: ['veinzone'],
  },
  label: {
    topic: 'Straight lines', bloom: 'understand', kind: 'label', text: 'Label the two marked temperatures.',
    stimulus: { kind: 'figure', spec: { type: 'numberline', min: -20, max: 120, step: 10, points: [{ id: 'freezemark', value: 0 }, { id: 'boilmark', value: 100 }] } },
    placements: [{ target: 'freezemark', label: 'Water freezes' }, { target: 'boilmark', label: 'Water boils' }],
    distractors: ['Body temperature'],
  },
  plotLine: {
    topic: 'Straight lines', bloom: 'apply', kind: 'plot', text: 'Draw y = 2x + 1 by placing two points on it.',
    stimulus: { kind: 'figure', spec: { type: 'plot', x: { min: -5, max: 5, step: 1 }, y: { min: -10, max: 10, step: 1 } } },
    plotKey: { place: 'line', function: { family: 'linear', params: { m: 2, c: 1 } } },
  },
  plotPoints: {
    topic: 'Straight lines', bloom: 'apply', kind: 'plot', text: 'Plot the points (1, 3) and (-2, 4).',
    stimulus: { kind: 'figure', spec: { type: 'plot', x: { min: -5, max: 5, step: 1 }, y: { min: -5, max: 5, step: 1 } } },
    plotKey: { place: 'points', points: [[1, 3], [-2, 4]] },
  },
  plotCreate: {
    topic: 'Straight lines', bloom: 'create', kind: 'plot', text: 'Draw any line with a negative slope that passes through (1, 1).',
    stimulus: { kind: 'figure', spec: { type: 'plot', x: { min: -5, max: 5, step: 1 }, y: { min: -5, max: 5, step: 1 } } },
    plotKey: { place: 'line', conditions: [{ rule: 'slope', sign: 'negative' }, { rule: 'through', point: [1, 1] }] },
  },
  numberline: {
    topic: 'Straight lines', bloom: 'apply', kind: 'numberline', text: 'Mark every x with -2 < x <= 3.',
    stimulus: { kind: 'figure', spec: { type: 'numberline', min: -5, max: 5, step: 1 } },
    lineKey: { intervals: [{ from: -2, to: 3, fromOpen: true }] },
  },
  chart: {
    topic: 'Reading charts', bloom: 'apply', kind: 'chart', text: 'A sample held 45 red cells, 30 white cells and 10 platelets. Set the bars.',
    bars: { categories: ['Red cells', 'White cells', 'Platelets'], max: 50, step: 5, label: 'Count' }, values: [45, 30, 10],
  },
};
const PART_NAMES = ['trendline', 'dayonept', 'oddreading', 'daysixpt', 'stomazone', 'veinzone', 'marginzone', 'freezemark', 'boilmark'];

const made = {};
for (const [name, body] of Object.entries(SPEC)) {
  const r = await post(`/api/bank/${contentId}/questions`, body);
  if (r.status === 201) made[name] = r.body.question;
  check(`${name}: saved, valid, as the professor's own`, r.status === 201 && invalidReason(r.body.question) === null && r.body.question.source === 'teacher',
    JSON.stringify(r.body).slice(0, 300));
}

const refuse = async (label, body, pattern) => {
  const r = await post(`/api/bank/${contentId}/questions`, body);
  check(label, r.status === 400 && pattern.test(r.body.error ?? ''), `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
};
await refuse('one right answer to place is not Create, and is refused in a sentence',
  { ...SPEC.plotPoints, bloom: 'create' }, /a plot at Create is drawn to conditions/);
await refuse('conditions that fix a single line are not Create either',
  { ...SPEC.plotCreate, plotKey: { place: 'line', conditions: [{ rule: 'through', point: [0, 1] }, { rule: 'through', point: [1, 3] }] } }, /more than one line/);
await refuse('a label the drawing already shows is refused',
  { ...SPEC.label, stimulus: { kind: 'figure', spec: { ...SPEC.label.stimulus.spec, points: [{ id: 'freezemark', value: 0, label: 'Water freezes' }, { id: 'boilmark', value: 100 }] } } },
  /already labels a part/);
await refuse('a tap on a part the graph does not have is refused', { ...SPEC.hotspotGraph, answerIds: ['nowhere'] }, /part the figure does not have/);
await refuse('bars the figure already draws are refused',
  { ...SPEC.chart, stimulus: { kind: 'figure', spec: { type: 'chart', chart: 'bar', categories: SPEC.chart.bars.categories, series: [{ values: [45, 30, 10] }] } } }, /already draws the bars/);
await refuse('a graph with nothing on it is refused where nothing is plotted on it',
  { topic: 'Straight lines', bloom: 'remember', kind: 'mcq', text: 'Which axis is x?', options: ['Across', 'Up', 'Down', 'Round'], answerIdx: 0, stimulus: SPEC.plotLine.stimulus }, /needs something on it/);
await refuse('a figure kind with no figure is refused', { ...SPEC.numberline, stimulus: undefined }, /number-line figure as its stimulus/);

const hodWrite = await post(`/api/bank/${contentId}/questions`, SPEC.chart, 'hod');
check('an HOD reads the chapter but may not write in it', hodWrite.status === 403, `${hodWrite.status}`);
const theirs = await post(`/api/bank/${contentId}/questions`, SPEC.chart, 'profB');
const nowhere = await post('/api/bank/0123456789abcdef01234567/questions', SPEC.chart, 'profB');
check('another professor gets the same 404 as a chapter that is not there', theirs.status === 404 && JSON.stringify(theirs.body) === JSON.stringify(nowhere.body));
check('a phone (no credential) never reaches the bank', (await post(`/api/bank/${contentId}/questions`, SPEC.chart, null)).status === 401);

const bank = await get(`/api/bank/${contentId}`);
const staffHot = (bank.body.questions ?? []).find((q) => String(q._id) === String(made.hotspotGraph?._id));
check('the professor\'s bank shows the tap figure drawn, its parts by name', Boolean(staffHot?.figure?.ok)
  && staffHot.figure.parts.some((p) => p.part === 'oddreading') && safeSvg(staffHot.figure.svg));

// ------------------------------------------------------- generation --

console.log('\ngeneration, offline: graph, number-line and bar-chart questions from the material\'s numbers');

const MATERIAL = [
  'Motion graphs',
  'The distance the cart travels is given by y = 2x + 3 for the first five seconds.',
  'A safe speed for the cart is between 10 and 40 units.',
  'Crop shares in the district were rice 45%, wheat 30% and maize 10% last year.',
  'A body at rest stays at rest unless a force acts on it.',
].join('\n');
const numbers = await post('/api/content', { title: 'Motion and data', text: MATERIAL });
const plan = { mix: { apply: 3 }, kindMix: { apply: { plot: 1, numberline: 1, chart: 1 } } };
const preview = await post('/api/generate/preview', { contentId: numbers.body.contentId, topics: ['Motion graphs'], plan });
check('the plan divides Apply over the three kinds', preview.status === 200
  && JSON.stringify(preview.body.plan?.perLevelKind?.apply) === JSON.stringify({ plot: 1, numberline: 1, chart: 1 }), JSON.stringify(preview.body.plan?.perLevelKind));
const gen = await post('/api/generate', { contentId: numbers.body.contentId, topics: ['Motion graphs'], plan });
const drafts = await repo.listQuestions(numbers.body.contentId, { includeDiscarded: true });
check('one draft of each, every one valid, offline and waiting for approval', gen.status === 200
  && JSON.stringify(drafts.map((q) => q.kind).sort()) === JSON.stringify(['chart', 'numberline', 'plot'])
  && drafts.every((q) => q.status === 'draft' && q.source === 'fallback' && invalidReason(q) === null),
`${gen.status} ${drafts.map((q) => q.kind).join()} ${JSON.stringify(gen.body).slice(0, 200)}`);
check('the reply says the templates made them from numbers the material states',
  (gen.body.warnings ?? []).some((w) => /made 1 graph and 1 number-line and 1 bar-chart questions from numbers the material states/.test(w)), (gen.body.warnings ?? []).join(' | '));
const genPlot = drafts.find((q) => q.kind === 'plot');
check('the graph question is the material\'s own equation', genPlot?.plotKey?.function?.params?.m === 2 && genPlot.plotKey.function.params.c === 3);

const bare = await post('/api/content', { title: 'Plants', text: 'Leaves\nPlants make food from light.\nLeaves are green because of chlorophyll.\nRoots take up water from the soil.' });
const bareGen = await post('/api/generate', { contentId: bare.body.contentId, topics: ['Leaves'], plan });
const bareDrafts = await repo.listQuestions(bare.body.contentId, { includeDiscarded: true });
check('material with no such numbers makes none of them, and the reply says which', bareGen.status === 200
  && bareDrafts.every((q) => !['plot', 'numberline', 'chart'].includes(q.kind))
  && (bareGen.body.warnings ?? []).some((w) => /could not make a graph or number-line or bar-chart question, because the material states no/.test(w)),
(bareGen.body.warnings ?? []).join(' | '));

// ------------------------------------------------------------ flags --

console.log('\na generated draft whose key the server read off its figure');

// The model's answer as it would arrive, through the real parsing code; only
// the call itself is left out.
const fixture = [{
  bloom: 'apply', kind: 'numeric', text: 'Read the number of cells on day 3 off the graph.', value: 7, unit: '',
  figure: { type: 'plot', x: { min: 0, max: 10, step: 1, label: 'Day' }, y: { min: 0, max: 20, step: 2, label: 'Cells' }, functions: [{ id: 'f', family: 'linear', params: { m: 2, c: 0 } }] },
  reading: { what: 'y-at', function: 0, x: 3 },
}];
const [item] = validateItems(fixture, 'Straight lines', { apply: 'numeric' }).valid;
const row = {
  contentId, topic: 'Straight lines', text: item.text, kind: item.kind, bloom: item.bloom, source: 'llm', status: 'draft', model: 'fixture',
  value: item.value, tolerance: item.tolerance, unit: item.unit, stimulus: item.stimulus,
};
row.checks = draftChecks(row, item);
const [flagged] = await repo.insertQuestions([row]);
check('the server keyed the draft from its graph', flagged.value === 6, `${flagged.value}`);
const approve = await post(`/api/bank/question/${flagged._id}/approve`, {});
const said = (approve.body.failedChecks ?? []).find((c) => c.id === 'figure-key');
check('approving it tells the professor, in a sentence, that the model said otherwise', approve.status === 200
  && /The model gave 7, but the figure gives 6 at x = 3, so the key is now 6/.test(said?.message ?? ''), JSON.stringify(approve.body).slice(0, 300));
const edited = await patch(`/api/bank/question/${flagged._id}`, { value: 6, tolerance: 0.5 });
check('once the professor sets the key, the finding no longer describes the question and is gone', edited.status === 200
  && !(edited.body.question?.checks ?? []).some((c) => c.id === 'figure-key'), JSON.stringify(edited.body.question?.checks ?? edited.body).slice(0, 300));

// ------------------------------------------------------------- the room --

console.log('\nthe room: phones answer each new kind through the real socket');

const ids = Object.values(made).map((q) => String(q._id));
const byId = new Map((await repo.listQuestions(contentId)).map((q) => [String(q._id), q]));
const room = await post('/api/session', { contentId, title: 'Graphs period', questionIds: ids });
check('a room opens on the new questions', (room.status === 201 || room.status === 200) && Boolean(room.body.code), `${room.status} ${JSON.stringify(room.body).slice(0, 200)}`);
const code = room.body.code;

/** What a phone sends for the right answer. A tap or label is worked out from this student's tokens, which only the server can read. */
function rightFor(q, shown, roll) {
  const seed = `${roll}:${q._id}`;
  switch (q.kind) {
    case 'hotspot': return score(q, [], seed).solution;
    case 'label': return score(q, {}, seed).solution;
    case 'plot':
      if (q.plotKey.points) return q.plotKey.points;
      if (q.plotKey.function) return [[0, q.plotKey.function.params.c], [2, 2 * q.plotKey.function.params.m + q.plotKey.function.params.c]];
      return [[0, 2], [2, 0]];
    case 'numberline': return q.lineKey;
    case 'chart': return q.values;
    default: return null;
  }
}
/** A wrong answer, in the same shape. */
function wrongFor(q, shown, roll) {
  const right = rightFor(q, shown, roll);
  switch (q.kind) {
    case 'hotspot': return shown.zones.map((z) => z.zone).filter((z) => !right.includes(z));
    case 'label': {
      const zones = Object.keys(right);
      return Object.fromEntries(zones.map((z, i) => [z, right[zones[(i + 1) % zones.length]]]));
    }
    case 'plot': return [[-4, -4], [-3, 4]];
    case 'numberline': return { rays: [{ from: 4, direction: 'left' }] };
    case 'chart': return q.values.map((v) => (v + 20 > 50 ? v - 20 : v + 20));
    default: return null;
  }
}

const everything = [];
async function play(roll, answerOf) {
  const s = await connect();
  const saw = [];
  s.onAny((event, payload) => { saw.push({ event, payload }); everything.push({ event, payload }); });
  const first = either(s, ['server:question', 'server:exhausted', 'session:rejected']);
  s.emit('student:join', { code, rollNo: roll, name: roll });
  let event = await first;
  const seen = [];
  for (let i = 0; i < 40 && event.name === 'server:question'; i += 1) {
    const shown = event.payload.question;
    const q = byId.get(String(shown._id));
    const result = either(s, ['server:result', 'session:rejected', 'server:kept']);
    s.emit('student:answer', { questionId: shown._id, response: answerOf(q, shown, roll), answerId: `figk-${roll}-${String(i).padStart(4, '0')}` });
    const r = await result;
    seen.push({ q, shown, result: r.payload });
    const nextQ = either(s, ['server:question', 'server:exhausted']);
    s.emit('student:next');
    event = await nextQ;
  }
  const packWait = either(s, ['server:pack']);
  s.emit('student:pack', {});
  await packWait.catch(() => null);
  s.close();
  return { seen, ended: event.name, saw };
}

const right = await play('FK-1', rightFor);
check('every new question is served to the phone, and nothing else', right.ended === 'server:exhausted'
  && right.seen.length === ids.length && right.seen.every((x) => x.q && NEW.includes(x.q.kind)), `${right.seen.length} of ${ids.length}`);
for (const kind of NEW) {
  const mine = right.seen.filter((x) => x.q?.kind === kind);
  check(`${kind}: the phone's right answer is marked 1 by the server`, mine.length > 0 && mine.every((x) => x.result.score === 1 && x.result.correct === true),
    mine.map((x) => `${x.result.score} ${x.result.detail ?? ''}`).join('; '));
}
const shownOf = (name) => right.seen.find((x) => String(x.q?._id) === String(made[name]?._id))?.shown;
check('a tap question carries its figure under tokens and its zones only', (() => {
  const s = shownOf('hotspotGraph');
  return s && safeSvg(s.stimulus?.svg) && s.zones?.length === 4 && s.zones.every((z) => /^z\d+$/.test(z.zone) && Object.keys(z).length === 1);
})(), JSON.stringify(shownOf('hotspotGraph')?.zones));
check('a tap on a picture carries the picture and each zone\'s outline, never its name or label', (() => {
  const s = shownOf('hotspotPicture');
  return s && s.stimulus?.kind === 'image' && s.stimulus.url === upload.url && s.zones?.length === 3 && s.zones.every((z) => Array.isArray(z.points) && Object.keys(z).length === 2);
})(), JSON.stringify(shownOf('hotspotPicture')));
check('a label question carries the labels to place, the extra one among them', (() => {
  const s = shownOf('label');
  return s && [...s.labels].sort().join() === 'Body temperature,Water boils,Water freezes' && s.zones.length === 2;
})());
check('a plot question carries the grid and what to place', shownOf('plotCreate')?.place === 'line' && shownOf('plotPoints')?.place === 'points'
  && shownOf('plotLine')?.grid?.x?.step === 1 && shownOf('plotLine').grid.frame.right > shownOf('plotLine').grid.frame.left);
check('a number-line question carries the line and its ticks', shownOf('numberline')?.grid?.step === 1 && shownOf('numberline').grid.min === -5);
check('a chart question carries the empty chart', JSON.stringify(shownOf('chart')?.board?.categories) === JSON.stringify(SPEC.chart.bars.categories) && shownOf('chart').board.max === 50);

// One student per kind, wrong on that kind only (a student wrong on everything
// drops into the below-40% band and is never served above Understand).
const rolls = {};
for (const kind of NEW) {
  const roll = `FK-W-${kind.toUpperCase()}`;
  rolls[kind] = roll;
  const wrong = await play(roll, (q, shown, r) => (q.kind === kind ? wrongFor(q, shown, r) : rightFor(q, shown, r)));
  const mine = wrong.seen.filter((x) => x.q?.kind === kind);
  check(`${kind}: a wrong answer is marked 0`, mine.length === Object.values(made).filter((q) => q.kind === kind).length
    && mine.every((x) => x.result.score === 0 && x.result.correct === false), `${mine.length}: ${mine.map((x) => `${x.result.score} ${x.result.detail ?? ''}`).join('; ')}`);
}

const stored = (await get(`/api/session/${code}/answers?limit=200`)).body.items ?? [];
const of = (roll) => stored.filter((a) => a.student?.rollNo === roll);
check('every attempt is stored as evidence, with its kind and its mark', of('FK-1').length === ids.length && of('FK-1').every((a) => a.score === 1)
  && NEW.every((kind) => of(rolls[kind]).length > 0 && of(rolls[kind]).every((a) => (a.kind === kind ? a.score === 0 : a.score === 1))),
`${of('FK-1').length} right; ${NEW.map((k) => of(rolls[k]).length).join('+')}`);
const tapRow = stored.find((a) => a.student?.rollNo === 'FK-1' && a.kind === 'hotspot');
check('the response is kept exactly as the phone sent it', Array.isArray(tapRow?.response) && tapRow.response.every((t) => /^z\d+$/.test(t)), JSON.stringify(tapRow?.response));
const tapped = stored.filter((a) => a.student?.rollNo === 'FK-1' && a.kind === 'hotspot').map((a) => a.parts?.tapped?.join()).sort();
check('the professor reads a tap answer as the parts\' own names', JSON.stringify(tapped) === JSON.stringify(['oddreading', 'veinzone']), JSON.stringify(tapped));
const placedRow = stored.find((a) => a.student?.rollNo === rolls.label && a.kind === 'label');
check('and a label answer as the label put on each part', JSON.stringify(placedRow?.parts?.placed)
  === JSON.stringify([{ part: 'freezemark', label: 'Water boils' }, { part: 'boilmark', label: 'Water freezes' }]), JSON.stringify(placedRow?.parts));

// ------------------------------------------------------ the payload scan --

console.log('\nevery payload a phone got');

const before = everything.filter((e) => e.event !== 'server:result');
const results = everything.filter((e) => e.event === 'server:result');
const beforeKeys = keysIn(before);
check(`nothing a phone got before answering carries a stored answer field or a solution (${before.length} payloads)`,
  ![...STORED, 'solution'].some((k) => beforeKeys.has(k)), [...STORED, 'solution'].filter((k) => beforeKeys.has(k)).join());
const resultKeys = keysIn(results);
check(`a result carries the solution as the phone was shown it, and no stored field (${results.length} results)`,
  results.length > 0 && !STORED.some((k) => resultKeys.has(k)), STORED.filter((k) => resultKeys.has(k)).join());
const wire = JSON.stringify(everything).toLowerCase();
check('no part\'s own name reached any phone, in any payload', PART_NAMES.every((n) => !wire.includes(n)), PART_NAMES.filter((n) => wire.includes(n)).join());
check('the regions\' labels stayed with the professor', !/"(stoma|margin)"/i.test(JSON.stringify(everything)));
const packs = everything.filter((e) => e.event === 'server:pack');
check(`the offline pack was asked for and carries no key (${packs.length} packs)`, packs.length === NEW.length + 1
  && ![...STORED, 'solution'].some((k) => keysIn(packs).has(k)));
const svgs = svgsIn(everything);
check(`every SVG a phone got is drawing only (${svgs.length} checked)`, svgs.length > 0 && svgs.every(safeSvg));

// ------------------------------------------------------------------ end --

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);
console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore?.();
process.exit(fail ? 1 : 0);
