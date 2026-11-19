// Phase 5: misconception labels on wrong options (services/misconceptions.js).
//
// Pinned here: what a label may say and where it may sit (a wrong option of a
// Choose one, Choose all or True or false question, never a poll, never a right
// answer); how the professor's add, edit, confirm and clear change it and its
// provenance; that a label follows its option's words through a reorder and
// leaves with a rewording; the model's proposed labels parsed from a fixture
// response, never a model call; matching an answer to a label through the
// option's words in that answer's own snapshot; and the counts, worked out by
// hand. End to end, with phones over the socket, in scripts/misconceptions.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import {
  LABELLED_KINDS, MAX_LABEL, changeLabels, chosenTexts, keptLabels, labelFor, labelProblem, labelView, labelsOf,
  misconceptionReport, optionTexts, proposedLabels, sentenceFor, stampLabels, timingNote, wrongIdxs,
} from '../src/services/misconceptions.js';
import { fallbackForTopic, validateItems } from '../src/services/generate.js';
import { forStudent, score } from '../src/questionTypes.js';
import { gradedAnswers, itemAnalysis } from '../src/services/itemStats.js';
import { snapshotOf } from '../src/sockets/index.js';
import { SAMPLE } from '../src/sampleContent.js';

// Generation must take the offline templates whatever server/.env holds; the
// model is never called here, its response is a fixture.
config.gemini.apiKey = '';

/* ------------------------------------------------------------- fixtures -- */

const T0 = '2026-11-19T08:00:00.000Z';
const T1 = '2026-11-19T09:00:00.000Z';
const T2 = '2026-11-19T10:00:00.000Z';
const T3 = '2026-11-19T11:00:00.000Z';
const AT = '2026-11-19T12:00:00.000Z';

// Keyed to UDP (index 1).
const MCQ = {
  _id: 'q-mcq', contentId: 'c1', kind: 'mcq', bloom: 'remember', topic: 'Transport', status: 'active', source: 'llm',
  text: 'Which protocol is connectionless?', options: ['TCP', 'UDP', 'SCTP', 'QUIC'], answerIdx: 1,
};
// Ports and checksums are right (0, 1).
const MULTI = {
  _id: 'q-multi', contentId: 'c1', kind: 'multi', bloom: 'analyse', topic: 'Transport', status: 'active', source: 'llm',
  text: 'Which does UDP give an application?', options: ['Ports', 'Checksums', 'Retransmission', 'A handshake', 'Ordering'],
  answerIdxs: [0, 1],
};
// False, so "True" (0) is the wrong answer.
const TF = {
  _id: 'q-tf', contentId: 'c1', kind: 'truefalse', bloom: 'remember', topic: 'Transport', status: 'active', source: 'llm',
  text: 'UDP guarantees delivery.', answerBool: false,
};
const POLL = { _id: 'q-poll', kind: 'poll', bloom: 'remember', text: 'How sure are you?', options: ['Very', 'Somewhat', 'Not'] };
const MATCH = { _id: 'q-match', kind: 'match', bloom: 'understand', text: 'Match.', pairs: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }, { left: 'c', right: '3' }] };

const label = (option, text, provenance = 'professor', extra = {}) => ({
  option, label: text, provenance, addedAt: T1, changedAt: T1, by: provenance === 'ai' ? null : 'p1', ...extra,
});

/* ----------------------------------------------------------- a label -- */

describe('what a label may say', () => {
  test('a short phrase naming a misunderstanding, up to the limit', () => {
    assert.equal(labelProblem('Thinks UDP resends lost packets'), null);
    assert.equal(labelProblem('Confuses 1024 bytes with 1000'), null, 'a number is not a phone number');
    assert.equal(labelProblem('x'.repeat(MAX_LABEL)), null);
    assert.match(labelProblem('x'.repeat(MAX_LABEL + 1)), /at most 120 characters; this one is 121/);
    assert.equal(MAX_LABEL, 120);
  });

  test('never empty and never anything but text', () => {
    assert.match(labelProblem(''), /cannot be empty/);
    assert.match(labelProblem('   '), /cannot be empty/);
    assert.match(labelProblem(7), /must be text/);
    assert.match(labelProblem(null), /must be text/);
  });

  test('no contact details: an email, a web address, a handle or a phone number', () => {
    for (const bad of ['mail asha@college.edu.in', 'see https://example.org/x', 'www.example.org has it', 'ask @prof_rao',
      'call 98765 43210', '+91 98765-43210', 'ring (022) 2345 6789']) {
      assert.match(labelProblem(bad), /not a person/, bad);
    }
  });
});

