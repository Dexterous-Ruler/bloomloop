// Phase 5 review fixes - a class question's key, and whose vote counts, end to end.
//
//   node server/scripts/keysafety.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with scripted phones over Socket.io, and
// checks what the review of 19 Nov 2026 found and what was fixed:
//
//   bank id      a phone's class:question names the class question, never the
//                bank question behind it, so no phone is handed an id to send
//                as its own answer (here or in another room on the chapter)
//   vote key     a vote's key sent again as an answer is not answered from the
//                vote: no mark, no key, no level moved; the answer is kept with
//                the class question, never counted
//   asked path   an answer to the class question sent as a phone's own, sent
//                again, tells the phone nothing about its mark: before the
//                reveal, after a close without one, and for a vote kept late
//   early vote   a vote for a round not yet open is kept, says so, not "late"
//   signed in    a phone typing a signed-in student's roll number is not sent
//                her vote, and its vote never displaces hers; her own phone is
//   paused room  a vote while the room is paused is kept and not counted; on
//                the resume, and when the class question is paused, each phone
//                is sent its own vote by the same rule (Phase 5 follow-up), a
//                phone that reloaded during the room's pause included
//   knew the key the professor is told how many phones answered the question on
//                their own before it was put to the class (and saw its answer)
//   sentences    the class question and projector refusals name no field
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. So,
// as server/scripts/roster.mjs does, the server is pointed at
// http://supabase.invalid (a name that can never resolve) and every request to
// it is answered here, in-process, by a stand-in for the three calls the server
// makes about accounts. Any other request off this machine is refused outright.
//
// Never calls Gemini, Supabase or any network service. Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { OWN_QUESTION_DETAIL } = await import(`${SRC}services/classQuestions.js`);

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
// HOD (CSE) <- professor A <- Asha (21CS01); professor B under another HOD.

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'f0000000-0000-4000-8000-000000000001',
  profA: 'f0000000-0000-4000-8000-000000000002',
  profB: 'f0000000-0000-4000-8000-000000000003',
  hodOther: 'f0000000-0000-4000-8000-000000000004',
  asha: 'f0000000-0000-4000-8000-000000000005',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-KEYS0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.asha, 'student', 'CSE', ID.profA, '21CS01'),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
].map((a) => [a.id, a]));
const TOKENS = { hod: 'tok-hod', profA: 'tok-prof-a', profB: 'tok-prof-b', asha: 'tok-asha' };
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
    throw new Error(`keysafety.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by keysafety.mjs: ${url.pathname}` }, 404);
};
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'keysafety-test-service-key';

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { body, as = 'profA' } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = (path, as) => call('GET', path, { as });
const post = (path, body, as) => call('POST', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });

// ------------------------------------------------------------- sockets --

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

/** The next event of one name that matches, registered before the act that causes it. */
function next(socket, event, match = () => true, ms = 4000) {
  return new Promise((resolve, reject) => {
    const on = (p) => {
      if (!match(p)) return;
      clearTimeout(timer);
      socket.off(event, on);
      resolve(p);
    };
    const timer = setTimeout(() => { socket.off(event, on); reject(new Error(`timeout waiting for ${event}`)); }, ms);
    socket.on(event, on);
  });
}

const sockets = [];
/** A phone joins; resolves once it has its own question (and, with `expectClass`, the class question). */
async function join(code, rollNo, { token, expectClass = false } = {}) {
  const s = await connect();
  sockets.push(s);
  const heard = [];
  s.onAny((event, payload) => heard.push({ event, payload }));
  const accepted = next(s, 'session:accepted');
  const first = next(s, 'server:question');
  const cls = expectClass ? next(s, 'class:question') : null;
  s.emit('student:join', { code, rollNo, name: `Student ${rollNo}`, ...(token ? { token } : {}) });
  return { s, rollNo, heard, accepted: await accepted, first: await first, classState: cls ? await cls : null };
}

let voteSeq = 0;
async function vote(p, cqId, round, response, { confidence, answerId } = {}) {
  voteSeq += 1;
  const ack = next(p.s, 'class:vote');
  p.s.emit('student:vote', {
    classQuestionId: cqId, round, response, answerId: answerId ?? `ks-vote-${voteSeq}-${p.rollNo}`, ...(confidence ? { confidence } : {}),
  });
  return ack;
}

/**
 * Send student:answer and listen for a moment: every server:result that came
 * back, and whether the phone was moved on to a question of its own.
 */
