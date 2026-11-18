// Phase 1 - a professor's review of a written answer, applied to the profile.
//
// applyReview() is the only place a human decision changes a student's numbers,
// so every derived figure it could leave inconsistent is pinned here: the level
// tally, the history entry, the rolling window the ladder reads next, and the
// redemption pairings a flipped mark can invalidate. Profiles are built through
// applyAnswer(), so the fixtures have exactly the shape the live loop writes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyProfile,
  hydrate,
  applyAnswer,
  recordUngraded,
  applyReview,
  rollingAccuracy,
  countedLevels,
  withdrawnByLevel,
} from '../src/services/mastery.js';
import { LEVELS } from '../src/bloom.js';

/**
 * A profile built answer by answer. Each step is [bloom, correct, extra]; the
 * i-th answer gets question `q<i>` and idempotency key `key-<i>`.
 */
function answered(steps, { redemption = false, start = null } = {}) {
  let p = start ?? emptyProfile({ sessionId: 'sess-1', rollNo: '07' });
  steps.forEach(([bloom, correct, extra = {}], i) => {
    ({ profile: p } = applyAnswer(p, {
      questionId: `q${i + 1}`,
      answerId: `key-${i + 1}`,
      bloom,
      correct,
      score: correct ? 1 : 0.5,
      kind: 'open',
      redemption,
      ...extra,
    }));
  });
  return p;
}

const entryFor = (p, n) => p.history.find((h) => h.answerId === `key-${n}`);

/** Every number the screens read, checked against the history it came from. */
function assertConsistent(p) {
  for (const level of LEVELS) {
    const graded = p.history.filter((h) => h.bloom === level && !h.ungraded);
    assert.equal(p.levels[level].seen, graded.length, `${level}: seen matches the history`);
    assert.equal(p.levels[level].correct, graded.filter((h) => h.correct).length, `${level}: correct matches the history`);

    const setAside = graded.filter((h) => h.redeemedBy);
    const payers = graded.filter((h) => h.redeems);
    assert.ok(setAside.every((h) => !h.correct), `${level}: only wrong answers are set aside`);
    assert.ok(payers.every((h) => h.correct && !(h.tries > 1)), `${level}: only first-try right answers pay`);
    assert.equal(setAside.length, payers.length, `${level}: one-for-one`);
    for (const h of payers) {
      assert.equal(graded.find((w) => w.questionId === h.redeems)?.redeemedBy, h.questionId,
        `${level}: the pairing is named on both ends`);
    }

    const counted = countedLevels(p)[level];
    assert.equal(counted.seen, graded.length - setAside.length, `${level}: counted figure needs no clamp`);
  }
}

/** questionId -> who it was redeemed by / what it redeemed. */
const pairings = (p) => Object.fromEntries(
  p.history.map((h) => [h.questionId, { by: h.redeemedBy ?? null, pays: h.redeems ?? null }]),
);

