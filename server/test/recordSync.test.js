// Phase 7: teacher records the console can send again after the network drops.
// The replay key (same key and details: the kept reply, nothing done again;
// same key, other details: 409; no key: as before), the key store in the
// in-process repo and the requests the Supabase repo sends for it, a tally step
// counted once, and the rule for a write made from a record that has since
// moved on. The HTTP checks run a real app on the in-process store, over
// 127.0.0.1 only.

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import {
  KEY_REUSED,
  basedOnFields,
  basedOnTime,
  bodyHash,
  canonical,
  insightStale,
  movedFields,
  newerMarks,
  newerMarksSentence,
  observationStale,
  writeKeyFrom,
  writerOf,
} from '../src/services/recordSync.js';

const KEY = '7f9c2a10-4b1e-4c3a-9d2e-0a1b2c3d4e5f';
const status = (code, match) => (err) => err.status === code && (!match || match.test(err.message));

describe('the replay key and what it is kept with', () => {
  test('a UUID, or any 8 to 64 letters, digits, hyphens or underscores; anything else is an honest 400', () => {
    assert.equal(writeKeyFrom(` ${KEY} `), KEY);
    assert.equal(writeKeyFrom('abc_DEF-12'), 'abc_DEF-12');
    for (const bad of ['', 'short', 'x'.repeat(65), 'has space in it', 'semi;colon1', undefined, 42]) {
      assert.throws(() => writeKeyFrom(bad), status(400, /replay key/), String(bad));
    }
  });

  test('a key belongs to the account that wrote it; the shared teacher key is one writer', () => {
    assert.equal(writerOf({ id: 'a0000000-0000-4000-8000-000000000002' }), 'a0000000-0000-4000-8000-000000000002');
    assert.equal(writerOf({ id: null, legacyKey: true }), 'shared-key');
  });

  test('the same details hash the same whatever their key order; another route, record or detail does not', () => {
    assert.equal(canonical({ b: 1, a: [{ d: 2, c: null }] }), canonical({ a: [{ c: null, d: 2 }], b: 1 }));
    assert.equal(canonical({ a: 1, skipped: undefined }), canonical({ a: 1 }));
    const h = bodyHash('tally-increment', 't1', { option: 'A' });
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(bodyHash('tally-increment', 't1', { option: 'A' }), h);
    assert.notEqual(bodyHash('tally-decrement', 't1', { option: 'A' }), h);
    assert.notEqual(bodyHash('tally-increment', 't2', { option: 'A' }), h);
    assert.notEqual(bodyHash('tally-increment', 't1', { option: 'B' }), h);
    assert.equal(bodyHash('activity', '', undefined), bodyHash('activity', '', {}));
  });
});

