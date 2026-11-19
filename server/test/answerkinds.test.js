// Batch 9: answer kinds (decisions E3 and E4), unit by unit. E1's closed set is
// tested with the rest of the hub's closed questions in hubFixes.test.js, and
// the whole flow in server/scripts/answerkinds.mjs.
//
// Pinned here:
//   - short and long written answers: validated, short by default with no row
//     rewritten, the limits, the labels, what a phone is told, the marking
//     unchanged, the key fingerprint unchanged;
//   - the drawing kind: where it may be asked, never machine-marked, no retry,
//     what a phone is told (never the reviewer's rubric), what an answer may
//     hold;
//   - the ladder: a drawing waits in the history and counts once marked;
//   - a drawing as it is received: PNG or WebP by its bytes, capped, metadata
//     taken out, idempotent by the device's id, capped per question, and an
//     answer may name only its own sender's drawing;
//   - attainment, item statistics and confidence counts leave a waiting
//     drawing out; the archive keeps the reference and says the picture is not
//     in it; the image rule never serves a drawing to a phone or as a stimulus;
//   - the generator may ask for either length and for a drawing (fixture
//     replies through the real parser).
// Never calls Gemini, Supabase or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { config } from '../src/config.js';
import {
  DRAWING_ONLY, DRAWING_TEXT_WORDS, KINDS, KINDS_FOR_LEVEL, NOT_A_DRAWING, OPEN_LENGTHS, awaitsReview, forStudent, invalidReason,
  kindLabel, kindSuitsLevel, openLength, responseProblem, score, wordCount,
} from '../src/questionTypes.js';
import { LEVELS } from '../src/bloom.js';
import {
  applyAnswer, applyReview, emptyProfile, hydrate, recordAwaiting, retriesFor, rollingAccuracy,
} from '../src/services/mastery.js';
import {
  DRAWING_KEY_TAKEN, DRAWING_LIMIT, DRAWING_MAX_BYTES, DRAWING_NOT_PICTURE, DRAWING_NOT_YOURS, DRAWING_SVG, DRAWING_TOO_BIG,
  MAX_DRAWINGS_PER_QUESTION, awaitingMark, drawingRefusal, keepHubDrawing, keepRoomDrawing, readDrawing,
} from '../src/services/drawings.js';
import { chooseAnswers, formulaOf } from '../src/services/attainment.js';
import { gradedAnswers } from '../src/services/itemStats.js';
import { confidenceCounts } from '../src/services/confidence.js';
import { DRAWINGS_NOTE, buildRoomArchive } from '../src/services/archive.js';
import { servedToPhones, withUpload } from '../src/services/media.js';
import { keyBasis } from '../src/services/checks.js';
import { validateItems } from '../src/services/generate.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';

// Nothing here may reach a model.
config.gemini.apiKey = '';

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const OPEN = { _id: 'q-open', kind: 'open', bloom: 'create', text: 'Design a test.', rubric: ['control group', 'measure change'] };
const DRAW = { _id: 'q-draw', kind: 'drawing', bloom: 'create', text: 'Draw a plant cell.', rubric: ['KEYPOINT wall outside'], allowText: true };

