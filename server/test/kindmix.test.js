// Phase 2 - several kinds per level (services/plan.js, services/generate.js).
//
// Pinned here: the kind mix only ever divides a level's count and never changes
// it, so every caller sees the same number of questions per topic and per level
// as before the mix existed; the default spreads every level that has more than
// one kind over at least two; no selected-response kind is ever planned,
// generated or accepted at Create, however it is asked for; and the model's
// output is judged against the kinds the plan approved.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LEVELS, CEILING } from '../src/bloom.js';
import { KINDS_FOR_LEVEL, KIND_FOR_LEVEL, DEFAULT_KIND_MIX, kindSuitsLevel } from '../src/questionTypes.js';
import { isSelectedResponse } from '../src/services/checks.js';
import {
  planBank, PRESETS, spreadKinds, countKinds, resolveKindMix, kindAllowedAt,
} from '../src/services/plan.js';
import { config } from '../src/config.js';
import { fallbackForTopic, generateBank, validateItems, contextForTopic } from '../src/services/generate.js';
import { SAMPLE } from '../src/sampleContent.js';

// Generation must take the offline templates whatever server/.env holds.
config.gemini.apiKey = '';

const T = (n) => Array.from({ length: n }, (_, i) => `Topic ${i + 1}`);
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const byLevel = (items) => LEVELS.reduce((a, l) => ({ ...a, [l]: items.filter((q) => q.bloom === l).length }), {});

describe('the default kind mix', () => {
  test('every kind in it belongs to its level, and the level\'s default kind comes first', () => {
    for (const level of LEVELS) {
      const kinds = Object.keys(DEFAULT_KIND_MIX[level]);
      assert.equal(kinds[0], KIND_FOR_LEVEL[level], level);
      for (const kind of kinds) assert.ok(kindSuitsLevel(kind, level), `${kind} at ${level}`);
    }
  });

  test('every level whose set has two or more kinds is spread over at least two', () => {
    for (const level of LEVELS) {
      const want = Math.min(2, KINDS_FOR_LEVEL[level].length);
      assert.ok(Object.keys(DEFAULT_KIND_MIX[level]).length >= want, level);
    }
  });

  test('Create offers no selected-response kind, in its set or in the default', () => {
    for (const kind of KINDS_FOR_LEVEL[CEILING]) assert.equal(isSelectedResponse(kind), false, kind);
    for (const kind of Object.keys(DEFAULT_KIND_MIX[CEILING])) assert.equal(isSelectedResponse(kind), false, kind);
  });

  test('kindAllowedAt: the level\'s own set, never selected response at Create', () => {
    assert.equal(kindAllowedAt('hottext', 'analyse'), true);
    assert.equal(kindAllowedAt('table', 'apply'), true);
    assert.equal(kindAllowedAt('hottext', 'apply'), false);
    assert.equal(kindAllowedAt('open', 'create'), true);
    for (const kind of ['mcq', 'multi', 'truefalse', 'match', 'order', 'rank', 'categorise', 'hottext', 'dropdown', 'grid']) {
      assert.equal(kindAllowedAt(kind, 'create'), false, kind);
    }
  });
});

describe('spreadKinds', () => {
  test('one cycle of whole-number weights gives each kind exactly its weight', () => {
    assert.deepEqual(countKinds(spreadKinds({ mcq: 2, truefalse: 1 }, 3)), { mcq: 2, truefalse: 1 });
    assert.deepEqual(countKinds(spreadKinds({ blank: 1, cloze: 1, dropdown: 1, table: 1 }, 8)),
      { blank: 2, cloze: 2, dropdown: 2, table: 2 });
  });

  test('counts handed in as weights come back as exactly those counts', () => {
    const counts = { multi: 3, hottext: 1, grid: 2 };
    assert.deepEqual(countKinds(spreadKinds(counts, 6)), counts);
  });

  test('a one-item run lands on the first kind on a tie, and on the heaviest otherwise', () => {
    assert.deepEqual(spreadKinds({ order: 1, rank: 1 }, 1), ['order']);
    assert.deepEqual(spreadKinds({ mcq: 2, truefalse: 1 }, 1), ['mcq']);
    for (const level of LEVELS) assert.deepEqual(spreadKinds(DEFAULT_KIND_MIX[level], 1), [KIND_FOR_LEVEL[level]], level);
  });

  test('a shared carry continues the rotation from one call to the next', () => {
    const carry = {};
    const runs = [1, 1, 1, 1].map(() => spreadKinds({ order: 1, rank: 1 }, 1, carry)[0]);
    assert.deepEqual(runs, ['order', 'rank', 'order', 'rank']);
  });

  test('no positive weight, no kinds', () => {
    assert.deepEqual(spreadKinds({}, 3), []);
    assert.deepEqual(spreadKinds({ mcq: 0 }, 3), []);
  });
});

