// Phase 1 - reading the evidence back (services/evidence.js).
//
// The redaction is the one thing here that must never be wrong, so it is
// checked for every kind in questionTypes.js, against answer rows built exactly
// the way the live loop writes them: the snapshot is the whole stored question
// (answer key included) and the auto_* fields are score()'s own reading.
//
// The topic report and the student lister are checked against hand counts, the
// lister on the real in-process store. The Mongo and Supabase repos cannot be
// reached from a test, so for them this file checks the query each one would
// SEND for the new filters - not what a real database does with it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { KINDS, invalidReason, score, forStudent } from '../src/questionTypes.js';
import { LEVELS } from '../src/bloom.js';
import {
  redactForStudent, answerItem, shownQuestion, gradedEvidence, topicLevels, topicReport,
  listStudentAnswers, pageFrom, levelFrom, rollKey,
} from '../src/services/evidence.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';

/* --------------------------------------------------------------- fixtures -- */

// One valid question of every kind. Hidden answers use KEY... strings, so a
// leak of any of them shows up in a plain text search of the student's copy.
const Q = {
  mcq: { bloom: 'remember', text: 'Which organelle releases energy?', options: ['Ribosome', 'Golgi body', 'Mitochondrion', 'Lysosome'], answerIdx: 2 },
  truefalse: { bloom: 'remember', text: 'Chloroplasts are found in animal cells.', answerBool: false },
  match: {
    bloom: 'understand', text: 'Match each organelle with its job.',
    pairs: [{ left: 'Nucleus', right: 'Holds DNA' }, { left: 'Ribosome', right: 'Builds protein' }, { left: 'Vacuole', right: 'Stores water' }],
  },
  categorise: {
    bloom: 'understand', text: 'Sort each structure.',
    buckets: [{ name: 'Plant only', items: ['Cell wall', 'Chloroplast'] }, { name: 'Both', items: ['Nucleus', 'Membrane'] }],
  },
  blank: { bloom: 'apply', text: 'The control centre of the cell is the ____.', accept: ['KEYBLANK'] },
  cloze: { bloom: 'apply', text: 'Plants make ____ from light and ____.', blanks: [{ accept: ['KEYCLOZEA'] }, { accept: ['KEYCLOZEB'] }] },
  numeric: { bloom: 'apply', text: 'How many grams?', value: 4242.5, tolerance: 0.5, unit: 'g' },
  multi: { bloom: 'analyse', text: 'Which are organelles?', options: ['Nucleus', 'Atom', 'Ribosome', 'Molecule', 'Electron'], answerIdxs: [0, 2] },
  order: { bloom: 'evaluate', text: 'Put the stages in order.', sequence: ['Prophase', 'Metaphase', 'Anaphase'] },
  rank: { bloom: 'evaluate', text: 'Rank by size.', sequence: ['Cell', 'Nucleus', 'Ribosome'], criterion: 'largest first' },
  open: { bloom: 'create', text: 'Design an experiment on osmosis.', rubric: ['KEYRUBRIC names a control', 'KEYRUBRIC measures mass change'] },
  hottext: { bloom: 'analyse', text: 'Pick the verb.', tokens: ['The', 'cell', 'divides', 'quickly'], criterion: 'the verb', answerIdxs: [2] },
  dropdown: {
    bloom: 'apply', text: 'Water moves by ____ into the ____.',
    blanks: [{ options: ['osmosis', 'magic'], answerIdx: 0 }, { options: ['root', 'leaf', 'flower'], answerIdx: 0 }],
  },
  table: {
    bloom: 'apply', text: 'Complete the table.', columns: ['Organelle', 'Job'],
    rows: [
      { header: 'Row 1', cells: [{ given: 'Nucleus' }, { accept: ['KEYTABLE'] }] },
      { header: 'Row 2', cells: [{ given: 'Ribosome' }, { given: 'Makes protein' }] },
    ],
  },
  grid: { bloom: 'analyse', text: 'Tick where each holds.', rows: ['Plant cell', 'Animal cell'], columns: ['Cell wall', 'Nucleus'], answers: [[true, true], [false, true]] },
  poll: { bloom: 'understand', text: 'How sure do you feel about cells?', options: ['Very', 'Somewhat', 'Not yet'] },
};

