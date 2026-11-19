// F3 evidence, part 2 - adaptive selection against a fixed bank.
// The bank fixture below is deliberately tiny and hand-built so every
// expectation can be read off it, and every random pick is made deterministic
// by passing {rng}. A flaky selector test the morning of the demo is worse
// than no test at all.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { selectNext, selectSet } from '../src/services/selector.js';
import { hydrate, recomputeWorkingLevel, isSlowLearner, eligibleLevels } from '../src/services/mastery.js';
import { LEVELS, emptyLevels, levelIndex } from '../src/bloom.js';

function q(id, bloom, status = 'active') {
  return {
    _id: id,
    contentId: 'content-1',
    topic: 'Photosynthesis',
    text: `Question ${id}`,
    options: ['A', 'B', 'C', 'D'],
    answerIdx: 0,
    bloom,
    status,
    source: 'fallback',
  };
}

/** One item at every level, two at the lower ones - the shape DEFAULT_MIX gives. */
const BANK = [
  q('r1', 'remember'),
  q('r2', 'remember'),
  q('u1', 'understand'),
  q('u2', 'understand'),
  q('a1', 'apply'),
  q('a2', 'apply'),
  q('an1', 'analyse'),
  q('ev1', 'evaluate'),
  q('c1', 'create'),
];

const ids = (picks) => picks.map((p) => String(p.question._id));

/** Always take the first candidate at a level; `lastPick` takes the last. */
const firstPick = () => 0;
const lastPick = () => 0.99;

/**
 * A profile whose counters, history and working level agree - the state the
 * live socket loop actually persists, since applyAnswer() always runs
 * recomputeWorkingLevel() before saving.
 */
function settled(workingLevel, answers) {
  const levels = emptyLevels();
  const history = answers.map(([bloom, correct, questionId], i) => {
    levels[bloom] = {
      seen: levels[bloom].seen + 1,
      correct: levels[bloom].correct + (correct ? 1 : 0),
    };
    return { questionId: String(questionId ?? `seen-${i + 1}`), bloom, correct, at: null };
  });
  const draft = hydrate({ sessionId: 'sess-1', rollNo: '17', name: 'Test Student', levels, workingLevel, history });
  const decision = recomputeWorkingLevel(draft);
  return { ...draft, workingLevel: decision.workingLevel, reason: decision.reason };
}

const at = (level, n, right) => Array.from({ length: n }, (_, i) => [level, i < right]);

/** 1 correct of 5 -> 20% overall, which is inside the below-40% band. */
const weakProfile = () => settled('apply', [...at('understand', 3, 1), ...at('apply', 2, 0)]);

/** 6 of 7 at the top of the ladder - the student the demo contrasts against. */
const strongProfile = () => settled('evaluate', [...at('analyse', 5, 4), ...at('evaluate', 2, 2)]);

/** Comfortably mid-ladder: working level Apply, nowhere near the band. */
const midProfile = () => settled('apply', [...at('understand', 3, 3), ...at('apply', 2, 1)]);

/** Serve until the bank is exhausted, recording each item as answered. */
function drain(profile, questions, rng = firstPick) {
  const served = [];
  let shadow = { ...profile, history: profile.history.slice() };
  for (let guard = 0; guard <= questions.length; guard += 1) {
    const pick = selectNext(shadow, questions, { rng });
    if (!pick) return served;
    served.push(pick);
    shadow = {
      ...shadow,
      history: [
        ...shadow.history,
        { questionId: String(pick.question._id), bloom: pick.question.bloom, correct: true, at: null },
      ],
    };
  }
  throw new Error('selector kept serving past the size of the bank');
}