describe('planBank with a kind mix: counts preserved', () => {
  test('the default plan has the same total, levels and topic spread as before the mix', () => {
    const six = planBank(T(6), {});
    assert.equal(six.total, 72);
    assert.deepEqual(six.perLevel, { remember: 18, understand: 18, apply: 12, analyse: 12, evaluate: 6, create: 6 });
    assert.deepEqual(six.topics.map((t) => t.count), [12, 12, 12, 12, 12, 12]);
    assert.deepEqual(six.topics[0].mix, { remember: 3, understand: 3, apply: 2, analyse: 2, evaluate: 1, create: 1 });

    const three = planBank(T(3), { total: 24 });
    assert.equal(three.total, 24);
    assert.deepEqual(three.perLevel, { remember: 6, understand: 6, apply: 4, analyse: 4, evaluate: 2, create: 2 });
    assert.deepEqual(three.topics.map((t) => t.count), [8, 8, 8]);

    const thin = planBank(T(5), { total: 7 });
    assert.deepEqual(thin.topics.map((t) => t.count), [2, 2, 1, 1, 1]);
  });

  test('every topic\'s kinds add up to its level counts, and the bank\'s to perLevel and total', () => {
    const specs = [{}, { total: 24 }, { total: 7 }, { perTopic: 5 }, { preset: 'higher', total: 40 }, { total: 200 },
      { weights: [1, 2, 3, 4, 5], total: 31 }, { kinds: { remember: 'truefalse' } },
      { kindMix: { apply: { table: 3, dropdown: 1 }, analyse: { grid: 1 } } }];
    for (const n of [1, 2, 5, 12]) {
      for (const spec of specs) {
        const plan = planBank(T(n), spec.weights ? { ...spec, weights: spec.weights.slice(0, n).concat(Array(Math.max(0, n - 5)).fill(1)) } : spec);
        for (const t of plan.topics) {
          for (const level of LEVELS) assert.equal(sum(t.kinds[level]), t.mix[level], `${n} ${JSON.stringify(spec)} ${t.topic} ${level}`);
        }
        for (const level of LEVELS) assert.equal(sum(plan.perLevelKind[level]), plan.perLevel[level]);
        assert.equal(sum(plan.perKind), plan.total);
      }
    }
  });

  test('the default spreads each level over at least two kinds where the level allows it', () => {
    const plan = planBank(T(6), {});
    for (const level of LEVELS) {
      const kinds = Object.keys(plan.perLevelKind[level]);
      if (Object.keys(DEFAULT_KIND_MIX[level]).length >= 2) assert.ok(kinds.length >= 2, `${level}: ${kinds}`);
      else assert.deepEqual(kinds, ['open']);
    }
    // Inside one topic too, wherever the topic has two or more at a level.
    for (const t of plan.topics) {
      for (const level of ['remember', 'understand', 'apply', 'analyse']) {
        assert.ok(Object.keys(t.kinds[level]).length >= 2, `${t.topic} ${level}`);
      }
    }
  });

  test('a level with one question a topic alternates its kinds from topic to topic', () => {
    const plan = planBank(T(6), {});
    const evaluate = plan.topics.map((t) => Object.keys(t.kinds.evaluate)[0]);
    assert.deepEqual(evaluate, ['order', 'rank', 'order', 'rank', 'order', 'rank']);
  });

  test('`kinds` asks a whole level as one kind, as before', () => {
    const plan = planBank(T(3), { kinds: { remember: 'truefalse', apply: 'Dropdown' } });
    assert.deepEqual(plan.perLevelKind.remember, { truefalse: plan.perLevel.remember });
    assert.deepEqual(plan.perLevelKind.apply, { dropdown: plan.perLevel.apply });
    assert.equal(plan.kinds.remember, 'truefalse');
    assert.deepEqual(plan.warnings, []);
  });

  test('`kindMix` divides a level in proportion, and wins over `kinds` for the same level', () => {
    const plan = planBank(T(6), { kinds: { analyse: 'multi' }, kindMix: { analyse: { grid: 2, hottext: 1 } } });
    assert.deepEqual(plan.perLevelKind.analyse, { grid: 8, hottext: 4 });
    assert.deepEqual(plan.kindMix.analyse, { hottext: 1, grid: 2 });
  });

  test('a kind from another level is refused out loud, and the count is untouched', () => {
    const plan = planBank(T(3), { kindMix: { analyse: { grid: 1, open: 3, mcq: 1 } } });
    assert.deepEqual(plan.perLevelKind.analyse, { grid: plan.perLevel.analyse });
    assert.ok(plan.warnings.some((w) => /Analyse cannot be asked as "Write your answer"/.test(w)), plan.warnings.join(' | '));
    assert.ok(plan.warnings.some((w) => /Analyse cannot be asked as "Choose one"/.test(w)));

    const none = planBank(T(3), { kindMix: { understand: { open: 1 } } });
    assert.deepEqual(Object.keys(none.perLevelKind.understand).sort(), ['categorise', 'match']);
    assert.ok(none.warnings.some((w) => /Understand was given no kind it can be asked as - kept Match the pairs and Sort into groups/.test(w)));

    const negative = planBank(T(3), { kindMix: { remember: { mcq: 1, truefalse: -2 } } });
    assert.deepEqual(negative.perLevelKind.remember, { mcq: negative.perLevel.remember });
    assert.ok(negative.warnings.some((w) => /needs a weight of zero or more/.test(w)));
  });

  test('no selected-response kind is ever planned at Create, however it is asked for', () => {
    const asks = [
      {}, { kinds: { create: 'mcq' } }, { kinds: { create: 'multi' } }, { kinds: { create: 'truefalse' } },
      { kindMix: { create: { mcq: 5, multi: 2, open: 1 } } }, { kindMix: { create: { order: 1, match: 1 } } },
    ];
    for (const preset of Object.keys(PRESETS)) {
      for (const ask of asks) {
        const plan = planBank(T(4), { preset, total: 48, ...ask });
        for (const t of plan.topics) {
          for (const kind of Object.keys(t.kinds.create ?? {})) assert.equal(isSelectedResponse(kind), false, `${preset} ${kind}`);
        }
        assert.ok(Object.keys(plan.perLevelKind.create).every((k) => k === 'open'));
      }
    }
    const asked = planBank(T(2), { kinds: { create: 'mcq' } });
    assert.ok(asked.warnings.some((w) => /Create cannot be asked as "Choose one" - kept Write your answer/.test(w)));
  });

  test('resolveKindMix: a level nobody named gets the default', () => {
    const mix = resolveKindMix({ kinds: { remember: 'truefalse' } });
    assert.deepEqual(mix.remember, { truefalse: 1 });
    assert.deepEqual(mix.apply, DEFAULT_KIND_MIX.apply);
  });
});

