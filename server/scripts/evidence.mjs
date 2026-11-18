// Phase 1 - retrieval of the stored evidence.
//
//   node server/scripts/evidence.mjs
//
// Drives a REAL server on the in-process store (the same createApp and
// attachSockets the production server uses, on a random port), on the shared
// teacher key, and checks:
//
//   room answers  every stored attempt - finals, retried attempts, polls - newest
//                 first with the full snapshot; one student by roll number; pages
//                 that follow on without overlap; bad paging refused
//   room topics   per topic x per level numbers equal a hand count of what the
//                 phones were told, polls and retried attempts left out
//   fallback      a room older than the evidence store is read from its
//                 profiles' history, a room with both is 'mixed' with nothing
//                 counted twice, and each says which source it used
//   access        a room owned by a signed-in professor is the same 404, word for
//                 word, as a code that does not exist; no credentials is a 401
//   accounts      /api/analytics/:id/answers on the shared key is a 404, because
//                 the shared key has no subjects. The signed-in paths (a
//                 professor's student, a student themself) need Supabase
//                 accounts and are NOT exercised here; test/evidence.test.js
//                 covers the functions under them on this same store.
//
// Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { LEVELS } = await import(`${SRC}bloom.js`);

// Force the in-process store whatever .env says: this suite must not touch a
// real database, and must not depend on one being reachable.
config.supabase.url = '';
config.supabase.serviceKey = '';
config.mongoUri = '';
await initStore({ log: () => {} });
const repo = getRepo();

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
attachSockets(io);
app.set('io', io);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const KEY = { 'x-teacher-key': config.teacherKey };

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

// ------------------------------------------------------------- plumbing --

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });
}

function either(socket, events, ms = 4000) {
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

async function get(path, headers = KEY) {
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const randomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z]/g, 'X').padEnd(6, 'X');

// ------------------------------------------------------------ fixtures --

const mcq = (i, bloom, topic) => ({
  text: `Question ${i} on ${topic} at ${bloom}?`,
  kind: 'mcq',
  options: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
  answerIdx: 1,
  bloom,
  topic,
  source: 'llm',
});

async function makeRoom({ ownerId = null, title = 'Evidence fixture', reattempts = 1 } = {}) {
  const content = await repo.createContent({ title, kind: 'syllabus', rawText: '', topics: ['Cells', 'Energy'], ownerId });
  const docs = [
    ...[0, 1, 2].map((i) => mcq(i, 'remember', 'Cells')),
    ...[3, 4].map((i) => mcq(i, 'understand', 'Cells')),
    ...[5, 6, 7].map((i) => mcq(i, 'understand', 'Energy')),
    ...[8, 9].map((i) => mcq(i, 'apply', 'Energy')),
    { text: 'How sure do you feel?', kind: 'poll', options: ['Very', 'Somewhat', 'Not yet'], bloom: 'understand', topic: 'Cells', source: 'llm' },
  ];
  const questions = await repo.insertQuestions(docs.map((d) => ({ ...d, contentId: content._id })));
  const session = await repo.createSession({
    code: randomCode(), contentId: content._id, title, status: 'open', ownerId,
    masteryGoal: 0.8, reattempts, redemption: false,
  });
  return { session, questions, byId: new Map(questions.map((q) => [String(q._id), q])) };
}

/**
 * One student working through `plans`: 'R' right first time, 'WR' wrong then
 * right on the retry, 'WW' wrong twice. A poll, if served, is answered and does
 * not use up a plan. The hand count is built from what the PHONE was told -
 * never from the store - so it is an independent witness to the report.
 */
async function play(room, rollNo, name, plans, hand) {
  const s = await connect();
  const firstQ = either(s, ['server:question']);
  s.emit('student:join', { code: room.session.code, rollNo, name });
  let q = (await firstQ).payload.question;
  let n = 0;
  let step = 0;
  const said = { finals: 0, retried: 0, polls: 0 };
  const send = (response) => {
    n += 1;
    const result = either(s, ['server:result', 'session:rejected']);
    s.emit('student:answer', { questionId: q._id, response, answerId: `ev-${rollNo}-${String(n).padStart(4, '0')}` });
    return result;
  };

  while (step < plans.length) {
    const bankQ = room.byId.get(String(q._id));
    if (bankQ.kind === 'poll') {
      const r = await send(0);
      if (r.payload.ungraded) said.polls += 1;
    } else {
      const plan = plans[step];
      step += 1;
      // The second wrong answer is a DIFFERENT wrong option: the same one again
      // is a resend of the refused attempt, which the server answers with
      // `retry` and does not store.
      const pick = (c, attempt) => (c === 'R' ? bankQ.answerIdx : attempt === 1 ? 0 : 2);
      let r = await send(pick(plan[0], 1));
      if (r.payload.retry) {
        said.retried += 1;
        r = await send(pick(plan[1], 2));
      }
      if (r.payload.retry) throw new Error(`${rollNo}: the second attempt was not taken as final`);
      said.finals += 1;
      const cell = (hand[bankQ.topic] ??= { students: new Set(), levels: {} });
      cell.students.add(rollNo);
      const lv = (cell.levels[bankQ.bloom] ??= { seen: 0, correct: 0 });
      lv.seen += 1;
      if (r.payload.correct) lv.correct += 1;
    }
    if (step >= plans.length) break;
    const nextQ = either(s, ['server:question', 'server:exhausted']);
    s.emit('student:next');
    const got = await nextQ;
    if (got.name !== 'server:question') break;
    q = got.payload.question;
  }
  s.close();
  return said;
}

