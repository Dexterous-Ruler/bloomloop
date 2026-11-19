/**
 * The projector, drawn from sample data. Development only.
 *
 * The wall entries are projector:state payloads in the shapes of docs/API.md
 * ("The projector"), drawn full page by the same WallScreen the wall and the
 * console's preview use. The console entries feed the controls a projector
 * body, as GET /api/session/:code/projector answers it, for a Student-devices
 * room (the key of a bank question cannot go up) and a Teacher-led one (it
 * can). Nothing here talks to the server; the controls do nothing.
 */

import AccountShell from '../shell/AccountShell.jsx';
import { ProjectorConsole, ProjectorSkeleton } from '../teach/ProjectorControl.jsx';
import { WallNotice, WallScreen } from '../teach/Wall.jsx';

/* ------------------------------------------------------------------ sample */

const TITLE = 'Computer Networks - Unit 4: The Transport Layer';
const BASE = { code: 'J5ENVQ', title: TITLE, status: 'open', mode: 'question', question: null, diagram: null, progress: null, pick: null };

const OPTS = (...labels) => labels.map((label, i) => ({ key: 'ABCD'[i], label }));

const MCQ = {
  source: 'bank',
  text: 'Which transport protocol sets up a connection with a three-way handshake before any data is sent?',
  kind: 'mcq',
  options: OPTS('UDP', 'TCP', 'IP', 'ICMP'),
  stimulus: null,
  revealed: false,
  correct: null,
};

const PASSAGE = 'Multiplexing is the gathering of data from multiple application sockets at the sender; demultiplexing is the delivery of an arriving segment to the correct socket at the receiver, using the port numbers in the segment header. A port number is a 16-bit identifier, so ports range from 0 to 65535, with 0 to 1023 reserved as well-known ports.';

const WITH_PASSAGE = {
  source: 'bank',
  text: 'From the passage, what does the receiver use to deliver an arriving segment to the right socket?',
  kind: 'mcq',
  options: OPTS('The IP address alone', 'The port numbers in the segment header', 'The sequence number', 'The checksum'),
  stimulus: { kind: 'passage', text: PASSAGE },
  revealed: false,
  correct: null,
};

const TALLY = {
  source: 'tally',
  text: 'Which traversal of a binary search tree gives the keys in sorted order?',
  kind: 'mcq',
  options: OPTS('Inorder', 'Preorder', 'Postorder', 'Level-order'),
  stimulus: null,
  revealed: false,
  correct: null,
};