describe('which options take a label', () => {
  test('a Choose one, a Choose all and a True or false; nothing else', () => {
    assert.deepEqual(LABELLED_KINDS, ['mcq', 'multi', 'truefalse']);
    assert.deepEqual(optionTexts(MCQ), ['TCP', 'UDP', 'SCTP', 'QUIC']);
    assert.deepEqual(optionTexts(TF), ['True', 'False']);
    assert.equal(optionTexts(POLL), null);
    assert.equal(optionTexts(MATCH), null);
  });

  test('only the wrong ones, by the question\'s own key', () => {
    assert.deepEqual(wrongIdxs(MCQ), [0, 2, 3]);
    assert.deepEqual(wrongIdxs(MULTI), [2, 3, 4]);
    assert.deepEqual(wrongIdxs(TF), [0]);
    assert.deepEqual(wrongIdxs({ ...TF, answerBool: true }), [1]);
  });
});

/* ---------------------------------------------------- the professor -- */

describe('the professor adds, edits, confirms and clears', () => {
  test('a label added to a wrong option is the professor\'s, added and changed now, by them', () => {
    const { labels, changed, reason } = changeLabels(MCQ, [{ option: 0, label: '  Thinks   TCP needs no handshake ' }], { by: 'p1', at: AT });
    assert.equal(reason, undefined);
    assert.deepEqual(labels, [{ option: 'TCP', label: 'Thinks TCP needs no handshake', provenance: 'professor', addedAt: AT, changedAt: AT, by: 'p1' }]);
    assert.deepEqual(changed, [{ optionIdx: 0, action: 'added' }]);
  });

  test('never on a right answer, a poll or a kind without options to label', () => {
    assert.match(changeLabels(MCQ, [{ option: 1, label: 'x' }]).reason, /Option 2 \("UDP"\) is a right answer/);
    assert.match(changeLabels(MULTI, [{ option: 0, label: 'x' }]).reason, /right answer/);
    assert.match(changeLabels(TF, [{ option: 1, label: 'x' }]).reason, /Option 2 \("False"\) is a right answer/);
    assert.match(changeLabels(POLL, [{ option: 0, label: 'x' }]).reason, /A poll has no wrong answer/);
    assert.match(changeLabels(MATCH, [{ option: 0, label: 'x' }]).reason, /"Choose one", "Choose all that apply" or "True or false"/);
  });

  test('the request is refused whole, with a reason, when any change is wrong', () => {
    assert.match(changeLabels(MCQ, []).reason, /Name at least one option/);
    assert.match(changeLabels(MCQ, 'TCP').reason, /Name at least one option/);
    assert.match(changeLabels(MCQ, [{ option: 4, label: 'x' }]).reason, /no option 5: its options are numbered 1 to 4/);
    assert.match(changeLabels(MCQ, [{ option: '0', label: 'x' }]).reason, /names an option by its number/);
    assert.match(changeLabels(MCQ, [{ option: 0, label: 'a' }, { option: 0, label: 'b' }]).reason, /Option 1 is named twice/);
    assert.match(changeLabels(MCQ, [{ option: 0 }]).reason, /Say what to do with option 1/);
    assert.match(changeLabels(MCQ, [{ option: 2, label: 'x'.repeat(121) }]).reason, /^Option 3: A misconception label is at most 120/);
    assert.match(changeLabels(MCQ, [{ option: 2, label: 'mail a@b.co' }]).reason, /^Option 3: .*not a person/);
    // One good change and one bad: nothing comes back to write.
    const both = changeLabels(MCQ, [{ option: 0, label: 'fine' }, { option: 1, label: 'on the key' }]);
    assert.ok(both.reason && !both.labels);
  });

  test('confirming an AI draft makes it the professor\'s and changes nothing else', () => {
    const q = { ...MCQ, misconceptions: [label('TCP', 'Thinks TCP is connectionless', 'ai')] };
    const { labels, changed } = changeLabels(q, [{ option: 0, confirm: true }], { by: 'p1', at: AT });
    assert.deepEqual(labels, [{ ...label('TCP', 'Thinks TCP is connectionless', 'ai'), provenance: 'professor', by: 'p1' }]);
    assert.deepEqual(changed, [{ optionIdx: 0, action: 'confirmed' }]);
    // The same words again is a confirmation too, not an edit.
    assert.deepEqual(changeLabels(q, [{ option: 0, label: 'Thinks TCP is connectionless' }], { by: 'p1', at: AT }).labels[0].changedAt, T1);
    assert.match(changeLabels(MCQ, [{ option: 0, confirm: true }]).reason, /Option 1 has no label to confirm/);
    // A label already the professor's is left exactly as it was.
    assert.deepEqual(changeLabels({ ...MCQ, misconceptions: [label('TCP', 'x')] }, [{ option: 0, confirm: true }]).changed, []);
  });

  test('editing keeps when it was added and moves when it was changed', () => {
    const q = { ...MCQ, misconceptions: [label('TCP', 'Old words', 'ai')] };
    const { labels, changed } = changeLabels(q, [{ option: 0, label: 'New words' }], { by: 'p1', at: AT });
    assert.deepEqual(labels, [{ option: 'TCP', label: 'New words', provenance: 'professor', addedAt: T1, changedAt: AT, by: 'p1' }]);
    assert.deepEqual(changed, [{ optionIdx: 0, action: 'edited' }]);
  });

  test('clearing removes it; clearing what has none, or a right answer, changes nothing', () => {
    const q = { ...MCQ, misconceptions: [label('TCP', 'a'), label('SCTP', 'b', 'ai')] };
    const cleared = changeLabels(q, [{ option: 0, label: null }, { option: 3, label: '' }, { option: 1, label: null }]);
    assert.deepEqual(cleared.labels, [label('SCTP', 'b', 'ai')]);
    assert.deepEqual(cleared.changed, [{ optionIdx: 0, action: 'cleared' }]);
  });

  test('options not named keep their labels, and the list is in option order', () => {
    const q = { ...MCQ, misconceptions: [label('QUIC', 'q')] };
    const { labels } = changeLabels(q, [{ option: 0, label: 't' }], { by: 'p1', at: AT });
    assert.deepEqual(labels.map((l) => [l.option, l.label]), [['TCP', 't'], ['QUIC', 'q']]);
  });

  test('a True or false question\'s one wrong answer takes one', () => {
    const { labels } = changeLabels(TF, [{ option: 0, label: 'Thinks UDP acknowledges each datagram' }], { at: AT });
    assert.deepEqual(labels.map((l) => [l.option, l.provenance, l.by]), [['True', 'professor', null]]);
  });
});

