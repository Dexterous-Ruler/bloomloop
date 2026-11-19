// One question of a bank, read on its own (the client session's ask of 19 Nov
// 2026), so the console can link to it from an error log entry or a lesson.
//
// Pinned here: GET /api/bank/question/:id answers the question as the bank
// lists it (any status), with its chapter and whether the caller may change
// it, by the bank's own rule: the owner reads and may edit, the department's
// HOD reads only, and another professor, the shared key on an owned chapter,
// a malformed id and an id that does not exist all get the same 404, word for
// word. The bank's router runs on a real HTTP server over 127.0.0.1, on the
// in-process store; Supabase's accounts_below (the HOD's department) is
// answered here, in-process, and nothing leaves the machine. Never calls
// Gemini, Supabase or any network service.

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';

import express from 'express';

import { config } from '../src/config.js';

const PROF_A = 'a0000000-0000-4000-8000-00000000000a';
const PROF_B = 'b0000000-0000-4000-8000-00000000000b';
const HOD = 'c0000000-0000-4000-8000-00000000000c';
const VIEWERS = {
  owner: { id: PROF_A, role: 'professor' },
  other: { id: PROF_B, role: 'professor' },
  hod: { id: HOD, role: 'hod' },
  key: { id: null, role: 'professor', legacyKey: true },
};
const NOT_FOUND = { error: 'That question was not found.' };

let server;
let base;
let repo;
let realFetch;
const saved = { ...config.supabase };
const q = {};

before(async () => {
  // The in-process store and no model, whatever .env says.
  Object.assign(config.supabase, { url: '', serviceKey: '', anonKey: '' });
  config.mongoUri = '';
  config.gemini.apiKey = '';
  const { initStore, getRepo } = await import('../src/repo/index.js');
  await initStore({ log: () => {} });
  repo = getRepo();

  // The HOD's department, answered here; any other request off this machine is refused.
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === '127.0.0.1') return realFetch(input, init);
    if (url.pathname === '/rest/v1/rpc/accounts_below') {
      const root = JSON.parse(init?.body ?? '{}').root;
      const below = root === HOD ? [{ id: PROF_A, role: 'professor', reports_to: HOD, active: true }] : [];
      return new Response(JSON.stringify(below), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`refused: ${url.href}`);
  };
  // Set after the store is chosen, so the store stays in-process.
  Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'bank-test-key' });

  const content = await repo.createContent({ title: 'Layers', kind: 'syllabus', rawText: '', topics: ['Framing'], ownerId: PROF_A });
  const [active, draft] = await repo.insertQuestions([
    { contentId: content._id, topic: 'Framing', text: 'What splits bits?', kind: 'mcq', options: ['framing', 'routing', 'naming', 'paging'],
      answerIdx: 0, bloom: 'remember', source: 'teacher', status: 'active' },
    { contentId: content._id, topic: 'Framing', text: 'A draft on framing', kind: 'mcq', options: ['a', 'b', 'c', 'd'],
      answerIdx: 1, bloom: 'remember', source: 'llm', model: 'stand-in', status: 'draft' },
  ]);
  Object.assign(q, { content, active, draft });

  // The bank's own router behind a stand-in for requireTeacher: the viewer is named by a header.
  const { default: bankRoutes } = await import('../src/routes/bank.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.viewer = VIEWERS[req.get('x-as')]; next(); });
  app.use('/api/bank', bankRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  Object.assign(config.supabase, saved);
  await new Promise((r) => server.close(r));
});

const read = async (id, as) => {
  const res = await fetch(`${base}/api/bank/question/${id}`, { headers: { 'x-as': as } });
  return { status: res.status, body: await res.json() };
};

describe('GET /api/bank/question/:id', () => {
  test('the owner reads one question as the bank lists it, with its chapter, and may edit it', async () => {
    const { status, body } = await read(q.active._id, 'owner');
    assert.equal(status, 200);
    assert.equal(body.question._id, String(q.active._id));
    assert.equal(body.question.answerIdx, 0, 'staff read the key, as in the bank');
    // The same staff shape as the bank's list (honesty.js staffQuestion).
    assert.equal(body.question.provenance.source, 'professor');
    assert.equal(body.question.levelCheck.uncertain, false);
    assert.deepEqual(body.content, { _id: String(q.content._id), title: 'Layers' });
    assert.equal(body.canEdit, true);
  });

  test('any status: a draft is read too', async () => {
    const { status, body } = await read(q.draft._id, 'owner');
    assert.equal(status, 200);
    assert.equal(body.question.status, 'draft');
  });

  test('the department\'s HOD reads it and may not edit it', async () => {
    const { status, body } = await read(q.active._id, 'hod');
    assert.equal(status, 200);
    assert.equal(body.question.text, 'What splits bits?');
    assert.equal(body.canEdit, false);
  });

  test('another professor, the shared key on an owned chapter, a malformed id and a missing one: the same 404, word for word', async () => {
    const replies = [
      await read(q.active._id, 'other'),
      await read(q.active._id, 'key'),
      await read('not-an-id', 'owner'),
      await read('0123456789abcdef01234567', 'owner'),
      await read('stats', 'owner'),
    ];
    for (const r of replies) {
      assert.equal(r.status, 404);
      assert.deepEqual(r.body, NOT_FOUND);
    }
  });
});