async function answerAndListen(p, payload, ms = 700) {
  const from = p.heard.length;
  p.s.emit('student:answer', payload);
  await wait(ms);
  const got = p.heard.slice(from);
  return {
    results: got.filter((e) => e.event === 'server:result').map((e) => e.payload),
    movedOn: got.some((e) => e.event === 'server:question'),
    events: got.map((e) => e.event),
  };
}

// ------------------------------------------------------------ fixtures --

const content = await repo.createContent({ title: 'Networks', kind: 'syllabus', rawText: '', topics: ['Layers'], ownerId: ID.profA });
await repo.insertQuestions(Array.from({ length: 10 }, (_, i) => ({
  contentId: content._id, topic: 'Layers', text: `Which layer is number ${i}?`, kind: 'mcq',
  options: ['Network', 'Transport', 'Link', 'Physical'], answerIdx: 1, bloom: 'understand', source: 'llm', status: 'active',
})));
const [CQ_Q, TF_Q] = await repo.insertQuestions([
  { contentId: content._id, topic: 'Layers', text: 'Which layer routes packets between networks?', kind: 'mcq',
    options: ['Link', 'Transport', 'Network', 'Physical'], answerIdx: 2, bloom: 'remember', source: 'teacher', status: 'active' },
  { contentId: content._id, topic: 'Layers', text: 'TCP is a transport-layer protocol.', kind: 'truefalse', answerBool: true,
    bloom: 'remember', source: 'llm', status: 'active' },
]);
const CQID = String(CQ_Q._id);
const KEY_FIELDS = /answerIdx|answerBool|answerIdxs|"solution":[^n]/;

const opened = await post('/api/session', { contentId: String(content._id) });
const code = opened.body.code;
const sessionId = opened.body.sessionId;

// ------------------------------------------- before the class is asked --

console.log('\na phone that answered the question on its own first');

const P0 = await join(code, '21CS10');
{
  // Served the class question on its own, as the selector could have, and answers it wrong.
  const p0 = await repo.getProfile(sessionId, '21CS10');
  await repo.saveProfile({ ...p0, served: { questionId: CQID, at: new Date().toISOString(), reason: '', tries: 0, last: null } });
  const result = next(P0.s, 'server:result');
  P0.s.emit('student:answer', { questionId: CQID, response: 0, answerId: 'ks-own-answer-0001' });
  const r = await result;
  check('its own answer is marked, with the answer shown, as every final answer is', r.correct === false && r.solution === 2);
}

const P1 = await join(code, '21CS11');
const P2 = await join(code, '21CS12');
const P3 = await join(code, '21CS13');
const P4 = await join(code, '21CS14');
const ASHA = await join(code, '21CS01', { token: TOKENS.asha });
check('Asha\'s phone joins signed in, linked', ASHA.accepted.linked === true);

// ------------------------------------------------------- the bank's id --

console.log('\nthe class question goes out without its bank id');

const toPhones = [P1, P2, P3, P4, ASHA].map((p) => next(p.s, 'class:question'));
const started = await post(`/api/session/${code}/class-questions`, { questionId: CQID });
const cqId = started.body.id;
check('the owner puts it to the class', started.status === 201 && started.body.state === 'open', JSON.stringify(started.body).slice(0, 200));
{
  const got = await Promise.all(toPhones);
  check('every phone\'s class:question names the class question and nowhere the bank question behind it',
    got.every((g) => g.id === cqId && g.question?._id === cqId && !JSON.stringify(g).includes(CQID) && !KEY_FIELDS.test(JSON.stringify(g))),
    JSON.stringify(got[0]?.question));
}
check('the professor is told one phone answered it on its own first, and saw its answer, in counts and a sentence',
  started.body.phones?.answeredAlone === 1 && /One phone in this room answered this question on its own/.test(started.body.answeredAloneNote ?? '')
  && !/21CS10/.test(JSON.stringify(started.body)), JSON.stringify({ phones: started.body.phones, note: started.body.answeredAloneNote }));

// ------------------------------------------------------ a vote's key --

console.log('\na vote\'s key sent again as an answer');