describe('the slow-learner ceiling (contract hard rule 4)', () => {
  test('a slow-learner profile is never handed an item above understand', () => {
    const profile = weakProfile();
    assert.equal(isSlowLearner(profile), true);

    const served = drain(profile, BANK);

    assert.equal(served.length, 4, 'only the four remember/understand items are reachable');
    assert.deepEqual(ids(served).sort(), ['r1', 'r2', 'u1', 'u2']);
    for (const pick of served) {
      assert.ok(levelIndex(pick.level) <= levelIndex('understand'), `served ${pick.level}`);
      assert.match(pick.reason, /Below-40% band/);
    }
  });

  test('returns null rather than breaking the ceiling when the bank is all create items', () => {
    const createOnly = [q('c1', 'create'), q('c2', 'create'), q('c3', 'create')];

    assert.equal(selectNext(weakProfile(), createOnly, { rng: firstPick }), null);
    assert.deepEqual(selectSet(weakProfile(), createOnly, 3), []);
  });

  test('the ceiling holds even when the bank has nothing below evaluate', () => {
    const hardOnly = [q('an1', 'analyse'), q('ev1', 'evaluate'), q('c1', 'create')];

    assert.equal(selectNext(weakProfile(), hardOnly, { rng: firstPick }), null);
  });

  test('the ceiling holds even when a stored working level is stale above it', () => {
    // A profile written before the band engaged, or hand-edited in the DB:
    // eligibleLevels() must still win over the stale field.
    const stale = hydrate({ ...weakProfile(), workingLevel: 'create' });
    assert.deepEqual(eligibleLevels(stale), ['remember', 'understand']);

    const pick = selectNext(stale, BANK, { rng: firstPick });
    assert.equal(pick.level, 'understand');
    assert.ok(levelIndex(pick.level) <= levelIndex('understand'));
  });
});

describe('never serving the same question twice', () => {
  test('a question already in history is never served twice', () => {
    // u1, u2 and a1 were answered before the student's phone dropped.
    const profile = settled('apply', [
      ['understand', true, 'u1'],
      ['understand', true, 'u2'],
      ['apply', true, 'a1'],
    ]);

    const pick = selectNext(profile, BANK, { rng: firstPick });
    assert.equal(pick.question._id, 'a2', 'the only unseen item at the working level');
    assert.equal(pick.level, 'apply');

    const served = ids(drain(profile, BANK));
    assert.equal(served.includes('u1'), false);
    assert.equal(served.includes('u2'), false);
    assert.equal(served.includes('a1'), false);
    assert.equal(new Set(served).size, served.length);
  });

  test('a question in history under its id in other letters is the same question: never served again', () => {
    // A uuid or an ObjectId is the same id in either case; a history entry
    // written from an id a phone sent in capitals still names this question.
    const profile = settled('apply', [
      ['understand', true, 'U1'],
      ['understand', true, 'u2'],
      ['apply', true, 'A1'],
    ]);
    const served = ids(drain(profile, BANK));
    assert.equal(served.includes('u1'), false);
    assert.equal(served.includes('a1'), false);
    assert.equal(selectNext(profile, BANK, { rng: firstPick }).question._id, 'a2');
  });

  test('draining the bank serves every remaining active item exactly once', () => {
    const served = ids(drain(midProfile(), BANK));

    assert.equal(served.length, BANK.length);
    assert.deepEqual([...served].sort(), BANK.map((item) => item._id).sort());
  });

  test('discarded items are never served', () => {
    const bank = [q('a1', 'apply', 'discarded'), q('a2', 'apply'), q('u1', 'understand', 'discarded')];
    const served = ids(drain(midProfile(), bank));

    assert.deepEqual(served, ['a2']);
  });
});

describe('exhaustion walks down the ladder before it walks up', () => {
  test('when the working level is exhausted the selector steps DOWN before it steps UP', () => {
    // Working level Apply, bank holds only one easier and one harder item.
    const bank = [q('an1', 'analyse'), q('r1', 'remember')];
    const pick = selectNext(midProfile(), bank, { rng: firstPick });

    assert.equal(pick.level, 'remember');
    assert.ok(levelIndex(pick.level) < levelIndex('apply'));
    assert.match(pick.reason, /no unseen items remain/);
  });

  test('the rung directly below is used as a cushion first', () => {
    const bank = [q('an1', 'analyse'), q('r1', 'remember'), q('u1', 'understand')];
    const pick = selectNext(midProfile(), bank, { rng: firstPick });

    assert.equal(pick.level, 'understand');
  });

  test('the whole descent is tried before anything harder is offered', () => {
    const served = drain(midProfile(), BANK).map((p) => p.level);

    assert.deepEqual(served.slice(0, 5), ['apply', 'apply', 'understand', 'understand', 'remember']);
    assert.deepEqual(served.slice(5), ['remember', 'analyse', 'evaluate', 'create']);
  });

  test('a student is served something harder rather than nothing at all', () => {
    // Last-resort tier: an empty screen mid-demo is the worse failure for a
    // student who is not inside the band.
    const pick = selectNext(midProfile(), [q('c1', 'create')], { rng: firstPick });

    assert.equal(pick.level, 'create');
    assert.match(pick.reason, /no unseen items remain/);
  });

  test('rng picks within a level, never across levels', () => {
    const profile = midProfile();

    assert.equal(selectNext(profile, BANK, { rng: firstPick }).question._id, 'a1');
    assert.equal(selectNext(profile, BANK, { rng: lastPick }).question._id, 'a2');
    assert.equal(selectNext(profile, BANK, { rng: lastPick }).level, 'apply');
  });
});

