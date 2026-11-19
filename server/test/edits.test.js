// Phase 4 evidence - the question editor's rules, tested without a server.
//
// The subject is services/edits.js, which is pure: questions in, questions or a
// refusal out. What is being pinned down here is the product's central claim -
// that the Bloom level chooses the interaction - plus the two operations that
// can quietly produce an unanswerable item if nobody checks them, split and
// merge.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { applyEdit, authorQuestion, patchFor, splitQuestion, mergeQuestions } from '../src/services/edits.js';
import { richText } from '../src/services/richText.js';
import { invalidReason } from '../src/questionTypes.js';

const base = { _id: 'q1', contentId: 'c1', topic: 'Photosynthesis', status: 'active', source: 'llm' };

const mcq = () => ({
  ...base,
  text: 'Which pigment absorbs light in photosynthesis?',
  bloom: 'remember',
  kind: 'mcq',
  options: ['Chlorophyll.', 'Keratin.', 'Haemoglobin.', 'Collagen.'],
  answerIdx: 0,
});

const match = () => ({
  ...base,
  text: 'Match each stage to where it happens.',
  bloom: 'understand',
  kind: 'match',
  pairs: [
    { left: 'Light reactions', right: 'Thylakoid membrane' },
    { left: 'Calvin cycle', right: 'Stroma' },
    { left: 'Gas exchange', right: 'Stomata' },
  ],
});

const categorise = (over = {}) => ({
  ...base,
  text: 'Sort each term into the stage it belongs to.',
  bloom: 'understand',
  kind: 'categorise',
  buckets: [
    { name: 'Light reactions', items: ['Photolysis', 'ATP synthesis'] },
    { name: 'Calvin cycle', items: ['Carbon fixation', 'Reduction'] },
  ],
  ...over,
});

const multi = (over = {}) => ({
  ...base,
  text: 'Which of these hold for the light reactions? Select all that apply.',
  bloom: 'analyse',
  kind: 'multi',
  options: ['Water is split.', 'Oxygen is released.', 'Glucose is built.', 'Carbon is fixed.', 'ATP is made.', 'Starch is stored.'],
  answerIdxs: [0, 1, 4],
  ...over,
});

const order = () => ({
  ...base,
  text: 'Put these in the order the chapter introduces them.',
  bloom: 'evaluate',
  kind: 'order',
  sequence: ['Absorption', 'Photolysis', 'Electron transport', 'Carbon fixation'],
});

const cloze = () => ({
  ...base,
  text: 'Light strikes ____, water is split into ____, electrons pass to ____ and carbon is fixed in the ____.',
  bloom: 'apply',
  kind: 'cloze',
  blanks: [
    { accept: ['chlorophyll'] },
    { accept: ['oxygen'] },
    { accept: ['NADP+', 'NADP'] },
    { accept: ['stroma'] },
  ],
});

describe('applyEdit - the level chooses the interaction', () => {
  test('a full payload edit of a non-mcq kind is accepted', () => {
    const { question, reason } = applyEdit(match(), {
      text: 'Match each stage to the place it happens.',
      pairs: [
        { left: 'Light reactions', right: 'Thylakoid membrane' },
        { left: 'Calvin cycle', right: 'Stroma' },
        { left: 'Transpiration', right: 'Stomata' },
        { left: 'Storage', right: 'Amyloplast' },
      ],
    });
    assert.equal(reason, undefined);
    assert.equal(question.pairs.length, 4);
    assert.equal(question.text, 'Match each stage to the place it happens.');
    assert.equal(invalidReason(question), null);
  });

  test('a swap inside the level is allowed', () => {
    const { question, reason } = applyEdit(mcq(), {
      kind: 'truefalse',
      text: 'Chlorophyll is the pigment that absorbs light in photosynthesis.',
      answerBool: true,
    });
    assert.equal(reason, undefined);
    assert.equal(question.kind, 'truefalse');
    // The four options are left on the document, so changing your mind about
    // the swap does not cost you the work.
    assert.equal(question.options.length, 4);
  });

  test('a swap across levels is refused, and says why the product works that way', () => {
    const { question, reason } = applyEdit(mcq(), { kind: 'order' });
    assert.equal(question, undefined);
    assert.match(reason, /Remember is asked as/);
    assert.match(reason, /the level chooses the interaction/);
  });

  test('a swap inside the level still has to be a valid item of the new kind', () => {
    const { reason } = applyEdit(mcq(), { kind: 'truefalse' });
    // The validator's own wording, verbatim - it is written to be read.
    assert.equal(reason, 'truefalse needs answerBool true or false');
  });

  test('retagging the level takes the interaction with it', () => {
    const { question, reason } = applyEdit(mcq(), { bloom: 'understand' });
    assert.equal(question, undefined);
    assert.match(reason, /Understand is asked as/);
    // The reason from the validator is carried through unchanged.
    assert.match(reason, /match needs 3-5 pairs/);
  });

  test('retagging is allowed where the same interaction serves both levels', () => {
    const { question, reason } = applyEdit(categorise(), { bloom: 'analyse' });
    assert.equal(reason, undefined);
    assert.equal(question.kind, 'categorise');
    assert.equal(question.bloom, 'analyse');
  });

  test('an empty option is named rather than quietly dropped', () => {
    const { reason } = applyEdit(mcq(), { options: ['Chlorophyll.', '', 'Haemoglobin.', 'Collagen.'] });
    assert.equal(reason, 'mcq has an empty option');
  });

  test('patchFor carries every field the kind needs', () => {
    const patch = patchFor(categorise());
    assert.equal(patch.kind, 'categorise');
    assert.equal(patch.buckets.length, 2);
    assert.equal(patch.bloom, 'understand');
  });
});

