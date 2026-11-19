/**
 * The question editor and the answer key, drawn from sample data. Development only.
 *
 * The editor takes its server calls as `services`, so each entry hands it a
 * small stand-in that answers the way /api/bank and /api/media do (docs/API.md,
 * Phase 2, and the owner's decisions of 19 Nov 2026): an edit keeps the
 * status, an approval names the failed checks and the question it retired, a
 * plain rewrite of a question in use leaves it serving and says so in `note`
 * (with `replacesId` on the draft, and no `warnings`), Harder and Easier write
 * a draft one level over, and an upload is refused with the server's 400, 413
 * and 415 sentences. What the bank would be told afterwards appears on the
 * page behind the sheet. Nothing here talks to the server.
 */

import { useState } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import AnswerKey from '../teach/AnswerKey.jsx';
import Editor from '../teach/Editor.jsx';
import { Button, Level, Note } from '../ui/index.jsx';

/* ------------------------------------------------------------------ sample */

const CONTENT_ID = '58bd9dd08e57d26befa6f02e';

const KINDS = {
  forLevel: {
    remember: ['mcq', 'truefalse'],
    understand: ['match', 'categorise'],
    apply: ['blank', 'cloze', 'numeric', 'dropdown', 'table'],
    analyse: ['multi', 'categorise', 'hottext', 'grid'],
    evaluate: ['order', 'rank'],
    create: ['open'],
  },
  label: {
    mcq: 'Choose one', truefalse: 'True or false', match: 'Match the pairs', categorise: 'Sort into groups',
    blank: 'Fill in the blank', cloze: 'Complete the passage', numeric: 'Work out the value', multi: 'Choose all that apply',
    order: 'Put these in order', rank: 'Rank them', open: 'Write your answer', hottext: 'Pick the words',
    dropdown: 'Choose for each gap', table: 'Complete the table', grid: 'Tick every match', poll: 'Have your say',
  },
};

/** A 240 by 120 bar chart, 476 bytes: three bars rising on a baseline. */
const BARS_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAAB4CAIAAABD1OhwAAABo0lEQVR42u3SMRGAIABAURrZw8WVgY3RySJuVrCJeRw0gCkQkXf3E/x74b5O6TcFCwS0BLQEtAS0gJaAloCWgJaAFtBSZ6BjyjFl4wS0BLQEtIAGWkBLQEtAS0ALaKAFtFptmKfqAS2ggRbQQAMNtIAGWkADLaCBFtBAAw20gAZaQAMtoIEW0EADDbSABlpAAy2ggQYa6J5Bj9tSPaCBBhpooIEGGmiggQYaaKCBBhpooIEGGmiggQYaaKCBBhpooIEGGmiggQYaaKCBBhpooIEGGmiggQYaaKCBBhpooIEGGmiggQYaaKCBBhpooIEGGmiggQYaaKCBBhpooIEGGmiggf4C6PXYqwc00EADDTTQQAMNNNBAAw000EADDTTQQAMNNNBAAw000EADDTTQQAMNNNBAAw000EADDTTQQAMNNNBAAw000EADDTTQQAMNNNBAAw000EADDTTQQAMNNNBAAw000EADDTTQQAMNNNBAAw000EADDTTQQAMNNNBAAw000EADDTTQQAMNNNBlQUvvB7SAlloOaAEtAS0BLQEtoCWgJaAloCWgBbQEtAS0VKQHuWcDR79OT8IAAAAASUVORK5CYII=';

const ok = (id, message) => ({ id, ok: true, message });
const no = (id, message) => ({ id, ok: false, message });
const STAMP = '2026-11-19T08:42:10.000Z';

/*
 * `provenance` and `levelCheck` as the server reads them off a row
 * (services/honesty.js): who wrote it, where it stands at the approval gate, a
 * chip and a sentence; and whether its level is in doubt.
 */