describe('applyReview: the tally and the entry', () => {
  test('an override from wrong to right moves the correct tally, never seen', () => {
    const profile = answered([['create', true], ['create', false], ['create', true]]);
    const before = structuredClone(profile);

    const { profile: next, found, changed } = applyReview(profile, {
      answerId: 'key-2', correct: true, score: 0.9, review: 'overridden',
    });

    assert.deepEqual(profile, before, 'the input profile is not mutated');
    assert.equal(found, true);
    assert.equal(changed, true);
    assert.deepEqual(next.levels.create, { seen: 3, correct: 3 });
    assert.equal(entryFor(next, 2).correct, true);
    assert.equal(entryFor(next, 2).score, 0.9);
    assert.equal(entryFor(next, 2).review, 'overridden');
    assert.deepEqual(entryFor(next, 1), entryFor(profile, 1), 'other entries are untouched');
    assert.deepEqual(entryFor(next, 3), entryFor(profile, 3));
    assertConsistent(next);
  });

  test('an override from right to wrong moves it back down', () => {
    const profile = answered([['create', true], ['create', true]]);
    const { profile: next } = applyReview(profile, {
      answerId: 'key-1', correct: false, score: 0.2, review: 'overridden',
    });
    assert.deepEqual(next.levels.create, { seen: 2, correct: 1 });
    assert.equal(entryFor(next, 1).correct, false);
    assertConsistent(next);
  });

  test('confirming the machine\'s mark marks the entry and moves no number', () => {
    const profile = answered([['create', false]]);
    const { profile: next, changed } = applyReview(profile, {
      answerId: 'key-1', correct: false, score: 0.5, review: 'confirmed',
    });
    assert.equal(changed, true, 'the entry gained its review mark');
    assert.deepEqual(next.levels, profile.levels);
    assert.equal(entryFor(next, 1).review, 'confirmed');
    assert.equal(entryFor(next, 1).correct, false);

    const again = applyReview(next, { answerId: 'key-1', correct: false, score: 0.5, review: 'confirmed' });
    assert.equal(again.changed, false);
    assert.deepEqual(again.profile, next);
  });

  test('the same override applied twice counts once', () => {
    const profile = answered([['create', false]]);
    const review = { answerId: 'key-1', correct: true, score: 0.8, review: 'overridden' };
    const once = applyReview(profile, review).profile;
    const twice = applyReview(once, review);
    assert.equal(twice.changed, false);
    assert.deepEqual(twice.profile, once);
    assert.deepEqual(twice.profile.levels.create, { seen: 1, correct: 1 });
  });

  test('confirm after override puts the machine\'s mark back, by the same delta', () => {
    const profile = answered([['create', false]]);
    const overridden = applyReview(profile, { answerId: 'key-1', correct: true, score: 0.9, review: 'overridden' }).profile;
    const confirmed = applyReview(overridden, { answerId: 'key-1', correct: false, score: 0.5, review: 'confirmed' }).profile;
    assert.deepEqual(confirmed.levels.create, { seen: 1, correct: 0 });
    assert.equal(entryFor(confirmed, 1).score, 0.5);
    assert.equal(entryFor(confirmed, 1).review, 'confirmed');
    assertConsistent(confirmed);
  });

  test('a score-only change keeps the tally and updates the entry', () => {
    const profile = answered([['create', true]]);
    const { profile: next, changed } = applyReview(profile, {
      answerId: 'key-1', correct: true, score: 0.75, review: 'overridden',
    });
    assert.equal(changed, true);
    assert.deepEqual(next.levels.create, { seen: 1, correct: 1 });
    assert.equal(entryFor(next, 1).score, 0.75);
  });

  test('the score is kept at the precision applyAnswer uses', () => {
    const profile = answered([['create', false]]);
    const { profile: next } = applyReview(profile, { answerId: 'key-1', correct: true, score: 2 / 3, review: 'overridden' });
    assert.equal(entryFor(next, 1).score, 0.67);
  });

  test('an answer the profile does not hold changes nothing', () => {
    const profile = answered([['create', false]]);
    for (const answerId of ['key-99', '', undefined, null]) {
      const out = applyReview(profile, { answerId, correct: true, score: 1, review: 'overridden' });
      assert.equal(out.found, false);
      assert.equal(out.changed, false);
      assert.deepEqual(out.profile, hydrate(profile));
    }
  });

  test('a poll entry is left alone', () => {
    const { profile } = recordUngraded(emptyProfile({ sessionId: 'sess-1', rollNo: '07' }), {
      questionId: 'p1', bloom: 'understand', answerId: 'poll-1',
    });
    const out = applyReview(profile, { answerId: 'poll-1', correct: true, score: 1, review: 'overridden' });
    assert.equal(out.found, true);
    assert.equal(out.changed, false);
    assert.deepEqual(out.profile.levels.understand, { seen: 0, correct: 0 });
  });

  test('an unknown review mark is refused', () => {
    const profile = answered([['create', false]]);
    assert.throws(() => applyReview(profile, { answerId: 'key-1', correct: true, review: 'approved' }), /unknown review mark/);
  });

  test('a tally that disagrees with its history is kept inside 0..seen', () => {
    // A hand-written row: the tally already says right, the entry says wrong.
    const profile = hydrate({
      sessionId: 'sess-1',
      rollNo: '07',
      levels: { create: { seen: 1, correct: 1 } },
      history: [{ questionId: 'q1', answerId: 'key-1', bloom: 'create', correct: false }],
    });
    const up = applyReview(profile, { answerId: 'key-1', correct: true, review: 'overridden' }).profile;
    assert.deepEqual(up.levels.create, { seen: 1, correct: 1 });
    const empty = hydrate({ ...profile, levels: {} });
    const down = applyReview(
      hydrate({ ...empty, history: [{ questionId: 'q1', answerId: 'key-1', bloom: 'create', correct: true }] }),
      { answerId: 'key-1', correct: false, review: 'overridden' },
    ).profile;
    assert.deepEqual(down.levels.create, { seen: 0, correct: 0 });
  });
});

