// Durable sessions - the proof.
//
// A phone that dies mid-question is the normal case, not the edge case: a
// browser tab is evicted, a train goes into a tunnel, a battery gives up. The
// promise this file exists to hold the server to is that none of that costs the
// student the question they were on.
//
// It drives the REAL socket server - the same initStore/createApp/attachSockets
// that index.js boots - against the REAL store, over socket.io-client on a real
// port. Nothing here is stubbed, because the bug this suite was written for
// lived in the seam between the selector, the pin and the bank cache, and a
// stub of any one of them would have hidden it.
//
// Fixture data is created, used and torn down each run: one content row named
// below is reused forever, its questions are rewritten, and the sessions and
// profiles are deleted at the end. Running this against a live database leaves
// nothing behind.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

// The source tree beside this script, so it tests the checkout it lives in.
const SRC = new URL('../src', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}/repo/index.js`);
const { createApp } = await import(`${SRC}/app.js`);
const { attachSockets, isOnline } = await import(`${SRC}/sockets/index.js`);
const { config } = await import(`${SRC}/config.js`);
const { emptyProfile } = await import(`${SRC}/services/mastery.js`);

const FIXTURE = 'BloomLoop resume harness (safe to delete)';
const ROLL_A = 'RESUME-A';
const ROLL_B = 'RESUME-B';
const ROLL_C = 'RESUME-C';

// ------------------------------------------------------------------ table --

const rows = [];
let hardFail = 0;
let softFail = 0;

/** A mandated row: a failure here fails the suite. */
const step = (id, label, ok, detail = '') => {
  rows.push({ id, label, status: ok ? 'PASS' : 'FAIL', detail });
  if (!ok) hardFail += 1;
};

/** A supporting assertion: reported, and it fails the suite too. */
const also = (label, ok, detail = '') => {
  rows.push({ id: '', label: `  ${label}`, status: ok ? 'pass' : 'FAIL', detail });
  if (!ok) hardFail += 1;
};

/** A known hole we have not closed. Reported loudly, does not fail the suite. */
const known = (label, ok, detail = '') => {
  rows.push({ id: '', label: `  ${label}`, status: ok ? 'pass' : 'WARN', detail });
  if (!ok) softFail += 1;
};

// ------------------------------------------------------------------ socket --

function connect(base) {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(new Error(`connect_error: ${e.message}`)));
  });
}

/**
 * Wait for one event, and treat a rejection as a failure rather than a timeout -
 * "the server said no" and "the server said nothing" are different bugs and a
 * bare timeout would report them identically.
 */
function next(socket, event, ms = 8000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      socket.off('session:rejected', onReject);
    };
    const onEvent = (p) => { cleanup(); resolve(p); };
    const onReject = (p) => { cleanup(); reject(new Error(`session:rejected - ${p?.reason ?? ''}`)); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${event}`));
    }, ms);
    socket.on(event, onEvent);
    socket.on('session:rejected', onReject);
  });
}

/** Join, and hand back the first question the server serves. */
async function join(socket, code, rollNo) {
  const question = next(socket, 'server:question');
  socket.emit('student:join', { code, rollNo, name: rollNo });
  return question;
}