const SOURCE_LABEL = { ai: 'AI-generated', professor: 'Professor-written', template: 'Offline template', 'professor-or-template': 'Professor-written or offline template' };
const sourceOfRow = (q) => (q.source === 'teacher' ? 'professor' : q.source === 'fallback' ? (q.model == null ? 'professor-or-template' : 'template') : 'ai');
const approvalOf = (q) => (q.status === 'draft' ? 'draft' : q.status === 'discarded' ? 'discarded' : q.approvedAt ? 'approved' : sourceOfRow(q) === 'professor' ? 'written' : 'unrecorded');
const SOURCE_SENTENCE = {
  ai: (q) => `Written by the language model${q.model ? ` (${q.model})` : ''} from the professor's material.`,
  professor: () => 'Written by a professor.',
  template: () => "Made by the offline template from the professor's material, without a language model.",
  'professor-or-template': () => 'Written by a professor before 19 Nov 2026, or made by the offline template before models were recorded. No language model wrote it.',
};
const APPROVAL_SENTENCE = {
  draft: 'A draft: no room serves it until a professor approves it.',
  approved: 'Approved by a professor.',
  written: 'In use since a professor wrote it.',
  unrecorded: 'In use since before approvals were recorded.',
  discarded: 'Not in use: rejected, retired or removed.',
};
function chipOfRow(source, approval) {
  if (source === 'ai' && approval === 'draft') return 'AI draft';
  if (approval === 'draft') return `${SOURCE_LABEL[source]} draft`;
  if (approval === 'discarded') return `${SOURCE_LABEL[source]}, not in use`;
  if (approval === 'approved') return `${SOURCE_LABEL[source]}, approved`;
  if (approval === 'unrecorded') return `${SOURCE_LABEL[source]}, approval not recorded`;
  return SOURCE_LABEL[source];
}
const LEVEL_UNCONFIRMED = 'The language model chose this level and no professor has approved the question yet. Model-written questions often miss the level they were asked for, so check that it really asks for this level.';
export function honest(q) {
  const source = sourceOfRow(q);
  const approval = approvalOf(q);
  const unsure = source === 'ai' && !q.approvedAt;
  return {
    ...q,
    provenance: {
      source, sourceLabel: SOURCE_LABEL[source], model: q.model ?? null, approval, approvedAt: q.approvedAt ?? null, approvedBy: null,
      aiDraft: source === 'ai' && approval === 'draft', label: chipOfRow(source, approval),
      sentence: `${SOURCE_SENTENCE[source](q)} ${APPROVAL_SENTENCE[approval]}`,
    },
    levelCheck: unsure
      ? { uncertain: true, reasons: [{ id: 'model-level-unconfirmed', message: LEVEL_UNCONFIRMED }], sentence: `Level uncertain. ${LEVEL_UNCONFIRMED}` }
      : { uncertain: false, reasons: [], sentence: null },
  };
}

const base = (over) => honest({
  status: 'active', source: 'fallback', model: 'offline-template', sourceRef: null,
  createdBy: null, approvedBy: null, approvedAt: STAMP, createdAt: STAMP, contentId: CONTENT_ID, misconceptions: [], ...over,
});

// The bank's `misconceptionLabels`, as GET /api/bank/:contentId sends it.
const LABEL_NOTE = 'A misconception label changes no mark: editing one does not send an approved question back to draft, and approving a question does not confirm its labels.';
export const LABEL_KINDS = { kinds: ['mcq', 'multi', 'truefalse'], maxLength: 120, note: LABEL_NOTE };

const FLAGGED = base({
  _id: 'g-draft-flagged', status: 'draft', source: 'gemini', model: 'gemini-2.5-flash', approvedAt: null,
  sourceRef: { kind: 'slides', slides: [3, 4] },
  topic: 'Light reactions in the thylakoid membrane', bloom: 'remember', kind: 'mcq',
  text: 'Where in the chloroplast do the light reactions of photosynthesis take place?',
  options: [
    'In the stroma, which always holds the enzymes of the Calvin cycle',
    'In the thylakoid membranes, where chlorophyll and the electron transport chain sit side by side',
    'In the outer membrane',
    'In the cell wall',
  ],
  answerIdx: 1,
  checks: [
    no('longest-option-is-key', 'The answer is clearly the longest (95 characters against at most 64 for a wrong one). Students learn to pick the longest option; even the lengths out.'),
    no('absolute-words', 'Option 1 ("In the stroma, which always holds the enzymes...") says "always". Absolute words give a wrong option away; qualify it or reword it.'),
    ok('all-none-of-the-above', 'No option refers to the other options.'),
    ok('duplicate-options', 'Every option says something different.'),
    ok('several-keys', 'No wrong option says the same as a correct one.'),
    ok('slide-only-reference', 'It can be answered without seeing the slide.'),
    ok('create-selected-response', 'A "Choose one" at Remember is a level picking can reach.'),
  ],
});

const PASSED = (kind, level) => [
  ok('slide-only-reference', 'It can be answered without seeing the slide.'),
  ok('create-selected-response', `A "${KINDS.label[kind]}" at ${LABEL[level]} is a level picking can reach.`),
];

const HOTTEXT = base({
  _id: 'g-hottext', topic: 'Transport layer services', bloom: 'analyse', kind: 'hottext',
  sourceRef: { kind: 'slides', slides: [2] },
  text: 'Read this line from Transport layer services and pick out every word that names a term the material defines.',
  criterion: 'every word that names a term the material defines',
  tokens: ['UDP', 'performs', 'no', 'handshake,', 'no', 'acknowledgement,', 'no', 'retransmission', 'and', 'no', 'congestion', 'control,', 'so', 'datagrams', 'may', 'be', 'lost,', 'duplicated', 'or', 'reordered.'],
  answerIdxs: [0],
  checks: PASSED('hottext', 'analyse'),
});

