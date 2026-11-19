/**
 * Batch 8, B3: teaching moves and the wheel, drawn from sample data.
 * Development only.
 *
 * Shapes as the b8-z1 server sends them (server/src/routes/teachingMoves.js,
 * services/teachingMoves.js moveView, routes/records.js next-question, the
 * wheel's pickView with questionDraw), and its own sentences word for word.
 * One class, Computer Networks CS-A, on Unit 4: The Transport Layer.
 *
 * Nothing here talks to the server. The entries that move stand in for it:
 * the press answers 202, "Reading the class data…" shows, then the suggestion
 * arrives as `teacher:teaching-move` would bring it. "Another" draws from the
 * sample pool by the server's rule (never one already drawn for the pick; the
 * pool widens with a note once every question has been asked in the room).
 */

import { useEffect, useRef, useState } from 'react';

import AccountShell from '../shell/AccountShell.jsx';
import { RoomsView } from '../account/Rooms.jsx';
import { ActivitiesView } from '../teach/Activities.jsx';
import { MoveCardView, PromptPanel } from '../teach/Moves.jsx';
import { RecordsLayout } from '../teach/Records.jsx';
import { WheelView, ringOf } from '../teach/Wheel.jsx';

/* ------------------------------------------------------------------ sample */

const CODE = 'K7Q2WD';
const at = (h, m) => new Date(Date.UTC(2026, 10, 19, h, m) - 330 * 60_000).toISOString();
const LABEL = 'AI suggestion, your call';
const PRIVACY = 'Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level.';
const CLASS = { id: 'c0ffee000000000000000001', courseName: 'Computer Networks', section: 'CS-A', termLabel: 'Odd term 2026' };
const ROOM = { code: CODE, title: 'Computer Networks - Unit 4: The Transport Layer', startedAt: at(10, 0), status: 'open', classId: CLASS.id };

// The server's sentences (services/teachingMoves.js, services/wheel.js, routes/records.js).
const OFFLINE = 'Suggestions need the AI model, and this server has none set up, so no suggestion was made. Choose an activity yourself; it is recorded the same way.';
const FAILED = 'The AI model could not make a usable suggestion this time. Try again, or choose an activity yourself.';
const NO_FOCUS = 'No graded answers yet, so there is nowhere the class is stuck to aim a move at. Ask for one activity\'s prompt instead, or wait for answers.';
const BUSY = 'A suggestion for this room is being written now. Wait for it to arrive.';
const NONE_LEFT = 'Every approved question of this room has been drawn for this pick already. Ask one aloud, or choose one by hand.';
const NO_QUESTIONS = 'This room has no approved question to draw (polls are left out). Draw a student only, or approve questions first.';
const WIDENED = 'Every approved question has been asked in this room, so this one may have been asked before.';

const LEVELS = [
  ['remember', 'Remember', 6, 30, 27], ['understand', 'Understand', 9, 41, 31], ['apply', 'Apply', 14, 24, 9],
  ['analyse', 'Analyse', 4, 8, 4], ['evaluate', 'Evaluate', 1, 2, 1], ['create', 'Create', 0, 0, 0],
].map(([level, label, working, answers, correct]) => ({ level, label, working, answers, correct }));
const BASIS = {
  present: 38, graded: 34, notAnswered: 4, support: { count: 6, banded: 31 }, levels: LEVELS,
  focus: { level: 'apply', label: 'Apply', working: 14, answers: 24, correct: 9 },
  sentence: 'Based on 14 students working at Apply, 9 of 24 Apply answers right, 6 of 31 below 40% overall, 4 present students not answered yet.',
  topicWhy: '3 of 9 right at Apply in this room, the fewest of any topic',
};

