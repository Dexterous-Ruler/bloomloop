// Phase 2 - several kinds per level, and the four kinds nothing used to create,
// end to end.
//
//   node server/scripts/kinds.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with the shared teacher key and offline
// generation, and checks:
//
//   the plan      the preview divides every level over its kinds without
//                 changing a single count; a selected-response kind asked of
//                 Create is refused out loud
//   generation    the bank written has the plan's numbers and holds hot text,
//                 dropdown, table and grid drafts, each valid
//   the room      those four, approved, are served to a phone with no key in
//                 the payload; the answer a phone would send scores 1, a wrong
//                 one scores 0, and both are stored as evidence
//   editing       PATCH on each of the four: a valid edit lands whole, an
//                 invalid one is refused with the validator's words and
//                 nothing changes
//
// Never calls Gemini or any network service: the key is blanked below whatever
// server/.env says. Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { SAMPLE } = await import(`${SRC}sampleContent.js`);
const { LEVELS } = await import(`${SRC}bloom.js`);
const { invalidReason } = await import(`${SRC}questionTypes.js`);
const { isSelectedResponse } = await import(`${SRC}services/checks.js`);

// The in-process store and the offline templates, whatever .env says: this
// suite must not touch a database or a model, nor depend on reaching one.
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

const NEW = ['hottext', 'dropdown', 'table', 'grid'];

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...H, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = (p) => call('GET', p);
const post = (p, body = {}) => call('POST', p, body);
const patch = (p, body) => call('PATCH', p, body);

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

const KEYS = ['answerIdx', 'answerIdxs', 'accept', 'answers', 'blanks', 'answerBool', 'rubric', 'sequence', 'pairs', 'buckets'];
function leaks(value, found = []) {
  if (Array.isArray(value)) value.forEach((v) => leaks(v, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (KEYS.includes(k)) found.push(k);
      leaks(v, found);
    }
  }
  return found;
}

/** What a phone sends for the right answer: worked out from what it was shown. */
function rightFor(q, shown) {
  switch (q.kind) {
    case 'hottext': return q.answerIdxs;
    case 'dropdown': return q.blanks.map((b, i) => shown.gaps[i].options.indexOf(b.options[b.answerIdx]));
    case 'table': {
      const out = {};
      q.rows.forEach((r, ri) => r.cells.forEach((c, ci) => { if (c.accept) out[`${ri}:${ci}`] = c.accept[0]; }));
      return out;
    }
    case 'grid': {
      const out = {};
      q.answers.forEach((row, ri) => row.forEach((v, ci) => { if (v) out[`${ri}:${ci}`] = true; }));
      return out;
    }
    default: return null;
  }
}

/** Every pick or cell wrong. */
function wrongFor(q, shown) {
  switch (q.kind) {
    case 'hottext': return q.tokens.map((_, i) => i).filter((i) => !q.answerIdxs.includes(i)).slice(0, 2);
    case 'dropdown': return rightFor(q, shown).map((pos, i) => (pos + 1) % shown.gaps[i].options.length);
    case 'table': return Object.fromEntries(Object.keys(rightFor(q, shown)).map((k) => [k, 'not this']));
    case 'grid': {
      const out = {};
      q.answers.forEach((row, ri) => row.forEach((v, ci) => { if (!v) out[`${ri}:${ci}`] = true; }));
      return out;
    }
    default: return null;
  }
}

// ----------------------------------------------------------- the plan --

const pasted = await post('/api/content', { title: SAMPLE.title, text: SAMPLE.rawText });
const contentId = pasted.body.contentId;
// Three of the chapter's six topics, as bank.mjs uses: enough for every kind,
// small enough that the default plan stays under the size that needs a confirm.
const topics = SAMPLE.topics.slice(0, 3);