{
  const ack = await vote(P1, cqId, 1, 0, { confidence: 'guessing', answerId: 'ks-votekey-p1-0001' });
  check('the vote is counted, and says nothing of right or wrong', ack.counted === true && !('correct' in ack) && !('score' in ack));
  const before = await repo.getProfile(sessionId, '21CS11');
  const heard = await answerAndListen(P1, { questionId: CQID, response: 0, answerId: 'ks-votekey-p1-0001' });
  check('no result comes back: no mark, no right or wrong, no key',
    heard.results.length === 0 && !heard.results.some((r) => 'solution' in r || 'score' in r), JSON.stringify(heard.results));
  check('the phone is moved on to a question of its own', heard.movedOn, heard.events.join(','));
  const after = await repo.getProfile(sessionId, '21CS11');
  check('no level moved: the history and the levels are as they were',
    after.history.length === before.history.length && same(after.levels, before.levels), JSON.stringify([before.history.length, after.history.length]));
  const kept = await repo.getAnswerByKey(sessionId, 'ks-votekey-p1-0001@21CS11');
  const theVote = await repo.getAnswerByKey(sessionId, 'ks-votekey-p1-0001');
  check('the answer is stored under a key of its own, with the class question, never counted; the vote is untouched',
    kept?.classQuestionId === cqId && kept.final === false && kept.detail === OWN_QUESTION_DETAIL
    && theVote?.classQuestionId === cqId && theVote.final === true && theVote.round === 1,
    JSON.stringify([kept && { f: kept.final, d: kept.detail }, theVote && { f: theVote.final, r: theVote.round }]));
  const again = await answerAndListen(P1, { questionId: CQID, response: 0, answerId: 'ks-votekey-p1-0001' });
  check('sent a third time, still nothing about its mark, and nothing stored twice',
    again.results.length === 0 && (await repo.listAnswers({ sessionId, rollNo: '21CS11' })).length === 2, JSON.stringify(again.results));
}
{
  // A phone that voted right does no better.
  await vote(P2, cqId, 1, 2, { confidence: 'sure', answerId: 'ks-votekey-p2-0001' });
  const heard = await answerAndListen(P2, { questionId: CQID, response: 2, answerId: 'ks-votekey-p2-0001' });
  check('a right vote\'s key, sent as an answer, is not told it was right', heard.results.length === 0, JSON.stringify(heard.results));
}

// --------------------------------------------- the class question as one's own --

console.log('\nthe class question sent as a phone\'s own answer, and sent again');

{
  const seen = [];
  for (let k = 0; k < 4; k += 1) {
    const first = await answerAndListen(P3, { questionId: CQID, response: k, answerId: `ks-probe-p3-000${k}` });
    const resend = await answerAndListen(P3, { questionId: CQID, response: k, answerId: `ks-probe-p3-000${k}` });
    seen.push({ k, first: first.results, resend: resend.results, moved: first.movedOn && resend.movedOn });
  }
  check('neither the answer nor its resend tells the phone a mark, for any of the four options',
    seen.every((s) => s.first.length === 0 && s.resend.length === 0), JSON.stringify(seen.map((s) => [s.k, s.first, s.resend])));
  check('and each time the phone is moved on to a question of its own', seen.every((s) => s.moved));
  const rows = await repo.listAnswers({ sessionId, rollNo: '21CS13', classQuestionId: cqId });
  check('each answer is kept once, with the class question, never counted', rows.length === 4
    && rows.every((a) => a.final === false && a.detail === OWN_QUESTION_DETAIL), JSON.stringify(rows.map((a) => [a.answerKey, a.final])));
}

// ------------------------------------------------- a round not yet open --

console.log('\na vote for a round that has not opened');

{
  const ack = await vote(P4, cqId, 2, 2, { answerId: 'ks-early-p4-0001' });
  check('it is kept and not counted, and the phone is told the round had not opened, not that it closed',
    ack.counted === false && /had not opened/.test(ack.message) && !/had closed/.test(ack.message), ack.message);
  const row = await repo.getAnswerByKey(sessionId, 'ks-early-p4-0001');
  check('the stored row says so too', row?.final === false && row.round === 2 && /not opened/.test(row.detail ?? '') && !/after this round closed/.test(row.detail ?? ''),
    row?.detail);
  const heard = await answerAndListen(P4, { questionId: CQID, response: 2, answerId: 'ks-early-p4-0001' });
  check('its key sent as an answer tells the phone nothing about its mark', heard.results.length === 0, JSON.stringify(heard.results));
  const view = (await get(`/api/session/${code}/class-questions/${cqId}`)).body;
  check('round 1\'s count of votes does not move for it', view.rounds?.length === 1 && view.rounds[0].voted === 2,
    JSON.stringify(view.rounds));
}

// -------------------------------------------------- whose vote counts --

console.log('\na phone typing a signed-in student\'s roll number');