// A small labelled diagram, black lines on nothing, as an uploaded PNG often is:
// the wall sets it on white so it does not vanish into the forest.
const TREE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 300" font-family="Arial, sans-serif" font-size="20">
<g stroke="#14161A" stroke-width="2.5" fill="none">
<line x1="260" y1="50" x2="140" y2="140"/><line x1="260" y1="50" x2="380" y2="140"/>
<line x1="140" y1="140" x2="80" y2="240"/><line x1="140" y1="140" x2="200" y2="240"/>
<line x1="380" y1="140" x2="320" y2="240"/><line x1="380" y1="140" x2="440" y2="240"/>
</g>
<g fill="#FFFFFF" stroke="#14161A" stroke-width="2.5">
<circle cx="260" cy="50" r="28"/><circle cx="140" cy="140" r="28"/><circle cx="380" cy="140" r="28"/>
<circle cx="80" cy="240" r="28"/><circle cx="200" cy="240" r="28"/><circle cx="320" cy="240" r="28"/><circle cx="440" cy="240" r="28"/>
</g>
<g fill="#14161A" text-anchor="middle" dominant-baseline="central">
<text x="260" y="50">8</text><text x="140" y="140">4</text><text x="380" y="140">12</text>
<text x="80" y="240">2</text><text x="200" y="240">6</text><text x="320" y="240">10</text><text x="440" y="240">14</text>
</g></svg>`;
const TREE_URL = `data:image/svg+xml;utf8,${encodeURIComponent(TREE)}`;

const LEVELS = (counts) => ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create']
  .map((label, i) => ({ level: label.toLowerCase(), label, answers: counts[i] }));

const STATE = {
  waiting: { ...BASE, status: 'waiting' },
  open: { ...BASE },
  question: { ...BASE, question: MCQ },
  revealed: { ...BASE, question: { ...MCQ, revealed: true, correct: ['B'] } },
  passageQ: { ...BASE, question: WITH_PASSAGE },
  tally: { ...BASE, question: TALLY },
  tallyRevealed: { ...BASE, question: { ...TALLY, revealed: true, correct: ['A'] } },
  image: { ...BASE, mode: 'diagram', diagram: { stimulus: { kind: 'image', url: TREE_URL, alt: 'A binary search tree with seven nodes: 8 at the root, 4 and 12 below it, then 2, 6, 10 and 14.' } } },
  passage: { ...BASE, mode: 'diagram', diagram: { stimulus: { kind: 'passage', text: PASSAGE } } },
  held: { ...BASE, mode: 'progress', progress: { present: 4, classSize: 25, answered: 3, levels: null, minAnswered: 5 } },
  progress: { ...BASE, mode: 'progress', progress: { present: 22, classSize: 25, answered: 19, levels: LEVELS([41, 36, 22, 9, 4, 0]), minAnswered: 5 } },
  progressPhones: { ...BASE, mode: 'progress', progress: { present: 31, classSize: null, answered: 27, levels: LEVELS([58, 44, 30, 18, 7, 2]), minAnswered: 5 } },
  pickName: { ...BASE, question: TALLY, pick: { rollNo: 'SIM07', firstName: 'Asha' } },
  pickRoll: { ...BASE, question: MCQ, pick: { rollNo: 'SIM07' } },
  pickJoin: { ...BASE, pick: { rollNo: 'SIM12', firstName: 'Rohan' } },
  paused: { ...BASE, status: 'paused', question: MCQ },
};

const RULE = 'The projector shows the question (its key only once you reveal it, and a bank question\'s key only in a Teacher-led room, where no phone can still be served it), a diagram, counts for the class (per level only once 5 students have answered), and the wheel\'s pick as a roll number and first name. Never a score, accuracy, band, observation or any other name. A projector link works for 12 hours from when it is made.';
const KEY_409 = 'That key cannot go on the wall: this room\'s phones may still be served this question, and a phone that has not answered it yet would have been shown its answer. A bank question\'s key is revealed on the projector only in a Teacher-led room; nothing was changed.';

const today = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const LINKS = [
  { id: 'a1', createdAt: today(9, 2), createdBy: null, expiresAt: today(21, 2), revokedAt: null, revokedBy: null, active: true },
  { id: 'a0', createdAt: today(8, 47), createdBy: null, expiresAt: today(20, 47), revokedAt: today(9, 1), revokedBy: null, active: false },
];

const BANK = [
  { id: 'q1', bloom: 'remember', kind: 'mcq', text: MCQ.text, stimulus: null },
  { id: 'q2', bloom: 'remember', kind: 'truefalse', text: 'UDP guarantees that segments arrive in the order they were sent.', stimulus: null },
  { id: 'q3', bloom: 'remember', kind: 'mcq', text: WITH_PASSAGE.text, stimulus: { kind: 'passage', text: PASSAGE } },
  { id: 'q4', bloom: 'understand', kind: 'match', text: 'Match each transport service to what it does for an application.', stimulus: null },
  { id: 'q5', bloom: 'understand', kind: 'categorise', text: 'Sort these features into TCP, UDP or both.', stimulus: null },
  { id: 'q6', bloom: 'apply', kind: 'blank', text: 'A sender with a window of 4 segments has sent segments 10 to 13. After an ACK for 11 arrives, the next segment it may send is ____.', stimulus: null },
  { id: 'q7', bloom: 'analyse', kind: 'multi', text: 'Which of these would make a TCP sender slow down? Choose all that apply.', stimulus: { kind: 'image', url: TREE_URL, alt: 'A tree diagram' } },
  { id: 'q8', bloom: 'evaluate', kind: 'order', text: 'Put the steps of closing a TCP connection in order.', stimulus: null },
  { id: 'q9', bloom: 'create', kind: 'open', text: 'Design a simple reliable protocol over UDP for a classroom quiz app, and say what it keeps from TCP.', stimulus: { kind: 'passage', text: PASSAGE } },
];

const TALLIES = [
  { id: 't1', seq: 1, questionId: null, text: TALLY.text, correct: 'A' },
  { id: 't2', seq: 2, questionId: 'q1', text: MCQ.text, correct: 'B' },
];

const body = (shows, screen, extra = {}) => ({
  room: { code: 'J5ENVQ', title: TITLE, status: 'open' },
  modes: ['question', 'diagram', 'progress'],
  screen: { mode: shows.mode, question: null, revealed: false, diagram: null, pickId: null, showNames: true, ...screen },
  shows,
  watching: 1,
  links: LINKS,
  rule: RULE,
  ...extra,
});

/* ------------------------------------------------------------------ frames */

function Wall({ state }) {
  return <div className="wl-page wl-frame"><WallScreen state={state} /></div>;
}

function Notice({ kind, reason }) {
  return <div className="wl-page wl-frame"><WallNotice kind={kind} reason={reason} /></div>;
}

function Console({ sub, ...props }) {
  return (
    <AccountShell current="console" crumb="Live · J5ENVQ" title={TITLE} sub={sub} width="wide">
      <ProjectorConsole questions={BANK} tallies={TALLIES} canControl onPatch={() => {}} onOpen={() => {}} onRevoke={() => {}} onPicker={() => {}} onLevel={() => {}} {...props} />
    </AccountShell>
  );
}

/* ------------------------------------------------------------------ entries */

const wall = (id, title, note, state) => ({ id: `wall-${id}`, title: `Wall: ${title}`, role: null, note, render: () => <Wall state={state} /> });

export default [
  wall('waiting', 'waiting room, nothing up', 'A room that has not started: the address, the code and a QR, set large.', STATE.waiting),
  wall('open', 'open room, nothing up', 'Nothing put up yet: the way in is the screen.', STATE.open),
  wall('question', 'a question, key hidden', 'A bank question as the phones see it, with its four options.', STATE.question),
  wall('revealed', 'a question, key revealed', 'Teacher-led room: the key goes up as a mint ring and the word Correct.', STATE.revealed),
  wall('passage-question', 'a question with its passage', 'The passage sits beside the question.', STATE.passageQ),
  wall('tally', 'a question asked aloud', 'A tally question: its text and A to D. Its hands never go up.', STATE.tally),
  wall('tally-revealed', 'a question asked aloud, revealed', 'A typed-in tally: its key may go up in any room.', STATE.tallyRevealed),
  wall('image', 'a diagram', 'An uploaded picture, on white so its lines read on the forest, with its description.', STATE.image),
  wall('passage', 'a passage', 'A passage to read together.', STATE.passage),
  wall('progress-held', 'progress, before 5 have answered', 'Three have answered: the counts per level are held back, and the screen says why.', STATE.held),
  wall('progress', 'progress, per level', 'Nineteen have answered: answers at each level, for the class as a whole.', STATE.progress),
  wall('progress-phones', 'progress, room with no class', 'No roster: present is the phones that joined.', STATE.progressPhones),
  wall('pick-name', 'the pick, with a first name', 'The wheel’s draw: roll number and first name.', STATE.pickName),
  wall('pick-roll', 'the pick, roll number alone', 'Names turned off: the roll number alone.', STATE.pickRoll),
  wall('pick-join', 'the pick, nothing else up', 'A draw while the way in is on the screen.', STATE.pickJoin),
  wall('paused', 'paused', 'The room is paused: the status says so.', STATE.paused),
  { id: 'wall-closed', title: 'Wall: link turned off', role: null, note: 'projector:closed: the wall stops and shows the reason.', render: () => <Notice kind="closed" reason="This projector link was turned off." /> },
  { id: 'wall-refused', title: 'Wall: link refused', role: null, note: 'projector:refused: the server’s one sentence for every link that does not work.', render: () => <Notice kind="refused" reason="That projector link does not work: it may have been turned off. Ask your professor for a new one." /> },
  { id: 'wall-nolink', title: 'Wall: opened with no link', role: null, note: '/wall with nothing after the #.', render: () => <Notice kind="nolink" /> },
  { id: 'wall-connecting', title: 'Wall: connecting', role: null, note: 'Before the first projector:state arrives.', render: () => <Notice kind="connecting" /> },

  {
    id: 'beam-devices',
    title: 'Controls: Student devices room',
    role: 'professor',
    note: 'A bank question is up. Reveal is off: its key could still reach a phone.',
    render: () => <Console roomMode="devices" sub="Student devices room." body={body(STATE.question, { question: { source: 'bank', id: 'q1' } })} />,
  },
  {
    id: 'beam-devices-409',
    title: 'Controls: a refused reveal',
    role: 'professor',
    note: 'A tally asked from the bank, revealed in a devices room: the 409 sentence as the server gave it.',
    render: () => <Console roomMode="devices" picker="tally" error={KEY_409} body={body({ ...STATE.tally, question: { ...TALLY, text: MCQ.text, options: MCQ.options } }, { question: { source: 'tally', id: 't2' } })} />,
  },
  {
    id: 'beam-teacher-led',
    title: 'Controls: Teacher-led room',
    role: 'professor',
    note: 'The key is up and a pick with a first name; two projectors watching.',
    render: () => <Console roomMode="teacher-led" sub="Teacher-led room." body={body({ ...STATE.revealed, pick: { rollNo: 'SIM07', firstName: 'Asha' } }, { question: { source: 'bank', id: 'q1' }, revealed: true, pickId: 'p1' }, { watching: 2 })} />,
  },
  {
    id: 'beam-diagram',
    title: 'Controls: a passage up',
    role: 'professor',
    note: 'The diagram screen lists the questions that carry a picture or a passage.',
    render: () => <Console roomMode="teacher-led" body={body(STATE.passage, { diagram: { questionId: 'q3' } })} />,
  },
  {
    id: 'beam-progress',
    title: 'Controls: progress, held back',
    role: 'professor',
    note: 'Progress before 5 have answered, names off, no projector watching.',
    render: () => <Console roomMode="mixed" body={body({ ...STATE.held, pick: { rollNo: 'SIM12' } }, { pickId: 'p2', showNames: false }, { watching: 0, links: [] })} />,
  },
  {
    id: 'beam-readonly',
    title: 'Controls: read only',
    role: 'hod',
    note: 'A head of department: the preview and the links, and no controls.',
    render: () => <Console roomMode="devices" canControl={false} body={body(STATE.question, { question: { source: 'bank', id: 'q1' } })} />,
  },
  {
    id: 'beam-loading',
    title: 'Controls: first read',
    role: 'professor',
    note: 'The read has not answered yet.',
    render: () => (
      <AccountShell current="console" crumb="Live · J5ENVQ" title={TITLE} width="wide">
        <ProjectorSkeleton />
      </AccountShell>
    ),
  },
];

