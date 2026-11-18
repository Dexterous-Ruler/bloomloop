// Integrity signals - the proof.
//
// Phase 6 records what is honestly observable about a student's session and
// hands a teacher evidence with its uncertainty attached. That makes this suite
// unusual: the failure that matters most is not a missed signal, it is an
// invented one. A missed signal costs a teacher a prompt to look. An invented
// one is an accusation against a named student, and it arrives looking exactly
// as confident as a true one.
//
// So step (d) is the centre of this file. It answers a question at a completely
// ordinary speed and demands that the profile stay EMPTY - not "no too-fast
// event", but nothing at all, and summarise() still reading 'clear'. Every other
// step here proves a signal fires; that one proves the module keeps its mouth
// shut, which is the harder and more important property.
//
// It drives the REAL socket server - the same initStore/createApp/attachSockets
// that index.js boots - over socket.io-client on a real port, against the real
// store. Nothing is stubbed. In particular the signals travel over the actual
// `student:signal` socket event rather than calling reportFromClient() directly,
// because the allow-list is only worth anything if it is enforced on the path a
// student's devtools can actually reach.
//
// Fixture data is created, used and torn down each run: two content rows named
// below are reused forever, their questions are rewritten, and the sessions and
// profiles are deleted at the end. Running this against a live database leaves
// nothing behind.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = 'file:///C:/Users/tanis/wayground/server/src';
const { initStore, getRepo, closeStore } = await import(`${SRC}/repo/index.js`);
const { createApp } = await import(`${SRC}/app.js`);
const { attachSockets, isOnline } = await import(`${SRC}/sockets/index.js`);
const { emptyProfile } = await import(`${SRC}/services/mastery.js`);
const { summarise, minPlausibleMs, REPORTED, OBSERVED } = await import(`${SRC}/services/integrity.js`);

const FIXTURE_LONG = 'BloomLoop integrity harness LONG (safe to delete)';
const FIXTURE_SHORT = 'BloomLoop integrity harness SHORT (safe to delete)';

const ROLL_SIGNALS = 'INTEG-A';
const ROLL_FAST = 'INTEG-C';
const ROLL_PLAUSIBLE = 'INTEG-D';
const ROLL_TWOLIVE = 'INTEG-E';
const ROLL_RECONNECT = 'INTEG-F';

// A kind no allow-list will ever contain. This is the forgery in step (b).
const BOGUS = 'exam-answers-please';

// How much longer than the server's own threshold step (d) waits. The point is
// to sit far enough clear of the boundary that a pass cannot be luck.
const PLAUSIBLE_MARGIN_MS = 1500;

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
 * Wait for one event, treating a rejection as a failure rather than a timeout -
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

/**
 * Join, and hand back both the acceptance and the first question.
 *
 * Both are needed and for different reasons: `session:accepted` is emitted AFTER
 * handleJoin has written any second-socket signal, so it is the barrier step (e)
 * synchronises on, while `server:question` carries the item steps (c) and (d)
 * answer. Subscribing to both before emitting avoids losing whichever lands
 * first.
 */
async function join(socket, code, rollNo) {
  const accepted = next(socket, 'session:accepted');
  const question = next(socket, 'server:question');
  socket.emit('student:join', { code, rollNo, name: rollNo });
  return { accepted: await accepted, served: await question };
}