describe('a label follows its option\'s words', () => {
  const q = { ...MCQ, misconceptions: [label('TCP', 'a'), label('SCTP', 'b', 'ai')] };

  test('options reordered: each label stays on its option, at its new place', () => {
    const moved = { ...q, options: ['SCTP', 'QUIC', 'UDP', 'TCP'], answerIdx: 2 };
    assert.deepEqual(keptLabels(moved).removed, []);
    assert.deepEqual(labelView(moved).map((l) => [l.optionIdx, l.option, l.label]), [[0, 'SCTP', 'b'], [3, 'TCP', 'a']]);
  });

  test('an option reworded, or made a right answer, loses its label', () => {
    const reworded = { ...q, options: ['TCP/IP', 'UDP', 'SCTP', 'QUIC'] };
    assert.deepEqual(keptLabels(reworded).removed.map((l) => l.option), ['TCP']);
    const rekeyed = { ...q, answerIdx: 2 };
    assert.deepEqual(keptLabels(rekeyed).removed.map((l) => l.option), ['SCTP']);
    assert.deepEqual(labelView(rekeyed).map((l) => l.option), ['TCP']);
  });

  test('case and spacing are not a rewording, and the label takes the option\'s words as they are now', () => {
    const recased = { ...q, options: ['tcp', 'UDP', 'SCTP', 'QUIC'] };
    assert.deepEqual(keptLabels(recased).kept.map((l) => l.option), ['tcp', 'SCTP']);
  });

  test('a kind with no options to label keeps none', () => {
    assert.equal(keptLabels({ ...q, ...MATCH }).kept.length, 0);
    assert.deepEqual(labelView({ ...POLL, misconceptions: [label('Very', 'x')] }), []);
  });

  test('the view says each label\'s provenance as staff read it', () => {
    assert.deepEqual(labelView(q).map((l) => [l.optionIdx, l.provenance, l.provenanceLabel]),
      [[0, 'professor', 'Professor\'s label'], [2, 'ai', 'AI draft']]);
    assert.deepEqual(labelFor(q, ' scTP '), { label: 'b', provenance: 'ai', provenanceLabel: 'AI draft', confirmed: false });
    assert.deepEqual(labelView(q).map((l) => l.confirmed), [true, false], 'a professor\'s label is confirmed, an AI draft is not (Phase 5)');
    assert.equal(labelFor(q, 'UDP'), null);
  });

  test('malformed stored entries are not labels', () => {
    assert.deepEqual(labelsOf({ misconceptions: [null, 'x', { option: 'TCP', label: 'a', provenance: 'human' }, label('TCP', 'ok')] }),
      [label('TCP', 'ok')]);
    assert.deepEqual(labelsOf({}), []);
  });
});