describe('splitQuestion', () => {
  test('a multi splits and re-indexes its answer key', () => {
    const { parts, reason } = splitQuestion(multi({ answerIdxs: [0, 1, 4, 5] }));
    assert.equal(reason, undefined);
    assert.equal(parts.length, 2);
    for (const part of parts) {
      assert.equal(invalidReason(part), null);
      assert.equal(part.options.length, 4);
      // Every index points at an option of the half it now lives in.
      for (const i of part.answerIdxs) assert.ok(i >= 0 && i < part.options.length);
    }
    assert.deepEqual(parts[0].answerIdxs, [0, 1]);
    assert.deepEqual(parts[1].answerIdxs.map((i) => parts[1].options[i]), ['ATP is made.', 'Starch is stored.']);
  });

  test('an order keeps each half in its own correct order', () => {
    const { parts } = splitQuestion(order());
    assert.deepEqual(parts[0].sequence, ['Absorption', 'Photolysis', 'Electron transport']);
    assert.deepEqual(parts[1].sequence, ['Photolysis', 'Electron transport', 'Carbon fixation']);
    for (const part of parts) assert.equal(invalidReason(part), null);
  });

  test('halves that would share a stem are numbered', () => {
    // Two rows with identical wording read as a duplicate in the bank and as a
    // repeat on the phone, whichever half the student is served.
    const { parts } = splitQuestion(order());
    assert.ok(parts[0].text.endsWith('(part 1)'));
    assert.ok(parts[1].text.endsWith('(part 2)'));
  });

  test('a cloze divides into two passages that each still read', () => {
    const { parts, reason } = splitQuestion(cloze());
    assert.equal(reason, undefined);
    for (const part of parts) {
      assert.equal(invalidReason(part), null);
      assert.equal(part.text.split('____').length - 1, 2);
      assert.equal(part.blanks.length, 2);
    }
    // The second half opens where the cut left it, not on the comma that used
    // to join it to the first.
    assert.equal(parts[0].text, 'Light strikes ____, water is split into ____');
    assert.equal(parts[1].text, 'Electrons pass to ____ and carbon is fixed in the ____.');
  });

  test('an mcq refuses, because four options is the whole question', () => {
    const { parts, reason } = splitQuestion(mcq());
    assert.equal(parts, undefined);
    assert.match(reason, /Choose one/);
  });

  test('a match at the floor refuses rather than producing two short ones', () => {
    const { reason } = splitQuestion(match());
    assert.match(reason, /3-5 pairs/);
  });

  test('a split that would break the kind is refused with the rule it broke', () => {
    // Only one correct answer on the right-hand half.
    const { parts, reason } = splitQuestion(multi({ answerIdxs: [0, 1, 5] }));
    assert.equal(parts, undefined);
    assert.match(reason, /multi needs 2\+ correct answers/);
  });
});

