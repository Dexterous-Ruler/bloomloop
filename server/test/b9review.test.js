// Batch 9: the fixes from the review of 648bea2, one describe per finding (or
// per pair of findings about one rule; the number is the finding's place in the
// review's list), each re-running the review's own scenario, or the rule behind
// it, against the fixed code.
//
// End to end, over a real server: the screen gate after the replay, the consent
// notice, Safe Exam Browser turned on mid-room, an under-18 mark made during a
// room, a room without a class, the collusion check outside exam mode, the old
// and new signal kinds, pictures the store has no room for, a passage counted
// once (scripts/examguard.mjs); the word limits, an over-limit answer that
// cannot be shortened, a drawing's cache header, the hub's resent answer and
// hints while a room runs, the archive warning at the close, laptop mode and
// drawings (scripts/answerkinds.mjs); a lesson's limits and drawings
// (scripts/lessons.mjs). Never calls Gemini, Supabase or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';

config.gemini.apiKey = '';
config.supabase.url = '';
config.supabase.serviceKey = '';
config.mongoUri = '';

const {
  NOT_WORDS, OPEN_LENGTHS, DRAWING_TEXT_CHARS, MAX_RESPONSE_CHARS, charCount, forStudent, lengthProblem, responseProblem,
  responseTooLarge, score, wordCount,
} = await import('../src/questionTypes.js');
const {
  EXAM_ALIAS, checkTiming, examKind, examMinPlausibleMs, minPlausibleMs, reportFromClient, summarise,
} = await import('../src/services/integrity.js');
const {
  EXAM_HELP, SIGNAL_LIMIT, allowSignal, collusionPairs, examModeFrom, examModeOf, examModeProblem, examSummary, joinPageOk,
  phoneExamMode, sebCheck, sebConfigKeyHash,
} = await import('../src/services/examGuard.js');
const {
  DRAWING_LIMIT, DRAWING_RATE, MAX_DRAWINGS_PER_QUESTION, ROOM_DRAWINGS_FULL, ROOM_DRAWINGS_MAX, ROOM_DRAWING_BYTES,
  drawingAllowed, keepHubDrawing, keepRoomDrawing,
} = await import('../src/services/drawings.js');
const { createMemoryRepo } = await import('../src/repo/memoryRepo.js');
const { syncTopics } = await import('../src/services/hubTopics.js');
const { DRAWINGS_DONE, chooseNext, nextQuestion } = await import('../src/services/hubPractice.js');
const { shownHints } = await import('../src/services/hubTutor.js');
const { CLOSED_SENTENCE } = await import('../src/services/hubClosed.js');
const { lessonQuestion } = await import('../src/services/hubLessons.js');
const { PRACTICE_STORE } = await import('../src/services/hubAttemptBridge.js');
const { DRAWINGS_KEPT_NOTE, DRAWINGS_NOTE, buildRoomArchive } = await import('../src/services/archive.js');
const { OVER_LIMIT_DETAIL, keptNotCounted, keptOverLimit } = await import('../src/services/offline.js');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const words = (n, sep = ' ') => Array.from({ length: n }, (_, i) => `w${i}`).join(sep);
const OPEN = { _id: 'q-open', kind: 'open', bloom: 'create', text: 'Design a test.', rubric: ['control group used', 'measure the change'] };

/* --------------------------------------- 5, 21: the written answer's limit -- */