const move = (over) => ({
  purpose: 'move', focus: { level: 'apply', label: 'Apply' }, basis: BASIS, label: LABEL, model: 'gemini-2.5-flash', askedBy: null, used: [], ...over,
});
const MOVES = [
  move({
    id: 'a1f0000000000000000000a1', kind: 'think', kindLabel: 'Think and explain', topic: 'Flow control', askedAt: at(10, 42),
    title: 'Window arithmetic in pairs',
    text: 'Write on the board: the receiver advertises a window of 12 KB, and 5 KB is sent but not yet acknowledged. In pairs, work out on paper how much more the sender may send, and write one line on why. After a minute, two pairs read their line aloud and the class checks it against the slide.',
    sourceRef: { kind: 'slides', slides: [14, 15], topic: 'Flow control' },
  }),
  move({
    id: 'a1f0000000000000000000a2', kind: 'group', kindLabel: 'Group challenge', topic: 'Flow control', askedAt: at(10, 44),
    title: 'A window that shrinks',
    text: 'Benches of four: draw a sender and a receiver, then three turns in which the advertised window goes 8 KB, 4 KB, 0 KB. Mark what the sender may send after each turn. Record which benches got it, not which students.',
    sourceRef: { kind: 'slides', slides: [14], topic: 'Flow control' },
  }),
];
const PROMPTS = {
  group: {
    id: 'a1f0000000000000000000b1', purpose: 'prompt', kind: 'group', kindLabel: 'Group challenge', topic: 'Connection set-up', focus: null,
    title: 'One connection, start to finish',
    text: 'Benches of four sketch a timeline of one TCP connection: the three-way handshake, two data segments and the close. Label every arrow with its flags and numbers. Record which benches got it, not which students.',
    basis: { ...BASIS, topicWhy: 'chosen by the professor' }, sourceRef: { kind: 'slides', slides: [6, 7, 8], topic: 'Connection set-up' },
    label: LABEL, model: 'gemini-2.5-flash', askedBy: null, askedAt: at(10, 47), used: [],
  },
  real: {
    id: 'a1f0000000000000000000b2', purpose: 'prompt', kind: 'real', kindLabel: 'Real-world application', topic: 'TCP and UDP compared', focus: null,
    title: 'Wait or skip ahead?',
    text: 'Ask where a lost packet matters around them: a video call, a bank transfer, an online game. Each bench picks one and says whether it would rather wait for the resend or skip ahead, and why.',
    basis: BASIS, sourceRef: { kind: 'text', topic: 'TCP and UDP compared' },
    label: LABEL, model: 'gemini-2.5-flash', askedBy: null, askedAt: at(10, 51), used: [],
  },
};
const TOPICS = ['TCP and UDP compared', 'Connection set-up', 'Flow control', 'Congestion control'];

/* ------------------------------------------------------------------ L1: the card */

/** The page the card sits on: the room's Insights. */
function LivePage({ children }) {
  return (
    <AccountShell
      current="console"
      crumb={<span className="clip">Live · room <span className="mono">K7Q 2WD</span></span>}
      title="Computer Networks - Unit 4: The Transport Layer"
      sub="Insights: what the answers show, and one AI teaching move on your call."
    >
      <div className="stack stack-4">{children}</div>
    </AccountShell>
  );
}

/**
 * The card as the room's server would drive it: 202, the wait, then the push.
 * `outcome` picks what the press brings: the moves in turn, the offline
 * sentence, the failed one, or a 409.
 */
function MoveDemo({ initial = { phase: 'idle' }, outcome = 'moves', use: firstUse = null }) {
  const [state, setState] = useState(initial);
  const [use, setUse] = useState(firstUse);
  const next = useRef(0);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function ask() {
    setUse(null);
    if (outcome === 'offline') { setState({ phase: 'offline', message: OFFLINE }); return; }
    if (outcome === 'nofocus') { setState({ phase: 'refused', status: 409, message: NO_FOCUS }); return; }
    setState({ phase: 'running', requestId: `r${Date.now()}` });
    timer.current = setTimeout(() => {
      if (outcome === 'failed') { setState({ phase: 'failed', message: FAILED }); return; }
      const s = MOVES[next.current % MOVES.length];
      next.current += 1;
      setState({ phase: 'done', suggestion: { ...s, askedAt: new Date().toISOString() } });
    }, 1600);
  }
  function useIt(s) {
    setUse({ busy: true });
    timer.current = setTimeout(() => setUse({ at: new Date().toISOString(), label: s.kindLabel }), 700);
  }
  return <MoveCardView state={state} use={use} onAsk={ask} onUse={useIt} onOpenActivities={() => {}} />;
}