console.log('\nthe plan: every level divided over its kinds, no count changed');
{
  const presets = await get('/api/generate/presets');
  check('the presets still list each level\'s kinds', presets.status === 200 && Array.isArray(presets.body.kindsForLevel?.analyse)
    && presets.body.kindsForLevel.analyse.includes('hottext'));

  const preview = await post('/api/generate/preview', { contentId, topics, plan: {} });
  const plan = preview.body.plan;
  check('the default preview has its usual size: twelve a topic', preview.status === 200 && plan.total === topics.length * 12,
    `${plan?.total} for ${topics.length} topics`);
  check('every topic\'s kinds add up to its level counts', plan.topics.every((t) =>
    LEVELS.every((l) => Object.values(t.kinds[l] ?? {}).reduce((a, b) => a + b, 0) === t.mix[l])));
  check('every level with more than one kind is spread over at least two; Create is a written answer',
    LEVELS.every((l) => (l === 'create'
      ? JSON.stringify(Object.keys(plan.perLevelKind.create)) === '["open"]'
      : Object.keys(plan.perLevelKind[l]).length >= 2)),
    JSON.stringify(plan.perLevelKind));
  check('perKind adds up to the total', Object.values(plan.perKind).reduce((a, b) => a + b, 0) === plan.total);

  const asked = await post('/api/generate/preview', { contentId, topics, plan: { kindMix: { create: { mcq: 3, open: 1 } } } });
  check('a selected-response kind asked of Create is refused out loud, and the count is the same',
    asked.body.plan.total === plan.total && JSON.stringify(Object.keys(asked.body.plan.perLevelKind.create)) === '["open"]'
      && asked.body.plan.warnings.some((w) => /Create cannot be asked as "Choose one"/.test(w)),
    asked.body.plan.warnings.join(' | '));

  const mixed = await post('/api/generate/preview', { contentId, topics, plan: { kindMix: { apply: { table: 1, dropdown: 1 } } } });
  check('a kind mix sent by the console is applied in proportion',
    JSON.stringify(mixed.body.plan.perLevelKind.apply) === JSON.stringify({ dropdown: plan.perLevel.apply / 2, table: plan.perLevel.apply / 2 })
      || JSON.stringify(mixed.body.plan.perLevelKind.apply) === JSON.stringify({ table: plan.perLevel.apply / 2, dropdown: plan.perLevel.apply / 2 }),
    JSON.stringify(mixed.body.plan.perLevelKind.apply));
}

// ---------------------------------------------------------- generation --

console.log('\ngeneration: the bank written has the plan\'s numbers and all four kinds');
const gen = await post('/api/generate', { contentId, topics, plan: {} });
const bank = (await get(`/api/bank/${contentId}`)).body.questions ?? [];
{
  check('generation answers with the planned size', gen.status === 200 && gen.body.generated === topics.length * 12
    && gen.body.generated === gen.body.plan.total, `${gen.status} ${gen.body.generated} of ${gen.body.plan?.total}`);
  check('per level exactly as planned', JSON.stringify(gen.body.perLevel) === JSON.stringify(gen.body.plan.perLevel),
    JSON.stringify(gen.body.perLevel));
  check('the reply\'s plan carries the kind split', Object.keys(gen.body.plan.perKind ?? {}).length >= 10,
    JSON.stringify(gen.body.plan.perKind));
  for (const kind of NEW) {
    const mine = bank.filter((q) => q.kind === kind);
    check(`${kind}: drafts written, each valid, checked and offline`,
      mine.length > 0 && mine.every((q) => q.status === 'draft' && invalidReason(q) === null && Array.isArray(q.checks)
        && q.model === 'offline-template'),
      `${mine.length} written`);
  }
  check('no selected-response question at Create', bank.filter((q) => q.bloom === 'create').every((q) => !isSelectedResponse(q.kind)));
}

// ------------------------------------------------------------ the room --

console.log('\nthe room: the four kinds served, answered right and wrong, through the real socket');
const byId = new Map(bank.map((q) => [String(q._id), q]));
const chosen = bank.filter((q) => NEW.includes(q.kind));
for (const q of chosen) await post(`/api/bank/question/${q._id}/approve`);
const room = await post('/api/session', { contentId, title: 'New kinds' });
check('a room opens on the approved questions', room.status === 200 && Boolean(room.body.code), `${room.status} ${room.body.error ?? ''}`);