// What a student sent: deliberately wrong where the kind hides a value, so a
// hidden value appearing in the student's copy can only be a leak.
const RESPONSE = {
  mcq: 0, truefalse: true, match: [0, 2, 1], categorise: { 0: 1, 1: 0 }, blank: 'cytoplasm', cloze: ['sugar', 'air'],
  numeric: '12', multi: [0, 1], order: [2, 0, 1], rank: [1, 0, 2], open: 'I am not sure about this one.',
  hottext: [1], dropdown: [1, 0], table: { '0:1': 'nope' }, grid: { '0:0': true }, poll: 1,
};

// Strings that are answers (or a teacher-only note) and must never reach the student.
const SECRETS = {
  blank: ['KEYBLANK'], cloze: ['KEYCLOZEA', 'KEYCLOZEB'], numeric: ['4242.5'], open: ['KEYRUBRIC'], table: ['KEYTABLE'],
  mcq: ['KEYSTIM'],
};

// Field names that carry a key, a rubric, the machine's reading or the stored
// snapshot. None may appear anywhere in a student's copy, at any depth.
const FORBIDDEN_KEYS = [
  'answerIdx', 'answerIdxs', 'answerBool', 'pairs', 'sequence', 'accept', 'rubric', 'buckets', 'blanks',
  'value', 'tolerance', 'answers', 'modelAnswer', 'solution',
  'auto', 'autoCorrect', 'autoScore', 'autoDetail', 'detail', 'snapshot', 'questionSnapshot',
  'reviewedBy', 'accountId', 'answerKey', 'questionId',
];

const ROOM = { _id: 'room-1', code: 'EVI001', title: 'Cells', startedAt: '2026-11-18T09:00:00.000Z', status: 'closed' };

/** A question as the bank holds it. */
const question = (kind, extra = {}) => ({
  _id: `q-${kind}`, contentId: 'content-1', status: 'active', createdAt: '2026-11-01T00:00:00.000Z',
  kind, topic: 'Cells', source: 'llm', ...Q[kind], ...extra,
});

/** The answer row the live loop writes for this question and response (sockets/index.js handleAnswer). */
function answerRow(q, response, { rollNo = '21CS01', reviewStatus, reviewNote = '' } = {}) {
  const graded = score(q, response, `${rollNo}:${q._id}`);
  const { _id, contentId, createdAt, status, ...rest } = q;
  const ungraded = q.kind === 'poll';
  return {
    _id: `a-${q.kind}`, sessionId: 'room-1', answerKey: `key-${q.kind}`, rollNo, accountId: 'acct-1',
    questionId: String(q._id), contentId: 'content-1', topic: q.topic, bloom: q.bloom, kind: q.kind,
    questionSnapshot: { id: String(_id), ...rest },
    response, attempt: 1, final: true,
    correct: ungraded ? null : graded.correct, score: ungraded ? null : graded.score,
    detail: graded.detail ?? '', ungraded,
    autoCorrect: graded.correct, autoScore: graded.score, autoDetail: graded.detail ?? '',
    reviewStatus: reviewStatus ?? (q.kind === 'open' ? 'provisional' : 'auto'),
    reviewNote, reviewedBy: reviewNote ? 'prof-1' : null, reviewedAt: reviewNote ? '2026-11-18T10:00:00.000Z' : null,
    servedAt: '2026-11-18T09:05:00.000Z', answeredAt: '2026-11-18T09:06:00.000Z', questionSource: 'llm',
  };
}

/** Every key at every depth of a JSON value. */
function keysOf(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); keysOf(v, out); }
  }
  return out;
}

/* -------------------------------------------------------------- redaction -- */

