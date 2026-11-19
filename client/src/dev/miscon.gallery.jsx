/**
 * Misconception reports, drawn from sample data. Development only.
 *
 * One room of 24 phones on Computer Networks, Unit 4, and the same four
 * labelled questions across three rooms of the class CS-A. The bodies have
 * the shape of docs/API.md "Phase 5: misconception labels on wrong options"
 * ("The reports"), worded as services/misconceptions.js words them, and their
 * figures agree: `counted` adds up the questions, `top` is the five options
 * most students chose (most first), and each option's sentence and note
 * follow from its counts. Two labels are the model's drafts.
 *
 * Two entries, marked "Live only", are not sample data: they read a real room
 * (`?room=CODE`, XF5RYZ by default) and a real class (`?class=ID`) on the
 * local server.
 */

import { useState } from 'react';

import AccountShell from '../shell/AccountShell.jsx';
import { ClassMisconceptions, MisconceptionsView, RoomMisconceptions } from '../teach/Misconceptions.jsx';
import { Button } from '../ui/index.jsx';

/* ------------------------------------------------------------------ sample */

const METHOD = 'Each student\'s counted answer to a question in a room is their final answer to it '
  + '(an attempt they retried is not counted, and nor are a class question\'s votes). A student who chose a labelled '
  + 'option is counted under that option\'s label as it stands now, matched by the option\'s words in the question as '
  + 'the student saw it, so reordering options changes nothing and an option reworded since is not counted. A choose-all '
  + 'question counts every labelled option a student ticked. An AI draft label is counted, and marked as a draft until '
  + 'the professor confirms it.';
const PRIVACY = 'Misconception labels and these counts are for staff only: never shown on a phone '
  + 'or the projector. They count students and never name them, and they change no mark, level or attainment figure.';

const MODEL = 'gemini-2.5-flash';
const PROV = {
  ai: {
    source: 'ai', sourceLabel: 'AI-generated', model: MODEL, approval: 'approved', approvedAt: '2026-11-11T08:42:00.000Z', approvedBy: null, aiDraft: false,
    label: 'AI-generated, approved', sentence: `Written by the language model (${MODEL}) from the professor's material. Approved by a professor.`,
  },
  aiUnrecorded: {
    source: 'ai', sourceLabel: 'AI-generated', model: MODEL, approval: 'unrecorded', approvedAt: null, approvedBy: null, aiDraft: false,
    label: 'AI-generated, approval not recorded', sentence: `Written by the language model (${MODEL}) from the professor's material. In use since before approvals were recorded.`,
  },
  template: {
    source: 'template', sourceLabel: 'Offline template', model: 'offline-template', approval: 'approved', approvedAt: '2026-11-11T08:40:00.000Z', approvedBy: null, aiDraft: false,
    label: 'Offline template, approved', sentence: "Made by the offline template from the professor's material, without a language model. Approved by a professor.",
  },
  professor: {
    source: 'professor', sourceLabel: 'Professor-written', model: null, approval: 'written', approvedAt: null, approvedBy: null, aiDraft: false,
    label: 'Professor-written', sentence: 'Written by a professor. In use since a professor wrote it.',
  },
};

const ADDED = '2026-11-12T09:30:00.000Z';
const REWORDED = '2026-11-14T11:05:00.000Z';
const who = (n) => (n === 0 ? 'No student' : n === 1 ? '1 student' : `${n} students`);
const sentenceFor = (n, label, provenance) =>
  `${who(n)} chose the option linked to the misunderstanding "${label}"${provenance === 'ai' ? ' (an AI draft label, not yet confirmed by the professor)' : ''}.`;
const noteFor = ({ answers, beforeLabel, beforeChange }) => {
  const parts = [];
  if (beforeLabel && beforeLabel === answers) parts.push('Label added after these answers.');
  else if (beforeLabel) parts.push(`Label added after ${beforeLabel} of these ${answers} answers.`);
  if (beforeChange) parts.push(`Label reworded after ${beforeChange} of these answers.`);
  return parts.length ? parts.join(' ') : null;
};

/** One labelled option with its counts: [optionIdx, option, label, provenance, students, answers?, beforeLabel?, beforeChange?]. */
function opt([optionIdx, option, label, provenance, students, answers = students, beforeLabel = 0, beforeChange = 0]) {
  return {
    optionIdx, option, label, provenance,
    provenanceLabel: provenance === 'ai' ? 'AI draft' : "Professor's label",
    confirmed: provenance === 'professor',
    addedAt: ADDED, changedAt: beforeChange ? REWORDED : ADDED,
    students, answers, beforeLabel, beforeChange,
    sentence: sentenceFor(students, label, provenance),
    note: noteFor({ answers, beforeLabel, beforeChange }),
  };
}