describe('the key store', () => {
  const write = (over = {}) => ({
    sessionId: 'room1', writer: 'prof-a', key: KEY, route: 'tally-increment', target: 't1',
    bodyHash: 'a'.repeat(64), status: 200, reply: { tally: { counts: [1, 0, 0, 0] } }, ...over,
  });

  test('kept once per room, writer and key; a second keep is refused as a duplicate and changes nothing', async () => {
    const repo = createMemoryRepo();
    assert.equal(await repo.getRecordWrite({ sessionId: 'room1', writer: 'prof-a', key: KEY }), null);
    const first = await repo.addRecordWrite(write());
    assert.equal(first.duplicate, false);
    assert.deepEqual(first.write.reply, { tally: { counts: [1, 0, 0, 0] } });
    const again = await repo.addRecordWrite(write({ bodyHash: 'b'.repeat(64), reply: { other: true } }));
    assert.equal(again.duplicate, true);
    assert.equal(again.write.bodyHash, 'a'.repeat(64));
    const read = await repo.getRecordWrite({ sessionId: 'room1', writer: 'prof-a', key: KEY });
    assert.deepEqual([read.route, read.target, read.status, read.reply], ['tally-increment', 't1', 200, { tally: { counts: [1, 0, 0, 0] } }]);
  });

  test('the same key in another room or from another writer is another key', async () => {
    const repo = createMemoryRepo();
    await repo.addRecordWrite(write());
    assert.equal((await repo.addRecordWrite(write({ sessionId: 'room2' }))).duplicate, false);
    assert.equal((await repo.addRecordWrite(write({ writer: 'prof-b' }))).duplicate, false);
  });

  test('a kept reply is a copy: changing what came back changes nothing kept', async () => {
    const repo = createMemoryRepo();
    const { write: w } = await repo.addRecordWrite(write());
    w.reply.tally.counts[0] = 99;
    const read = await repo.getRecordWrite({ sessionId: 'room1', writer: 'prof-a', key: KEY });
    assert.equal(read.reply.tally.counts[0], 1);
  });

  test('the keys go with the room', async () => {
    const repo = createMemoryRepo();
    const room = await repo.createSession({ code: 'RW0001', contentId: 'c', status: 'open' });
    await repo.addRecordWrite(write({ sessionId: room._id }));
    await repo.deleteSession(room._id);
    assert.equal(await repo.getRecordWrite({ sessionId: room._id, writer: 'prof-a', key: KEY }), null);
  });

  test('the Supabase repo: the columns 0032 names, and a key already held read back as a duplicate', async () => {
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const ROOM = '22222222-2222-4222-8222-222222222222';
    const row = { id: 'w1', session_id: ROOM, writer: 'prof-a', write_key: KEY, route: 'tally-increment', target: 't1',
      body_hash: 'a'.repeat(64), status: 200, reply: { tally: { counts: [1, 0, 0, 0] } }, created_at: '2026-11-19T05:10:00+00:00' };
    const replies = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      if (u.origin !== 'http://supabase.invalid') throw new Error(`refused: ${u.origin}`);
      seen.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
      const r = replies.shift() ?? { status: 200, body: row };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      replies.push({ status: 201, body: row });
      const made = await repo.addRecordWrite(write({ sessionId: ROOM }));
      assert.equal(seen[0].url.pathname, '/rest/v1/record_writes');
      assert.equal(seen[0].method, 'POST');
      assert.deepEqual(Object.keys(seen[0].body).sort(),
        ['body_hash', 'reply', 'route', 'session_id', 'status', 'target', 'write_key', 'writer']);
      assert.deepEqual([made.duplicate, made.write.key, made.write.bodyHash, made.write.reply], [false, KEY, 'a'.repeat(64), row.reply]);

      replies.push({ status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "record_writes_session_writer_key_key"' } });
      replies.push({ status: 200, body: row });
      const again = await repo.addRecordWrite(write({ sessionId: ROOM, bodyHash: 'b'.repeat(64) }));
      assert.deepEqual([again.duplicate, again.write.bodyHash], [true, 'a'.repeat(64)]);
      assert.equal(seen[2].method, 'GET');
      assert.deepEqual(['session_id', 'writer', 'write_key'].map((c) => seen[2].url.searchParams.get(c)), [`eq.${ROOM}`, 'eq.prof-a', `eq.${KEY}`]);

      const before = seen.length;
      assert.equal(await repo.getRecordWrite({ sessionId: 'not-a-uuid', writer: 'prof-a', key: KEY }), null);
      assert.equal(seen.length, before, 'no request for an id that cannot be a room');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });
});

describe('a write made from a record that has since moved on', () => {
  const T1 = '2026-11-19T05:10:00.000Z';
  const T2 = '2026-11-19T05:12:00.000Z';

  test('basedOn: a time as the server gave it, null for none, absent for "not checked"; never compared for order', () => {
    assert.equal(basedOnTime(undefined), undefined);
    assert.equal(basedOnTime(null), null);
    assert.equal(basedOnTime(T1), Date.parse(T1));
    // The same moment written another way (as Postgres gives it back) is the same.
    assert.equal(basedOnTime('2026-11-19T05:10:00+00:00'), Date.parse(T1));
    assert.throws(() => basedOnTime('yesterday'), status(400));
    assert.throws(() => basedOnTime(1763529000000), status(400));
    assert.deepEqual(basedOnFields({ status: 'pending', rollNo: 'x' }, ['ask', 'status']), { status: 'pending' });
    assert.equal(basedOnFields(undefined, ['status']), undefined);
    assert.throws(() => basedOnFields(['pending'], ['status']), status(400));
  });

  test('attendance: refused only over a professor\'s mark with another status made since', () => {
    const teacher = { classStudentId: 's1', status: 'late', source: 'teacher', markedAt: T2, rollNo: '21CS01' };
    const wanted = [{ classStudentId: 's1', status: 'absent' }];
    const sent = (basedOn) => [{ studentId: 's1', status: 'absent', basedOn }];
    assert.deepEqual(newerMarks(sent(T1), wanted, [teacher]), [teacher], 'changed online since: refused');
    assert.deepEqual(newerMarks(sent(null), wanted, [teacher]), [teacher], 'unmarked when it was made, marked since: refused');
    assert.deepEqual(newerMarks(sent(T2), wanted, [teacher]), [], 'made from the mark in force: done');
    assert.deepEqual(newerMarks(sent(T1), [{ classStudentId: 's1', status: 'late' }], [teacher]), [], 'already holds what is sent');
    assert.deepEqual(newerMarks(sent(T1), wanted, [{ ...teacher, source: 'joined' }]), [], 'a phone\'s join never stands in the way');
    assert.deepEqual(newerMarks([{ studentId: 's1', status: 'absent' }], wanted, [teacher]), [], 'no basedOn: as before');
    assert.deepEqual(newerMarks(sent(T1), wanted, []), [], 'nothing there now');
    assert.throws(() => newerMarks(sent('soon'), wanted, [teacher]), status(400, /marks\[0\]\.basedOn/));
    const sentence = newerMarksSentence([teacher], [{ _id: 's1', rollNo: '21CS01', name: 'Asha Rao' }]);
    assert.match(sentence, /^21CS01 \(Asha Rao\) was marked late at 10:42, newer than what this change was made from\. Nothing was changed\.$/);
    assert.doesNotMatch(sentence, /basedOn|markedAt|POST|\/api\//);
  });

  test('an observation: refused when the mark in force is not the one it was made from', () => {
    const mark = { kind: 'understood', observedAt: T2 };
    assert.equal(observationStale(mark, undefined), false, 'no basedOn: as before');
    assert.equal(observationStale(mark, Date.parse(T2)), false);
    assert.equal(observationStale(mark, Date.parse(T1)), true);
    assert.equal(observationStale(mark, null), true, 'made when there was none; one was set since');
    assert.equal(observationStale(null, Date.parse(T1)), true, 'made from a mark since cleared');
    assert.equal(observationStale(null, null), false);
  });

  test('an insight action: refused when another action on the card was recorded since, unless it is the same action', () => {
    const last = { flagId: 'f', action: 'acted', actedAt: T2 };
    assert.equal(insightStale(last, undefined, 'dismissed'), false);
    assert.equal(insightStale(last, Date.parse(T1), 'dismissed'), true);
    assert.equal(insightStale(last, null, 'dismissed'), true);
    assert.equal(insightStale(last, Date.parse(T1), 'acted'), false, 'the same action: nothing newer is lost');
    assert.equal(insightStale(last, Date.parse(T2), 'dismissed'), false);
    assert.equal(insightStale(undefined, null, 'dismissed'), false);
  });

  test('a pick, a tally or an activity: a field it sets that changed since, unless it already holds what is sent', () => {
    const now = { status: 'answered', ask: 'bank', counts: [3, 1, 0, 0] };
    assert.deepEqual(movedFields({ status: 'pending' }, now, { status: 'help' }), ['status']);
    assert.deepEqual(movedFields({ status: 'pending' }, now, { status: 'answered' }), []);
    assert.deepEqual(movedFields({ status: 'answered' }, now, { status: 'help' }), []);
    assert.deepEqual(movedFields({ ask: 'demo' }, now, { status: 'help' }), [], 'a field it does not set');
    assert.deepEqual(movedFields({ counts: [2, 1, 0, 0] }, now, { counts: [0, 0, 0, 0] }), ['counts']);
    assert.deepEqual(movedFields(undefined, now, { status: 'help' }), []);
  });
});

// ----------------------------------------------------------- over HTTP --

describe('over HTTP, on the in-process store', () => {
  let server;
  let base;
  let repo;
  let room;
  let students;
  const saved = { supabase: { ...config.supabase }, mongoUri: config.mongoUri, apiKey: config.gemini.apiKey };

  before(async () => {
    // The in-process store and no model, whatever .env says.
    Object.assign(config.supabase, { url: '', serviceKey: '', anonKey: '' });
    config.mongoUri = '';
    config.gemini.apiKey = '';
    const { initStore, getRepo } = await import('../src/repo/index.js');
    const { createApp } = await import('../src/app.js');
    await initStore({ log: () => {} });
    repo = getRepo();
    server = http.createServer(createApp());
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;

    const content = await repo.createContent({ title: 'Trees', kind: 'syllabus', rawText: '', topics: ['Trees'], ownerId: null });
    // A room needs six approved questions to open.
    await repo.insertQuestions(Array.from({ length: 6 }, (_, i) => ({ contentId: content._id, topic: 'Trees',
      text: `Which traversal is number ${i}?`, kind: 'mcq', options: ['Inorder', 'Preorder', 'Postorder', 'Level-order'],
      answerIdx: 1, bloom: 'remember', source: 'llm', status: 'active' })));
    const cls = await repo.createClass({ ownerId: null, courseName: 'Data Structures', section: 'SY-CS A' });
    students = await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha Rao' }, { rollNo: '21CS02', name: 'Bilal Khan' }]);
    const opened = await call('POST', '/api/session', { body: { contentId: String(content._id), classId: String(cls._id) } });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    room = `/api/session/${opened.body.code}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    Object.assign(config.supabase, saved.supabase);
    config.mongoUri = saved.mongoUri;
    config.gemini.apiKey = saved.apiKey;
  });

  async function call(method, path, { body, key } = {}) {
    const headers = { 'x-teacher-key': config.teacherKey, 'content-type': 'application/json' };
    if (key !== undefined) headers['idempotency-key'] = key;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, replayed: res.headers.get('idempotent-replayed'), body: await res.json().catch(() => ({})) };
  }

  const countsOf = async (id) => (await repo.listTallies((await repo.getSessionByCode(room.split('/').at(-1)))._id))
    .find((t) => String(t._id) === id).counts.map(Number);

  test('a tally step with a key counts once however often it is sent; the replay is the kept reply', async () => {
    const made = await call('POST', `${room}/tallies`, { body: { text: 'Which is a leaf?' }, key: 'tally-make-0001' });
    assert.equal(made.status, 201);
    const again = await call('POST', `${room}/tallies`, { body: { text: 'Which is a leaf?' }, key: 'tally-make-0001' });
    assert.deepEqual([again.status, again.replayed, again.body], [201, 'true', made.body], 'one tally, not two');
    const id = made.body.tally.id;
    const step = `${room}/tallies/${id}/increment`;
    const first = await call('POST', step, { body: { option: 'A' }, key: KEY });
    assert.equal(first.status, 200);
    assert.equal(first.replayed, null);
    for (let i = 0; i < 3; i += 1) {
      const r = await call('POST', step, { body: { option: 'A' }, key: KEY });
      assert.deepEqual([r.status, r.replayed, r.body], [200, 'true', first.body]);
    }
    assert.deepEqual(await countsOf(id), [1, 0, 0, 0]);
    // Sent at once, as a retry racing a slow first try: still one.
    const k2 = 'race-step-000002';
    const raced = await Promise.all([1, 2, 3].map(() => call('POST', step, { body: { option: 'B' }, key: k2 })));
    assert.ok(raced.every((r) => r.status === 200 && JSON.stringify(r.body) === JSON.stringify(raced[0].body)));
    assert.equal(raced.filter((r) => r.replayed === 'true').length, 2);
    assert.deepEqual(await countsOf(id), [1, 1, 0, 0]);
  });

  test('the same key with other details is a 409 with a sentence, and nothing is done', async () => {
    const id = (await call('POST', `${room}/tallies`, { body: { text: 'Which is a root?' } })).body.tally.id;
    const k = 'other-details-01';
    await call('POST', `${room}/tallies/${id}/increment`, { body: { option: 'C' }, key: k });
    const other = await call('POST', `${room}/tallies/${id}/increment`, { body: { option: 'D' }, key: k });
    assert.deepEqual([other.status, other.body.error], [409, KEY_REUSED]);
    const route = await call('POST', `${room}/tallies/${id}/decrement`, { body: { option: 'C' }, key: k });
    assert.equal(route.status, 409, 'the same key on another route is other details too');
    assert.deepEqual(await countsOf(id), [0, 0, 1, 0]);
  });

  test('no key: exactly as before, so two steps are two', async () => {
    const id = (await call('POST', `${room}/tallies`, { body: { text: 'Which is a node?' } })).body.tally.id;
    const a = await call('POST', `${room}/tallies/${id}/increment`, { body: { option: 'A' } });
    const b = await call('POST', `${room}/tallies/${id}/increment`, { body: { option: 'A' } });
    assert.deepEqual([a.status, b.status, a.replayed, b.replayed], [200, 200, null, null]);
    assert.deepEqual(await countsOf(id), [2, 0, 0, 0]);
    const bad = await call('POST', `${room}/tallies/${id}/increment`, { body: { option: 'A' }, key: 'no' });
    assert.equal(bad.status, 400, 'a key that is not one is an honest 400');
    assert.deepEqual(await countsOf(id), [2, 0, 0, 0]);
  });

  test('a refusal is not kept: the same write sent again is checked again', async () => {
    const id = (await call('POST', `${room}/tallies`, { body: { text: 'Which is an edge?' } })).body.tally.id;
    const k = 'refused-once-001';
    const max = await call('POST', `${room}/tallies/${id}/increment`, { body: { option: 'Z' }, key: k });
    assert.equal(max.status, 400);
    const fixed = await call('POST', `${room}/tallies/${id}/increment`, { body: { option: 'Z' }, key: k });
    assert.deepEqual([fixed.status, fixed.replayed], [400, null]);
    const missing = await call('POST', '/api/session/ZZZZZZ/tallies', { body: { text: 'x' }, key: k });
    assert.deepEqual([missing.status, missing.body.error], [404, 'That room was not found.']);
  });

  test('attendance: a replayed older mark meets a newer one and is refused with the register as it stands', async () => {
    const [asha, bilal] = students.map((s) => String(s._id));
    const first = await call('POST', `${room}/attendance`, { body: { marks: [{ studentId: asha, status: 'present', basedOn: null }] }, key: 'att-0000000001' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const stamp = first.body.students.find((s) => s.studentId === asha).markedAt;
    // Online, on another screen, the professor changes it.
    await new Promise((r) => setTimeout(r, 5));
    const online = await call('POST', `${room}/attendance`, { body: { marks: [{ studentId: asha, status: 'late' }] } });
    assert.equal(online.status, 200);
    // The offline console's next write on Asha was made from the first mark.
    const late = await call('POST', `${room}/attendance`, {
      body: { marks: [{ studentId: asha, status: 'absent', basedOn: stamp }, { studentId: bilal, status: 'present', basedOn: null }] },
      key: 'att-0000000002',
    });
    assert.equal(late.status, 409);
    assert.equal(late.body.stale, true);
    assert.match(late.body.error, /^21CS01 \(Asha Rao\) was marked late at \d\d:\d\d, newer than what this change was made from\. Nothing was changed\.$/);
    assert.deepEqual(late.body.newer.map((m) => [m.studentId, m.status]), [[asha, 'late']]);
    assert.deepEqual(late.body.current.students.map((s) => s.status), ['late', 'unmarked'], 'all or nothing: Bilal is not marked either');
    // The first write replayed: its kept reply, unchanged, though Asha is late now.
    const replay = await call('POST', `${room}/attendance`, { body: { marks: [{ studentId: asha, status: 'present', basedOn: null }] }, key: 'att-0000000001' });
    assert.deepEqual([replay.status, replay.replayed, replay.body], [200, 'true', first.body]);
    const marks = await repo.listAttendance((await repo.getSessionByCode(room.split('/').at(-1)))._id);
    assert.deepEqual(marks.map((m) => m.status), ['late']);
  });
});
