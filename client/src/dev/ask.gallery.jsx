/**
 * Class questions and confidence counts, drawn from sample data. Development only.
 *
 * Nine phones in a Student devices room on Computer Networks, Unit 4. The
 * bodies have the shapes of docs/API.md "Phase 5" (the class question as staff
 * get it, GET …/class-questions, GET …/confidence, the student card's
 * `confidence`), and their figures agree: votes add up to the round's `voted`,
 * the taps add up to the votes, right and wrong to the share right, and the
 * changes to the students who voted both times.
 *
 * The entries that move stand in for the server with the server's own rules:
 * putting a question to the class, pausing, the re-vote and the close answer
 * as the server would, refusals included, and votes arrive while a round is
 * open as `teacher:class-question` pushes would.
 *
 * One entry, marked "Live only", is not sample data: it reads a real room on
 * the local server (`?room=CODE`, MP9BRS by default).
 */

import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import AccountShell from '../shell/AccountShell.jsx';
import ClassQuestions, { ClassQuestionsView, RoomConfidence, RoomConfidenceView, blockedReason, withBody } from '../teach/ClassQuestions.jsx';
import { StudentCardView } from '../teach/StudentCard.jsx';
import useRoomFeed from '../teach/useRoomFeed.js';

/* ------------------------------------------------------------------ sample */

const CODE = 'QN4R7K';
const L = 'ABCDEFGH';
/** h:m in India's time (UTC+5:30), as an ISO stamp. */
const at = (h, m) => new Date(Date.UTC(2026, 10, 19, h, m) - 330 * 60_000).toISOString();
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

const CHOICES = [{ id: 'sure', label: 'Sure' }, { id: 'think_so', label: 'Think so' }, { id: 'guessing', label: 'Guessing' }];
const CONF_NOTE = 'How sure students said they were, counted beside whether the answer was right. It is information only: it never changes a mark, a level or attainment, and no student is labelled by it.';
const CLASS_NOTE = 'Counts only: no student is named. A class question moves no student\'s level: it was not chosen for any one student\'s level, and its re-vote follows the class\'s discussion. In attainment its first round counts as a digital answer when its question is mapped to an outcome; the re-vote is shown under its own label and never counted. Once asked, the question is not served to any phone on its own in this room again.';
const KINDS = ['mcq', 'truefalse', 'poll', 'multi'];

const INFO = {
  code: CODE, title: 'Computer Networks - Unit 4: The Transport Layer', status: 'open', contentId: 'c0ffee0000000000000000a1',
  settings: { mode: 'devices', adapt: true, startLevel: 'understand' }, questionIds: null, classId: 'c0ffee0000000000000000c1', canControl: true,
};

