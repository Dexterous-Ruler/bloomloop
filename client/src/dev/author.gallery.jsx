/**
 * The question editor and the answer key, drawn from sample data. Development only.
 *
 * The editor takes its server calls as `services`, so each entry hands it a
 * small stand-in that answers the way /api/bank and /api/media do (docs/API.md,
 * Phase 2): an edit keeps the status, an approval names the failed checks, a
 * plain rewrite of a question in use warns, Harder and Easier write a draft one
 * level over, and an upload is refused with the server's 400, 413 and 415
 * sentences. What the bank would be told afterwards appears on the page behind
 * the sheet. Nothing here talks to the server.
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
const base = (over) => ({
  status: 'active', source: 'fallback', model: 'offline-template', sourceRef: null,
  createdBy: null, approvedBy: null, approvedAt: STAMP, createdAt: STAMP, contentId: CONTENT_ID, ...over,
});

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

const OWN = base({
  _id: 'g-own', source: 'fallback', model: null, topic: 'Congestion control', bloom: 'create', kind: 'open',
  text: 'Design a congestion control rule for a link that drops one packet in a hundred for reasons unrelated to congestion. Justify it.',
  rubric: ['treat loss without delay as noise', 'react to rising delay', 'justify with throughput'],
  checks: [
    ok('empty-rubric', 'Every rubric point has words a written answer can be matched on.'),
    ok('slide-only-reference', 'It can be answered without seeing the slide.'),
    ok('create-selected-response', 'The student writes the answer, so any level can be asked.'),
  ],
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

function standIn(question, { harder502 = false } = {}) {
  let q = question;
  return {
    async editQuestion(id, patch) {
      await wait(450);
      if (!String(patch.text ?? '').trim()) throw fail('missing text', 400);
      q = { ...q, ...patch };
      return { question: q };
    },
    async approveQuestion() {
      await wait(350);
      q = { ...q, status: 'active', approvedAt: new Date().toISOString() };
      return { question: q, changed: true, failedChecks: failedOf(q) };
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
      const warnings = q.status === 'active'
        ? ['The question this replaces was in use, so it has left rooms now. Its replacement is a draft, and joins them when you approve it.']
        : [];
      return { question: { ...q, _id: 'g-rewrite', status: 'draft' }, ...(warnings.length ? { warnings } : {}) };
    },
    async splitQuestion(id) {
      await wait(450);
      return { questions: [{ ...q, _id: 'g-a' }, { ...q, _id: 'g-b' }], discarded: id };
    },
    async discardQuestion() { await wait(350); q = { ...q, status: 'discarded' }; return { question: q }; },
    async restoreQuestion() { await wait(350); q = { ...q, status: 'active' }; return { question: q }; },
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
function Stage({ question, title, line, options }) {
  const [round, setRound] = useState(0);
  const [open, setOpen] = useState(true);
  const [told, setTold] = useState(null);
  const [services, setServices] = useState(() => standIn(question, options));

  const again = () => {
    setServices(standIn(question, options));
    setTold(null);
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
          ? <Note tone={told.tone}><b>onDone</b> {told.note ?? 'was called with no sentence.'}</Note>
          : <p className="t-meta">The sentence the bank would show after an action appears here.</p>}
        {!open && <div><Button icon="edit" onClick={again}>Open the editor again</Button></div>}
      </div>
      {open && (
        <Editor
          key={round}
          question={question}
          contentId={CONTENT_ID}
          kinds={KINDS}
          services={services}
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
    note: 'No source label, and Harder is not on offer at the top of the ladder.',
    render: () => <Stage question={OWN} title="Your own question at Create" line="A question a professor wrote has no model, so no source is named. Create is the top level, so Harder says why it is off." />,
  },
  {
    id: 'author-keys',
    title: 'Authoring: answer keys',
    role: 'professor',
    note: 'Pick the words, a choice per gap, the table and the grid, then a passage and an image.',
    render: () => <Keys />,
  },
];
