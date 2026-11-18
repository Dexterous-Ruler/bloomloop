// Simulated students against a running server. Two uses:
//   - rehearse the demo alone, without borrowing ten phones
//   - test case TC-04, sixty clients on one room code
//
//   node server/scripts/students.mjs --code A7AD6N
//   node server/scripts/students.mjs --code A7AD6N --count 60 --rounds 6
//
// Half the cohort answers badly (they fall into the below-40% band and get
// capped at Remember/Understand) and half answers well (they climb), so the
// teacher grid fills with exactly the divergence the demo is about.
//
// Students stay connected until you Ctrl-C, so the grid keeps showing them
// online while you talk over it.

import { io } from 'socket.io-client';
import { initStore, getRepo, closeStore } from '../src/repo/index.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', 'http://localhost:5050');
const CODE = (arg('code') || '').toUpperCase();
const COUNT = Number(arg('count', '10'));
const ROUNDS = Number(arg('rounds', '8'));

if (!CODE) {
  console.error('Usage: node server/scripts/students.mjs --code <ROOMCODE> [--count 10] [--rounds 8]');
  process.exit(1);
}

// The simulated student reads the key straight from the store, which a real
// phone cannot do - the server never sends answerIdx before an answer is in.
await initStore({ log: () => {} });
const repo = getRepo();

const once = (socket, event, ms = 10000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

/** Buffer questions from the moment the socket opens - the first one is
    dispatched inside the join handler and would otherwise be missed. */
function queue(socket, event) {
  const inbox = [];
  const waiters = [];
  socket.on(event, (p) => {
    const w = waiters.shift();
    if (w) w(p);
    else inbox.push(p);
  });
  return () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiters.push(r)));
}

const sockets = [];

async function student(rollNo, name, correctRate) {
  const socket = io(BASE, { transports: ['websocket'] });
  sockets.push(socket);
  const nextQuestion = queue(socket, 'server:question');
  const nextResult = queue(socket, 'server:result');
  let done = false;
  socket.on('server:exhausted', () => { done = true; });
  socket.on('session:closed', () => { done = true; });

  await once(socket, 'connect');
  socket.emit('student:join', { code: CODE, rollNo, name });
  const accepted = await Promise.race([
    once(socket, 'session:accepted'),
    once(socket, 'session:rejected').then((p) => { throw new Error(p.reason); }),
  ]);
  if (!accepted) return;

  const served = [];
  for (let i = 0; i < ROUNDS && !done; i += 1) {
    let q;
    try {
      q = await nextQuestion(8000);
    } catch {
      break;
    }
    served.push(q.question.bloom);
    const stored = await repo.getQuestion(q.question._id);
    if (!stored) break;
    // Deterministic so a rehearsal looks the same every time, but SPREAD rather
    // than front-loaded: `i/10 < rate` would hand a weak student their correct
    // answers first, promoting them a level before the below-40% band engages.
    // The model handles that correctly, but the grid then shows Apply attempts
    // for a student the demo is calling capped, which invites the wrong question.
    const correct = ((i * 37) % 100) < correctRate * 100;
    socket.emit('student:answer', {
      questionId: q.question._id,
      answerIdx: correct ? stored.answerIdx : (stored.answerIdx + 1) % 4,
    });
    try {
      await nextResult(8000);
    } catch {
      break;
    }
    socket.emit('student:next', {});
  }
  console.log(`  roll ${rollNo.padEnd(3)} ${served.join(' -> ') || '(no items)'}`);
}

console.log(`\nJoining ${COUNT} students to ${CODE} at ${BASE}...\n`);

const jobs = [];
for (let i = 1; i <= COUNT; i += 1) {
  const rollNo = String(i).padStart(2, '0');
  const weak = i <= Math.ceil(COUNT / 2);
  jobs.push(
    student(rollNo, `Student ${rollNo}`, weak ? 0.25 : 0.95).catch((err) =>
      console.log(`  roll ${rollNo} failed: ${err.message}`),
    ),
  );
}
await Promise.all(jobs);

console.log(`\n${COUNT} students connected and still online. Ctrl-C to disconnect them.\n`);

const shutdown = async () => {
  sockets.forEach((s) => s.close());
  await closeStore();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