describe('applyReview: the ladder', () => {
  test('the working level is not rewound, and the next decision reads the corrected entry', () => {
    // Two right, one wrong at Understand: 67%, between the thresholds, holding.
    const profile = answered([['understand', true], ['understand', true], ['understand', false]]);
    assert.equal(profile.workingLevel, 'understand');

    const { profile: reviewed } = applyReview(profile, {
      answerId: 'key-3', correct: true, score: 0.8, review: 'overridden',
    });
    assert.equal(reviewed.workingLevel, profile.workingLevel, 'no promotion on the spot');
    assert.equal(reviewed.reason, profile.reason, 'the reason for the last decision stands');
    assert.equal(rollingAccuracy(reviewed, 'understand').accuracy, 1, 'the window now reads the human mark');

    // One more wrong answer. On the machine's marks the window is 2 of 4 (50%,
    // hold); on the reviewed marks it is 3 of 4 (75%, promote).
    const step = { questionId: 'q4', answerId: 'key-4', bloom: 'understand', correct: false };
    assert.equal(applyAnswer(profile, step).profile.workingLevel, 'understand');
    assert.equal(applyAnswer(reviewed, step).profile.workingLevel, 'apply');
  });

  test('an override to wrong does not demote on the spot either', () => {
    const profile = answered([['understand', true], ['understand', true], ['understand', true]]);
    assert.equal(profile.workingLevel, 'apply');
    const { profile: reviewed } = applyReview(profile, { answerId: 'key-3', correct: false, review: 'overridden' });
    assert.equal(reviewed.workingLevel, 'apply');
    assertConsistent(reviewed);
  });
});

describe('applyReview: redemption', () => {
  test('re-pairing reproduces exactly what applyAnswer did, so flipping a mark and back is a no-op', () => {
    // A long mixed history with retries, across two levels, from a fixed seed.
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const steps = Array.from({ length: 40 }, () => [
      rand() < 0.5 ? 'analyse' : 'evaluate',
      rand() < 0.55,
      rand() < 0.2 ? { tries: 2 } : {},
    ]);
    const profile = answered(steps, { redemption: true });
    const original = pairings(profile);
    assert.ok(Object.values(withdrawnByLevel(profile)).some((n) => n > 0), 'the fixture does redeem something');
    assertConsistent(profile);

    for (let n = 1; n <= steps.length; n += 1) {
      const was = entryFor(profile, n).correct;
      const flipped = applyReview(profile, { answerId: `key-${n}`, correct: !was, review: 'overridden', redemption: true }).profile;
      assertConsistent(flipped);
      const back = applyReview(flipped, { answerId: `key-${n}`, correct: was, review: 'overridden', redemption: true }).profile;
      assert.deepEqual(pairings(back), original, `flipping answer ${n} and back restores every pairing`);
      assert.deepEqual(back.levels, profile.levels);
    }
  });

  test('a set-aside answer overridden to right stops being set aside; its payer pays the next debt', () => {
    // W1, W2, R3 - R3 set aside W1.
    const profile = answered([['analyse', false], ['analyse', false], ['analyse', true]], { redemption: true });
    assert.equal(entryFor(profile, 1).redeemedBy, 'q3');

    const { profile: next } = applyReview(profile, {
      answerId: 'key-1', correct: true, score: 0.9, review: 'overridden', redemption: true,
    });
    assert.equal(entryFor(next, 1).redeemedBy, undefined, 'a right answer is never set aside');
    assert.equal(entryFor(next, 2).redeemedBy, 'q3', 'the freed right answer pays the next debt instead');
    assert.equal(entryFor(next, 3).redeems, 'q2');
    assert.deepEqual(countedLevels(next).analyse, { seen: 2, correct: 2 });
    assertConsistent(next);
  });

  test('a right answer that paid a debt, overridden to wrong, stops paying; a later right answer takes the debt', () => {
    // W1, R2 (pays W1), R3 (nothing left to pay).
    const profile = answered([['analyse', false], ['analyse', true], ['analyse', true]], { redemption: true });
    assert.equal(entryFor(profile, 2).redeems, 'q1');
    assert.equal(entryFor(profile, 3).redeems, undefined);

    const { profile: next } = applyReview(profile, {
      answerId: 'key-2', correct: false, score: 0.3, review: 'overridden', redemption: true,
    });
    assert.equal(entryFor(next, 2).redeems, undefined, 'a wrong answer pays for nothing');
    assert.equal(entryFor(next, 1).redeemedBy, 'q3');
    assert.equal(entryFor(next, 3).redeems, 'q1');
    assert.deepEqual(countedLevels(next).analyse, { seen: 2, correct: 1 });
    assertConsistent(next);
  });

  test('without redemption no pairing is ever made', () => {
    const profile = answered([['analyse', false], ['analyse', true]]);
    const { profile: next } = applyReview(profile, { answerId: 'key-1', correct: true, review: 'overridden' });
    assert.ok(next.history.every((h) => !h.redeemedBy && !h.redeems));
    assertConsistent(next);
  });
});