describe('selectSet', () => {
  test('selectSet(n) returns n distinct questions', () => {
    const served = selectSet(strongProfile(), BANK, 5);
    const served_ids = ids(served);

    assert.equal(served.length, 5);
    assert.equal(new Set(served_ids).size, 5);
    for (const id of served_ids) {
      assert.ok(BANK.some((item) => item._id === id), `${id} is not in the bank`);
    }
  });

  test('asking for more than the bank holds returns the bank, not a repeat', () => {
    const served_ids = ids(selectSet(strongProfile(), BANK, 50));

    assert.equal(served_ids.length, BANK.length);
    assert.equal(new Set(served_ids).size, BANK.length);
  });

  test('selectSet honours the slow-learner ceiling for the whole set', () => {
    const served = selectSet(weakProfile(), BANK, 6);

    assert.equal(served.length, 4);
    for (const pick of served) {
      assert.ok(levelIndex(pick.level) <= levelIndex('understand'));
    }
  });

  test('selectSet does not mutate the profile it is given', () => {
    const profile = midProfile();
    const snapshot = structuredClone(profile);

    selectSet(profile, BANK, 4);

    assert.deepEqual(profile, snapshot);
  });
});

describe('degenerate banks return null rather than throwing', () => {
  test('an empty bank returns null', () => {
    assert.equal(selectNext(midProfile(), [], { rng: firstPick }), null);
    assert.equal(selectNext(weakProfile(), [], { rng: firstPick }), null);
    assert.deepEqual(selectSet(midProfile(), [], 3), []);
  });

  test('a fully discarded bank returns null', () => {
    const discarded = BANK.map((item) => ({ ...item, status: 'discarded' }));

    assert.equal(selectNext(midProfile(), discarded, { rng: firstPick }), null);
    assert.equal(selectNext(strongProfile(), discarded, { rng: firstPick }), null);
    assert.deepEqual(selectSet(midProfile(), discarded, 3), []);
  });

  test('a bank the student has already finished returns null', () => {
    const answered = BANK.map((item) => [item.bloom, true, item._id]);
    const profile = settled('apply', answered);

    assert.equal(selectNext(profile, BANK, { rng: firstPick }), null);
  });
});

describe('THE DEMO MOMENT', () => {
  test('the demo moment: weak and strong profiles diverge on one bank', () => {
    const weak = weakProfile();
    const strong = strongProfile();

    const weakPick = selectNext(weak, BANK, { rng: firstPick });
    const strongPick = selectNext(strong, BANK, { rng: firstPick });

    // Same bank, same call, same rng - only the profile differs.
    assert.equal(weakPick.level, 'understand');
    assert.equal(strongPick.level, 'evaluate');
    assert.ok(levelIndex(strongPick.level) > levelIndex(weakPick.level));
    assert.notEqual(weakPick.question._id, strongPick.question._id);

    // And the teacher gets a sentence for each, which is the other half of F3.
    assert.match(weakPick.reason, /Below-40% band/);
    assert.match(strongPick.reason, /Working level is Evaluate/);

    // It holds for a whole set, not just one lucky draw.
    for (const pick of selectSet(weak, BANK, 3)) {
      assert.ok(levelIndex(pick.level) <= levelIndex('understand'), `weak got ${pick.level}`);
    }
    for (const pick of selectSet(strong, BANK, 3)) {
      assert.ok(levelIndex(pick.level) >= levelIndex('apply'), `strong got ${pick.level}`);
    }
  });

  test('every level the selector reports is one of the six, spelled the British way', () => {
    for (const pick of drain(midProfile(), BANK)) {
      assert.ok(LEVELS.includes(pick.level));
      assert.equal(pick.question.bloom, pick.level);
    }
    assert.ok(LEVELS.includes('analyse'));
    assert.equal(LEVELS.includes('analyze'), false);
  });
});
