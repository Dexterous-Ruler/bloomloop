// Batch 9, decision E5 (and E7): exam integrity, the pure half.
//
// Each rule that can name a student is tested on its negative side as hard as on
// its positive one, for the reason services/integrity.js gives: an invented
// signal is an accusation, and it looks exactly as confident as a true one. The
// clock is handed in everywhere, so nothing here waits.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  COLLUSION,
  EXAM_HELP,
  SIGNAL_LIMIT,
  SNAPSHOT_KEEP_MS,
  SNAPSHOT_MAX_BYTES,
  allowSignal,
  collusionPairs,
  createSnapshotStore,
  examModeFrom,
  examModeOf,
  examSummary,
  handshakeUrl,
  phoneExamMode,
  publicExamMode,
  sebCheck,
  sebConfigKeyHash,
  snapshotExpired,
  snapshotFrom,
  snapshotOverdue,
  wholeJpeg,
} from '../src/services/examGuard.js';
import {
  EXAM_OBSERVED,
  EXAM_REPORTED,
  OBSERVED,
  REPORTED,
  checkTiming,
  examMinPlausibleMs,
  minPlausibleMs,
  noteScreen,
  noteSecondDevice,
  noteSnapshotMissing,
  reportFromClient,
  reportable,
  summarise,
} from '../src/services/integrity.js';

const KEY_A = 'a'.repeat(64);
const KEY_B = '0123456789abcdef'.repeat(4);
const EXAM = { on: true, fullscreen: true, screenShare: true, snapshotSeconds: 30, seb: { required: true, configKeyHashes: [KEY_A] } };
const room = (examMode) => ({ _id: 'r1', code: 'EXAM01', examMode });

/* ------------------------------------------------------------ the setting -- */

test('the setting: left out means none, and a room without one reads as off', () => {
  assert.equal(examModeFrom(undefined), null);
  assert.equal(examModeFrom(null), null);
  assert.equal(examModeOf({}).on, false);
  assert.equal(phoneExamMode({}), null);
  assert.equal(publicExamMode({}), null);
});

test('the setting: checked, not clamped, and normalised', () => {
  const ok = examModeFrom({ on: true, seb: { required: true, configKeyHashes: [` ${KEY_A.toUpperCase()} `, KEY_A] } });
  assert.deepEqual(ok, { on: true, fullscreen: false, screenShare: false, snapshotSeconds: 0, seb: { required: true, configKeyHashes: [KEY_A] } });
  for (const [bad, why] of [
    [[], 'not an object'],
    [{ fullscreen: true }, 'on missing'],
    [{ on: 'yes' }, 'on not a boolean'],
    [{ on: true, fullscreen: 1 }, 'fullscreen not a boolean'],
    [{ on: true, screenShare: true, snapshotSeconds: 45 }, '45 seconds is not offered'],
    [{ on: true, snapshotSeconds: 30 }, 'pictures without screen share'],
    [{ on: true, seb: { required: true } }, 'SEB required with no key'],
    [{ on: true, seb: { configKeyHashes: ['abc'] } }, 'a key that is not 64 hex characters'],
    [{ on: true, seb: { configKeyHashes: Array.from({ length: 6 }, (_, i) => String(i).repeat(64)) } }, 'six keys'],
  ]) {
    assert.throws(() => examModeFrom(bad), (err) => err.status === 400, why);
  }
});

test('the setting: a hand-edited stored value cannot switch on half a setting', () => {
  assert.equal(examModeOf(room({ on: true, snapshotSeconds: 30 })).on, false);
  assert.equal(examModeOf(room('on')).on, false);
  assert.equal(examModeOf(room(EXAM)).snapshotSeconds, 30);
});

