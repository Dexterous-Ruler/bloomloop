/**
 * The question bank with drafts waiting, drawn from sample data. Development
 * only. The screen calls the server for its actions, so pressing Approve here
 * answers with the server's "not found": these ids name nothing. Every
 * question carries `provenance` and `levelCheck` as the server reads them
 * (dev/author.gallery.jsx's honest()), and some carry misconception labels.
 */

import { useState } from 'react';

import Bank from '../teach/Bank.jsx';
import { LABEL_KINDS, honest } from './author.gallery.jsx';

const KINDS = {
  forLevel: {
    remember: ['mcq', 'truefalse'],
    understand: ['match', 'categorise'],
    apply: ['blank', 'cloze', 'numeric', 'dropdown', 'table'],
    analyse: ['multi', 'categorise', 'hottext', 'grid'],
    evaluate: ['order', 'rank'],
    create: ['open'],
  },
  label: {},
};

const pass = (id, message) => ({ id, ok: true, message });
const LONGEST = {
  id: 'longest-option-is-key',
  ok: false,
  message: 'The answer is clearly the longest (96 characters against at most 41 for a wrong one). Students learn to pick the longest option; even the lengths out.',
};
const FIGURE = {
  id: 'slide-only-reference',
  ok: false,
  message: 'The stem names a figure ("the graph"), but no image is attached. Attach the picture, or reword the stem so it stands alone.',
};

let n = 0;
const q = (over) => {
  n += 1;
  return honest({
    _id: `g${String(n).padStart(23, '0')}`,
    status: 'draft',
    source: 'gemini',
    model: 'gemini-2.5-flash',
    sourceRef: { kind: 'slides', slides: [3, 4] },
    checks: [pass('absolute-words', 'No option uses an absolute word.'), pass('duplicate-options', 'Every option says something different.')],
    createdBy: null,
    approvedBy: null,
    approvedAt: null,
    topic: 'User Datagram Protocol',
    kind: 'mcq',
    bloom: 'remember',
    options: ['Connectionless', 'Connection-oriented', 'Byte-stream', 'Reliable'],
    answerIdx: 0,
    misconceptions: [],
    ...over,
  });
};
const lbl = (option, label, provenance = 'professor') => ({ option, label, provenance, addedAt: '2026-11-18T05:00:00.000Z', changedAt: '2026-11-18T05:00:00.000Z', by: null });

const DRAFTS = [
  // The generator proposed a label on a wrong option: an AI draft label until confirmed.
  q({ text: 'Which of these describes how UDP delivers a datagram?', misconceptions: [lbl('Connection-oriented', 'Thinks UDP sets up a connection before sending, as TCP does', 'ai')] }),
  q({
    text: 'Why might a streaming service choose UDP over TCP?',
    options: ['Because late packets are worthless to a live stream, so retransmitting them only adds delay', 'UDP is newer', 'TCP has no ports', 'UDP encrypts data'],
    checks: [LONGEST, pass('absolute-words', 'No option uses an absolute word.')],
  }),
  q({
    text: 'Using the graph, at which window size does throughput level off?',
    bloom: 'analyse',
    kind: 'multi',
    topic: 'Congestion control',
    sourceRef: { kind: 'slides', slides: [9] },
    options: ['4 segments', '8 segments', '16 segments', '32 segments'],
    answerIdxs: [1, 2],
    checks: [FIGURE],
  }),
  q({ text: 'A sender waits for each acknowledgement before sending the next segment.', kind: 'truefalse', answerBool: true, topic: 'Reliable data transfer', model: 'offline-template', source: 'fallback', sourceRef: null }),
  q({
    text: 'Explain why TCP needs a three-way handshake rather than two messages.',
    bloom: 'create',
    kind: 'open',
    topic: 'Connection management',
    rubric: ['both sides choose a sequence number', 'each must be acknowledged', 'old duplicate connections'],
  }),
];