describe('a written answer is words, held to its limit on the text the scorer reads (5, 21)', () => {
  test('anything but a string is refused: a list held the words round the limit and was still marked', () => {
    const stuffed = `${words(800)} control group used measure the change`;
    assert.equal(responseProblem(OPEN, [stuffed]), NOT_WORDS, 'a one-element list');
    assert.equal(responseProblem(OPEN, { text: stuffed }), NOT_WORDS, 'an object');
    assert.equal(responseProblem(OPEN, 42), NOT_WORDS, 'a number');
    assert.match(responseProblem(OPEN, stuffed), /has 806 words/, 'as a string it was always refused');
    assert.equal(responseProblem(OPEN, 'A control group used, and measure the change.'), null);
    assert.equal(lengthProblem(OPEN, [stuffed]), null, 'the length rule reads words only; the shape rule refuses the rest');
  });

  test('an invisible gap is a gap: words joined by a zero-width space count one by one', () => {
    assert.equal(wordCount(words(61, '​')), 61);
    assert.equal(wordCount(words(61, '⁠')), 61);
    assert.match(responseProblem(OPEN, words(61, '​')), /has 61 words/);
    // Devanagari keeps its joiners inside a word: "क्‍ष" is one word.
    assert.equal(wordCount('क्‍ष त्‌र'), 2);
  });

  test('words run together with punctuation still cost their length: a character cap beside the word limit', () => {
    const dotted = words(300, '.');
    assert.equal(wordCount(dotted), 1);
    assert.ok(charCount(dotted) > OPEN_LENGTHS.short.maxChars);
    assert.match(responseProblem(OPEN, dotted), /characters long, and this question takes at most 900/);
    assert.equal(responseProblem({ ...OPEN, length: 'long' }, dotted), null, 'a long answer takes ten times as much');
    assert.equal(charCount(`  ${'a'.repeat(10)}    ${'b'.repeat(10)}  `), 21, 'padding with spaces costs nothing');
    // An honest 60-word answer in long technical words is inside the cap.
    assert.equal(responseProblem(OPEN, Array.from({ length: 60 }, () => 'photosynthesis').join(' ')), null);
  });

  test('the phone is told the cap; a drawing\'s words have one too; marking a string is unchanged', () => {
    assert.deepEqual([forStudent(OPEN, 's').maxWords, forStudent(OPEN, 's').maxChars], [60, 900]);
    assert.equal(forStudent({ ...OPEN, length: 'long' }, 's').maxChars, 9000);
    const draw = { _id: 'q-d', kind: 'drawing', bloom: 'create', text: 'Draw.', allowText: true };
    assert.equal(forStudent(draw, 's').maxChars, DRAWING_TEXT_CHARS);
    assert.match(responseProblem(draw, { mediaId: 'abcdef1234', text: words(2000, '.') }), /characters long/);
    assert.equal(score(OPEN, 'a control group used to measure the change').correct, true);
  });

  test('no answer of any kind is stored past the size cap', () => {
    assert.equal(responseTooLarge([1, 2, 3]), false);
    assert.equal(responseTooLarge('x'.repeat(MAX_RESPONSE_CHARS)), true, 'quoted, it is two characters more');
    assert.equal(responseTooLarge({ a: 'x'.repeat(MAX_RESPONSE_CHARS - 20) }), false);
    const loop = {};
    loop.self = loop;
    assert.equal(responseTooLarge(loop), true, 'something that is not JSON at all');
  });
});

/* ------------------------------------------------ 14: the passage, once -- */

describe('an exam room counts a passage\'s reading time once per student, not on every question (14)', () => {
  const passage = { kind: 'passage', text: 'p'.repeat(2000) };
  const q = { _id: 'q2', kind: 'mcq', text: 'Which one?', options: ['a', 'b', 'c', 'd'], answerIdx: 0, stimulus: passage };

  test('the first question on a passage carries its reading time; a later one does not', () => {
    assert.equal(examMinPlausibleMs(q), minPlausibleMs(q) + 80_000);
    assert.equal(examMinPlausibleMs(q, { passageRead: true }), minPlausibleMs(q));
  });

  test('an honest student answering the second question in 25 seconds is not flagged', () => {
    const servedAt = '2026-11-20T10:00:00.000Z';
    const t = Date.parse(servedAt);
    const before = { integrity: [] };
    assert.ok(checkTiming(before, q, servedAt, t + 25_000), 'the rule the review read flagged them');
    const now = { integrity: [] };
    assert.equal(checkTiming(now, q, servedAt, t + 25_000, { passageRead: true }), null);
    assert.equal(summarise(now).level, 'clear');
    assert.ok(checkTiming(now, q, servedAt, t + 200, { passageRead: true }), 'faster than its own words is still a signal');
  });
});

/* -------------------------------- 17: one event, whatever name it is sent by -- */