const PROVENANCE = { source: 'professor', sourceLabel: 'Professor-written', approval: 'written', aiDraft: false, label: 'Professor-written' };
const q = (id, kind, bloom, topic, text, rest = {}) => ({ _id: id, status: 'active', source: 'teacher', provenance: PROVENANCE, kind, bloom, topic, text, ...rest });
const BANK = [
  q('b01', 'mcq', 'remember', 'Layers', 'Which layer routes packets between networks?', { options: ['Link', 'Transport', 'Network', 'Physical'], answerIdx: 2 }),
  q('b02', 'truefalse', 'remember', 'UDP', 'A UDP checksum lets the receiver repair a corrupted segment.', { answerBool: false }),
  q('b03', 'mcq', 'understand', 'Transmission Control Protocol', 'Why does TCP number every byte it sends rather than every segment?', {
    options: ['Segments are always the same size', 'So the receiver can acknowledge exactly how much arrived, whatever the segment sizes', 'Bytes are easier to encrypt', 'IP numbers the segments already'],
    answerIdx: 1,
  }),
  q('b04', 'multi', 'analyse', 'Congestion control', 'Which of these make a TCP sender shrink its congestion window? Choose all that apply.', {
    options: ['Three duplicate acknowledgements', 'A retransmission timeout', 'A larger receive window', 'An ECN echo from the receiver'],
    answerIdxs: [0, 1, 3],
  }),
  q('b05', 'poll', null, 'Choosing a transport', 'For a two-way video call on a busy network, which transport would you reach for first?', { options: ['TCP', 'UDP', 'QUIC', 'Not sure yet'] }),
  q('b06', 'mcq', 'apply', 'Flow control', 'A receiver advertises a 10 KB window and 4 KB is unacknowledged. How much more may the sender send now?', { options: ['4 KB', '6 KB', '10 KB', '14 KB'], answerIdx: 1 }),
  q('b07', 'match', 'understand', 'Ports', 'Match each service to its well-known port.'),
  q('b08', 'open', 'create', 'Design', 'Design a transport protocol for sensor readings that may be lost but never reordered.'),
  { ...q('b09', 'mcq', 'remember', 'Sockets', 'Which call does a server make before accept()?', { options: ['listen', 'connect', 'send', 'close'], answerIdx: 0 }), status: 'draft' },
];
const BANK_STATE = { status: 'ready', list: BANK, error: '', load: () => {} };
const bankQ = (id) => BANK.find((b) => b._id === id);

function optionsOf(b) {
  return b.kind === 'truefalse'
    ? [{ key: 'A', label: 'True' }, { key: 'B', label: 'False' }]
    : b.options.map((label, i) => ({ key: L[i], label }));
}
function keyOf(b) {
  if (b.kind === 'poll') return [];
  if (b.kind === 'truefalse') return [b.answerBool ? 0 : 1];
  if (b.kind === 'multi') return b.answerIdxs;
  return [b.answerIdx];
}

/** Split n by weights into whole counts that add up to n. */
function split(n, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.floor((n * w) / sum));
  let left = n - out.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % out.length) { out[i] += 1; left -= 1; }
  return out;
}

/** A closed round: `voted` votes, `right` of them right, spread the way a class spreads. */
function closedRound(b, round, voted, right, { changed = 0, late = 0, unreadable = 0 } = {}) {
  const opts = optionsOf(b);
  const keys = keyOf(b);
  const poll = b.kind === 'poll';
  const votes = opts.map(() => 0);
  const counted = voted - unreadable;
  if (poll) {
    split(counted, [2, 4, 2, 1].slice(0, opts.length)).forEach((v, i) => { votes[i] = v; });
  } else {
    const wrong = counted - right;
    const others = opts.map((_, i) => i).filter((i) => !keys.includes(i));
    if (b.kind === 'multi') {
      for (const k of keys) votes[k] += right;
      // A wrong choose-all vote ticks the first key and one option that is not one.
      votes[keys[0]] += wrong;
      split(wrong, others.map((_, i) => others.length - i)).forEach((v, i) => { votes[others[i]] += v; });
    } else {
      votes[keys[0]] = right;
      split(wrong, others.map((_, i) => others.length - i + 1)).forEach((v, i) => { votes[others[i]] += v; });
    }
  }
  const rightCounts = split(right, [5, 3, 2, 1]);
  const wrongCounts = split(voted - right, [2, 3, 4, 2]);
  const cell = (i) => (poll
    ? { answers: split(voted, [3, 3, 2, 1])[i], correct: 0, wrong: 0, ungraded: split(voted, [3, 3, 2, 1])[i] }
    : { answers: rightCounts[i] + wrongCounts[i], correct: rightCounts[i], wrong: wrongCounts[i], ungraded: 0 });
  return {
    round, open: false, voted, changedVotes: changed, notCounted: late,
    distribution: { options: opts.map((o, i) => ({ ...o, votes: votes[i] })), unreadable },
    right: poll ? null : { students: right, of: voted, share: voted ? Math.floor((right * 10000) / voted) / 10000 : null },
    confidence: { sure: cell(0), think_so: cell(1), guessing: cell(2), none: cell(3) },
  };
}
const openRound = (round, voted) => ({ round, open: true, voted, changedVotes: 0, notCounted: 0, distribution: null, right: null, confidence: null });

