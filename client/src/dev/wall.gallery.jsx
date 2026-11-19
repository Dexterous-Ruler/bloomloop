/**
 * The projector, drawn from sample data. Development only.
 *
 * The wall entries are projector:state payloads in the shapes of docs/API.md
 * ("The projector"), drawn full page by the same WallScreen the wall and the
 * console's preview use. The console entries feed the controls a projector
 * body, as GET /api/session/:code/projector answers it, for a Student-devices
 * room (the key of a bank question cannot go up) and a Teacher-led one (it
 * can). Nothing here talks to the server; the controls do nothing.
 *
 * Phase 5: a class question on the wall (question.source 'class', docs/API.md
 * "What the projector shows") through open, pause, re-vote and close, with
 * counts off, held and up; a Teacher-led room's wall, which has no code.
 *
 * Batch 8: figures the b8-vis server drew (dev/samples-b8-figures.js), on the
 * wall at a step and on the console with Back, Next and Start over.
 */

import AccountShell from '../shell/AccountShell.jsx';
import { ProjectorConsole, ProjectorSkeleton } from '../teach/ProjectorControl.jsx';
import { WallNotice, WallScreen } from '../teach/Wall.jsx';
import { projectorFigure, STAFF, studentFigure } from './samples-b8-figures.js';

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

// A question put to the whole class (source 'class'), in its four states.
const CQ = {
  source: 'class',
  text: 'A video call drops a frame now and then but never stops to wait. Which transport protocol is it most likely using?',
  kind: 'mcq',
  options: OPTS('TCP', 'UDP', 'Either: the application chooses', 'Neither: IP carries it directly'),
  stimulus: null,
  revealed: false,
  correct: null,
  round: 1,
  state: 'open',
  voted: 0,
  counts: null,
};
const VOTES = (...n) => n.map((votes, i) => ({ key: 'ABCD'[i], votes }));
const BEFORE = { voted: 23, options: VOTES(9, 10, 3, 1), correct: null, confidence: { sure: 8, think_so: 9, guessing: 5, none: 1 } };
const AFTER = { voted: 24, options: VOTES(4, 18, 2, 0), correct: null, confidence: { sure: 13, think_so: 8, guessing: 2, none: 1 } };
const CHANGES = { both: 22, onlyBefore: 1, onlyAfter: 2, wrongToRight: 9, rightToWrong: 1, rightToRight: 8, wrongToSameWrong: 3, wrongToOtherWrong: 1 };
const counts = (before, after = null, changes = null) => ({ minVotes: 5, before, after, changes });

const CQ_STATE = {
  open: { ...CQ, voted: 14 },
  openCounts: { ...CQ, voted: 14, counts: counts(null) },
  paused: { ...CQ, state: 'paused', voted: 23, counts: counts(BEFORE) },
  pausedFew: { ...CQ, state: 'paused', voted: 4, counts: counts(null) },
  revote: { ...CQ, state: 'revote', round: 2, voted: 17, counts: counts(BEFORE) },
  closedHidden: { ...CQ, state: 'closed', round: 2, voted: 24, counts: counts(BEFORE, AFTER) },
  revealed: {
    ...CQ, state: 'closed', round: 2, voted: 24, revealed: true, correct: ['B'],
    counts: counts({ ...BEFORE, correct: { students: 10, share: 0.4347 } }, { ...AFTER, correct: { students: 18, share: 0.75 } }, CHANGES),
  },
  revealedOff: { ...CQ, state: 'closed', round: 1, voted: 23, revealed: true, correct: ['B'], counts: null },
  poll: {
    ...CQ,
    kind: 'poll',
    text: 'For next week’s lab, which would help you more?',
    options: OPTS('Building the network in a packet tracer', 'Reading live captures in Wireshark', 'Both, half the time each'),
    state: 'closed',
    round: 2,
    voted: 21,
    counts: counts(
      { voted: 22, options: VOTES(11, 6, 5), correct: null, confidence: { sure: 10, think_so: 7, guessing: 3, none: 2 } },
      { voted: 21, options: VOTES(8, 5, 8), correct: null, confidence: { sure: 12, think_so: 6, guessing: 1, none: 2 } },
      { both: 20, onlyBefore: 2, onlyAfter: 1, kept: 15, changed: 5 },
    ),
  },
  // The worst case for space: a passage, four long options, both rounds and the changes.
  passage: {
    ...CQ,
    text: WITH_PASSAGE.text,
    options: OPTS('The IP address of the sending host, with nothing else from the header', 'The port numbers in the segment header, read at the receiving host', 'The sequence number, which says where the segment sits in the stream', 'The checksum, which the receiver uses to find the socket and check the data'),
    stimulus: { kind: 'passage', text: PASSAGE },
    state: 'closed', round: 2, voted: 24, revealed: true, correct: ['B'],
    counts: counts({ ...BEFORE, correct: { students: 10, share: 0.4347 } }, { ...AFTER, correct: { students: 18, share: 0.75 } }, CHANGES),
  },
  truefalse: {
    ...CQ,
    kind: 'truefalse',
    text: 'UDP guarantees that segments arrive in the order they were sent.',
    options: OPTS('True', 'False'),
    state: 'revote',
    round: 2,
    voted: 6,
    counts: counts({ voted: 19, options: VOTES(7, 12), correct: null, confidence: { sure: 6, think_so: 8, guessing: 4, none: 1 } }),
  },
};

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
  ledIdle: { ...BASE, roomMode: 'teacher-led' },
  ledQuestion: { ...BASE, roomMode: 'teacher-led', question: MCQ },
  ledPick: { ...BASE, roomMode: 'teacher-led', pick: { rollNo: 'SIM12', firstName: 'Rohan' } },
  cqPick: { ...BASE, roomMode: 'devices', question: CQ_STATE.revealed, pick: { rollNo: 'SIM07', firstName: 'Asha' } },
};

