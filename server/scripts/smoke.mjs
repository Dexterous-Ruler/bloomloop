// End-to-end smoke test. Boots the real server in-process on an ephemeral port
// and drives the exact HTTP + Socket.io paths the demo uses, so a green run here
// means the Monday demo script runs. Build-order step 10 ("dry-run full demo
// twice") automated, because doing it by hand twice at 2am is how things get missed.
//
//   node server/scripts/smoke.mjs
//
// Exits non-zero on the first hard failure, and prints a numbered report that
// maps 1:1 onto the acceptance criteria in completion.md section 3.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

import { initStore, getRepo, closeStore } from '../src/repo/index.js';
import { createApp } from '../src/app.js';
import { attachSockets } from '../src/sockets/index.js';
import { SAMPLE } from '../src/sampleContent.js';
import { LEVELS, LABEL, levelIndex } from '../src/bloom.js';
import { config } from '../src/config.js';

let pass = 0;
const failures = [];
const timings = {};

function check(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function once(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeout);
    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/**
 * A queued event channel. The server dispatches the first question during the
 * join handler, so a listener attached later would miss it — every inbound
 * event has to be buffered from the moment the socket opens.
 */
function channel(socket, event) {
  const inbox = [];
  const waiters = [];
  socket.on(event, (payload) => {
    const w = waiters.shift();
    if (w) w.resolve(payload);
    else inbox.push(payload);
  });
  return (timeout = 8000) => {
    if (inbox.length) return Promise.resolve(inbox.shift());
    return new Promise((resolve, reject) => {
      const entry = { resolve: null };
      const timer = setTimeout(() => {
        const i = waiters.indexOf(entry);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error(`timed out waiting for "${event}"`));
      }, timeout);
      entry.resolve = (payload) => {
        clearTimeout(timer);
        resolve(payload);
      };
      waiters.push(entry);
    });
  };
}

/** A scripted student: joins, then answers until told to stop. */
async function student(base, { code, rollNo, name, strategy }) {
  const socket = ioClient(base, { transports: ['websocket'] });
  await once(socket, 'connect');

  // Buffers attached before join, so nothing dispatched during it is lost.
  const nextQuestion = channel(socket, 'server:question');
  const nextResult = channel(socket, 'server:result');
  const nextExhausted = channel(socket, 'server:exhausted');
  let exhausted = false;
  nextExhausted(3_600_000).then(() => { exhausted = true; }).catch(() => {});

  socket.emit('student:join', { code, rollNo, name });
  const accepted = await once(socket, 'session:accepted');

  const served = [];
  return {
    socket,
    rollNo,
    accepted,
    served,
    async play(rounds) {
      for (let i = 0; i < rounds; i += 1) {
        if (exhausted) break;
        let q;
        try {
          q = await nextQuestion(6000);
        } catch {
          break;
        }
        served.push(q.question);
        // Answer without ever being told the right index — the payload does not
        // carry it, which is itself one of the assertions below.
        const pick = strategy(i) ? await correctIndexFor(q.question._id) : await wrongIndexFor(q.question._id);
        socket.emit('student:answer', { questionId: q.question._id, answerIdx: pick });
        try {
          await nextResult(6000);
        } catch {
          break;
        }
        socket.emit('student:next', {});
      }
    },
    close() {
      socket.close();
    },
  };
}

// The scripted student cheats via the repo to answer "correctly" on demand.
// A real phone cannot do this — the server never sends answerIdx before scoring.
let repoRef = null;
async function correctIndexFor(questionId) {
  const q = await repoRef.getQuestion(questionId);
  return q ? q.answerIdx : 0;
}
async function wrongIndexFor(questionId) {
  const q = await repoRef.getQuestion(questionId);
  return q ? (q.answerIdx + 1) % 4 : 1;
}