/** The changes between two closed rounds, from who voted both times. */
function changesOf(b, r1, r2, { onlyBefore = 0, onlyAfter = 0 } = {}) {
  const both = Math.min(r1.voted - onlyBefore, r2.voted - onlyAfter);
  if (b.kind === 'poll') {
    const changed = Math.round(both / 3);
    return { both, onlyBefore, onlyAfter, kept: both - changed, changed };
  }
  const rb = Math.min(r1.right.students, both);
  const ra = Math.min(r2.right.students, both);
  const rightToRight = Math.max(0, Math.min(rb, ra) - 1);
  const rightToWrong = rb - rightToRight;
  const wrongToRight = Math.max(0, ra - rightToRight);
  const rest = Math.max(0, both - rightToRight - rightToWrong - wrongToRight);
  const wrongToSameWrong = Math.ceil(rest / 2);
  return { both, onlyBefore, onlyAfter, wrongToRight, rightToWrong, rightToRight, wrongToSameWrong, wrongToOtherWrong: rest - wrongToSameWrong };
}

const PHONES = { joined: 9, online: 8, answeredAlone: 0 };
const SOURCE_LABEL = { teacher: 'Professor-written', llm: 'AI-generated', fallback: 'Professor-written or offline template' };
/** The server's sentence for phones that answered the question on their own first (services/classQuestions.js). */
const aloneNote = (n) => (n === 1
  ? 'One phone in this room answered this question on its own before you put it to the class, and was shown its answer then. Its vote is not counted in attainment; close the question if that matters to the discussion.'
  : `${n} phones in this room answered this question on their own before you put it to the class, and were shown its answer then. Their votes are not counted in attainment; close the question if that matters to the discussion.`);

/** A class question as staff get it. */
function cqBody(b, { id = `cq-${b._id}`, seq = 1, state = 'open', rounds = [openRound(1, 0)], changes = null, revealed = false, startedAt = at(10, 12), times = {}, phones = PHONES } = {}) {
  return {
    id, seq, questionId: b._id, state, round: rounds.length, voting: state === 'open' || state === 'revote', revealed,
    startedAt, startedBy: 'p1', pausedAt: null, revoteAt: null, closedAt: null, closedBy: null, ...times,
    question: {
      text: b.text, kind: b.kind, kindLabel: KIND_LABEL[b.kind], level: b.bloom ?? null, levelLabel: b.bloom ? LABEL[b.bloom] : null,
      topic: b.topic, source: b.source, sourceLabel: SOURCE_LABEL[b.source] ?? null, options: optionsOf(b), correct: b.kind === 'poll' ? null : keyOf(b).map((i) => L[i]), stimulus: null,
    },
    phones, ...(phones.answeredAlone ? { answeredAloneNote: aloneNote(phones.answeredAlone) } : {}),
    rounds, changes, confidenceChoices: CHOICES, confidenceNote: CONF_NOTE, note: CLASS_NOTE,
  };
}