/* ------------------------------------------------------------------ C2: activities */

const ACT_KINDS = [
  { id: 'check', label: 'Quick knowledge check' }, { id: 'think', label: 'Think and explain' }, { id: 'group', label: 'Group challenge' },
  { id: 'diagram', label: 'Explain the diagram' }, { id: 'real', label: 'Real-world application' },
];
const RESULTS = [{ id: 'yes', label: 'Got it' }, { id: 'partly', label: 'Partly' }, { id: 'no', label: 'Not yet' }];
const mkAct = ({ id, seq, kind, outcome = '', suggestionId = null, when }) => ({
  id, seq, kind, label: ACT_KINDS.find((k) => k.id === kind)?.label ?? kind, outcome, groups: [], tallyId: null, suggestionId,
  createdAt: when, createdBy: null, updatedAt: when,
});
const ACTS = [
  mkAct({ id: 'a1', seq: 1, kind: 'think', outcome: 'Thirty seconds, then the wheel. Byte numbering came out clearly.', when: at(10, 12) }),
  mkAct({ id: 'a2', seq: 2, kind: 'think', outcome: 'Most pairs got 7 KB; three said 12.', suggestionId: MOVES[0].id, when: at(10, 43) }),
];

/** Activities with the AI prompt per kind. `outcome` as in MoveDemo. */
function PromptsDemo({ open: firstOpen = null, initial = { phase: 'idle' }, outcome = 'prompts', topics = TOPICS }) {
  const [data, setData] = useState({ room: ROOM, kinds: ACT_KINDS, results: RESULTS, activities: ACTS, privacy: PRIVACY });
  const [open, setOpen] = useState(firstOpen);
  const [state, setState] = useState(initial);
  const [topic, setTopic] = useState('');
  const [use, setUse] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function ask(kind) {
    setUse(null);
    const body = { kind, ...(topic ? { topic } : {}) };
    if (outcome === 'offline') { setState({ phase: 'offline', message: OFFLINE, body }); return; }
    if (outcome === 'busy') { setState({ phase: 'refused', status: 409, message: BUSY, body }); return; }
    setState({ phase: 'running', body });
    timer.current = setTimeout(() => {
      const base = PROMPTS[kind] ?? { ...PROMPTS.group, kind, kindLabel: ACT_KINDS.find((k) => k.id === kind)?.label };
      const t = topic || base.topic;
      setState({ phase: 'done', body, suggestion: { ...base, id: `${base.id.slice(0, -2)}${String(Date.now()).slice(-2)}`, topic: t, sourceRef: { ...base.sourceRef, topic: t } } });
    }, 1600);
  }
  function useIt(s) {
    setUse({ busy: true });
    timer.current = setTimeout(() => {
      const made = mkAct({ id: `a${Date.now()}`, seq: data.activities.length + 1, kind: s.kind, suggestionId: s.id, when: new Date().toISOString() });
      setData((d) => ({ ...d, activities: [...d.activities, made] }));
      setUse({ at: made.createdAt, label: made.label });
    }, 700);
  }
  const ai = {
    open,
    onOpen: (k) => { setOpen(k); setState({ phase: 'idle' }); setUse(null); },
    panel: (k) => (
      <PromptPanel
        kind={k}
        state={state}
        topics={topics}
        topic={topic}
        onTopic={setTopic}
        onAsk={() => ask(k.id)}
        onUse={useIt}
        use={use}
        onClose={() => setOpen(null)}
      />
    ),
  };
  return (
    <ActivitiesView
      data={data}
      load={{ status: 'ready' }}
      canControl
      tallies={{ status: 'ready', list: [], error: '' }}
      onCreate={() => Promise.resolve(true)}
      onUpdate={() => Promise.resolve(true)}
      onNeedTallies={() => {}}
      ai={ai}
    />
  );
}

/* ------------------------------------------------------------------ W2 and gap 9: the wheel */