describe('an exam room records the older kinds under their exam names, so one leave is one signal (17)', () => {
  test('each older kind has its exam name; other kinds are as sent', () => {
    assert.deepEqual(EXAM_ALIAS, { hidden: 'visibility_hidden', blurred: 'focus_lost', 'fullscreen-exit': 'fullscreen_exit' });
    assert.equal(examKind('copy_attempt'), 'copy_attempt');
    assert.equal(examKind('paste'), 'paste');
  });

  test('one leave sent both ways is counted once; two leaves are two, and stay clear', () => {
    const p = { integrity: [] };
    const rate = {};
    const send = (kind, at) => {
      const k = examKind(kind);
      if (allowSignal(rate, k, at)) reportFromClient(p, kind, { awayMs: 2000 }, { exam: true });
    };
    send('hidden', 0);
    send('visibility_hidden', 30);
    assert.deepEqual(summarise(p).counts, { visibility_hidden: 1 });
    assert.equal(summarise(p).away, 1);
    send('visibility_hidden', 20_000);
    send('hidden', 20_040);
    assert.equal(summarise(p).away, 2);
    assert.equal(summarise(p).level, 'clear', 'two real leaves are not "note"');
    const outside = { integrity: [] };
    reportFromClient(outside, 'hidden', {});
    assert.equal(outside.integrity[0].kind, 'hidden', 'any other room records the older kind as it always did');
  });
});

/* ----------------------------------------------- 24: the minute slides -- */

describe('the signal rate is thirty in any minute, never sixty across a minute\'s edge (24)', () => {
  test('a burst at the end of one minute and the start of the next is held to thirty together', () => {
    const state = {};
    let taken = 0;
    assert.equal(allowSignal(state, 'k-first', 0), true);
    for (let i = 0; i < 29; i += 1) if (allowSignal(state, `a${i}`, 59_700 + i * 10)) taken += 1;
    for (let i = 0; i < 30; i += 1) if (allowSignal(state, `b${i}`, 60_000 + i * 10)) taken += 1;
    assert.equal(taken, 30, 'twenty-nine, then the one place the first signal left');
    assert.equal(SIGNAL_LIMIT.perMinute, 30);
  });
});

/* ------------------------------------- 3, 13: the help, and SEB's binding -- */

