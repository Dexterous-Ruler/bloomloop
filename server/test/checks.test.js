// Phase 2 - the rule checks shown beside a draft (services/checks.js).
//
// Every check is tested both ways: a question that trips it and one that does
// not. They are advice, so what matters is that each fires on the flaw the
// report names and stays quiet on the ordinary wording around it - a check that
// fires on "Which of the following" or "Select all that apply" would be noise on
// every second question, and a professor would stop reading them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runChecks, failedChecks, sameOption, isSelectedResponse, CHECK_IDS } from '../src/services/checks.js';
import { fallbackForTopic } from '../src/services/generate.js';
import { SAMPLE } from '../src/sampleContent.js';

const mcq = (over = {}) => ({
  text: 'Which pigment absorbs light in photosynthesis?',
  bloom: 'remember',
  kind: 'mcq',
  options: ['Chlorophyll.', 'Keratin.', 'Haemoglobin.', 'Collagen.'],
  answerIdx: 0,
  ...over,
});

/** The one result with this id, or undefined if the check does not apply. */
const check = (q, id) => runChecks(q).find((c) => c.id === id);
const fails = (q, id) => check(q, id)?.ok === false;
const passes = (q, id) => check(q, id)?.ok === true;

describe('every result', () => {
  test('is {id, ok, message}, in CHECK_IDS order, with a sentence to show', () => {
    const results = runChecks(mcq());
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.deepEqual(Object.keys(r).sort(), ['id', 'message', 'ok']);
      assert.equal(typeof r.ok, 'boolean');
      assert.ok(typeof r.message === 'string' && r.message.length > 10, r.id);
    }
    const order = results.map((r) => CHECK_IDS.indexOf(r.id));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  test('a clean mcq passes every check that applies to it', () => {
    assert.deepEqual(failedChecks(runChecks(mcq())), []);
  });

  test('only the checks that apply to a kind are run', () => {
    const ids = (q) => runChecks(q).map((r) => r.id);
    assert.deepEqual(ids(mcq()), CHECK_IDS.filter((id) => id !== 'empty-rubric'));
    assert.deepEqual(ids({ text: 'Explain osmosis.', bloom: 'create', kind: 'open', rubric: ['water moves', 'across membrane'] }),
      ['empty-rubric', 'slide-only-reference', 'create-selected-response']);
    // A poll's level is positional, so the Create rule does not judge it.
    assert.deepEqual(ids({ text: 'How sure are you?', bloom: 'create', kind: 'poll', options: ['Agree', 'Strongly agree'] }),
      ['duplicate-options', 'slide-only-reference']);
  });

  test('nothing to check is an empty list, and failedChecks takes a never-checked null', () => {
    assert.deepEqual(runChecks(null), []);
    assert.deepEqual(failedChecks(null), []);
    assert.deepEqual(failedChecks([{ id: 'x', ok: false, message: 'm' }, { id: 'y', ok: true, message: 'n' }]),
      [{ id: 'x', message: 'm' }]);
  });
});

describe('longest-option-is-key', () => {
  const long = 'Chlorophyll, the green pigment held in the thylakoid membranes of the chloroplast.';

  test('fires when the answer is clearly the longest option', () => {
    assert.ok(fails(mcq({ options: [long, 'Keratin.', 'Haemoglobin.', 'Collagen.'] }), 'longest-option-is-key'));
  });

  test('does not fire when the answer is longest by a hair, or not longest', () => {
    assert.ok(passes(mcq({ options: ['Chlorophyll a.', 'Keratin b.', 'Haemoglobin.', 'Collagen x.'] }), 'longest-option-is-key'));
    assert.ok(passes(mcq({ options: ['Chlorophyll.', long, 'Haemoglobin.', 'Collagen.'] }), 'longest-option-is-key'));
  });

  test('on a multi, fires only when every correct option outruns every wrong one', () => {
    const multi = {
      text: 'Which happen in the light reactions? Select all that apply.',
      bloom: 'analyse',
      kind: 'multi',
      options: ['Water is split by the oxygen-evolving complex.', 'Short.', 'ATP is made by the ATP synthase enzyme.', 'Tiny.'],
      answerIdxs: [0, 2],
    };
    assert.ok(fails(multi, 'longest-option-is-key'));
    assert.ok(passes({ ...multi, answerIdxs: [0, 1] }, 'longest-option-is-key'));
  });
});

describe('absolute-words', () => {
  test('fires on always / never / all / none in an option', () => {
    const c = check(mcq({ options: ['Chlorophyll.', 'It always absorbs green.', 'Haemoglobin.', 'Collagen.'] }), 'absolute-words');
    assert.equal(c.ok, false);
    assert.match(c.message, /"always" in option 2/);
    assert.ok(fails(mcq({ options: ['Chlorophyll.', 'None at all.', 'Haemoglobin.', 'Collagen.'] }), 'absolute-words'));
  });

  test('fires on an absolute true/false statement, and not on a measured one', () => {
    const tf = (text) => ({ text, bloom: 'remember', kind: 'truefalse', answerBool: false });
    assert.ok(fails(tf('Plants never respire in the light.'), 'absolute-words'));
    assert.ok(passes(tf('Plants respire in the light as well as the dark.'), 'absolute-words'));
  });

  test('ignores "all that apply" and leaves "of the above" to its own check', () => {
    const multi = {
      text: 'Which are pigments? Select all that apply.',
      bloom: 'analyse',
      kind: 'multi',
      options: ['Chlorophyll.', 'Carotene.', 'Keratin.', 'All of the above.'],
      answerIdxs: [0, 1],
    };
    assert.ok(passes(multi, 'absolute-words'));
    assert.ok(fails(multi, 'all-none-of-the-above'));
  });

  test('matches whole words only', () => {
    assert.ok(passes(mcq({ options: ['Chlorophyll.', 'A tall allele.', 'Nonetheless.', 'Collagen.'] }), 'absolute-words'));
  });
});

describe('all-none-of-the-above', () => {
  test('fires on "none of the above" and "all of these"', () => {
    assert.ok(fails(mcq({ options: ['Chlorophyll.', 'Keratin.', 'Haemoglobin.', 'None of the above.'] }), 'all-none-of-the-above'));
    assert.ok(fails(mcq({ options: ['Chlorophyll.', 'Keratin.', 'Haemoglobin.', 'All of these.'] }), 'all-none-of-the-above'));
  });

  test('looks inside every dropdown gap', () => {
    const dropdown = {
      text: 'Light is absorbed by ____ in the ____.',
      bloom: 'apply',
      kind: 'dropdown',
      blanks: [
        { options: ['chlorophyll', 'keratin'], answerIdx: 0 },
        { options: ['thylakoid', 'neither of these'], answerIdx: 0 },
      ],
    };
    const c = check(dropdown, 'all-none-of-the-above');
    assert.equal(c.ok, false);
    assert.match(c.message, /Gap 2: option 2/);
  });

  test('does not fire on an ordinary option', () => {
    assert.ok(passes(mcq(), 'all-none-of-the-above'));
  });
});

describe('duplicate-options', () => {
  test('sameOption: case, punctuation and a leading article do not make two options different', () => {
    assert.ok(sameOption('The cell wall.', 'cell wall'));
    assert.ok(sameOption('Mitochondria produce most cellular energy', 'Mitochondria produce cellular energy.'));
    assert.ok(!sameOption('Increases sharply.', 'Increases slowly.'));
    // One word each: a scale, compared for equality only.
    assert.ok(!sameOption('Agree', 'Strongly agree'));
  });

  test('fires on two options that say the same thing', () => {
    const c = check(mcq({ options: ['Chlorophyll.', 'The cell wall.', 'Haemoglobin.', 'cell wall'] }), 'duplicate-options');
    assert.equal(c.ok, false);
    assert.match(c.message, /2 and 4 say the same thing/);
  });

  test('checks both columns of a match', () => {
    const match = {
      text: 'Match each part to its job.',
      bloom: 'understand',
      kind: 'match',
      pairs: [
        { left: 'Stomata', right: 'Let gases in and out of the leaf' },
        { left: 'Xylem', right: 'Carries water up the stem' },
        { left: 'Guard cells', right: 'Let the gases in and out of the leaf' },
      ],
    };
    assert.match(check(match, 'duplicate-options').message, /Right column: 1 and 3/);
    assert.ok(passes({ ...match, pairs: match.pairs.slice(0, 2) }, 'duplicate-options'));
  });

  test('does not fire on a clean list, or on a poll scale', () => {
    assert.ok(passes(mcq(), 'duplicate-options'));
    assert.ok(passes({ text: 'How sure are you?', bloom: 'understand', kind: 'poll', options: ['Agree', 'Strongly agree', 'Disagree'] }, 'duplicate-options'));
  });
});

describe('several-keys', () => {
  test('fires when a wrong option says the same as the answer', () => {
    const c = check(mcq({ options: ['Chlorophyll absorbs red light.', 'Chlorophyll absorbs the red light', 'Haemoglobin.', 'Collagen.'] }), 'several-keys');
    assert.equal(c.ok, false);
    assert.match(c.message, /option 2/);
  });

  test('two correct options of a multi saying the same thing is not this check', () => {
    const multi = {
      text: 'Which absorb light? Select all that apply.',
      bloom: 'analyse',
      kind: 'multi',
      options: ['Chlorophyll absorbs light.', 'The chlorophyll absorbs light', 'Keratin.', 'Collagen.'],
      answerIdxs: [0, 1],
    };
    assert.ok(passes(multi, 'several-keys'));
    assert.ok(fails({ ...multi, answerIdxs: [0, 2] }, 'several-keys'));
  });

  test('does not fire on distinct options', () => {
    assert.ok(passes(mcq(), 'several-keys'));
  });
});

describe('empty-rubric', () => {
  const open = (rubric) => ({ text: 'Explain osmosis in your own words.', bloom: 'create', kind: 'open', rubric });

  test('fires on a missing or empty rubric', () => {
    assert.match(check(open([]), 'empty-rubric').message, /rubric is empty/);
    assert.ok(fails(open(undefined), 'empty-rubric'));
    assert.ok(fails(open(['', '  ']), 'empty-rubric'));
  });

  test('fires on a point the marker can never find (no word over three letters)', () => {
    const c = check(open(['water moves across', 'is a the']), 'empty-rubric');
    assert.equal(c.ok, false);
    assert.match(c.message, /Rubric point 2/);
  });

  test('passes a rubric the marker can read', () => {
    assert.ok(passes(open(['water moves across', 'partially permeable membrane']), 'empty-rubric'));
  });
});

describe('slide-only-reference', () => {
  test('fires on a figure, a coloured curve or a figure number with no picture', () => {
    assert.ok(fails(mcq({ text: 'What does the figure show about the rate?' }), 'slide-only-reference'));
    assert.ok(fails(mcq({ text: 'What does the orange curve represent?' }), 'slide-only-reference'));
    assert.ok(fails(mcq({ text: 'In Fig. 3, which stage comes first?' }), 'slide-only-reference'));
    assert.match(check(mcq({ text: 'As shown on the slide, which pigment is it?' }), 'slide-only-reference').message, /on the slide/);
  });

  test('a figure is fine with an image or a passage attached; "shown above" is fine with any stimulus', () => {
    const image = { kind: 'image', url: '/u/leaf.png', alt: 'A leaf in cross-section' };
    const passage = { kind: 'passage', text: 'Chlorophyll absorbs red and blue light and reflects green.' };
    assert.ok(passes(mcq({ text: 'What does the diagram show?', stimulus: image }), 'slide-only-reference'));
    // The owner's decision of 19 Nov 2026: an attached passage clears it too.
    assert.ok(passes(mcq({ text: 'What does the diagram show?', stimulus: passage }), 'slide-only-reference'));
    assert.ok(passes(mcq({ text: 'What does the orange curve represent?', stimulus: passage }), 'slide-only-reference'));
    assert.ok(passes(mcq({ text: 'As shown above, which pigment absorbs red light?', stimulus: passage }), 'slide-only-reference'));
    // With nothing attached it still fails, and says a passage would do.
    assert.match(check(mcq({ text: 'What does the diagram show?' }), 'slide-only-reference').message, /the picture or a passage/);
  });

  test('does not fire on "Which of the following"', () => {
    assert.ok(passes(mcq({ text: 'Which of the following best identifies chlorophyll?' }), 'slide-only-reference'));
  });

  test('applies to every kind, the written answer included', () => {
    assert.ok(fails({ text: 'Explain the graph above.', bloom: 'create', kind: 'open', rubric: ['rate rises', 'then levels'] },
      'slide-only-reference'));
  });
});

describe('create-selected-response', () => {
  test('fires on a selected-response item tagged Create', () => {
    const c = check(mcq({ bloom: 'create' }), 'create-selected-response');
    assert.equal(c.ok, false);
    assert.match(c.message, /Create/);
    assert.ok(fails({ text: 'Put these in order.', bloom: 'create', kind: 'order', sequence: ['a', 'b', 'c'] },
      'create-selected-response'));
  });

  test('passes a written answer at Create, and a selected item below it', () => {
    assert.ok(passes({ text: 'Design a test.', bloom: 'create', kind: 'open', rubric: ['control group', 'one variable'] },
      'create-selected-response'));
    assert.ok(passes(mcq({ bloom: 'evaluate' }), 'create-selected-response'));
  });

  test('isSelectedResponse: picking kinds are, writing kinds are not', () => {
    for (const kind of ['mcq', 'truefalse', 'match', 'categorise', 'multi', 'order', 'rank', 'hottext', 'dropdown', 'grid']) {
      assert.equal(isSelectedResponse(kind), true, kind);
    }
    for (const kind of ['blank', 'cloze', 'numeric', 'open', 'table']) assert.equal(isSelectedResponse(kind), false, kind);
  });
});

describe('on the offline generator\'s own output', () => {
  test('every item from the sample chapter is checked without throwing, and none uses "of the above"', () => {
    const items = SAMPLE.topics.slice(0, 3).flatMap((topic) =>
      fallbackForTopic({ topic, contextText: SAMPLE.rawText, mix: { remember: 2, understand: 2, apply: 2, analyse: 2, evaluate: 1, create: 1 } }));
    assert.ok(items.length >= 20, `${items.length} items`);
    for (const item of items) {
      const results = runChecks(item);
      assert.ok(results.length >= 2, item.kind);
      assert.ok(passes(item, 'create-selected-response'), `${item.kind} at ${item.bloom}`);
      if (check(item, 'all-none-of-the-above')) assert.ok(passes(item, 'all-none-of-the-above'));
    }
  });
});