const ASKS = [
  { id: 'bank', label: 'Bank', hint: 'A question from the room\'s bank.' },
  { id: 'diagram', label: 'Diagram', hint: 'Ask them to explain the diagram on the projector, one step at a time.' },
  { id: 'demo', label: 'Demo', hint: 'Ask them to work it through on the board while the class follows.' },
  { id: 'verbal', label: 'Verbal question', hint: 'A question you ask aloud, made up on the spot; it is not from the bank.' },
];
const STATUSES = [
  { id: 'answered', label: 'Answered' }, { id: 'passed', label: 'Passed to partner' }, { id: 'help', label: 'Needs help' },
  { id: 'skipped', label: 'Skipped' }, { id: 'absent', label: 'Absent' },
];
const QUESTIONS = [
  { questionId: 'q01', bloom: 'remember', kind: 'mcq', text: 'Which layer of the TCP/IP model does TCP belong to?' },
  { questionId: 'q02', bloom: 'remember', kind: 'mcq', text: 'Which protocol is connectionless: TCP, SCTP, UDP or QUIC over TLS?' },
  { questionId: 'q03', bloom: 'understand', kind: 'mcq', text: 'Why does TCP number every byte it sends rather than every segment?' },
  { questionId: 'q04', bloom: 'understand', kind: 'truefalse', text: 'True or false: a UDP checksum lets the receiver repair a corrupted segment.' },
  { questionId: 'q05', bloom: 'apply', kind: 'numeric', text: 'A sender has 4 KB unacknowledged and the receive window is 10 KB. How much more may it send?' },
  { questionId: 'q06', bloom: 'analyse', kind: 'multi', text: 'Choose every reason the throughput fell after the third duplicate acknowledgement in this trace.' },
];
const QS = { status: 'ready', list: QUESTIONS, error: '', load: () => {} };
const qOf = (id) => QUESTIONS.find((q) => q.questionId === id);
const PEOPLE = [
  ['23CS01', 'Aarav Shah'], ['23CS02', 'Aditi Rao'], ['23CS03', 'Ananya Iyer'], ['23CS05', 'Ishaan Kulkarni'], ['23CS06', 'Kavya Nair'],
  ['23CS07', 'Rohan Deshmukh'], ['23CS08', 'Sneha Joshi'], ['23CS09', 'Vihaan Mehta'], ['23CS10', 'Diya Kapoor'], ['23CS11', 'Aryan Gupta'],
  ['23CS13', 'Kabir Singh'], ['23CS14', 'Saanvi Reddy'], ['23CS15', 'Yash Pawar'], ['23CS16', 'Tanvi Bhosale'],
].map(([rollNo, name]) => ({ rollNo, name }));

/** pickView: `draws` the question draws for the pick, in order (the last names its question). */
function mkPick({ id, order, roll, ask = 'bank', questionId = null, status = 'pending', when, draws = [], poolSizes = [] }) {
  const q = questionId ? qOf(questionId) : null;
  const last = draws.length && draws.at(-1) === questionId
    ? { order: draws.length, poolSize: poolSizes.at(-1) ?? QUESTIONS.length, drawnAt: when, draws: draws.length }
    : null;
  return {
    id, round: 1, order, rollNo: roll, name: PEOPLE.find((p) => p.rollNo === roll)?.name ?? '', classStudentId: null, poolSize: PEOPLE.length - order + 1,
    presentOnly: true, noRepeat: true, ask, askLabel: ASKS.find((a) => a.id === ask)?.label ?? ask,
    questionId, question: q ? { text: q.text, bloom: q.bloom, kind: q.kind } : null, questionDraw: last,
    status, statusLabel: status === 'pending' ? 'Pending' : STATUSES.find((s) => s.id === status)?.label ?? status,
    pickedAt: when, pickedBy: null, statusAt: status === 'pending' ? null : when, statusBy: null,
    _draws: draws, _pools: poolSizes,
  };
}