describe('generation with a kind mix: the offline templates', () => {
  test('each sample topic gets exactly the plan\'s count per level, from the level\'s own kinds', () => {
    for (const topic of SAMPLE.topics) {
      const items = fallbackForTopic({ topic, contextText: contextForTopic(SAMPLE.rawText, topic) });
      assert.deepEqual(byLevel(items), { remember: 3, understand: 3, apply: 2, analyse: 2, evaluate: 1, create: 1 }, topic);
      for (const q of items) {
        assert.ok(kindSuitsLevel(q.kind, q.bloom), `${q.kind} at ${q.bloom}`);
        if (q.bloom === CEILING) assert.equal(isSelectedResponse(q.kind), false);
      }
      // Remember and Understand have three questions each: both are spread.
      for (const level of ['remember', 'understand']) {
        assert.ok(new Set(items.filter((q) => q.bloom === level).map((q) => q.kind)).size >= 2, `${topic} ${level}`);
      }
    }
  });

  test('a whole bank from a plan has the plan\'s numbers, per topic and per level, and all four new kinds', async () => {
    const plan = planBank(SAMPLE.topics, {});
    const { questions, perLevel } = await generateBank({ content: { rawText: SAMPLE.rawText, topics: SAMPLE.topics }, topics: SAMPLE.topics, plan });
    assert.equal(questions.length, plan.total);
    assert.deepEqual(perLevel, plan.perLevel);
    for (const t of plan.topics) assert.equal(questions.filter((q) => q.topic === t.topic).length, t.count, t.topic);
    const kinds = new Set(questions.map((q) => q.kind));
    for (const kind of ['hottext', 'dropdown', 'table', 'grid']) assert.ok(kinds.has(kind), kind);
    for (const level of LEVELS.filter((l) => l !== CEILING)) {
      assert.ok(new Set(questions.filter((q) => q.bloom === level).map((q) => q.kind)).size >= 2, level);
    }
    assert.ok(questions.filter((q) => q.bloom === CEILING).every((q) => !isSelectedResponse(q.kind)));
  });

  test('a bank with no plan (the seed path) keeps its old size and is spread too', async () => {
    const { questions } = await generateBank({ content: { rawText: SAMPLE.rawText }, topics: SAMPLE.topics.slice(0, 3), perTopic: 12 });
    assert.equal(questions.length, 36);
    assert.deepEqual(byLevel(questions), { remember: 9, understand: 9, apply: 6, analyse: 6, evaluate: 3, create: 3 });
    assert.ok(new Set(questions.filter((q) => q.bloom === 'apply').map((q) => q.kind)).size >= 2);
  });

  test('a one-question request (regenerate, Harder, Easier) still lands on the level\'s default kind', () => {
    for (const level of LEVELS) {
      const [q] = fallbackForTopic({ topic: SAMPLE.topics[0], contextText: SAMPLE.rawText, mix: { [level]: 1 } });
      assert.equal(q?.bloom, level);
      assert.equal(q.kind, KIND_FOR_LEVEL[level], level);
    }
  });

  test('asked for a selected-response kind at Create, the generator still writes a written answer', () => {
    const items = fallbackForTopic({ topic: SAMPLE.topics[2], contextText: SAMPLE.rawText, mix: { create: 2 }, kinds: { create: 'mcq' } });
    assert.equal(items.length, 2);
    assert.ok(items.every((q) => q.bloom === 'create' && q.kind === 'open'));
  });
});

