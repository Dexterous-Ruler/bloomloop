// Batch 9: answer kinds, end to end (decisions E1, E3 and E4).
//
//   node server/scripts/answerkinds.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, and checks:
//
//   E1, the hub     a room not yet closed closes EVERY question of its set in the
//                   Learning Hub before any phone is served one: practice never
//                   serves it, an answer to it is refused with the sentence that
//                   says why, and a self-test built then leaves it out. Paused,
//                   it stays closed; the moment the room is closed it opens.
//   E3, lengths     a professor writes a long answer and edits one; a bad length
//                   is refused; the labels are "Short answer" and "Long answer";
//                   a phone is told the length and the word limit and never the
//                   rubric; an answer over the limit is refused with a sentence
//                   before anything is marked or stored, one within it is marked
//                   provisionally and goes to the review queue, labelled
//   E4, drawings    a phone draws, uploads (PNG, metadata taken out) and answers;
//                   a JPEG, an SVG, a picture over the cap and a drawing for a
//                   question not on the phone's screen are refused; the answer
//                   waits, unmarked, for the professor; staff see the picture
//                   and nobody else does; the professor cannot "confirm" it but
//                   marks it, and only then does the level and attainment count
//                   it; another phone cannot answer with this phone's drawing,
//                   nor for a question not on its screen; the hub takes a
//                   practice drawing inside its attempt, unmarked, readable by
//                   the student and their professor; the room's archive keeps
//                   the reference and says the picture is not in it
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As
// server/scripts/roster.mjs and practice.mjs do, the server is pointed at
// http://supabase.invalid and every request to it is answered here, in-process;
// any other request off this machine is refused and counted. Never calls
// Gemini, Supabase or any network service. Exits non-zero on any failure.