const Q = {
  dns: {
    questionId: 'e0be6b8c3d5f7a9bc2d4e6ee', text: 'Which transport protocol does a DNS query use by default?',
    kind: 'mcq', kindLabel: 'Choose one', bloom: 'remember', topic: 'Application protocols', status: 'active', provenance: PROV.ai,
  },
  handshake: {
    questionId: '4c1a6d8e3f5b7c9a1e2d4f44', text: 'UDP sends data without a handshake first.',
    kind: 'truefalse', kindLabel: 'True or false', bloom: 'remember', topic: 'User Datagram Protocol', status: 'active', provenance: PROV.template,
  },
  provides: {
    questionId: '8a5e0b2c7d9f1a3e5c6b8d88', text: 'Which of these does TCP provide? Choose all that apply.',
    kind: 'multi', kindLabel: 'Choose all that apply', bloom: 'understand', topic: 'Transmission Control Protocol', status: 'active', provenance: PROV.aiUnrecorded,
  },
  window: {
    questionId: 'f1cf7c9d4e6a8bacd3e5f7ff', text: 'A receiver advertises a 10 KB window and 4 KB is unacknowledged. How much more may the sender send now?',
    kind: 'mcq', kindLabel: 'Choose one', bloom: 'apply', topic: 'Flow control', status: 'active', provenance: PROV.professor,
  },
};
const LABEL = {
  tcpAll: 'Thinks every application protocol runs over TCP',
  quicNew: 'Takes QUIC for the default because it is the newest',
  udpHandshake: 'Thinks UDP opens a connection first, as TCP does',
  boundaries: 'Thinks TCP keeps the sender’s message boundaries',
  onTime: 'Takes reliable delivery to mean delivery on time',
  inFlight: 'Sends only what is already in flight',
  noSubtract: 'Forgets to take away the bytes still unacknowledged',
  added: 'Adds the unacknowledged bytes to the window instead of taking them away',
};
const otherWordingNote = (n) => `${n === 1 ? '1 of these answers was' : `${n} of these answers were`} given to an earlier wording `
  + 'of the options. Each is counted under the label of the option whose words it chose; an option reworded since '
  + 'is not counted.';

/** A question with its counts; `n` = [answers, students, otherWording]. */
const question = (q, [answers, students, otherWording = 0], options) => ({
  ...q, answers, students, otherWording, ...(otherWording ? { otherWordingNote: otherWordingNote(otherWording) } : {}),
  options: options.map(opt),
});

/** The report's summary from its questions, as the server builds it. */
function report(questions, extra) {
  const options = questions.flatMap((q) => q.options.map((o) => ({ q, o })));
  const top = options.filter(({ o }) => o.students > 0)
    .sort((x, y) => y.o.students - x.o.students)
    .slice(0, 5)
    .map(({ q, o }) => ({
      questionId: q.questionId, text: q.text, optionIdx: o.optionIdx, option: o.option, label: o.label,
      provenance: o.provenance, students: o.students, sentence: o.sentence,
    }));
  return {
    ...extra,
    counted: {
      questions: questions.length, labels: options.length,
      aiDrafts: options.filter(({ o }) => o.provenance === 'ai').length,
      answers: questions.reduce((n, q) => n + q.answers, 0),
    },
    questions, top, method: METHOD, privacy: PRIVACY,
  };
}

const ROOM = { code: 'QN4R7K', title: 'Computer Networks - Unit 4: The Transport Layer', status: 'open', startedAt: '2026-11-19T04:10:00.000Z' };

const ROOM_REPORT = report([
  question(Q.dns, [24, 24], [[0, 'TCP', LABEL.tcpAll, 'professor', 8], [2, 'QUIC', LABEL.quicNew, 'ai', 3]]),
  question(Q.handshake, [24, 24], [[1, 'False', LABEL.udpHandshake, 'professor', 5, 5, 5]]),
  question(Q.provides, [22, 22, 3], [[3, 'Message boundaries', LABEL.boundaries, 'professor', 9, 9, 4], [4, 'A guaranteed delay', LABEL.onTime, 'ai', 2]]),
  question(Q.window, [18, 18], [[0, '4 KB', LABEL.inFlight, 'professor', 6, 6, 0, 2], [2, '10 KB', LABEL.noSubtract, 'professor', 4], [3, '14 KB', LABEL.added, 'professor', 0]]),
], { room: ROOM });

