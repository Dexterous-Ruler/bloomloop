// F3 evidence, part 1 - the promote/demote table and the below-30-40% band.
// completion.md puts "unit-test the promote/demote table incl. the below-30-40%
// branch" before the demo because the adaptive claim is the differentiator: if
// these branches are wrong, the demo is a slideshow. Every branch of
// recomputeWorkingLevel() is pinned here, including the ones that only fire on
// a struggling student, which is exactly the path nobody exercises by hand.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyProfile,
  hydrate,
  applyAnswer,
  recomputeWorkingLevel,
  eligibleLevels,
  isSlowLearner,
  rollingAccuracy,
  overallAccuracy,
  totals,
  levelReport,
  COLD_START_LEVEL,
  WINDOW,
  PROMOTE_AT,
  DEMOTE_AT,
  SLOW_LEARNER_BAND,
  MIN_EVIDENCE,
} from '../src/services/mastery.js';
import { LEVELS, emptyLevels, levelIndex } from '../src/bloom.js';

/**
 * Build a profile whose `levels` counters and `history` agree, which is the only
 * shape the live code ever produces. A fixture where the two disagree would let
 * a test pass for the wrong reason: totals()/isSlowLearner() read `levels`,
 * while rollingAccuracy() reads `history`.
 */
function profileOf(workingLevel, answers) {
  const levels = emptyLevels();
  const history = answers.map(([bloom, correct], i) => {
    levels[bloom] = {
      seen: levels[bloom].seen + 1,
      correct: levels[bloom].correct + (correct ? 1 : 0),
    };
    return { questionId: `q${i + 1}`, bloom, correct, at: null };
  });
  return hydrate({
    sessionId: 'sess-1',
    rollNo: '17',
    name: 'Test Student',
    levels,
    workingLevel,
    history,
  });
}

/** `n` answers at one level, the first `right` of them correct. */
function run(level, n, right) {
  return Array.from({ length: n }, (_, i) => [level, i < right]);
}

describe('cold start (F3 rule 1)', () => {
  test('a fresh profile sits at understand with an explanatory reason', () => {
    const profile = emptyProfile({ sessionId: 'sess-1', rollNo: ' 17 ', name: 'Asha' });

    assert.equal(profile.workingLevel, 'understand');
    assert.equal(COLD_START_LEVEL, 'understand');
    assert.equal(profile.rollNo, '17');
    assert.deepEqual(profile.history, []);
    assert.deepEqual(totals(profile), { seen: 0, correct: 0 });
    assert.equal(overallAccuracy(profile), null);

    // The teacher must be able to ask "why this level?" and get a sentence.
    assert.ok(profile.reason.length > 0);
    assert.match(profile.reason, /No history yet/);
    assert.match(profile.reason, /Understand/);
  });

  test('recompute on an empty profile holds at understand and reports no change', () => {
    const decision = recomputeWorkingLevel(hydrate({ sessionId: 'sess-1', rollNo: '17' }));

    assert.equal(decision.workingLevel, 'understand');
    assert.equal(decision.changed, false);
    assert.match(decision.reason, /No history yet/);
  });

  test('a cold-start student is not a slow learner - there is no evidence yet', () => {
    assert.equal(isSlowLearner(emptyProfile({ sessionId: 'sess-1', rollNo: '17' })), false);
  });
});