/** Kill the transport outright: no graceful namespace disconnect, no answer. */
async function destroy(socket, code, rollNo) {
  socket.io.engine.close();
  socket.close();
  // The server has to have PROCESSED the loss before the next socket joins,
  // otherwise the reconnect is racing the presence map and this suite would go
  // green or red depending on scheduler luck.
  const until = Date.now() + 5000;
  while (isOnline(code, rollNo) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isOnline(code, rollNo);
}

// ------------------------------------------------------------------- setup --

const mcq = (id, bloom, text) => ({
  topic: 'Resume harness',
  text,
  kind: 'mcq',
  options: [`${id} right`, `${id} wrong 1`, `${id} wrong 2`, `${id} wrong 3`],
  answerIdx: 0,
  bloom,
  status: 'active',
  source: 'fallback',
});

await initStore({ log: () => {} });
const repo = getRepo();

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
attachSockets(io);
app.set('io', io);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// One fixture content, reused across runs so repeated runs do not pile up decks.
// ownerId stays null: an unowned deck is the only kind the shared teacher key is
// allowed to write to, and step (g) discards through the real HTTP route.
const contents = await repo.listContents();
const content =
  contents.find((c) => c.title === FIXTURE) ??
  (await repo.createContent({ title: FIXTURE, kind: 'syllabus', rawText: '', topics: ['Resume harness'], ownerId: null }));

await repo.deleteQuestions(content._id);
const bank = await repo.insertQuestions(([
  // A cold-start profile sits at Understand and is eligible for Remember and
  // Understand, so the pool is deliberately deep at both - nothing here may run
  // out mid-proof and turn a real failure into "the bank was exhausted".
  mcq('U1', 'understand', 'Understand item one.'),
  mcq('U2', 'understand', 'Understand item two.'),
  mcq('U3', 'understand', 'Understand item three.'),
  mcq('U4', 'understand', 'Understand item four.'),
  mcq('U5', 'understand', 'Understand item five.'),
  mcq('R1', 'remember', 'Remember item one.'),
  mcq('R2', 'remember', 'Remember item two.'),
  mcq('D1', 'understand', 'The item the teacher throws away.'),
]).map((q) => ({ ...q, contentId: content._id })));
const dead = bank.find((q) => q.text.startsWith('The item'));

const codeFor = () =>
  Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

const live = await repo.createSession({ code: codeFor(), contentId: content._id, title: FIXTURE, ownerId: null });
const fresh = await repo.createSession({ code: codeFor(), contentId: content._id, title: FIXTURE, ownerId: null });

console.log(`store: ${repo.kind} · bank ${bank.length} items · live ${live.code} · fresh ${fresh.code}\n`);

const sockets = [];
let exitCode = 1;

try {
  // ------------------------------------------------------- (a) join, served --
  const s1 = await connect(base);
  sockets.push(s1);
  const first = await join(s1, live.code, ROLL_A);
  const X = first?.question?._id ?? null;

  step('a', 'student joins and is served a question', Boolean(X) && bank.some((q) => String(q._id) === String(X)),
    X ? `question ${String(X).slice(0, 8)} · ${first.question.bloom}` : 'no question served');
  also('the pin is written to the store before the phone can answer',
    String((await repo.getProfile(live._id, ROLL_A))?.served?.questionId ?? '') === String(X),
    `served_id ${String((await repo.getProfile(live._id, ROLL_A))?.served?.questionId ?? 'null').slice(0, 8)}`);
  also('a first-ever join does not claim to have resumed anything',
    first.resumed === false, `resumed=${first.resumed}`);

  // ---------------------------------------------- (b) destroyed mid-question --
  const gone = await destroy(s1, live.code, ROLL_A);
  step('b', 'socket destroyed mid-question, no answer sent', gone,
    gone ? 'server processed the disconnect' : 'student still marked online after 5s');
  also('the pin survives the disconnect',
    String((await repo.getProfile(live._id, ROLL_A))?.served?.questionId ?? '') === String(X), 'still pinned');

  // ----------------------------------------------- (c) fresh socket, same roll --
  const s2 = await connect(base);
  sockets.push(s2);
  const back = await join(s2, live.code, ROLL_A);
  step('c', 'a fresh socket joins on the same roll number', Boolean(back?.question),
    `socket ${s2.id}`);

  // ------------------------------------------------------ (d) THE SAME ITEM --
  const Y = back?.question?._id ?? null;
  step('d', 'the SAME question comes back, and resumed is true',
    Boolean(Y) && String(Y) === String(X) && back.resumed === true,
    `served ${String(Y).slice(0, 8)} vs pinned ${String(X).slice(0, 8)} · resumed=${back.resumed}`);
  also('one row per roll number, not two',
    (await repo.listProfiles(live._id)).filter((p) => p.rollNo === ROLL_A).length === 1,
    `${(await repo.listProfiles(live._id)).filter((p) => p.rollNo === ROLL_A).length} row(s)`);

  // -------------------------------------------- (e) answer it, pin must clear --
  const answered = next(s2, 'server:result');
  s2.emit('student:answer', { questionId: String(X), response: 0 });
  const result = await answered;
  const afterAnswer = await repo.getProfile(live._id, ROLL_A);
  step('e', 'the student answers it and the pin clears',
    result?.correct === true && afterAnswer?.served == null,
    `correct=${result?.correct} · served=${afterAnswer?.served == null ? 'null' : 'STILL SET'}`);

  // ------------------------------------------------ (f) a DIFFERENT question --
  const onward = next(s2, 'server:question');
  s2.emit('student:next');
  const second = await onward;
  const Z = second?.question?._id ?? null;
  step('f', 'the next question is a different one',
    Boolean(Z) && String(Z) !== String(X),
    `${String(Z).slice(0, 8)} != ${String(X).slice(0, 8)}`);
  also('a question already answered is never served again',
    !(await repo.getProfile(live._id, ROLL_A)).history.some((h) => String(h.questionId) === String(Z)),
    'not in history');

  // ---------------------------------------------- (g) a pin at a dead item --
  // (i) The cold path. A stale pin is written straight into the store pointing
  //     at an item that is already discarded, and the session's bank has never
  //     been read - so this is the selector and the pin alone, with no cache in
  //     the way.
  await repo.updateQuestion(dead._id, { status: 'discarded' });
  await repo.saveProfile({
    ...emptyProfile({ sessionId: String(fresh._id), rollNo: ROLL_B, name: ROLL_B }),
    served: { questionId: String(dead._id), at: new Date().toISOString(), reason: 'pinned before the teacher discarded it' },
  });

  const s3 = await connect(base);
  sockets.push(s3);
  const revived = await join(s3, fresh.code, ROLL_B);
  const gi = Boolean(revived?.question) && String(revived.question._id) !== String(dead._id);
  also('(g-i) a pin at a discarded item is ignored and a live item is served instead', gi,
    `served ${String(revived?.question?._id ?? 'none').slice(0, 8)} · dead ${String(dead._id).slice(0, 8)}`);
  also('(g-i) the server does not claim it resumed a question it did not resume',
    revived?.resumed === false, `resumed=${revived?.resumed}`);

  // (ii) The real path. The teacher discards the item the student is looking at
  //      RIGHT NOW, through the actual HTTP route, in a session whose bank the
  //      live loop has already cached. This is the scenario that happens in a
  //      classroom, and it is the one the module-level bank cache can hide.
  const s4 = await connect(base);
  sockets.push(s4);
  const held = await join(s4, live.code, ROLL_C);
  const pinned = held.question._id;

  const discard = await fetch(`${base}/api/bank/question/${pinned}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-teacher-key': config.teacherKey },
    body: JSON.stringify({ status: 'discarded' }),
  });
  also('(g-ii) the teacher\'s discard is accepted by the API', discard.ok, `HTTP ${discard.status}`);

  await destroy(s4, live.code, ROLL_C);
  const s5 = await connect(base);
  sockets.push(s5);
  const afterDiscard = await join(s5, live.code, ROLL_C);
  const gii = String(afterDiscard?.question?._id ?? '') !== String(pinned);
  also('(g-ii) a live session stops serving an item the teacher just discarded', gii,
    gii
      ? `served ${String(afterDiscard.question._id).slice(0, 8)}, not the discarded ${String(pinned).slice(0, 8)}`
      : `SERVED THE DISCARDED ITEM ${String(pinned).slice(0, 8)} - the bank cache never heard about the edit`);

  step('g', 'a pin at a discarded question is ignored, a fresh one is served', gi,
    gi ? 'cold path proven; see (g-ii) for the cached path' : 'a dead item was served');

  exitCode = hardFail ? 1 : 0;
} catch (err) {
  rows.push({ id: '!', label: 'the run itself threw', status: 'FAIL', detail: err.message });
  hardFail += 1;
  exitCode = 1;
} finally {
  for (const s of sockets) s.close();
  // Leave the database as we found it: the fixture content stays and is reused,
  // everything else this run created goes.
  await repo.deleteSession(live._id).catch(() => {});
  await repo.deleteSession(fresh._id).catch(() => {});
  await repo.deleteQuestions(content._id).catch(() => {});
  io.close();
  server.close();
  await closeStore();
}

// ------------------------------------------------------------------ report --

const w = (s, n) => String(s).padEnd(n);
const line = `+${'-'.repeat(5)}+${'-'.repeat(66)}+${'-'.repeat(8)}+`;
console.log(line);
console.log(`| ${w('step', 3)} | ${w('what was proved', 64)} | ${w('result', 6)} |`);
console.log(line);
for (const r of rows) {
  console.log(`| ${w(r.id, 3)} | ${w(r.label.slice(0, 64), 64)} | ${w(r.status, 6)} |`);
}
console.log(line);

console.log('\ndetail:');
for (const r of rows) if (r.detail) console.log(`  ${(r.id || '·').padEnd(2)} ${r.label.trim()}: ${r.detail}`);

const mandated = rows.filter((r) => r.id && r.id !== '!');
console.log(
  `\nmandated steps: ${mandated.length}   failures: ${mandated.filter((r) => r.status === 'FAIL').length}` +
    `   supporting failures: ${hardFail - mandated.filter((r) => r.status === 'FAIL').length}` +
    `   known holes: ${softFail}`,
);
if (softFail) console.log('WARN rows are real defects that this suite does not yet fail on. Read them.');

process.exit(exitCode);