/* The one class question every stage below shows: "Which layer routes packets". */
const B1 = bankQ('b01');
const R1 = closedRound(B1, 1, 9, 4, { changed: 2 });
const R2 = closedRound(B1, 2, 9, 6, { changed: 1, late: 1 });
const OPEN = cqBody(B1, { seq: 2, state: 'open', rounds: [openRound(1, 5)], startedAt: at(10, 31) });
/* The same question, put to the class after two phones had answered it on their own. */
const OPEN_ALONE = cqBody(B1, { seq: 2, state: 'open', rounds: [openRound(1, 2)], startedAt: at(10, 31), phones: { ...PHONES, answeredAlone: 2 } });
const PAUSED = cqBody(B1, { seq: 2, state: 'paused', rounds: [R1], startedAt: at(10, 31), times: { pausedAt: at(10, 33) } });
const REVOTE = cqBody(B1, { seq: 2, state: 'revote', rounds: [R1, openRound(2, 3)], startedAt: at(10, 31), times: { pausedAt: at(10, 33), revoteAt: at(10, 37) } });
const CLOSED = cqBody(B1, {
  seq: 2, state: 'closed', rounds: [R1, R2], revealed: true, changes: changesOf(B1, R1, R2, { onlyBefore: 1, onlyAfter: 1 }),
  startedAt: at(10, 31), times: { pausedAt: at(10, 33), revoteAt: at(10, 37), closedAt: at(10, 39), closedBy: 'p1' },
});

/* Earlier ones: a poll with its re-vote, and a choose-all closed after the first vote. */
const B5 = bankQ('b05');
const P1 = closedRound(B5, 1, 9, 0);
const P2 = { ...closedRound(B5, 2, 9, 0), distribution: { options: optionsOf(B5).map((o, i) => ({ ...o, votes: [1, 6, 2, 0][i] })), unreadable: 0 } };
const POLL = cqBody(B5, {
  id: 'cq-b05', seq: 1, state: 'closed', rounds: [P1, P2], changes: changesOf(B5, P1, P2),
  startedAt: at(10, 14), times: { pausedAt: at(10, 16), revoteAt: at(10, 19), closedAt: at(10, 21), closedBy: 'p1' },
});
const B4 = bankQ('b04');
const MULTI = cqBody(B4, {
  id: 'cq-b04', seq: 3, state: 'closed', rounds: [closedRound(B4, 1, 8, 3, { unreadable: 1 })], revealed: false,
  startedAt: at(10, 44), times: { closedAt: at(10, 47), closedBy: 'p1' },
});

const list = (v) => (Array.isArray(v) ? v : []);
const readOf = (items, room = INFO) => ({
  room: { code: room.code, title: room.title, status: room.status },
  kinds: KINDS,
  running: items.find((c) => c.state !== 'closed')?.id ?? null,
  classQuestions: items,
  confidenceChoices: CHOICES,
  note: CLASS_NOTE,
});

/* -------------------------------------------------------- confidence */

const cellOf = (answers, correct, ungraded = 0) => ({ answers, correct, wrong: answers - correct - ungraded, ungraded });
const CONFIDENCE = {
  room: { code: CODE, title: INFO.title, status: 'open' },
  choices: CHOICES,
  answers: 64,
  tapped: 41,
  counts: { sure: cellOf(17, 12), think_so: cellOf(14, 8, 1), guessing: cellOf(10, 3), none: cellOf(23, 13) },
  questions: [
    { questionId: 'b03', text: bankQ('b03').text, level: 'understand', kind: 'mcq', answers: 14, counts: { sure: cellOf(5, 3), think_so: cellOf(4, 2), guessing: cellOf(2, 0), none: cellOf(3, 2) } },
    { questionId: 'b06', text: bankQ('b06').text, level: 'apply', kind: 'mcq', answers: 11, counts: { sure: cellOf(3, 3), think_so: cellOf(3, 2), guessing: cellOf(3, 1), none: cellOf(2, 1) } },
    { questionId: 'b02', text: bankQ('b02').text, level: 'remember', kind: 'truefalse', answers: 21, counts: { sure: cellOf(7, 5), think_so: cellOf(4, 2), guessing: cellOf(3, 2), none: cellOf(7, 5) } },
    { questionId: 'b10', text: 'How confident are you with sliding windows after today?', level: null, kind: 'poll', answers: 1, counts: { sure: cellOf(0, 0), think_so: cellOf(1, 0, 1), guessing: cellOf(0, 0), none: cellOf(0, 0) } },
    { questionId: 'b11', text: 'Which header field lets the receiver put segments back in order?', level: 'remember', kind: 'mcq', answers: 17, counts: { sure: cellOf(2, 1), think_so: cellOf(2, 2), guessing: cellOf(2, 0), none: cellOf(11, 5) } },
  ],
  note: CONF_NOTE,
};
const NO_CONFIDENCE = { ...CONFIDENCE, answers: 0, tapped: 0, counts: { sure: cellOf(0, 0), think_so: cellOf(0, 0), guessing: cellOf(0, 0), none: cellOf(0, 0) }, questions: [] };