/* ------------------------------------------------------- the generator -- */

describe('the model\'s proposed labels, parsed from a fixture response', () => {
  // As the model returns them under ITEM_SCHEMA; no model is called.
  const RESPONSE = [
    {
      bloom: 'remember', kind: 'mcq', text: 'Which protocol is connectionless?', options: ['TCP', 'UDP', 'SCTP', 'QUIC'], answerIdx: 1,
      misconceptions: [
        { optionIdx: 0, label: ' Thinks TCP sends   without a handshake ' },
        { optionIdx: 1, label: 'On the right answer' },
        { optionIdx: 9, label: 'Off the list' },
        { optionIdx: 2, label: 'x'.repeat(121) },
        { optionIdx: 3, label: 'Email quic@example.org' },
        { optionIdx: 0, label: 'A second for the same option' },
        { label: 'No option named on an mcq' },
      ],
    },
    {
      bloom: 'analyse', kind: 'multi', text: 'Which does UDP give an application?', options: ['Ports', 'Checksums', 'Retransmission', 'A handshake'],
      answerIdxs: [0, 1], misconceptions: [{ optionIdx: 3, label: 'Carries over TCP\'s handshake' }, { optionIdx: 0, label: 'right' }],
    },
    { bloom: 'remember', kind: 'truefalse', text: 'UDP guarantees delivery.', answerBool: false, misconceptions: [{ label: 'Thinks UDP acknowledges' }] },
    { bloom: 'remember', kind: 'truefalse', text: 'UDP has ports.', answerBool: true, misconceptions: [{ optionIdx: 0, label: 'On the right side' }] },
    { bloom: 'remember', kind: 'mcq', text: 'Which layer carries segments?', options: ['Network', 'Transport', 'Link', 'Physical'], answerIdx: 1 },
    // An invalid question is refused whatever its labels.
    { bloom: 'remember', kind: 'mcq', text: 'Three options?', options: ['a', 'b', 'c'], answerIdx: 0, misconceptions: [{ optionIdx: 1, label: 'x' }] },
  ];
  const plan = { remember: { mcq: 2, truefalse: 2 }, analyse: { multi: 1 } };
  const { valid, errors } = validateItems(RESPONSE, 'Transport', plan);

  test('valid labels on wrong options come through as AI drafts; every other one is left out, never the item', () => {
    assert.equal(valid.length, 5);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /mcq needs exactly 4 options/);
    const [mcq, multi, tf, tfTrue, plain] = valid;
    assert.deepEqual(mcq.misconceptions, [{ option: 'TCP', label: 'Thinks TCP sends without a handshake', provenance: 'ai' }]);
    assert.deepEqual(multi.misconceptions, [{ option: 'A handshake', label: 'Carries over TCP\'s handshake', provenance: 'ai' }]);
    assert.deepEqual(tf.misconceptions, [{ option: 'True', label: 'Thinks UDP acknowledges', provenance: 'ai' }]);
    assert.equal('misconceptions' in tfTrue, false, 'a label naming the right side is left out');
    assert.equal('misconceptions' in plain, false, 'an item with none carries no field');
  });

  test('the question itself is exactly as before', () => {
    const { misconceptions, ...rest } = valid[0];
    assert.deepEqual(rest, { topic: 'Transport', bloom: 'remember', kind: 'mcq', text: 'Which protocol is connectionless?', options: ['TCP', 'UDP', 'SCTP', 'QUIC'], answerIdx: 1 });
    assert.ok(misconceptions);
  });

  test('proposedLabels on its own: nothing for a kind without options, or a response that is not a list', () => {
    assert.deepEqual(proposedLabels(MATCH, [{ optionIdx: 0, label: 'x' }]), []);
    assert.deepEqual(proposedLabels(MCQ, { optionIdx: 0, label: 'x' }), []);
    assert.deepEqual(proposedLabels(MCQ, undefined), []);
  });

  test('saved, they are stamped with the moment and nobody', () => {
    assert.deepEqual(stampLabels(valid[2].misconceptions, AT), [{ option: 'True', label: 'Thinks UDP acknowledges', provenance: 'ai', addedAt: AT, changedAt: AT, by: null }]);
  });

  test('the offline templates propose none', () => {
    const items = fallbackForTopic({ topic: SAMPLE.topics[0], contextText: SAMPLE.rawText, mix: { remember: 4, analyse: 2 } });
    assert.ok(items.length > 0);
    assert.ok(items.every((q) => !('misconceptions' in q)), JSON.stringify(items.map((q) => Object.keys(q))));
  });
});