// The class: three rooms, a student pooled across them, so an option can
// carry more answers than students.
const CLASS = { id: 'c0ffee0000000000000000c1', courseName: 'Computer Networks', section: 'CS-A', termLabel: 'Odd term 2026' };
const CLASS_ROOMS = [
  { code: 'TRN4KX', title: 'Unit 4: The Transport Layer', status: 'closed', startedAt: '2026-11-12T04:05:00.000Z' },
  { code: 'ZQ4UQ6', title: 'Unit 4: The Transport Layer, revision', status: 'closed', startedAt: '2026-11-14T04:10:00.000Z' },
  { code: 'QN4R7K', title: 'Computer Networks - Unit 4: The Transport Layer', status: 'open', startedAt: '2026-11-19T04:10:00.000Z' },
];
const CLASS_REPORT = report([
  question(Q.dns, [61, 25], [[0, 'TCP', LABEL.tcpAll, 'professor', 14, 17], [2, 'QUIC', LABEL.quicNew, 'ai', 5]]),
  question(Q.handshake, [58, 25], [[1, 'False', LABEL.udpHandshake, 'professor', 9, 10, 10]]),
  question(Q.provides, [50, 24, 3], [[3, 'Message boundaries', LABEL.boundaries, 'professor', 15, 18, 4], [4, 'A guaranteed delay', LABEL.onTime, 'ai', 3]]),
  question(Q.window, [40, 22], [[0, '4 KB', LABEL.inFlight, 'professor', 10, 11, 0, 2], [2, '10 KB', LABEL.noSubtract, 'professor', 7], [3, '14 KB', LABEL.added, 'professor', 1]]),
], { class: CLASS, window: { from: null, to: null, rooms: null }, rooms: CLASS_ROOMS });

// The room's set holds labelled questions nobody has reached yet.
const UNANSWERED = report([
  question(Q.dns, [0, 0], [[0, 'TCP', LABEL.tcpAll, 'professor', 0], [2, 'QUIC', LABEL.quicNew, 'ai', 0]]),
  question(Q.window, [0, 0], [[0, '4 KB', LABEL.inFlight, 'professor', 0], [2, '10 KB', LABEL.noSubtract, 'professor', 0]]),
], { room: { ...ROOM, code: 'HV7P2M', startedAt: '2026-11-19T05:00:00.000Z' } });

const EMPTY_ROOM = report([], { room: { ...ROOM, code: 'K2D9WT' } });
const EMPTY_CLASS = report([], { class: CLASS, window: { from: '2026-11-15', to: '2026-11-16', rooms: null }, rooms: [] });

/* ------------------------------------------------------------------ frames */

function RoomFrame({ code = ROOM.code, children }) {
  return (
    <AccountShell
      current="console"
      crumb={<span className="clip">Live · <span className="mono">{code}</span> · Computer Networks CS-A</span>}
      title="Unit 4: The Transport Layer"
      sub="The room’s console, where the integrator mounts the report beside the room’s questions."
      width="wide"
    >
      {children}
    </AccountShell>
  );
}

function ClassFrame({ children }) {
  return (
    <AccountShell
      current="classes"
      crumb={<span>Classes <span aria-hidden="true">/</span> {CLASS.section}</span>}
      title={CLASS.courseName}
      sub={`${CLASS.section} · ${CLASS.termLabel} · 25 students on the roster`}
    >
      {children}
    </AccountShell>
  );
}

/** A stand-in for ReportWindow (which reads the class's rooms from the server). */
function WindowStandIn({ from = '', to = '' }) {
  const [v, setV] = useState({ from, to });
  return (
    <div className="rwin" role="group" aria-label="Rooms this report reads">
      <label className="rwin-f"><span>From</span><input type="date" className="input input-sm" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></label>
      <label className="rwin-f"><span>To</span><input type="date" className="input input-sm" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></label>
      <Button size="sm" icon="rooms">Every room in these dates</Button>
    </div>
  );
}