const APPROVED = [
  q({ status: 'active', approvedAt: '2026-11-19T08:00:00.000Z', text: 'Which header field lets a receiver detect a corrupted UDP segment?', options: ['Checksum', 'Length', 'Source port', 'Destination port'], misconceptions: [lbl('Length', 'Thinks a wrong length is how damage shows up')] }),
  q({ status: 'active', approvedAt: '2026-11-19T08:00:00.000Z', bloom: 'understand', kind: 'match', topic: 'Multiplexing', text: 'Match each field to what it identifies.', pairs: [{ left: 'Source port', right: 'The sending process' }, { left: 'Destination port', right: 'The receiving process' }, { left: 'Checksum', right: 'Damage in transit' }] }),
  // A professor's own question from before 19 Nov 2026: stored as 'fallback', like the template's.
  q({ status: 'active', model: null, source: 'fallback', sourceRef: null, checks: null, approvedAt: '2026-11-12T08:00:00.000Z', bloom: 'apply', kind: 'blank', topic: 'Port numbers', text: 'HTTP servers listen on port ____ by default.', accept: ['80'] }),
  // A professor's own question since 19 Nov 2026: source 'teacher'.
  q({ status: 'active', model: null, source: 'teacher', sourceRef: null, checks: null, approvedAt: null, bloom: 'apply', kind: 'blank', topic: 'Port numbers', text: 'DNS answers queries on port ____.', accept: ['53'] }),
  q({ status: 'discarded', text: 'Which of the following is a transport layer protocol? (rejected draft)', options: ['UDP', 'IP', 'Ethernet', 'HTTP'] }),
  // An older Choose one at Analyse: its kind does not ask for its level, so the level is uncertain.
  {
    ...q({ status: 'active', approvedAt: '2026-11-10T08:00:00.000Z', bloom: 'analyse', topic: 'Congestion control', text: 'Which change would most reduce loss on a congested link?', options: ['A larger congestion window', 'A smaller congestion window', 'More retransmissions', 'A shorter timeout'], answerIdx: 1 }),
    levelCheck: {
      uncertain: true,
      reasons: [{ id: 'kind-does-not-fit-level', message: 'A "Choose one" question is not one of the kinds that ask for Analyse ("Choose all that apply", "Sort into groups", "Pick the words", "Tick every match"), so it may not ask for that level at all. Retag it, or change its kind.' }],
      sentence: 'Level uncertain. A "Choose one" question is not one of the kinds that ask for Analyse ("Choose all that apply", "Sort into groups", "Pick the words", "Tick every match"), so it may not ask for that level at all. Retag it, or change its kind.',
    },
  },
];

// A rewrite of the first approved question: it keeps serving until this draft is approved.
const REWRITE = q({
  text: 'A UDP receiver finds that a segment was damaged in transit. Which header field told it?',
  replacesId: APPROVED[0]._id,
  sourceRef: { kind: 'slides', slides: [3] },
  options: ['Checksum', 'Length', 'Source port', 'Destination port'],
});

const CONTENT = { contentId: 'g-content', title: 'Unit III: Transport layer', kind: 'pptx', topics: ['User Datagram Protocol', 'Congestion control'] };

function Demo({ questions }) {
  const [bank, setBank] = useState(() => ({ questions, kinds: KINDS, misconceptionLabels: LABEL_KINDS }));
  return <Bank content={CONTENT} selected={CONTENT.topics} bank={bank} onBank={setBank} onPhase={() => {}} onBack={() => {}} onNext={() => {}} />;
}

export default [
  {
    id: 'bank-drafts',
    title: 'Questions, drafts waiting',
    role: 'professor',
    note: 'Six drafts beside an approved bank: two flagged by a rule check, one a rewrite that names the question it replaces. Each draft shows the slides it was read from, the server’s provenance chip ("AI draft") and "Level uncertain", since no professor has confirmed the model’s level; the first carries an AI draft misconception label. The room panel shows the review state by level: approved solid, waiting hatched.',
    render: () => <Demo questions={[...DRAFTS, REWRITE, ...APPROVED]} />,
  },
  {
    id: 'bank-drafts-only',
    title: 'Questions, a fresh run with nothing approved',
    role: 'professor',
    note: 'A room cannot open on this yet: For the room counts approved questions only.',
    render: () => <Demo questions={DRAFTS} />,
  },
  {
    id: 'bank-approved',
    title: 'Questions, every draft approved',
    role: 'professor',
    note: 'No drafts left, so the screen opens on the approved bank. Each question carries the server’s provenance chip (who wrote it, and whether it was let in); an older Choose one at Analyse is marked "Level uncertain". Open a row for its sentence and its labels. Evaluate and Create are thin, so "Draft for these levels" is offered (it opens the planner, which asks the server for a preview: here, a made-up chapter). Filter by a level or topic, then Write your own: the sheet starts there.',
    render: () => <Demo questions={APPROVED} />,
  },
];