const DROPDOWN = base({
  _id: 'g-dropdown', topic: 'User Datagram Protocol', bloom: 'apply', kind: 'dropdown',
  sourceRef: { kind: 'slides', slides: [3, 4] },
  text: 'Complete this line from User Datagram Protocol by choosing a term for each gap: Its core services are process-to-process delivery, ____ and ____, and, depending on the protocol chosen, reliability, flow control and congestion control.',
  blanks: [
    { options: ['User Datagram Protocol', 'multiplexing', 'port number', 'UDP'], answerIdx: 1 },
    { options: ['User Datagram Protocol', 'UDP', 'demultiplexing', 'port number'], answerIdx: 2 },
  ],
  checks: [
    ok('all-none-of-the-above', 'No option refers to the other options.'),
    ok('duplicate-options', 'Every option says something different.'),
    ok('several-keys', 'No wrong option says the same as a correct one.'),
    ...PASSED('dropdown', 'apply'),
  ],
});

const TABLE = base({
  _id: 'g-table', topic: 'User Datagram Protocol', bloom: 'apply', kind: 'table',
  text: 'The material on User Datagram Protocol discusses each term below alongside either "TCP" or "Flow control". Complete the table with the one it goes with. The first row is done for you.',
  columns: ['Where the material names it', 'Discussed alongside'],
  rows: [
    { header: 'Multiplexing', cells: [{ given: 'Multiplexing is the gathering of data from multiple application sockets at the sender;' }, { given: 'Flow control' }] },
    { header: 'Demultiplexing', cells: [{ given: 'Demultiplexing is the delivery of an arriving segment to the correct socket at the receiver.' }, { accept: ['Flow control', 'flow control'] }] },
    { header: 'Connection', cells: [{ given: 'The absence of connection state also lets a UDP server support very large numbers of clients.' }, { accept: ['TCP'] }] },
  ],
  checks: [
    ok('slide-only-reference', 'It can be answered without seeing the slide.'),
    ok('create-selected-response', 'The student writes the answer, so any level can be asked.'),
  ],
});

const GRID = base({
  _id: 'g-grid', topic: 'User Datagram Protocol', bloom: 'analyse', kind: 'grid',
  text: 'Which of these ideas does the material on User Datagram Protocol discuss each term alongside? Tick every one that does.',
  columns: ['TCP', 'UDP', 'Flow control'],
  rows: ['Multiplexing', 'Connection', 'Reno'],
  answers: [[false, false, true], [true, true, false], [true, false, false]],
  checks: PASSED('grid', 'analyse'),
});

const PASSAGE = base({
  _id: 'g-passage', topic: 'Transmission Control Protocol', bloom: 'analyse', kind: 'hottext',
  sourceRef: { kind: 'slides', slides: [5, 6] },
  text: 'Which words in this line from Transmission Control Protocol name a term the material defines? Pick each one.',
  criterion: 'every word that names a term the material defines',
  tokens: ['Its', 'core', 'services', 'are', 'process-to-process', 'delivery,', 'multiplexing', 'and', 'demultiplexing,', 'and,', 'depending', 'on', 'the', 'protocol', 'chosen,', 'reliability,', 'flow', 'control', 'and', 'congestion', 'control.'],
  answerIdxs: [6, 8],
  stimulus: {
    kind: 'passage',
    sourceRef: 'Kurose and Ross, Computer Networking, chapter 3',
    text: 'Its core services are process-to-process delivery, multiplexing and demultiplexing, and, depending on the protocol chosen, reliability, flow control and congestion control.\n\nMultiplexing is the gathering of data from multiple application sockets at the sender; demultiplexing is the delivery of an arriving segment to the correct socket at the receiver, using the port numbers in the segment header. A port number is a 16-bit identifier, so ports range from 0 to 65535, with 0 to 1023 reserved as well-known ports.',
  },
  checks: PASSED('hottext', 'analyse'),
});

const IMAGE = base({
  _id: 'g-image', topic: 'Factors affecting the rate of photosynthesis', bloom: 'remember', kind: 'mcq',
  text: 'In the graph, which light intensity gives the highest rate of photosynthesis?',
  options: ['Low', 'Medium', 'High', 'All three give the same rate'],
  answerIdx: 2,
  stimulus: {
    kind: 'image',
    url: BARS_PNG,
    alt: 'A bar chart with three bars for low, medium and high light intensity. The bars rise from left to right, so the rate of photosynthesis is highest at high light intensity.',
    sourceRef: 'Fig. 13.2, NCERT Biology XI',
  },
  checks: [
    ok('longest-option-is-key', 'The answer does not stand out by its length.'),
    ok('absolute-words', 'No option uses an absolute word (always, never, all, none).'),
    ok('slide-only-reference', 'It names a figure, and an image is attached.'),
    ok('create-selected-response', 'A "Choose one" at Remember is a level picking can reach.'),
  ],
});