// ------------------------------------------------------- a live room --

console.log('\nroom answers');
const room = await makeRoom();
const code = room.session.code;
const hand = {};
const told = [
  await play(room, 'EV-1', 'Asha', ['R', 'R', 'WR', 'WW'], hand),
  await play(room, 'EV-2', 'Bilal', ['WW', 'R', 'WR', 'R'], hand),
  await play(room, 'EV-3', 'Chen', ['WW', 'WW', 'R', 'WR'], hand),
];
const finals = told.reduce((n, t) => n + t.finals, 0);
const retried = told.reduce((n, t) => n + t.retried, 0);
const polls = told.reduce((n, t) => n + t.polls, 0);
const stored = await repo.listAnswers({ sessionId: room.session._id });
check('the fixture played out as planned', finals === 12 && retried === 7 && stored.length === finals + retried + polls,
  `${finals} final, ${retried} retried, ${polls} poll(s), ${stored.length} row(s)`);

const all = [];
let page = { body: { hasMore: true } };
let pages = 0;
let hasMoreRight = true;
while (page.body?.hasMore && pages < 20) {
  page = await get(`/api/session/${code}/answers?limit=3&offset=${pages * 3}`);
  pages += 1;
  all.push(...(page.body?.items ?? []));
  const expectMore = pages * 3 < stored.length;
  if (page.status !== 200 || page.body.hasMore !== expectMore || page.body.items.length !== Math.min(3, stored.length - (pages - 1) * 3)) {
    hasMoreRight = false;
  }
}
const ids = all.map((i) => i.answerId);
check('paged three at a time, every stored attempt arrives exactly once',
  ids.length === stored.length && new Set(ids).size === ids.length
  && stored.every((a) => ids.includes(String(a._id))), `${ids.length} of ${stored.length} over ${pages} page(s)`);
check('hasMore is true until the last page and false on it', hasMoreRight);
const times = all.map((i) => i.answeredAt);
check('newest first', times.every((t, i) => i === 0 || times[i - 1] >= t));

const finalMcq = all.find((i) => i.kind === 'mcq' && i.final && i.attempt === 1);
check('each row carries the room, the student and the question as shown',
  finalMcq?.room?.code === code && finalMcq?.room?.title === 'Evidence fixture' && Boolean(finalMcq?.room?.startedAt)
  && ['Asha', 'Bilal', 'Chen'].includes(finalMcq?.student?.name) && /^EV-\d$/.test(finalMcq?.student?.rollNo ?? '')
  && Array.isArray(finalMcq?.question?.options) && finalMcq.question.options.length === 4
  && finalMcq.question.answerIdx === undefined);
check('and, for a teacher, the full snapshot with its answer key',
  finalMcq?.snapshot?.answerIdx === 1 && finalMcq?.snapshot?.options?.length === 4 && finalMcq?.snapshot?.text === finalMcq?.question?.text);
check('with the machine\'s reading beside the mark in force',
  typeof finalMcq?.auto?.correct === 'boolean' && finalMcq.auto.correct === finalMcq.correct
  && finalMcq.review?.status === 'auto' && typeof finalMcq.response === 'number');
const retriedRows = all.filter((i) => i.final === false);
check('retried attempts are in the record, marked not final',
  retriedRows.length === retried && retriedRows.every((i) => i.attempt === 1 && i.correct === false));
check('and each one\'s final attempt is attempt 2',
  all.filter((i) => i.final && i.attempt === 2).length === retried);
const pollRows = all.filter((i) => i.kind === 'poll');
check('polls are in the record, ungraded with no mark',
  pollRows.length === polls && pollRows.every((i) => i.ungraded === true && i.correct === null && i.score === null));

const one = await get(`/api/session/${code.toLowerCase()}/answers?rollNo=ev-2&limit=200`);
const ev2 = stored.filter((a) => a.rollNo === 'EV-2');
check('one student by roll number, typed any case', one.status === 200 && one.body.rollNo === 'EV-2'
  && one.body.items.length === ev2.length && one.body.items.every((i) => i.student.rollNo === 'EV-2'),
  `${one.body?.items?.length} of ${ev2.length}`);