describe('mergeQuestions', () => {
  test('a split and a merge are each other, and the answer key survives both', () => {
    const { parts } = splitQuestion(multi({ answerIdxs: [0, 1, 4, 5] }));
    const [left, right] = parts.map((p, i) => ({ ...p, _id: `part${i}` }));
    const { question, reason } = mergeQuestions(left, right);
    assert.equal(reason, undefined);
    assert.deepEqual(question.options, multi().options);
    assert.deepEqual(question.answerIdxs, [0, 1, 4, 5]);
    // The "(part 1)" a split leaves behind is this code's bookkeeping, so it
    // does not survive the parts being put back together.
    assert.equal(question.text, multi().text);
  });

  test('match pairs concatenate', () => {
    const a = match();
    const b = {
      ...match(),
      _id: 'q2',
      pairs: [{ left: 'Transpiration', right: 'Leaf surface' }],
    };
    const { question, reason } = mergeQuestions(a, b);
    assert.equal(reason, undefined);
    assert.equal(question.pairs.length, 4);
    assert.equal(invalidReason(question), null);
  });

  test('categorise groups of the same name are unioned', () => {
    const a = categorise();
    const b = categorise({
      _id: 'q2',
      buckets: [{ name: 'Light reactions', items: ['Photolysis', 'Electron transport'] }],
    });
    const { question, reason } = mergeQuestions(a, b);
    assert.equal(reason, undefined);
    assert.equal(question.buckets.length, 2);
    // Photolysis was already there; it does not arrive twice.
    assert.deepEqual(question.buckets[0].items, ['Photolysis', 'ATP synthesis', 'Electron transport']);
  });

  test('an item claimed by two groups is refused with the rule it broke', () => {
    const a = categorise();
    const b = categorise({
      _id: 'q2',
      buckets: [{ name: 'Calvin cycle', items: ['Photolysis'] }],
    });
    const { question, reason } = mergeQuestions(a, b);
    assert.equal(question, undefined);
    assert.match(reason, /the same item appears in two categorise groups/);
  });

  test('multi options combine and the answer key is rebuilt', () => {
    const a = multi({ options: ['Water is split.', 'Oxygen is released.', 'Glucose is built.', 'Carbon is fixed.'], answerIdxs: [0, 1] });
    const b = multi({ _id: 'q2', options: ['Water is split.', 'ATP is made.', 'Starch is stored.', 'Glucose is built.'], answerIdxs: [0, 1] });
    const { question, reason } = mergeQuestions(a, b);
    assert.equal(reason, undefined);
    assert.equal(question.options.length, 6);
    assert.deepEqual(
      question.answerIdxs.map((i) => question.options[i]),
      ['Water is split.', 'Oxygen is released.', 'ATP is made.'],
    );
    assert.equal(invalidReason(question), null);
  });

  test('an option that is correct in one and wrong in the other is refused', () => {
    const a = multi({ options: ['Water is split.', 'Oxygen is released.', 'Glucose is built.', 'Carbon is fixed.'], answerIdxs: [0, 1] });
    const b = multi({ _id: 'q2', options: ['Water is split.', 'ATP is made.', 'Starch is stored.', 'Sugar is exported.'], answerIdxs: [1, 2] });
    const { question, reason } = mergeQuestions(a, b);
    assert.equal(question, undefined);
    assert.match(reason, /correct in one of these and wrong in the other/);
  });

  test('two levels cannot merge into one question', () => {
    const { reason } = mergeQuestions(match(), { ...match(), _id: 'q2', bloom: 'analyse', kind: 'multi' });
    assert.match(reason, /Understand|Analyse/);
  });

  test('two questions from different chapters cannot merge', () => {
    const { reason } = mergeQuestions(match(), { ...match(), _id: 'q2', contentId: 'c2' });
    assert.match(reason, /different chapters/);
  });

  test('an ordering has no merged answer, and says so', () => {
    const { question, reason } = mergeQuestions(order(), { ...order(), _id: 'q2' });
    assert.equal(question, undefined);
    assert.match(reason, /sits inside the other/);
  });
});

// The client session's ask of 19 Nov 2026: a hand-written question's text used to
// be run onto one line here, so a fenced code block arrived as one line of
// backticks, `rich` came back {} and every screen showed the raw fence.
describe('a hand-written question keeps its lines', () => {
  const CODE = 'What does this print?\n```python\nfor i in range(2):\n    print(i)\n```';

  test('an edit keeps line breaks and indentation, tidying only line ends, trailing spaces and blank lines around it', async () => {
    const sent = '\r\n  \nWhat does this print?  \r\n```python\t\r\nfor i in range(2):\r\n    print(i)   \r\n```\r\n\r\n';
    const { question, reason } = applyEdit(mcq(), { text: sent });
    assert.equal(reason, undefined);
    assert.equal(question.text, CODE);
    assert.equal(patchFor(question).text, CODE);
    // What every screen renders it with: one code block, and no backticks left as text.
    const shown = await richText(question.text);
    assert.equal(shown.code, 1);
    assert.match(shown.html, /<pre/);
    assert.doesNotMatch(shown.html, /```/);
  });

  test('a question written from scratch keeps them too; the other fields still collapse', () => {
    const { question, reason } = authorQuestion({
      bloom: 'remember', kind: 'mcq', text: `${CODE}\n\n`, options: ['0 then 1  ', ' 1 then  2', '2', 'nothing'], answerIdx: 0,
    });
    assert.equal(reason, undefined);
    assert.equal(question.text, CODE);
    assert.deepEqual(question.options, ['0 then 1', '1 then 2', '2', 'nothing']);
  });

  test('a text of blank lines and spaces is still no text', () => {
    assert.equal(applyEdit(mcq(), { text: ' \r\n \t\n ' }).reason, 'missing text');
  });

  test('a split of a stem of several lines numbers each half on a line of its own, and a merge takes it off again', async () => {
    const stem = 'Which of these hold?\n```text\nstep = 1\n```';
    const { parts, reason } = splitQuestion({ ...multi({ answerIdxs: [0, 1, 4, 5] }), text: stem });
    assert.equal(reason, undefined);
    assert.equal(parts[0].text, `${stem}\n\n(part 1)`);
    assert.equal(parts[1].text, `${stem}\n\n(part 2)`);
    // The fence still closes, so the code is still code.
    const shown = await richText(parts[0].text);
    assert.equal(shown.code, 1);
    assert.doesNotMatch(shown.html, /```/);
    const [left, right] = parts.map((p, i) => ({ ...p, _id: `part${i}` }));
    assert.equal(mergeQuestions(left, right).question.text, stem);
    // A stem of one line keeps its number on that line, as before.
    assert.equal(splitQuestion(order()).parts[0].text, `${order().text} (part 1)`);
  });
});