// A professor's own question: source 'teacher' since 19 Nov 2026.
const OWN = base({
  _id: 'g-own', source: 'teacher', model: null, topic: 'Congestion control', bloom: 'create', kind: 'open',
  text: 'Design a congestion control rule for a link that drops one packet in a hundred for reasons unrelated to congestion. Justify it.',
  rubric: ['treat loss without delay as noise', 'react to rising delay', 'justify with throughput'],
  checks: [
    ok('empty-rubric', 'Every rubric point has words a written answer can be matched on.'),
    ok('slide-only-reference', 'It can be answered without seeing the slide.'),
    ok('create-selected-response', 'The student writes the answer, so any level can be asked.'),
  ],
});

// A professor's own question from before 19 Nov 2026, stored as 'fallback'
// like the template's: a regenerated draft of it is waiting.
const OLDER = base({
  _id: 'g-older', source: 'fallback', model: null, topic: 'User Datagram Protocol', bloom: 'remember', kind: 'mcq',
  text: 'Which header field lets a receiver detect a corrupted UDP segment?',
  options: ['Checksum', 'Length', 'Source port', 'Destination port'], answerIdx: 0,
  checks: PASSED('mcq', 'remember'),
});
const REWRITE = base({
  _id: 'g-rewrite-draft', status: 'draft', source: 'gemini', model: 'gemini-2.5-flash', approvedAt: null, replacesId: OLDER._id,
  sourceRef: { kind: 'slides', slides: [3] }, topic: 'User Datagram Protocol', bloom: 'remember', kind: 'mcq',
  text: 'A UDP receiver finds that a segment was damaged in transit. Which header field told it?',
  options: ['Checksum', 'Length', 'Source port', 'Destination port'], answerIdx: 0,
  checks: PASSED('mcq', 'remember'),
});
const REPLACES_NOTE = 'The question this replaces stays in rooms until you approve its replacement. Approving it takes the old '
  + 'one out; rejecting it leaves the old one as it is.';

// The same draft, rejected: rewriting it passes the link on (the Phase 5 review fixes).
const REJECTED_REWRITE = honest({ ...REWRITE, _id: 'g-rejected-rewrite', status: 'discarded' });

/*
 * Misconception labels (Phase 5). A label sits on a wrong option's words; an
 * 'ai' one the generator proposed reads as a draft until the professor
 * confirms or rewrites it. The counts are a GET's `report` for this question.
 */
const lbl = (option, label, provenance = 'professor') => ({ option, label, provenance, addedAt: '2026-11-12T05:00:00.000Z', changedAt: '2026-11-12T05:00:00.000Z', by: null });
const LABELLED = base({
  _id: 'g-labelled', source: 'llm', model: 'gemini-2.5-flash', topic: 'Transmission Control Protocol', bloom: 'remember', kind: 'mcq',
  sourceRef: { kind: 'slides', slides: [6] },
  text: 'Which of these describes how TCP delivers data between two processes?',
  options: ['Connectionless, with no handshake', 'Connection-oriented and reliable', 'Broadcast to every host on the network', 'Best effort, like IP'],
  answerIdx: 1,
  misconceptions: [
    lbl('Connectionless, with no handshake', 'Thinks TCP is connectionless, like UDP', 'ai'),
    lbl('Best effort, like IP', 'Takes the network layer’s best effort for the transport layer’s service'),
  ],
  checks: PASSED('mcq', 'remember'),
});
const LABELLED_REPORT = {
  counted: { questions: 1, labels: 2, aiDrafts: 1, answers: 41 },
  questions: [{
    questionId: 'g-labelled', answers: 41, students: 38, otherWording: 3,
    otherWordingNote: '3 of these students were given another wording of the options, so their answers match no label.',
    options: [
      { optionIdx: 0, students: 9, answers: 10, beforeLabel: 4, beforeChange: 0, sentence: '9 students chose the option linked to the misunderstanding "Thinks TCP is connectionless, like UDP". (an AI draft label, not yet confirmed by the professor)', note: 'Label added after 4 of these 10 answers.' },
      { optionIdx: 3, students: 4, answers: 4, beforeLabel: 0, beforeChange: 0, sentence: '4 students chose the option linked to the misunderstanding "Takes the network layer’s best effort for the transport layer’s service".', note: null },
    ],
  }],
};
const TRUEFALSE = base({
  _id: 'g-truefalse', source: 'teacher', model: null, topic: 'User Datagram Protocol', bloom: 'remember', kind: 'truefalse',
  text: 'UDP retransmits a datagram that is lost on the way.', answerBool: false,
  misconceptions: [lbl('True', 'Thinks every transport protocol recovers lost data')],
  checks: PASSED('truefalse', 'remember'),
});

/* -------------------------------------------------------------- stand-in */

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const fail = (message, status) => Object.assign(new Error(message), { status });
const failedOf = (q) => (q.checks ?? []).filter((c) => !c.ok).map(({ id, message }) => ({ id, message }));
const MAX_BYTES = 512000;

