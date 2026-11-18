// Phase 2 - the approval gate's rules, tested without a server.
//
// Pinned here: which way each status moves (services/edits.js), that no edit,
// split or merge turns a draft into something a room serves, how a professor's
// own question is validated, and how a question keeps the slides its topic came
// from (services/extract.js, services/generate.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyEdit,
  patchFor,
  splitQuestion,
  mergeQuestions,
  authorQuestion,
  needsApproval,
  approvePatch,
  rejectPatch,
  activatePatch,
} from '../src/services/edits.js';
import { deriveTopics, topicSlides } from '../src/services/extract.js';
import { sourceRefFor, OFFLINE_MODEL } from '../src/services/generate.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';

const AT = '2026-11-19T10:00:00.000Z';
const PROF = 'prof-1';

const multi = (over = {}) => ({
  _id: 'q1',
  contentId: 'c1',
  topic: 'Photosynthesis',
  source: 'fallback',
  text: 'Which of these hold for the light reactions? Select all that apply.',
  bloom: 'analyse',
  kind: 'multi',
  options: ['Water is split.', 'Oxygen is released.', 'Glucose is built.', 'Carbon is fixed.', 'ATP is made.', 'Starch is stored.'],
  answerIdxs: [0, 1, 3, 4],
  ...over,
});

const draft = (over = {}) => multi({
  status: 'draft', model: OFFLINE_MODEL, sourceRef: { kind: 'slides', slides: [3] }, approvedBy: null, approvedAt: null, ...over,
});
const approved = (over = {}) => draft({ status: 'active', approvedBy: PROF, approvedAt: AT, ...over });
/** A row from before the approval gate: active, nothing recorded. */
const legacy = (over = {}) => multi({ status: 'active', ...over });

describe('needsApproval', () => {
  test('model output nobody has approved needs it; a professor\'s or older question never does', () => {
    assert.equal(needsApproval(draft()), true);
    assert.equal(needsApproval(draft({ status: 'discarded' })), true, 'a rejected draft');
    assert.equal(needsApproval(approved()), false);
    assert.equal(needsApproval(legacy()), false);
    assert.equal(needsApproval(legacy({ status: 'discarded' })), false);
  });
});

describe('approve', () => {
  test('a draft becomes active, stamped with who and when', () => {
    assert.deepEqual(approvePatch(draft(), { by: PROF, at: AT }),
      { patch: { status: 'active', approvedBy: PROF, approvedAt: AT }, changed: true });
  });

  test('the shared key approves with no account but still a time', () => {
    const { patch } = approvePatch(draft(), { by: null, at: AT });
    assert.equal(patch.approvedBy, null);
    assert.equal(patch.approvedAt, AT);
  });

  test('approving again changes nothing', () => {
    assert.deepEqual(approvePatch(approved(), { by: 'someone-else', at: '2027-01-01T00:00:00.000Z' }), { patch: {}, changed: false });
  });

  test('approving an older active question records the approval; a rejected one comes back', () => {
    assert.equal(approvePatch(legacy(), { by: PROF, at: AT }).patch.approvedAt, AT);
    assert.equal(approvePatch(draft({ status: 'discarded' }), { by: PROF, at: AT }).patch.status, 'active');
  });
});

describe('reject', () => {
  test('uses the existing discarded status, and a repeat changes nothing', () => {
    assert.deepEqual(rejectPatch(draft()), { patch: { status: 'discarded' }, changed: true });
    assert.deepEqual(rejectPatch(approved()), { patch: { status: 'discarded' }, changed: true });
    assert.deepEqual(rejectPatch(draft({ status: 'discarded' })), { patch: {}, changed: false });
  });
});

describe('restore (PATCH status active, bulk restore)', () => {
  test('on unapproved model output it is the approval, and is recorded as one', () => {
    assert.deepEqual(activatePatch(draft(), { by: PROF, at: AT }), { status: 'active', approvedBy: PROF, approvedAt: AT });
    assert.deepEqual(activatePatch(draft({ status: 'discarded' }), { by: null, at: AT }),
      { status: 'active', approvedBy: null, approvedAt: AT });
  });

  test('on everything else it is the plain status change it always was', () => {
    assert.deepEqual(activatePatch(legacy({ status: 'discarded' }), { by: PROF, at: AT }), { status: 'active' });
    assert.deepEqual(activatePatch(approved({ status: 'discarded' }), { by: PROF, at: AT }), { status: 'active' });
  });
});