let impostor;
let back;
let guest;
{
  const ack = await vote(ASHA, cqId, 1, 3, { confidence: 'sure', answerId: 'ks-asha-vote-0001' });
  check('Asha\'s own vote is counted', ack.counted === true);
  impostor = await join(code, '21CS01', { expectClass: true });
  check('a phone typing her roll number without signing in joins unlinked', impostor.accepted.linked === false);
  check('and is not sent her vote or her confidence tap', impostor.classState?.id === cqId && impostor.classState.mine === null,
    JSON.stringify(impostor.classState?.mine));
  const ack2 = await vote(impostor, cqId, 1, 0, { confidence: 'guessing', answerId: 'ks-impostor-0001' });
  check('its vote is kept and not counted, and the phone is told why', ack2.counted === false && /not signed in/.test(ack2.message), ack2.message);
  const reused = await vote(impostor, cqId, 1, 1, { answerId: 'ks-asha-vote-0001' });
  check('sending her vote\'s key does not get her vote back: it is filed as the other phone\'s own',
    same(reused.mine, { response: 1, confidence: null }) && reused.counted === false
    && (await repo.getAnswerByKey(sessionId, 'ks-asha-vote-0001@21CS01:' + cqId + ':1'))?.accountVerified === false,
    JSON.stringify(reused));
  const mine = await repo.getAnswerByKey(sessionId, 'ks-asha-vote-0001');
  const theirs = await repo.getAnswerByKey(sessionId, 'ks-impostor-0001');
  check('her vote stays in force; the other phone\'s is stored, unverified, not in force',
    mine?.final === true && mine.accountVerified === true && theirs?.final === false && theirs.accountVerified === false,
    JSON.stringify([mine && [mine.final, mine.accountVerified], theirs && [theirs.final, theirs.accountVerified]]));
  // Asha's phone drops and comes back, signed in: her own vote, as it stands.
  ASHA.s.disconnect();
  await wait(100);
  back = await join(code, '21CS01', { token: TOKENS.asha, expectClass: true });
  check('her own phone, back signed in, is sent her vote in force', same(back.classState?.mine, { response: 3, confidence: 'sure' }),
    JSON.stringify(back.classState?.mine));
  // A guest roll number nobody signed in to votes as always.
  guest = await join(code, '21CS20', { expectClass: true });
  const g = await vote(guest, cqId, 1, 1, { answerId: 'ks-guest-vote-0001' });
  const g2 = await vote(guest, cqId, 1, 2, { answerId: 'ks-guest-vote-0002' });
  check('a roll number no phone signed in to votes and changes its vote as before', g.counted === true && g2.counted === true
    && (await repo.getAnswerByKey(sessionId, 'ks-guest-vote-0001'))?.final === false);
}

// ----------------------------------------------------------- a paused room --

console.log('\na vote while the room is paused');

{
  const paused = await post(`/api/session/${code}/pause`, {});
  check('the professor pauses the room', paused.status === 200);
  const heldBack = next(P2.s, 'session:paused');
  const ack = await vote(P2, cqId, 1, 0, { answerId: 'ks-paused-p2-0001' });
  check('a vote sent now is kept and not counted, and the phone is told the room is paused',
    ack.counted === false && /paused/.test(ack.message), ack.message);
  await heldBack.then(() => check('and is told the room is paused, as an answer would be', true))
    .catch(() => check('and is told the room is paused, as an answer would be', false));
  const row = await repo.getAnswerByKey(sessionId, 'ks-paused-p2-0001');
  const earlier = await repo.getAnswerByKey(sessionId, 'ks-votekey-p2-0001');
  check('the vote is stored, not in force; the phone\'s earlier vote still is', row?.final === false && /paused/.test(row.detail ?? '')
    && earlier?.final === true, JSON.stringify([row?.detail, earlier?.final]));

  // Phase 5 follow-up: the guest's phone reloads while the room is paused. Its
  // join stops at session:paused, so it is sent no class question until the resume.
  guest.s.disconnect();
  await wait(100);
  const reloaded = await connect();
  sockets.push(reloaded);
  const toldPaused = next(reloaded, 'session:paused');
  reloaded.emit('student:join', { code, rollNo: '21CS20', name: 'Student 21CS20' });
  await toldPaused;
  guest = { ...guest, s: reloaded };
  const onResume = [back, impostor, guest, P1, P2, P3].map((p) => next(p.s, 'class:question').catch(() => ({ timedOut: true })));
  const resumed = await post(`/api/session/${code}/resume`, {});
  check('resumed', resumed.status === 200);
  const got = await Promise.all(onResume);
  check('on the resume each phone is sent the class question with its own vote in force: hers to her signed-in phone, '
    + 'none of hers to the phone typing her roll number, the reloaded phone its own, and none to a phone with no vote counted',
  got.every((g) => g.id === cqId && g.state === 'open') && same(got.map((g) => g.mine), [
    { response: 3, confidence: 'sure' }, null, { response: 2, confidence: null }, { response: 0, confidence: 'guessing' },
    { response: 2, confidence: 'sure' }, null,
  ]), JSON.stringify(got.map((g) => g.timedOut ? 'timeout' : g.mine)));
}