/* ------------------------------------------------------------- PNG bytes -- */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG_TEXT = Buffer.concat([PNG.subarray(0, 33), chunk('tEXt', Buffer.from('Author\0Someone', 'latin1')), PNG.subarray(33)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([26, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.from([13, 0, 0, 0]), Buffer.alloc(14, 1)]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

/* ---------------------------------------------------- short and long (E3) -- */

describe('short and long written answers (E3)', () => {
  test('a length is short or long; none is short, so no existing question changes', () => {
    assert.equal(invalidReason(OPEN), null);
    assert.equal(openLength(OPEN), 'short');
    assert.equal(invalidReason({ ...OPEN, length: 'long' }), null);
    assert.equal(invalidReason({ ...OPEN, length: 'short' }), null);
    assert.match(invalidReason({ ...OPEN, length: 'medium' }), /short or long/);
    assert.match(invalidReason({ ...OPEN, length: 3 }), /short or long/);
    assert.deepEqual([OPEN_LENGTHS.short.maxWords, OPEN_LENGTHS.long.maxWords], [60, 600]);
  });

  test('labels: "Short answer" and "Long answer"; other kinds keep theirs', () => {
    assert.equal(kindLabel(OPEN), 'Short answer');
    assert.equal(kindLabel({ ...OPEN, length: 'long' }), 'Long answer');
    assert.equal(kindLabel({ kind: 'mcq' }), 'Choose one');
    assert.equal(kindLabel(DRAW), 'Draw your answer');
  });

  test('the phone is told the length and the word limit, never the rubric', () => {
    for (const length of ['short', 'long']) {
      const view = forStudent({ ...OPEN, length }, 'seed');
      assert.deepEqual([view.length, view.maxWords], [length, OPEN_LENGTHS[length].maxWords]);
      assert.equal('rubric' in view, false);
      assert.ok(!JSON.stringify(view).includes('control group'));
    }
    assert.equal(forStudent(OPEN, 'seed').length, 'short', 'a question with no length is a short answer');
  });

  test('an answer over the limit is refused with a sentence; at the limit it is taken', () => {
    assert.equal(responseProblem(OPEN, words(60)), null);
    assert.match(responseProblem(OPEN, words(61)), /has 61 words, and this question takes at most 60/);
    assert.equal(responseProblem({ ...OPEN, length: 'long' }, words(600)), null);
    assert.match(responseProblem({ ...OPEN, length: 'long' }, words(601)), /at most 600/);
    assert.equal(wordCount('  a\nb\tc  '), 3);
    assert.equal(responseProblem({ kind: 'mcq' }, 7), null, 'every other kind is taken as it always was');
  });

  test('the marking is unchanged: the same rubric match whatever the length', () => {
    const said = 'Use a control group and measure the change in mass.';
    assert.deepEqual(score({ ...OPEN, length: 'long' }, said), score(OPEN, said));
    assert.equal(score(OPEN, said).correct, true);
  });

  test('the key fingerprint ignores the length and allowText, so no kept check goes stale', () => {
    assert.equal(keyBasis({ ...OPEN, length: 'long' }), keyBasis(OPEN));
    assert.equal(keyBasis({ ...DRAW, allowText: false }), keyBasis({ ...DRAW, allowText: true }));
  });
});

/* ---------------------------------------------------------- drawing (E4) -- */

describe('the drawing kind (E4)', () => {
  test('a kind of its own, asked at Apply, Analyse, Evaluate and Create only, and in no default mix', () => {
    assert.ok(KINDS.includes('drawing'));
    for (const level of LEVELS) {
      assert.equal(kindSuitsLevel('drawing', level), ['apply', 'analyse', 'evaluate', 'create'].includes(level), level);
      assert.notEqual(KINDS_FOR_LEVEL[level][0], 'drawing', `${level}'s default is unchanged`);
    }
  });

  test('valid with only its text; a rubric and allowText are optional and checked', () => {
    assert.equal(invalidReason({ kind: 'drawing', bloom: 'apply', text: 'Draw the circuit.' }), null);
    assert.equal(invalidReason(DRAW), null);
    assert.equal(invalidReason({ ...DRAW, stimulus: { kind: 'passage', text: 'A circuit has a cell and a bulb.' } }), null);
    assert.match(invalidReason({ ...DRAW, rubric: ['a', 'b', 'c', 'd', 'e', 'f'] }), /up to 5/);
    assert.match(invalidReason({ ...DRAW, rubric: [''] }), /empty rubric point/);
    assert.match(invalidReason({ ...DRAW, allowText: 'yes' }), /true or false/);
  });

  test('never marked by the machine, and no retry: there is no mark to be wrong by', () => {
    const graded = score(DRAW, { mediaId: 'abcdef0123456789' });
    assert.deepEqual(graded, { score: null, correct: null, solution: null, detail: 'waits for your professor', awaitingReview: true });
    assert.equal(awaitsReview(DRAW), true);
    assert.equal(awaitsReview(OPEN), false);
    assert.equal(retriesFor(DRAW, 2), 0);
  });

  test('a phone is told whether words may go with it, never the reviewer\'s rubric', () => {
    const view = forStudent(DRAW, 'seed');
    assert.deepEqual([view.allowText, view.maxWords], [true, DRAWING_TEXT_WORDS]);
    assert.equal('rubric' in view, false);
    assert.ok(!JSON.stringify(view).includes('KEYPOINT'));
    const only = forStudent({ ...DRAW, allowText: undefined }, 'seed');
    assert.deepEqual([only.allowText, 'maxWords' in only], [false, false]);
  });

  test('an answer is { mediaId, text? }: anything else is refused, and words only where allowed', () => {
    assert.equal(responseProblem(DRAW, { mediaId: 'abcdef0123456789' }), null);
    assert.equal(responseProblem(DRAW, { mediaId: 'abcdef0123456789', text: 'Wall outside.' }), null);
    for (const bad of [null, 'a drawing', ['x'], {}, { mediaId: 7 }, { mediaId: 'short' }, { mediaId: 'abcdef0123456789', extra: 1 },
      { mediaId: 'abcdef0123456789', text: 3 }]) {
      assert.equal(responseProblem(DRAW, bad), NOT_A_DRAWING, JSON.stringify(bad));
    }
    assert.equal(responseProblem({ ...DRAW, allowText: false }, { mediaId: 'abcdef0123456789', text: 'words' }), DRAWING_ONLY);
    assert.equal(responseProblem({ ...DRAW, allowText: false }, { mediaId: 'abcdef0123456789', text: '   ' }), null, 'blank words are none');
    assert.match(responseProblem(DRAW, { mediaId: 'abcdef0123456789', text: words(601) }), /at most 600/);
  });
});

/* -------------------------------------------------------------- the ladder -- */

describe('a drawing on the ladder: it waits, and counts once a professor marks it', () => {
  const base = () => hydrate(emptyProfile({ sessionId: 's1', rollNo: '21CS01', startLevel: 'create' }));

  test('waiting, it is in the history (not served again) and counted nowhere', () => {
    const { profile } = recordAwaiting(base(), { questionId: 'q-draw', bloom: 'create', kind: 'drawing', answerId: 'k-draw-0001' });
    const entry = profile.history.at(-1);
    assert.deepEqual([entry.questionId, entry.awaitingReview, entry.ungraded], ['q-draw', true, true]);
    assert.deepEqual(profile.levels.create, { seen: 0, correct: 0 });
    assert.equal(rollingAccuracy(profile, 'create'), null);
  });

  test('marked, it becomes a graded entry where it stands, and its level counts it', () => {
    let p = applyAnswer(base(), { questionId: 'q1', bloom: 'create', correct: false, answerId: 'k1' }).profile;
    p = recordAwaiting(p, { questionId: 'q-draw', bloom: 'create', kind: 'drawing', answerId: 'k-draw' }).profile;
    const out = applyReview(p, { answerId: 'k-draw', correct: true, score: 0.9, review: 'overridden' });
    assert.deepEqual([out.found, out.changed], [true, true]);
    const entry = out.profile.history[1];
    assert.deepEqual([entry.correct, entry.score, entry.review, 'awaitingReview' in entry, 'ungraded' in entry], [true, 0.9, 'overridden', false, false]);
    assert.deepEqual(out.profile.levels.create, { seen: 2, correct: 1 });
    assert.deepEqual(rollingAccuracy(out.profile, 'create'), { accuracy: 0.5, n: 2 });
    // Reviewed again (a second override): the ordinary review path, seen unchanged.
    const again = applyReview(out.profile, { answerId: 'k-draw', correct: false, score: 0.2, review: 'overridden' });
    assert.deepEqual(again.profile.levels.create, { seen: 2, correct: 0 });
  });

  test('in a room with redemption, a right drawing pays off the earliest wrong answer once marked', () => {
    let p = applyAnswer(base(), { questionId: 'q1', bloom: 'create', correct: false, answerId: 'k1', redemption: true }).profile;
    p = recordAwaiting(p, { questionId: 'q-draw', bloom: 'create', kind: 'drawing', answerId: 'k-draw' }).profile;
    const out = applyReview(p, { answerId: 'k-draw', correct: true, score: 1, review: 'overridden', redemption: true });
    assert.equal(out.profile.history[0].redeemedBy, 'q-draw');
    assert.equal(out.profile.history[1].redeems, 'q1');
  });
});

/* ----------------------------------------------------- receiving a drawing -- */

describe('a drawing as it is received (services/drawings.js)', () => {
  test('a PNG or WebP by its own bytes, from a data URL, bare base64 or binary; metadata taken out', () => {
    for (const sent of [`data:image/png;base64,${PNG_TEXT.toString('base64')}`, PNG_TEXT.toString('base64'), PNG_TEXT,
      new Uint8Array(PNG_TEXT), PNG_TEXT.buffer.slice(PNG_TEXT.byteOffset, PNG_TEXT.byteOffset + PNG_TEXT.length)]) {
      const read = readDrawing(sent);
      assert.equal(read.ok, true);
      assert.equal(read.mime, 'image/png');
      assert.ok(read.data.equals(PNG), 'the text chunk is taken out, the pixels kept');
      assert.equal(read.bytes, PNG.length);
      assert.match(read.sha256, /^[0-9a-f]{64}$/);
    }
    assert.equal(readDrawing(`data:image/webp;base64,${WEBP.toString('base64')}`).mime, 'image/webp');
  });

  test('a JPEG, an SVG, nothing at all and a picture over the cap are refused, each saying why', () => {
    assert.deepEqual(readDrawing(`data:image/png;base64,${JPEG.toString('base64')}`), { ok: false, message: DRAWING_NOT_PICTURE, status: 415 });
    assert.deepEqual(readDrawing(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), { ok: false, message: DRAWING_SVG, status: 415 });
    for (const nothing of ['', 'not base64 at all!', null, 42, {}]) assert.equal(readDrawing(nothing).ok, false, JSON.stringify(nothing));
    const huge = Buffer.concat([PNG.subarray(0, 33), chunk('zzZz', Buffer.alloc(DRAWING_MAX_BYTES, 1)), PNG.subarray(33)]);
    assert.deepEqual(readDrawing(huge), { ok: false, message: DRAWING_TOO_BIG, status: 413 });
    assert.equal(readDrawing(`data:image/png;base64,${huge.toString('base64')}`).message, DRAWING_TOO_BIG, 'judged before decoding');
  });

  test('a room\'s drawing is kept once per device id, a key used for another question is refused, and the count is capped', async () => {
    const repo = createMemoryRepo();
    const session = { _id: 'room-1', contentId: 'content-1' };
    const keep = (questionId, answerKey, image = PNG) => keepRoomDrawing(repo, { session, rollNo: '21CS01', questionId, answerKey, image });
    const first = await keep('q-a', 'draw-key-0001');
    assert.equal(first.duplicate, false);
    assert.deepEqual([first.media.drawing, first.media.sessionId, first.media.rollNo, first.media.questionId, first.media.alt.length > 0],
      [true, 'room-1', '21CS01', 'q-a', true]);
    const again = await keep('q-a', 'draw-key-0001');
    assert.deepEqual([again.duplicate, again.media._id], [true, first.media._id]);
    await assert.rejects(keep('q-b', 'draw-key-0001'), (err) => err.status === 409 && err.message === DRAWING_KEY_TAKEN);
    await assert.rejects(keep('q-a', 'draw-key-0002', JPEG), (err) => err.status === 415);
    for (let i = 2; i <= MAX_DRAWINGS_PER_QUESTION; i += 1) await keep('q-a', `draw-key-${String(i).padStart(4, '0')}x`);
    await assert.rejects(keep('q-a', 'draw-key-over'), (err) => err.status === 429 && err.message === DRAWING_LIMIT);
    // Another phone's key space is its own.
    const other = await keepRoomDrawing(repo, { session, rollNo: '21CS02', questionId: 'q-a', answerKey: 'draw-key-0001', image: PNG });
    assert.notEqual(other.media._id, first.media._id);
  });

  test('an answer may name only a drawing its own sender kept for that question in that room', async () => {
    const repo = createMemoryRepo();
    const session = { _id: 'room-1', contentId: 'content-1' };
    const { media } = await keepRoomDrawing(repo, { session, rollNo: '21CS01', questionId: 'q-a', answerKey: 'draw-key-0001', image: PNG });
    const hub = await keepHubDrawing(repo, { accountId: 'acc-1', contentId: 'content-1', questionId: 'q-a', answerKey: 'hub-key-0001', image: PNG });
    const ask = (over) => drawingRefusal(repo, { mediaId: media._id, sessionId: 'room-1', rollNo: '21CS01', questionId: 'q-a', ...over });
    assert.equal(await ask({}), null);
    assert.equal(await ask({ questionId: 'Q-A' }), null, 'ids without case');
    for (const over of [{ rollNo: '21CS02' }, { sessionId: 'room-2' }, { questionId: 'q-b' }, { mediaId: 'nothing-here-1234' }, { mediaId: hub.media._id }]) {
      assert.equal(await ask(over), DRAWING_NOT_YOURS, JSON.stringify(over));
    }
    // A professor's own upload is never a drawing.
    const upload = await repo.createMedia({ contentId: 'content-1', mime: 'image/png', bytes: PNG.length, sha256: 'x', data: PNG, alt: 'A leaf' });
    assert.equal(await ask({ mediaId: upload._id }), DRAWING_NOT_YOURS);
  });
});

/* --------------------------------------------- the readers that count marks -- */

describe('a drawing waiting for its mark is counted nowhere; marked, it counts', () => {
  const row = (over = {}) => ({
    _id: 'a1', sessionId: 'room-1', rollNo: '21CS01', questionId: 'q-draw', bloom: 'create', kind: 'drawing', final: true,
    correct: null, score: null, reviewStatus: 'provisional', response: { mediaId: 'm1' }, answeredAt: '2026-11-20T05:00:00.000Z', ...over,
  });

  test('awaitingMark: a final drawing not yet confirmed or overridden', () => {
    assert.equal(awaitingMark(row()), true);
    assert.equal(awaitingMark(row({ reviewStatus: 'overridden', correct: true, score: 1 })), false);
    assert.equal(awaitingMark(row({ final: false })), false);
    assert.equal(awaitingMark(row({ kind: 'open' })), false);
  });

  test('attainment sets it aside under either attempts rule, and counts it once reviewed', () => {
    const { config: cfg } = formulaOf(null);
    for (const attempts of ['final', 'best']) {
      assert.deepEqual(chooseAnswers([row()], { ...cfg, attempts }).chosen, [], attempts);
      const marked = row({ reviewStatus: 'overridden', correct: true, score: 1 });
      assert.deepEqual(chooseAnswers([marked], { ...cfg, attempts }).chosen.map((a) => a._id), ['a1'], attempts);
    }
  });

  test('item statistics and confidence counts leave it out until it is marked', () => {
    assert.deepEqual(gradedAnswers([row()]), []);
    assert.equal(gradedAnswers([row({ reviewStatus: 'overridden', correct: true, score: 1 })]).length, 1);
    const counts = confidenceCounts([row({ confidence: 'sure' })]);
    assert.equal(counts.sure.answers, 0);
  });
});

/* ----------------------------------------------------- archive and images -- */

describe('the archive and the image rule', () => {
  test('a room\'s archive keeps { mediaId, text } and says the pictures are not in it', async () => {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Cells', kind: 'syllabus', rawText: 'Cells', topics: ['Cells'] });
    const session = await repo.createSession({ contentId: content._id, code: 'DRAW01', title: 'Room' });
    const { media } = await keepRoomDrawing(repo, { session, rollNo: '21CS01', questionId: 'q-draw', answerKey: 'draw-key-0001', image: PNG });
    await repo.saveProfile({ sessionId: session._id, rollNo: '21CS01', name: '', history: [] });
    await repo.recordAnswer({
      sessionId: session._id, answerKey: 'draw-key-0001', rollNo: '21CS01', questionId: 'q-draw', contentId: content._id, topic: 'Cells',
      bloom: 'create', kind: 'drawing', questionSnapshot: { id: 'q-draw', ...DRAW }, response: { mediaId: String(media._id), text: 'Wall.' },
      final: true, correct: null, score: null, reviewStatus: 'provisional', detail: 'waits for your professor',
    });
    const { doc, json } = await buildRoomArchive(repo, await repo.getSession(session._id));
    assert.deepEqual(doc.data.drawings, { answers: 1, picturesKept: false, note: DRAWINGS_NOTE });
    assert.ok(json.includes(String(media._id)));
    assert.ok(!json.includes(PNG.toString('base64')));
    // A room with no drawing archives as before: no such field.
    const plain = await repo.createSession({ contentId: content._id, code: 'PLAIN1', title: 'Room' });
    assert.equal('drawings' in (await buildRoomArchive(repo, plain)).doc.data, false);
  });

  test('a drawing is never served to a phone, and never becomes a question\'s picture', async () => {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Cells', kind: 'syllabus', rawText: 'Cells', topics: ['Cells'] });
    const session = await repo.createSession({ contentId: content._id, code: 'DRAW02', title: 'Room' });
    const { media } = await keepRoomDrawing(repo, { session, rollNo: '21CS01', questionId: 'q-draw', answerKey: 'draw-key-0001', image: PNG });
    const url = `/api/media/${media._id}`;
    await repo.insertQuestions([{ contentId: content._id, topic: 'Cells', text: 'Which?', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0,
      bloom: 'remember', status: 'active', stimulus: { kind: 'image', url, alt: 'x' } }]);
    assert.equal(await servedToPhones(repo, await repo.getMedia(media._id)), false, 'even with a running room and a question showing it');
    await assert.rejects(withUpload(repo, { kind: 'image', url, alt: 'A cell' }, content._id), (err) => err.status === 404);
  });
});

/* ------------------------------------------------- the generator (fixtures) -- */

describe('the generator may ask for either length, and for a drawing (fixture replies through the real parser)', () => {
  const plan = { create: { open: 2, drawing: 1 }, apply: { drawing: 1 } };
  const REPLY = [
    { bloom: 'create', kind: 'open', text: 'Design a protocol for reliable delivery over UDP.', rubric: ['acknowledgement numbers', 'retransmission timer'], length: 'long' },
    { bloom: 'create', kind: 'open', text: 'Explain what a checksum does.', rubric: ['detects corruption', 'compares the sums'] },
    { bloom: 'create', kind: 'drawing', text: 'Draw the three-way handshake and label each segment.', rubric: ['SYN segment', 'ACK segment'], allowText: 'true' },
    { bloom: 'apply', kind: 'drawing', text: 'Draw the header of a TCP segment with its fields.', rubric: [] },
  ];

  test('a long answer, a short one (no length), and drawings with and without words', () => {
    const { valid, errors } = validateItems(REPLY, 'TCP', plan);
    assert.deepEqual(errors, []);
    assert.deepEqual(valid.map((q) => [q.kind, q.length ?? null, q.allowText ?? null, q.rubric?.length ?? 0]),
      [['open', 'long', null, 2], ['open', null, null, 2], ['drawing', null, true, 2], ['drawing', null, null, 0]]);
    for (const q of valid) assert.equal(invalidReason(q), null);
    assert.equal(kindLabel(valid[0]), 'Long answer');
    assert.equal(kindLabel(valid[1]), 'Short answer');
  });

  test('a length that is neither is refused, never repaired', () => {
    const { valid, errors } = validateItems([{ ...REPLY[0], length: 'essay' }], 'TCP', plan);
    assert.deepEqual(valid, []);
    assert.match(errors[0], /open length must be short or long/);
  });
});