async function main() {
  console.log('\nBloomLoop end-to-end smoke test');
  console.log('='.repeat(64));

  await initStore({ log: () => {} });
  repoRef = getRepo();
  console.log(`  store: ${repoRef.kind}\n`);

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  attachSockets(io);
  app.set('io', io); // routes/session.js reads this to announce a close
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // The smoke test drives the teacher side, so it carries the teacher key the
  // same way the console does. The student socket path below carries nothing -
  // that asymmetry is the point, and is asserted at the end.
  const TEACHER = { 'x-teacher-key': config.teacherKey };

  const get = async (p, headers = TEACHER) => {
    const res = await fetch(base + p, { headers });
    const ct = res.headers.get('content-type') || '';
    return { res, body: ct.includes('json') ? await res.json() : await res.text() };
  };
  const post = async (p, body) => {
    const res = await fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...TEACHER },
      body: JSON.stringify(body),
    });
    return { res, body: await res.json().catch(() => ({})) };
  };

  // ---- F1 ---------------------------------------------------------------
  console.log('F1  content ingestion');
  const t1 = Date.now();
  const up = await post('/api/content', { title: SAMPLE.title, text: SAMPLE.rawText });
  timings.ingest = Date.now() - t1;
  check('syllabus paste accepted', up.res.status < 300, `status ${up.res.status}`);
  check('topic list returned', Array.isArray(up.body.topics) && up.body.topics.length >= 3,
    `${up.body.topics?.length} topics in ${timings.ingest}ms`);
  const contentId = up.body.contentId;
  check('contentId returned', Boolean(contentId));

  // ---- F2 ---------------------------------------------------------------
  console.log('\nF2  Bloom-tagged generation');
  const topics = (up.body.topics || SAMPLE.topics).slice(0, 6);
  const t2 = Date.now();
  const gen = await post('/api/generate', { contentId, topics });
  timings.generate = Date.now() - t2;
  check('generation succeeded', gen.res.status < 300, `status ${gen.res.status} ${gen.body.error || ''}`);
  check('generated 40+ items', (gen.body.generated ?? 0) >= 40,
    `${gen.body.generated} items in ${(timings.generate / 1000).toFixed(1)}s (source: ${gen.body.source})`);
  check('under the 2-minute claim', timings.generate < 120000, `${(timings.generate / 1000).toFixed(1)}s`);
  // Generated questions are drafts until a professor approves them; a room
  // serves approved questions only.
  const approval = await post(`/api/bank/${contentId}/approve-all`, {});
  check('every draft approved', approval.res.status < 300 && approval.body.approved === gen.body.generated,
    `${approval.body.approved} of ${gen.body.generated}`);

  const bank = await get(`/api/bank/${contentId}`);
  const items = bank.body.questions || [];
  check('every item carries exactly one valid tag',
    items.length > 0 && items.every((q) => LEVELS.includes(q.bloom)));
  check('every item is a 4-option MCQ with a valid answer',
    items.every((q) => Array.isArray(q.options) && q.options.length === 4
      && Number.isInteger(q.answerIdx) && q.answerIdx >= 0 && q.answerIdx <= 3));
  const covered = new Set(items.map((q) => q.bloom));
  check('spread covers Remember/Understand/Apply/Analyse',
    ['remember', 'understand', 'apply', 'analyse'].every((l) => covered.has(l)),
    [...covered].map((l) => LABEL[l]).join(', '));

  // ---- F4 ---------------------------------------------------------------
  console.log('\nF4  room-code session');
  const sess = await post('/api/session', { contentId, title: SAMPLE.title });
  check('session opened', sess.res.status < 300, `status ${sess.res.status} ${sess.body.error || ''}`);
  const code = sess.body.code;
  check('6-character room code', typeof code === 'string' && code.length === 6, code);

  const teacher = ioClient(base, { transports: ['websocket'] });
  await once(teacher, 'connect');
  teacher.emit('teacher:watch', { code });
  const firstGrid = await once(teacher, 'teacher:grid');
  check('teacher receives a grid on watch', Array.isArray(firstGrid.rows));

  // 10 devices, the transcript's number.
  const weakStrategy = (i) => i % 5 === 0;      // ~20% correct -> below the band
  const strongStrategy = () => true;            // climbs the ladder
  const students = [];
  for (let i = 1; i <= 10; i += 1) {
    const roll = String(i).padStart(2, '0');
    students.push(await student(base, {
      code, rollNo: roll, name: `Student ${roll}`,
      strategy: i <= 5 ? weakStrategy : strongStrategy,
    }));
  }
  check('10 devices joined one code', students.length === 10);
  check('every device received a first question',
    students.every((s) => s.accepted && s.accepted.bankCount > 0));

  // ---- F3 + F5 ----------------------------------------------------------
  console.log('\nF3  differentiation  /  F5  live evaluation');
  const tAnswer = Date.now();
  await Promise.all(students.map((s) => s.play(8)));
  timings.play = Date.now() - tAnswer;
  await sleep(400);

  const gridRes = await get(`/api/session/${code}/grid`);
  const rows = gridRes.body.rows || [];
  check('grid has exactly 10 rows, one per student', rows.length === 10, `${rows.length} rows`);

  const weakRows = rows.filter((r) => ['01', '02', '03', '04', '05'].includes(r.rollNo));
  const strongRows = rows.filter((r) => ['06', '07', '08', '09', '10'].includes(r.rollNo));

  check('weak students land in the below-40% band',
    weakRows.every((r) => r.slowLearner === true),
    weakRows.map((r) => `${r.rollNo}:${r.slowLearner}`).join(' '));

  check('the slow-learner ceiling held — nothing above Understand was ever served',
    students.slice(0, 5).every((s) => s.served.every((q) => levelIndex(q.bloom) <= levelIndex('understand'))),
    students.slice(0, 5).flatMap((s) => s.served.map((q) => q.bloom))
      .filter((b) => levelIndex(b) > 1).join(',') || 'clean');

  check('strong students climbed above Understand',
    strongRows.some((r) => levelIndex(r.workingLevel) > levelIndex('understand')),
    strongRows.map((r) => `${r.rollNo}:${r.workingLevel}`).join(' '));

  // THE demo moment, asserted rather than hoped for.
  const weakLevels = new Set(students.slice(0, 5).flatMap((s) => s.served.map((q) => q.bloom)));
  const strongLevels = new Set(students.slice(5).flatMap((s) => s.served.map((q) => q.bloom)));
  const divergent = [...strongLevels].some((l) => !weakLevels.has(l));
  check('THE DEMO MOMENT: weak and strong students were served different levels in one session',
    divergent,
    `weak saw {${[...weakLevels].join(',')}}  strong saw {${[...strongLevels].join(',')}}`);

  check('no question payload ever leaked answerIdx',
    students.every((s) => s.served.every((q) => q.answerIdx === undefined)));

  check('every row reports a reason the teacher can read aloud',
    rows.every((r) => typeof r.reason === 'string' && r.reason.length > 0),
    rows[0]?.reason);

  // ---- TC-07 reconnect --------------------------------------------------
  console.log('\nTC-07  drop and rejoin');
  const before = rows.find((r) => r.rollNo === '03');
  students[2].close();
  await sleep(300);
  const rejoined = await student(base, { code, rollNo: '03', name: 'Student 03', strategy: () => false });
  await sleep(300);
  const after = (await get(`/api/session/${code}/grid`)).body.rows || [];
  check('rejoin did not create a duplicate row', after.length === 10, `${after.length} rows`);
  const back = after.find((r) => r.rollNo === '03');
  check('rejoin resumed the same profile',
    back && before && back.total.seen === before.total.seen && back.workingLevel === before.workingLevel,
    `seen ${before?.total.seen} -> ${back?.total.seen}, level ${before?.workingLevel} -> ${back?.workingLevel}`);
  rejoined.close();

  // ---- double tap -------------------------------------------------------
  const dupTarget = students[9];
  const seenBefore = (await get(`/api/session/${code}/grid`)).body.rows.find((r) => r.rollNo === '10')?.total.seen;
  const lastQ = dupTarget.served[dupTarget.served.length - 1];
  if (lastQ) {
    dupTarget.socket.emit('student:answer', { questionId: lastQ._id, answerIdx: 0 });
    await sleep(400);
    const seenAfter = (await get(`/api/session/${code}/grid`)).body.rows.find((r) => r.rollNo === '10')?.total.seen;
    check('a re-sent answer for an already-answered question is ignored',
      seenBefore === seenAfter, `${seenBefore} -> ${seenAfter}`);
  }

  // ---- F6 ---------------------------------------------------------------
  console.log('\nF6  export');
  const exp = await fetch(`${base}/api/session/${code}/export`, { headers: TEACHER });
  const csv = await exp.text();
  const lines = csv.trim().split(/\r?\n/);
  check('CSV downloads', exp.ok, `status ${exp.status}`);
  check('CSV is an attachment', (exp.headers.get('content-disposition') || '').includes('attachment'));
  check('CSV has a header plus one row per student', lines.length === 11, `${lines.length} lines`);
  check('CSV carries per-level columns',
    /Remember/i.test(lines[0]) && /Create/i.test(lines[0]) && /Roll/i.test(lines[0]));

  const classroom = await get('/api/classroom/status');
  check('classroom status answers without throwing', classroom.res.status < 500,
    `configured=${classroom.body.configured}`);

  // ---- the answer key must not be reachable from a phone -----------------
  // A student knows the room code (it is on the projector) and nothing else.
  // That must not be enough to walk the API to answerIdx.
  console.log('\nSEC  a student with the room code cannot reach the answer key');
  const asStudent = { 'content-type': 'application/json' };

  const pubSession = await get(`/api/session/${code}`, asStudent);
  check('GET /session/:code stays open to students', pubSession.res.ok);
  check('...but never leaks contentId',
    pubSession.body?.session?.contentId === undefined && pubSession.body?.contentId === undefined,
    JSON.stringify(Object.keys(pubSession.body?.session ?? {})));

  const stolenBank = await get(`/api/bank/${contentId}`, asStudent);
  check('GET /bank/:contentId refuses an unkeyed request', stolenBank.res.status === 401,
    `status ${stolenBank.res.status}`);
  const stolenList = await get('/api/content', asStudent);
  check('GET /content refuses an unkeyed request', stolenList.res.status === 401,
    `status ${stolenList.res.status}`);
  const stolenGrid = await get(`/api/session/${code}/grid`, asStudent);
  check('GET /session/:code/grid refuses an unkeyed request', stolenGrid.res.status === 401,
    `status ${stolenGrid.res.status}`);
  const stolenCsv = await fetch(`${base}/api/session/${code}/export`);
  check('CSV export refuses an unkeyed request', stolenCsv.status === 401,
    `status ${stolenCsv.status}`);

  // ---- close ------------------------------------------------------------
  const closed = await post(`/api/session/${code}/close`);
  check('session closes cleanly', closed.res.status < 300);

  students.forEach((s) => s.close());
  teacher.close();
  io.close();
  server.close();
  await closeStore();

  console.log(`\n${'='.repeat(64)}`);
  console.log(`  ${pass} passed, ${failures.length} failed`);
  console.log(`  ingest ${timings.ingest}ms · generate ${(timings.generate / 1000).toFixed(1)}s · 80 answers ${(timings.play / 1000).toFixed(1)}s`);
  if (failures.length) {
    console.log('\n  FAILED:');
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  console.log('='.repeat(64) + '\n');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('\n[smoke] crashed:', err);
  process.exit(1);
});