describe('validateItems: the model\'s output against the kinds the plan approved', () => {
  const plan = { remember: { mcq: 1, truefalse: 1 }, apply: { dropdown: 1, table: 1 }, analyse: { hottext: 1, grid: 1 }, create: { open: 1 } };
  const hottext = {
    bloom: 'analyse', kind: 'hottext', text: 'Pick the protocols.',
    tokens: ['TCP', 'and', 'UDP', 'both', 'use', 'ports.'], criterion: 'every word that names a protocol', answerIdxs: [0, 2],
  };
  const dropdown = {
    bloom: 'apply', kind: 'dropdown', text: 'A ____ opens with a ____ handshake.',
    gaps: [{ options: ['TCP connection', 'UDP datagram', 'port'], answerIdx: 0 }, { options: ['three-way', 'two-way'], answerIdx: 0 }],
  };
  const table = {
    bloom: 'apply', kind: 'table', text: 'Complete the table.', columns: ['Header size', 'Connection'],
    tableRows: [
      { header: 'TCP', cells: [{ given: '20 bytes', accept: [] }, { given: 'connection-oriented' }] },
      { header: 'UDP', cells: [{ accept: ['8 bytes', '8'] }, { given: '', accept: ['connectionless'] }] },
    ],
  };
  const grid = {
    bloom: 'analyse', kind: 'grid', text: 'Tick what each protocol does.', gridRows: ['TCP', 'UDP'], columns: ['Handshake', 'Checksum'],
    answers: [[true, true], ['false', true]],
  };

  test('each new kind, in the model\'s own field names, comes back stored the way the validator reads it', () => {
    const { valid, errors } = validateItems([hottext, dropdown, table, grid], 'Transport', plan);
    assert.deepEqual(errors, []);
    const [h, d, t, g] = valid;
    assert.deepEqual(h.tokens, hottext.tokens);
    assert.deepEqual(h.answerIdxs, [0, 2]);
    assert.deepEqual(d.blanks, dropdown.gaps);
    assert.deepEqual(t.rows[0].cells, [{ given: '20 bytes' }, { given: 'connection-oriented' }]);
    assert.deepEqual(t.rows[1].cells, [{ accept: ['8 bytes', '8'] }, { accept: ['connectionless'] }]);
    assert.deepEqual(g.rows, ['TCP', 'UDP']);
    assert.deepEqual(g.answers, [[true, true], [false, true]]);
    assert.deepEqual(valid.map((q) => q.kind), ['hottext', 'dropdown', 'table', 'grid']);
  });

  test('malformed items of each new kind are refused, never repaired', () => {
    const bad = [
      // An empty token is kept, not filtered, so the indices after it cannot slide.
      { ...hottext, tokens: ['TCP', '', 'UDP', 'use', 'ports.'], answerIdxs: [0, 2] },
      { ...hottext, answerIdxs: [0, 1, 2, 3, 4, 5] },
      { ...dropdown, gaps: [{ options: ['a', 'b'], answerIdx: 2 }, { options: ['c', 'd'], answerIdx: 0 }] },
      { ...dropdown, gaps: [{ options: ['TCP', 'None of the above'], answerIdx: 0 }, { options: ['c', 'd'], answerIdx: 0 }] },
      { ...table, tableRows: [{ header: 'TCP', cells: [{ given: 'x', accept: ['y'] }, { given: 'z' }] }, table.tableRows[1]] },
      { ...grid, answers: [[true, true], [true, true]] },
    ];
    const { valid, errors } = validateItems(bad, 'Transport', plan);
    assert.equal(valid.length, 0);
    assert.equal(errors.length, bad.length);
    assert.match(errors[0], /hottext has an empty token/);
    assert.match(errors[1], /cannot have every token correct/);
    assert.match(errors[2], /answerIdx out of range/);
    assert.match(errors[3], /forbidden/);
    assert.match(errors[4], /never both/);
    assert.match(errors[5], /every intersection is true/);
  });

  test('a kind the plan did not ask the level as is refused when the plan names several', () => {
    const { valid, errors } = validateItems([{ ...grid, kind: 'multi' }], 'Transport', plan);
    assert.equal(valid.length, 0);
    assert.match(errors[0], /kind "multi" is not one this plan asks analyse as \(hottext, grid\)/);
  });

  test('where the plan names one kind, an item is judged as that kind whatever it claims, as before', () => {
    const { valid, errors } = validateItems([{ bloom: 'create', kind: 'mcq', text: 'Design a protocol.', options: ['a', 'b', 'c', 'd'], answerIdx: 0, rubric: ['reliable delivery order', 'flow control window'] }], 'T', plan);
    assert.deepEqual(errors, []);
    assert.equal(valid[0].kind, 'open');
    // And no selected-response kind is accepted at Create even when asked for one.
    const asked = validateItems([{ bloom: 'create', kind: 'mcq', text: 'Which?', options: ['a', 'b', 'c', 'd'], answerIdx: 0 }], 'T', { create: 'mcq' });
    assert.equal(asked.valid.length, 0);
    assert.match(asked.errors[0], /\(open\) rejected: open needs 2-5 rubric points/);
  });
});