/* ---------------------------------------------- the sample server */

/** POST …/class-questions, as the server answers it. */
function sampleAsk(data, info, questionId) {
  const fail = (m) => { throw new Error(m); };
  const blocked = blockedReason(info.status, info.settings?.mode);
  if (blocked) fail(blocked);
  if (list(data.classQuestions).some((c) => c.state !== 'closed')) fail('Another class question is still running in this room. Close it first.');
  const b = bankQ(questionId);
  if (!b || b.status !== 'active') fail('That question is not one this room may serve: pick an approved question of the room\'s own chapter (and of its question set, when it has one).');
  if (list(data.classQuestions).some((c) => c.questionId === questionId)) fail('That question has already been asked to the class in this room. Pick another one.');
  const seq = list(data.classQuestions).length + 1;
  return cqBody(b, { id: `cq-${b._id}-${seq}`, seq, state: 'open', rounds: [openRound(1, 0)], startedAt: new Date().toISOString() });
}

/** POST …/pause, …/revote, …/close, as the server answers them. */
function sampleAct(cq, action, reveal) {
  const b = bankQ(cq.questionId);
  const now = new Date().toISOString();
  const r1 = list(cq.rounds)[0];
  const r2 = list(cq.rounds)[1];
  const lean = (v, share) => (b.kind === 'poll' ? 0 : Math.round(v * share));
  const close1 = (r) => (r.open ? closedRound(b, 1, r.voted, lean(r.voted, 0.45), { changed: Math.min(2, r.voted) }) : r);
  if (action === 'pause') {
    if (cq.state !== 'open') throw new Error('Voting on this question is already paused.');
    return { ...cq, state: 'paused', voting: false, pausedAt: now, rounds: [close1(r1)] };
  }
  if (action === 'revote') {
    if (cq.state !== 'paused') throw new Error('Pause the first vote before opening the re-vote, so the class can discuss it.');
    return { ...cq, state: 'revote', round: 2, voting: true, revoteAt: now, rounds: [r1, openRound(2, 0)] };
  }
  if (cq.state === 'closed') throw new Error('That class question is already closed.');
  if (reveal && b.kind === 'poll') throw new Error('A poll has no right answer to reveal. Close it without revealing.');
  const first = close1(r1);
  const second = r2 ? closedRound(b, 2, r2.voted, lean(r2.voted, 0.75), { changed: Math.min(1, r2.voted) }) : null;
  return {
    ...cq, state: 'closed', voting: false, revealed: reveal === true, closedAt: now, closedBy: 'p1',
    rounds: second ? [first, second] : [first], changes: second ? changesOf(b, first, second) : null,
  };
}

/* ------------------------------------------------------------ frames */

function Frame({ code = CODE, children, title = 'Class question' }) {
  return (
    <AccountShell
      current="console"
      crumb={<span className="clip">Live · <span className="mono">{code}</span> · Computer Networks CS-A</span>}
      title={title}
      sub="One question to every phone, a pause to discuss, a re-vote. Counts only."
      width="wide"
    >
      {children}
    </AccountShell>
  );
}

/**
 * A sample room that answers like the server: asks, pauses, re-votes and
 * closes, with votes arriving while a round is open, as pushes would.
 */