const ON = (q) => ({ ...BASE, roomMode: 'devices', question: q });

/* Batch 8: figures, as projector:state carries them (figureAtStep). */
const FIG_Q = (name, step, text) => ({ ...MCQ, text, options: OPTS('Where the line crosses the y-axis', 'Where the two graphs meet', 'Where the parabola turns', 'Where the step graph jumps'), stimulus: projectorFigure(name, step) });
const PLOT_TEXT = 'At which points do the line y = 2x + 1 and the parabola y = x² − 4 meet?';
const STACK_TEXT = 'How many calls to fact are waiting when fact(1) returns?';
const FIG = {
  question: { ...BASE, question: FIG_Q('plot', 0, PLOT_TEXT) },
  questionStep: { ...BASE, question: { ...FIG_Q('stack', 2, STACK_TEXT), options: OPTS('One', 'Two', 'Three', 'None') } },
  diagram: { ...BASE, mode: 'diagram', diagram: { stimulus: projectorFigure('plot', 0) } },
  diagramStep: { ...BASE, mode: 'diagram', diagram: { stimulus: projectorFigure('diagram', 1) } },
  diagramLast: { ...BASE, mode: 'diagram', diagram: { stimulus: projectorFigure('plot', 2) } },
  // A class question carries a figure with no steps (stimulusView).
  cq: ON({ ...CQ_STATE.paused, text: 'Which month had the most rain?', options: OPTS('June', 'July', 'August', 'They were the same'), stimulus: studentFigure('bar') }),
};

const RULE = 'The projector shows the question (its key only once you reveal it, and a bank question\'s key only in a Teacher-led room, where no phone can still be served it), a diagram, counts for the class (per level only once 5 students have answered), and the wheel\'s pick as a roll number and first name. Never a score, accuracy, band, observation or any other name. A projector link works for 12 hours from when it is made. A class question shows how many have voted; its votes per option and confidence taps only when you choose to show counts, once a round has closed and 5 or more voted in it; and its key, share right and changes only once you reveal the key as it closes.';
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

// Batch 8: the bank's figure questions (GET /api/bank/:contentId gives each its figure).
const FIG_BANK = [
  ...BANK,
  { id: 'f1', bloom: 'remember', kind: 'mcq', text: PLOT_TEXT, stimulus: { kind: 'figure', spec: { type: 'plot', n: 1 } }, figure: STAFF.plot },
  { id: 'f2', bloom: 'remember', kind: 'mcq', text: 'Which box does the program reach when n is 0?', stimulus: { kind: 'figure', spec: { type: 'diagram', n: 2 } }, figure: STAFF.diagram },
  { id: 'f3', bloom: 'understand', kind: 'match', text: STACK_TEXT, stimulus: { kind: 'figure', spec: { type: 'stack', n: 3 } }, figure: STAFF.stack },
];
const STEP_400 = 'This figure has 2 steps: choose one from 0 (the figure itself) to 2.';