describe('the promote / demote table', () => {
  test('4 of the last 5 correct (>= 70%) promotes exactly one level', () => {
    const profile = profileOf('apply', run('apply', 5, 4));
    const decision = recomputeWorkingLevel(profile);

    assert.equal(rollingAccuracy(profile, 'apply').accuracy, 0.8);
    assert.ok(0.8 >= PROMOTE_AT);
    assert.equal(decision.workingLevel, 'analyse');
    assert.equal(decision.changed, true);
    assert.equal(levelIndex(decision.workingLevel) - levelIndex('apply'), 1);
    assert.match(decision.reason, /promoted to Analyse/);
  });

  test('3 of 5 correct (60%) sits between the thresholds and promotes nobody', () => {
    const profile = profileOf('apply', run('apply', 5, 3));
    const decision = recomputeWorkingLevel(profile);

    assert.equal(rollingAccuracy(profile, 'apply').accuracy, 0.6);
    assert.ok(0.6 < PROMOTE_AT && 0.6 >= DEMOTE_AT);
    assert.equal(decision.workingLevel, 'apply');
    assert.equal(decision.changed, false);
    assert.match(decision.reason, /holding at Apply/);
  });

  test('1 of 5 correct (20%) at the working level demotes exactly one level', () => {
    // The earlier good history is load-bearing, not decoration: without it the
    // lifetime accuracy would fall inside the below-40% band and the band -
    // not the ladder - would decide the level. This case isolates the ladder.
    const profile = profileOf('analyse', [
      ...run('understand', 5, 5),
      ...run('apply', 5, 4),
      ...run('analyse', 5, 1),
    ]);
    const decision = recomputeWorkingLevel(profile);

    assert.equal(isSlowLearner(profile), false);
    assert.equal(rollingAccuracy(profile, 'analyse').accuracy, 0.2);
    assert.ok(0.2 < DEMOTE_AT);
    assert.equal(decision.workingLevel, 'apply');
    assert.equal(decision.changed, true);
    assert.equal(levelIndex('analyse') - levelIndex(decision.workingLevel), 1);
    assert.match(decision.reason, /demoted to Apply/);
  });

  test('only the last WINDOW answers at the level count', () => {
    // Three early wrongs then four rights: lifetime is 50% but the window is
    // 80%, so the student moves up. Pins the rolling window, not the lifetime.
    const profile = profileOf('apply', [...run('apply', 3, 0), ...run('apply', 4, 4), ['apply', false]]);
    const rolling = rollingAccuracy(profile, 'apply');

    assert.equal(WINDOW, 5);
    assert.equal(rolling.n, 5);
    assert.equal(rolling.accuracy, 0.8);
    assert.equal(overallAccuracy(profile), 0.5);
    assert.equal(recomputeWorkingLevel(profile).workingLevel, 'analyse');
  });

  test('one lucky answer at a level cannot move the level', () => {
    const profile = profileOf('apply', run('apply', 1, 1));
    const decision = recomputeWorkingLevel(profile);

    assert.equal(rollingAccuracy(profile, 'apply').accuracy, 1);
    assert.equal(decision.workingLevel, 'apply');
    assert.equal(decision.changed, false);
    assert.match(decision.reason, /need 3 before moving level/);
  });

  test('a level with no answers yet returns null rolling accuracy and holds', () => {
    const profile = profileOf('analyse', run('understand', 4, 3));

    assert.equal(rollingAccuracy(profile, 'analyse'), null);
    const decision = recomputeWorkingLevel(profile);
    assert.equal(decision.workingLevel, 'analyse');
    assert.equal(decision.changed, false);
    assert.match(decision.reason, /No answers yet at Analyse/);
  });
});

describe('clamping at both ends of the ladder', () => {
  test('a perfect student never goes above create', () => {
    const profile = profileOf('create', run('create', 5, 5));
    const decision = recomputeWorkingLevel(profile);

    assert.equal(decision.workingLevel, 'create');
    assert.equal(decision.changed, false);
    assert.equal(levelIndex(decision.workingLevel), LEVELS.length - 1);
    assert.match(decision.reason, /top of the ladder/);
  });

  test('a failing student never goes below remember', () => {
    // Lifetime 69% keeps them out of the band; the last five at Remember are
    // 20%, so the demote branch fires and must clamp instead of falling off.
    const profile = profileOf('remember', [...run('remember', 8, 8), ...run('remember', 5, 1)]);
    const decision = recomputeWorkingLevel(profile);

    assert.equal(isSlowLearner(profile), false);
    assert.equal(rollingAccuracy(profile, 'remember').accuracy, 0.2);
    assert.equal(decision.workingLevel, 'remember');
    assert.equal(decision.changed, false);
    assert.equal(levelIndex(decision.workingLevel), 0);
    assert.match(decision.reason, /floor/);
  });

  test('every decision lands on a real bloom level, one rung at most', () => {
    for (const level of LEVELS) {
      for (const right of [0, 1, 3, 5]) {
        const profile = profileOf(level, run(level, 5, right));
        const decision = recomputeWorkingLevel(profile);
        assert.ok(LEVELS.includes(decision.workingLevel), `${level}/${right} -> ${decision.workingLevel}`);

        if (isSlowLearner(profile)) {
          // The band is allowed to skip rungs; that is its job.
          assert.equal(decision.workingLevel, 'understand');
        } else {
          const step = levelIndex(decision.workingLevel) - levelIndex(level);
          assert.ok(Math.abs(step) <= 1, `${level}/${right} moved ${step} rungs`);
        }
      }
    }
  });
});

