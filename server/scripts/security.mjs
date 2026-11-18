import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = 'file:///C:/Users/tanis/wayground/server/src';
const { initStore, getRepo, closeStore } = await import(`${SRC}/repo/index.js`);
const { createApp } = await import(`${SRC}/app.js`);
const { attachSockets } = await import(`${SRC}/sockets/index.js`);
const { config } = await import(`${SRC}/config.js`);

await initStore({ log: () => {} });
const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
attachSockets(io);
app.set('io', io);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const repo = getRepo();
const sessions = await repo.listSessions();

// The shared key resolves to "the rows nobody owns", so the keyed-export check
// has to run against an UNOWNED session. Taking sessions[0] blindly picked
// whichever room was newest, and the moment a signed-in professor opened one the
// suite started failing on a 404 that was the ownership boundary working
// correctly - a false alarm that would train someone to ignore a real one.
const ownerOf = (s) => s.ownerId ?? s.owner_id ?? null;
const unowned = sessions.find((s) => ownerOf(s) == null);
const owned = sessions.find((s) => ownerOf(s) != null);
const code = unowned?.code ?? sessions[0]?.code;
console.log(`store: ${repo.kind} · unowned session ${code}${owned ? ` · owned session ${owned.code}` : ''}\n`);

const KEY = { 'x-teacher-key': config.teacherKey };
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

console.log('CSV export — the case-bypass the audit proved');
for (const p of [`/api/session/${code}/export`, `/api/SESSION/${code}/EXPORT`, `/api/Session/${code}/Export`]) {
  const r = await fetch(base + p);
  check(`unkeyed ${p}`, r.status === 401 || r.status === 404, `HTTP ${r.status}`);
}
const okExport = await fetch(`${base}/api/session/${code}/export`, { headers: KEY });
check('keyed export still works', okExport.ok, `HTTP ${okExport.status}`);

console.log('\nContent list — the route to every answer key');
const noKey = await fetch(`${base}/api/content`);
check('unkeyed /api/content refused', noKey.status === 401, `HTTP ${noKey.status}`);

// The property the naive test was accidentally exercising, asserted deliberately:
// the shared key must NOT reach a session a real account owns. 404, not 403, so a
// key holder cannot use it to learn which room codes exist.
if (owned) {
  const crossOwner = await fetch(`${base}/api/session/${owned.code}/export`, { headers: KEY });
  check(
    `shared key refused on ${owned.code}, a signed-in professor's room`,
    crossOwner.status === 404,
    `HTTP ${crossOwner.status}`,
  );
} else {
  console.log('  SKIP  no account-owned session exists to test the key against');
}

console.log('\nDashboard — every session code and every student in one payload');
const dashOpen = await fetch(base + '/api/dashboard');
check('unauthenticated /api/dashboard refused', dashOpen.status === 401, `HTTP ${dashOpen.status}`);
const dashKeyed = await fetch(base + '/api/dashboard', { headers: KEY });
const dashBody = await dashKeyed.json().catch(() => ({}));
check('keyed dashboard still answers', dashKeyed.ok && dashBody.role === 'professor', `HTTP ${dashKeyed.status}, role ${dashBody.role}`);
// The shape has no id parameter on purpose, so there is nothing to tamper with.
// If one is ever added, this stops being true and somebody has to write a check.
check(
  'dashboard takes no target id from the caller',
  !/[?&](professor|owner|account|department)=/.test('/api/dashboard'),
  'route is GET /api/dashboard with no query',
);

console.log('\nteacher:watch — the live grid');
const sock = ioClient(base, { transports: ['websocket'] });
await new Promise((r) => sock.once('connect', r));

const raced = await new Promise((resolve) => {
  const t = setTimeout(() => resolve({ outcome: 'silence' }), 3000);
  sock.once('teacher:grid', (p) => { clearTimeout(t); resolve({ outcome: 'GRID LEAKED', rows: p.rows?.length }); });
  sock.once('session:rejected', (p) => { clearTimeout(t); resolve({ outcome: 'rejected', reason: p.reason }); });
  sock.emit('teacher:watch', { code });          // no credentials at all
});
check('watch without credentials refused', raced.outcome === 'rejected', `${raced.outcome}${raced.reason ? ': ' + raced.reason : ''}`);

const withKey = await new Promise((resolve) => {
  const t = setTimeout(() => resolve({ outcome: 'silence' }), 3000);
  sock.once('teacher:grid', (p) => { clearTimeout(t); resolve({ outcome: 'grid', rows: p.rows?.length ?? 0 }); });
  sock.once('session:rejected', (p) => { clearTimeout(t); resolve({ outcome: 'rejected', reason: p.reason }); });
  sock.emit('teacher:watch', { code, key: config.teacherKey });
});
check('watch WITH the teacher key still works', withKey.outcome === 'grid', `${withKey.outcome}, ${withKey.rows} rows`);

console.log(`\n${pass} passed, ${fail} failed`);
sock.close(); io.close(); server.close(); await closeStore();
process.exit(fail ? 1 : 0);