describe('redactForStudent, for every kind', () => {
  test('there is a fixture for every kind in questionTypes.js, and each is valid', () => {
    assert.deepEqual(Object.keys(Q).sort(), [...KINDS].sort(), 'a new kind needs a fixture here before it ships');
    for (const kind of KINDS) assert.equal(invalidReason(question(kind)), null, kind);
  });

  for (const kind of KINDS) {
    test(`${kind}: no key, rubric, solution or machine field reaches the student`, () => {
      // A stimulus with a teacher-only field rides on the mcq, to prove the
      // stimulus is rebuilt too rather than copied.
      const q = question(kind, kind === 'mcq'
        ? { stimulus: { kind: 'passage', text: 'Read about cells.', teacherNote: 'KEYSTIM' } } : {});
      const row = answerRow(q, RESPONSE[kind], { reviewNote: 'See me after class.' });
      const view = redactForStudent(row, ROOM);

      const keys = keysOf(view);
      for (const k of FORBIDDEN_KEYS) assert.ok(!keys.has(k), `${kind}: "${k}" reached the student`);
      const text = JSON.stringify(view);
      for (const secret of SECRETS[kind] ?? []) assert.ok(!text.includes(secret), `${kind}: ${secret} leaked`);
      if (row.autoDetail.length > 3) assert.ok(!text.includes(row.autoDetail), `${kind}: the machine's detail leaked`);
    });

    test(`${kind}: the student gets what they were asked, as shown, and what came of it`, () => {
      const q = question(kind);
      const row = answerRow(q, RESPONSE[kind], { reviewNote: 'See me after class.' });
      const view = redactForStudent(row, ROOM);

      // The same rebuild, and the same seed, the live loop used to send it.
      const { _id, ...sent } = forStudent(q, `${row.rollNo}:${q._id}`);
      assert.deepEqual(view.question, sent);
      assert.deepEqual(view.response, RESPONSE[kind]);
      assert.equal(view.correct, row.correct);
      assert.equal(view.score, row.score);
      assert.equal(view.ungraded, kind === 'poll');
      assert.deepEqual(view.review, { status: row.reviewStatus, note: 'See me after class.', reviewedAt: row.reviewedAt });
      assert.deepEqual(view.room, { code: 'EVI001', title: 'Cells', startedAt: ROOM.startedAt });
      assert.equal(view.topic, 'Cells');
      assert.equal(view.level, q.bloom);
      assert.equal(view.kind, kind);
      assert.equal(view.attempt, 1);
      assert.equal(view.final, true);
      assert.equal(view.answeredAt, row.answeredAt);
    });
  }

  test('a professor gets the full snapshot and the machine\'s reading beside the mark', () => {
    const q = question('open');
    const row = { ...answerRow(q, RESPONSE.open), correct: true, score: 0.8, reviewStatus: 'overridden', reviewNote: 'Fair point.' };
    const item = answerItem(row, ROOM, { name: 'Asha' });
    assert.deepEqual(item.snapshot, row.questionSnapshot);
    assert.deepEqual(item.snapshot.rubric, Q.open.rubric);
    assert.deepEqual(item.auto, { correct: false, score: 0, detail: '0/2 rubric points' });
    assert.equal(item.correct, true);
    assert.equal(item.score, 0.8);
    assert.equal(item.review.status, 'overridden');
    assert.equal(item.review.reviewedBy, null);
    assert.deepEqual(item.student, { rollNo: '21CS01', name: 'Asha', accountId: 'acct-1' });
    // The shared fields are the student's own copy, so the two cannot drift.
    const { student, questionId, snapshot, detail, auto, review, servedAt, questionSource, classQuestion, language, ...shared } = item;
    assert.equal(classQuestion, null, 'not a class question vote (Phase 5)');
    assert.equal(language, 'en', 'the language the answer was given in, for staff (Phase 5)');
    const { review: studentReview, ...studentShared } = redactForStudent(row, ROOM);
    assert.deepEqual(shared, studentShared);
    assert.deepEqual({ ...review, reviewedBy: undefined }, { ...studentReview, reviewedBy: undefined });
  });

  test('a snapshot too broken to rebuild comes back as its text, not an error', () => {
    const row = { _id: 'a-x', rollNo: '1', kind: 'match', bloom: 'understand', topic: 'T', questionSnapshot: { id: 'q', text: 'Old item' } };
    assert.deepEqual(shownQuestion(row), { text: 'Old item', bloom: 'understand', topic: 'T', kind: 'match' });
    assert.deepEqual(shownQuestion({ _id: 'a-y', kind: 'mcq' }).text, undefined);
    assert.doesNotThrow(() => redactForStudent({ _id: 'a-z' }, null));
  });
});

/* ------------------------------------------------------------------ topics -- */