import http from 'node:http';
import zlib from 'node:zlib';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { CLOSED_SENTENCE } = await import(`${SRC}services/hubClosed.js`);
const {
  AWAITING_DETAIL, DRAWING_MAX_BYTES, DRAWING_NOT_HERE, DRAWING_NOT_YOURS, DRAWING_SVG, DRAWING_TOO_BIG, HUB_DRAWING_NOTE,
} = await import(`${SRC}services/drawings.js`);
const { DRAWINGS_NOTE } = await import(`${SRC}services/archive.js`);
const { DRAWING_NO_CONFIRM } = await import(`${SRC}routes/review.js`);
const { DRAWING_ONLY, OPEN_LENGTHS } = await import(`${SRC}questionTypes.js`);
const { serveToken: signServed } = await import(`${SRC}services/serveTokens.js`);

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
// HOD (CSE) <- professor A <- Asha (21CS01) and Bilal (21CS02), on the roster.
// Another HOD (ECE) <- professor B, who reads nothing of A's.

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'b9000000-0000-4000-8000-000000000001',
  profA: 'b9000000-0000-4000-8000-000000000002',
  profB: 'b9000000-0000-4000-8000-000000000003',
  hodOther: 'b9000000-0000-4000-8000-000000000004',
  asha: 'b9000000-0000-4000-8000-000000000005',
  bilal: 'b9000000-0000-4000-8000-000000000006',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-AKD0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-20T04:00:00+00:00', updated_at: '2026-11-20T04:00:00+00:00',
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
    throw new Error(`answerkinds.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by answerkinds.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'answerkinds-test-service-key';

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

/** `as`: one of the TOKENS' names, or null for no credentials. */
async function call(method, path, { body, as = 'profA', raw = false } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (raw) return { status: res.status, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  return { status: res.status, body: parsed, text };
}
const get = (path, as) => call('GET', path, { as });
// Practice answers carry the serve token the hub's reply gave (Batch 8); this
// script tests other things, so it signs the token the server would have sent.
const served = (path, body, as) => (path === '/api/hub/practice/attempts' && body?.questionId && ID[as]
  ? { ...body, serveToken: signServed({ accountId: ID[as], questionId: body.questionId, mode: body.mode ?? 'practice' }) }
  : body);
const post = (path, body, as) => call('POST', path, { body: served(path, body, as), as });
const put = (path, body, as) => call('PUT', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });
const del = (path, as) => call('DELETE', path, { as });
const image = (path, as) => call('GET', path, { as, raw: true });

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
    const handlers = {};
    const timer = setTimeout(() => {
      for (const e of list) socket.off(e, handlers[e]);
      reject(new Error(`timeout waiting for ${list.join('/')}`));
    }, ms);
    for (const e of list) {
      handlers[e] = (p) => {
        clearTimeout(timer);
        for (const other of list) socket.off(other, handlers[other]);
        resolve({ event: e, payload: p });
      };
      socket.on(e, handlers[e]);
    }
  });
}

/** Send and wait for the first of `events`. */
async function ask(socket, event, payload, events) {
  const waiting = next(socket, events);
  socket.emit(event, payload);
  return waiting;
}

// ------------------------------------------------------------ pictures --

/** A PNG chunk, with its CRC. */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
const ONE_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// The same picture with a text chunk a drawing app might write (the author's name).
const WITH_TEXT = Buffer.concat([ONE_PIXEL.subarray(0, 33), chunk('tEXt', Buffer.from('Author\0Asha Kulkarni', 'latin1')), ONE_PIXEL.subarray(33)]);
const dataUrl = (buf, type = 'image/png') => `data:${type};base64,${buf.toString('base64')}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
// A real PNG signature and header, with a private chunk making it larger than any drawing may be.
const HUGE = Buffer.concat([ONE_PIXEL.subarray(0, 33), chunk('zzZz', Buffer.alloc(DRAWING_MAX_BYTES + 1024, 7)), ONE_PIXEL.subarray(33)]);
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

// ------------------------------------------------------------- the material --

console.log('\nsetting up: a chapter, a class on the hub, and questions of every new kind');

const made = await post('/api/content', { title: 'Cell biology', text: 'Cells\nMembranes' });
const contentId = made.body.contentId;
await patch(`/api/content/${contentId}`, { topics: ['Cells', 'Membranes'] });
const records = Object.fromEntries((await repo.listChapterTopics(contentId)).map((t) => [t.name, String(t._id)]));
const CELLS = records.Cells;

const [mcqA, mcqB, mcqC] = await repo.insertQuestions(['A', 'B', 'C'].map((x) => ({
  contentId, topic: 'Cells', text: `Cells ${x}: which organelle releases energy?`, kind: 'mcq',
  options: ['Mitochondrion', 'Ribosome', 'Golgi body', 'Lysosome'], answerIdx: 0, bloom: 'remember', source: 'teacher', status: 'active',
})));
const [openShort, openLong, drawQ, drawNoText] = await repo.insertQuestions([
  { contentId, topic: 'Cells', text: 'Name what a cell wall does.', kind: 'open', rubric: ['support the cell', 'keeps shape'],
    bloom: 'create', source: 'teacher', status: 'active' },
  { contentId, topic: 'Cells', text: 'Design an experiment to show osmosis in potato strips.', kind: 'open', length: 'long',
    rubric: ['control strip in plain water', 'measure mass change'], bloom: 'create', source: 'teacher', status: 'active' },
  { contentId, topic: 'Cells', text: 'Draw a plant cell and label its wall, membrane and nucleus.', kind: 'drawing',
    rubric: ['KEYDRAW wall outside the membrane'], allowText: true, bloom: 'create', source: 'teacher', status: 'active' },
  { contentId, topic: 'Cells', text: 'Draw the path water takes into a root hair cell.', kind: 'drawing',
    bloom: 'evaluate', source: 'teacher', status: 'active' },
]);
const id = (q) => String(q._id);

const classId = (await post('/api/classes', { courseName: 'Biology', section: 'FY A' })).body.class.id;
await post(`/api/classes/${classId}/students`, { students: [{ roll: '21CS01', name: 'Asha' }, { roll: '21CS02', name: 'Bilal' }] });
check('the chapter is placed on the class\'s hub', (await put(`/api/hub/classes/${classId}/chapters/${contentId}`, {})).status === 201);
const ashaRow = (await repo.listClassStudents(classId)).find((s) => s.rollNo === '21CS01');

// --------------------------------------------------------------- E1 --

console.log('\nE1: a room not yet closed closes its whole set in the hub, and opens it on close');
{
  const room = await post('/api/session', { contentId, classId, questionIds: [id(mcqA)] });
  check('a room opens on a set of one question, and no phone has joined', room.status === 201 || room.status === 200, JSON.stringify(room.body));
  const tryA = (key) => post('/api/hub/practice/attempts', { attemptId: key, questionId: id(mcqA), topicId: CELLS, response: 0 }, 'asha');
  const refused = await tryA('e1-open-0001');
  check('before any phone is served it, an answer to it in practice is refused with the sentence that says why',
    refused.status === 409 && refused.body.error === CLOSED_SENTENCE.room, JSON.stringify(refused.body));
  check('the sentence says the question is part of a class still running and opens when the professor closes it',
    /part of a class that is still running/.test(CLOSED_SENTENCE.room) && /opens when your professor closes the class/.test(CLOSED_SENTENCE.room));
  const seen = new Set();
  for (let i = 0; i < 4; i += 1) {
    const out = await get(`/api/hub/practice/next?topicId=${CELLS}`, 'asha');
    if (out.body.question) seen.add(out.body.question._id);
    // Answered, so practice moves on; a drawing is left unanswered here (the hub's drawings are tested below).
    if (out.body.question && out.body.question.kind !== 'drawing') {
      await post('/api/hub/practice/attempts', {
        attemptId: `e1-next-000${i}`, questionId: out.body.question._id, topicId: CELLS,
        response: out.body.question.kind === 'mcq' ? 1 : 'a cell wall',
      }, 'asha');
    }
  }
  check('practice never serves it while the room runs', seen.size > 0 && !seen.has(id(mcqA)), JSON.stringify([...seen]));
  const exam = await post('/api/hub/exams', { clientRunId: 'e1-exam-00001', topicIds: [CELLS], count: 30 }, 'asha');
  const examRun = await repo.getHubRunByKey(ID.asha, 'e1-exam-00001');
  const listed = (examRun?.spec?.questions ?? []).map((x) => x.questionId);
  check('a self-test built while it runs leaves it out (and leaves out every drawing, which the hub cannot mark)',
    exam.status === 201 && listed.length > 0 && !listed.includes(id(mcqA)) && !listed.includes(id(drawQ)) && !listed.includes(id(drawNoText)),
    JSON.stringify({ status: exam.status, listed }));
  await post(`/api/hub/exams/${examRun?._id}/submit`, {}, 'asha');
  const paused = await post(`/api/session/${room.body.code}/pause`, {});
  const whilePaused = await tryA('e1-paused-001');
  check('paused, the room keeps it closed', paused.status === 200 && whilePaused.status === 409, JSON.stringify(whilePaused.body));
  await post(`/api/session/${room.body.code}/resume`, {});
  const closed = await post(`/api/session/${room.body.code}/close`, {});
  const opened = await tryA('e1-closed-001');
  check('the moment the room is closed, it opens: the same answer is taken and marked',
    closed.status === 200 && opened.status === 201 && opened.body.correct === true, JSON.stringify(opened.body));
}

// --------------------------------------------------------------- E3 (bank) --

console.log('\nE3: short and long written answers in the bank');
{
  const bank = await get(`/api/bank/${contentId}`);
  check('the bank says what each length is called and how many words it takes',
    JSON.stringify(bank.body.kinds?.openLengths) === JSON.stringify(OPEN_LENGTHS)
    && bank.body.kinds.openLengths.short.label === 'Short answer' && bank.body.kinds.openLengths.long.maxWords === 600);
  const labelOf = (q) => bank.body.questions.find((x) => x._id === id(q))?.kindLabel;
  check('each written question is labelled by its length; one without a length is a short answer',
    labelOf(openShort) === 'Short answer' && labelOf(openLong) === 'Long answer' && labelOf(drawQ) === 'Draw your answer',
    JSON.stringify([labelOf(openShort), labelOf(openLong), labelOf(drawQ)]));
  const mine = await post(`/api/bank/${contentId}/questions`, {
    topic: 'Membranes', bloom: 'create', kind: 'open', length: 'long', text: 'Argue whether a membrane is a wall.',
    rubric: ['selectively permeable', 'no rigid support'],
  });
  check('a professor writes a long answer of their own', mine.status === 201 && mine.body.question.length === 'long'
    && mine.body.question.kindLabel === 'Long answer', JSON.stringify(mine.body));
  const bad = await post(`/api/bank/${contentId}/questions`, {
    topic: 'Membranes', bloom: 'create', kind: 'open', length: 'medium', text: 'Explain diffusion.', rubric: ['high to low', 'no energy'],
  });
  check('a length other than short or long is refused with the validator\'s words', bad.status === 400 && /short or long/.test(bad.body.error),
    JSON.stringify(bad.body));
  const edited = await patch(`/api/bank/question/${mine.body.question._id}`, { length: 'short' });
  check('and edits it to a short one', edited.status === 200 && (await repo.getQuestion(mine.body.question._id)).length === 'short',
    JSON.stringify(edited.body));
  const drawn = await post(`/api/bank/${contentId}/questions`, {
    topic: 'Membranes', bloom: 'apply', kind: 'drawing', text: 'Draw the fluid mosaic model.', allowText: false,
  });
  check('a professor writes a drawing question at Apply', drawn.status === 201 && drawn.body.question.kind === 'drawing', JSON.stringify(drawn.body));
  const low = await post(`/api/bank/${contentId}/questions`, { topic: 'Membranes', bloom: 'remember', kind: 'drawing', text: 'Draw a cell.' });
  check('and a drawing at Remember is refused: the level chooses the interaction', low.status === 400, JSON.stringify(low.body));
  // Left out of the room below.
  await patch(`/api/bank/question/${drawn.body.question._id}`, { status: 'discarded' });
  await patch(`/api/bank/question/${mine.body.question._id}`, { status: 'discarded' });
}

// ------------------------------------------------- E3 and E4 in a room --

console.log('\nE3 and E4 in a room: limits, a drawing, the review, and the mark that counts');

const room = await post('/api/session', {
  contentId, classId, questionIds: [id(openShort), id(openLong), id(drawQ), id(mcqB), id(mcqC)], startLevel: 'create', adapt: false,
});
const CODE = room.body.code;
const SESSION = room.body.sessionId;
check('a room opens on the written and drawing questions, at Create', Boolean(CODE), JSON.stringify(room.body));

const asha = await connect();
const joined = await ask(asha, 'student:join', { code: CODE, rollNo: '21CS01', name: 'Asha', token: TOKENS.asha }, ['server:question', 'server:exhausted']);
let current = joined.payload.question;
let drawingMedia = null;
let drawingAnswered = false;
const seenKinds = new Set();
const RUBRIC_LEAK = /rubric|KEYDRAW|support the cell|control strip/;

for (let turn = 0; turn < 3 && current; turn += 1) {
  seenKinds.add(current.kind);
  check(`the phone's ${current.kind} question carries no rubric`, !RUBRIC_LEAK.test(JSON.stringify(current)), JSON.stringify(current));
  if (current.kind === 'open') {
    const long = current._id === id(openLong);
    const limit = long ? 600 : 60;
    check(`the phone is told it is a ${long ? 'long' : 'short'} answer of at most ${limit} words`,
      current.length === (long ? 'long' : 'short') && current.maxWords === limit, JSON.stringify(current));
    const before = (await repo.listAnswers({ sessionId: SESSION })).length;
    const over = await ask(asha, 'student:answer', { questionId: current._id, response: words(limit + 1), answerId: `ak-over-${turn}-0001` },
      ['server:refused', 'server:result']);
    check(`${limit + 1} words are refused with a sentence, before anything is marked or stored`,
      over.event === 'server:refused' && new RegExp(`has ${limit + 1} words.*at most ${limit}`).test(over.payload.message)
      && over.payload.answerId === `ak-over-${turn}-0001` && (await repo.listAnswers({ sessionId: SESSION })).length === before,
      JSON.stringify(over.payload));
    const text = long ? `${words(300)} control strip in plain water, measure mass change` : 'It gives support to the cell and keeps its shape.';
    const answered = await ask(asha, 'student:answer', { questionId: current._id, response: text, answerId: `ak-open-${turn}-0001` },
      ['server:result', 'server:refused']);
    check(`within the limit it is marked provisionally, by the rubric, as before`,
      answered.event === 'server:result' && answered.payload.provisional === true && typeof answered.payload.correct === 'boolean',
      JSON.stringify(answered.payload));
  } else if (current.kind === 'drawing') {
    check('the phone is told whether words may go with the drawing, and how many', current.allowText === true && current.maxWords === 600,
      JSON.stringify(current));
    const jpeg = await ask(asha, 'student:drawing', { questionId: current._id, image: dataUrl(JPEG, 'image/png'), answerId: 'ak-draw-jpeg01' },
      ['drawing:refused', 'drawing:stored']);
    check('a JPEG is refused, whatever the phone says it is', jpeg.event === 'drawing:refused', JSON.stringify(jpeg.payload));
    const svg = await ask(asha, 'student:drawing', { questionId: current._id, image: dataUrl(SVG, 'image/png'), answerId: 'ak-draw-svg001' },
      ['drawing:refused', 'drawing:stored']);
    check('an SVG is refused, saying why', svg.event === 'drawing:refused' && svg.payload.message === DRAWING_SVG, JSON.stringify(svg.payload));
    const huge = await ask(asha, 'student:drawing', { questionId: current._id, image: HUGE, answerId: 'ak-draw-huge01' },
      ['drawing:refused', 'drawing:stored'], 8000);
    check(`a picture over ${Math.round(DRAWING_MAX_BYTES / 1024)} KB is refused`, huge.event === 'drawing:refused'
      && huge.payload.message === DRAWING_TOO_BIG, JSON.stringify(huge.payload));
    const elsewhere = await ask(asha, 'student:drawing', { questionId: id(drawNoText), image: dataUrl(ONE_PIXEL), answerId: 'ak-draw-else01' },
      ['drawing:refused', 'drawing:stored']);
    check('a drawing for a question not on this phone\'s screen is refused', elsewhere.event === 'drawing:refused'
      && elsewhere.payload.message === DRAWING_NOT_HERE, JSON.stringify(elsewhere.payload));
    const stored = await ask(asha, 'student:drawing', { questionId: current._id, image: dataUrl(WITH_TEXT), answerId: 'ak-draw-asha01' },
      ['drawing:stored', 'drawing:refused']);
    drawingMedia = stored.payload.mediaId;
    check('the drawing is kept for the room, and the reply names it', stored.event === 'drawing:stored' && Boolean(drawingMedia)
      && stored.payload.answerId === 'ak-draw-asha01', JSON.stringify(stored.payload));
    const again = await ask(asha, 'student:drawing', { questionId: current._id, image: dataUrl(WITH_TEXT), answerId: 'ak-draw-asha01' },
      ['drawing:stored', 'drawing:refused']);
    check('sent again under the same id, the same drawing comes back and no second is kept',
      again.payload.mediaId === drawingMedia && (await repo.listDrawings({ sessionId: SESSION })).length === 1);
    const kept = await repo.getMedia(drawingMedia, { withData: true });
    check('kept as a PNG with its metadata taken out (no text chunk, no author)', kept.mime === 'image/png'
      && !kept.data.includes(Buffer.from('tEXt')) && !kept.data.includes(Buffer.from('Asha Kulkarni')) && kept.bytes === ONE_PIXEL.length,
    JSON.stringify({ mime: kept.mime, bytes: kept.bytes }));
    const noText = await ask(asha, 'student:answer', { questionId: current._id, response: { mediaId: drawingMedia, text: words(601) },
      answerId: 'ak-draw-asha01' }, ['server:refused', 'server:result']);
    check('words over the limit beside a drawing are refused before marking', noText.event === 'server:refused', JSON.stringify(noText.payload));
    const answered = await ask(asha, 'student:answer', { questionId: current._id,
      response: { mediaId: drawingMedia, text: 'The wall is outside the membrane.' }, answerId: 'ak-draw-asha01' }, ['server:result', 'server:refused']);
    check('the answer names the drawing and waits for the professor: no mark, no key, the detail that it waits',
      answered.event === 'server:result' && answered.payload.awaitingReview === true && answered.payload.correct === null
      && answered.payload.score === null && answered.payload.solution === null && answered.payload.detail === AWAITING_DETAIL,
      JSON.stringify(answered.payload));
    drawingAnswered = true;
  }
  const nextQ = await ask(asha, 'student:next', {}, ['server:question', 'server:exhausted']);
  current = nextQ.event === 'server:question' ? nextQ.payload.question : null;
}
check('the phone met both written lengths and the drawing', seenKinds.has('open') && seenKinds.has('drawing') && drawingAnswered,
  JSON.stringify([...seenKinds]));

const rowOf = async () => (await repo.listAnswers({ sessionId: SESSION })).find((a) => a.kind === 'drawing' && a.final !== false);
const drawRow = await rowOf();
check('the drawing\'s answer row keeps { mediaId, text }, unmarked and provisional, with the detail that it waits',
  drawRow?.response?.mediaId === drawingMedia && drawRow.response.text === 'The wall is outside the membrane.' && drawRow.correct == null
  && drawRow.score == null && drawRow.reviewStatus === 'provisional' && drawRow.detail === AWAITING_DETAIL, JSON.stringify(drawRow));
const levelsNow = async () => (await repo.getProfile(SESSION, '21CS01')).levels.create;
const beforeReview = await levelsNow();
check('the ladder does not count it yet: Create holds the two written answers only', beforeReview.seen === 2, JSON.stringify(beforeReview));

// Another phone cannot use Asha's drawing, nor answer a question not on its screen.
// Bilal's phone was given the short answer before it dropped: the server's pin
// says so, and his join resumes it, so the drawing question is not on his screen.
await repo.saveProfile({
  sessionId: SESSION, rollNo: '21CS02', name: 'Bilal', levels: {}, workingLevel: 'create', history: [],
  served: { questionId: id(openShort), at: new Date().toISOString(), reason: '' },
});
const bilal = await connect();
const bj = await ask(bilal, 'student:join', { code: CODE, rollNo: '21CS02', name: 'Bilal' }, ['server:question', 'server:exhausted']);
let bq = bj.payload.question;
check('Bilal\'s phone resumes the short answer it was given', bq?._id === id(openShort), JSON.stringify(bq));
{
  const offScreen = await ask(bilal, 'student:drawing', { questionId: id(drawQ), image: dataUrl(ONE_PIXEL), answerId: 'ak-draw-bil001' },
    ['drawing:refused', 'drawing:stored']);
  check('another phone cannot keep a drawing for a question not on its screen', offScreen.event === 'drawing:refused'
    && offScreen.payload.message === DRAWING_NOT_HERE, JSON.stringify(offScreen.payload));
  const notOnScreen = await ask(bilal, 'student:answer', { questionId: id(drawQ), response: { mediaId: drawingMedia }, answerId: 'ak-draw-bil002' },
    ['server:refused', 'server:result', 'server:question']);
  check('nor answer one not on its screen, even naming a drawing that exists', notOnScreen.event === 'server:refused'
    && notOnScreen.payload.message === DRAWING_NOT_YOURS, JSON.stringify(notOnScreen.payload));
  // Move Bilal on to the drawing question itself.
  for (let i = 0; i < 4 && bq && bq._id !== id(drawQ); i += 1) {
    const response = bq.kind === 'open' ? 'support and shape' : 0;
    await ask(bilal, 'student:answer', { questionId: bq._id, response, answerId: `ak-bil-move-${i}` }, ['server:result', 'server:refused']);
    const nq = await ask(bilal, 'student:next', {}, ['server:question', 'server:exhausted']);
    bq = nq.event === 'server:question' ? nq.payload.question : null;
  }
}
check('Bilal reaches the drawing question', bq?._id === id(drawQ), JSON.stringify(bq));
const theft = await ask(bilal, 'student:answer', { questionId: id(drawQ), response: { mediaId: drawingMedia, text: 'mine' }, answerId: 'ak-draw-bil003' },
  ['server:refused', 'server:result']);
check('with the question on his screen, he still cannot answer with Asha\'s drawing', theft.event === 'server:refused'
  && theft.payload.message === DRAWING_NOT_YOURS, JSON.stringify(theft.payload));
check('nothing of his was stored for the drawing question', !(await repo.listAnswers({ sessionId: SESSION }))
  .some((a) => a.rollNo === '21CS02' && a.kind === 'drawing'));

// Who sees the picture: staff of the room only.
const url = `/api/media/${drawingMedia}`;
const [byProf, byHod, byNone, byOther, byStudent] = await Promise.all([
  image(url, 'profA'), image(url, 'hod'), image(url, null), image(url, 'profB'), image(url, 'asha'),
]);
check('the room\'s professor reads the picture, as the PNG kept', byProf.status === 200 && byProf.type === 'image/png'
  && byProf.bytes.equals(ONE_PIXEL), `${byProf.status} ${byProf.type}`);
check('the department\'s HOD reads it (read-only)', byHod.status === 200);
check('a phone with no credential, another professor and a student get the same 404',
  [byNone.status, byOther.status, byStudent.status].every((s) => s === 404), JSON.stringify([byNone.status, byOther.status, byStudent.status]));

// The review queue.
const queue = await get(`/api/review?code=${CODE}&status=provisional`);
const qDraw = queue.body.items?.find((x) => x.kind === 'drawing');
const qOpen = (queue.body.items ?? []).filter((x) => x.kind === 'open' && x.student.rollNo === '21CS01');
check('the queue holds the drawing, with its picture\'s address and the words beside it', qDraw?.drawing?.mediaId === drawingMedia
  && qDraw.drawing.url === url && qDraw.text === 'The wall is outside the membrane.' && qDraw.kindLabel === 'Draw your answer',
  JSON.stringify(qDraw));
check('and the written answers, each labelled by its length', qOpen.length === 2
  && qOpen.map((x) => x.kindLabel).sort().join() === 'Long answer,Short answer' && qOpen.every((x) => x.maxWords === (x.length === 'long' ? 600 : 60)),
  JSON.stringify(qOpen.map((x) => [x.kindLabel, x.length, x.maxWords])));
const report = async () => (await get(`/api/classes/${classId}/attainment/students/${ashaRow._id}`)).body;
const before = (await report()).answers?.find((a) => a.kind === 'drawing');
check('attainment does not count it before a professor marks it, and says so', before && before.chosen === false && before.counts === false
  && /Not counted yet: a drawing/.test(before.note), JSON.stringify(before));
const confirm = await post(`/api/review/${qDraw?.answerId}`, { decision: 'confirm' });
check('a drawing cannot be confirmed: there is no machine mark', confirm.status === 409 && confirm.body.error === DRAWING_NO_CONFIRM,
  JSON.stringify(confirm.body));
const hodMark = await post(`/api/review/${qDraw?.answerId}`, { decision: 'override', correct: true }, 'hod');
check('an HOD cannot mark it (read-only)', hodMark.status === 403 || hodMark.status === 404, JSON.stringify(hodMark.body));
const marked = await post(`/api/review/${qDraw?.answerId}`, { decision: 'override', correct: true, score: 0.9, note: 'Clear labels.' });
check('the professor marks it', marked.status === 200 && marked.body.item.reviewStatus === 'overridden' && marked.body.profile.adjusted === true,
  JSON.stringify(marked.body));
const afterReview = await levelsNow();
check('now the ladder counts it: one more answer at Create, and it is right', afterReview.seen === beforeReview.seen + 1
  && afterReview.correct === beforeReview.correct + 1, JSON.stringify({ beforeReview, afterReview }));
const after = (await report()).answers?.find((a) => a.kind === 'drawing');
check('and attainment counts it, as reviewed by a professor', after?.chosen === true && after.evidenceType === 'humanReviewed' && after.counts === true,
  JSON.stringify(after));
asha.disconnect();
bilal.disconnect();
await new Promise((r) => setTimeout(r, 150));

// ------------------------------------------------------------- E3 and E4 in the hub --

console.log('\nE3 and E4 in the hub: a practice drawing, unmarked, and the limits');
check('the room closes', (await post(`/api/session/${CODE}/close`, {})).status === 200);
{
  const attempt = (body, as = 'asha') => post('/api/hub/practice/attempts', { topicId: CELLS, mode: 'practice', ...body }, as);
  const drew = await attempt({ attemptId: 'hub-draw-00001', questionId: id(drawQ), response: { image: dataUrl(WITH_TEXT), text: 'Wall, then membrane.' } });
  check('a practice drawing is taken inside the attempt, kept and not marked, and says so', drew.status === 201
    && drew.body.correct === null && drew.body.score === null && drew.body.notMarked === true && drew.body.note === HUB_DRAWING_NOTE,
    JSON.stringify(drew.body));
  const stored = await repo.getHubAttemptByKey(ID.asha, 'hub-draw-00001');
  const hubMedia = stored?.response?.mediaId;
  check('the attempt keeps { mediaId, text }, the picture as the student\'s own drawing', Boolean(hubMedia) && stored.response.text === 'Wall, then membrane.'
    && stored.correct === null && (await repo.getDrawing(hubMedia))?.accountId === ID.asha, JSON.stringify(stored));
  const resend = await attempt({ attemptId: 'hub-draw-00001', questionId: id(drawQ), response: { image: dataUrl(WITH_TEXT) } });
  check('the same attempt sent again is answered from what is kept, with no second drawing', resend.status === 200
    && (await repo.listDrawings({ accountId: ID.asha })).filter((d) => d.answerKey === 'hub-draw-00001').length === 1, JSON.stringify(resend.body));
  const hubUrl = `/api/media/${hubMedia}`;
  const [own, prof, other, none, otherProf] = await Promise.all([image(hubUrl, 'asha'), image(hubUrl, 'profA'), image(hubUrl, 'bilal'),
    image(hubUrl, null), image(hubUrl, 'profB')]);
  check('the student who drew it and their professor read it; a classmate, no credential and another professor get the 404',
    own.status === 200 && prof.status === 200 && [other.status, none.status, otherProf.status].every((s) => s === 404),
    JSON.stringify([own.status, prof.status, other.status, none.status, otherProf.status]));
  const big = await attempt({ attemptId: 'hub-draw-00002', questionId: id(drawQ), response: { image: dataUrl(HUGE) } });
  check('a picture over the cap is refused in the hub too', big.status === 413 && big.body.error === DRAWING_TOO_BIG, JSON.stringify(big.body));
  const worded = await attempt({ attemptId: 'hub-draw-00003', questionId: id(drawNoText), response: { image: dataUrl(ONE_PIXEL), text: 'some words' } });
  check('words on a drawing-only question are refused before the picture is kept', worded.status === 400 && worded.body.error === DRAWING_ONLY
    && !(await repo.getDrawingByKey({ accountId: ID.asha, answerKey: 'hub-draw-00003' })), JSON.stringify(worded.body));
  const nothing = await attempt({ attemptId: 'hub-draw-00004', questionId: id(drawQ), response: 'a written answer' });
  check('a drawing question answered without a drawing is refused', nothing.status === 400, JSON.stringify(nothing.body));
  const longOver = await attempt({ attemptId: 'hub-open-00001', questionId: id(openLong), response: words(601) });
  check('a long answer over 600 words is refused in the hub, with nothing stored', longOver.status === 400 && /has 601 words/.test(longOver.body.error)
    && !(await repo.getHubAttemptByKey(ID.asha, 'hub-open-00001')), JSON.stringify(longOver.body));
  const shortOk = await attempt({ attemptId: 'hub-open-00002', questionId: id(openShort), response: 'support for the cell, keeps shape' });
  check('a short answer within its limit is marked provisionally, as before', shortOk.status === 201 && shortOk.body.provisional === true,
    JSON.stringify(shortOk.body));
}

// ------------------------------------------------------------- the archive --

console.log('\nthe archive keeps the reference, never the picture');
{
  const gone = await del(`/api/session/${CODE}?confirm=${CODE}`);
  check('the room is archived and deleted', gone.status === 200, JSON.stringify(gone.body));
  const archive = await get(`/api/session/archives/${gone.body.archive?.id}`);
  check('the archive says its drawings\' pictures are not in it', archive.body.drawings?.answers === 1 && archive.body.drawings.picturesKept === false
    && archive.body.drawings.note === DRAWINGS_NOTE, JSON.stringify(archive.body.drawings));
  check('and holds no picture: none of its bytes, and nothing near a drawing\'s size', !archive.text.includes(ONE_PIXEL.toString('base64'))
    && archive.text.includes(drawingMedia) && Buffer.byteLength(archive.text) < 1024 * 1024);
  const after = await image(`/api/media/${drawingMedia}`, 'profA');
  check('the room\'s drawing went with the room', after.status === 404 && !(await repo.getDrawing(drawingMedia)));
}

check('nothing left this machine', refusedOffMachine === 0, `${refusedOffMachine} requests refused`);

console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore?.();
process.exit(fail ? 1 : 0);