test('what a phone is told: what to enforce and a notice, never the Safe Exam Browser keys', () => {
  const phone = phoneExamMode(room(EXAM));
  assert.equal(phone.copyGuard, true);
  assert.equal(phone.watermark, true);
  assert.equal(phone.fullscreen, true);
  assert.equal(phone.screenShare, true);
  assert.equal(phone.snapshotSeconds, 30);
  assert.equal(phone.snapshotMaxBytes, SNAPSHOT_MAX_BYTES);
  assert.equal(phone.sebRequired, true);
  assert.equal(phone.watched, true);
  assert.match(phone.notice, /every 30 seconds/);
  assert.match(phone.notice, /deleted two hours after the room closes/);
  assert.match(phone.notice, /not as proof/);
  const said = JSON.stringify([phone, publicExamMode(room(EXAM))]);
  assert.ok(!said.includes(KEY_A), 'a key reached a phone');
  assert.ok(!/configKey|\/api\/|PATCH|examMode|snapshotSeconds/.test(phone.notice), 'the notice names an API detail');
  assert.equal('watched' in publicExamMode(room(EXAM)), false);
});

test('under 18: nothing that watches is asked, and the phone is told so; the copy guard and watermark stay', () => {
  const phone = phoneExamMode(room(EXAM), { minor: true });
  assert.equal(phone.fullscreen, false);
  assert.equal(phone.screenShare, false);
  assert.equal(phone.snapshotSeconds, 0);
  assert.equal(phone.watched, false);
  assert.equal(phone.copyGuard, true);
  assert.equal(phone.watermark, true);
  assert.match(phone.notice, /not asked for fullscreen or screen sharing, and nothing about how you use the page is recorded/);
  assert.ok(!/18|age|minor/i.test(phone.notice), 'the notice says why, which a classmate typing the roll number would read');
});

test('the help is honest about what a web page cannot do', () => {
  assert.match(EXAM_HELP.honesty, /No website can stop screenshots, Google Lens/);
  assert.match(EXAM_HELP.honesty, /truly lock/);
  assert.match(EXAM_HELP.screenshots, /cannot be seen at all/);
  assert.match(EXAM_HELP.snapshots, /never goes into the archive, the CSV or any report/);
  assert.deepEqual(examSummary(room(EXAM)).seb, { required: true, keys: 1 });
  assert.ok(!JSON.stringify(examSummary(room(EXAM))).includes(KEY_A));
});

/* ------------------------------------------------------- Safe Exam Browser -- */

test('SEB: the Config Key hash is SHA-256 of the URL without its fragment, then the key, in hex', () => {
  const url = 'https://bloomloop.example/socket.io/?EIO=4&transport=websocket';
  // Worked by hand with the platform's own SHA-256, written out once so a
  // change to the function cannot pass by changing both sides.
  const expected = crypto.createHash('sha256').update(url + KEY_A).digest('hex');
  assert.equal(sebConfigKeyHash(url, KEY_A), expected);
  assert.equal(sebConfigKeyHash(`${url}#top`, KEY_A), expected);
  // One fixed vector: sha256("https://bloomloop.example/join?code=EXAM01" + 64 x "a").
  assert.equal(sebConfigKeyHash('https://bloomloop.example/join?code=EXAM01#start', KEY_A),
    '22799f205aa8c47c34901f16f3508c61decfa55d5824c4853daab3a78aeb63ca');
  assert.notEqual(sebConfigKeyHash(url, KEY_B), expected);
});

test('SEB: a room that requires it takes a matching header or a matching API value, and nothing else', () => {
  const m = examModeFrom(EXAM);
  const requestUrl = 'http://127.0.0.1:5050/socket.io/?EIO=4&transport=websocket';
  const good = sebConfigKeyHash(requestUrl, KEY_A);
  assert.deepEqual(sebCheck(m, { headerHash: good, requestUrl }), { ok: true, via: 'header' });
  assert.deepEqual(sebCheck(m, { headerHash: good.toUpperCase(), requestUrl }), { ok: true, via: 'header' });
  assert.equal(sebCheck(m, {}).ok, false, 'no evidence at all');
  assert.equal(sebCheck(m, { headerHash: sebConfigKeyHash(requestUrl, KEY_B), requestUrl }).ok, false, 'another configuration');
  assert.equal(sebCheck(m, { headerHash: good, requestUrl: `${requestUrl}&t=1` }).ok, false, 'a value for another URL');
  assert.equal(sebCheck(m, { headerHash: 'not-hex', requestUrl }).ok, false);
  const page = 'https://bloomloop.example/join?code=EXAM01';
  const api = { url: `${page}#q`, configKeyHash: sebConfigKeyHash(page, KEY_A) };
  assert.deepEqual(sebCheck(m, { api }), { ok: true, via: 'api' });
  assert.deepEqual(sebCheck(m, { api, origin: 'https://bloomloop.example' }), { ok: true, via: 'api' });
  assert.equal(sebCheck(m, { api, origin: 'https://elsewhere.example' }).ok, false, 'a page on another origin');
  assert.equal(sebCheck(m, { api: { url: 'javascript:alert(1)', configKeyHash: sebConfigKeyHash('javascript:alert(1)', KEY_A) } }).ok, false);
  // Not required, or exam mode off: always let in.
  assert.deepEqual(sebCheck(examModeFrom({ on: true }), {}), { ok: true, via: 'off' });
  assert.deepEqual(sebCheck(examModeOf({}), {}), { ok: true, via: 'off' });
});