describe('topic report', () => {
  const ans = (topic, bloom, correct, extra = {}) => ({ topic, bloom, correct, rollNo: 'S1', final: true, ungraded: false, ...extra });

  test('final graded answers only, with pre-store history standing in, counted by hand', () => {
    const answers = [
      ans('Cells', 'remember', true),
      ans('Cells', 'remember', false),
      ans('Cells', 'understand', true, { rollNo: 'S2' }),
      ans('Cells', 'understand', false, { final: false }), // a retried attempt: never counted
      ans('Energy', 'apply', true),
      ans('Energy', 'understand', null, { ungraded: true, correct: null }), // a poll
      ans('', 'apply', true), // no topic
    ];
    const profiles = [
      {
        rollNo: 'S3',
        history: [
          { topic: 'Energy', bloom: 'apply', correct: false }, // pre-store: counted
          { topic: 'Energy', bloom: 'apply', correct: true, answerId: 'k1' }, // has a row: not counted twice
          { topic: 'Energy', bloom: 'understand', ungraded: true }, // a poll
          { topic: 'Cells', bloom: 'analyze', correct: true }, // not a level
        ],
      },
    ];
    const report = topicReport({ answers, profiles });
    assert.equal(report.source, 'mixed');
    assert.deepEqual(report.counted, { answers: 5, history: 1 });
    assert.equal(report.untagged, 1);
    assert.equal(report.students, 3);
    assert.deepEqual(report.topics.map((t) => t.topic), ['Cells', 'Energy']);

    const [cells, energy] = report.topics;
    assert.deepEqual([cells.seen, cells.correct, cells.students], [3, 2, 2]);
    assert.equal(cells.accuracy, 2 / 3);
    assert.deepEqual(cells.levels.map((l) => l.level), LEVELS);
    assert.deepEqual(cells.levels.find((l) => l.level === 'remember'), { level: 'remember', seen: 2, correct: 1, accuracy: 0.5 });
    assert.deepEqual(cells.levels.find((l) => l.level === 'understand'), { level: 'understand', seen: 1, correct: 1, accuracy: 1 });
    assert.deepEqual(cells.levels.find((l) => l.level === 'create'), { level: 'create', seen: 0, correct: 0, accuracy: null });
    assert.deepEqual([energy.seen, energy.correct, energy.students], [2, 1, 2]);
    assert.deepEqual(energy.levels.find((l) => l.level === 'apply'), { level: 'apply', seen: 2, correct: 1, accuracy: 0.5 });
    assert.deepEqual(energy.levels.find((l) => l.level === 'understand'), { level: 'understand', seen: 0, correct: 0, accuracy: null });
  });

  test('the source says where the numbers came from', () => {
    assert.equal(topicReport({ answers: [ans('A', 'apply', true)] }).source, 'answers');
    assert.equal(topicReport({ profiles: [{ rollNo: 'S', history: [{ topic: 'A', bloom: 'apply', correct: true }] }] }).source, 'history');
    const none = topicReport();
    assert.deepEqual(none, { source: 'none', counted: { answers: 0, history: 0 }, students: 0, untagged: 0, topics: [] });
    // History written since the store carries an answerId, so a room whose rows
    // are all present reads as 'answers', never as 'mixed'.
    const modern = topicReport({ answers: [ans('A', 'apply', true)], profiles: [{ rollNo: 'S1', history: [{ topic: 'A', bloom: 'apply', correct: true, answerId: 'k' }] }] });
    assert.equal(modern.source, 'answers');
    assert.equal(modern.topics[0].seen, 1);
  });

  test('gradedEvidence and topicLevels agree with each other on totals', () => {
    const { rows, counted } = gradedEvidence({ answers: [ans('A', 'apply', true), ans('B', 'create', false), ans('', 'create', true)] });
    const { topics, untagged } = topicLevels(rows);
    assert.equal(counted.answers, topics.reduce((n, t) => n + t.seen, 0) + untagged);
    // Ties on `seen` sort by name, so the order is stable between requests.
    assert.deepEqual(topics.map((t) => t.topic), ['A', 'B']);
  });
});

/* ------------------------------------------------------------- the query -- */