// ------------------------------------------------ after a close without reveal --

console.log('\nafter a close without the key revealed');

{
  const onPause = [back, impostor, guest, P1, P2, P3].map((p) => next(p.s, 'class:question', (g) => g.state === 'paused')
    .catch(() => ({ timedOut: true })));
  const paused = await post(`/api/session/${code}/class-questions/${cqId}/pause`, {});
  const told = await Promise.all(onPause);
  check('when the professor pauses the class question each phone is told so with its own vote, by the same rule',
    told.every((g) => g.id === cqId && g.voting === false) && same(told.map((g) => g.mine), [
      { response: 3, confidence: 'sure' }, null, { response: 2, confidence: null }, { response: 0, confidence: 'guessing' },
      { response: 2, confidence: 'sure' }, null,
    ]), JSON.stringify(told.map((g) => g.timedOut ? 'timeout' : g.mine)));
  const r1 = paused.body.rounds?.[0];
  check('round 1 counts: Asha\'s D, not the other phone\'s A; the guest\'s latest; the paused vote not counted',
    paused.status === 200 && same(r1?.distribution?.options?.map((o) => [o.key, o.votes]), [['A', 1], ['B', 0], ['C', 2], ['D', 1]])
    && r1?.voted === 4, JSON.stringify(r1));
  await post(`/api/session/${code}/class-questions/${cqId}/close`, { reveal: false });
  await wait(200);
  const late = await join(code, '21CS15');
  const first = await answerAndListen(late, { questionId: CQID, response: 2, answerId: 'ks-after-close-001' });
  const resend = await answerAndListen(late, { questionId: CQID, response: 2, answerId: 'ks-after-close-001' });
  check('a new phone sending the question as its own, then again, is told nothing about its mark',
    first.results.length === 0 && resend.results.length === 0, JSON.stringify([first.results, resend.results]));
}

// -------------------------------------------------------------- sentences --

console.log('\nthe refusals name no field');

{
  const FIELDS = /questionId|classQuestionId|tallyId|reveal must|\{ ?question|\bnull\b/;
  const bad = await post(`/api/session/${code}/class-questions`, { questionId: 'not-an-id' });
  check('putting something that is not a question to the class', bad.status === 400 && !FIELDS.test(bad.body.error ?? ''), bad.body.error);
  const room2 = await post('/api/session', { contentId: String(content._id) });
  const c2 = await post(`/api/session/${room2.body.code}/class-questions`, { questionId: String(TF_Q._id) });
  const reveal = await post(`/api/session/${room2.body.code}/class-questions/${c2.body.id}/close`, { reveal: 'yes' });
  check('closing with a reveal that is neither yes nor no', reveal.status === 400 && !FIELDS.test(reveal.body.error ?? ''), reveal.body.error);
  const wrong = await patch(`/api/session/${code}/projector`, { question: { classQuestionId: '00000000-0000-4000-8000-0000000000ff' } });
  check('a class question of another room on the wall', wrong.status === 400 && !FIELDS.test(wrong.body.error ?? ''), wrong.body.error);
  const shape = await patch(`/api/session/${code}/projector`, { question: 5 });
  check('something on the wall that is no question at all', shape.status === 400 && !FIELDS.test(shape.body.error ?? ''), shape.body.error);
  const both = await patch(`/api/session/${code}/projector`, { question: { questionId: CQID, classQuestionId: cqId } });
  check('two things on the wall at once', both.status === 400 && !FIELDS.test(both.body.error ?? ''), both.body.error);
}

check('no phone was sent the key before the professor revealed it, in any event it heard',
  [P0, P1, P2, P3, P4, impostor].every((p) => p.heard.filter((e) => e.event !== 'server:result' || p !== P0)
    .every((e) => !KEY_FIELDS.test(JSON.stringify(e.payload ?? {})))),
  '');
check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
for (const s of sockets) s.disconnect();
globalThis.fetch = realFetch;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