test('SEB: the request URL is rebuilt as the browser asked for it, behind a proxy too', () => {
  assert.equal(handshakeUrl({ headers: { host: '127.0.0.1:5050' }, url: '/socket.io/?EIO=4' }), 'http://127.0.0.1:5050/socket.io/?EIO=4');
  assert.equal(handshakeUrl({ headers: { host: 'internal:8000', 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'bloomloop.example' }, url: '/socket.io/?EIO=4' }),
    'https://bloomloop.example/socket.io/?EIO=4');
  assert.equal(handshakeUrl({ headers: {}, url: '/x' }), null);
});

/* ------------------------------------------------------------------- rate -- */

test('rate: one of each kind a second, thirty a minute, and a fresh minute starts again', () => {
  const state = {};
  const t0 = 1_000_000;
  assert.equal(allowSignal(state, 'copy_attempt', t0), true);
  assert.equal(allowSignal(state, 'copy_attempt', t0 + 999), false, 'the same kind inside a second');
  assert.equal(allowSignal(state, 'context_menu', t0 + 10), true, 'another kind is its own');
  assert.equal(allowSignal(state, 'copy_attempt', t0 + 1000), true);
  let allowed = 3;
  for (let i = 0; i < 100; i += 1) if (allowSignal(state, `k${i}`, t0 + 2000 + i)) allowed += 1;
  assert.equal(allowed, SIGNAL_LIMIT.perMinute);
  assert.equal(allowSignal(state, 'focus_lost', t0 + 59_000), false, 'the minute is spent');
  assert.equal(allowSignal(state, 'focus_lost', t0 + 60_000), true, 'a new minute');
});

/* -------------------------------------------------------- screen pictures -- */

const seg = (marker, body) => {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(b.length + 2, 2);
  return Buffer.concat([head, b]);
};
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const APP0 = seg(0xe0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]));
const EXIF = seg(0xe1, 'Exif\0\0GPS 18.52N 73.85E owner Priya');
const COM = seg(0xfe, 'taken on Priya\'s laptop');
const DQT = seg(0xdb, Buffer.alloc(65, 1));
const SOF = seg(0xc0, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0]));
const DHT = seg(0xc4, Buffer.alloc(20, 0));
const SOS = seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
const SCAN = Buffer.concat([Buffer.from('SCREEN-PIXELS', 'latin1'), Buffer.from([0xff, 0x00, 0x12])]);
const PICTURE = Buffer.concat([SOI, APP0, EXIF, COM, DQT, SOF, DHT, SOS, SCAN, EOI]);

test('pictures: a whole JPEG, its metadata gone, its pixels untouched', () => {
  const got = snapshotFrom(PICTURE);
  assert.equal(got.ok, true);
  assert.deepEqual(got.jpeg, Buffer.concat([SOI, APP0, DQT, SOF, DHT, SOS, SCAN, EOI]));
  assert.ok(!got.jpeg.includes('Priya'), 'metadata survived');
  assert.ok(got.jpeg.includes('SCREEN-PIXELS'));
  // As base64 and as a data URL, the way a canvas hands one over.
  assert.equal(snapshotFrom(PICTURE.toString('base64')).ok, true);
  assert.equal(snapshotFrom(`data:image/jpeg;base64,${PICTURE.toString('base64')}`).ok, true);
  assert.equal(snapshotFrom(new Uint8Array(PICTURE)).ok, true);
});