async function play(rollNo, answerOf) {
  const s = await connect();
  const first = either(s, ['server:question', 'server:exhausted', 'session:rejected']);
  s.emit('student:join', { code: room.body.code, rollNo, name: rollNo });
  let event = await first;
  const seen = [];
  for (let i = 0; i < 60 && event.name === 'server:question'; i += 1) {
    const shown = event.payload.question;
    const q = byId.get(String(shown._id));
    const result = either(s, ['server:result', 'session:rejected']);
    s.emit('student:answer', { questionId: shown._id, response: answerOf(q, shown), answerId: `kinds-${rollNo}-${String(i).padStart(4, '0')}` });
    const r = await result;
    seen.push({ q, shown, result: r.payload });
    const nextQ = either(s, ['server:question', 'server:exhausted']);
    s.emit('student:next');
    event = await nextQ;
  }
  s.close();
  return { seen, ended: event.name };
}

{
  const right = await play('KINDS-1', rightFor);
  const served = new Set(right.seen.map((x) => x.q?.kind));
  check('every approved question is served, and nothing else', right.ended === 'server:exhausted'
    && right.seen.length === chosen.length && right.seen.every((x) => x.q && NEW.includes(x.q.kind)),
    `${right.seen.length} of ${chosen.length}`);
  for (const kind of NEW) check(`${kind} reaches the phone`, served.has(kind));
  check('no payload carries any part of a key', right.seen.every((x) => leaks(x.shown).length === 0),
    right.seen.map((x) => leaks(x.shown).join(',')).filter(Boolean).join(' / '));
  for (const kind of NEW) {
    const mine = right.seen.filter((x) => x.q.kind === kind);
    check(`${kind}: the phone's right answer scores 1`, mine.length > 0 && mine.every((x) => x.result.score === 1 && x.result.correct === true),
      mine.map((x) => `${x.result.score} ${x.result.detail ?? ''}`).join('; '));
  }
  // The solution goes back in the shape each phone widget reads.
  const sol = (kind) => right.seen.find((x) => x.q.kind === kind)?.result.solution;
  const drop = right.seen.find((x) => x.q.kind === 'dropdown');
  check('dropdown: the solution names, in shown positions, the right option of each gap',
    Array.isArray(sol('dropdown')) && sol('dropdown').every((pos, i) =>
      drop.shown.gaps[i].options[pos] === drop.q.blanks[i].options[drop.q.blanks[i].answerIdx]));
  check('grid: the solution is the true cells as "row:column"', Array.isArray(sol('grid')) && sol('grid').every((k) => /^\d+:\d+$/.test(k)));
  check('table: the solution is the first accepted answer per blank cell', sol('table') && typeof sol('table') === 'object' && !Array.isArray(sol('table')));
  check('hot text: the solution is the right token indices', JSON.stringify(sol('hottext'))
    === JSON.stringify([...right.seen.find((x) => x.q.kind === 'hottext').q.answerIdxs].sort((a, b) => a - b)));

  // One student per kind, wrong on that kind only. A student wrong on
  // everything drops below 40% after three answers, and that band is served
  // Remember and Understand only - which this room has none of - so they would
  // run out before reaching every kind. Wrong on one kind (two items at most),
  // they cannot fall into it before that kind's items are all answered.
  const rolls = {};
  for (const kind of NEW) {
    const roll = `KINDS-W-${kind.toUpperCase()}`;
    rolls[kind] = roll;
    const wrong = await play(roll, (q, shown) => (q.kind === kind ? wrongFor(q, shown) : rightFor(q, shown)));
    const mine = wrong.seen.filter((x) => x.q.kind === kind);
    check(`${kind}: a wrong answer scores 0`,
      mine.length === chosen.filter((q) => q.kind === kind).length && mine.every((x) => x.result.score === 0 && x.result.correct === false),
      `${mine.length} answered: ${mine.map((x) => `${x.result.score} ${x.result.detail ?? ''}`).join('; ')}`);
  }

  const stored = (await get(`/api/session/${room.body.code}/answers?limit=200`)).body.items ?? [];
  const mark = (roll) => stored.filter((a) => a.student.rollNo === roll);
  check('every attempt is stored as evidence with its kind and its mark',
    mark('KINDS-1').length === chosen.length && mark('KINDS-1').every((a) => a.score === 1 && NEW.includes(a.kind))
      && NEW.every((kind) => {
        const rows = mark(rolls[kind]);
        return rows.length > 0 && rows.every((a) => (a.kind === kind ? a.score === 0 : a.score === 1));
      }),
    `${mark('KINDS-1').length} right, ${NEW.map((k) => mark(rolls[k]).length).join('+')} with one kind wrong`);
}

