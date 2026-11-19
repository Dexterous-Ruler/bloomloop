/**
 * Item statistics, drawn from sample data. Development only.
 *
 * The sample is one chapter (Computer Networks, the transport layer) run in two
 * rooms by 26 students, in the shape of the item report in docs/API.md
 * ("Phase 2: item statistics"): flagged first, then by level. Every item's
 * figures agree with each other (correct / attempts, the band against the
 * thresholds, the counts against the answers). Nothing here talks to the
 * server.
 *
 * Phase 5 fields ("Phase 5: honest indicators" and "misconception labels"):
 * each item's `provenance`, `levelCheck`, `basis` and `languages`, each wrong
 * option's `misconception`, and the report's `translation`, worded as the
 * server words them (services/honesty.js, services/misconceptions.js). Every
 * answer is in English today, so the language warning is drawn from a fixture
 * with Hindi answers, as server/scripts/honesty.mjs makes them.
 */

import { useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import AccountShell from '../shell/AccountShell.jsx';
import { ItemDetail, ItemFigures, ItemList, ItemMeta, StatsView, Thresholds } from '../teach/ItemStats.jsx';
import { Note } from '../ui/index.jsx';

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

/* Phase 5, as services/honesty.js words it. */
const MODEL = 'gemini-2.5-flash';
const PROV = {
  template: {
    source: 'template', sourceLabel: 'Offline template', model: 'offline-template', approval: 'approved', approvedAt: '2026-11-11T08:40:00.000Z', approvedBy: null, aiDraft: false,
    label: 'Offline template, approved',
    sentence: "Made by the offline template from the professor's material, without a language model. Approved by a professor.",
  },
  ai: {
    source: 'ai', sourceLabel: 'AI-generated', model: MODEL, approval: 'approved', approvedAt: '2026-11-11T08:42:00.000Z', approvedBy: null, aiDraft: false,
    label: 'AI-generated, approved',
    sentence: `Written by the language model (${MODEL}) from the professor's material. Approved by a professor.`,
  },
  aiUnrecorded: {
    source: 'ai', sourceLabel: 'AI-generated', model: MODEL, approval: 'unrecorded', approvedAt: null, approvedBy: null, aiDraft: false,
    label: 'AI-generated, approval not recorded',
    sentence: `Written by the language model (${MODEL}) from the professor's material. In use since before approvals were recorded.`,
  },
  aiGone: {
    source: 'ai', sourceLabel: 'AI-generated', model: MODEL, approval: 'discarded', approvedAt: null, approvedBy: null, aiDraft: false,
    label: 'AI-generated, not in use',
    sentence: `Written by the language model (${MODEL}) from the professor's material. Not in use: rejected, retired or removed.`,
  },
  professor: {
    source: 'professor', sourceLabel: 'Professor-written', model: null, approval: 'written', approvedAt: null, approvedBy: null, aiDraft: false,
    label: 'Professor-written',
    sentence: 'Written by a professor. In use since a professor wrote it.',
  },
  professorGone: {
    source: 'professor', sourceLabel: 'Professor-written', model: null, approval: 'discarded', approvedAt: null, approvedBy: null, aiDraft: false,
    label: 'Professor-written, not in use',
    sentence: 'Written by a professor. Not in use: rejected, retired or removed.',
  },
};
const CERTAIN = { uncertain: false, reasons: [], sentence: null };
const UNCONFIRMED = 'The language model chose this level and no professor has approved the question yet. Model-written questions often miss the level they were asked for, so check that it really asks for this level.';
const NOT_FOR_UNDERSTAND = 'A "Choose all that apply" question is not one of the kinds that ask for Understand ("Match the pairs", "Sort into groups"), so it may not ask for that level at all. Retag it, or change its kind.';
const unsure = (...messages) => ({
  uncertain: true,
  reasons: messages.map((message) => ({ id: message === UNCONFIRMED ? 'model-level-unconfirmed' : 'kind-does-not-fit-level', message })),
  sentence: `Level uncertain. ${messages.join(' ')}`,
});
const basisOf = (n) => ({
  answers: n,
  provisional: n < THRESHOLDS.minAnswersForBand,
  sentence: !n ? 'No answers yet.'
    : n < THRESHOLDS.minAnswersForBand ? `Based on ${n} ${n === 1 ? 'answer' : 'answers'}: too few for a difficulty band (${THRESHOLDS.minAnswersForBand} needed).`
      : `Based on ${n} answers.`,
});
const english = (answers, correct) => ({
  original: 'en', originalName: 'English',
  languages: answers ? [{ language: 'en', name: 'English', answers, correct, share: correct / answers, original: true }] : [],
  otherThanOriginal: 0, note: null, warning: null,
});
const TRANSLATION_NOTE = "Translation can change how hard a question is: a word with no exact match, a longer sentence or a changed example can make one language's version harder than another's. A gap between languages is a reason to check the translation before reading it as a gap in understanding.";
const translation = (warnings) => ({ original: 'en', minAnswersPerLanguage: 5, gapAbovePoints: 20, warnings, note: TRANSLATION_NOTE });
const label = (text, provenance = 'professor') => ({
  label: text, provenance, provenanceLabel: provenance === 'ai' ? 'AI draft' : "Professor's label", confirmed: provenance === 'professor',
});
/** Puts misconception labels on a one-row spread: { optionIndex: label(...) }; every other option null. */
const labelled = (distribution, byIndex) => ({
  ...distribution,
  rows: distribution.rows.map((r) => ({ ...r, options: r.options.map((o) => ({ ...o, misconception: byIndex[o.index] ?? null })) })),
});
/** The Phase 5 fields an item carries, from its own figures. */
const honest = (item, provenance = PROV.template, levelCheck = CERTAIN) => ({
  ...item, provenance, levelCheck: item.status === 'deleted' ? null : levelCheck, basis: basisOf(item.attempts), languages: english(item.attempts, item.correct),
});

const BASE = {
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

const ITEM = {
  wrongKey: honest(BASE.wrongKey),
  wrongKeyTf: honest(BASE.wrongKeyTf, PROV.ai),
  few: honest({
    ...BASE.few,
    distribution: labelled(BASE.few.distribution, {
      1: label('Thinks the length field is what shows a segment was damaged'),
      2: label('Confuses the port fields with error detection', 'ai'),
    }),
  }, PROV.professor),
  sameMark: honest({
    ...BASE.sameMark,
    distribution: labelled(BASE.sameMark.distribution, { 1: label('Thinks UDP opens a connection first, as TCP does') }),
  }),
  typed: honest(BASE.typed),
  deleted: honest(BASE.deleted, PROV.aiGone),
  sort: honest(BASE.sort),
  multi: honest({
    ...BASE.multi,
    distribution: labelled(BASE.multi.distribution, {
      3: label('Thinks TCP keeps the sender’s message boundaries'),
      4: label('Takes reliable delivery to mean delivery on time', 'ai'),
    }),
  }, PROV.aiUnrecorded, unsure(UNCONFIRMED, NOT_FOR_UNDERSTAND)),
  match: honest(BASE.match, PROV.professor),
  discarded: honest(BASE.discarded, PROV.professorGone),
  open: honest(BASE.open, PROV.ai),
  idleRank: honest(BASE.idleRank),
  idleCloze: honest(BASE.idleCloze),
  // Phase 5 only: a question with misconception labels, one of them the model's draft.
  labels: honest({
    questionId: 'e0be6b8c3d5f7a9bc2d4e6ee', text: 'Which transport protocol does a DNS query use by default?', kind: 'mcq', bloom: 'remember',
    topic: 'Application protocols', status: 'active',
    attempts: 26, correct: 13, proportionCorrect: 0.5, meanScore: null, band: 'medium',
    pointBiserial: 0.3127, pointBiserialN: 26, pointBiserialNote: null, flags: [],
    distribution: labelled({ answers: 26, otherVersions: 0, rows: [one([['TCP', 9], ['UDP', 13, true], ['QUIC', 3], ['SCTP', 1]])] }, {
      0: label('Thinks every application protocol runs over TCP'),
      2: label('Takes QUIC for the default because it is the newest', 'ai'),
    }),
    versions: 1,
  }, PROV.ai),
  // Phase 5 only: answers in English and Hindi, far enough apart for a warning.
  translated: {
    ...honest({
      questionId: 'f1cf7c9d4e6a8bacd3e5f7ff', text: 'A receiver advertises a 10 KB window and 4 KB is unacknowledged. How much more may the sender send now?', kind: 'mcq', bloom: 'apply',
      topic: 'Flow control', status: 'active',
      attempts: 15, correct: 10, proportionCorrect: 10 / 15, meanScore: null, band: 'medium',
      pointBiserial: 0.2618, pointBiserialN: 15, pointBiserialNote: null, flags: [],
      distribution: labelled({ answers: 15, otherVersions: 0, rows: [one([['4 KB', 2], ['6 KB', 10, true], ['10 KB', 2], ['14 KB', 1]])] }, {
        2: label('Forgets to take away the bytes still unacknowledged'),
      }),
      versions: 1,
    }),
    languages: {
      original: 'en', originalName: 'English',
      languages: [
        { language: 'en', name: 'English', answers: 10, correct: 8, share: 0.8, original: true },
        { language: 'hi', name: 'Hindi', answers: 5, correct: 2, share: 0.4, original: false },
      ],
      otherThanOriginal: 5,
      note: '5 of 15 answers were given in a language other than the question\'s own (English).',
      warning: {
        languages: ['en', 'hi'],
        higher: { language: 'en', name: 'English', answers: 10, correct: 8 },
        lower: { language: 'hi', name: 'Hindi', answers: 5, correct: 2 },
        gap: 0.4,
        text: 'Answers in Hindi were right 2 of 5 times (40%), against 8 of 10 (80%) in English: a gap of 40 points, above the 20-point threshold. Translation can change how hard a question is, so check the Hindi version before reading this as a gap in understanding.',
      },
    },
  },
};

const ITEMS = [
  ITEM.wrongKey, ITEM.wrongKeyTf,
  ITEM.labels, ITEM.few, ITEM.sameMark, ITEM.typed, ITEM.deleted, ITEM.idleCloze,
  ITEM.sort, ITEM.multi, ITEM.match, ITEM.discarded,
  ITEM.translated,
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
  translation: translation(ITEMS.filter((i) => i.languages?.warning).length),
};

const EMPTY = {
  content: { _id: '2c63ed724a3ebadade20bf24', title: 'Photosynthesis' },
  rooms: [],
  counted: { answers: 0, students: 0 },
  thresholds: THRESHOLDS,
  items: [],
  translation: translation(0),
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
            <ItemMeta item={item} />
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

/* ------------------------------------------------------- live only */

/**
 * Not sample data: a real room's /items (?room=CODE, XF5RYZ by default) drawn
 * as Live draws it, and the chapter's bank /stats (?content=ID) as the bank's
 * tab draws it.
 */
function LiveItems() {
  const q = new URLSearchParams(window.location.search);
  const code = (q.get('room') || 'XF5RYZ').toUpperCase();
  const contentId = q.get('content') || '19e67b96eeb974ed731a5ed3';
  const [room, setRoom] = useState({ data: null, error: '' });
  useEffect(() => {
    let alive = true;
    api.roomItems(code).then(
      (data) => { if (alive) setRoom({ data, error: '' }); },
      (err) => { if (alive) setRoom({ data: null, error: err.message }); },
    );
    return () => { alive = false; };
  }, [code]);
  return (
    <Frame title="Live only" sub="A real room’s questions and the chapter’s bank figures, read from the local server.">
      <div className="stack stack-3">
        <p className="t-meta">Live only: room <span className="mono">{code}</span> and chapter <span className="mono">{contentId}</span> on :5050. Use ?room=CODE and ?content=ID for others.</p>
        <section className="card it-view" aria-label={`Questions in room ${code}`}>
          <div className="it-view-head"><div className="sec"><h2>Questions in room {code}</h2><p>As the live console lists them.</p></div></div>
          {room.error && <div className="it-pad"><Note tone="bad">{room.error}</Note></div>}
          {room.data && (
            <>
              <ItemList items={room.data.items} thresholds={room.data.thresholds} translation={room.data.translation} />
              <Thresholds thresholds={room.data.thresholds} className="it-pad-x" />
            </>
          )}
        </section>
        <StatsView contentId={contentId} />
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
    note: 'The bank’s tab: 15 questions, two flagged first, one deleted, one discarded, two nobody has answered; who wrote each, one uncertain level, and one gap between languages, said above the rows.',
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
    note: 'Ticks add up to more than the answers; four answers were given to an earlier version and are left out. An AI question with no recorded approval: its level is marked uncertain, for two reasons.',
    render: () => <Specimen item={ITEM.multi} sub="A choose-all question, edited while a room was using it." />,
  },
  {
    id: 'items-labels',
    title: 'Misconception labels under the wrong options',
    role: 'professor',
    note: 'Each labelled wrong option names the misunderstanding behind it; the model’s unconfirmed label is marked AI draft. Never on the key.',
    render: () => <Specimen item={ITEM.labels} sub="A choose-one question with two labelled wrong options." />,
  },
  {
    id: 'items-translation',
    title: 'A gap between languages',
    role: 'professor',
    note: 'Fixture: answers in English and Hindi 40 points apart, so the server’s warning shows, with the count of answers in another language at the foot. Quiet while every answer is in one language.',
    render: () => <Specimen item={ITEM.translated} sub="A question answered in two languages." />,
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
    note: 'Three answers: no band and the server’s sentence on what one needs, no point-biserial. One label is an AI draft.',
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
  {
    id: 'items-live',
    title: 'Live only: a real room and its chapter on the local server',
    role: 'professor',
    note: 'Not sample data. GET /api/session/?room/items as the live console lists it, and GET /api/bank/?content/stats as the bank’s tab. Development only.',
    render: () => <LiveItems key="items-live" />,
  },
];