for (const [label, q] of [['limit=0', 'limit=0'], ['limit=201', 'limit=201'], ['offset=-1', 'offset=-1'], ['limit=abc', 'limit=abc']]) {
  const bad = await get(`/api/session/${code}/answers?${q}`);
  check(`bad paging is refused (${label})`, bad.status === 400, `HTTP ${bad.status}`);
}

// ------------------------------------------------------------- topics --

console.log('\nroom topics');
{
  const res = await get(`/api/session/${code}/topics`);
  const body = res.body ?? {};
  check('answers the room, from the answers store', res.status === 200 && body.room?.code === code
    && body.source === 'answers' && body.counted?.answers === finals && body.counted?.history === 0 && body.untagged === 0,
    JSON.stringify({ source: body.source, counted: body.counted }));
  check('counts every student with graded evidence', body.students === 3);

  const mismatches = [];
  for (const topic of Object.keys(hand)) {
    const got = body.topics?.find((t) => t.topic === topic);
    if (!got) { mismatches.push(`${topic}: missing`); continue; }
    if (got.students !== hand[topic].students.size) mismatches.push(`${topic}: students ${got.students} vs ${hand[topic].students.size}`);
    let seen = 0;
    let correct = 0;
    for (const level of LEVELS) {
      const want = hand[topic].levels[level] ?? { seen: 0, correct: 0 };
      const cell = got.levels?.find((l) => l.level === level);
      seen += want.seen;
      correct += want.correct;
      if (cell?.seen !== want.seen || cell?.correct !== want.correct) {
        mismatches.push(`${topic}/${level}: ${cell?.correct}/${cell?.seen} vs ${want.correct}/${want.seen}`);
      }
      const acc = want.seen ? want.correct / want.seen : null;
      if (cell?.accuracy !== acc) mismatches.push(`${topic}/${level}: accuracy ${cell?.accuracy} vs ${acc}`);
    }
    if (got.seen !== seen || got.correct !== correct) mismatches.push(`${topic}: ${got.correct}/${got.seen} vs ${correct}/${seen}`);
  }
  check('per topic and per level, the numbers equal a hand count of what the phones were told',
    mismatches.length === 0 && body.topics?.length === Object.keys(hand).length, mismatches.join('; ') || `${body.topics?.length} topic(s)`);
  check('every topic carries all six levels, in ladder order',
    body.topics?.every((t) => t.levels.map((l) => l.level).join() === LEVELS.join()));

  const shut = await fetch(`${base}/api/session/${code}/close`, { method: 'POST', headers: KEY });
  const after = await get(`/api/session/${code}/topics`);
  check('a closed room still reports, with the same numbers', shut.ok && after.status === 200
    && JSON.stringify(after.body.topics) === JSON.stringify(body.topics));
}

// ----------------------------------------------- rooms older than the store --

