/**
 * Item statistics, drawn from sample data. Development only.
 *
 * The sample is one chapter (Computer Networks, the transport layer) run in two
 * rooms by 26 students, in the shape of the item report in docs/API.md
 * ("Phase 2: item statistics"): flagged first, then by level. Every item's
 * figures agree with each other (correct / attempts, the band against the
 * thresholds, the counts against the answers). Nothing here talks to the
 * server.
 */

import { useState } from 'react';

import { KIND_LABEL } from '../lib/kinds.js';
import AccountShell from '../shell/AccountShell.jsx';
import { ItemDetail, ItemFigures, StatsView, StatusTag } from '../teach/ItemStats.jsx';
import { Level, Note } from '../ui/index.jsx';

/* ------------------------------------------------------------------ sample */

const THRESHOLDS = { easyAt: 0.8, hardBelow: 0.4, minAnswersForBand: 5, minStudentsForPointBiserial: 10 };
const TOO_FEW = 'Fewer than 10 students who also answered other questions.';
const SAME_MARK = 'Everyone got the same mark on it, so it cannot separate stronger students from weaker ones.';
const WRONG_KEY = {
  id: 'negative-point-biserial',
  message: 'Students who did well on their other answers got this one wrong more often than those who did not. The usual cause is a wrong answer key: check the key first, then the wording.',
};

const opts = (rows) => rows.map(([text, count, key], index) => ({ index, text, count, key: Boolean(key) }));
const one = (options, unanswered = 0, label = null) => ({ label, select: 'one', unanswered, options: opts(options) });