describe('Safe Exam Browser: the API value is for this room\'s join page on the server\'s own origin; a Browser Exam Key may be asked too (3)', () => {
  const KEY = 'c'.repeat(64);
  const BEK = 'd'.repeat(64);
  const m = examModeFrom({ on: true, seb: { required: true, configKeyHashes: [KEY] } });
  const server = 'https://bloomloop.example/socket.io/?EIO=4&transport=polling';
  const api = (url, key = KEY) => ({ url, configKeyHash: sebConfigKeyHash(url, key) });

  test('a value worked out for a page the client chose is not taken, nor one for another room\'s join link', () => {
    assert.equal(sebCheck(m, { api: api('https://not-this-server.example/any/page'), requestUrl: server, code: 'ROOM01' }).ok, false);
    assert.equal(sebCheck(m, { api: api('https://bloomloop.example/any/page'), requestUrl: server, code: 'ROOM01' }).ok, false);
    assert.equal(sebCheck(m, { api: api('https://bloomloop.example/join/ROOM02'), requestUrl: server, code: 'ROOM01' }).ok, false);
    assert.equal(sebCheck(m, { api: api('https://bloomloop.example/join?code=ROOM02'), requestUrl: server, code: 'ROOM01' }).ok, false);
    assert.equal(sebCheck(m, { api: api('https://bloomloop.example/join/ROOM01'), requestUrl: server, code: 'ROOM01' }).ok, true);
    assert.equal(sebCheck(m, { api: api('https://bloomloop.example/join'), requestUrl: server, code: 'ROOM01' }).ok, true);
    assert.equal(joinPageOk('https://bloomloop.example/join/%E0%A4', { origin: 'https://bloomloop.example', code: 'X' }), false);
  });

  test('with a Browser Exam Key listed, the Config Key alone is not enough', () => {
    const both = examModeFrom({ on: true, seb: { required: true, configKeyHashes: [KEY], browserExamKeys: [BEK.toUpperCase()] } });
    assert.deepEqual(both.seb.browserExamKeys, [BEK]);
    assert.deepEqual(examSummary({ classId: 'c1', examMode: both }).seb, { required: true, keys: 1, browserKeys: 1 });
    const page = 'https://bloomloop.example/join/ROOM01';
    assert.equal(sebCheck(both, { api: api(page), requestUrl: server, code: 'ROOM01' }).ok, false);
    assert.equal(sebCheck(both, { api: { ...api(page), browserExamKeyHash: sebConfigKeyHash(page, BEK) }, requestUrl: server, code: 'ROOM01' }).ok, true);
    assert.equal(sebCheck(both, { headerHash: sebConfigKeyHash(server, KEY), requestUrl: server }).ok, false);
    assert.equal(sebCheck(both, {
      headerHash: sebConfigKeyHash(server, KEY), bekHeaderHash: sebConfigKeyHash(server, BEK), requestUrl: server,
    }).ok, true);
    assert.throws(() => examModeFrom({ on: true, seb: { browserExamKeys: ['short'] } }), (err) => err.status === 400);
  });

  test('the help says plainly what SEB, fullscreen and screen sharing cannot stop (3, 13)', () => {
    assert.match(EXAM_HELP.seb, /not a lock/);
    assert.match(EXAM_HELP.seb, /configuration file/);
    assert.ok(!/Every other browser is turned away/.test(EXAM_HELP.seb), 'the old promise is gone');
    assert.match(EXAM_HELP.fullscreen, /browser someone has changed can skip it/);
    assert.match(EXAM_HELP.screenShare, /takes the laptop's word/);
    assert.match(EXAM_HELP.under18, /without a class has no list/);
  });
});

/* ------------------------------------------- 4: a room without a class -- */

describe('nothing that watches runs in a room without a class, which can mark nobody under 18 (4)', () => {
  const WATCH = { on: true, fullscreen: true, screenShare: true, snapshotSeconds: 30 };

  test('opening or changing to it is refused with a sentence; the copy guard alone is not', () => {
    assert.match(examModeProblem(examModeFrom(WATCH), { classId: null }), /need a class/);
    assert.equal(examModeProblem(examModeFrom(WATCH), { classId: 'c1' }), null);
    assert.equal(examModeProblem(examModeFrom({ on: true }), { classId: null }), null);
    assert.equal(examModeProblem(examModeFrom({ on: true, fullscreen: true }), { classId: null }) !== null, true);
  });

  test('a row that says so anyway runs without it, and a phone is asked for none of it', () => {
    const room = { _id: 'r1', code: 'NOCLAS', examMode: WATCH };
    const m = examModeOf(room);
    assert.deepEqual([m.on, m.fullscreen, m.screenShare, m.snapshotSeconds], [true, false, false, 0]);
    const phone = phoneExamMode(room);
    assert.deepEqual([phone.fullscreen, phone.screenShare, phone.snapshotSeconds, phone.copyGuard], [false, false, 0, true]);
    assert.equal(examModeOf({ ...room, classId: 'c1' }).screenShare, true);
  });
});

/* --------------------------------- 19: close timing from the phone's time -- */

describe('the collusion check times an answer by when it was given, not when an outbox flushed it (19)', () => {
  const Q = (n) => ({ id: `0000000000000000000000q${n}`.slice(-24), kind: 'mcq', options: ['w', 'x', 'y', 'z'], answerIdx: 0 });
  const at = (minutes) => new Date(Date.parse('2026-11-20T10:00:00Z') + minutes * 60_000).toISOString();
  const row = (rollNo, n, device, arrived) => ({
    rollNo, questionId: Q(n).id, questionSnapshot: Q(n), kind: 'mcq', bloom: 'apply', topic: 'T', response: 2, correct: false,
    final: true, deviceAnsweredAt: device, answeredAt: arrived,
  });

  test('two students twenty minutes apart, delivered together, are not a close-timing pair', () => {
    const answers = [
      row('A', 1, at(1), at(40)), row('A', 2, at(5), at(40.01)), row('A', 3, at(9), at(40.02)),
      row('B', 1, at(20), at(40.03)), row('B', 2, at(25), at(40.04)), row('B', 3, at(30), at(40.05)),
    ];
    assert.deepEqual(collusionPairs({ answers }), []);
    const live = answers.map(({ deviceAnsweredAt: _d, ...a }) => a);
    assert.equal(collusionPairs({ answers: live }).length, 1, 'the rule the review read listed them');
  });

  test('a phone clock ahead of the server cannot move an answer later than it arrived', () => {
    const answers = [
      row('A', 1, at(90), at(1)), row('A', 2, at(90), at(2)), row('A', 3, at(90), at(3)),
      row('B', 1, null, at(1.2)), row('B', 2, null, at(2.2)), row('B', 3, null, at(3.2)),
    ];
    assert.equal(collusionPairs({ answers })[0]?.matches, 3);
  });
});

/* ------------------------------- 1: a room's drawings, and the rate per phone -- */

describe('a room keeps at most so many drawings, counted before a picture is decoded; a phone sends at most so many a minute (1)', () => {
  const session = { _id: 'room-1', contentId: 'content-1' };
  const seed = (repo, n, { bytes = 100, rollNo = 'FL000' } = {}) => Promise.all(Array.from({ length: n }, (_, i) => repo.createDrawing({
    ownerId: null, accountId: null, contentId: 'content-1', sessionId: 'room-1', rollNo, questionId: `q-${i % 3}`,
    answerKey: `seed-${rollNo}-${i}`, mime: 'image/png', bytes, sha256: 'x', data: Buffer.from('x'), alt: '',
  })));

  test('past the room\'s count, a drawing from a new roll number is refused, before its bytes are read', async () => {
    const repo = createMemoryRepo();
    await seed(repo, ROOM_DRAWINGS_MAX);
    await assert.rejects(
      keepRoomDrawing(repo, { session, rollNo: 'FL999', questionId: 'q-0', answerKey: 'fresh-key-0001', image: 'not a picture at all' }),
      (err) => err.status === 429 && err.message === ROOM_DRAWINGS_FULL,
    );
    const held = await repo.getDrawingByKey({ sessionId: 'room-1', rollNo: 'FL000', answerKey: 'seed-FL000-0' });
    const again = await keepRoomDrawing(repo, { session, rollNo: 'FL000', questionId: 'q-0', answerKey: 'seed-FL000-0', image: PNG });
    assert.deepEqual([again.duplicate, String(again.media._id)], [true, String(held._id)], 'a resend of one already kept is still answered');
  });

  test('past the room\'s weight, likewise; under it, a drawing is kept', async () => {
    const repo = createMemoryRepo();
    await seed(repo, 2, { bytes: ROOM_DRAWING_BYTES / 2 - 10 });
    await assert.rejects(keepRoomDrawing(repo, { session, rollNo: 'FL001', questionId: 'q-0', answerKey: 'fresh-key-0002', image: PNG.toString('base64').repeat(4) }),
      (err) => err.message === ROOM_DRAWINGS_FULL);
    const room = createMemoryRepo();
    const kept = await keepRoomDrawing(room, { session, rollNo: 'FL001', questionId: 'q-0', answerKey: 'fresh-key-0003', image: PNG });
    assert.equal(kept.duplicate, false);
  });

  test('a roll number\'s own cap per question is counted before decoding too', async () => {
    const repo = createMemoryRepo();
    for (let i = 0; i < MAX_DRAWINGS_PER_QUESTION; i += 1) {
      await repo.createDrawing({
        ownerId: null, contentId: 'content-1', sessionId: 'room-1', rollNo: 'FL000', questionId: 'q-a', answerKey: `own-${i}`,
        mime: 'image/png', bytes: 10, sha256: 'x', data: Buffer.from('x'), alt: '',
      });
    }
    await assert.rejects(keepRoomDrawing(repo, { session, rollNo: 'FL000', questionId: 'Q-A', answerKey: 'own-over-0001', image: 'junk' }),
      (err) => err.status === 429 && err.message === DRAWING_LIMIT);
  });

  test('one connection: DRAWING_RATE a minute, then room again as the minute slides', () => {
    const state = {};
    let ok = 0;
    for (let i = 0; i < DRAWING_RATE + 5; i += 1) if (drawingAllowed(state, 1000 + i)) ok += 1;
    assert.equal(ok, DRAWING_RATE);
    assert.equal(drawingAllowed(state, 61_000), true);
  });
});

/* ------------------------------------ 15: the hub's drawings at their cap -- */

describe('practice never gets stuck on a drawing the student has drawn as often as it keeps (15)', () => {
  const PROF = 'a0000000-0000-4000-8000-00000000000a';
  const asha = { id: 'acc-asha', role: 'student', reportsTo: PROF, rollNo: '21CS01', active: true };

  async function fixture() {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ courseName: 'Biology', section: 'A', ownerId: PROF });
    await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }]);
    const content = await repo.createContent({ title: 'Cells', kind: 'syllabus', rawText: 'Cells.', topics: ['Cells'], ownerId: PROF });
    await syncTopics(repo, content);
    await repo.placeClassChapter({ classId: cls._id, contentId: content._id, unitId: null, position: 1 });
    const [cells] = await repo.listChapterTopics(content._id);
    const [mcq, draw] = await repo.insertQuestions([
      { contentId: content._id, topic: 'Cells', text: 'Which organelle?', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0,
        bloom: 'remember', status: 'active', source: 'teacher' },
      { contentId: content._id, topic: 'Cells', text: 'Draw a cell.', kind: 'drawing', bloom: 'create', status: 'active', source: 'teacher' },
    ]);
    return { repo, content, cells, mcq, draw };
  }

  test('once at the cap, the drawing is not served; with nothing else left, practice says why', async () => {
    const { repo, content, cells, mcq, draw } = await fixture();
    for (let i = 0; i < MAX_DRAWINGS_PER_QUESTION; i += 1) {
      await keepHubDrawing(repo, { accountId: asha.id, contentId: String(content._id), questionId: String(draw._id), answerKey: `hub-draw-${i}x`, image: PNG });
    }
    for (let i = 0; i < 6; i += 1) {
      const out = await nextQuestion(repo, asha, { topicIds: String(cells._id) });
      assert.equal(out.question?._id, String(mcq._id), `turn ${i}: the drawing at its cap is not served`);
    }
    await repo.updateQuestion(mcq._id, { status: 'discarded' });
    const none = await nextQuestion(repo, asha, { topicIds: String(cells._id) });
    assert.deepEqual([none.question, none.message], [null, DRAWINGS_DONE]);
    await assert.rejects(keepHubDrawing(repo, { accountId: asha.id, contentId: String(content._id), questionId: String(draw._id), answerKey: 'hub-draw-over', image: 'junk' }),
      (err) => err.status === 429, 'counted before the picture is read');
  });

  test('an unmarked drawing comes back after right answers, not with the wrong ones', () => {
    const c = (id) => ({ q: { _id: id, bloom: 'apply' }, entry: {} });
    const at = (m) => new Date(Date.parse('2026-11-20T10:00:00Z') + m * 60_000).toISOString();
    const mine = [
      { _id: '1', questionId: 'draw', createdAt: at(0), correct: null },
      { _id: '2', questionId: 'right', createdAt: at(1), correct: true },
      { _id: '3', questionId: 'last', createdAt: at(2), correct: true },
    ];
    const pick = chooseNext([c('draw'), c('right'), c('last')], { skillOf: () => 0, difficultyOf: () => 0, mine });
    assert.equal(pick.q._id, 'right', 'the right answer seen longest ago, ahead of the drawing seen earlier still');
  });
});

