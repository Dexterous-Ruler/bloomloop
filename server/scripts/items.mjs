// Phase 2 - item statistics and a question set per room, end to end.
//
//   node server/scripts/items.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with the shared teacher key, and checks:
//
//   a room       twelve phones answer six questions through the socket, each
//                choosing by the text on its own (shuffled) screen; then
//                GET /api/session/:code/items is held to a hand count of what
//                they chose, per option in the question's own order, the
//                proportions and mean scores, the bands, and point-biserials
//                worked independently here from the same marks; the wrong key
//                is flagged and listed first
//   a set        POST /api/session with questionIds: every refusal (not a
//                list, empty, a draft, a rejected question, another chapter's,
//                a malformed id) and a two-question set on a bank too thin for
//                a whole-bank room; a phone served exactly those two, never a
//                question pinned from outside the set, and an answer naming one
//                outside it neither marked nor stored
//   the bank     GET /api/bank/:contentId/stats sums both rooms
//   fewer        a fewer-choices student's pick, a position on a list of two,
//   choices      is stored with which two and counted on the option it was
//   ownership    another professor's bank and room are the same 404, word for
//                word, as ones that do not exist; no credentials is a 401
//
// Never calls Gemini or any network service. Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { emptyProfile, hydrate } = await import(`${SRC}services/mastery.js`);

// The in-process store and no model, whatever .env says.
config.supabase.url = '';
config.supabase.serviceKey = '';
config.mongoUri = '';
config.gemini.apiKey = '';
await initStore({ log: () => {} });
const repo = getRepo();

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
attachSockets(io);
app.set('io', io);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const H = { 'x-teacher-key': config.teacherKey };

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tol = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= tol;