function wheelBody(picks) {
  const had = new Set(picks.map((p) => p.rollNo));
  const left = PEOPLE.filter((p) => !had.has(p.rollNo));
  return {
    room: ROOM,
    round: { number: 1, started: picks.length > 0, startedAt: at(10, 2), presentOnly: true, noRepeat: true, picks: picks.length },
    pool: { total: PEOPLE.length, left: left.length, picked: picks.length, summary: `${picks.length} picked of ${PEOPLE.length}`, onWheel: left, empty: null },
    rounds: [{ number: 1, startedAt: at(10, 2), presentOnly: true, noRepeat: true }],
    picks, asks: ASKS, statuses: STATUSES, privacy: PRIVACY,
  };
}

const crypto8 = (n) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };

/**
 * The wheel in "Question + student". Draw and Another follow the server's
 * rule for the sample pool; `room` lists questions asked elsewhere in the room.
 */
function WheelQDemo({ picks: first, prefs: firstPrefs = { think: false, names: true, withQuestion: true }, drawError = '', questionError: firstQErr = {}, drawNotes: firstNotes = {}, pool = QUESTIONS, selected = null }) {
  const [picks, setPicks] = useState(first);
  const [spin, setSpin] = useState(null);
  const [selectedId, setSelectedId] = useState(selected);
  const [prefs, setPrefs] = useState(firstPrefs);
  const [error, setError] = useState(drawError);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState(firstNotes);
  const [qErr, setQErr] = useState(firstQErr);
  const wheel = wheelBody(picks);

  function drawQ(forPick = []) {
    const room = new Set(picks.flatMap((p) => [p.questionId, ...p._draws]).filter(Boolean));
    const mine = new Set(forPick);
    let list = pool.filter((q) => !room.has(q.questionId) && !mine.has(q.questionId));
    let widened = false;
    if (!list.length) { list = pool.filter((q) => !mine.has(q.questionId)); widened = list.length > 0; }
    if (!list.length) return { reason: pool.length ? NONE_LEFT : NO_QUESTIONS };
    return { q: list[crypto8(list.length)], size: list.length, widened };
  }
  function draw() {
    if (!wheel.pool.left) return;
    let d = null;
    if (prefs.withQuestion) {
      d = drawQ();
      if (!d.q) { setError(d.reason); return; }
    }
    const who = wheel.pool.onWheel[crypto8(wheel.pool.left)];
    const p = mkPick({ id: `d${Date.now()}`, order: picks.length + 1, roll: who.rollNo, questionId: d?.q.questionId ?? null, when: new Date().toISOString(), draws: d ? [d.q.questionId] : [], poolSizes: d ? [d.size] : [] });
    setSpin({ ring: ringOf(wheel), pick: p });
    setPicks((list) => [...list, p]);
    setSelectedId(p.id);
    setError('');
  }
  function another(id) {
    const p = picks.find((x) => x.id === id);
    setBusy(`another:${id}`);
    setQErr({});
    setTimeout(() => {
      setBusy('');
      const d = drawQ([...p._draws, p.questionId].filter(Boolean));
      if (!d.q) { setQErr({ id, message: d.reason }); return; }
      const draws = [...p._draws, d.q.questionId];
      setPicks((list) => list.map((x) => (x.id === id ? mkPick({ ...x, roll: x.rollNo, when: x.pickedAt, questionId: d.q.questionId, draws, poolSizes: [...x._pools, d.size] }) : x)));
      setNotes((n) => ({ ...n, [id]: d.widened ? WIDENED : '' }));
    }, 500);
  }
  function pick(id, patch) {
    setPicks((list) => list.map((p) => {
      if (p.id !== id) return p;
      const ask = patch.ask ?? p.ask;
      const questionId = ask !== 'bank' ? null : patch.questionId !== undefined ? patch.questionId : p.questionId;
      return mkPick({ ...p, roll: p.rollNo, when: p.pickedAt, ask, questionId, status: patch.status ?? p.status, draws: p._draws, poolSizes: p._pools });
    }));
  }

  return (
    <WheelView
      wheel={wheel}
      load={{ status: 'ready' }}
      canControl
      classRoom
      busy={busy}
      error={error}
      spin={spin}
      onLanded={() => setSpin(null)}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onDraw={draw}
      prefs={prefs}
      onPref={(key, value) => { setPrefs((p) => ({ ...p, [key]: value })); setError(''); }}
      onRound={() => {}}
      onSetting={() => {}}
      onPick={pick}
      markAbsent
      onMarkAbsent={() => {}}
      questions={QS}
      onAnother={another}
      drawNotes={notes}
      questionError={qErr}
    />
  );
}