/* --------------------------------- 8: hints while a running room holds it -- */

describe('the hints opened before stay hidden while a running room holds the question (8)', () => {
  test('shownHints says why and shows none; once the room is closed it shows them again', async () => {
    const PROF = 'a0000000-0000-4000-8000-00000000000a';
    const asha = { id: 'acc-asha', role: 'student', reportsTo: PROF, rollNo: '21CS01', active: true };
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Cells', kind: 'syllabus', rawText: 'Cells.', topics: ['Cells'], ownerId: PROF });
    const [q] = await repo.insertQuestions([{ contentId: content._id, topic: 'Cells', text: 'Which?', kind: 'mcq', options: ['a', 'b', 'c', 'd'],
      answerIdx: 0, bloom: 'remember', status: 'active', source: 'teacher' }]);
    await repo.addHintView({ accountId: asha.id, clientAttemptId: 'attempt-0001', questionId: String(q._id), position: 1, kind: 'hint',
      itemId: 'h1', plan: { items: [], why: '' }, mode: 'practice' });
    const room = await repo.createSession({ contentId: content._id, code: 'HOLD01', title: 'Room', status: 'open', questionIds: [String(q._id)] });
    const held = await shownHints(repo, { account: asha, question: q, attemptId: 'attempt-0001' });
    assert.deepEqual([held.held, held.hints.length, held.remaining, held.note], [true, 0, 0, CLOSED_SENTENCE.room]);
    await repo.updateSession(room._id, { status: 'closed', closedAt: new Date().toISOString() });
    const open = await shownHints(repo, { account: asha, question: q, attemptId: 'attempt-0001' });
    assert.equal(open.held, undefined);
  });
});