test('pictures: too big, not a JPEG, or not a whole one, is refused', () => {
  const big = Buffer.concat([SOI, DQT, SOF, DHT, SOS, Buffer.alloc(SNAPSHOT_MAX_BYTES, 0x11), EOI]);
  assert.deepEqual(snapshotFrom(big), { ok: false, reason: 'size' });
  assert.deepEqual(snapshotFrom(big.toString('base64')), { ok: false, reason: 'size' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  assert.deepEqual(snapshotFrom(png), { ok: false, reason: 'type' });
  assert.deepEqual(snapshotFrom(Buffer.from('<svg onload="x()"></svg>')), { ok: false, reason: 'type' });
  assert.deepEqual(snapshotFrom(Buffer.concat([SOI, DQT, SOF])), { ok: false, reason: 'shape' }, 'cut short');
  assert.deepEqual(snapshotFrom(Buffer.concat([SOI, DQT, SOS, SCAN, EOI])), { ok: false, reason: 'shape' }, 'no frame header');
  assert.deepEqual(snapshotFrom(Buffer.concat([SOI, Buffer.from([0xff, 0xe0, 0x00]), Buffer.from('a payload')])), { ok: false, reason: 'shape' });
  assert.deepEqual(snapshotFrom(Buffer.concat([SOI, Buffer.from('a payload after the start')])), { ok: false, reason: 'type' });
  assert.deepEqual(snapshotFrom(null), { ok: false, reason: 'shape' });
  assert.deepEqual(snapshotFrom('not base64 at all!'), { ok: false, reason: 'shape' });
  assert.equal(wholeJpeg(Buffer.concat([PICTURE, Buffer.from('tail')])), false);
});

test('pictures: one per interval (less two seconds of slack), the newest kept, a fixed clock', () => {
  const store = createSnapshotStore();
  const t0 = 5_000_000;
  assert.equal(store.accepts('r1', 'A1', 30, t0), true);
  store.put('r1', 'A1', Buffer.from('one'), t0);
  assert.equal(store.accepts('r1', 'A1', 30, t0 + 27_999), false);
  assert.equal(store.accepts('r1', 'A1', 30, t0 + 28_000), true);
  assert.equal(store.accepts('r1', 'B2', 30, t0 + 1), true, 'another student is their own');
  store.put('r1', 'A1', Buffer.from('two'), t0 + 30_000);
  assert.equal(store.latest('r1', 'A1').jpeg.toString(), 'two');
  assert.equal(store.size, 1);
  assert.equal(store.bytes, 3);
  assert.deepEqual(store.room('r1'), [{ rollNo: 'A1', at: t0 + 30_000 }]);
  assert.deepEqual(store.room('r2'), []);
});

test('pictures: past the memory cap the oldest go first, never the one just kept', () => {
  const store = createSnapshotStore({ capBytes: 10 });
  store.put('r1', 'A', Buffer.alloc(4), 1);
  store.put('r1', 'B', Buffer.alloc(4), 2);
  store.put('r2', 'C', Buffer.alloc(4), 3);
  assert.equal(store.latest('r1', 'A'), null);
  assert.ok(store.latest('r2', 'C'));
  assert.ok(store.bytes <= 10);
});

test('the purge: two hours after the close, at once for a deleted room, and never for one still running', async () => {
  const closedAt = '2026-11-20T10:00:00.000Z';
  const t = Date.parse(closedAt);
  assert.equal(snapshotExpired({ status: 'open' }, t + 10 * SNAPSHOT_KEEP_MS), false);
  assert.equal(snapshotExpired({ status: 'paused' }, t + 10 * SNAPSHOT_KEEP_MS), false);
  assert.equal(snapshotExpired({ status: 'closed', closedAt }, t + SNAPSHOT_KEEP_MS - 1), false);
  assert.equal(snapshotExpired({ status: 'closed', closedAt }, t + SNAPSHOT_KEEP_MS), true);
  assert.equal(snapshotExpired(null, t), true);

  const store = createSnapshotStore();
  store.put('open', 'A', Buffer.alloc(2), t);
  store.put('closed', 'B', Buffer.alloc(2), t);
  store.put('gone', 'C', Buffer.alloc(2), t);
  store.put('unreadable', 'D', Buffer.alloc(2), t);
  const rooms = { open: { status: 'open' }, closed: { status: 'closed', closedAt }, gone: null };
  const roomOf = async (id) => {
    if (id === 'unreadable') throw new Error('store down');
    return rooms[id];
  };
  assert.equal(await store.sweep(t + 60_000, roomOf), 1, 'only the deleted room, a minute after the close');
  assert.equal(store.latest('gone', 'C'), null);
  assert.ok(store.latest('closed', 'B'));
  assert.equal(await store.sweep(t + SNAPSHOT_KEEP_MS, roomOf), 1, 'the closed room, two hours on');
  assert.equal(store.latest('closed', 'B'), null);
  assert.ok(store.latest('open', 'A'), 'a running room keeps its pictures');
  assert.ok(store.latest('unreadable', 'D'), 'a failed read keeps them for the next sweep');
  assert.equal(store.purgeRoom('open'), 1);
  assert.equal(store.size, 1);
});

test('snapshot_missing: due after two whole intervals and ten seconds, not one', () => {
  const since = 1_000_000;
  assert.equal(snapshotOverdue({ everySeconds: 30, since, now: since + 70_000 }), false);
  assert.equal(snapshotOverdue({ everySeconds: 30, since, now: since + 70_001 }), true);
  assert.equal(snapshotOverdue({ everySeconds: 60, since, now: since + 100_000 }), false);
  assert.equal(snapshotOverdue({ everySeconds: 0, since, now: since + 10_000_000 }), false, 'no pictures asked');
});

/* -------------------------------------------------------------- signals -- */

test('signals: the exam kinds are taken only in an exam room, and a phone may claim no observed one', () => {
  const p = { integrity: [] };
  for (const kind of EXAM_REPORTED) assert.equal(reportFromClient(p, kind), false, `"${kind}" outside an exam room`);
  assert.equal(p.integrity.length, 0);
  for (const kind of [...EXAM_OBSERVED, ...OBSERVED, 'screenshare_not_started']) {
    assert.equal(reportFromClient(p, kind, {}, { exam: true }), false, `a phone claimed "${kind}"`);
  }
  for (const kind of EXAM_REPORTED.filter((k) => k !== 'screenshare_not_started')) {
    assert.equal(reportFromClient(p, kind, {}, { exam: true }), true, kind);
  }
  assert.ok(p.integrity.every((e) => e.src === 'reported'));
  for (const kind of REPORTED) assert.equal(reportable(kind), true, 'the old kinds still go everywhere');
  assert.equal(noteScreen(p, 'copy_attempt'), false, 'the screen event records only its two kinds');
});

test('signals: a screenshot shortcut keeps its method from a closed list, and nothing else of the payload', () => {
  const p = { integrity: [] };
  reportFromClient(p, 'screenshot_attempt', { method: 'printscreen', note: 'x'.repeat(5000) }, { exam: true });
  reportFromClient(p, 'screenshot_attempt', { method: '<script>' }, { exam: true });
  assert.deepEqual(p.integrity.map((e) => e.method), ['printscreen', 'other']);
  assert.ok(!('note' in p.integrity[0]));
});

test('timing_anomaly: the reading rule counts the passage, on the server\'s clock; a normal pace is never flagged', () => {
  const q = { _id: 'q1', kind: 'truefalse', text: 'Water boils at 100 C at sea level.', stimulus: { kind: 'passage', text: 'x'.repeat(500) } };
  assert.equal(examMinPlausibleMs(q), minPlausibleMs(q) + 20_000, '500 characters at 25 a second');
  const servedAt = '2026-11-20T10:00:00.000Z';
  const t = Date.parse(servedAt);
  const fast = { integrity: [] };
  assert.ok(checkTiming(fast, q, servedAt, t + 3000));
  assert.equal(fast.integrity[0].kind, 'timing_anomaly');
  assert.equal(fast.integrity[0].src, 'observed');
  const steady = { integrity: [] };
  assert.equal(checkTiming(steady, q, servedAt, t + 25_000), null, 'twenty-five seconds on a passage and a statement');
  assert.equal(checkTiming(steady, q, null, t + 1), null, 'no serve time, no signal');
  assert.equal(checkTiming(steady, q, servedAt, t - 5), null, 'a clock that went backwards proves nothing');
  assert.equal(steady.integrity.length, 0);
});

test('the summary: counts and the latest signal, worded as signals, and levels that do not overreach', () => {
  const quiet = { integrity: [] };
  reportFromClient(quiet, 'context_menu', {}, { exam: true });
  assert.equal(summarise(quiet).level, 'clear', 'one right-click is not worth a glance');
  noteScreen(quiet, 'screenshare_not_started');
  assert.equal(summarise(quiet).level, 'clear', 'declining to share raises nothing');

  const p = { integrity: [] };
  reportFromClient(p, 'visibility_hidden', { awayMs: 4000 }, { exam: true });
  reportFromClient(p, 'focus_lost', {}, { exam: true });
  reportFromClient(p, 'screenshot_attempt', { method: 'snip_shortcut' }, { exam: true });
  assert.equal(summarise(p).level, 'note');
  noteSecondDevice(p, { other: 'socket-id-1' });
  noteSnapshotMissing(p, { everySeconds: 30 });
  const s = summarise(p);
  assert.equal(s.level, 'watch');
  assert.deepEqual(s.counts, { visibility_hidden: 1, focus_lost: 1, screenshot_attempt: 1, second_device: 1, snapshot_missing: 1 });
  assert.equal(s.latest.kind, 'snapshot_missing');
  assert.equal(s.away, 1);
  assert.equal(s.observed, 2);
  const words = s.notes.join(' ');
  assert.match(words, /Page left: possibly Google Lens, a screenshot tool or another app/);
  assert.match(words, /The page sees the key, not whether a picture was taken/);
  assert.match(words, /A dropped connection or a laptop going to sleep does the same/);
  assert.ok(!/cheat|copied from|guilty|fraud|dishonest/i.test(words), 'a note reads as a verdict');
  assert.ok(!JSON.stringify(s.latest).includes('socket-id'), 'the latest signal carries another socket\'s id');
});

/* -------------------------------------------------------------- collusion -- */

const Q = (n) => ({ id: `0000000000000000000000q${n}`.slice(-24), kind: 'mcq', options: ['w', 'x', 'y', 'z'], answerIdx: 0 });
const answer = (rollNo, n, response, at, extra = {}) => ({
  rollNo,
  questionId: Q(n).id,
  questionSnapshot: Q(n),
  kind: 'mcq',
  bloom: 'apply',
  topic: 'Trees',
  response,
  correct: response === 0,
  final: true,
  answeredAt: new Date(Date.parse('2026-11-20T10:00:00Z') + at * 1000).toISOString(),
  ...extra,
});

test('collusion, worked by hand: three matching wrong answers close together are listed; two, or far apart, are not', () => {
  const answers = [
    // A and B: the same wrong option on q1, q2, q3, each within a minute. Listed.
    answer('21CS02', 1, 2, 0), answer('21CS01', 1, 2, 20),
    answer('21CS02', 2, 3, 100), answer('21CS01', 2, 3, 130),
    answer('21CS02', 3, 1, 200), answer('21CS01', 3, 1, 260),
    // C matches A on q1 and q2 at the same moments, and on q3 two minutes
    // later: two close matches. Not listed.
    answer('21CS03', 1, 2, 10), answer('21CS03', 2, 3, 110), answer('21CS03', 3, 1, 330),
    // D answers everything right, at the same moments: agreement on the key is
    // what teaching is for. Never a match.
    answer('21CS04', 1, 0, 0), answer('21CS04', 2, 0, 100), answer('21CS04', 3, 0, 200),
    // A vote on a question put to the class is everyone at once, and not counted.
    answer('21CS02', 4, 2, 300, { classQuestionId: 'cq1' }), answer('21CS04', 4, 2, 300, { classQuestionId: 'cq1' }),
  ];
  const pairs = collusionPairs({ answers, names: new Map([['21CS01', 'Asha'], ['21CS02', 'Bilal']]) });
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].students, [{ rollNo: '21CS01', name: 'Asha' }, { rollNo: '21CS02', name: 'Bilal' }], 'roll order');
  assert.equal(pairs[0].matches, 3);
  assert.deepEqual(pairs[0].questions.map((q) => q.gapSeconds), [20, 30, 60]);
  // With A's q3 a second later than a minute, the pair falls to two and goes.
  const later = answers.map((a) => (a.rollNo === '21CS01' && a.questionId === Q(3).id ? { ...a, answeredAt: answer('x', 3, 1, 261).answeredAt } : a));
  assert.deepEqual(collusionPairs({ answers: later }), []);
  assert.equal(COLLUSION.minMatches, 3);
});