describe('editing keeps the status', () => {
  test('an edit\'s patch carries no status: active stays active, a draft stays a draft', () => {
    for (const q of [approved(), legacy(), draft()]) {
      const { question, reason } = applyEdit(q, { text: 'Which of these happen in the light reactions? Select all that apply.' });
      assert.equal(reason, undefined);
      const patch = patchFor(question);
      assert.equal('status' in patch, false);
      // What a repository does with it: the stored status is untouched.
      assert.equal({ ...q, ...patch }.status, q.status);
    }
  });

  test('and so on a real repository', async () => {
    const repo = createMemoryRepo();
    const strip = ({ _id, ...rest }) => rest;
    const [a, d] = await repo.insertQuestions([strip(approved()), strip(draft())]);
    for (const q of [a, d]) {
      const { question } = applyEdit(q, { text: 'Which of these happen in the light reactions? Select all that apply.' });
      const after = await repo.updateQuestion(q._id, patchFor(question));
      assert.equal(after.status, q.status);
      assert.equal(after.approvedAt, q.approvedAt);
    }
  });
});

describe('split and merge never turn a draft into a served question', () => {
  test('the halves of a draft are drafts, keeping its model and slides', () => {
    const { parts, reason } = splitQuestion(draft());
    assert.equal(reason, undefined);
    assert.equal(parts.length, 2);
    for (const part of parts) {
      assert.equal(part.status, 'draft');
      assert.equal(part.model, OFFLINE_MODEL);
      assert.deepEqual(part.sourceRef, { kind: 'slides', slides: [3] });
      assert.equal(part.approvedAt, null);
    }
  });

  test('the halves of an approved question stay active and approved', () => {
    const { parts } = splitQuestion(approved());
    for (const part of parts) {
      assert.equal(part.status, 'active');
      assert.equal(part.approvedAt, AT);
    }
    const { parts: old } = splitQuestion(legacy());
    assert.ok(old.every((p) => p.status === 'active' && p.model === null));
  });

  test('a draft merged with an approved question is a draft', () => {
    const b = { ...approved({ _id: 'q2' }), options: ['Water is split.', 'Oxygen is released.', 'Glucose is built.', 'Starch is stored.'], answerIdxs: [0, 1] };
    const { question, reason } = mergeQuestions(approved(), { ...b, status: 'draft', approvedBy: null, approvedAt: null });
    assert.equal(reason, undefined);
    assert.equal(question.status, 'draft');
    assert.equal(question.approvedAt, null);
    const both = mergeQuestions(approved(), b).question;
    assert.equal(both.status, 'active');
    assert.equal(both.model, OFFLINE_MODEL);
  });

  // A rejected draft is `discarded` with its model set and no approval: still
  // unreviewed model output, so nothing cut from it or joined to it may serve.
  test('the halves of a rejected draft are drafts, never active', () => {
    const { parts, reason } = splitQuestion(draft({ status: 'discarded' }));
    assert.equal(reason, undefined);
    for (const part of parts) {
      assert.equal(part.status, 'draft');
      assert.equal(part.approvedBy, null);
      assert.equal(part.approvedAt, null);
      assert.equal(needsApproval(part), true);
    }
  });

  test('a merge with a rejected draft on either side is a draft, and carries nobody\'s approval', () => {
    const b = (over) => ({
      ...draft({ _id: 'q2', ...over }),
      options: ['Water is split.', 'Oxygen is released.', 'Glucose is built.', 'Starch is stored.'],
      answerIdxs: [0, 1],
    });
    const rejected = { status: 'discarded' };
    const cases = [
      ['two rejected drafts', draft(rejected), b(rejected)],
      ['a rejected draft with an approved question', draft(rejected), b({ status: 'active', approvedBy: PROF, approvedAt: AT })],
      ['an approved question with a rejected draft', approved(), b(rejected)],
    ];
    for (const [label, a, other] of cases) {
      const { question, reason } = mergeQuestions(a, other);
      assert.equal(reason, undefined, label);
      assert.equal(question.status, 'draft', label);
      assert.equal(question.approvedBy, null, label);
      assert.equal(question.approvedAt, null, label);
    }
  });
});