describe('the below-30-40% band', () => {
  test('overall accuracy under 40% flags isSlowLearner and caps the pool', () => {
    const profile = profileOf('understand', run('understand', 5, 1));

    assert.equal(overallAccuracy(profile), 0.2);
    assert.ok(0.2 < SLOW_LEARNER_BAND);
    assert.equal(isSlowLearner(profile), true);
    assert.deepEqual(eligibleLevels(profile), ['remember', 'understand']);

    const decision = recomputeWorkingLevel(profile);
    assert.equal(decision.workingLevel, 'understand');
    assert.match(decision.reason, /below-40% band/);
    assert.match(decision.reason, /Remember and Understand items only/);
  });

  test('exactly 40% is not "below 40%" - the boundary is strict', () => {
    const profile = profileOf('understand', run('understand', 5, 2));

    assert.equal(overallAccuracy(profile), SLOW_LEARNER_BAND);
    assert.equal(isSlowLearner(profile), false);
  });

  test('MIN_EVIDENCE: one wrong answer alone does not brand a student a slow learner', () => {
    const profile = profileOf('apply', run('apply', 1, 0));

    assert.equal(MIN_EVIDENCE, 3);
    assert.equal(totals(profile).seen, 1);
    assert.equal(overallAccuracy(profile), 0);
    assert.equal(isSlowLearner(profile), false);
    // Still trusted with Apply items - the band has not engaged.
    assert.ok(eligibleLevels(profile).includes('apply'));

    const decision = recomputeWorkingLevel(profile);
    assert.equal(decision.workingLevel, 'apply');
    assert.doesNotMatch(decision.reason, /below-40% band/);
  });

  test('the band engages on the MIN_EVIDENCE-th answer, not before', () => {
    assert.equal(isSlowLearner(profileOf('understand', run('understand', 1, 0))), false);
    assert.equal(isSlowLearner(profileOf('understand', run('understand', 2, 0))), false);
    assert.equal(isSlowLearner(profileOf('understand', run('understand', 3, 0))), true);
  });

  test('the band overrides the ladder: an apply student is pulled back and capped', () => {
    const healthy = profileOf('apply', [...run('understand', 3, 3), ...run('apply', 3, 2)]);
    assert.ok(eligibleLevels(healthy).includes('apply'));

    const sunk = profileOf('apply', [
      ['understand', true],
      ['understand', false],
      ['understand', false],
      ['apply', false],
      ['apply', false],
      ['apply', false],
    ]);
    const decision = recomputeWorkingLevel(sunk);

    assert.equal(isSlowLearner(sunk), true);
    assert.equal(decision.workingLevel, 'understand');
    assert.equal(decision.changed, true);
    assert.ok(levelIndex(decision.workingLevel) < levelIndex('apply'));
    assert.match(decision.reason, /below-40% band/);
    // Hard rule 4: the ceiling is real, so 'apply' is gone from the pool.
    assert.deepEqual(eligibleLevels(sunk), ['remember', 'understand']);
    assert.equal(eligibleLevels(sunk).includes('apply'), false);
  });

  test('the band beats the ladder by more than one rung', () => {
    // The ladder alone would demote Analyse -> Apply. The band skips that and
    // drops the student straight to Understand, which is the whole point.
    const profile = profileOf('analyse', run('analyse', 5, 1));
    const decision = recomputeWorkingLevel(profile);

    assert.equal(isSlowLearner(profile), true);
    assert.equal(decision.workingLevel, 'understand');
    assert.notEqual(decision.workingLevel, 'apply');
    assert.deepEqual(eligibleLevels(profile), ['remember', 'understand']);
  });

  test('no profile inside the band is ever eligible above understand', () => {
    for (const level of LEVELS) {
      const profile = profileOf(level, run(level, 5, 1));
      assert.equal(isSlowLearner(profile), true);
      for (const eligible of eligibleLevels(profile)) {
        assert.ok(levelIndex(eligible) <= levelIndex('understand'), `${level} leaked ${eligible}`);
      }
    }
  });
});