const ITEM = {
  wrongKey: {
    questionId: '1f0c7a2e9b4d3c5a6e8f0b11', text: 'Which protocol is connectionless?', kind: 'mcq', bloom: 'remember',
    topic: 'Transport', status: 'active',
    attempts: 24, correct: 12, proportionCorrect: 0.5, meanScore: null, band: 'medium',
    pointBiserial: -0.4127, pointBiserialN: 24, pointBiserialNote: null, flags: [WRONG_KEY],
    distribution: { answers: 24, otherVersions: 0, rows: [one([['TCP', 12, true], ['SCTP', 1], ['UDP', 11], ['QUIC', 0]])] },
    versions: 1,
  },
  wrongKeyTf: {
    questionId: '2a9e4b6c1d3f5a7e9c0b2d22', text: 'TCP guarantees that every segment arrives within a fixed time.', kind: 'truefalse', bloom: 'remember',
    topic: 'Transmission Control Protocol', status: 'active',
    attempts: 25, correct: 6, proportionCorrect: 0.24, meanScore: null, band: 'hard',
    pointBiserial: -0.2215, pointBiserialN: 25, pointBiserialNote: null, flags: [WRONG_KEY],
    distribution: { answers: 25, otherVersions: 0, rows: [one([['True', 6, true], ['False', 19]])] },
    versions: 1,
  },
  few: {
    questionId: '3b0f5c7d2e4a6b8f0d1c3e33', text: 'Which UDP header field lets a receiver detect a corrupted segment?', kind: 'mcq', bloom: 'remember',
    topic: 'User Datagram Protocol', status: 'active',
    attempts: 3, correct: 2, proportionCorrect: 2 / 3, meanScore: null, band: null,
    pointBiserial: null, pointBiserialN: 3, pointBiserialNote: TOO_FEW, flags: [],
    distribution: { answers: 3, otherVersions: 0, rows: [one([['Checksum', 2, true], ['Length', 1], ['Source port', 0], ['Destination port', 0]])] },
    versions: 1,
  },
  sameMark: {
    questionId: '4c1a6d8e3f5b7c9a1e2d4f44', text: 'UDP sends data without a handshake first.', kind: 'truefalse', bloom: 'remember',
    topic: 'User Datagram Protocol', status: 'active',
    attempts: 26, correct: 26, proportionCorrect: 1, meanScore: null, band: 'easy',
    pointBiserial: null, pointBiserialN: 26, pointBiserialNote: SAME_MARK, flags: [],
    distribution: { answers: 26, otherVersions: 0, rows: [one([['True', 26, true], ['False', 0]])] },
    versions: 1,
  },
  typed: {
    questionId: '5d2b7e9f4a6c8d0b2f3e5a55', text: 'The TCP header field a receiver uses to say how much more data it can take is the ____.', kind: 'blank', bloom: 'remember',
    topic: 'Flow control', status: 'active',
    attempts: 26, correct: 19, proportionCorrect: 19 / 26, meanScore: null, band: 'medium',
    pointBiserial: 0.4471, pointBiserialN: 26, pointBiserialNote: null, flags: [],
    distribution: null,
    versions: 1,
  },
  deleted: {
    questionId: '6e3c8f0a5b7d9e1c3a4f6b66', text: 'Which layer does TCP belong to?', kind: 'mcq', bloom: 'remember',
    topic: 'Transport', status: 'deleted',
    attempts: 14, correct: 13, proportionCorrect: 13 / 14, meanScore: null, band: 'easy',
    pointBiserial: 0.152, pointBiserialN: 14, pointBiserialNote: null, flags: [],
    distribution: { answers: 14, otherVersions: 0, rows: [one([['Transport', 13, true], ['Network', 1], ['Application', 0], ['Link', 0]])] },
    versions: 1,
  },
  sort: {
    questionId: '7f4d9a1b6c8e0f2d4b5a7c77', text: 'Sort each of these into the layer that handles it.', kind: 'categorise', bloom: 'understand',
    topic: 'Layering', status: 'active',
    attempts: 25, correct: 15, proportionCorrect: 0.6, meanScore: 0.74, band: 'medium',
    pointBiserial: 0.3812, pointBiserialN: 25, pointBiserialNote: null, flags: [],
    distribution: {
      answers: 25, otherVersions: 0,
      rows: [
        one([['Transport', 22, true], ['Network', 3]], 0, 'Port numbers'),
        one([['Transport', 17, true], ['Network', 7]], 1, 'Checksums on segments'),
        one([['Transport', 4], ['Network', 21, true]], 0, 'Routing tables'),
        one([['Transport', 2], ['Network', 23, true]], 0, 'IP addresses'),
        one([['Transport', 19, true], ['Network', 5]], 1, 'Flow control'),
        one([['Transport', 13], ['Network', 11, true]], 1, 'Fragmentation'),
      ],
    },
    versions: 1,
  },
  multi: {
    questionId: '8a5e0b2c7d9f1a3e5c6b8d88', text: 'Which of these does TCP provide? Choose all that apply.', kind: 'multi', bloom: 'understand',
    topic: 'Transmission Control Protocol', status: 'active',
    attempts: 26, correct: 15, proportionCorrect: 15 / 26, meanScore: 0.71, band: 'medium',
    pointBiserial: 0.3305, pointBiserialN: 26, pointBiserialNote: null, flags: [],
    distribution: {
      answers: 22, otherVersions: 4,
      rows: [{
        label: null, select: 'many', unanswered: 0,
        options: opts([['Reliable, in-order delivery', 20, true], ['Flow control', 16, true], ['Congestion control', 12, true], ['Message boundaries', 9], ['A guaranteed delay', 2]]),
      }],
    },
    versions: 2,
  },
  match: {
    questionId: '9b6f1c3d8e0a2b4f6d7c9e99', text: 'Match each TCP flag to what it does.', kind: 'match', bloom: 'understand',
    topic: 'Connection management', status: 'active',
    attempts: 24, correct: 11, proportionCorrect: 11 / 24, meanScore: 0.58, band: 'medium',
    pointBiserial: 0.2904, pointBiserialN: 24, pointBiserialNote: null, flags: [],
    distribution: {
      answers: 24, otherVersions: 0,
      rows: [
        ['SYN', [18, 2, 1, 3], 0, 0], ['ACK', [3, 17, 2, 1], 1, 1], ['FIN', [1, 2, 13, 7], 1, 2], ['RST', [2, 1, 8, 12], 1, 3],
      ].map(([label, counts, unanswered, key]) => one(
        ['Opens a connection', 'Acknowledges data received', 'Closes a connection gracefully', 'Aborts a connection'].map((t, i) => [t, counts[i], i === key]),
        unanswered, label,
      )),
    },
    versions: 1,
  },
  discarded: {
    questionId: 'ac7a2d4e9f1b3c5a7e8d0faa', text: 'Pick the words that name a transport-layer protocol: TCP runs over IP, and so do UDP and QUIC, while Ethernet carries them all.', kind: 'hottext', bloom: 'understand',
    topic: 'Transport', status: 'discarded',
    attempts: 12, correct: 7, proportionCorrect: 7 / 12, meanScore: 0.69, band: 'medium',
    pointBiserial: null, pointBiserialN: 9, pointBiserialNote: TOO_FEW, flags: [],
    distribution: {
      answers: 12, otherVersions: 0,
      rows: [{ label: null, select: 'many', unanswered: 0, options: opts([['TCP', 11, true], ['IP', 3], ['UDP', 9, true], ['QUIC', 4, true], ['Ethernet', 1]]) }],
    },
    versions: 1,
  },
  open: {
    questionId: 'bd8b3e5f0a2c4d6b8f9e1abb', text: 'Judge whether moving the transport layer into user space, as QUIC does, is a good trade for a mobile app. Give one reason each way.', kind: 'open', bloom: 'evaluate',
    topic: 'QUIC', status: 'active',
    attempts: 18, correct: 7, proportionCorrect: 7 / 18, meanScore: 0.48, band: 'hard',
    pointBiserial: 0.221, pointBiserialN: 18, pointBiserialNote: null, flags: [],
    distribution: null,
    versions: 1,
  },
  idleRank: {
    questionId: 'ce9c4f6a1b3d5e7c9a0f2bcc', text: 'Rank these from the most to the least header overhead per segment.', kind: 'rank', bloom: 'analyse',
    topic: 'Transport', status: 'active',
    attempts: 0, correct: 0, proportionCorrect: null, meanScore: null, band: null,
    pointBiserial: null, pointBiserialN: 0, pointBiserialNote: TOO_FEW, flags: [], distribution: null, versions: 0,
  },
  idleCloze: {
    questionId: 'dfad5a7b2c4e6f8dab1c3cdd', text: 'TCP opens a connection with a ____ handshake and closes it with ____ segments.', kind: 'cloze', bloom: 'remember',
    topic: 'Connection management', status: 'active',
    attempts: 0, correct: 0, proportionCorrect: null, meanScore: null, band: null,
    pointBiserial: null, pointBiserialN: 0, pointBiserialNote: TOO_FEW, flags: [], distribution: null, versions: 0,
  },
};