describe('a professor\'s own question (authorQuestion)', () => {
  test('any kind at its own level, validated like an edit', () => {
    const { question, reason } = authorQuestion({
      text: 'Which pigment absorbs light?', bloom: 'remember', kind: 'mcq',
      options: ['  Chlorophyll. ', 'Keratin.', 'Haemoglobin.', 'Collagen.'], answerIdx: 0,
    });
    assert.equal(reason, undefined);
    assert.equal(question.kind, 'mcq');
    assert.equal(question.options[0], 'Chlorophyll.', 'whitespace tidied');
  });

  test('the kind defaults to the level\'s own', () => {
    const { question } = authorQuestion({
      text: 'Explain osmosis in your own words.', bloom: 'create', rubric: ['water moves', 'partially permeable membrane'],
    });
    assert.equal(question.kind, 'open');
  });

  test('a kind from another level is refused with the reason', () => {
    const { reason } = authorQuestion({
      text: 'Which pigment absorbs light?', bloom: 'create', kind: 'mcq',
      options: ['Chlorophyll.', 'Keratin.', 'Haemoglobin.', 'Collagen.'], answerIdx: 0,
    });
    assert.match(reason, /cannot cross levels/);
  });

  test('a poll may sit at any level, and must carry no answer', () => {
    const poll = { text: 'How sure are you about osmosis?', bloom: 'evaluate', kind: 'poll', options: ['Very', 'Somewhat', 'Not yet'] };
    assert.equal(authorQuestion(poll).reason, undefined);
    assert.match(authorQuestion({ ...poll, answerIdx: 0 }).reason, /poll has no correct answer/);
  });

  test('a malformed question gets the validator\'s own words', () => {
    assert.equal(authorQuestion({ text: 'Pick one', bloom: 'remember', kind: 'mcq', options: ['a', 'b'], answerIdx: 0 }).reason,
      'mcq needs exactly 4 options');
    assert.equal(authorQuestion({ text: 'x', bloom: 'analyze' }).reason, 'bad bloom "analyze"');
    assert.equal(authorQuestion({ text: 'x', bloom: 'remember', kind: 'essay' }).reason, 'bad kind "essay"');
  });
});

describe('slides from extraction to the question', () => {
  const slides = [
    { n: 1, title: 'Photosynthesis', text: 'Photosynthesis\nLight becomes sugar.' },
    { n: 2, title: 'Photosynthesis', text: 'Photosynthesis\nIt happens in chloroplasts.' },
    { n: 3, title: 'Respiration', text: 'Respiration\nSugar becomes energy.' },
    { n: 4, title: '', text: '' },
  ];

  test('each topic keeps the slides it was read from; a repeated title continues the topic', () => {
    assert.deepEqual(topicSlides(slides), { Photosynthesis: [1, 2], Respiration: [3] });
    assert.deepEqual(deriveTopics(slides), ['Photosynthesis', 'Respiration']);
  });

  test('pasted sections have no slides', () => {
    assert.deepEqual(topicSlides(['Photosynthesis', 'Respiration']), {});
  });

  test('a question finds its slides by topic, as the generator names it', () => {
    const content = { kind: 'pptx', topicSlides: topicSlides(slides) };
    assert.deepEqual(sourceRefFor(content, 'Photosynthesis'), { kind: 'slides', slides: [1, 2] });
    assert.deepEqual(sourceRefFor(content, 'respiration'), { kind: 'slides', slides: [3] });
    assert.equal(sourceRefFor(content, 'Osmosis'), null);
    assert.equal(sourceRefFor({ kind: 'syllabus', topicSlides: {} }, 'Photosynthesis'), null);
    assert.equal(sourceRefFor({ kind: 'pptx' }, 'Photosynthesis'), null, 'a deck from before slides were kept');
  });

  test('a long slide title still matches the clipped topic the generator writes', () => {
    const long = 'The light-dependent reactions of photosynthesis in the thylakoid membranes of chloroplasts';
    const clipped = 'The light-dependent reactions of photosynthesis in the...';
    assert.deepEqual(sourceRefFor({ topicSlides: { [long]: [7, 5, 7] } }, clipped), { kind: 'slides', slides: [5, 7] });
  });
});
