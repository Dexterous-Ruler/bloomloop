// Phase 5 - honest indicators, end to end.
//
//   node server/scripts/honesty.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with phones over Socket.io and
// signed-in staff, and checks:
//
//   phones       every question a phone is served carries who wrote it in a
//                student's words (never "template", "fallback" or a model's
//                name), checked against the row it came from; no draft is ever
//                served; nothing a phone hears carries a staff label, a band, an
//                uncertain level, a translation warning, a misconception label,
//                a ranking, coins or a streak; a level resting on too few answers
//                is marked provisional on the phone, and a firm one is not
//   staff        every bank question carries its provenance and approval state
//                (an AI draft says so), and an uncertain level with its reason;
//                every misconception label its provenance and whether a
//                professor confirmed it; every level, band, mastery figure, KPI,
//                card and item difficulty its count and a sentence, provisional
//                below the engine's own minimum
//   moves        every level move is kept with its rule, window, share, answers
//                and the professor's sentence, read back from the store after
//                later answers have overwritten the profile's reason; a
//                student's own dashboard never carries them
//   languages    a room with answers in English and Hindi on one question
//                raises the translation warning with the numbers behind it, in
//                the room's and the bank's item statistics; the student card
//                says which answers were in another language
//   class        a class question reaches the phones with its provenance; the
//                professor's view names its source
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
const { levelMoves } = await import(`${SRC}services/mastery.js`);

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
// HOD (CSE) <- professor A <- Asha (roll S01); professor B under another HOD.

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'e0000000-0000-4000-8000-000000000001',
  profA: 'e0000000-0000-4000-8000-000000000002',
  profB: 'e0000000-0000-4000-8000-000000000003',
  hodOther: 'e0000000-0000-4000-8000-000000000004',
  asha: 'e0000000-0000-4000-8000-000000000005',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-HNST0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.asha, 'student', 'CSE', ID.profA, 'S01'),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
].map((a) => [a.id, a]));
const TOKENS = { hod: 'tok-hod', profA: 'tok-prof-a', profB: 'tok-prof-b', hodOther: 'tok-hod-other', asha: 'tok-asha' };
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
    throw new Error(`honesty.mjs refuses to reach ${url.origin}`);
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
  // A signed-in student's supports: none here.
  if (url.pathname === '/rest/v1/accommodations' || url.pathname === '/rest/v1/student_accommodations') return reply([]);
  return reply({ message: `not answered by honesty.mjs: ${url.pathname}` }, 404);
};
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'honesty-test-service-key';

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