/** Kill the transport outright: no graceful namespace disconnect, no answer. */
async function destroy(socket, code, rollNo) {
  socket.io.engine.close();
  socket.close();
  // The server has to have PROCESSED the loss before the next socket joins,
  // otherwise the reconnect is racing the presence map and step (e) would go
  // green or red depending on scheduler luck - which is exactly the distinction
  // it exists to prove.
  const until = Date.now() + 5000;
  while (isOnline(code, rollNo) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isOnline(code, rollNo);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- store reads --

const eventsOf = async (sessionId, rollNo) => {
  const profile = await getRepo().getProfile(sessionId, rollNo);
  return Array.isArray(profile?.integrity) ? profile.integrity : [];
};

const kinds = (events) => events.map((e) => e.kind);

/**
 * `student:signal` is deliberately silent - it acks nothing, because telling a
 * student which reports land tells them exactly what to suppress. So the only
 * honest way to observe one is to watch the store until it shows up.
 */
async function waitForKind(sessionId, rollNo, kind, ms = 5000) {
  const until = Date.now() + ms;
  for (;;) {
    const events = await eventsOf(sessionId, rollNo);
    if (events.some((e) => e.kind === kind)) return events;
    if (Date.now() > until) return events;
    await sleep(50);
  }
}

// ------------------------------------------------------------------- setup --

const mcq = (id, bloom, text) => ({
  topic: 'Integrity harness',
  text,
  kind: 'mcq',
  options: [`${id} right`, `${id} wrong 1`, `${id} wrong 2`, `${id} wrong 3`],
  answerIdx: 0,
  bloom,
  status: 'active',
  source: 'fallback',
});

// Long enough that minPlausibleMs() is tens of seconds, so an instant answer is
// unambiguously too fast rather than marginally so.
const WALL = 'This item exists to be long. '.repeat(45);

await initStore({ log: () => {} });
const repo = getRepo();

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
attachSockets(io);
app.set('io', io);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

/**
 * Two banks, because the selector picks the item and this suite cannot ask it
 * for a particular one. Making every question in a bank long (or short) means
 * whatever comes back has the property the step under test needs, without
 * reaching past the selector to stage it.
 *
 * ownerId stays null: an unowned deck is the only kind the shared teacher key is
 * allowed to write to, matching the resume harness.
 */
const contents = await repo.listContents();
const ensure = async (title) =>
  contents.find((c) => c.title === title) ??
  (await repo.createContent({ title, kind: 'syllabus', rawText: '', topics: ['Integrity harness'], ownerId: null }));

const contentLong = await ensure(FIXTURE_LONG);
const contentShort = await ensure(FIXTURE_SHORT);

await repo.deleteQuestions(contentLong._id);
await repo.deleteQuestions(contentShort._id);

// A cold-start profile sits at Understand and is eligible for Remember and
// Understand, so both pools are deep at both levels - nothing here may run out
// mid-proof and turn a real failure into "the bank was exhausted".
const longBank = await repo.insertQuestions(
  [
    mcq('L1', 'understand', `Understand, at length. ${WALL}`),
    mcq('L2', 'understand', `Understand, at length, again. ${WALL}`),
    mcq('L3', 'understand', `A third long understand item. ${WALL}`),
    mcq('L4', 'remember', `Remember, at length. ${WALL}`),
    mcq('L5', 'remember', `Remember, at length, again. ${WALL}`),
  ].map((q) => ({ ...q, contentId: contentLong._id })),
);

const shortBank = await repo.insertQuestions(
  [
    mcq('S1', 'understand', 'Short one.'),
    mcq('S2', 'understand', 'Short two.'),
    mcq('S3', 'understand', 'Short three.'),
    mcq('S4', 'remember', 'Short four.'),
    mcq('S5', 'remember', 'Short five.'),
  ].map((q) => ({ ...q, contentId: contentShort._id })),
);

const codeFor = () =>
  Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

const longSession = await repo.createSession({ code: codeFor(), contentId: contentLong._id, title: FIXTURE_LONG, ownerId: null });
const shortSession = await repo.createSession({ code: codeFor(), contentId: contentShort._id, title: FIXTURE_SHORT, ownerId: null });

console.log(
  `store: ${repo.kind} · long bank ${longBank.length} · short bank ${shortBank.length} · ` +
    `long ${longSession.code} · short ${shortSession.code}\n`,
);

const sockets = [];
let exitCode = 1;

try {
  // ------------------------------ (a) an allow-listed report is recorded --
  const sA = await connect(base);
  sockets.push(sA);
  await join(sA, shortSession.code, ROLL_SIGNALS);

  sA.emit('student:signal', { kind: 'hidden', awayMs: 4200 });
  const afterHidden = await waitForKind(shortSession._id, ROLL_SIGNALS, 'hidden');
  const hidden = afterHidden.find((e) => e.kind === 'hidden');

  step('a', 'a browser-reported signal on the allow-list is recorded', Boolean(hidden),
    hidden ? `kind=${hidden.kind} src=${hidden.src} awayMs=${hidden.awayMs}` : `nothing recorded; got [${kinds(afterHidden)}]`);
  also('it is marked src=reported, never observed', hidden?.src === 'reported', `src=${hidden?.src}`);
  also('the meta the browser sent is kept, bounded', hidden?.awayMs === 4200, `awayMs=${hidden?.awayMs}`);

  // --------------------- (b) a signal off the allow-list is recorded NOWHERE --
  //
  // Two forgeries, then one legitimate signal as a barrier. The barrier is what
  // makes the absence provable: `student:signal` acks nothing, so without a
  // later event that DOES land there is no moment at which "not written yet" can
  // be distinguished from "never written".
  sA.emit('student:signal', { kind: BOGUS, awayMs: 1 });
  // The nastier forgery of the two. 'too-fast' is a real kind the teacher's
  // screen renders as hard evidence - but it is OBSERVED, meaning the server
  // derives it and a client may never claim it. If the allow-list let this
  // through, a phone could write server-grade evidence about itself.
  sA.emit('student:signal', { kind: 'too-fast', tookMs: 1, expectedMs: 99999 });
  sA.emit('student:signal', { kind: 'blurred' });

  const afterBarrier = await waitForKind(shortSession._id, ROLL_SIGNALS, 'blurred');
  const noBogus = !afterBarrier.some((e) => e.kind === BOGUS);
  const noClaimedObserved = !afterBarrier.some((e) => e.kind === 'too-fast');
  const onlyTwo = afterBarrier.length === 2;

  step('b', 'a signal NOT on the allow-list is rejected and recorded nowhere',
    noBogus && noClaimedObserved && onlyTwo,
    `events=[${kinds(afterBarrier)}] (expected exactly hidden,blurred)`);
  also('the invented kind is absent', noBogus, `${BOGUS} ${noBogus ? 'not present' : 'WAS RECORDED'}`);
  also('a client may not claim an OBSERVED kind (too-fast)', noClaimedObserved,
    noClaimedObserved ? 'refused' : 'A PHONE WROTE SERVER-GRADE EVIDENCE');
  also('nothing landed under a different name either', onlyTwo, `${afterBarrier.length} event(s), expected 2`);

  // "Nowhere" means nowhere: not on a neighbouring row either.
  const allProfiles = await repo.listProfiles(shortSession._id);
  const strayed = allProfiles.some((p) => (p.integrity ?? []).some((e) => e.kind === BOGUS || e.kind === 'too-fast'));
  also('and it did not land on any other profile in the session', !strayed,
    `${allProfiles.length} profile(s) checked`);

  also('the two lists are disjoint, so nothing is both claimable and derived',
    REPORTED.every((k) => !OBSERVED.includes(k)),
    `reported=${REPORTED.length} observed=${OBSERVED.length}`);

  // ------------------------- (c) an impossibly fast answer records too-fast --
  const sC = await connect(base);
  sockets.push(sC);
  const { served: servedC } = await join(sC, longSession.code, ROLL_FAST);
  const qC = longBank.find((q) => String(q._id) === String(servedC.question._id));
  const floorC = minPlausibleMs(qC);

  // Answered the instant it arrives - no human read a 1300-character question in
  // the time this takes.
  const startC = Date.now();
  const resultC = next(sC, 'server:result');
  sC.emit('student:answer', { questionId: String(servedC.question._id), response: 0 });
  await resultC;
  const tookC = Date.now() - startC;

  const eventsC = await eventsOf(longSession._id, ROLL_FAST);
  const fast = eventsC.find((e) => e.kind === 'too-fast');

  step('c', 'an answer faster than the question could be read records too-fast', Boolean(fast),
    fast ? `tookMs=${fast.tookMs} expectedMs=${fast.expectedMs}` : `nothing recorded; got [${kinds(eventsC)}]`);
  also('with src=observed, because the server derived it', fast?.src === 'observed', `src=${fast?.src}`);
  also('the threshold is length-aware, not a flat number',
    floorC > 10000, `floor for this item ${floorC}ms over ${qC?.text?.length ?? 0} chars`);
  also('the recorded gap matches the wall clock', Math.abs((fast?.tookMs ?? 0) - tookC) < 2000,
    `recorded ${fast?.tookMs}ms vs measured ~${tookC}ms`);

  // ---------- (d) a plausible answer records NOTHING - the one that matters --
  //
  // A false positive here is an accusation, so this asserts the strongest thing
  // available: not "no too-fast event", but an integrity list that is still
  // completely empty, and summarise() still reading 'clear'.
  const sD = await connect(base);
  sockets.push(sD);
  const { served: servedD } = await join(sD, shortSession.code, ROLL_PLAUSIBLE);
  const qD = shortBank.find((q) => String(q._id) === String(servedD.question._id));
  const floorD = minPlausibleMs(qD);

  const beforeD = await eventsOf(shortSession._id, ROLL_PLAUSIBLE);

  // Deliberately derived from the server's own threshold rather than hard-coded,
  // so this stays a real margin if the reading-speed constant is ever retuned.
  const waitD = floorD + PLAUSIBLE_MARGIN_MS;
  await sleep(waitD);

  const resultD = next(sD, 'server:result');
  sD.emit('student:answer', { questionId: String(servedD.question._id), response: 0 });
  await resultD;

  const eventsD = await eventsOf(shortSession._id, ROLL_PLAUSIBLE);
  const summaryD = summarise(await repo.getProfile(shortSession._id, ROLL_PLAUSIBLE));

  step('d', 'an answer taking a plausible time records NOTHING', eventsD.length === 0,
    eventsD.length === 0
      ? `waited ${waitD}ms against a ${floorD}ms floor, integrity list empty`
      : `FALSE POSITIVE - recorded [${kinds(eventsD)}] for an honest answer`);
  also('the profile was clean before the answer too', beforeD.length === 0, `${beforeD.length} event(s) before`);
  also('no too-fast in particular', !eventsD.some((e) => e.kind === 'too-fast'),
    'the accusation this step exists to prevent');
  also('and the teacher-facing summary still reads clear', summaryD.level === 'clear',
    `level=${summaryD.level} events=${summaryD.events} notes=${summaryD.notes.length}`);

  // ------------- (e) two LIVE sockets vs a reconnect after a real disconnect --
  //
  // The distinction is the entire value of this signal: both look like "the same
  // roll number joined twice" from the outside, and only one of them is worth a
  // teacher's attention.
  const sE1 = await connect(base);
  sockets.push(sE1);
  await join(sE1, shortSession.code, ROLL_TWOLIVE);

  // The first socket is still connected here - that is the point.
  const sE2 = await connect(base);
  sockets.push(sE2);
  await join(sE2, shortSession.code, ROLL_TWOLIVE);

  const eventsE = await eventsOf(shortSession._id, ROLL_TWOLIVE);
  const second = eventsE.filter((e) => e.kind === 'second-socket');

  const sF1 = await connect(base);
  sockets.push(sF1);
  await join(sF1, shortSession.code, ROLL_RECONNECT);
  const droppedF = await destroy(sF1, shortSession.code, ROLL_RECONNECT);

  const sF2 = await connect(base);
  sockets.push(sF2);
  await join(sF2, shortSession.code, ROLL_RECONNECT);

  const eventsF = await eventsOf(shortSession._id, ROLL_RECONNECT);
  const falseAlarm = eventsF.filter((e) => e.kind === 'second-socket');

  step('e', 'two LIVE sockets record second-socket; a reconnect does not',
    second.length === 1 && falseAlarm.length === 0,
    `two-live=${second.length} (want 1) · reconnect=${falseAlarm.length} (want 0)`);
  also('the live collision is marked src=observed', second[0]?.src === 'observed', `src=${second[0]?.src}`);
  also('it names the socket it collided with', Boolean(second[0]?.other), `other=${second[0]?.other ?? 'none'}`);
  also('the genuine disconnect really was processed first', droppedF,
    droppedF ? 'presence cleared before the rejoin' : 'still online after 5s - the reconnect leg proves nothing');
  also('a reconnecting student is left with a completely clean profile',
    eventsF.length === 0, `[${kinds(eventsF)}]`);

  // ----------------------------- (f) an untouched profile summarises clear --
  const untouched = summarise(emptyProfile({ sessionId: String(shortSession._id), rollNo: 'INTEG-NOBODY', name: '' }));

  step('f', "summarise() returns level 'clear' for an untouched profile", untouched.level === 'clear',
    `level=${untouched.level} events=${untouched.events} reported=${untouched.reported} observed=${untouched.observed}`);
  also('with no notes, so the UI has nothing to render', untouched.notes.length === 0,
    `${untouched.notes.length} note(s)`);
  also('and it tolerates a profile with no integrity field at all',
    summarise({}).level === 'clear', `level=${summarise({}).level}`);

  exitCode = hardFail ? 1 : 0;
} catch (err) {
  rows.push({ id: '!', label: 'the run itself threw', status: 'FAIL', detail: err.message });
  hardFail += 1;
  exitCode = 1;
} finally {
  for (const s of sockets) s.close();
  // Leave the database as we found it: the fixture contents stay and are reused,
  // everything else this run created goes.
  await repo.deleteSession(longSession._id).catch(() => {});
  await repo.deleteSession(shortSession._id).catch(() => {});
  await repo.deleteQuestions(contentLong._id).catch(() => {});
  await repo.deleteQuestions(contentShort._id).catch(() => {});
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