/* ------------------------------------------ 20: a lesson and a drawing -- */

describe('a lesson never asks a drawing, and its store never keeps one as a wrong answer (20)', () => {
  const lesson = { steps: [{ type: 'questions', questionIds: ['q-draw', 'q-mcq'] }] };
  const bank = [
    { _id: 'q-draw', kind: 'drawing', status: 'active', bloom: 'apply' },
    { _id: 'q-mcq', kind: 'mcq', status: 'active', bloom: 'remember' },
  ];

  test('a question edited into a drawing after the lesson listed it is not asked; an answer to it reaches the route to be refused', () => {
    assert.equal(lessonQuestion(lesson, 'q-draw', bank), null);
    assert.equal(lessonQuestion(lesson, 'q-mcq', bank)?._id, 'q-mcq');
    assert.equal(lessonQuestion(lesson, 'q-draw', bank, { answered: true })?._id, 'q-draw');
  });

  test('the attempt store refuses a drawing in a sentence, storing nothing', async () => {
    const repo = createMemoryRepo();
    await assert.rejects(PRACTICE_STORE.record(repo, {
      accountId: 'acc-1', attemptId: 'lesson-0001', kind: 'drawing', bloom: 'apply', questionId: 'q-draw', response: { mediaId: 'x' },
      correct: null, score: null,
    }), (err) => err.status === 409 && /answered with a drawing/.test(err.message));
    assert.equal(await repo.getHubAttemptByKey('acc-1', 'lesson-0001'), null);
  });
});