/* ------------------------------------------------------- the matching -- */

const answer = (roll, question, response, extra = {}) => ({
  _id: `a-${roll}-${extra.attempt ?? 1}-${extra.sessionId ?? 'r1'}-${extra.answeredAt ?? T2}`,
  sessionId: 'r1', rollNo: roll, questionId: question._id, kind: question.kind, bloom: question.bloom, topic: question.topic,
  questionSnapshot: { id: question._id, ...question, _id: undefined }, response, attempt: 1, final: true,
  correct: false, score: 0, answeredAt: T2, ...extra,
});

describe('an answer is matched to a label by its option\'s words in its own snapshot', () => {
  test('an mcq answered when the options stood in another order', () => {
    const then = { ...MCQ, options: ['QUIC', 'SCTP', 'UDP', 'TCP'], answerIdx: 2 };
    assert.deepEqual(chosenTexts(answer('S1', then, 3)), ['TCP']);
  });

  test('a fewer-choices student\'s pick, a place on the shorter list they were shown', () => {
    const a = answer('S1', MCQ, 1);
    a.questionSnapshot.shownOptions = [1, 3];
    assert.deepEqual(chosenTexts(a), ['QUIC']);
  });

  test('a choose-all answer: every option ticked; a true/false: the side chosen', () => {
    assert.deepEqual(chosenTexts(answer('S1', MULTI, [0, 2, 3])), ['Ports', 'Retransmission', 'A handshake']);
    assert.deepEqual(chosenTexts(answer('S1', TF, true)), ['True']);
    assert.deepEqual(chosenTexts(answer('S1', TF, 'true')), [], 'only a real boolean, as the marker reads it');
  });

  test('nothing for a kind without options to label', () => {
    assert.deepEqual(chosenTexts(answer('S1', MATCH, [0, 1, 2])), []);
  });
});

/* ---------------------------------------------------------- the counts -- */