async function call(method, path, body, headers = H) {
  const res = await fetch(base + path, {
    method,
    headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = (p, headers) => call('GET', p, undefined, headers);
const post = (p, body = {}) => call('POST', p, body);

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

// ------------------------------------------------------------ the bank --

const made = await post('/api/content', { title: 'Transport layer (items)', text: 'The transport layer.\nTCP is reliable.\nUDP is connectionless.' });
const contentId = made.body.contentId;

/** A professor's own question: active, validated by questionTypes.js. */
async function own(q) {
  const r = await post(`/api/bank/${contentId}/questions`, { topic: 'Transport', ...q });
  if (r.status !== 201) throw new Error(`could not write "${q.text}": ${r.status} ${r.body.error}`);
  return r.body.question;
}

const Q = {
  qa: await own({ text: 'Which layer carries segments?', bloom: 'remember', kind: 'mcq', options: ['Network', 'Transport', 'Link', 'Physical'], answerIdx: 1 }),
  // Keyed to TCP; the connectionless protocol is UDP (option 2). The wrong key.
  qb: await own({ text: 'Which protocol is connectionless?', bloom: 'remember', kind: 'mcq', options: ['TCP', 'SCTP', 'UDP', 'QUIC'], answerIdx: 0 }),
  qd: await own({ text: 'Port numbers identify processes on a host.', bloom: 'remember', kind: 'truefalse', answerBool: true }),
  qf: await own({ text: 'Which header field detects corruption?', bloom: 'remember', kind: 'mcq', options: ['Port', 'Length', 'Checksum', 'Window'], answerIdx: 2 }),
  qc: await own({
    text: 'Match each protocol to what it gives.', bloom: 'understand', kind: 'match',
    pairs: [{ left: 'TCP', right: 'A reliable byte stream' }, { left: 'UDP', right: 'Single datagrams' }, { left: 'IP', right: 'Routing between networks' }],
  }),
  qe: await own({
    text: 'Sort each protocol into its layer.', bloom: 'understand', kind: 'categorise',
    buckets: [{ name: 'Transport', items: ['TCP', 'UDP'] }, { name: 'Network', items: ['IP', 'ICMP', 'ARP'] }],
  }),
};
const byText = new Map(Object.entries(Q).map(([k, q]) => [q.text, k]));

const STRONG = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06'];
const WEAK = ['S07', 'S08', 'S09', 'S10', 'S11', 'S12'];
const CLASS = [...STRONG, ...WEAK];
const each = (rolls, value) => Object.fromEntries(rolls.map((r) => [r, value]));

/** What each student chooses, in the question's own terms (original indices). */
const PLAN = {
  qa: { S01: 1, S02: 1, S03: 1, S04: 1, S05: 1, S06: 1, S07: 1, S08: 0, S09: 2, S10: 3, S11: 0, S12: 2, B01: 1 },
  qb: { ...each(STRONG, 2), ...each(WEAK, 0) },
  qd: { ...each(CLASS.slice(0, 10), true), S11: false, S12: false, B01: true },
  qf: { ...each(STRONG, 2), ...each(WEAK, 1) },
  // Per left item, the right item paired with it: all three, one of three, none.
  qc: { ...each(['S01', 'S02', 'S03', 'S04'], [0, 1, 2]), ...each(['S05', 'S06', 'S07', 'S08'], [0, 2, 1]), ...each(['S09', 'S10', 'S11', 'S12'], [1, 2, 0]) },
  // Per item (TCP, UDP, IP, ICMP, ARP), the group it is put in. The weak half gets TCP and IP wrong: 3 of 5.
  qe: { ...each(STRONG, [0, 0, 1, 1, 1]), ...each(WEAK, [1, 0, 0, 1, 1]) },
};

/** The marks those choices earn, worked here from the plan, not read from the server. */
const MARK = {
  qa: (c) => (c === 1 ? 1 : 0),
  qb: (c) => (c === 0 ? 1 : 0),
  qd: (c) => (c === true ? 1 : 0),
  qf: (c) => (c === 2 ? 1 : 0),
  qc: (c) => c.filter((orig, i) => orig === i).length / 3,
  qe: (c) => c.filter((g, i) => g === [0, 0, 1, 1, 1][i]).length / 5,
};
const RIGHT = (k, mark) => mark >= 0.7; // PASS_MARK; all-or-nothing kinds give 1 or 0

/** The response a phone sends for that choice, from what its own screen shows. */
function respond(shown, rollNo) {
  const k = byText.get(shown.text);
  const choice = PLAN[k]?.[rollNo];
  // A question this student has no plan for, which only a set room serving
  // outside its set would hand them: any answer, so the run goes on and the
  // checks below say what went wrong instead of a timeout.
  if (choice === undefined) return 0;
  if (k === 'qc') return choice.map((orig) => shown.right.indexOf(Q.qc.pairs[orig].right));
  if (k === 'qe') {
    const flat = Q.qe.buckets.flatMap((b) => b.items);
    return Object.fromEntries(shown.items.map((text, pos) => [pos, choice[flat.indexOf(text)]]));
  }
  return choice;
}

/** Join, then answer every question served until the room has nothing left. */
async function sit(code, rollNo, { before } = {}) {
  const s = await connect();
  const accepted = either(s, ['session:accepted', 'session:rejected']);
  let next = either(s, ['server:question', 'server:exhausted']);
  s.emit('student:join', { code, rollNo, name: rollNo });
  const joined = await accepted;
  const served = [];
  const shuffled = [];
  let first = null;
  let error = null;
  try {
    for (let k = 0; k < 20; k += 1) {
      const ev = await next;
      if (ev.name === 'server:exhausted') break;
      const q = ev.payload.question;
      if (!first) first = ev.payload;
      if (before && k === 0) await before(s, q);
      served.push(String(q._id));
      if (q.right && q.right.some((t, i) => t !== Q.qc.pairs[i].right)) shuffled.push(rollNo);
      const result = either(s, ['server:result', 'session:rejected']);
      s.emit('student:answer', { questionId: q._id, response: respond(q, rollNo), answerId: `${rollNo}-${k}-items` });
      await result;
      next = either(s, ['server:question', 'server:exhausted']);
      s.emit('student:next');
    }
  } catch (err) {
    error = err.message;
  }
  s.close();
  return { joined, served, first, shuffled, error };
}

// ------------------------------------------------------------ room A --

console.log('\na room: twelve phones, six questions, then the items report');
const roomA = await post('/api/session', { contentId, title: 'Whole bank' });
check('a room on the whole approved bank opens as before, with no set', roomA.status === 200 && roomA.body.questionIds === null
  && roomA.body.bankCount === 6, `${roomA.status} ${roomA.body.error ?? ''} ${JSON.stringify(roomA.body.questionIds)}`);
const codeA = roomA.body.code;

let shuffledBoards = 0;
const servedA = {};
const errorsA = [];
for (const roll of CLASS) {
  const sat = await sit(codeA, roll);
  servedA[roll] = sat.served;
  shuffledBoards += sat.shuffled.length;
  if (sat.error) errorsA.push(`${roll}: ${sat.error}`);
}
check('every phone was served all six questions, each answered', !errorsA.length
  && CLASS.every((r) => servedA[r].length === 6 && new Set(servedA[r]).size === 6),
  `${CLASS.map((r) => servedA[r].length).join(' ')} ${errorsA.join('; ')}`);
check('the match was shown in a shuffled order on some phones (so the mapping is exercised)', shuffledBoards >= 3, `${shuffledBoards} of 12`);

const items = await get(`/api/session/${codeA}/items`);
const item = (k) => items.body.items?.find((i) => i.questionId === String(Q[k]._id));
const counts = (k) => item(k)?.distribution?.rows?.map((r) => r.options.map((o) => o.count));
check('GET /api/session/:code/items answers', items.status === 200 && items.body.items?.length === 6,
  `${items.status} ${items.body.error ?? ''}`);
check('it counts 72 final answers from 12 students, and says its thresholds',
  same(items.body.counted, { answers: 72, students: 12 })
  && same(items.body.thresholds, { easyAt: 0.8, hardBelow: 0.4, minAnswersForBand: 5, minStudentsForPointBiserial: 10 }),
  JSON.stringify(items.body.counted));
check('the room says it has no set', items.body.questionIds === null);

// By hand, from PLAN: who chose which option, in the question's own order.
check('mcq: how many chose each option equals the hand count', same(counts('qa'), [[2, 7, 2, 1]]) && same(counts('qf'), [[0, 6, 6, 0]]),
  `${JSON.stringify(counts('qa'))} ${JSON.stringify(counts('qf'))}`);
check('the wrong key: six chose the key, six the right answer', same(counts('qb'), [[6, 0, 6, 0]]), JSON.stringify(counts('qb')));
check('true/false: ten True, two False', same(counts('qd'), [[10, 2]]), JSON.stringify(counts('qd')));
check('match, per left item, by the right item\'s own position whatever each phone showed',
  same(counts('qc'), [[8, 4, 0], [0, 4, 8], [4, 4, 4]]), JSON.stringify(counts('qc')));
check('categorise, per item, by group, whatever order each phone listed the items in',
  same(counts('qe'), [[6, 6], [12, 0], [6, 6], [0, 12], [0, 12]]), JSON.stringify(counts('qe')));
check('the options carry their text and which one the key says',
  same(item('qb')?.distribution?.rows[0].options.map((o) => [o.text, o.key]), [['TCP', true], ['SCTP', false], ['UDP', false], ['QUIC', false]])
  && same(item('qc')?.distribution?.rows.map((r) => r.label), ['TCP', 'UDP', 'IP']));

check('attempts: twelve each', Object.keys(Q).every((k) => item(k)?.attempts === 12));
check('proportion correct by hand: 7/12, 6/12, 10/12, 6/12, 4/12, 6/12',
  near(item('qa')?.proportionCorrect, 7 / 12) && near(item('qb')?.proportionCorrect, 0.5) && near(item('qd')?.proportionCorrect, 10 / 12)
  && near(item('qf')?.proportionCorrect, 0.5) && near(item('qc')?.proportionCorrect, 4 / 12) && near(item('qe')?.proportionCorrect, 0.5),
  Object.keys(Q).map((k) => `${k} ${item(k)?.proportionCorrect}`).join(', '));
check('mean score for the partial-credit kinds: match (4 + 4/3) / 12, categorise (6 + 6 x 3/5) / 12; none for mcq',
  near(item('qc')?.meanScore, (4 + 4 / 3) / 12) && near(item('qe')?.meanScore, (6 + 6 * 0.6) / 12) && item('qa')?.meanScore === null,
  `${item('qc')?.meanScore} ${item('qe')?.meanScore}`);
check('bands: true/false easy (0.83), match hard (0.33), the rest medium',
  item('qd')?.band === 'easy' && item('qc')?.band === 'hard' && ['qa', 'qb', 'qf', 'qe'].every((k) => item(k)?.band === 'medium'),
  Object.keys(Q).map((k) => `${k} ${item(k)?.band}`).join(', '));

/** The textbook point-biserial over these students, worked from PLAN alone. */
function expectedPb(k, rolls) {
  const ys = [];
  const xs = [];
  for (const roll of rolls) {
    const marks = Object.keys(Q).filter((q) => PLAN[q][roll] !== undefined).map((q) => [q, MARK[q](PLAN[q][roll])]);
    const mine = marks.find(([q]) => q === k);
    if (!mine || marks.length < 2) continue;
    xs.push(RIGHT(k, mine[1]) ? 1 : 0);
    ys.push((marks.reduce((s, [, m]) => s + m, 0) - mine[1]) / (marks.length - 1));
  }
  const n = xs.length;
  const g1 = ys.filter((_, i) => xs[i]);
  const g0 = ys.filter((_, i) => !xs[i]);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mean = avg(ys);
  const sd = Math.sqrt(ys.reduce((s, y) => s + (y - mean) ** 2, 0) / n);
  const p = g1.length / n;
  return { r: (avg(g1) - avg(g0)) / sd * Math.sqrt(p * (1 - p)), n };
}
{
  const got = Object.keys(Q).map((k) => [k, item(k)?.pointBiserial, expectedPb(k, CLASS).r]);
  check('every point-biserial equals the textbook formula worked from the plan', got.every(([, a, b]) => near(a, b)),
    got.map(([k, a, b]) => `${k} ${a?.toFixed(4)} vs ${b.toFixed(4)}`).join(', '));
  check('over all twelve students', Object.keys(Q).every((k) => item(k)?.pointBiserialN === 12 && item(k)?.pointBiserialNote === null));
}
check('the wrong key has a negative point-biserial, is flagged, and is listed first',
  item('qb')?.pointBiserial < 0 && item('qb')?.flags?.[0]?.id === 'negative-point-biserial' && items.body.items[0].questionId === String(Q.qb._id),
  `${item('qb')?.pointBiserial} ${JSON.stringify(item('qb')?.flags)}`);
check('and nothing else is flagged', Object.keys(Q).filter((k) => k !== 'qb').every((k) => item(k)?.flags?.length === 0 && item(k)?.pointBiserial > 0),
  Object.keys(Q).map((k) => `${k} ${item(k)?.pointBiserial?.toFixed(3)}`).join(', '));

// ----------------------------------------------------- a question set --

console.log('\na question set per room');
const thin = (await post('/api/content', { title: 'Thin chapter', text: 'Sockets.\nA socket is an endpoint.' })).body.contentId;
const thinQ = await post(`/api/bank/${thin}/questions`, { topic: 'Sockets', text: 'What is a socket?', bloom: 'remember', kind: 'mcq', options: ['An endpoint', 'A cable', 'A router', 'A frame'], answerIdx: 0 });
const [draftQ, rejectedQ] = await repo.insertQuestions([
  { contentId: thin, topic: 'Sockets', text: 'A draft', kind: 'truefalse', answerBool: true, bloom: 'remember', status: 'draft', source: 'fallback' },
  { contentId: thin, topic: 'Sockets', text: 'Rejected', kind: 'truefalse', answerBool: false, bloom: 'remember', status: 'active', source: 'fallback' },
]);
await post(`/api/bank/question/${rejectedQ._id}/reject`);
{
  const whole = await post('/api/session', { contentId: thin });
  check('a whole-bank room on a one-question chapter is still refused (the floor of 6; it has a draft, so 409)',
    whole.status === 409 && /waiting for your approval/.test(whole.body.error), `${whole.status} ${whole.body.error}`);
  const notList = await post('/api/session', { contentId: thin, questionIds: String(thinQ.body.question._id) });
  check('questionIds that is not a list: 400', notList.status === 400 && /must be a list/.test(notList.body.error), notList.body.error);
  const empty = await post('/api/session', { contentId: thin, questionIds: [] });
  check('an empty set: 400', empty.status === 400 && /is empty/.test(empty.body.error), empty.body.error);
  const huge = await post('/api/session', { contentId: thin, questionIds: Array.from({ length: 501 }, (_, i) => i.toString(16).padStart(24, '0')) });
  check('a set of 501: 400', huge.status === 400 && /500 is the most/.test(huge.body.error), huge.body.error);
  const refusals = await Promise.all([
    post('/api/session', { contentId: thin, questionIds: [String(draftQ._id)] }),
    post('/api/session', { contentId: thin, questionIds: [String(rejectedQ._id)] }),
    post('/api/session', { contentId: thin, questionIds: [String(Q.qa._id)] }),
    post('/api/session', { contentId: thin, questionIds: ['not-an-id'] }),
    post('/api/session', { contentId: thin, questionIds: ['0123456789abcdef01234567'] }),
  ]);
  check('a draft, a rejected question, another chapter\'s, a malformed id and an unknown one: each 400',
    refusals.every((r) => r.status === 400), refusals.map((r) => r.status).join(' '));
  check('in one sentence, word for word, so a set cannot ask which ids exist',
    new Set(refusals.map((r) => r.body.error)).size === 1 && /not an approved question of "Thin chapter"/.test(refusals[0].body.error),
    refusals[0].body.error);
  const one = await post('/api/session', { contentId: thin, questionIds: [String(thinQ.body.question._id).toUpperCase(), String(thinQ.body.question._id)] });
  check('a one-question set on that chapter opens, its id stored once and as the bank spells it',
    one.status === 200 && same(one.body.questionIds, [String(thinQ.body.question._id)]) && one.body.bankCount === 1,
    `${one.status} ${one.body.error ?? JSON.stringify(one.body.questionIds)}`);
  const rooms = await get('/api/session');
  const listed = rooms.body.rooms?.find((r) => r.code === one.body.code);
  check('the room list returns the set with the room', same(listed?.questionIds, [String(thinQ.body.question._id)])
    && rooms.body.rooms?.find((r) => r.code === codeA)?.questionIds === null);
}

const roomB = await post('/api/session', { contentId, title: 'Two questions', questionIds: [String(Q.qa._id), String(Q.qd._id)] });
const codeB = roomB.body.code;
check('a two-question set opens and is read back from the stored room', roomB.status === 200
  && same(roomB.body.questionIds, [String(Q.qa._id), String(Q.qd._id)]) && roomB.body.bankCount === 2,
  `${roomB.status} ${roomB.body.error ?? ''}`);
{
  const pub = await get(`/api/session/${codeB}`, {});
  check('the phone\'s room read says it serves 2, without the set or the content id',
    pub.status === 200 && pub.body.bankCount === 2 && !('questionIds' in pub.body.session) && !('contentId' in pub.body.session)
    && !JSON.stringify(pub.body).includes(String(Q.qa._id)), JSON.stringify(pub.body).slice(0, 160));
}

// A student already pinned to a question outside the set: the resume must not serve it.
const sessionB = await repo.getSessionByCode(codeB);
const pinned = hydrate(emptyProfile({ sessionId: String(sessionB._id), rollNo: 'B01', name: 'B01' }));
pinned.served = { questionId: String(Q.qb._id), at: new Date().toISOString(), reason: 'Pinned before the set.' };
await repo.saveProfile(pinned);

let outside = null;
const satB = await sit(codeB, 'B01', {
  // Before answering the first question, the phone names one outside the set.
  async before(s) {
    const reply = either(s, ['server:result', 'server:question', 'session:rejected']);
    s.emit('student:answer', { questionId: String(Q.qb._id), response: 0, answerId: 'B01-outside-set' });
    outside = await reply;
  },
});
check('the phone is told the room serves 2', satB.joined.payload?.bankCount === 2, JSON.stringify(satB.joined.payload?.bankCount));
check('a pin on a question outside the set is not resumed', satB.first?.resumed === false
  && String(satB.first?.question?._id) !== String(Q.qb._id), JSON.stringify({ resumed: satB.first?.resumed }));
check('exactly the two questions of the set are served, then the room is exhausted',
  !satB.error && same([...satB.served].sort(), [String(Q.qa._id), String(Q.qd._id)].sort()),
  `${satB.served.join(', ')} ${satB.error ?? ''}`);
{
  const rows = await repo.listAnswers({ sessionId: sessionB._id });
  check('an answer naming a question outside the set is not marked: the phone is moved on instead',
    outside?.name === 'server:question', outside?.name);
  check('and nothing of it is stored', rows.every((r) => String(r.questionId) !== String(Q.qb._id)) && rows.length === 2,
    `${rows.length} row(s)`);
}
{
  const r = await get(`/api/session/${codeB}/items`);
  const ids = (r.body.items ?? []).map((i) => i.questionId).sort();
  check('the set room\'s items are its two questions, with its set', r.status === 200
    && same(ids, [String(Q.qa._id), String(Q.qd._id)].sort()) && same(r.body.questionIds, roomB.body.questionIds));
  check('one answer each: no band and no point-biserial, with the reason',
    (r.body.items ?? []).every((i) => i.attempts === 1 && i.band === null && i.pointBiserial === null && /Fewer than 10/.test(i.pointBiserialNote)));
}

// ------------------------------------------------------------ the bank --

console.log('\nthe bank, across both rooms');
{
  const r = await get(`/api/bank/${contentId}/stats`);
  const it = (k) => r.body.items?.find((i) => i.questionId === String(Q[k]._id));
  check('GET /api/bank/:contentId/stats answers, over both rooms', r.status === 200 && r.body.rooms?.length === 2
    && same(r.body.counted, { answers: 74, students: 13 }), `${r.status} ${r.body.error ?? JSON.stringify(r.body.counted)}`);
  check('the two questions both rooms asked have 13 answers; the rest 12',
    it('qa')?.attempts === 13 && it('qd')?.attempts === 13 && ['qb', 'qc', 'qe', 'qf'].every((k) => it(k)?.attempts === 12));
  check('their counts add the second room\'s answers', same(it('qa')?.distribution?.rows?.[0]?.options?.map((o) => o.count), [2, 8, 2, 1])
    && same(it('qd')?.distribution?.rows?.[0]?.options?.map((o) => o.count), [11, 2]));
  const pb = expectedPb('qa', [...CLASS, 'B01']);
  check('the point-biserial pools both rooms, each student against their own room', near(it('qa')?.pointBiserial, pb.r)
    && it('qa')?.pointBiserialN === pb.n, `${it('qa')?.pointBiserial} vs ${pb.r} (n ${pb.n})`);
  check('the wrong key is still flagged first', r.body.items?.[0]?.questionId === String(Q.qb._id));
  const bank = await get(`/api/bank/${contentId}`);
  check('GET /api/bank/:contentId is unchanged beside it', bank.status === 200 && bank.body.questions?.length === 6 && !('items' in bank.body));
}

// ------------------------------------------------------- fewer choices --

// The support reaches a phone only through a linked account, which needs
// Supabase. This server runs in this process, so the supports are set on the
// server's own socket after the join instead, and the real answer handler does
// the rest. A one-question set keeps the room to the mcq.
console.log('\nfewer choices: a pick on the shorter list is counted on the option it was');
{
  const room = await post('/api/session', { contentId, title: 'Fewer choices', questionIds: [String(Q.qa._id)] });
  const s = await connect();
  const first = either(s, ['server:question', 'server:exhausted']);
  s.emit('student:join', { code: room.body.code, rollNo: 'F01', name: 'F01' });
  await first;
  io.sockets.sockets.get(s.id).data.student.supports = { fewerChoices: true };
  const again = either(s, ['server:question', 'server:exhausted']);
  s.emit('student:next');
  const shown = (await again).payload?.question?.options ?? [];
  const result = either(s, ['server:result', 'session:rejected']);
  s.emit('student:answer', { questionId: String(Q.qa._id), response: 1, answerId: 'F01-fewer-choices' });
  await result;
  s.close();
  const picked = Q.qa.options.indexOf(shown[1]);
  const row = (await repo.listAnswers({ sessionId: (await repo.getSessionByCode(room.body.code))._id }))[0];
  check('the phone was shown two of the four options', shown.length === 2, JSON.stringify(shown));
  check('the stored answer keeps which two, as the question\'s own indices',
    same(row?.questionSnapshot?.shownOptions, shown.map((t) => Q.qa.options.indexOf(t))), JSON.stringify(row?.questionSnapshot?.shownOptions));
  const r = await get(`/api/session/${room.body.code}/items`);
  const expected = [0, 0, 0, 0];
  expected[picked] = 1;
  check('and its pick, position 1 on a list of two, is counted on that option', same(r.body.items?.[0]?.distribution?.rows?.[0]?.options?.map((o) => o.count), expected),
    `${JSON.stringify(r.body.items?.[0]?.distribution?.rows?.[0]?.options?.map((o) => o.count))} picked ${shown[1]}`);
}

// ------------------------------------------------------------ ownership --

console.log('\nownership');
{
  const theirs = await repo.createContent({ title: 'Theirs', kind: 'syllabus', rawText: '', topics: [], ownerId: '11111111-1111-4111-8111-111111111111' });
  const theirRoom = await repo.createSession({ code: 'THEIRS', contentId: theirs._id, title: 'Theirs', status: 'open', ownerId: '11111111-1111-4111-8111-111111111111' });
  const bankTheirs = await get(`/api/bank/${theirs._id}/stats`);
  const bankNone = await get('/api/bank/0123456789abcdef01234567/stats');
  const bankBad = await get('/api/bank/nope/stats');
  check('another professor\'s bank: 404, word for word as one that does not exist or a malformed id',
    [bankTheirs, bankNone, bankBad].every((r) => r.status === 404 && r.body.error === 'That content was not found.'),
    [bankTheirs, bankNone, bankBad].map((r) => `${r.status} ${r.body.error}`).join(' / '));
  const roomTheirs = await get(`/api/session/${theirRoom.code}/items`);
  const roomNone = await get('/api/session/ZZZZZZ/items');
  check('another professor\'s room: 404, word for word as a code that does not exist',
    [roomTheirs, roomNone].every((r) => r.status === 404 && r.body.error === 'That room was not found.'),
    [roomTheirs, roomNone].map((r) => `${r.status} ${r.body.error}`).join(' / '));
  const anonBank = await get(`/api/bank/${contentId}/stats`, {});
  const anonRoom = await get(`/api/session/${codeA}/items`, {});
  check('no credentials: 401 on both', anonBank.status === 401 && anonRoom.status === 401, `${anonBank.status} ${anonRoom.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore();
process.exit(fail ? 1 : 0);