/** What the bytes are, as the server judges them: by their contents, never the name. */
async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return /^\s*<(\?xml|svg)/i.test(new TextDecoder().decode(b)) ? 'svg' : null;
}

const asDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(fail('That file could not be read.', 400));
  reader.readAsDataURL(file);
});

/* The label rules, as services/misconceptions.js applies them. */
const key = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const textsOf = (q) => (q.kind === 'truefalse' ? ['True', 'False'] : ['mcq', 'multi'].includes(q.kind) ? q.options ?? [] : null);
const wrongOf = (q) => {
  if (q.kind === 'truefalse') return [q.answerBool ? 1 : 0];
  const right = q.kind === 'multi' ? q.answerIdxs ?? [] : [q.answerIdx];
  return (q.options ?? []).map((_, i) => i).filter((i) => !right.includes(i));
};
const CONTACT = 'A misconception label names a misunderstanding, not a person, so it cannot hold an email address, a web address, a handle or a phone number.';
const hasContact = (t) => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(t) || /\bhttps?:\/\/|\bwww\.[^\s.]+\./i.test(t) || /(^|\s)@\w{2,}/.test(t)
  || (t.match(/\+?\d[\d\s().-]*\d/g) ?? []).some((run) => run.replace(/\D/g, '').length >= 10);
const REMOVED_ONE = 'One misconception label no longer applied and was removed: its option was reworded or taken away, or became a right answer. Add it again if it still fits.';