/* ------------------------- 7: a copy of a room that still runs says so -- */

describe('laptop mode\'s copy of a room says where its drawings are; a deleted room\'s says they went with it (7)', () => {
  test('the note follows the archive\'s purpose', async () => {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Cells', kind: 'syllabus', rawText: 'Cells', topics: ['Cells'] });
    const session = await repo.createSession({ contentId: content._id, code: 'LAPT01', title: 'Room' });
    const { media } = await keepRoomDrawing(repo, { session, rollNo: '21CS01', questionId: 'q-draw', answerKey: 'draw-key-0001', image: PNG });
    await repo.saveProfile({ sessionId: session._id, rollNo: '21CS01', name: '', history: [] });
    await repo.recordAnswer({
      sessionId: session._id, answerKey: 'draw-key-0001', rollNo: '21CS01', questionId: 'q-draw', contentId: content._id, topic: 'Cells',
      bloom: 'create', kind: 'drawing', questionSnapshot: { id: 'q-draw', kind: 'drawing', text: 'Draw.' },
      response: { mediaId: String(media._id) }, final: true, correct: null, score: null, reviewStatus: 'provisional', detail: 'waits',
    });
    const room = await repo.getSession(session._id);
    assert.equal((await buildRoomArchive(repo, room)).doc.data.drawings.note, DRAWINGS_NOTE);
    assert.equal((await buildRoomArchive(repo, room, { deleting: false })).doc.data.drawings.note, DRAWINGS_KEPT_NOTE);
    assert.ok(!/deleted/.test(DRAWINGS_KEPT_NOTE));
  });
});

/* ----------------------- 18: an over-limit answer kept, never refused, when it cannot be shortened -- */

describe('an answer kept for being over the limit is one of the rows every report leaves out (18)', () => {
  test('keptNotCounted and keptOverLimit read its detail', () => {
    const row = { final: false, detail: OVER_LIMIT_DETAIL };
    assert.equal(keptOverLimit(row), true);
    assert.equal(keptNotCounted(row), true);
    assert.equal(keptOverLimit({ ...row, final: true }), false);
  });
});
