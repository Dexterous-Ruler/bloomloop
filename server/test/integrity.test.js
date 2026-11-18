// Integrity signals - and above all, the cases that must NOT fire.
//
// Written after reading FLOOR_MS at 600000 and the latency comparison inverted,
// and taking both for live defects. They were neither: another agent had
// mutated the module on purpose to prove its own harness could fail, and
// reverted both within minutes. The shipped values are 900 and `took >= floor`,
// and always were.
//
// The suite is kept because the scare was instructive even though the bug was
// not real. Either mutation, shipped, would have flagged every normally-paced
// answer in the product as 'too-fast' - and that is an OBSERVED signal, the
// class the teacher-facing screens present as the trustworthy one. The failure
// mode is not "a missed cheat"; it is accusing every student in every session,
// confidently, at once.
//
// So the negative cases below are the point of this file. A false positive here
// costs a student far more than a missed signal costs a teacher. If you are
// tempted to relax one, that is the moment to stop.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  minPlausibleMs,
  checkLatency,
  reportFromClient,
  noteSecondSocket,
  summarise,
  REPORTED,
  OBSERVED,
} from '../src/services/integrity.js';

const blank = () => ({ integrity: [] });

const shortQ = { _id: 'q1', kind: 'truefalse', text: 'TCP guarantees delivery.' };
const longQ = {
  _id: 'q2',
  kind: 'match',
  text: 'Match each transport-layer mechanism with the failure it exists to address in a lossy network.',
  pairs: [
    { left: 'Sequence numbers', right: 'Segments arriving out of order' },
    { left: 'Acknowledgements', right: 'Segments lost in transit' },
    { left: 'Sliding window', right: 'A fast sender swamping a slow receiver' },
  ],
};

test('a one-line question is answerable in seconds, not minutes', () => {
  const ms = minPlausibleMs(shortQ);
  assert.ok(ms < 5000, `a short true/false demanded ${ms}ms of reading time`);
  assert.ok(ms >= 900, 'the floor still applies');
});

test('a longer question demands proportionally more reading time', () => {
  assert.ok(minPlausibleMs(longQ) > minPlausibleMs(shortQ));
});

test('an answer at a normal pace is NOT flagged', () => {
  // Eight seconds on a one-line true/false. The single most important
  // assertion in this file: this is what almost every real answer looks like.
  const p = blank();
  const servedAt = new Date(Date.now() - 8000).toISOString();
  assert.equal(checkLatency(p, shortQ, servedAt), null);
  assert.equal(p.integrity.length, 0, 'a normal answer recorded a signal');
  assert.equal(summarise(p).level, 'clear');
});

test('a thoughtful, slow answer is NOT flagged', () => {
  const p = blank();
  assert.equal(checkLatency(p, longQ, new Date(Date.now() - 120000).toISOString()), null);
  assert.equal(p.integrity.length, 0);
});

test('an answer that beat the reading time IS flagged, as observed', () => {
  const p = blank();
  const hit = checkLatency(p, longQ, new Date(Date.now() - 200).toISOString());
  assert.ok(hit, 'a 200ms answer to a three-pair match was not flagged');
  assert.equal(p.integrity[0].kind, 'too-fast');
  assert.equal(p.integrity[0].src, 'observed');
});

test('no pin means no latency judgement at all', () => {
  const p = blank();
  assert.equal(checkLatency(p, shortQ, null), null);
  assert.equal(p.integrity.length, 0);
});

test('a clock skewed into the future does not manufacture a signal', () => {
  const p = blank();
  assert.equal(checkLatency(p, shortQ, new Date(Date.now() + 60000).toISOString()), null);
  assert.equal(p.integrity.length, 0);
});

test('only allow-listed browser reports are accepted', () => {
  const p = blank();
  assert.equal(reportFromClient(p, 'hidden', { awayMs: 4000 }), true);
  // A client must never be able to claim a signal the server is meant to derive.
  for (const kind of OBSERVED) {
    assert.equal(reportFromClient(p, kind), false, `client was allowed to claim "${kind}"`);
  }
  assert.equal(reportFromClient(p, 'nonsense'), false);
  assert.equal(p.integrity.length, 1, 'a rejected report still wrote an event');
});

test('a reported event is never marked observed', () => {
  const p = blank();
  for (const kind of REPORTED) reportFromClient(p, kind);
  assert.ok(p.integrity.every((e) => e.src === 'reported'));
  assert.equal(summarise(p).observed, 0);
});

test('an untouched profile reads clear', () => {
  assert.equal(summarise(blank()).level, 'clear');
  assert.deepEqual(summarise(blank()).notes, []);
});

test('one glance away is noted but does not raise the level', () => {
  const p = blank();
  reportFromClient(p, 'hidden', { awayMs: 1200 });
  assert.equal(summarise(p).level, 'clear');
});

test('anything the server observed raises it to watch', () => {
  const p = blank();
  noteSecondSocket(p, { other: 'sock-2' });
  const s = summarise(p);
  assert.equal(s.level, 'watch');
  assert.equal(s.observed, 1);
  assert.ok(s.notes.some((n) => n.includes('two connections')));
});