function standIn(question, { harder502 = false, canEdit = true, report = null } = {}) {
  let q = question;
  // The labels as GET and PATCH …/misconceptions answer them.
  const body = () => {
    const texts = textsOf(q) ?? [];
    const wrong = wrongOf(q);
    return {
      question: { _id: q._id, text: q.text, kind: q.kind, bloom: q.bloom, topic: q.topic, status: q.status, options: texts },
      labelled: Boolean(textsOf(q)),
      wrongOptions: wrong,
      misconceptions: (q.misconceptions ?? []).map((m) => ({
        ...m, optionIdx: texts.findIndex((t) => key(t) === key(m.option)),
        provenanceLabel: m.provenance === 'ai' ? 'AI draft' : "Professor's label", confirmed: m.provenance === 'professor',
      })).filter((m) => m.optionIdx >= 0),
      canEdit, maxLength: 120, note: LABEL_NOTE,
    };
  };
  return {
    // The counts follow the labels as they stand: a cleared label has none, a confirmed one is no longer a draft.
    async questionMisconceptions() {
      await wait(400);
      const now = body();
      const held = new Map(now.misconceptions.map((m) => [m.optionIdx, m]));
      const live = report && {
        ...report,
        questions: report.questions.map((x) => ({
          ...x,
          options: x.options.filter((o) => held.has(o.optionIdx)).map((o) => (held.get(o.optionIdx).provenance === 'ai' ? o
            : { ...o, sentence: o.sentence.replace(' (an AI draft label, not yet confirmed by the professor)', '') })),
        })),
      };
      return { ...now, rooms: [], report: live ?? { counted: { questions: 0, labels: 0, aiDrafts: 0, answers: 0 }, questions: [], top: [] } };
    },
    async setMisconceptions(id, changes) {
      await wait(450);
      if (!canEdit) throw fail('That chapter belongs to another teacher - you can read it but not change it.', 403);
      const texts = textsOf(q);
      const wrong = wrongOf(q);
      const held = new Map((q.misconceptions ?? []).map((m) => [key(m.option), m]));
      const changed = [];
      for (const c of changes) {
        const i = c.option;
        const before = held.get(key(texts[i]));
        if (!wrong.includes(i)) throw fail(`Option ${i + 1} ("${texts[i]}") is a right answer: a misconception label goes on a wrong option.`, 400);
        if (c.confirm) {
          if (!before) throw fail(`Option ${i + 1} has no label to confirm.`, 400);
          if (before.provenance !== 'professor') { held.set(key(texts[i]), { ...before, provenance: 'professor' }); changed.push({ optionIdx: i, action: 'confirmed' }); }
        } else if (c.label == null || c.label === '') {
          if (before) { held.delete(key(texts[i])); changed.push({ optionIdx: i, action: 'cleared' }); }
        } else {
          const text = String(c.label).replace(/\s+/g, ' ').trim();
          if (text.length > 120) throw fail(`Option ${i + 1}: A misconception label is at most 120 characters; this one is ${text.length}.`, 400);
          if (hasContact(text)) throw fail(`Option ${i + 1}: ${CONTACT}`, 400);
          if (before && before.label === text) {
            if (before.provenance !== 'professor') { held.set(key(texts[i]), { ...before, provenance: 'professor' }); changed.push({ optionIdx: i, action: 'confirmed' }); }
          } else {
            held.set(key(texts[i]), lbl(texts[i], text));
            changed.push({ optionIdx: i, action: before ? 'edited' : 'added' });
          }
        }
      }
      // A label changes no mark: the status is untouched.
      q = { ...q, misconceptions: [...held.values()] };
      return { ...body(), changed };
    },
    // An edit that rewords or removes a labelled option, or makes it right, takes its label off.
    async editQuestion(id, patch) {
      await wait(450);
      if (!String(patch.text ?? '').trim()) throw fail('missing text', 400);
      const next = { ...q, ...patch };
      const texts = textsOf(next) ?? [];
      const wrong = wrongOf(next);
      const fits = (m) => wrong.some((i) => key(texts[i]) === key(m.option));
      const removed = (q.misconceptions ?? []).filter((m) => !fits(m)).map(({ option, label, provenance }) => ({ option, label, provenance }));
      q = { ...next, misconceptions: (q.misconceptions ?? []).filter(fits) };
      return {
        question: q,
        ...(removed.length ? {
          misconceptionsRemoved: removed,
          misconceptionsNote: removed.length === 1 ? REMOVED_ONE : `${removed.length} misconception labels no longer applied and were removed: their options were reworded or taken away, or became right answers. Add them again where they still fit.`,
        } : {}),
      };
    },
    // Approving a regenerated draft retires the active question it replaces.
    async approveQuestion() {
      await wait(350);
      const was = q.status;
      q = { ...q, status: 'active', approvedAt: new Date().toISOString() };
      return { question: q, changed: true, failedChecks: failedOf(q), ...(was !== 'active' && q.replacesId ? { retired: q.replacesId } : {}) };
    },
    async rejectQuestion() {
      await wait(350);
      q = { ...q, status: 'discarded' };
      return { question: q, changed: true };
    },
    async createQuestion(contentId, body) {
      await wait(450);
      if (!String(body.text ?? '').trim()) throw fail('missing text', 400);
      return { question: { ...body, _id: 'g-new', status: 'active', model: null, sourceRef: null, contentId }, failedChecks: [] };
    },
    async regenerateQuestion(id, direction) {
      await wait(800);
      if (direction) {
        const bloom = LEVELS[LEVELS.indexOf(q.bloom) + (direction === 'harder' ? 1 : -1)];
        if (harder502 && direction === 'harder') throw fail(`Could not write a ${LABEL[bloom]} question on this topic from the material.`, 502);
        return { question: { ...q, _id: 'g-shifted', status: 'draft', bloom }, direction, from: id };
      }
      // An active question stays active; its draft names it. Anything else is discarded at once, with no link.
      if (q.status === 'active') {
        return { question: { ...q, _id: 'g-rewrite', status: 'draft', replacesId: id }, replaces: id, note: REPLACES_NOTE };
      }
      // A replacement draft never approved (a draft, or one rejected) passes its link on (the review fixes).
      const link = q.replacesId && !q.approvedAt ? q.replacesId : null;
      q = { ...q, status: 'discarded' };
      return { question: { ...q, _id: 'g-rewrite', status: 'draft', replacesId: link }, ...(link ? { replaces: link, note: REPLACES_NOTE } : {}) };
    },
    async splitQuestion(id) {
      await wait(450);
      return { questions: [{ ...q, _id: 'g-a' }, { ...q, _id: 'g-b' }], discarded: id };
    },
    async discardQuestion() { await wait(350); q = { ...q, status: 'discarded' }; return { question: q }; },
    async restoreQuestion() {
      await wait(350);
      const was = q.status;
      q = { ...q, status: 'active' };
      return { question: q, ...(was !== 'active' && q.replacesId ? { retired: q.replacesId } : {}) };
    },
    async uploadMedia(file, contentId, alt) {
      await wait(600);
      if (file.size > MAX_BYTES) {
        throw fail('That image is over the 500 KB limit. Every phone in the room downloads it over the same wifi: save it smaller (a screenshot, or an export about 1200 pixels wide, is usually enough).', 413);
      }
      const mime = await sniff(file);
      if (mime === 'svg') throw fail('SVG images are not accepted: an SVG can carry script, which would run for anyone who opens it. Export it as PNG.', 415);
      if (!mime) throw fail('Only PNG, JPEG and WebP images are accepted, and this file is none of them. It was checked by its contents, not its name.', 415);
      const said = String(alt ?? '').replace(/\s+/g, ' ').trim();
      if (!said) throw fail('Describe the image in "alt": what a student who cannot see it needs to know to answer.', 400);
      return { media: { _id: 'g-media', contentId, mime, bytes: file.size, alt: said, url: await asDataUrl(file) } };
    },
  };
}

/* -------------------------------------------------------------- the page */

