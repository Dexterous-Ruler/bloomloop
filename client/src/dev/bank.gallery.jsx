/**
 * The question bank with drafts waiting, drawn from sample data. Development
 * only. The screen calls the server for its actions, so pressing Approve here
 * answers with the server's "not found": these ids name nothing.
 */

import { useState } from 'react';

import Bank from '../teach/Bank.jsx';

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
  return {
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
    ...over,
  };
};

const DRAFTS = [
  q({ text: 'Which of these describes how UDP delivers a datagram?' }),
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
  q({ status: 'active', approvedAt: '2026-11-19T08:00:00.000Z', text: 'Which header field lets a receiver detect a corrupted UDP segment?', options: ['Checksum', 'Length', 'Source port', 'Destination port'] }),
  q({ status: 'active', approvedAt: '2026-11-19T08:00:00.000Z', bloom: 'understand', kind: 'match', topic: 'Multiplexing', text: 'Match each field to what it identifies.', pairs: [{ left: 'Source port', right: 'The sending process' }, { left: 'Destination port', right: 'The receiving process' }, { left: 'Checksum', right: 'Damage in transit' }] }),
  q({ status: 'active', model: null, source: 'fallback', sourceRef: null, checks: null, approvedAt: '2026-11-19T08:00:00.000Z', bloom: 'apply', kind: 'blank', topic: 'Port numbers', text: 'HTTP servers listen on port ____ by default.', accept: ['80'] }),
  q({ status: 'discarded', text: 'Which of the following is a transport layer protocol? (rejected draft)', options: ['UDP', 'IP', 'Ethernet', 'HTTP'] }),
];

const CONTENT = { contentId: 'g-content', title: 'Unit III: Transport layer', kind: 'pptx', topics: ['User Datagram Protocol', 'Congestion control'] };

function Demo({ questions }) {
  const [bank, setBank] = useState(() => ({ questions, kinds: KINDS }));
  return <Bank content={CONTENT} selected={CONTENT.topics} bank={bank} onBank={setBank} onPhase={() => {}} onBack={() => {}} onNext={() => {}} />;
}

export default [
  {
    id: 'bank-drafts',
    title: 'Questions, drafts waiting',
    role: 'professor',
    note: 'Five drafts after a run, two flagged by a rule check, beside an approved bank. Each draft shows the slides it was read from and who wrote it.',
    render: () => <Demo questions={[...DRAFTS, ...APPROVED]} />,
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
    note: 'No drafts left, so the screen opens on the approved bank. A question you wrote has no source label.',
    render: () => <Demo questions={APPROVED} />,
  },
];