/** `as`: one of the TOKENS' names, or null for no credentials. */
async function call(method, path, { body, as = 'profA' } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = (path, as) => call('GET', path, { as });
const post = (path, body, as) => call('POST', path, { body, as });

// ------------------------------------------------------------- sockets --

/** Every event every phone received, to search afterwards. */
const phoneLog = [];

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

/**
 * Join, then answer what is served: right or wrong per `plan`, in order. The
 * phone stays connected. Resolves with what was served and every result.
 */
async function sit(code, rollNo, plan, { token } = {}) {
  const s = await connect();
  s.onAny((event, payload) => phoneLog.push({ rollNo, event, payload }));
  const accepted = either(s, ['session:accepted', 'session:rejected']);
  let next = either(s, ['server:question', 'server:exhausted']);
  s.emit('student:join', { code, rollNo, name: `Student ${rollNo}`, ...(token ? { token } : {}) });
  const joined = (await accepted).payload;
  const served = [];
  const results = [];
  let error = null;
  try {
    for (let k = 0; k < plan.length; k += 1) {
      const ev = await next;
      if (ev.name === 'server:exhausted') break;
      const q = ev.payload.question;
      served.push(ev.payload);
      const row = await repo.getQuestion(q._id);
      const result = either(s, ['server:result', 'session:rejected']);
      s.emit('student:answer', { questionId: q._id, response: plan[k] ? row.answerIdx : (row.answerIdx + 1) % 4, answerId: `${code}-${rollNo}-${k}-hn` });
      results.push((await result).payload);
      next = either(s, ['server:question', 'server:exhausted']);
      s.emit('student:next');
    }
  } catch (err) {
    error = err.message;
  }
  return { s, joined, served, results, error };
}

// ------------------------------------------------------------ fixtures --

console.log('\nthe bank: every source and approval state');

const APPROVED = { status: 'active', approvedAt: '2026-11-19T07:00:00.000Z', approvedBy: ID.profA };
const mcq = (text, bloom, extra) => ({
  topic: 'UDP', text, kind: 'mcq', options: ['TCP', 'UDP', 'SCTP', 'QUIC'], answerIdx: 1, bloom, ...extra,
});
const content = await repo.createContent({ title: 'Transport layer', kind: 'syllabus', rawText: '', topics: ['UDP'], ownerId: ID.profA });
const FIXTURE = {
  aiApproved1: mcq('Which protocol has no handshake?', 'remember', { source: 'llm', model: 'gemini-test', ...APPROVED }),
  aiApproved2: mcq('Which protocol suits live video?', 'remember', { source: 'llm', model: 'gemini-test', ...APPROVED }),
  aiApproved3: mcq('Which protocol does DNS mostly use?', 'remember', { source: 'llm', model: 'gemini-test', ...APPROVED }),
  aiApproved4: mcq('Which protocol keeps no connection state?', 'remember', { source: 'llm', model: 'gemini-test', ...APPROVED }),
  professor: mcq('Which protocol is connectionless?', 'remember', { source: 'teacher', status: 'active' }),
  template: mcq('Which protocol is datagram-based?', 'remember', { source: 'fallback', model: 'offline-template', ...APPROVED }),
  legacyFallback: mcq('Which protocol sends datagrams?', 'remember', { source: 'fallback', model: null, status: 'active' }),
  aiUnrecorded: mcq('Which protocol carries VoIP calls?', 'remember', { source: 'llm', model: null, status: 'active' }),
  understand1: mcq('Why does UDP suit games?', 'understand', { source: 'teacher', status: 'active' }),
  understand2: mcq('Why does UDP need no handshake?', 'understand', { source: 'teacher', status: 'active' }),
  understand3: mcq('Why is UDP lighter than TCP?', 'understand', { source: 'teacher', status: 'active' }),
  understand4: mcq('Why do streams prefer UDP?', 'understand', { source: 'teacher', status: 'active' }),
  aiDraft: mcq('Which protocol is the draft about?', 'remember', { source: 'llm', model: 'gemini-test', status: 'draft' }),
  analyseByOldKind: mcq('Which protocol would you analyse first?', 'analyse', { source: 'teacher', status: 'active' }),
};
const inserted = await repo.insertQuestions(Object.values(FIXTURE).map((q) => ({ contentId: content._id, ...q })));
const Q = Object.fromEntries(Object.keys(FIXTURE).map((k, i) => [k, inserted[i]]));
const byId = new Map(inserted.map((q) => [String(q._id), q]));

// An AI-proposed misconception label, not yet confirmed, on one served question.
await repo.updateQuestion(Q.aiApproved1._id, {
  misconceptions: [{ option: 'TCP', label: 'Thinks every protocol needs a handshake', provenance: 'ai', addedAt: APPROVED.approvedAt, changedAt: APPROVED.approvedAt, by: null }],
});

const PHONE_TEXT = {
  'Written by your professor.': ['professor', 'understand1', 'understand2', 'understand3', 'understand4', 'analyseByOldKind'],
  'Written with AI help and checked by your professor.': ['aiApproved1', 'aiApproved2', 'aiApproved3', 'aiApproved4'],
  'Made without AI from your professor\'s material, and checked by your professor.': ['template'],
  'Made without AI, by your professor or from their material.': ['legacyFallback'],
  'Written with AI help and chosen by your professor.': ['aiUnrecorded'],
};
const expectedText = new Map(Object.entries(PHONE_TEXT).flatMap(([text, keys]) => keys.map((k) => [String(Q[k]._id), text])));

// ------------------------------------------------------------- the room --

console.log('\na room: three phones, one signed in');

const room = await post('/api/session', { contentId: String(content._id), startLevel: 'remember' });
check('the room opens on the approved bank', room.status === 200 && Boolean(room.body.code), JSON.stringify(room.body).slice(0, 200));
const code = room.body.code;
const sessionId = room.body.sessionId;

const teacher = await connect();
const grids = [];
teacher.on('teacher:grid', (g) => grids.push(g));
teacher.emit('teacher:watch', { code, token: TOKENS.profA });

// S01, signed in: right every time, so the ladder moves up. S02: wrong every
// time, into the below-40% band. S03: one answer, so its level is provisional.
const s01 = await sit(code, 'S01', Array(7).fill(true), { token: TOKENS.asha });
const s02 = await sit(code, 'S02', Array(5).fill(false));
const s03 = await sit(code, 'S03', [true]);
check('every phone answered what it was served', [s01, s02, s03].every((p) => !p.error && p.results.length > 0),
  [s01, s02, s03].map((p) => p.error ?? p.results.length).join(' / '));
check('the signed-in phone was linked', s01.joined?.linked === true, JSON.stringify(s01.joined).slice(0, 160));

// -------------------------------------------------------- what phones get --

console.log('\nwhat every phone was told');

const served = [s01, s02, s03].flatMap((p) => p.served);
check('every question served carries a provenance', served.length > 0 && served.every((p) => p.question?.provenance
  && typeof p.question.provenance.text === 'string' && ['professor', 'ai', 'not-ai'].includes(p.question.provenance.by)));
const wrongText = served.filter((p) => p.question.provenance.text !== expectedText.get(String(p.question._id)));
check('each in the words its row calls for: professor, AI checked, AI chosen, made without AI', wrongText.length === 0,
  wrongText.map((p) => `${byId.get(String(p.question._id))?.text}: ${p.question.provenance.text}`).join('; '));
const sources = new Set(served.map((p) => byId.get(String(p.question._id))?.source));
check('the phones met more than one source, so the wording was really tested', sources.size >= 2, [...sources].join(', '));
check('no provenance a phone was told names a template, a fallback or a model',
  served.every((p) => !/template|fallback|offline|\bllm\b|gemini|model/i.test(JSON.stringify(p.question.provenance))));
check('no draft was ever served', !served.some((p) => byId.get(String(p.question._id))?.status === 'draft'));

const heard = JSON.stringify(phoneLog.map((h) => h.payload));
const STAFF_ONLY = /"levelCheck"|"uncertain"|model-level-unconfirmed|kind-does-not-fit-level|"aiDraft"|"approval"|"sourceLabel"|"levelBasis"|"bandBasis"|"moves"|"misconceptions?"|Thinks every protocol|"confirmed"/;
check('nothing a phone heard carries a level check, a staff provenance, a staff basis, a move or a label',
  !STAFF_ONLY.test(heard), heard.match(STAFF_ONLY)?.[0]);
const LABELS = /band|below-40|40%|slow ?learner|needs support|excelling|developing|integrity|Left the page|faster than/i;
check('nothing a phone heard names a band or a label about the student', !LABELS.test(heard), heard.match(LABELS)?.[0]);
check('no ranking, leaderboard, coins, badges, points or streaks reach a phone',
  !/leaderboard|streak|\bcoins?\b|\bbadges?\b|\bxp\b|\branks?\b|\branked\b|\bposition\b/i.test(heard), heard.match(/leaderboard|streak|coin|badge|rank|position/i)?.[0]);
check('no translation warning reaches a phone', !/Translation can change|"warning"/.test(heard));

const resultRows = (p) => p.results.map((r) => r.profile).filter(Boolean);
check('a level on one answer is provisional on the phone', resultRows(s03).at(-1)?.next?.provisional === true,
  JSON.stringify(resultRows(s03).at(-1)?.next));
const moved = resultRows(s01).find((r) => r.workingLevel === 'understand');
check('a level the ladder moved to is not', moved?.next?.provisional === false, JSON.stringify(moved?.next));
check('the band is not provisional, and the phone is still not told it', resultRows(s02).at(-1)?.next?.provisional === false);
const phoneMastery = [s01, s02, s03].flatMap(resultRows).flatMap((r) => r.masteryBasis ?? []);
check('every phone row says what each level\'s mastery rests on, with no percentage', phoneMastery.length > 0
  && phoneMastery.every((m) => Number.isInteger(m.answers) && typeof m.sentence === 'string' && !/%/.test(m.sentence)));

// --------------------------------------------------------- what staff get --

console.log('\nwhat the professor is told');

const isBasis = (b) => b && Number.isInteger(b.answers) && typeof b.provisional === 'boolean' && typeof b.sentence === 'string' && b.sentence.length > 0;

const grid = await get(`/api/session/${code}/grid`);
const row = (roll) => grid.body.rows?.find((r) => r.rollNo === roll);
check('the grid: every row says what its level rests on, and per level its mastery',
  grid.status === 200 && grid.body.rows.length === 3 && grid.body.rows.every((r) => isBasis(r.levelBasis) && Array.isArray(r.masteryBasis)));
check('one answer: provisional, and the sentence says so', row('S03')?.levelBasis.provisional === true && /^Provisional: 1 answer/.test(row('S03')?.levelBasis.sentence),
  JSON.stringify(row('S03')?.levelBasis));
check('the moved and the banded students\' levels are firm', row('S01')?.levelBasis.provisional === false && row('S02')?.levelBasis.provisional === false);
check('the live grid carries the same', grids.length > 0 && grids.at(-1).rows.every((r) => isBasis(r.levelBasis)));

const ins = await get(`/api/session/${code}/insights`);
const st = (roll) => ins.body.students?.find((s) => s.rollNo === roll);
check('insights: every student\'s band and level carry their count and a sentence', ins.status === 200
  && ins.body.students.every((s) => isBasis(s.bandBasis) && isBasis(s.levelBasis)));
check('a band on one answer is provisional, never a state', st('S03')?.band === null && st('S03')?.bandBasis.provisional === true
  && /1 graded answer so far; a band needs at least 3/.test(st('S03')?.bandBasis.sentence));
check('every KPI says what it rests on', ['accuracy', 'support', 'participation'].every((k) => typeof ins.body.kpis?.[k]?.sentence === 'string'),
  JSON.stringify(ins.body.kpis).slice(0, 200));
check('every card says what it rests on', ins.body.cards?.length === 3 && ins.body.cards.every((c) => typeof c.basis?.sentence === 'string'));

// ------------------------------------------------------------------ moves --

console.log('\nevery level move, with its reason, kept');

const card1 = await get(`/api/session/${code}/students/S01/card`);
const moves1 = card1.body.serving?.moves ?? [];
const up = moves1.find((m) => m.rule === 'promote' && m.from === 'remember' && m.to === 'understand');
check('the card lists the move up, with its window, share and answers', card1.status === 200 && up?.window === 5
  && typeof up.share === 'number' && up.share >= 0.7 && Number.isInteger(up.answers) && up.answers >= 3, JSON.stringify(moves1));
check('and the professor\'s sentence for it', /promoted to Understand/.test(up?.reason ?? ''), up?.reason);
const stored1 = await repo.getProfile(sessionId, 'S01');
check('read back from the store, after later answers overwrote the profile\'s reason', levelMoves(stored1).some((m) => m.reason === up?.reason)
  && stored1.reason !== up?.reason, stored1.reason);
check('the card says what the level and each level\'s mastery rest on', isBasis(card1.body.serving?.basis) && Array.isArray(card1.body.mastery)
  && card1.body.mastery.length > 0);
const card2 = await get(`/api/session/${code}/students/S02/card`);
const band = (card2.body.serving?.moves ?? []).find((m) => m.rule === 'band');
check('the band\'s move is kept for staff, its window every counted answer, its sentence naming the band',
  band?.window === null && /below-40% band/.test(band?.reason ?? ''), JSON.stringify(card2.body.serving?.moves));
const card3 = await get(`/api/session/${code}/students/S03/card`);
check('a band on one answer is provisional on the card', card3.body.band?.provisional === true && card3.body.band?.id === null);
check('one language: the card says nothing about languages', card1.body.languages?.note === null && card1.body.languages?.otherThanOriginal === 0);

const dash = await get('/api/dashboard', 'asha');
const trail = (dash.body.sessions ?? []).flatMap((s) => s.history ?? []);
check('the student\'s own dashboard trail carries no move and no band', dash.status === 200 && trail.length > 0
  && !trail.some((h) => 'move' in h) && !/below-40|band/i.test(JSON.stringify(dash.body)), `${dash.status} ${trail.length}`);
const profDash = await get('/api/dashboard');
const roomRow = profDash.body.recentSessions?.find?.((r) => r.code === code)
  ?? (profDash.body.sessions ?? []).find((r) => r.code === code);
const hodDash = await get('/api/dashboard', 'hod');
const hodRow = hodDash.body.recentSessions?.find((r) => r.code === code);
check('a dashboard\'s room accuracy says how many answers and students it rests on',
  Number.isInteger(hodRow?.answers) && hodRow.answers > 0 && Number.isInteger(hodRow?.students), JSON.stringify(hodRow ?? roomRow));
const hodProf = hodDash.body.professors?.find((p) => String(p.id) === ID.profA);
check('and an HOD\'s professor row says how many answers its accuracy rests on', Number.isInteger(hodProf?.answers) && hodProf.answers > 0,
  JSON.stringify(hodProf));

// Phase 5 follow-up: decision 6's three level bands beside the six levels, for
// staff only, each the sum of its two levels with the answers behind it.
const asJson = (x) => JSON.stringify(x);
const bandsAgree = (body) => {
  const six = new Map((body?.bloom ?? []).map((r) => [r.level, r]));
  const sum = (b, k) => b.levels.reduce((n, l) => n + (six.get(l)?.[k] ?? 0), 0);
  return Array.isArray(body?.levelBands) && asJson(body.levelBands.map((b) => b.id)) === '["lower","middle","higher"]'
    && body.levelBands.every((b) => b.answers === sum(b, 'seen') && b.correct === sum(b, 'correct') && /graded answer/.test(b.sentence ?? ''))
    && body.levelBands.reduce((n, b) => n + b.answers, 0) === body.bloom.reduce((n, r) => n + r.seen, 0)
    && body.levelBands.some((b) => b.answers > 0);
};
check('the professor\'s and the HOD\'s dashboards carry the three level bands beside the six levels, each summed with its answers',
  bandsAgree(profDash.body) && bandsAgree(hodDash.body), asJson([profDash.body.levelBands, hodDash.body.levelBands]));
check('a student\'s own dashboard does not', dash.status === 200 && !('levelBands' in dash.body));
const anaList = await get('/api/analytics');
const anaAsha = await get(`/api/analytics/${ID.asha}`);
const anaHodList = await get('/api/analytics', 'hod');
const anaProf = await get(`/api/analytics/${ID.profA}`, 'hod');
check('so do staff analytics: a professor\'s student and an HOD\'s professor, in full and in the list',
  bandsAgree(anaAsha.body) && bandsAgree(anaProf.body)
  && asJson(anaList.body.subjects?.find((s) => s.id === ID.asha)?.levelBands) === asJson(anaAsha.body.levelBands)
  && asJson(anaHodList.body.subjects?.find((s) => s.id === ID.profA)?.levelBands) === asJson(anaProf.body.levelBands),
  asJson([anaAsha.body.levelBands, anaProf.body.levelBands]));
const anaSelf = await get(`/api/analytics/${ID.asha}`, 'asha');
const anaSelfList = await get('/api/analytics', 'asha');
check('a student reading themself is sent no level bands', anaSelf.status === 200 && Array.isArray(anaSelf.body.bloom)
  && !('levelBands' in anaSelf.body) && anaSelfList.status === 200 && !('levelBands' in (anaSelfList.body.detail ?? {})));

// Phase 5 follow-up: students in roll order (the owner's rule); highest accuracy
// first only when asked for.
const byRollNo = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const rolls = (anaProf.body.students ?? []).map((s) => s.rollNo);
check('a professor\'s analytics lists their students in roll order by default', rolls.length >= 3
  && asJson(rolls) === asJson([...rolls].sort(byRollNo)), rolls.join(','));
const byAcc = await get(`/api/analytics/${ID.profA}?order=accuracy`, 'hod');
const accRolls = (byAcc.body.students ?? []).map((s) => s.rollNo);
const accs = (byAcc.body.students ?? []).map((s) => s.accuracy ?? -1);
check('highest accuracy first only when asked, the same students', byAcc.status === 200
  && asJson([...accRolls].sort(byRollNo)) === asJson(rolls) && accs.every((a, i) => i === 0 || accs[i - 1] >= a)
  && asJson(accRolls) !== asJson(rolls), accRolls.join(','));
const badOrder = await get(`/api/analytics/${ID.profA}?order=best`, 'hod');
const outsider = await get(`/api/analytics/${ID.profA}?order=best`, 'hodOther');
const nobody = await get('/api/analytics/e0000000-0000-4000-8000-0000000000ff', 'hodOther');
check('any other order is a 400 in a sentence; someone who may not see the professor gets the same 404 as for nobody first',
  badOrder.status === 400 && /roll order/.test(badOrder.body.error ?? '') && !/[?=]|order=/.test(badOrder.body.error ?? '')
  && outsider.status === 404 && asJson(outsider.body) === asJson(nobody.body), asJson([badOrder.status, badOrder.body, outsider.status]));

// ------------------------------------------------------------------- bank --

console.log('\nthe bank: provenance, approval and uncertain levels, for staff only');

const bank = await get(`/api/bank/${content._id}`);
const bq = (k) => bank.body.questions?.find((q) => String(q._id) === String(Q[k]._id));
check('every question carries its provenance and approval state', bank.status === 200
  && bank.body.questions.every((q) => q.provenance?.label && q.provenance?.approval && q.provenance?.source));
check('an AI question waiting for approval is an "AI draft"', bq('aiDraft')?.provenance.label === 'AI draft' && bq('aiDraft')?.provenance.aiDraft === true);
check('approved, professor-written, template and the ambiguous older rows are each named',
  bq('aiApproved1')?.provenance.label === 'AI-generated, approved' && bq('professor')?.provenance.label === 'Professor-written'
  && bq('template')?.provenance.label === 'Offline template, approved'
  && bq('legacyFallback')?.provenance.label === 'Professor-written or offline template, approval not recorded',
  ['aiApproved1', 'professor', 'template', 'legacyFallback'].map((k) => bq(k)?.provenance.label).join(' | '));
check('a level the model chose that nobody approved is uncertain, with the reason',
  bq('aiUnrecorded')?.levelCheck.uncertain === true && bq('aiUnrecorded').levelCheck.reasons[0].id === 'model-level-unconfirmed'
  && bq('aiDraft')?.levelCheck.uncertain === true);
check('a kind that does not ask for its level is uncertain, with the reason',
  bq('analyseByOldKind')?.levelCheck.reasons.map((r) => r.id).join() === 'kind-does-not-fit-level'
  && bq('understand1')?.levelCheck.uncertain === true);
check('an approved AI question and a professor\'s at a fitting kind are not',
  bq('aiApproved1')?.levelCheck.uncertain === false && bq('professor')?.levelCheck.uncertain === false);
const servedUncertain = served.filter((p) => bq(Object.keys(Q).find((k) => String(Q[k]._id) === String(p.question._id)))?.levelCheck.uncertain);
check('phones were served questions staff see as uncertain, and were never told', servedUncertain.length > 0 && !STAFF_ONLY.test(heard),
  String(servedUncertain.length));
const hodBank = await get(`/api/bank/${content._id}`, 'hod');
check('an HOD of the department reads the same provenance', hodBank.status === 200
  && hodBank.body.questions.every((q) => q.provenance?.label));
const labels = await get(`/api/bank/question/${Q.aiApproved1._id}/misconceptions`);
check('a misconception label says who proposed it and that no professor confirmed it',
  labels.body.misconceptions?.[0]?.provenanceLabel === 'AI draft' && labels.body.misconceptions?.[0]?.confirmed === false,
  JSON.stringify(labels.body.misconceptions));

const items = await get(`/api/session/${code}/items`);
check('item statistics: every item says what its difficulty rests on, who wrote it and whether its level is certain',
  items.status === 200 && items.body.items.length > 0
  && items.body.items.every((i) => isBasis(i.basis) && i.provenance?.label && i.levelCheck && i.languages));
check('an item under five answers is provisional, and says why', items.body.items.some((i) => i.attempts > 0 && i.attempts < 5
  && i.basis.provisional && /too few for a difficulty band \(5 needed\)/.test(i.basis.sentence)));

// Every wording, for certain: a room whose set is one question of each kind of
// row, so every one of them is served (the selector picks at random within a
// level, so the room above need not have met them all).
const every = ['professor', 'aiApproved2', 'template', 'legacyFallback', 'aiUnrecorded', 'aiApproved3'];
const room3 = await post('/api/session', { contentId: String(content._id), startLevel: 'remember', questionIds: every.map((k) => String(Q[k]._id)) });
const s09 = await sit(room3.body.code, 'S09', Array(6).fill(false));
const texts = new Set(s09.served.map((p) => p.question.provenance.text));
check('a room serving one question of each kind of row: every wording, each on its own row', room3.status === 200 && s09.served.length === 6
  && texts.size === 5 && s09.served.every((p) => p.question.provenance.text === expectedText.get(String(p.question._id))),
  `${room3.status} ${s09.served.length} ${[...texts].join(' | ')}`);
s09.s.close();

// --------------------------------------------------------------- languages --

console.log('\ntwo languages on one question');

const room2 = await post('/api/session', { contentId: String(content._id), startLevel: 'remember' });
const code2 = room2.body.code;
const R1 = Q.aiApproved1;
const snapshot = { id: String(R1._id), topic: R1.topic, text: R1.text, kind: 'mcq', options: R1.options, answerIdx: 1, bloom: 'remember', source: 'llm', model: 'gemini-test' };
const fixtureRow = (i, right, language) => repo.recordAnswer({
  sessionId: room2.body.sessionId, answerKey: `lang-fixture-${String(i).padStart(4, '0')}`, rollNo: `T${String(i).padStart(2, '0')}`,
  accountId: null, questionId: String(R1._id), contentId: String(content._id), topic: 'UDP', bloom: 'remember', kind: 'mcq',
  questionSnapshot: snapshot, response: right ? 1 : 0, attempt: 1, final: true, correct: right, score: right ? 1 : 0,
  language, questionSource: 'llm', reviewStatus: 'auto', answeredAt: new Date().toISOString(),
});
// Ten in English, eight right; five in Hindi, two right: 80% against 40%.
for (let i = 1; i <= 10; i += 1) await fixtureRow(i, i <= 8, 'en');
for (let i = 11; i <= 15; i += 1) await fixtureRow(i, i <= 12, 'hi');
await repo.saveProfile({ sessionId: room2.body.sessionId, rollNo: 'T11', name: 'T11', levels: {}, workingLevel: 'remember', history: [], reason: '' });

const items2 = await get(`/api/session/${code2}/items`);
const lang = items2.body.items?.find((i) => i.questionId === String(R1._id))?.languages;
check('the room\'s item report splits the answers by language', JSON.stringify(lang?.languages?.map((l) => [l.language, l.answers, l.correct]))
  === '[["en",10,8],["hi",5,2]]', JSON.stringify(lang?.languages));
check('and raises the translation warning, naming both languages and the numbers behind it',
  lang?.warning?.languages?.join() === 'en,hi' && /Answers in Hindi were right 2 of 5 times \(40%\), against 8 of 10 \(80%\) in English: a gap of 40 points/.test(lang?.warning?.text ?? ''),
  lang?.warning?.text);
check('it says how many answers were in another language than the question\'s own', lang?.otherThanOriginal === 5 && /^5 of 15 answers/.test(lang?.note ?? ''));
check('the report counts the warnings and says the threshold', items2.body.translation?.warnings === 1
  && items2.body.translation?.minAnswersPerLanguage === 5 && items2.body.translation?.gapAbovePoints === 20);
const optionLabel = items2.body.items?.find((i) => i.questionId === String(R1._id))?.distribution?.rows?.[0]?.options
  ?.find((o) => o.text === 'TCP')?.misconception;
check('the option\'s misconception label in the item report says it is an unconfirmed AI draft',
  optionLabel?.provenanceLabel === 'AI draft' && optionLabel?.confirmed === false, JSON.stringify(optionLabel));
const stats = await get(`/api/bank/${content._id}/stats`);
check('the bank\'s item statistics carry it too', Boolean(stats.body.items?.find((i) => i.questionId === String(R1._id))?.languages?.warning));
const card11 = await get(`/api/session/${code2}/students/T11/card`);
check('the student card says this student\'s answers were in another language', card11.status === 200
  && card11.body.languages?.otherThanOriginal === 1 && /in Hindi, not the question's own English/.test(card11.body.languages?.note ?? '')
  && card11.body.lastAnswers?.items?.[0]?.language === 'hi', JSON.stringify(card11.body.languages));
check('and still no phone has heard any of it', !/Translation can change|Hindi/.test(JSON.stringify(phoneLog.map((h) => h.payload))));

// ------------------------------------------------------- class question --

console.log('\na class question carries its provenance to the phones');

const asking = Q.aiApproved4;
const reached = [s01, s02, s03].map((p) => either(p.s, ['class:question']));
const started = await post(`/api/session/${code}/class-questions`, { questionId: String(asking._id) });
const cqs = await Promise.allSettled(reached);
const got = cqs.filter((r) => r.status === 'fulfilled').map((r) => r.value.payload);
check('the class question reached the phones', started.status === 201 || started.status === 200, `${started.status} ${JSON.stringify(started.body).slice(0, 160)}`);
check('with who wrote it, in a student\'s words', got.length === 3
  && got.every((p) => p.question?.provenance?.text === 'Written with AI help and chosen by your professor.'), JSON.stringify(got[0]?.question?.provenance));
const view = await get(`/api/session/${code}/class-questions/${started.body.id ?? started.body.classQuestion?.id}`);
check('the professor\'s view names its source', view.body.question?.sourceLabel === 'AI-generated', JSON.stringify(view.body.question).slice(0, 200));
check('and nothing new a phone heard carries a staff label', !STAFF_ONLY.test(JSON.stringify(phoneLog.map((h) => h.payload))));

// ------------------------------------------------------------------ done --

for (const p of [s01, s02, s03]) p.s.close();
teacher.close();
io.close();
server.close();
await closeStore();

check('nothing tried to leave this machine', refusedOffMachine === 0, String(refusedOffMachine));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