test('collusion: a wrong answer half the wrong students gave is a shared misunderstanding, not a shared source', () => {
  const answers = [];
  // Six students wrong on q1, q2 and q3; five of them on the same option each time.
  for (const [i, roll] of ['A1', 'A2', 'A3', 'A4', 'A5'].entries()) {
    for (const n of [1, 2, 3]) answers.push(answer(roll, n, 2, n * 100 + i));
  }
  for (const n of [1, 2, 3]) answers.push(answer('A6', n, 1, n * 100));
  assert.deepEqual(collusionPairs({ answers }), []);
});

test('collusion: students marked under 18 are left out, pairs and all; a retry\'s final answer is the one compared', () => {
  const answers = [
    answer('M1', 1, 2, 0), answer('N1', 1, 2, 5),
    answer('M1', 2, 3, 100), answer('N1', 2, 3, 105),
    answer('M1', 3, 1, 200), answer('N1', 3, 1, 205),
  ];
  assert.equal(collusionPairs({ answers }).length, 1);
  assert.deepEqual(collusionPairs({ answers, exclude: new Set(['M1']) }), []);
  // N1's first try at q3 matched; its final answer did not.
  const retried = [...answers, answer('N1', 3, 3, 210)];
  assert.deepEqual(collusionPairs({ answers: retried }), []);
  // A row kept and not counted is no answer at all.
  const kept = answers.map((a) => (a.rollNo === 'N1' && a.questionId === Q(2).id ? { ...a, final: false } : a));
  assert.deepEqual(collusionPairs({ answers: kept }), []);
});