describe('the counts, by hand', () => {
  // TCP is the professor's, SCTP an AI draft, both written at T1.
  const Q = { ...MCQ, misconceptions: [label('TCP', 'Thinks TCP is connectionless'), label('SCTP', 'Takes SCTP for a datagram protocol', 'ai')] };
  const reordered = { ...MCQ, options: ['QUIC', 'SCTP', 'UDP', 'TCP'], answerIdx: 2 };
  const reworded = { ...MCQ, options: ['TCP', 'UDP', 'SCTP protocol', 'QUIC'] };
  const ROWS = [
    answer('S01', MCQ, 0),
    answer('S02', MCQ, 0),
    answer('S03', MCQ, 1, { correct: true, score: 1 }),
    answer('S04', MCQ, 2),
    answer('S05', MCQ, 3),
    // A retried attempt: the first (SCTP) is not counted, the final one (TCP) is.
    answer('S06', MCQ, 2, { attempt: 1, final: false }),
    answer('S06', MCQ, 0, { attempt: 2 }),
    // Before the label, with the options in another order: TCP, by its words.
    answer('S07', reordered, 3, { answeredAt: T0 }),
    // An earlier wording: "SCTP protocol" is not SCTP.
    answer('S08', reworded, 2),
    // A class question's vote is never counted.
    answer('S09', MCQ, 0, { classQuestionId: 'cq1', round: 1 }),
  ];
  const report = misconceptionReport({ rows: gradedAnswers(ROWS), questions: [Q] });
  const [item] = report.questions;
  const [tcp, sctp] = item.options;

  test('four students chose the option linked to TCP\'s misunderstanding, one SCTP\'s', () => {
    assert.equal(report.questions.length, 1);
    assert.deepEqual([tcp.option, tcp.students, tcp.answers], ['TCP', 4, 4]);
    assert.deepEqual([sctp.option, sctp.students, sctp.answers], ['SCTP', 1, 1]);
    assert.equal(tcp.sentence, '4 students chose the option linked to the misunderstanding "Thinks TCP is connectionless".');
    assert.equal(sctp.sentence, '1 student chose the option linked to the misunderstanding "Takes SCTP for a datagram protocol" '
      + '(an AI draft label, not yet confirmed by the professor).');
  });

  test('the question\'s own figures: counted answers, students, and the one earlier wording', () => {
    assert.deepEqual([item.answers, item.students, item.otherWording], [8, 8, 1]);
    assert.match(item.otherWordingNote, /^1 of these answers was given to an earlier wording/);
    assert.deepEqual([item.questionId, item.kind, item.kindLabel], ['q-mcq', 'mcq', 'Choose one']);
  });

  test('an answer given before its label was added is counted under it, and says so', () => {
    assert.equal(tcp.beforeLabel, 1);
    assert.equal(tcp.note, 'Label added after 1 of these 4 answers.');
    assert.equal(sctp.note, null);
    const all = misconceptionReport({ rows: gradedAnswers([answer('S07', reordered, 3, { answeredAt: T0 })]), questions: [Q] });
    assert.equal(all.questions[0].options[0].note, 'Label added after these answers.');
  });

  test('a label reworded after some of the answers says that too', () => {
    const edited = { ...Q, misconceptions: [label('TCP', 'Thinks TCP is connectionless', 'professor', { changedAt: T3 })] };
    const r = misconceptionReport({ rows: gradedAnswers(ROWS), questions: [edited] });
    assert.equal(r.questions[0].options[0].note, 'Label added after 1 of these 4 answers. Label reworded after 3 of these answers.');
    assert.equal(timingNote({ answers: 2, beforeLabel: 0, beforeChange: 0 }), null);
  });

  test('a student in two rooms of a class is one student and two answers; across a bank\'s rooms, one per room', () => {
    const second = answer('S01', MCQ, 0, { sessionId: 'r2' });
    const rows = gradedAnswers([...ROWS, second]);
    const pooled = misconceptionReport({ rows, questions: [Q], pool: 'roll' }).questions[0].options[0];
    assert.deepEqual([pooled.students, pooled.answers], [4, 5]);
    const perRoom = misconceptionReport({ rows, questions: [Q], pool: 'room' }).questions[0].options[0];
    assert.deepEqual([perRoom.students, perRoom.answers], [5, 5]);
  });

  test('the summary lists the misunderstandings most students chose, first', () => {
    assert.deepEqual(report.top.map((t) => [t.option, t.students]), [['TCP', 4], ['SCTP', 1]]);
    assert.deepEqual(report.counted, { questions: 1, labels: 2, aiDrafts: 1, answers: 8 });
    assert.match(report.privacy, /never shown on a phone or the projector/);
  });

  test('a labelled question nobody has answered is listed when asked for, at zero; one with no label never', () => {
    const plain = { ...MCQ, _id: 'q-plain' };
    const r = misconceptionReport({
      rows: [], questions: [Q, plain, { ...TF, misconceptions: [label('True', 't')] }], include: ['q-mcq', 'q-plain', 'Q-TF'],
    });
    // Both at Remember on one topic, so by their text.
    assert.deepEqual(r.questions.map((q) => q.questionId), ['q-tf', 'q-mcq']);
    assert.equal(r.questions[1].options[0].sentence, 'No student chose the option linked to the misunderstanding "Thinks TCP is connectionless".');
    assert.deepEqual(r.top, []);
  });

  test('a choose-all answer counts each labelled option ticked; questions come in ladder order', () => {
    const M = { ...MULTI, misconceptions: [label('Retransmission', 'Thinks UDP resends'), label('A handshake', 'Carries over TCP\'s handshake')] };
    const rows = gradedAnswers([answer('S1', M, [0, 1, 2]), answer('S2', M, [0, 2, 3]), answer('S3', M, [0, 1]), answer('S4', MCQ, 0)]);
    const r = misconceptionReport({ rows, questions: [M, Q] });
    assert.deepEqual(r.questions.map((q) => q.questionId), ['q-mcq', 'q-multi']);
    assert.deepEqual(r.questions[1].options.map((o) => [o.option, o.students]), [['Retransmission', 2], ['A handshake', 1]]);
  });

  test('sentences: none, one, many', () => {
    assert.equal(sentenceFor(0, { label: 'x', provenance: 'professor' }), 'No student chose the option linked to the misunderstanding "x".');
    assert.equal(sentenceFor(12, { label: 'x', provenance: 'professor' }), '12 students chose the option linked to the misunderstanding "x".');
  });
});