/** The console page around the wheel, as Live hosts it under "In the room". */
function RecordsPage({ tab = 'wheel', children }) {
  return (
    <AccountShell
      current="console"
      crumb={<span className="clip">Live · <span className="mono">{CODE}</span> · Computer Networks CS-A</span>}
      title="In the room"
      sub="The wheel, raised hands, observations and activities."
    >
      <RecordsLayout tab={tab} onTab={() => {}} canControl>{children}</RecordsLayout>
    </AccountShell>
  );
}

const DRAWN = [
  mkPick({ id: 'p1', order: 1, roll: '23CS07', questionId: 'q01', status: 'answered', when: at(10, 4), draws: ['q01'], poolSizes: [6] }),
  mkPick({ id: 'p2', order: 2, roll: '23CS15', questionId: 'q05', when: at(10, 9), draws: ['q03', 'q05'], poolSizes: [5, 4] }),
];
// Every question asked in the room already: the next "Another" widens, with its note.
const ALL_ASKED = [
  mkPick({ id: 'w1', order: 1, roll: '23CS01', questionId: 'q01', status: 'answered', when: at(10, 4), draws: ['q01'], poolSizes: [6] }),
  mkPick({ id: 'w2', order: 2, roll: '23CS02', questionId: 'q02', status: 'answered', when: at(10, 6), draws: ['q02'], poolSizes: [5] }),
  mkPick({ id: 'w3', order: 3, roll: '23CS03', questionId: 'q03', status: 'help', when: at(10, 8), draws: ['q03'], poolSizes: [4] }),
  mkPick({ id: 'w4', order: 4, roll: '23CS05', questionId: 'q04', status: 'answered', when: at(10, 11), draws: ['q04'], poolSizes: [3] }),
  mkPick({ id: 'w5', order: 5, roll: '23CS06', questionId: 'q05', status: 'answered', when: at(10, 13), draws: ['q05'], poolSizes: [2] }),
  mkPick({ id: 'w6', order: 6, roll: '23CS08', questionId: 'q06', when: at(10, 15), draws: ['q06'], poolSizes: [1] }),
];
const VERBAL = [
  ...DRAWN.slice(0, 1),
  mkPick({ id: 'v1', order: 2, roll: '23CS10', ask: 'verbal', status: 'answered', when: at(10, 12) }),
];

/* ------------------------------------------------------------------ L2: the rooms list */

const ROOMS = [
  ['K7Q2WD', 'Computer Networks - Unit 4: The Transport Layer', 'open', CLASS, 38, 34, 412, 6, 0.64],
  ['P3M8XA', 'Operating Systems - Deadlocks', 'paused', { id: 'c2', courseName: 'Operating Systems', section: 'TY-CS A', termLabel: 'Sem V 2026' }, 41, 0, 380, 3, 0.71],
  ['H2T9RB', 'Data Structures - Trees and traversals', 'closed', { id: 'c3', courseName: 'Data Structures', section: 'SY-CS A', termLabel: '' }, 52, 0, 610, 9, 0.58],
  ['Z4N6CE', 'Open revision: Unit 3', 'closed', null, 17, 0, 140, 1, 0.69],
].map(([code, title, status, cls, joined, online, answered, banded, accuracy], i) => ({
  code, title, status, contentId: `c0ntent00000000000000000${i}`, settings: { masteryGoal: 0.8, reattempts: 0, redemption: false, mode: i === 1 ? 'mixed' : 'devices' },
  classId: cls?.id ?? null, class: cls, questionIds: null, withdrawn: 0,
  startedAt: at(10 - i * 2, 0), pausedAt: status === 'paused' ? at(10 - i * 2, 40) : null, closedAt: status === 'closed' ? at(10 - i * 2, 55) : null,
  joined, online, answered, banded, accuracy, canControl: true,
}));