describe('applyAnswer', () => {
  test('is pure - the input profile object is not mutated', () => {
    const profile = profileOf('apply', run('apply', 2, 2));
    const snapshot = structuredClone(profile);

    const { profile: next, decision } = applyAnswer(profile, {
      questionId: 'q-99',
      bloom: 'apply',
      correct: true,
      at: '2026-08-09T09:00:00.000Z',
    });

    assert.deepEqual(profile, snapshot);
    assert.notEqual(next, profile);
    assert.notEqual(next.levels, profile.levels);
    assert.notEqual(next.history, profile.history);
    assert.equal(profile.levels.apply.seen, 2);
    assert.equal(next.levels.apply.seen, 3);
    assert.equal(next.history.length, 3);
    assert.equal(decision.workingLevel, 'analyse');
    assert.equal(next.workingLevel, decision.workingLevel);
    assert.equal(next.reason, decision.reason);
  });

  test('records bloom and timestamp on the history entry', () => {
    const { profile: next } = applyAnswer(emptyProfile({ sessionId: 'sess-1', rollNo: '17' }), {
      questionId: 42,
      bloom: 'understand',
      correct: false,
      at: '2026-08-09T09:00:00.000Z',
    });
    const entry = next.history.at(-1);

    // bloom lives on the entry so rolling accuracy needs no join back to the
    // bank on the hot path; topic and kind for the same reason in analytics.
    assert.deepEqual(entry, {
      questionId: '42',
      bloom: 'understand',
      topic: '',
      kind: 'mcq',
      correct: false,
      at: '2026-08-09T09:00:00.000Z',
    });
    assert.equal(next.levels.understand.seen, 1);
    assert.equal(next.levels.understand.correct, 0);
  });

  test('carries topic, kind and the answer key on the history entry', () => {
    const { profile: next } = applyAnswer(emptyProfile({ sessionId: 'sess-1', rollNo: '17' }), {
      questionId: 'q1',
      bloom: 'apply',
      correct: true,
      topic: 'Sliding window',
      kind: 'match',
      answerId: 'k-12345678',
    });
    const entry = next.history.at(-1);
    assert.equal(entry.topic, 'Sliding window');
    assert.equal(entry.kind, 'match');
    assert.equal(entry.answerId, 'k-12345678');
  });

  test('throws on an unknown bloom level and leaves the profile alone', () => {
    const profile = profileOf('apply', run('apply', 2, 2));
    const snapshot = structuredClone(profile);

    // 'analyze' is the American spelling the contract bans - it must be
    // rejected outright rather than silently creating a seventh level.
    assert.throws(
      () => applyAnswer(profile, { questionId: 'q-99', bloom: 'analyze', correct: true }),
      /unknown bloom level/,
    );
    assert.throws(
      () => applyAnswer(profile, { questionId: 'q-99', bloom: 'Understand', correct: true }),
      /unknown bloom level/,
    );
    assert.throws(
      () => applyAnswer(profile, { questionId: 'q-99', correct: true }),
      /unknown bloom level/,
    );
    assert.deepEqual(profile, snapshot);
  });

  test('a struggling student is never left above understand on the way down', () => {
    // The gap MIN_LEVEL_EVIDENCE exists to close: three wrong answers in a row
    // from cold start must never leave the student holding an Apply ticket.
    let profile = emptyProfile({ sessionId: 'sess-1', rollNo: '17' });
    for (let i = 0; i < 3; i += 1) {
      ({ profile } = applyAnswer(profile, { questionId: `q-${i}`, bloom: 'understand', correct: false }));
      assert.ok(levelIndex(profile.workingLevel) <= levelIndex('understand'));
      for (const level of eligibleLevels(profile)) {
        assert.ok(levelIndex(level) <= levelIndex('understand'));
      }
    }
    assert.equal(isSlowLearner(profile), true);
    assert.match(profile.reason, /below-40% band/);
  });

  test('a strong student climbs one rung at a time', () => {
    let profile = emptyProfile({ sessionId: 'sess-1', rollNo: '17' });
    const seen = [profile.workingLevel];

    for (let i = 0; i < 12; i += 1) {
      const before = profile.workingLevel;
      ({ profile } = applyAnswer(profile, {
        questionId: `q-${i}`,
        bloom: profile.workingLevel,
        correct: true,
      }));
      assert.ok(Math.abs(levelIndex(profile.workingLevel) - levelIndex(before)) <= 1);
      if (profile.workingLevel !== seen.at(-1)) seen.push(profile.workingLevel);
    }

    assert.deepEqual(seen, ['understand', 'apply', 'analyse', 'evaluate', 'create']);
    assert.equal(profile.workingLevel, 'create');
  });
});

describe('levelReport', () => {
  test('returns all six levels with null accuracy where nothing was seen', () => {
    const report = levelReport(emptyProfile({ sessionId: 'sess-1', rollNo: '17' }));

    assert.equal(report.length, 6);
    assert.deepEqual(report.map((r) => r.level), LEVELS);
    assert.ok(report.some((r) => r.level === 'analyse'));
    for (const row of report) {
      assert.equal(row.seen, 0);
      assert.equal(row.correct, 0);
      assert.equal(row.accuracy, null);
      assert.ok(typeof row.label === 'string' && row.label.length > 0);
    }
  });

  test('reports accuracy for answered levels and null for the rest', () => {
    const profile = profileOf('apply', [...run('understand', 4, 3), ...run('apply', 2, 1)]);
    const byLevel = Object.fromEntries(levelReport(profile).map((r) => [r.level, r]));

    assert.equal(byLevel.understand.accuracy, 0.75);
    assert.equal(byLevel.apply.accuracy, 0.5);
    assert.equal(byLevel.remember.accuracy, null);
    assert.equal(byLevel.create.accuracy, null);
  });
});