const ITEMS = [
  ITEM.wrongKey, ITEM.wrongKeyTf,
  ITEM.few, ITEM.sameMark, ITEM.typed, ITEM.deleted, ITEM.idleCloze,
  ITEM.sort, ITEM.multi, ITEM.match, ITEM.discarded,
  ITEM.idleRank, ITEM.open,
];

const ROOMS = [
  { code: 'TRN4KX', title: 'Unit III: Transport layer', status: 'closed', startedAt: '2026-11-12T09:05:00.000Z' },
  { code: 'ZQ4UQ6', title: 'Unit III: Transport layer, section B', status: 'open', startedAt: '2026-11-19T10:10:00.000Z' },
];

const REPORT = {
  content: { _id: '58bd9dd08e57d26befa6f02e', title: 'Computer Networks - Unit 4: The Transport Layer' },
  rooms: ROOMS,
  counted: { answers: ITEMS.reduce((n, i) => n + i.attempts, 0), students: 26 },
  thresholds: THRESHOLDS,
  items: ITEMS,
};

const EMPTY = {
  content: { _id: '2c63ed724a3ebadade20bf24', title: 'Photosynthesis' },
  rooms: [],
  counted: { answers: 0, students: 0 },
  thresholds: THRESHOLDS,
  items: [],
};

/* ------------------------------------------------------------------ frames */

function Frame({ title = 'How it went', sub, children }) {
  return (
    <AccountShell current="console" crumb="Questions · Computer Networks, Unit 4" title={title} sub={sub}>
      {children}
    </AccountShell>
  );
}