describe('query parsing', () => {
  test('paging is bounded the same way as the review queue', () => {
    assert.deepEqual(pageFrom({}), { limit: 50, offset: 0 });
    assert.deepEqual(pageFrom({ limit: '200', offset: '7' }), { limit: 200, offset: 7 });
    assert.deepEqual(pageFrom({ offset: '100000' }), { limit: 50, offset: 100000 });
    for (const bad of [{ limit: '0' }, { limit: '201' }, { limit: 'x' }, { offset: '-1' }, { offset: '1.5' }, { offset: '100001' }, { limit: ['1', '2'] }]) {
      assert.throws(() => pageFrom(bad), (err) => err.status === 400, JSON.stringify(bad));
    }
  });

  test('levels are the six, spelled the British way', () => {
    assert.equal(levelFrom(''), '');
    assert.equal(levelFrom(' Analyse '), 'analyse');
    assert.throws(() => levelFrom('analyze'), (err) => err.status === 400);
  });

  test('roll numbers compare as the room stored them', () => {
    assert.equal(rollKey('  21cs   01 '), '21CS 01');
    assert.equal(rollKey(undefined), '');
  });
});

/* ------------------------------------------------- one student, many rooms -- */

describe('listStudentAnswers on the in-process store', () => {
  async function fixture() {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'C', kind: 'syllabus', rawText: '', topics: [] });
    const room = (code) => repo.createSession({ code, contentId: content._id, title: `Room ${code}`, status: 'closed' });
    const [r1, r2, r3] = [await room('ROOMAA'), await room('ROOMBB'), await room('ROOMCC')];
    const q = question('mcq');
    const add = async (key, session, { rollNo = 'S-1', accountId = null, accountVerified = false, topic = 'T1', bloom = 'remember', at }) => (await repo.recordAnswer({
      ...answerRow(q, 2, { rollNo }), _id: undefined, sessionId: session._id, answerKey: key, accountId, accountVerified, topic, bloom, answeredAt: at,
    })).answer;
    const rows = {
      a1: await add('k-a1', r1, { at: '2026-11-01T09:00:00.000Z' }),
      // Sent by a phone signed in as acct-1 (decision 7, 0022).
      a2: await add('k-a2', r2, { accountId: 'acct-1', accountVerified: true, topic: 'T2', bloom: 'understand', at: '2026-11-02T09:00:00.000Z' }),
      // Linked to acct-1 by a typed roll number, as every link before 0022 was: unverified.
      a3: await add('k-a3', r2, { rollNo: 'S-OLD', accountId: 'acct-1', at: '2026-11-03T09:00:00.000Z' }),
      a4: await add('k-a4', r2, { accountId: 'acct-2', at: '2026-11-04T09:00:00.000Z' }), // linked to someone else
      a5: await add('k-a5', r3, { at: '2026-11-05T09:00:00.000Z' }), // a room out of scope
      a6: await add('k-a6', r1, { rollNo: 'S-2', at: '2026-11-06T09:00:00.000Z' }), // another student
      a7: await add('k-a7', r1, { bloom: 'apply', at: '2026-11-07T09:00:00.000Z' }),
    };
    return { repo, rooms: [r1, r2], rows };
  }
  const ids = (out) => out.items.map((i) => i.answerId);
  const student = { accountId: 'acct-1', rollNo: 'S-1' };
  // The professor's view: the one that gathers unlinked rows by roll number too.
  const teacher = 'teacher';

  test('a professor: by account or by unlinked roll number, in scope only, newest first, once each', async () => {
    const { repo, rooms, rows } = await fixture();
    const out = await listStudentAnswers(repo, { rooms, student, view: teacher });
    assert.deepEqual(ids(out), [rows.a7, rows.a3, rows.a2, rows.a1].map((a) => a._id));
    assert.equal(out.hasMore, false);
  });

  test('pages follow on without overlap', async () => {
    const { repo, rooms, rows } = await fixture();
    const p1 = await listStudentAnswers(repo, { rooms, student, limit: 2, view: teacher });
    const p2 = await listStudentAnswers(repo, { rooms, student, limit: 2, offset: 2, view: teacher });
    assert.deepEqual(ids(p1), [rows.a7._id, rows.a3._id]);
    assert.equal(p1.hasMore, true);
    assert.deepEqual(ids(p2), [rows.a2._id, rows.a1._id]);
    assert.equal(p2.hasMore, false);
  });

  test('topic, level and room filters', async () => {
    const { repo, rooms, rows } = await fixture();
    const list = (extra) => listStudentAnswers(repo, { rooms, student, view: teacher, ...extra });
    assert.deepEqual(ids(await list({ topic: 'T1' })), [rows.a7._id, rows.a3._id, rows.a1._id]);
    assert.deepEqual(ids(await list({ level: 'understand' })), [rows.a2._id]);
    assert.deepEqual(ids(await list({ code: 'ROOMBB' })), [rows.a3._id, rows.a2._id]);
    // A room outside the scope answers exactly like one that does not exist.
    assert.deepEqual(ids(await list({ code: 'ROOMCC' })), []);
    assert.deepEqual(ids(await list({ code: 'NOSUCH' })), []);
  });

  test('a professor, for a student without an account: only unlinked rows under the roll number', async () => {
    const { repo, rooms, rows } = await fixture();
    const out = await listStudentAnswers(repo, { rooms, student: { accountId: null, rollNo: 'S-1' }, view: teacher });
    assert.deepEqual(ids(out), [rows.a7._id, rows.a1._id]);
  });

  // A roll number is typed on a phone with no sign-in, so an unlinked row under it
  // may be anybody's. Reproduces the review finding: rows a1 and a7 sit under
  // 'S-1' with no account, and before this rule both the student with that roll
  // number and a second account whose roll number differs only in case were
  // handed their written answers.
  // Decision 7 (19 Nov 2026): and of those, only the rows a phone signed in as
  // the student sent. a3 is linked to their account by a typed roll number, the
  // way every link was made before 0022, so it is not theirs to read.
  test('a student reading their own answers gets the verified rows linked to their account, and no others', async () => {
    const { repo, rooms, rows } = await fixture();
    assert.deepEqual(ids(await listStudentAnswers(repo, { rooms, student })), [rows.a2._id]);
    assert.deepEqual(ids(await listStudentAnswers(repo, { rooms, student, view: 'student' })), [rows.a2._id]);
    // The professor still reads both, verified or not.
    assert.deepEqual(ids(await listStudentAnswers(repo, { rooms, student, view: teacher })).filter((id) => [rows.a2._id, rows.a3._id].includes(id)),
      [rows.a3._id, rows.a2._id]);
    // Another account, same roll number once normalised: nothing of S-1's.
    const twin = { accountId: 'acct-9', rollNo: rollKey('s-1') };
    assert.deepEqual(ids(await listStudentAnswers(repo, { rooms, student: twin })), []);
    // No account, no answers: the roll number alone proves nothing.
    assert.deepEqual(ids(await listStudentAnswers(repo, { rooms, student: { accountId: null, rollNo: 'S-1' } })), []);
  });

  test('redacted unless the caller asks for the teacher\'s view', async () => {
    const { repo, rooms } = await fixture();
    const plain = await listStudentAnswers(repo, { rooms, student });
    assert.ok(plain.items.length > 0 && plain.items.every((i) => i.snapshot === undefined && i.auto === undefined));
    assert.equal(plain.items[0].room.code, 'ROOMBB');
    const full = await listStudentAnswers(repo, { rooms, student, view: teacher });
    assert.ok(full.items.every((i) => i.snapshot?.answerIdx === 2 && i.auto));
  });
});