function RoomsDemo() {
  const noop = () => Promise.resolve(true);
  return (
    <RoomsView
      loading={false}
      error=""
      locked={false}
      rooms={ROOMS}
      reading={false}
      onReload={() => {}}
      busy={null}
      actionError=""
      notice=""
      onDismiss={() => {}}
      onPause={noop}
      onResume={noop}
      onClose={noop}
      onDelete={noop}
      archives={{ loading: false, error: '', list: [], limitBytes: 1024 * 1024 }}
      onReloadArchives={() => {}}
      onDownload={noop}
    />
  );
}

/* ------------------------------------------------------------------ entries */

export default [
  {
    id: 'moves-card',
    title: 'Suggest a move',
    role: 'professor',
    note: 'L1 at rest under the insight cards. Press it: the 202, "Reading the class data…", then the suggestion as the push brings it. Another idea asks again; Use it records the activity.',
    render: () => <LivePage><MoveDemo /></LivePage>,
  },
  {
    id: 'moves-card-done',
    title: 'Suggest a move, a suggestion',
    role: 'professor',
    note: 'The title, the text, the server’s basis sentence with “AI suggestion, your call”, and the slides it cites. Counts only, never a name.',
    render: () => <LivePage><MoveDemo initial={{ phase: 'done', suggestion: MOVES[0] }} /></LivePage>,
  },
  {
    id: 'moves-card-used',
    title: 'Suggest a move, used',
    role: 'professor',
    note: 'Use it recorded the activity with the suggestion’s id; Open Activities goes to the record.',
    render: () => <LivePage><MoveDemo initial={{ phase: 'done', suggestion: MOVES[1] }} use={{ at: at(10, 45), label: 'Group challenge' }} /></LivePage>,
  },
  {
    id: 'moves-card-restored',
    title: 'Suggest a move, after a reload',
    role: 'professor',
    note: 'The room’s latest move, read from the list with when it was made; it was already used.',
    render: () => <LivePage><MoveDemo initial={{ phase: 'done', restored: true, suggestion: { ...MOVES[0], used: ['act1'] } }} /></LivePage>,
  },
  {
    id: 'moves-card-running',
    title: 'Suggest a move, waiting',
    role: 'professor',
    note: 'Between the 202 and the push (or the request reading done).',
    render: () => <LivePage><MoveCardView state={{ phase: 'running', requestId: 'r1' }} /></LivePage>,
  },
  {
    id: 'moves-card-offline',
    title: 'Suggest a move, no model on the server',
    role: 'professor',
    note: 'state offline: the server’s sentence as it comes. Nothing is made up in its place.',
    render: () => <LivePage><MoveDemo outcome="offline" initial={{ phase: 'offline', message: OFFLINE }} /></LivePage>,
  },
  {
    id: 'moves-card-failed',
    title: 'Suggest a move, the model failed',
    role: 'professor',
    note: 'The request read failed: its sentence, and Try again.',
    render: () => <LivePage><MoveDemo outcome="failed" initial={{ phase: 'failed', message: FAILED }} /></LivePage>,
  },
  {
    id: 'moves-card-409',
    title: 'Suggest a move, no graded answers yet',
    role: 'professor',
    note: 'The 409’s sentence under the resting card. The button stays for when answers arrive.',
    render: () => <LivePage><MoveDemo outcome="nofocus" initial={{ phase: 'refused', status: 409, message: NO_FOCUS }} /></LivePage>,
  },
  {
    id: 'moves-prompts',
    title: 'Activities, Ask AI for a prompt',
    role: 'professor',
    note: 'C2: each kind can ask for a prompt written from the chapter, optionally for one topic. Group challenge is open: Write a prompt, then Use it. An activity run from a suggestion says so.',
    render: () => <RecordsPage tab="activities"><PromptsDemo open="group" /></RecordsPage>,
  },
  {
    id: 'moves-prompts-done',
    title: 'Activities, a prompt shown large',
    role: 'professor',
    note: 'The prompt large, its slides and topic, and the AI label. Another idea asks again, with the topic chosen.',
    render: () => <RecordsPage tab="activities"><PromptsDemo open="group" initial={{ phase: 'done', body: { kind: 'group' }, suggestion: PROMPTS.group }} /></RecordsPage>,
  },
  {
    id: 'moves-prompts-text',
    title: 'Activities, a prompt from the chapter’s text',
    role: 'professor',
    note: 'A chapter pasted as text has no slides: the prompt cites the chapter’s text and its topic.',
    render: () => <RecordsPage tab="activities"><PromptsDemo open="real" initial={{ phase: 'done', body: { kind: 'real' }, suggestion: PROMPTS.real }} /></RecordsPage>,
  },
  {
    id: 'moves-prompts-offline',
    title: 'Activities, no model on the server',
    role: 'professor',
    note: 'The server’s offline sentence in the panel; Record still works as before.',
    render: () => <RecordsPage tab="activities"><PromptsDemo open="think" outcome="offline" initial={{ phase: 'offline', message: OFFLINE, body: { kind: 'think' } }} /></RecordsPage>,
  },
  {
    id: 'moves-prompts-busy',
    title: 'Activities, one already being written',
    role: 'professor',
    note: 'The 409 while another suggestion for the room is being written.',
    render: () => <RecordsPage tab="activities"><PromptsDemo open="check" outcome="busy" initial={{ phase: 'refused', status: 409, message: BUSY, body: { kind: 'check' } }} /></RecordsPage>,
  },
  {
    id: 'moves-wheel-question',
    title: 'Wheel, Question + student',
    role: 'professor',
    note: 'W2: each draw also draws an approved question on the server; the pick shows it with “drawn from N”. Another asks the server for the next one. Draw and Another work here.',
    render: () => <RecordsPage><WheelQDemo picks={DRAWN} selected="p2" /></RecordsPage>,
  },
  {
    id: 'moves-wheel-widened',
    title: 'Wheel, Another after every question was asked',
    role: 'professor',
    note: 'Every question has been asked in the room: the server widens the pool and its draw.note says so.',
    render: () => (
      <RecordsPage>
        <WheelQDemo
          picks={[...ALL_ASKED.slice(0, 5), mkPick({ id: 'w6', order: 6, roll: '23CS08', questionId: 'q02', when: at(10, 15), draws: ['q06', 'q02'], poolSizes: [1, 5] })]}
          selected="w6"
          drawNotes={{ w6: WIDENED }}
        />
      </RecordsPage>
    ),
  },
  {
    id: 'moves-wheel-none-left',
    title: 'Wheel, no question left for the pick',
    role: 'professor',
    note: 'Another’s 409, as the server says it, beside the question.',
    render: () => <RecordsPage><WheelQDemo picks={ALL_ASKED} selected="w6" questionError={{ id: 'w6', message: NONE_LEFT }} /></RecordsPage>,
  },
  {
    id: 'moves-wheel-no-questions',
    title: 'Wheel, a room with no question to draw',
    role: 'professor',
    note: 'The draw’s 409: no pick is made. Switch to Student to draw a student only.',
    render: () => <RecordsPage><WheelQDemo picks={[]} pool={[]} drawError={NO_QUESTIONS} /></RecordsPage>,
  },
  {
    id: 'moves-wheel-verbal',
    title: 'Wheel, a verbal question',
    role: 'professor',
    note: 'Gap 9: Verbal question is one of the server’s asks. Like a diagram or a demo, it names no bank question, so there is no picker.',
    render: () => <RecordsPage><WheelQDemo picks={VERBAL} selected="v1" prefs={{ think: false, names: true, withQuestion: false }} /></RecordsPage>,
  },
  {
    id: 'moves-rooms-class',
    title: 'Rooms, with the class',
    role: 'professor',
    note: 'L2: each room row names its class (course · section · term) from room.class; a room for no class shows none.',
    render: () => <RoomsDemo />,
  },
];