/** One question as the bank shows it: the row with its figures, opened. */
function Specimen({ item, sub }) {
  const [asked, setAsked] = useState('');
  return (
    <Frame title="One question" sub={sub}>
      <div className="stack stack-3" style={{ maxWidth: 880 }}>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '20px clamp(16px, 4vw, 24px) 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
            <span className="it-item-meta">
              <Level level={item.bloom} />
              <span className="it-topic clip">{item.topic}</span>
              <i className="it-dot" aria-hidden="true" />
              <span>{KIND_LABEL[item.kind] ?? item.kind}</span>
              <StatusTag status={item.status} />
            </span>
            <span className="it-item-text" style={{ display: 'block' }}>{item.text}</span>
            <ItemFigures item={item} />
          </div>
          <ItemDetail item={item} thresholds={THRESHOLDS} onCheckKey={setAsked} />
        </section>
        {asked && <Note tone="ok">onCheckKey was called with <span className="mono">{asked}</span>. On the bank screen it opens that question in the editor.</Note>}
      </div>
    </Frame>
  );
}

function Tab({ data, loading = false, error = '' }) {
  const [asked, setAsked] = useState('');
  return (
    <Frame sub="Every question across the rooms run on this chapter: how many answered, how many got it right, and what they chose.">
      <div className="stack stack-3">
        {asked && <Note tone="ok">onCheckKey was called with <span className="mono">{asked}</span>. On the bank screen it opens that question in the editor.</Note>}
        <StatsView stats={{ data, loading, error, reload: undefined }} onCheckKey={setAsked} />
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ entries */

export default [
  {
    id: 'items-tab',
    title: 'How it went, two rooms on one chapter',
    role: 'professor',
    note: 'The bank’s tab: 13 questions, two flagged first, one deleted, one discarded, two nobody has answered.',
    render: () => <Tab data={REPORT} />,
  },
  {
    id: 'items-wrong-key',
    title: 'A wrong key, flagged',
    role: 'professor',
    note: 'A choose-one keyed TCP: the class split between TCP and UDP, and the point-biserial is below 0.',
    render: () => <Specimen item={ITEM.wrongKey} sub="A choose-one whose key is worth a second look." />,
  },
  {
    id: 'items-sort',
    title: 'Sort into groups, six rows',
    role: 'professor',
    note: 'One row of counts per item to sort, with a mean score beside the share correct.',
    render: () => <Specimen item={ITEM.sort} sub="A sort-into-groups question: one row of counts per item." />,
  },
  {
    id: 'items-multi',
    title: 'Choose all that apply, edited while in use',
    role: 'professor',
    note: 'Ticks add up to more than the answers; four answers were given to an earlier version and are left out.',
    render: () => <Specimen item={ITEM.multi} sub="A choose-all question, edited while a room was using it." />,
  },
  {
    id: 'items-typed',
    title: 'A typed answer',
    role: 'professor',
    note: 'Fill in the blank: no options, so no spread of choices.',
    render: () => <Specimen item={ITEM.typed} sub="A fill-in-the-blank question." />,
  },
  {
    id: 'items-few',
    title: 'Too few answers for a band',
    role: 'professor',
    note: 'Three answers: no band, and no point-biserial.',
    render: () => <Specimen item={ITEM.few} sub="A question only three students reached." />,
  },
  {
    id: 'items-same-mark',
    title: 'Everyone right, so no point-biserial',
    role: 'professor',
    note: 'The point-biserial cannot be worked out, and the server’s note says why.',
    render: () => <Specimen item={ITEM.sameMark} sub="A true-or-false question every student got right." />,
  },
  {
    id: 'items-empty',
    title: 'How it went, no room yet',
    role: 'professor',
    note: 'A chapter no room has run on.',
    render: () => <Tab data={EMPTY} />,
  },
  {
    id: 'items-loading',
    title: 'How it went, first read',
    role: 'professor',
    note: 'The read has not answered, so the skeleton stays.',
    render: () => <Tab data={null} loading />,
  },
];