// ------------------------------------------------------------- editing --

console.log('\nediting: PATCH on each of the four validates the whole payload');
{
  const one = (kind) => bank.find((q) => q.kind === kind);
  const edits = {
    hottext: (q) => ({
      valid: { answerIdxs: [q.tokens.length - 1], criterion: '  the last word of the line ' },
      invalid: { answerIdxs: [0, q.tokens.length] },
      reason: 'hottext answerIdxs out of range',
      landed: (r) => JSON.stringify(r.answerIdxs) === JSON.stringify([q.tokens.length - 1]) && r.criterion === 'the last word of the line',
    }),
    dropdown: (q) => ({
      valid: { blanks: q.blanks.map((b, i) => (i === 0 ? { options: [...b.options, ' an extra option '], answerIdx: b.answerIdx } : b)) },
      invalid: { blanks: q.blanks.map((b, i) => (i === 0 ? { options: b.options, answerIdx: b.options.length } : b)) },
      reason: 'a dropdown gap has an answerIdx out of range',
      landed: (r) => r.blanks[0].options.at(-1) === 'an extra option' && r.blanks[0].options.length === q.blanks[0].options.length + 1,
    }),
    table: (q) => {
      const at = q.rows.findIndex((r) => r.cells.some((c) => c.accept));
      const rows = (cell) => q.rows.map((r, ri) => (ri === at ? { ...r, cells: r.cells.map((c) => (c.accept ? cell(c) : c)) } : r));
      return {
        valid: { rows: rows((c) => ({ accept: [...c.accept, ' another spelling '] })) },
        invalid: { rows: rows((c) => ({ ...c, given: 'shown and blank at once' })) },
        reason: 'every table cell is either given or blank, never both and never neither',
        landed: (r) => r.rows[at].cells.some((c) => c.accept?.at(-1) === 'another spelling'),
      };
    },
    grid: (q) => ({
      valid: { columns: q.columns.map((c, i) => (i === 0 ? ` ${c} ` : c)) },
      invalid: { answers: q.answers.map((row) => row.map(() => true)) },
      reason: 'a grid where every intersection is true asks nothing',
      landed: (r) => r.columns[0] === q.columns[0],
    }),
  };

  for (const kind of NEW) {
    // Read now, not from the bank fetched before the approvals above.
    const q = await repo.getQuestion(one(kind)._id);
    const e = edits[kind](q);
    const before = JSON.stringify(q);
    const bad = await patch(`/api/bank/question/${q._id}`, e.invalid);
    check(`${kind}: an invalid edit is refused with the validator's words, and nothing changes`,
      bad.status === 400 && bad.body.error === e.reason && JSON.stringify(await repo.getQuestion(q._id)) === before,
      `${bad.status} "${bad.body.error}"`);
    const good = await patch(`/api/bank/question/${q._id}`, e.valid);
    const after = await repo.getQuestion(q._id);
    check(`${kind}: a valid edit lands whole, tidied, still valid, its status and checks kept up`,
      good.status === 200 && e.landed(after) && invalidReason(after) === null && after.status === q.status && Array.isArray(after.checks),
      `${good.status} ${good.body.error ?? ''}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore?.().catch?.(() => {});
process.exit(fail ? 1 : 0);