function Sample({ items = [], info = INFO, canControl = true, bank = BANK_STATE, startView = null, askError: firstAskError = '', confidence = CONFIDENCE, ticking = true }) {
  const [data, setData] = useState(() => readOf(items, info));
  const [viewId, setViewId] = useState(startView);
  const [busy, setBusy] = useState('');
  const [askError, setAskError] = useState(firstAskError);
  const [actError, setActError] = useState({ id: null, text: '' });
  const [said, setSaid] = useState('');
  const dataRef = useRef(data);
  dataRef.current = data;

  // While a round is open, a vote arrives every so often until every phone has voted.
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => {
      const run = list(dataRef.current.classQuestions).find((c) => c.state === 'open' || c.state === 'revote');
      if (!run) return;
      const n = run.state === 'open' ? 0 : 1;
      const r = run.rounds[n];
      if (!r?.open || r.voted >= run.phones.joined) return;
      const rounds = run.rounds.map((x, i) => (i === n ? { ...x, voted: x.voted + 1 } : x));
      setData((d) => withBody(d, { ...run, rounds }));
    }, 1400);
    return () => clearInterval(t);
  }, [ticking]);

  async function onAsk(questionId) {
    setBusy('ask');
    setAskError('');
    await wait(500);
    try {
      const body = sampleAsk(dataRef.current, info, questionId);
      setData((d) => withBody(d, body));
      setViewId(null);
      return true;
    } catch (err) {
      setAskError(err.message);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function onAct(cq, action, reveal) {
    setBusy(action);
    setActError({ id: null, text: '' });
    await wait(450);
    try {
      const current = list(dataRef.current.classQuestions).find((c) => c.id === cq.id) ?? cq;
      setData((d) => withBody(d, sampleAct(current, action, reveal)));
    } catch (err) {
      setActError({ id: cq.id, text: err.message });
    } finally {
      setBusy('');
    }
  }

  return (
    <Frame>
      <div className="stack" style={{ gap: 16 }}>
        <ClassQuestionsView
          data={data} load={{ status: 'ready' }} bank={bank} info={info} canControl={canControl}
          viewId={viewId} onView={setViewId} busy={busy} askError={askError} actError={actError}
          onAsk={onAsk} onAct={onAct} onOpenProjector={() => setSaid('Live would now switch to its Projector space.')}
        />
        {said && <p className="t-meta" role="status">Gallery only: {said}</p>}
        {confidence !== false && <RoomConfidenceView data={confidence} onRetry={() => {}} />}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------ the student card */

const LEVELS6 = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'];
const CARD = {
  room: { code: CODE, title: INFO.title, status: 'open', mode: 'devices', classId: INFO.classId },
  student: { rollNo: '21CS07', name: 'Bilal Khan', display: 'Bilal Khan', studentId: '5206aa', onRoster: true, joined: true, attendance: 'present' },
  band: { id: 'developing', label: 'Developing', accuracy: 6 / 13, answers: 13, correct: 6, reason: '6 of 13 graded answers right (46%): Developing.' },
  serving: { level: 'apply', label: 'Apply', reason: '60% at Apply over the last 5 - holding at Apply.', eligible: ['remember', 'understand', 'apply', 'analyse'], ceiling: false, adapt: true },
  levels: LEVELS6.map((l, i) => {
    const mine = [[3, 3], [5, 2], [5, 1], [0, 0], [0, 0], [0, 0]][i];
    const cls = [[41, 31], [96, 49], [38, 21], [14, 6], [0, 0], [0, 0]][i];
    return {
      level: l, label: LABEL[l], answers: mine[0], correct: mine[1], accuracy: mine[0] ? mine[1] / mine[0] : null, withdrawn: 0,
      class: { answers: cls[0], correct: cls[1], accuracy: cls[0] ? cls[1] / cls[0] : null },
    };
  }),
  lastAnswers: {
    items: [
      { answerId: 'a1', level: 'apply', kind: 'mcq', topic: 'Flow control', question: { text: bankQ('b06').text }, correct: true, score: 1, ungraded: false, review: { status: 'auto' }, answeredAt: at(10, 26) },
      { answerId: 'a2', level: 'understand', kind: 'mcq', topic: 'Transmission Control Protocol', question: { text: bankQ('b03').text }, correct: false, score: 0, ungraded: false, review: { status: 'auto' }, answeredAt: at(10, 22) },
    ],
    limit: 10, final: true,
  },
  confidence: { counts: { sure: cellOf(4, 3), think_so: cellOf(3, 1), guessing: cellOf(2, 0), none: cellOf(4, 2) }, choices: CHOICES, note: CONF_NOTE },
  nextSet: null,
  records: { day: '2026-11-19', observation: { current: null, history: [] }, picks: [], privacy: 'Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level.' },
  privacy: 'Staff only. This card is never shown on a phone or the projector.',
};

function CardSample({ card }) {
  const [open, setOpen] = useState(true);
  return (
    <Frame title="Student card">
      <p className="t-meta">The card opens over the console. {open ? '' : <button type="button" className="cq-linkbtn" onClick={() => setOpen(true)}>Open it again</button>}</p>
      {open && <StudentCardView card={card} roll={card.student.rollNo} onClose={() => setOpen(false)} />}
    </Frame>
  );
}

/* ------------------------------------------------------- live only */

/** Not sample data: the real components on a real room of the local server. */
function LiveRoom() {
  const code = (new URLSearchParams(window.location.search).get('room') || 'MP9BRS').toUpperCase();
  const feed = useRoomFeed(code);
  const [info, setInfo] = useState(undefined);
  const [said, setSaid] = useState('');
  useEffect(() => {
    let alive = true;
    api.listSessions().then(
      (res) => { if (alive) setInfo(list(res?.rooms ?? res).find((r) => r.code === code) ?? null); },
      () => { if (alive) setInfo(null); },
    );
    return () => { alive = false; };
  }, [code, feed.roomStatus]);
  return (
    <Frame code={code}>
      <div className="stack" style={{ gap: 16 }}>
        <p className="t-meta">Live only: room <span className="mono">{code}</span> on the local server{feed.wire.live ? ', socket connected' : ', socket not connected'}. Use ?room=CODE for another.</p>
        {info !== undefined && (
          <ClassQuestions
            code={code} canControl={info ? info.canControl !== false : true} info={info}
            pushed={feed.classQuestion} onPushed={feed.setClassQuestion} onOpenProjector={() => setSaid('onOpenProjector()')}
          />
        )}
        {said && <p className="t-meta mono" role="status">Gallery only: {said}</p>}
        <RoomConfidence code={code} />
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------ entries */

export default [
  {
    id: 'ask-first',
    title: 'Class question: nothing asked yet',
    role: 'professor',
    note: 'Choose one of the room’s approved questions and put it to the class. The sample server answers, and votes start arriving.',
    render: () => <Sample key="ask-first" confidence={NO_CONFIDENCE} />,
  },
  {
    id: 'ask-alone',
    title: 'Class question: some phones answered it alone first',
    role: 'professor',
    note: 'Two phones had answered this question on their own and seen its answer: the server’s sentence shows from the start.',
    render: () => <Sample key="ask-alone" items={[POLL, OPEN_ALONE]} />,
  },
  {
    id: 'ask-open',
    title: 'Class question: first vote open',
    role: 'professor',
    note: 'Only how many of the nine phones have voted, never what. Votes keep arriving; pause, re-vote and close all work.',
    render: () => <Sample key="ask-open" items={[POLL, OPEN]} />,
  },
  {
    id: 'ask-paused',
    title: 'Class question: paused to discuss',
    role: 'professor',
    note: 'The first vote’s spread, the share right with its count, and the taps by right and wrong. Open the re-vote from here.',
    render: () => <Sample key="ask-paused" items={[POLL, PAUSED]} ticking={false} />,
  },
  {
    id: 'ask-revote',
    title: 'Class question: re-vote open',
    role: 'professor',
    note: 'The first vote stays on screen; the re-vote shows only how many have voted again. Close it with or without the key.',
    render: () => <Sample key="ask-revote" items={[POLL, REVOTE]} />,
  },
  {
    id: 'ask-closed',
    title: 'Class question: closed, key shown',
    role: 'professor',
    note: 'Before and after side by side, the share right each time, and the five changes, as counts.',
    render: () => <Sample key="ask-closed" items={[POLL, CLOSED]} ticking={false} />,
  },
  {
    id: 'ask-poll',
    title: 'Class question: a poll, closed',
    role: 'professor',
    note: 'No right answer: kept and changed instead of the five changes, the taps without right and wrong.',
    render: () => <Sample key="ask-poll" items={[POLL, CLOSED]} startView="cq-b05" ticking={false} />,
  },
  {
    id: 'ask-multi',
    title: 'Class question: choose-all, closed after the first vote',
    role: 'professor',
    note: 'Each tick counted on its option, one vote that picked nothing, no re-vote, key not shown.',
    render: () => <Sample key="ask-multi" items={[POLL, CLOSED, MULTI]} ticking={false} />,
  },
  {
    id: 'ask-refused',
    title: 'Class question: the server refuses',
    role: 'professor',
    note: 'The server’s sentence as it came. Try putting the poll to the class again: the sample server refuses it the same way.',
    render: () => <Sample key="ask-refused" items={[POLL]} askError="That question has already been asked to the class in this room. Pick another one." confidence={false} />,
  },
  {
    id: 'ask-paused-room',
    title: 'Class question: the room is paused',
    role: 'professor',
    note: 'Nothing can be asked while the room is paused; the line says why, in the server’s words.',
    render: () => <Sample key="ask-paused-room" items={[POLL]} info={{ ...INFO, status: 'paused' }} confidence={false} />,
  },
  {
    id: 'ask-teacher-led',
    title: 'Class question: a Teacher-led room',
    role: 'professor',
    note: 'No phone answers in a Teacher-led room, so a class question would have nobody to vote.',
    render: () => <Sample key="ask-teacher-led" info={{ ...INFO, settings: { ...INFO.settings, mode: 'teacher-led' } }} confidence={false} />,
  },
  {
    id: 'ask-hod',
    title: 'Class question: a head of department reading',
    role: 'hod',
    note: 'Read only: the running question and its counts, no buttons, no composer.',
    render: () => <Sample key="ask-hod" items={[POLL, REVOTE]} canControl={false} />,
  },
  {
    id: 'ask-loading',
    title: 'Class question: reading',
    role: 'professor',
    note: 'The shapes drawn while the first read is out.',
    render: () => (
      <Frame>
        <div className="stack" style={{ gap: 16 }}>
          <ClassQuestionsView data={null} load={{ status: 'loading' }} canControl />
          <RoomConfidenceView data={null} loading />
        </div>
      </Frame>
    ),
  },
  {
    id: 'ask-confidence',
    title: 'Confidence counts: the room',
    role: 'professor',
    note: 'GET …/confidence: by tap, right and wrong, then each question. Counts only, never a student.',
    render: () => <Frame key="ask-confidence" title="Confidence"><RoomConfidenceView data={CONFIDENCE} onRetry={() => {}} /></Frame>,
  },
  {
    id: 'ask-card',
    title: 'Student card: how sure they said they were',
    role: 'professor',
    note: 'The card’s confidence counts: a section of their own, never beside an answer, never a label.',
    render: () => <CardSample key="ask-card" card={CARD} />,
  },
  {
    id: 'ask-live',
    title: 'Live only: a real room on the local server',
    role: 'professor',
    note: 'Not sample data. Reads and drives ?room=CODE (default MP9BRS) on :5050, with the socket’s pushes. Development only.',
    render: () => <LiveRoom key="ask-live" />,
  },
];