// The room's class questions as GET …/class-questions lists them (staff body, trimmed).
const CLASS_QS = [
  { id: 'cq1', seq: 1, state: 'closed', round: 2, revealed: true, question: { text: 'Which layer routes packets between networks?', kind: 'mcq', level: 'remember' } },
  { id: 'cq2', seq: 2, state: 'paused', round: 1, revealed: false, question: { text: CQ.text, kind: 'mcq', level: 'understand' } },
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
      <ProjectorConsole questions={BANK} tallies={TALLIES} classQs={CLASS_QS} canControl onPatch={() => {}} onOpen={() => {}} onRevoke={() => {}} onPicker={() => {}} onLevel={() => {}} {...props} />
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
  wall('led-idle', 'Teacher-led room, nothing up', 'No phone joins a Teacher-led room: the wall shows its title, never a code or a QR.', STATE.ledIdle),
  wall('led-question', 'Teacher-led room, a question', 'Something up: the bar carries no join code.', STATE.ledQuestion),
  wall('led-pick', 'Teacher-led room, a pick', 'A draw with nothing else up: still no code.', STATE.ledPick),
  wall('cq-open', 'class question, first vote, counts off', 'Round 1 open, showCounts off: how many have voted, and why there are no counts.', ON(CQ_STATE.open)),
  wall('cq-open-counts', 'class question, first vote, counts on', 'Counts on, but the round is still open: the wall says they come when it closes.', ON(CQ_STATE.openCounts)),
  wall('cq-paused', 'class question, paused, counts up', '23 voted and the vote is paused: votes per option and the taps, no key, no share right.', ON(CQ_STATE.paused)),
  wall('cq-paused-few', 'class question, paused, too few', 'Four voted: the counts stay off and the wall says why.', ON(CQ_STATE.pausedFew)),
  wall('cq-revote', 'class question, second vote open', 'The first vote’s counts stay up; the second vote’s wait for it to close.', ON(CQ_STATE.revote)),
  wall('cq-closed', 'class question, closed without the key', 'Before and after, side by side. No key, no share right, no changes.', ON(CQ_STATE.closedHidden)),
  wall('cq-revealed', 'class question, closed with the key', 'Revealed: the key, the share right before and after, and who changed their answer.', ON(CQ_STATE.revealed)),
  wall('cq-revealed-off', 'class question, key revealed, counts off', 'Closed after one vote with the key revealed and counts off: the key alone.', ON(CQ_STATE.revealedOff)),
  wall('cq-poll', 'class question, a poll, closed', 'A poll has no key: its changes are kept and changed, shown once the second vote closed.', ON(CQ_STATE.poll)),
  wall('cq-passage', 'class question with a passage, everything up', 'The fullest screen: a passage, long options, both rounds and the changes. The type steps down until it fits the frame.', ON(CQ_STATE.passage)),
  wall('cq-truefalse', 'class question, true or false, second vote', 'Two options, A True and B False.', ON(CQ_STATE.truefalse)),
  wall('cq-pick', 'class question beside a pick', 'The wheel’s pick takes a column: the side and the bars give way.', STATE.cqPick),
  wall('fig-question', 'a question with a figure', 'Batch 8: a bank question whose stimulus is a figure, drawn by the server, on its own light card beside the question.', FIG.question),
  wall('fig-question-step', 'a question with a stepped figure, step 2 of 3', 'The professor moved the figure on: the drawing at step 2, with “Step 2 of 3” and the step’s caption under it.', FIG.questionStep),
  wall('fig-diagram', 'a figure on the diagram screen', 'A figure put up on its own, at the figure itself (step 0): no step line yet.', FIG.diagram),
  wall('fig-diagram-step', 'a figure on the diagram screen, step 1 of 2', 'A flowchart at step 1: the step’s part lit, its caption and “Step 1 of 2”.', FIG.diagramStep),
  wall('fig-diagram-last', 'a figure on the diagram screen, last step', 'The plot at its last step.', FIG.diagramLast),
  wall('fig-cq', 'class question with a figure', 'A class question carries its figure with no steps; counts up after the pause.', FIG.cq),
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
    id: 'beam-class',
    title: 'Controls: a class question up',
    role: 'professor',
    note: 'Paused, counts on: what the wall shows of it, the counts switch, and where the key comes from instead of a reveal button.',
    render: () => <Console roomMode="devices" picker="class" body={body(ON(CQ_STATE.paused), { question: { source: 'class', id: 'cq2' }, showCounts: true })} />,
  },
  {
    id: 'beam-class-off',
    title: 'Controls: a class question, counts off',
    role: 'professor',
    note: 'The default: showCounts off. The wall shows how many voted, and says counts are off.',
    render: () => <Console roomMode="devices" picker="class" body={body(ON(CQ_STATE.open), { question: { source: 'class', id: 'cq2' } })} />,
  },
  {
    id: 'beam-class-revealed',
    title: 'Controls: a class question closed with its key',
    role: 'professor',
    note: 'Closed with the key revealed on the Class question space: key, share right and changes are up.',
    render: () => <Console roomMode="mixed" picker="class" body={body(ON(CQ_STATE.revealed), { question: { source: 'class', id: 'cq1' }, showCounts: true })} />,
  },
  {
    id: 'beam-class-none',
    title: 'Controls: no class question yet',
    role: 'professor',
    note: 'The Class questions list, empty.',
    render: () => <Console roomMode="devices" picker="class" classQs={[]} body={body(STATE.open, {})} />,
  },
  {
    id: 'beam-class-readonly',
    title: 'Controls: a class question, read only',
    role: 'hod',
    note: 'A head of department: what the wall shows of it, the switch shown but not usable, no take-down.',
    render: () => <Console roomMode="devices" canControl={false} body={body(ON(CQ_STATE.paused), { question: { source: 'class', id: 'cq2' }, showCounts: true })} />,
  },
  {
    id: 'beam-led',
    title: 'Controls: Teacher-led room, nothing up',
    role: 'professor',
    note: 'The wall shows the title, no code; no class questions to choose from.',
    render: () => <Console roomMode="teacher-led" body={body(STATE.ledIdle, {})} />,
  },
  {
    id: 'beam-readonly',
    title: 'Controls: read only',
    role: 'hod',
    note: 'A head of department: the preview and the links, and no controls.',
    render: () => <Console roomMode="devices" canControl={false} body={body(STATE.question, { question: { source: 'bank', id: 'q1' } })} />,
  },
  {
    id: 'beam-figure-diagram',
    title: 'Controls: a stepped figure on the diagram screen',
    role: 'professor',
    note: 'Batch 8 (P1): the plot at step 1 of 2. Back, Next and Start over send PATCH { step }; the dots and the caption say where the wall is.',
    render: () => <Console roomMode="devices" questions={FIG_BANK} body={body({ ...BASE, mode: 'diagram', diagram: { stimulus: projectorFigure('plot', 1) } }, { diagram: { questionId: 'f1' }, step: 1 })} />,
  },
  {
    id: 'beam-figure-start',
    title: 'Controls: a stepped figure, the figure itself',
    role: 'professor',
    note: 'A question whose figure has three steps, just put up: step 0, so Back and Start over wait.',
    render: () => <Console roomMode="teacher-led" questions={FIG_BANK} body={body({ ...BASE, roomMode: 'teacher-led', question: { ...FIG_Q('stack', 0, STACK_TEXT), options: OPTS('One', 'Two', 'Three', 'None') } }, { question: { source: 'bank', id: 'f3' }, step: 0 })} />,
  },
  {
    id: 'beam-figure-refused',
    title: 'Controls: a step refused',
    role: 'professor',
    note: 'The server’s sentence for a step past the end, as every refusal is shown. At the last step Next waits.',
    render: () => <Console roomMode="devices" questions={FIG_BANK} error={STEP_400} body={body(FIG.diagramLast, { diagram: { questionId: 'f1' }, step: 2 })} />,
  },
  {
    id: 'beam-figure-readonly',
    title: 'Controls: a stepped figure, read only',
    role: 'hod',
    note: 'A head of department sees where the wall is in the figure, with no buttons.',
    render: () => <Console roomMode="devices" canControl={false} body={body(FIG.diagramStep, { diagram: { questionId: 'f2' }, step: 1 })} />,
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

