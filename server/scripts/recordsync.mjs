// Phase 7 - teacher records sent again after the network drops, end to end.
//
//   node server/scripts/recordsync.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store. A professor's console works "offline":
// it queues an attendance register, observations, a draw and the pick's
// response, a question asked aloud and its tally steps, an activity, an edit of
// each, and what was done about an insight card, each with a key of its own,
// each write's basedOn filled in from the replies to the ones before it, just
// before its first send. Then it checks:
//
//   one pass      every queued write is done once, in order, and the console's
//                 own chained writes never refuse each other
//   replays       the whole outbox sent again in order, again in reverse, and
//                 again all at once: every reply is the kept one, marked
//                 replayed, and every stored record and count is exactly as
//                 after the first pass (a draw is the same pick, a tally step
//                 counts once, an activity is one row)
//   details       the same key with other details is a 409 with a sentence
//   no key        a write without one is done exactly as before (two steps: two)
//   newer         a write made from a record that has since moved on (changed
//                 online on another screen) is refused with 409, a sentence and
//                 the record as it stands, changes nothing, and is refused again
//                 when sent again; a tally step is never stale
//   who           another professor gets the same 404 as for nothing at all,
//                 an HOD 403, a student and no credentials are refused, key or
//                 no key
//   the room      deleting the room takes its keys with it; the archive carries
//                 the records and not the keys
//
// Signed-in accounts need Supabase Auth, which this suite must never reach. As in
// roster.mjs, the server is pointed at http://supabase.invalid (a name that can
// never resolve) and the three account calls it makes are answered here,
// in-process. Any other request off this machine is refused outright and counted.
//
// Never calls Gemini, Supabase or any network service. Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { decodeRoomArchive } = await import(`${SRC}services/archive.js`);
const { KEY_REUSED } = await import(`${SRC}services/recordSync.js`);

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
// HOD (CSE) <- professor A <- a student; professor B under another HOD (ECE).

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'a0000000-0000-4000-8000-000000000001',
  profA: 'a0000000-0000-4000-8000-000000000002',
  profB: 'a0000000-0000-4000-8000-000000000003',
  hodOther: 'a0000000-0000-4000-8000-000000000004',
  student: 'a0000000-0000-4000-8000-000000000005',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-TEST0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.student, 'student', 'CSE', ID.profA, '21CS01'),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
].map((a) => [a.id, a]));
const TOKENS = { hod: 'tok-hod', profA: 'tok-prof-a', profB: 'tok-prof-b', hodOther: 'tok-hod-other', student: 'tok-student' };
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
    throw new Error(`recordsync.mjs refuses to reach ${url.origin}`);
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
  return reply({ message: `not answered by recordsync.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process; only Supabase
// Auth's calls about accounts now go to the stand-in above.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'recordsync-test-service-key';

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

/** `as`: one of the TOKENS' names, or null for no credentials; `key`: the replay key, if any. */
async function call(method, path, { body, as = 'profA', key } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (key !== undefined) headers['idempotency-key'] = key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, replayed: res.headers.get('idempotent-replayed') === 'true', body: await res.json().catch(() => ({})) };
}
const post = (path, body, opts = {}) => call('POST', path, { body, ...opts });
const patch = (path, body, opts = {}) => call('PATCH', path, { body, ...opts });

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ fixtures --

const made = await post('/api/classes', { courseName: 'Data Structures', section: 'SY-CS A', termLabel: 'Sem III 2026' });
const classId = made.body.class?.id;
const ROSTER = [
  { roll: '21CS01', name: 'Asha Rao' }, { roll: '21CS02', name: 'Bilal Khan' },
  { roll: '21CS03', name: 'Chitra Iyer' }, { roll: '21CS04', name: 'Dev Patil' },
];
await post(`/api/classes/${classId}/students`, { students: ROSTER });
const sid = Object.fromEntries(((await call('GET', `/api/classes/${classId}`)).body.students ?? []).map((s) => [s.rollNo, s.id]));
const content = await repo.createContent({ title: 'Trees and traversals', kind: 'syllabus', rawText: '', topics: ['Trees'], ownerId: ID.profA });
await repo.insertQuestions(Array.from({ length: 8 }, (_, i) => ({
  contentId: content._id, topic: 'Trees', text: `Which traversal is number ${i}?`, kind: 'mcq',
  options: ['Inorder', 'Preorder', 'Postorder', 'Level-order'], answerIdx: 1, bloom: 'understand', source: 'llm', status: 'active',
})));
const opened = await post('/api/session', { contentId: content._id, classId, title: 'Trees, offline console', mode: 'teacher-led' });
const R = `/api/session/${opened.body.code}`;
const roomId = opened.body.sessionId;
check('fixtures: a class of four, a chapter, a Teacher-led room for the class',
  made.status === 201 && Object.keys(sid).length === 4 && opened.status === 200 && Boolean(roomId),
  `class ${made.status}, room ${opened.status} ${opened.body.error ?? ''}`);

/** Every record of the room, and every count, as the store holds them. */
async function stored() {
  const [marks, observations, rounds, picks, tallies, activities, actions] = await Promise.all([
    repo.listAttendance(roomId),
    repo.listObservations({ sessionId: roomId }),
    repo.listWheelRounds(roomId),
    repo.listWheelPicks(roomId),
    repo.listTallies(roomId),
    repo.listActivities(roomId),
    repo.listInsightActions(roomId),
  ]);
  const by = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]));
  return JSON.stringify({
    marks: marks.map((m) => [m.classStudentId, m.status, m.source, m.markedAt]).sort(),
    observations: observations.map((o) => [String(o._id), o.rollNo, o.kind, o.note, o.observedAt]).sort(),
    rounds: rounds.map((r) => [r.round, r.presentOnly, r.noRepeat]),
    picks: [...picks].sort(by('_id')).map((p) => [String(p._id), p.rollNo, p.status, p.ask, p.statusAt]),
    tallies: [...tallies].sort(by('_id')).map((t) => [String(t._id), t.text, t.counts.map(Number), t.revealed, t.updatedAt]),
    activities: [...activities].sort(by('_id')).map((a) => [String(a._id), a.kind, a.outcome, a.tallyId, a.updatedAt]),
    actions: actions.map((a) => [String(a._id), a.flagId, a.action, a.actedAt]).sort(),
  });
}

// ------------------------------------------------- the console's outbox --
//
// Each item as the console queues it while offline. `path` and `body` may
// depend on the replies to the items before it (the pick drawn, the tally
// made, the stamp a write left): the console works them out just before the
// item's first send and then keeps them fixed, key and all, for every retry.

const at = (reply, rollNo) => reply.body.students?.find((s) => s.rollNo === rollNo)?.markedAt ?? null;
const OUTBOX = [
  { name: 'the register', method: 'POST', path: () => `${R}/attendance`,
    body: () => ({ marks: [
      { studentId: sid['21CS01'], status: 'present', basedOn: null }, { studentId: sid['21CS02'], status: 'present', basedOn: null },
      { studentId: sid['21CS03'], status: 'present', basedOn: null }, { studentId: sid['21CS04'], status: 'absent', basedOn: null },
    ] }) },
  // A second tap on one student: made from the first, so chained from its reply.
  { name: 'a mark changed again', method: 'POST', path: () => `${R}/attendance`,
    body: (r) => ({ marks: [{ studentId: sid['21CS03'], status: 'late', basedOn: at(r[0], '21CS03') }] }) },
  { name: 'an observation', method: 'POST', path: () => `${R}/observations`,
    body: () => ({ studentId: sid['21CS01'], kind: 'understood', note: 'Explained preorder', basedOn: null }) },
  { name: 'the observation replaced', method: 'POST', path: () => `${R}/observations`,
    body: (r) => ({ studentId: sid['21CS01'], kind: 'participated', basedOn: r[2].body.current?.observedAt ?? null }) },
  { name: 'a draw', method: 'POST', path: () => `${R}/wheel/draw`, body: () => ({}) },
  { name: 'the pick\'s response', method: 'PATCH', path: (r) => `${R}/wheel/picks/${r[4].body.pick?.id}`,
    body: () => ({ status: 'answered', basedOn: { status: 'pending' } }) },
  { name: 'a question asked aloud', method: 'POST', path: () => `${R}/tallies`, body: () => ({ text: 'Which traversal visits the root first?' }) },
  ...['A', 'A', 'B', 'A'].map((option, i) => ({ name: `hand ${i + 1} for ${option}`, method: 'POST',
    path: (r) => `${R}/tallies/${r[6].body.tally?.id}/increment`, body: () => ({ option }) })),
  { name: 'one hand for A taken back', method: 'POST', path: (r) => `${R}/tallies/${r[6].body.tally?.id}/decrement`, body: () => ({ option: 'A' }) },
  { name: 'the answer revealed', method: 'PATCH', path: (r) => `${R}/tallies/${r[6].body.tally?.id}`,
    body: (r) => ({ revealed: true, correct: 'B', basedOn: { revealed: r[11].body.tally?.revealed, correct: r[11].body.tally?.correct } }) },
  { name: 'an activity', method: 'POST', path: () => `${R}/activities`,
    body: (r) => ({ kind: 'check', tallyId: r[6].body.tally?.id, outcome: 'Most chose preorder' }) },
  { name: 'its outcome edited', method: 'PATCH', path: (r) => `${R}/activities/${r[13].body.activity?.id}`,
    body: (r) => ({ outcome: 'Most chose preorder; three chose inorder', basedOn: { outcome: r[13].body.activity?.outcome } }) },
  { name: 'an insight card acted on', method: 'POST', path: () => `${R}/insights/actions`,
    body: () => ({ flagId: 'focus:analyse', action: 'acted', note: 'Did a think-pair-share', basedOn: null }) },
];

const KEYS = OUTBOX.map((_, i) => `0f6c1d2e-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const sent = []; // { method, path, body, key }: fixed at first send
const first = [];

console.log('\none pass: the outbox sent in order, each write with its key');

for (const [i, item] of OUTBOX.entries()) {
  const fixed = { method: item.method, path: item.path(first), body: item.body(first), key: KEYS[i] };
  sent.push(fixed);
  first.push(await call(fixed.method, fixed.path, { body: fixed.body, key: fixed.key }));
}
check('every queued write is done once, none of the console\'s own chained writes refusing another',
  first.every((r) => r.status >= 200 && r.status < 300 && !r.replayed),
  first.map((r, i) => `${OUTBOX[i].name}: ${r.status} ${r.body.error ?? ''}`).filter((l) => !/: 20\d $/.test(l)).join('; '));
const afterOne = await stored();
{
  const s = JSON.parse(afterOne);
  const status = Object.fromEntries(s.marks.map(([id, st]) => [Object.keys(sid).find((r) => sid[r] === id), st])
    .sort(([a], [b]) => a.localeCompare(b)));
  check('the register: 21CS01 and 21CS02 present, 21CS03 late (the second tap), 21CS04 absent',
    same(status, { '21CS01': 'present', '21CS02': 'present', '21CS03': 'late', '21CS04': 'absent' }), JSON.stringify(status));
  check('two observation events for 21CS01, the second in force', s.observations.length === 2
    && first[3].body.current?.kind === 'participated' && first[3].body.replaced?.kind === 'understood');
  check('one draw, one pick, answered', s.picks.length === 1 && s.picks[0][2] === 'answered' && s.rounds.length === 1);
  check('one tally: three hands for A less one, one for B, revealed with B correct',
    s.tallies.length === 1 && same(s.tallies[0][2], [2, 1, 0, 0]) && s.tallies[0][3] === true && first[12].body.tally?.correct === 'B',
    JSON.stringify(s.tallies));
  check('one activity pointing at the tally, its outcome edited', s.activities.length === 1
    && s.activities[0][3] === first[6].body.tally?.id && s.activities[0][2] === 'Most chose preorder; three chose inorder');
  check('one insight action', s.actions.length === 1 && s.actions[0][2] === 'acted');
}

async function replayAll(label, order) {
  const replies = order === 'together'
    ? await Promise.all(sent.map((w) => call(w.method, w.path, { body: w.body, key: w.key })))
    : [];
  if (order !== 'together') {
    const idx = sent.map((_, i) => i);
    for (const i of order === 'reverse' ? idx.reverse() : idx) {
      const w = sent[i];
      replies[i] = await call(w.method, w.path, { body: w.body, key: w.key });
    }
  }
  const off = replies.map((r, i) => (r.status === first[i].status && r.replayed && same(r.body, first[i].body) ? null
    : `${OUTBOX[i].name}: ${r.status} replayed=${r.replayed} ${r.body.error ?? ''}`)).filter(Boolean);
  check(`${label}: every reply is the kept one, the same status and body, marked replayed`, off.length === 0, off.join('; '));
  check(`${label}: every stored record and count is exactly as after one pass`, (await stored()) === afterOne);
}

console.log('\nreplays: the whole outbox again, in order, in reverse, and all at once');
await replayAll('again in order', 'order');
await replayAll('again in reverse', 'reverse');
await replayAll('all at once', 'together');
{
  const draw = await call('POST', sent[4].path, { body: sent[4].body, key: sent[4].key });
  check('a replayed draw is the same pick, not a second spin', draw.status === 201 && draw.body.pick?.id === first[4].body.pick?.id
    && (await repo.listWheelPicks(roomId)).length === 1);
}

// ------------------------------------------------------------- details --

console.log('\nthe same key with other details');
{
  const w = sent[7]; // a tally step
  const other = await call(w.method, w.path, { body: { option: 'C' }, key: w.key });
  check('a 409 with a sentence, and nothing done', other.status === 409 && other.body.error === KEY_REUSED
    && (await stored()) === afterOne, `${other.status} ${other.body.error ?? ''}`);
  const elsewhere = await call('POST', `${R}/tallies/${first[6].body.tally?.id}/decrement`, { body: { option: 'A' }, key: w.key });
  check('the same key on another route is other details too', elsewhere.status === 409 && (await stored()) === afterOne);
  check('the sentence names no path, field or verb', !/\/api\/|Idempotency|POST|PATCH|basedOn|body/.test(KEY_REUSED));
}

// -------------------------------------------------------------- no key --

console.log('\nno key: as before');
{
  const tallyPath = `${R}/tallies/${first[6].body.tally?.id}`;
  const a = await post(`${tallyPath}/increment`, { option: 'D' });
  const b = await post(`${tallyPath}/increment`, { option: 'D' });
  const t = (await repo.listTallies(roomId))[0];
  check('two steps without a key are two hands, as before', a.status === 200 && b.status === 200 && !a.replayed && !b.replayed
    && t.counts.map(Number)[3] === 2, JSON.stringify(t.counts));
  // Taken back with keys of their own, so the counts read as after one pass again.
  await post(`${tallyPath}/decrement`, { option: 'D' }, { key: 'undo-d-000000001' });
  await post(`${tallyPath}/decrement`, { option: 'D' }, { key: 'undo-d-000000002' });
  await post(`${tallyPath}/decrement`, { option: 'D' }, { key: 'undo-d-000000002' });
  check('and two keyed steps back are two, the second sent twice', same((await repo.listTallies(roomId))[0].counts.map(Number), [2, 1, 0, 0]));
}

// --------------------------------------------- a write that meets newer --

console.log('\na write made from a record that has since moved on');
const snapshot = async () => stored();

{
  // Online, on another screen: 21CS04 arrives late and is marked present.
  await pause();
  const online = await post(`${R}/attendance`, { marks: [{ studentId: sid['21CS04'], status: 'present' }] });
  const before = await snapshot();
  // The offline console's next write on 21CS04 was made from the register's first reply.
  const w = { marks: [{ studentId: sid['21CS04'], status: 'late', basedOn: at(first[0], '21CS04') }, { studentId: sid['21CS02'], status: 'absent', basedOn: at(first[0], '21CS02') }] };
  const late = await post(`${R}/attendance`, w, { key: 'late-mark-0000001' });
  check('attendance: refused (409), naming the newer mark in a sentence', online.status === 200 && late.status === 409 && late.body.stale === true
    && /^21CS04 \(Dev Patil\) was marked present at \d\d:\d\d, newer than what this change was made from\. Nothing was changed\.$/.test(late.body.error ?? ''),
    `${late.status} ${late.body.error ?? ''}`);
  check('with the newer mark and the register as it stands; nothing changed, all or nothing (21CS02 untouched)',
    late.body.newer?.[0]?.status === 'present' && late.body.current?.students?.find((s) => s.rollNo === '21CS04')?.status === 'present'
    && late.body.current?.students?.find((s) => s.rollNo === '21CS02')?.status === 'present' && (await snapshot()) === before);
  const again = await post(`${R}/attendance`, w, { key: 'late-mark-0000001' });
  check('a refusal is not kept: sent again, it is checked again and refused again', again.status === 409 && !again.replayed
    && (await snapshot()) === before);
}
{
  // Online: 21CS02 marked "needs support". Offline, made when 21CS02 had none: "understood".
  await post(`${R}/observations`, { studentId: sid['21CS02'], kind: 'support' });
  const before = await snapshot();
  const late = await post(`${R}/observations`, { studentId: sid['21CS02'], kind: 'understood', basedOn: null }, { key: 'late-obs-00000001' });
  check('an observation: refused, naming the mark in force, with it and the day\'s log', late.status === 409
    && /^Bilal Khan's mark for this class was set to .+ at \d\d:\d\d, newer than what this change was made from\. Nothing was changed\.$/.test(late.body.error ?? '')
    && late.body.current?.kind === 'support' && late.body.history?.length === 1 && (await snapshot()) === before,
    `${late.status} ${late.body.error ?? ''}`);
  const sameMark = await post(`${R}/observations`, { studentId: sid['21CS02'], kind: 'support', basedOn: null }, { key: 'late-obs-00000002' });
  check('the same mark again is "nothing changed", never refused', sameMark.status === 200 && sameMark.body.changed === false);
}
{
  const pickPath = sent[5].path;
  await patch(pickPath, { status: 'help' });
  const before = await snapshot();
  const late = await patch(pickPath, { status: 'passed', basedOn: { status: 'answered' } }, { key: 'late-pick-0000001' });
  check('a pick\'s response: refused, with the pick as it stands', late.status === 409 && /now: Needs help/.test(late.body.error ?? '')
    && late.body.current?.status === 'help' && (await snapshot()) === before, `${late.status} ${late.body.error ?? ''}`);
}
{
  const tallyPath = `${R}/tallies/${first[6].body.tally?.id}`;
  await patch(tallyPath, { counts: [5, 1, 0, 0] });
  const before = await snapshot();
  const late = await patch(tallyPath, { counts: [0, 0, 0, 0], basedOn: { counts: [2, 1, 0, 0] } }, { key: 'late-tally-000001' });
  check('a tally\'s counts set: refused, with the tally as it stands', late.status === 409
    && same(late.body.current?.options?.map((o) => o.count), [5, 1, 0, 0]) && (await snapshot()) === before, `${late.status} ${late.body.error ?? ''}`);
  const step = await post(`${tallyPath}/increment`, { option: 'C' }, { key: 'late-step-0000001' });
  check('a tally step is never stale: it adds to the counts as they stand', step.status === 200
    && same((await repo.listTallies(roomId))[0].counts.map(Number), [5, 1, 1, 0]));
}
{
  const actPath = sent[14].path;
  await patch(actPath, { outcome: 'Redone after the break' });
  const before = await snapshot();
  const late = await patch(actPath, { outcome: 'Something older', basedOn: { outcome: 'Most chose preorder' } }, { key: 'late-act-00000001' });
  check('an activity edit: refused, with the activity as it stands', late.status === 409
    && late.body.current?.outcome === 'Redone after the break' && (await snapshot()) === before, `${late.status} ${late.body.error ?? ''}`);
}
{
  await post(`${R}/insights/actions`, { flagId: 'focus:analyse', action: 'dismissed' });
  const before = await snapshot();
  const late = await post(`${R}/insights/actions`, { flagId: 'focus:analyse', action: 'acted', basedOn: first[15].body.action?.actedAt },
    { key: 'late-flag-0000001' });
  check('an insight action: refused when the card was dismissed since', late.status === 409
    && /^This card was dismissed at \d\d:\d\d/.test(late.body.error ?? '') && late.body.current?.action === 'dismissed'
    && (await snapshot()) === before, `${late.status} ${late.body.error ?? ''}`);
}

// ----------------------------------------------------------------- who --

console.log('\nwho may send a keyed write');
{
  const w = sent[7];
  const before = await snapshot();
  const nowhere = await post('/api/session/ZZZZZZ/tallies', { text: 'x' }, { key: 'who-0000000000001' });
  const other = await call(w.method, w.path, { body: w.body, key: w.key, as: 'profB' });
  const otherNoKey = await call(w.method, w.path, { body: w.body, as: 'profB' });
  check('another professor: the same 404, word for word, as a room that does not exist, key or no key',
    other.status === 404 && same(other.body, nowhere.body) && same(otherNoKey.body, nowhere.body), JSON.stringify(other.body));
  const hod = await call(w.method, w.path, { body: w.body, key: w.key, as: 'hod' });
  check('the department\'s HOD reads but may not write: 403, and no kept reply leaks to them', hod.status === 403 && !hod.replayed
    && !hod.body.tally);
  const student = await call(w.method, w.path, { body: w.body, key: w.key, as: 'student' });
  const nobody = await call(w.method, w.path, { body: w.body, key: w.key, as: null });
  check('a student is refused and no credentials are refused, as without a key', [401, 403].includes(student.status)
    && nobody.status === 401 && !student.body.tally && !nobody.body.tally);
  check('none of them changed anything', (await stored()) === before);
}

// ------------------------------------------------------------ the room --

console.log('\ndeleting the room');
{
  const held = await repo.getRecordWrite({ sessionId: roomId, writer: ID.profA, key: KEYS[0] });
  check('the keys are kept per room and writer', held?.route === 'attendance' && held?.status === 200);
  const gone = await call('DELETE', `${R}?confirm=${opened.body.code}`);
  const archived = gone.status === 200 ? decodeRoomArchive((await repo.getRoomArchive(gone.body.archive?.id)).data) : null;
  check('the room is deleted into its archive, which carries its records', gone.status === 200
    && archived?.tallies?.length === 1 && archived?.activities?.length === 1, `HTTP ${gone.status} ${gone.body.error ?? ''}`);
  check('and not the keys, which went with the room', !JSON.stringify(archived ?? {}).includes(KEYS[0])
    && (await repo.getRecordWrite({ sessionId: roomId, writer: ID.profA, key: KEYS[0] })) === null);
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.fetch = realFetch;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