/** Read again answers after a moment, as the server would. */
function Sample({ data, error = '', frame = 'room', filter }) {
  const [loading, setLoading] = useState(false);
  const retry = () => { setLoading(true); setTimeout(() => setLoading(false), 700); };
  const view = <MisconceptionsView data={data} loading={loading} error={error} onRetry={retry} filter={filter} />;
  return frame === 'class' ? <ClassFrame>{view}</ClassFrame> : <RoomFrame code={data?.room?.code}>{view}</RoomFrame>;
}

/* ------------------------------------------------------- live only */

function LiveRoom() {
  const code = (new URLSearchParams(window.location.search).get('room') || 'XF5RYZ').toUpperCase();
  return (
    <RoomFrame code={code}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="t-meta">Live only: room <span className="mono">{code}</span> on the local server. Use ?room=CODE for another.</p>
        <RoomMisconceptions code={code} />
      </div>
    </RoomFrame>
  );
}

function LiveClass() {
  const id = new URLSearchParams(window.location.search).get('class') || '4dc36ec8aa92e15211c668dd';
  return (
    <ClassFrame>
      <div className="stack" style={{ gap: 12 }}>
        <p className="t-meta">Live only: class <span className="mono">{id}</span> on the local server. Use ?class=ID for another.</p>
        <ClassMisconceptions classId={id} />
      </div>
    </ClassFrame>
  );
}

/* ------------------------------------------------------------ entries */

export default [
  {
    id: 'miscon-room',
    title: 'A room: four labelled questions',
    role: 'professor',
    note: 'The five misunderstandings most students chose, then each question’s labelled options with the server’s sentence and note. Two labels are AI drafts; one option nobody chose.',
    render: () => <Sample key="miscon-room" data={ROOM_REPORT} />,
  },
  {
    id: 'miscon-class',
    title: 'A class across three rooms',
    role: 'professor',
    note: 'Students pooled across the rooms, so an option can carry more answers than students. The dates and rooms filter sits on top, as on the attainment tab.',
    render: () => <Sample key="miscon-class" data={CLASS_REPORT} frame="class" filter={<WindowStandIn />} />,
  },
  {
    id: 'miscon-unanswered',
    title: 'Labelled questions nobody has answered',
    role: 'professor',
    note: 'The room’s set holds two labelled questions and no phone has reached them yet: every count is 0, nothing is most chosen.',
    render: () => <Sample key="miscon-unanswered" data={UNANSWERED} />,
  },
  {
    id: 'miscon-empty-room',
    title: 'No labelled question answered: a room',
    role: 'professor',
    note: 'Says plainly that no labelled question was answered, and where labels are added.',
    render: () => <Sample key="miscon-empty-room" data={EMPTY_ROOM} />,
  },
  {
    id: 'miscon-empty-class',
    title: 'No labelled question answered: a class, narrowed to two days',
    role: 'professor',
    note: 'The filter stays, so the dates can be widened again.',
    render: () => <Sample key="miscon-empty-class" data={EMPTY_CLASS} frame="class" filter={<WindowStandIn from="2026-11-15" to="2026-11-16" />} />,
  },
  {
    id: 'miscon-loading',
    title: 'First read',
    role: 'professor',
    note: 'The read has not answered, so the shaped skeleton stays.',
    render: () => <RoomFrame><MisconceptionsView data={null} loading /></RoomFrame>,
  },
  {
    id: 'miscon-error',
    title: 'The first read fails',
    role: 'professor',
    note: 'The server’s sentence as it came, with Try again.',
    render: () => <RoomFrame><MisconceptionsView data={null} error="That room was not found." onRetry={() => {}} /></RoomFrame>,
  },
  {
    id: 'miscon-stale',
    title: 'A read again fails',
    role: 'professor',
    note: 'The figures from the earlier read stay on screen, and a line says so.',
    render: () => <Sample key="miscon-stale" data={ROOM_REPORT} error="Failed to fetch" />,
  },
  {
    id: 'miscon-live-room',
    title: 'Live only: a real room on the local server',
    role: 'professor',
    note: 'Not sample data. RoomMisconceptions reads ?room=CODE (default XF5RYZ) on :5050. Development only.',
    render: () => <LiveRoom key="miscon-live-room" />,
  },
  {
    id: 'miscon-live-class',
    title: 'Live only: a real class on the local server',
    role: 'professor',
    note: 'Not sample data. ClassMisconceptions reads ?class=ID (default the seeded CS-A) on :5050, with the real ReportWindow. Development only.',
    render: () => <LiveClass key="miscon-live-class" />,
  },
];