test('collusion: typed answers compare as text, and options shown in another order compare as the same option', () => {
  const typed = (rollNo, n, text, at) => ({
    ...answer(rollNo, n, 0, at), kind: 'blank', questionSnapshot: { id: Q(n).id, kind: 'blank', answers: ['photosynthesis'] }, response: text, correct: false,
  });
  const answers = [
    typed('T1', 1, 'Respiration ', 0), typed('T2', 1, 'respiration', 10),
    typed('T1', 2, 'mitosis', 100), typed('T2', 2, 'MITOSIS', 110),
    typed('T1', 3, 'osmosis', 200), typed('T2', 3, 'osmosis', 215),
  ];
  assert.equal(collusionPairs({ answers }).length, 1);
  // Fewer choices: T3 was shown options [0, 2, 3] and picked position 1, which is option 2.
  const shown = (rollNo, n, pos, at) => ({ ...answer(rollNo, n, pos, at), questionSnapshot: { ...Q(n), shownOptions: [0, 2, 3] }, correct: false });
  const mixed = [
    shown('S1', 1, 1, 0), answer('S2', 1, 2, 5),
    shown('S1', 2, 1, 100), answer('S2', 2, 2, 105),
    shown('S1', 3, 2, 200), answer('S2', 3, 3, 205),
  ];
  assert.equal(collusionPairs({ answers: mixed }).length, 1);
});