console.log('\nrooms older than the evidence store');
{
  // Profiles written before the store existed: history entries with no
  // answerId, and no answer rows behind them.
  const old = await makeRoom({ title: 'Before the store' });
  const at = '2026-10-01T09:00:00.000Z';
  await repo.saveProfile({
    sessionId: old.session._id, rollNo: 'OLD-1', name: 'Old One', workingLevel: 'understand',
    history: [
      { questionId: 'q1', bloom: 'remember', topic: 'Plants', correct: true, at },
      { questionId: 'q2', bloom: 'remember', topic: 'Plants', correct: false, at },
      { questionId: 'q3', bloom: 'understand', topic: 'Water', correct: true, at },
      { questionId: 'q4', bloom: 'understand', topic: 'Water', ungraded: true, at },
    ],
  });
  await repo.saveProfile({
    sessionId: old.session._id, rollNo: 'OLD-2', name: 'Old Two', workingLevel: 'understand',
    history: [{ questionId: 'q1', bloom: 'remember', topic: 'Plants', correct: true, at }],
  });
  const res = await get(`/api/session/${old.session.code}/topics`);
  const plants = res.body?.topics?.find((t) => t.topic === 'Plants');
  const water = res.body?.topics?.find((t) => t.topic === 'Water');
  check('is read from its profiles\' history, and says so', res.status === 200 && res.body.source === 'history'
    && res.body.counted?.answers === 0 && res.body.counted?.history === 4, JSON.stringify({ source: res.body?.source, counted: res.body?.counted }));
  check('with the poll left out and the numbers as counted by hand',
    plants?.seen === 3 && plants?.correct === 2 && plants?.students === 2
    && plants?.levels.find((l) => l.level === 'remember')?.seen === 3
    && water?.seen === 1 && water?.correct === 1 && water?.students === 1 && res.body.students === 2);
  const rec = await get(`/api/session/${old.session.code}/answers`);
  check('its answer record is honestly empty', rec.status === 200 && rec.body.items.length === 0 && rec.body.hasMore === false);

  // A room with both: one stored answer whose history entry points at it, and
  // one entry from before the store.
  const mixed = await makeRoom({ title: 'Both' });
  const { answer: row } = await repo.recordAnswer({
    sessionId: mixed.session._id, answerKey: 'mixed-key-0001', rollNo: 'MIX-1', questionId: mixed.questions[8]._id,
    topic: 'Energy', bloom: 'apply', kind: 'mcq', questionSnapshot: { id: String(mixed.questions[8]._id), text: 'x' },
    response: 1, final: true, correct: true, score: 1, autoCorrect: true, autoScore: 1, reviewStatus: 'auto',
  });
  await repo.saveProfile({
    sessionId: mixed.session._id, rollNo: 'MIX-1', name: 'Mixed', workingLevel: 'understand',
    history: [
      { questionId: 'old-q', bloom: 'remember', topic: 'Energy', correct: false, at },
      { questionId: String(mixed.questions[8]._id), bloom: 'apply', topic: 'Energy', correct: true, answerId: row.answerKey, at: row.answeredAt },
    ],
  });
  const m = await get(`/api/session/${mixed.session.code}/topics`);
  const energy = m.body?.topics?.find((t) => t.topic === 'Energy');
  check('a room with both is \'mixed\', and nothing is counted twice', m.body?.source === 'mixed'
    && m.body.counted?.answers === 1 && m.body.counted?.history === 1 && energy?.seen === 2 && energy?.correct === 1,
    JSON.stringify({ source: m.body?.source, counted: m.body?.counted, seen: energy?.seen }));

  const empty = await makeRoom({ title: 'Nobody came' });
  const e = await get(`/api/session/${empty.session.code}/topics`);
  check('a room nobody answered in says \'none\'', e.body?.source === 'none' && e.body.topics.length === 0);
}

// -------------------------------------------------------------- access --

console.log('\naccess');
{
  const owned = await makeRoom({ ownerId: '33333333-3333-3333-3333-333333333333', title: 'Someone else\'s' });
  await repo.recordAnswer({
    sessionId: owned.session._id, answerKey: 'owned-key-0001', rollNo: 'OWN-1', questionId: owned.questions[0]._id,
    topic: 'Cells', bloom: 'remember', kind: 'mcq', questionSnapshot: { id: String(owned.questions[0]._id), answerIdx: 1 },
    response: 1, final: true, correct: true, score: 1, autoCorrect: true, autoScore: 1,
  });
  for (const what of ['answers', 'topics']) {
    const theirs = await get(`/api/session/${owned.session.code}/${what}`);
    const nothing = await get(`/api/session/ZZZZZZ/${what}`);
    check(`${what}: a signed-in professor's room is a 404 to the shared key`, theirs.status === 404, `HTTP ${theirs.status}`);
    check(`${what}: word for word the same as a code that does not exist`,
      nothing.status === 404 && JSON.stringify(theirs.body) === JSON.stringify(nothing.body), JSON.stringify(theirs.body));
    const anon = await get(`/api/session/${code}/${what}`, {});
    check(`${what}: no credentials, no evidence`, anon.status === 401, `HTTP ${anon.status}`);
  }

  // The routes beside them still answer as before.
  const pub = await get(`/api/session/${code}`, {});
  check('GET /:code is still the public room summary, with no answers in it', pub.status === 200
    && pub.body?.session?.code === code && pub.body.items === undefined && pub.body.topics === undefined);
  const arch = await get('/api/session/archives');
  check('GET /archives still lists archives', arch.status === 200 && Array.isArray(arch.body?.archives));
}

// ------------------------------------------------- the account endpoint --

console.log('\nGET /api/analytics/:id/answers');
{
  const keyed = await get('/api/analytics/44444444-4444-4444-4444-444444444444/answers');
  const detail = await get('/api/analytics/44444444-4444-4444-4444-444444444444');
  check('the shared key has no subjects, so any id is a 404', keyed.status === 404, `HTTP ${keyed.status}`);
  check('the same answer the detail route gives', detail.status === 404 && JSON.stringify(keyed.body) === JSON.stringify(detail.body));
  const badPaging = await get('/api/analytics/44444444-4444-4444-4444-444444444444/answers?limit=0');
  check('authorization is decided before the query is read', badPaging.status === 404, `HTTP ${badPaging.status}`);
  const anon = await get('/api/analytics/44444444-4444-4444-4444-444444444444/answers', {});
  check('no credentials is refused', anon.status === 401, `HTTP ${anon.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