/* ------------------------------------------- what a label never touches -- */

describe('a label changes no mark and never reaches a phone', () => {
  const Q = { ...MCQ, misconceptions: [label('TCP', 'Thinks TCP is connectionless')] };

  test('the mark is the same with or without labels', () => {
    for (const response of [0, 1, 2, 3]) assert.deepEqual(score(Q, response, 'S1:q-mcq'), score(MCQ, response, 'S1:q-mcq'));
    assert.deepEqual(score({ ...TF, misconceptions: [label('True', 't')] }, true), score(TF, true));
  });

  test('the item report\'s figures are the same, and each option carries its label beside its count', () => {
    const rows = [answer('S1', MCQ, 0), answer('S2', MCQ, 1, { correct: true, score: 1 })];
    const withLabels = itemAnalysis({ answers: rows, questions: [Q] }).items[0];
    const without = itemAnalysis({ answers: rows, questions: [MCQ] }).items[0];
    assert.deepEqual([withLabels.attempts, withLabels.proportionCorrect, withLabels.band], [without.attempts, without.proportionCorrect, without.band]);
    assert.deepEqual(withLabels.distribution.rows[0].options.map((o) => [o.text, o.count, o.misconception?.label ?? null]),
      [['TCP', 1, 'Thinks TCP is connectionless'], ['UDP', 1, null], ['SCTP', 0, null], ['QUIC', 0, null]]);
    assert.deepEqual(without.distribution.rows[0].options.map((o) => o.misconception), [null, null, null, null]);
  });

  test('the phone\'s question and the stored answer snapshot carry no label', () => {
    const shown = JSON.stringify(forStudent(Q, 'S1:q-mcq'));
    assert.ok(!shown.includes('misconception') && !shown.includes('Thinks TCP'), shown);
    const snap = snapshotOf(Q);
    assert.equal('misconceptions' in snap, false);
    assert.deepEqual(snap.options, MCQ.options);
  });
});