/** The page behind the sheet: what the bank would say once the editor is done. */
function Stage({ question, title, line, options, replaces = null, start = null }) {
  const [round, setRound] = useState(0);
  const [open, setOpen] = useState(true);
  const [told, setTold] = useState(null);
  const [labelsSaid, setLabelsSaid] = useState(0);
  const [services, setServices] = useState(() => standIn(question, options));

  const again = () => {
    setServices(standIn(question, options));
    setTold(null);
    setLabelsSaid(0);
    setRound((r) => r + 1);
    setOpen(true);
  };

  return (
    <div className="au-gal">
      <div className="au-gal-in">
        <span className="eyebrow">Authoring · sample data</span>
        <h1>{title}</h1>
        <p className="t-lead">{line}</p>
        {told
          ? (
            <Note tone={told.tone}>
              <b>onDone</b> {told.note ?? 'was called with no sentence.'}
              {told.retired && <> <b>retired</b> <span className="mono">{told.retired}</span>: the bank names it after the sentence.</>}
              {told.removed && (
                <>
                  <div>{told.removed.note}</div>
                  <ul className="tc-flagged">
                    {told.removed.items.map((r) => (
                      <li key={r.option}>
                        <span className="tc-ref">{r.id}</span>
                        <span className="tc-flagged-txt"><span>{r.label}</span><span className="t-small dim">Was on “{r.option}”</span></span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Note>
          )
          : <p className="t-meta">The sentence the bank would show after an action appears here.</p>}
        {labelsSaid > 0 && <p className="t-meta">onLabels called {labelsSaid === 1 ? 'once' : `${labelsSaid} times`}: the bank reads itself again, and the sheet stays open.</p>}
        {!open && <div><Button icon="edit" onClick={again}>Open the editor again</Button></div>}
      </div>
      {open && (
        <Editor
          key={round}
          question={question}
          contentId={CONTENT_ID}
          kinds={KINDS}
          labelKinds={LABEL_KINDS}
          replaces={replaces}
          start={start}
          services={services}
          onLabels={() => setLabelsSaid((n) => n + 1)}
          onClose={() => setOpen(false)}
          onDone={(info) => { setTold(info ?? {}); setOpen(false); }}
        />
      )}
    </div>
  );
}

function Keys() {
  const shown = [HOTTEXT, DROPDOWN, TABLE, GRID, PASSAGE, IMAGE];
  return (
    <div className="au-gal">
      <div className="au-gal-in">
        <span className="eyebrow">Authoring · sample data</span>
        <h1>Answer keys</h1>
        <p className="t-lead">The four new kinds as a teacher checks them, then a passage and an image above their keys.</p>
      </div>
      <div className="au-gal-keys">
        {shown.map((q) => (
          <article key={q._id} className="card au-gal-key">
            <div className="cluster">
              <Level level={q.bloom} />
              <span className="t-meta">{KINDS.label[q.kind]}</span>
            </div>
            <h2>{q.text}</h2>
            <AnswerKey q={q} />
          </article>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- entries */

export default [
  {
    id: 'author-write',
    title: 'Authoring: write your own',
    role: 'professor',
    note: 'An empty sheet. Pick a level and its interactions appear; it is added as approved.',
    render: () => <Stage question={null} title="Write your own" line="The sheet opens empty. The level picked decides the interaction, and the question goes straight into the bank as approved." />,
  },
  {
    id: 'author-write-filter',
    title: 'Authoring: write your own, from a filter',
    role: 'professor',
    note: 'The bank was filtered to Apply and the topic “Port numbers”, so the sheet starts there.',
    render: () => <Stage question={null} start={{ bloom: 'apply', topic: 'Port numbers' }} title="Write your own, from a filter" line="Write your own takes the level and topic of the filters in force: here Apply and “Port numbers”, with Apply’s first interaction filled in." />,
  },
  {
    id: 'author-draft',
    title: 'Authoring: a flagged draft',
    role: 'professor',
    note: 'An AI draft with two failed rule checks, slides 3 and 4, Save and approve, and Reject.',
    render: () => <Stage question={FLAGGED} title="A flagged draft" line="Generated by a model, failing two rule checks. Save and approve saves, then approves, and the bank is told which checks failed." />,
  },
  {
    id: 'author-hottext',
    title: 'Authoring: pick the words',
    role: 'professor',
    note: 'Type the sentence, then click the words that meet the criterion.',
    render: () => <Stage question={HOTTEXT} title="Pick the words" line="The sentence splits at the spaces; picked words follow their place when the sentence is edited." />,
  },
  {
    id: 'author-dropdown',
    title: 'Authoring: choose for each gap',
    role: 'professor',
    note: 'One list of choices per ____ in the text, kept in step with the markers.',
    render: () => <Stage question={DROPDOWN} title="Choose for each gap" line="Add or remove a ____ in the text and the gaps below follow it." />,
  },
  {
    id: 'author-table',
    title: 'Authoring: complete the table',
    role: 'professor',
    note: 'Columns, rows, and per cell: given, or the student writes.',
    render: () => <Stage question={TABLE} title="Complete the table" line="Each cell is shown to the student or left for them to write, with every answer accepted there." />,
  },
  {
    id: 'author-grid',
    title: 'Authoring: tick every match',
    role: 'professor',
    note: 'Row and column labels, and a board of ticks.',
    render: () => <Stage question={GRID} title="Tick every match" line="Tick each pairing that holds. Neither an empty board nor a full one is accepted." />,
  },
  {
    id: 'author-passage',
    title: 'Authoring: a passage',
    role: 'professor',
    note: 'A passage with where it is from, previewed as the phone shows it.',
    render: () => <Stage question={PASSAGE} title="A passage" line="A passage of up to 4,000 characters with an optional source, which never reaches the phone." />,
  },
  {
    id: 'author-image',
    title: 'Authoring: an image',
    role: 'professor',
    note: 'An attached image with alt text. Harder answers the server’s 502 here.',
    render: () => (
      <Stage
        question={IMAGE}
        options={{ harder502: true }}
        title="An image"
        line="An image with its alt text and source. Replace it to try an upload: the stand-in refuses as the server does. Harder answers with the server’s 502."
      />
    ),
  },
  {
    id: 'author-own',
    title: 'Authoring: your own question at Create',
    role: 'professor',
    note: 'Labelled professor-written (source "teacher"), and Harder is not on offer at the top of the ladder.',
    render: () => <Stage question={OWN} title="Your own question at Create" line="A question a professor wrote is stored as hers and labelled so. Create is the top level, so Harder says why it is off." />,
  },
  {
    id: 'author-rewrite-active',
    title: 'Authoring: rewrite a question in use',
    role: 'professor',
    note: 'An older question of the professor’s, labelled with the template. Rewrite leaves it serving and passes on the server’s note.',
    render: () => (
      <Stage
        question={OLDER}
        title="Rewrite a question in use"
        line="Stored as 'fallback' before 19 Nov 2026, so the label names both the template and the professor. Rewrite it: the reply's note says it stays in rooms until the rewrite is approved."
      />
    ),
  },
  {
    id: 'author-replaces',
    title: 'Authoring: a draft that replaces a question',
    role: 'professor',
    note: 'A regenerated draft with replacesId: "Replaces:" names the old question; Save and approve answers with retired.',
    render: () => (
      <Stage
        question={REWRITE}
        replaces={{ old: OLDER, name: 'Q07' }}
        title="A draft that replaces a question"
        line="The question it replaces keeps serving until this draft is approved. Save and approve: the reply names the question it retired."
      />
    ),
  },
  {
    id: 'author-rewrite-rejected',
    title: 'Authoring: rewrite a rejected replacement',
    role: 'professor',
    note: 'A rejected draft that replaced a question: its rewrite still replaces it, and the reply says so (replaces, note).',
    render: () => (
      <Stage
        question={REJECTED_REWRITE}
        replaces={{ old: OLDER, name: 'Q07' }}
        title="Rewrite a rejected replacement"
        line="Rewrite it: the new draft carries the same link, so approving it still retires Q07, and the server's note says so."
      />
    ),
  },
  {
    id: 'author-labels',
    title: 'Authoring: misconception labels',
    role: 'professor',
    note: 'A box beside each wrong option, never the key: an AI draft label to confirm, a professor’s label, counts from the chapter’s rooms. Try an email address or 121 characters for the server’s refusal.',
    render: () => (
      <Stage
        question={LABELLED}
        options={{ report: LABELLED_REPORT }}
        title="Misconception labels"
        line="Each label saves on its own and changes no status. Confirm the AI draft on A, edit D, add one on C, or clear one; the key (B) takes none."
      />
    ),
  },
  {
    id: 'author-labels-tf',
    title: 'Authoring: a label on a true or false question',
    role: 'professor',
    note: 'Only the wrong answer takes a label: here "True".',
    render: () => <Stage question={TRUEFALSE} title="A label on a true or false question" line="The statement is false, so only True can carry a misconception." />,
  },
  {
    id: 'author-labels-hod',
    title: 'Authoring: labels, read only',
    role: 'hod',
    note: 'canEdit false: the labels and counts are read, with no box.',
    render: () => <Stage question={LABELLED} options={{ report: LABELLED_REPORT, canEdit: false }} title="Labels, read only" line="A head of department reads the labels and their counts; every write is the professor’s." />,
  },
  {
    id: 'author-labels-removed',
    title: 'Authoring: an edit that removes a label',
    role: 'professor',
    note: 'Reword option D and save: the reply names the label it took off, so it can be added again.',
    render: () => <Stage question={LABELLED} options={{ report: LABELLED_REPORT }} title="An edit that removes a label" line="Reword option D (“Best effort, like IP”) in the answer fields, then Save changes. Its label no longer fits and comes back in the reply." />,
  },
  {
    id: 'author-keys',
    title: 'Authoring: answer keys',
    role: 'professor',
    note: 'Pick the words, a choice per gap, the table and the grid, then a passage and an image.',
    render: () => <Keys />,
  },
];