/* ------------------------------------------------------------ the repos -- */

describe('the three repos', () => {
  test('expose the same methods', async () => {
    const { config } = await import('../src/config.js');
    const { createMongoRepo } = await import('../src/repo/mongoRepo.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const names = (r) => Object.keys(r).filter((k) => typeof r[k] === 'function').sort();
      const memory = names(createMemoryRepo());
      assert.deepEqual(names(createMongoRepo()), memory);
      assert.deepEqual(names(createSupabaseRepo()), memory);
    } finally {
      Object.assign(config.supabase, saved);
    }
  });

  // Not a database test: no Supabase is reachable from here. This pins the
  // request the repo builds, so a typo in the filter grammar fails here rather
  // than silently matching nothing in production.
  test('Supabase: the student filter is sent as one quoted PostgREST or-filter', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(new URL(String(url)));
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      const rows = await repo.listAnswers({
        sessionIds: ['11111111-1111-1111-1111-111111111111'],
        student: { accountId: '22222222-2222-2222-2222-222222222222', rollNo: '21CS.01' },
        topic: 'Cells, part 2', bloom: 'analyse', final: true, order: 'desc', limit: 3, offset: 6,
      });
      assert.deepEqual(rows, []);
      const p = seen[0].searchParams;
      assert.equal(seen[0].pathname, '/rest/v1/answers');
      assert.equal(p.get('or'), '(account_id.eq."22222222-2222-2222-2222-222222222222",and(roll_no.eq."21CS.01",account_id.is.null))');
      assert.equal(p.get('topic'), 'eq.Cells, part 2');
      assert.equal(p.get('bloom'), 'eq.analyse');
      assert.equal(p.get('final'), 'eq.true');
      assert.equal(p.get('session_id'), 'in.(11111111-1111-1111-1111-111111111111)');
      assert.equal(p.get('order'), 'answered_at.desc,id.desc');
      assert.equal(p.get('offset'), '6');
      assert.equal(p.get('limit'), '3');
      // A roll number on its own still refuses rows linked to an account.
      await repo.listAnswers({ student: { rollNo: 'R"1\\' } });
      assert.equal(seen[1].searchParams.get('or'), '(and(roll_no.eq."R\\"1\\\\",account_id.is.null))');
      // The queue's page cursor: earlier in (answered_at, id) order.
      await repo.listAnswers({
        kind: 'open', order: 'desc', limit: 2,
        before: { answeredAt: '2026-11-19T10:00:00.123+00:00', id: '33333333-3333-3333-3333-333333333333' },
      });
      assert.equal(seen[2].searchParams.get('or'),
        '(answered_at.lt."2026-11-19T10:00:00.123+00:00",and(answered_at.eq."2026-11-19T10:00:00.123+00:00",id.lt."33333333-3333-3333-3333-333333333333"))');
      assert.equal(seen[2].searchParams.get('order'), 'answered_at.desc,id.desc');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });

  test('Mongo: the student filter is an $or of the account and the unlinked roll number', async () => {
    const { Answer } = await import('../src/models/index.js');
    const { createMongoRepo } = await import('../src/repo/mongoRepo.js');
    const realFind = Answer.find;
    const seen = [];
    const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] };
    Answer.find = (q) => { seen.push(q); return chain; };
    try {
      const repo = createMongoRepo();
      await repo.listAnswers({ sessionIds: ['s1'], student: { accountId: 'acct-1', rollNo: 'S-1' }, topic: 'T', bloom: 'apply' });
      assert.deepEqual(seen[0], {
        sessionId: { $in: ['s1'] },
        $or: [{ accountId: 'acct-1' }, { rollNo: 'S-1', accountId: null }],
        topic: 'T',
        bloom: 'apply',
      });
      assert.deepEqual(await repo.listAnswers({ student: {} }), []);
      assert.equal(seen.length, 1, 'a student with neither id nor roll number is not sent to the database');
      // With the page cursor as well, the two $or are ANDed: a second $or key would replace the first.
      const before = { answeredAt: '2026-11-19T10:00:00.000Z', id: '0123456789abcdef01234567' };
      await repo.listAnswers({ student: { accountId: 'acct-1' }, before });
      assert.deepEqual(seen[1], {
        $and: [
          { $or: [{ accountId: 'acct-1' }] },
          { $or: [{ answeredAt: { $lt: before.answeredAt } }, { answeredAt: before.answeredAt, _id: { $lt: before.id } }] },
        ],
      });
    } finally {
      Answer.find = realFind;
    }
  });

  test('in-process: a `before` cursor pages in (answeredAt, id) order, ties included', async () => {
    const repo = createMemoryRepo();
    const at = ['2026-11-19T09:00:00.000Z', '2026-11-19T09:01:00.000Z', '2026-11-19T09:01:00.000Z', '2026-11-19T09:02:00.000Z'];
    for (const [i, answeredAt] of at.entries()) {
      await repo.recordAnswer({ sessionId: 's1', answerKey: `k${i}`, rollNo: 'R', bloom: 'apply', kind: 'open', answeredAt });
    }
    const all = await repo.listAnswers({ sessionId: 's1', order: 'desc' });
    const walked = [];
    let before;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await repo.listAnswers({ sessionId: 's1', order: 'desc', limit: 1, ...(before ? { before } : {}) });
      if (!page.length) break;
      walked.push(page[0]._id);
      before = { answeredAt: page[0].answeredAt, id: page[0]._id };
    }
    assert.deepEqual(walked, all.map((a) => a._id), 'one at a time, every row once, in the listed order');
    const [tieA, tieB] = all.filter((a) => a.answeredAt === at[1]);
    assert.ok(tieA._id > tieB._id, 'a tie is broken by id, newest-first meaning higher id first');
  });
});
