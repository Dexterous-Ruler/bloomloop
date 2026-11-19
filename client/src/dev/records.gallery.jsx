/**
 * Teacher records, drawn from sample data. Development only.
 *
 * One class, Computer Networks CS-A: 25 on the roster for the wheel and the
 * tally (22 marked present), 40 for the observations, in the shapes of the
 * records reads in docs/API.md ("Phase 3: the teacher-record store"). The
 * figures agree with each other: "N picked of M" with the picks, "N of M
 * present responded" with the hands, the observation counts with the marks.
 *
 * Nothing here talks to the server. The two entries that move (a draw, a
 * count) stand in for the server with the server's own rules: the stand-in
 * draws, then the ring walks to what it drew, exactly as the real screen walks
 * to the server's pick.
 */

import { useState } from 'react';

import AccountShell from '../shell/AccountShell.jsx';
import { ActivitiesView } from '../teach/Activities.jsx';
import { ObserveView, keyOf } from '../teach/Observe.jsx';
import { RecordsLayout } from '../teach/Records.jsx';
import { TallyView } from '../teach/Tally.jsx';
import { WheelView, ringOf } from '../teach/Wheel.jsx';

/* ------------------------------------------------------------------ sample */

const PRIVACY = 'Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level.';
const CODE = 'K7Q2WD';
const DAY = '2026-11-19';
/** h:m in India's time (UTC+5:30), as an ISO stamp. */
const at = (h, m) => new Date(Date.UTC(2026, 10, 19, h, m) - 330 * 60_000).toISOString();
const ROOM = { code: CODE, title: 'Computer Networks - Unit 4: The Transport Layer', startedAt: at(10, 0), status: 'open', classId: 'c0ffee000000000000000001' };

const NAMES = [
  'Aarav Shah', 'Aditi Rao', 'Ananya Iyer', 'Arjun Patil', 'Ishaan Kulkarni', 'Kavya Nair', 'Rohan Deshmukh', 'Sneha Joshi',
  'Vihaan Mehta', 'Diya Kapoor', 'Aryan Gupta', 'Meera Pillai', 'Kabir Singh', 'Saanvi Reddy', 'Yash Pawar', 'Tanvi Bhosale',
  'Om Jadhav', 'Riya Sharma', 'Neel Chavan', 'Pooja Gaikwad', 'Harsh Vora', 'Nisha Menon', 'Aditya Kale', 'Shruti Banerjee',
  'Varun Thakur', 'Zoya Qureshi', 'Siddharth Rane', 'Gauri Sawant', 'Pranav Hegde', 'Ira Mukherjee', 'Dev Malhotra', 'Anika Bose',
  'Rahul Naik', 'Leela Krishnan', 'Farhan Sheikh', 'Mitali Dubey', 'Kunal Bhatt', 'Esha Varma', 'Tejas More', 'Prisha Ghosh',
];
const hex = (i) => `5e1f${String(i + 1).padStart(20, '0')}`;
const ROSTER = NAMES.map((name, i) => ({ studentId: hex(i), rollNo: `23CS${String(i + 1).padStart(2, '0')}`, name }));
const CLASS = ROSTER.slice(0, 25);
const AWAY = new Set(['23CS04', '23CS12', '23CS20']);
const PRESENT = CLASS.filter((s) => !AWAY.has(s.rollNo));
const who = (roll) => ROSTER.find((s) => s.rollNo === roll);

const QUESTIONS = [
  { questionId: 'q01', bloom: 'remember', kind: 'mcq', text: 'Which layer of the TCP/IP model does TCP belong to?' },
  { questionId: 'q02', bloom: 'remember', kind: 'mcq', text: 'Which protocol is connectionless: TCP, SCTP, UDP or QUIC over TLS?' },
  { questionId: 'q03', bloom: 'understand', kind: 'mcq', text: 'Why does TCP number every byte it sends rather than every segment?' },
  { questionId: 'q04', bloom: 'understand', kind: 'truefalse', text: 'True or false: a UDP checksum lets the receiver repair a corrupted segment.' },
  { questionId: 'q05', bloom: 'apply', kind: 'numeric', text: 'A sender has 4 KB unacknowledged and the receive window is 10 KB. How much more may it send?' },
  { questionId: 'q06', bloom: 'analyse', kind: 'multi', text: 'Choose every reason the throughput fell after the third duplicate acknowledgement in this trace.' },
  { questionId: 'q07', bloom: 'evaluate', kind: 'open', text: 'Should a video call use TCP or UDP? Weigh the delay against the loss.' },
];
const QS = { status: 'ready', list: QUESTIONS, error: '', load: () => {} };
const qOf = (id) => QUESTIONS.find((q) => q.questionId === id);

/* ------------------------------------------------------------------ wheel */

const ASKS = [
  { id: 'bank', label: 'Bank', hint: 'A question from the room\'s bank.' },
  { id: 'diagram', label: 'Diagram', hint: 'Ask them to explain the diagram on the projector, one step at a time.' },
  { id: 'demo', label: 'Demo', hint: 'Ask them to work it through on the board while the class follows.' },
];
const STATUSES = [
  { id: 'answered', label: 'Answered' }, { id: 'passed', label: 'Passed to partner' }, { id: 'help', label: 'Needs help' },
  { id: 'skipped', label: 'Skipped' }, { id: 'absent', label: 'Absent' },
];
const statusLabel = (s) => (s === 'pending' ? 'Pending' : STATUSES.find((x) => x.id === s)?.label ?? s);

function mkPick({ id, round, order, roll, poolSize, ask = 'bank', questionId = null, status = 'pending', when }) {
  const s = who(roll);
  const q = questionId ? qOf(questionId) : null;
  return {
    id, round, order, rollNo: roll, name: s?.name ?? '', classStudentId: s?.studentId ?? null, poolSize,
    presentOnly: true, noRepeat: true, ask, askLabel: ASKS.find((a) => a.id === ask)?.label ?? ask,
    questionId, question: q ? { text: q.text, bloom: q.bloom, kind: q.kind } : null,
    status, statusLabel: statusLabel(status), pickedAt: when, pickedBy: null,
    statusAt: status === 'pending' ? null : when, statusBy: null,
  };
}

const EMPTY_REASON = {
  nobody: 'Nobody in this class is marked present, so the wheel is empty. Mark attendance, or turn off present only.',
  done: 'Everyone on the wheel has had a turn this round. Start a new round, or turn off no repeats.',
};

/** The wheel read, worked out the way the server works it out. */
function wheelBody({ present = PRESENT, round = 1, presentOnly = true, noRepeat = true, picks = [], status = 'open' } = {}) {
  const base = presentOnly ? present : CLASS;
  const thisRound = picks.filter((p) => p.round === round);
  const had = new Set(thisRound.map((p) => p.rollNo));
  const eligible = noRepeat ? base.filter((s) => !had.has(s.rollNo)) : base;
  const picked = base.filter((s) => had.has(s.rollNo)).length;
  return {
    room: { ...ROOM, status },
    round: { number: round, started: picks.length > 0 || round > 1, startedAt: at(10, 2), presentOnly, noRepeat, picks: thisRound.length },
    pool: {
      total: base.length, left: eligible.length, picked, summary: `${picked} picked of ${base.length}`,
      onWheel: eligible.map(({ rollNo, name }) => ({ rollNo, name })),
      empty: eligible.length ? null : base.length ? EMPTY_REASON.done : EMPTY_REASON.nobody,
    },
    rounds: Array.from({ length: round }, (_, i) => ({ number: i + 1, startedAt: at(10, 2 + i * 20), presentOnly, noRepeat })),
    picks,
    asks: ASKS,
    statuses: STATUSES,
    privacy: PRIVACY,
  };
}

const ROUND1 = [
  mkPick({ id: 'p1', round: 1, order: 1, roll: '23CS07', poolSize: 22, questionId: 'q01', status: 'answered', when: at(10, 4) }),
  mkPick({ id: 'p2', round: 1, order: 2, roll: '23CS15', poolSize: 21, questionId: 'q03', status: 'help', when: at(10, 9) }),
  mkPick({ id: 'p3', round: 1, order: 3, roll: '23CS02', poolSize: 20, ask: 'diagram', status: 'answered', when: at(10, 14) }),
];
const ROUND2 = [
  mkPick({ id: 'p4', round: 2, order: 1, roll: '23CS22', poolSize: 22, ask: 'demo', status: 'passed', when: at(10, 24) }),
  mkPick({ id: 'p5', round: 2, order: 2, roll: '23CS09', poolSize: 21, questionId: 'q05', status: 'answered', when: at(10, 31) }),
];
const LATER = [...ROUND1, ...ROUND2];

/** A wheel that moves: the sample server draws, the ring walks to its pick. */
function WheelDemo({ initial, canControl = true, closed = false, classRoom = true, error: firstError = '', outcome: firstOutcome = {} }) {
  const [wheel, setWheel] = useState(initial);
  const [spin, setSpin] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(firstError);
  const [outcome, setOutcome] = useState(firstOutcome);
  const [markAbsent, setMarkAbsent] = useState(true);
  const [settings, setSettings] = useState({ round: initial.round.number, presentOnly: initial.round.presentOnly, noRepeat: initial.round.noRepeat, present: PRESENT });

  const rebuild = (next, picks) => wheelBody({ present: next.present, round: next.round, presentOnly: next.presentOnly, noRepeat: next.noRepeat, picks, status: initial.room.status });

  function draw() {
    if (!wheel.pool.left) { setError(wheel.pool.empty); return; }
    const pool = wheel.pool.onWheel;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const chosen = pool[buf[0] % pool.length];
    const thisRound = wheel.picks.filter((p) => p.round === settings.round);
    const pick = mkPick({ id: `d${Date.now()}`, round: settings.round, order: thisRound.length + 1, roll: chosen.rollNo, poolSize: pool.length, when: new Date().toISOString() });
    setSpin({ ring: ringOf(wheel), pick });
    setWheel(rebuild(settings, [...wheel.picks, pick]));
    setSelectedId(pick.id);
    setError('');
  }
  function setting(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setWheel(rebuild(next, wheel.picks));
    setError('');
  }
  function newRound() {
    const next = { ...settings, round: settings.round + 1 };
    setSettings(next);
    setWheel(rebuild(next, wheel.picks));
    setError('');
  }
  function pick(id, patch) {
    const picks = wheel.picks.map((p) => {
      if (p.id !== id) return p;
      const ask = patch.ask ?? p.ask;
      const questionId = ask !== 'bank' ? null : patch.questionId !== undefined ? patch.questionId : p.questionId;
      return mkPick({ ...p, roll: p.rollNo, when: p.pickedAt, ask, questionId, status: patch.status ?? p.status });
    });
    let next = settings;
    if (patch.status === 'absent' && patch.markAttendance !== false && classRoom) {
      const roll = wheel.picks.find((p) => p.id === id)?.rollNo;
      next = { ...settings, present: settings.present.filter((s) => s.rollNo !== roll) };
      setSettings(next);
      setOutcome((o) => ({ ...o, [id]: { marked: true, status: 'absent', studentId: who(roll)?.studentId } }));
    } else if (patch.status === 'absent' && !classRoom) {
      setOutcome((o) => ({ ...o, [id]: { marked: false, reason: 'This room was opened for no class, so it has no attendance to mark.' } }));
    } else if (patch.status) {
      setOutcome((o) => ({ ...o, [id]: null }));
    }
    setWheel(rebuild(next, picks));
  }

  return (
    <WheelView
      wheel={wheel}
      load={{ status: 'ready' }}
      canControl={canControl}
      closed={closed}
      classRoom={classRoom}
      error={error}
      spin={spin}
      onLanded={() => setSpin(null)}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onDraw={draw}
      onRound={newRound}
      onSetting={setting}
      onPick={pick}
      outcome={outcome}
      markAbsent={markAbsent}
      onMarkAbsent={setMarkAbsent}
      questions={QS}
    />
  );
}

/* ------------------------------------------------------------------ tally */

const KEYS = ['A', 'B', 'C', 'D'];
function tallySummary(total, present) {
  if (!present) return `${total} responded (nobody is marked present)`;
  if (total > present) return `${total} responded, more than the ${present} marked present`;
  return `${total} of ${present} present responded`;
}
function mkTally({ id, seq, questionId = null, text, labels, counts, correct = null, revealed = false, present = PRESENT.length, when }) {
  const total = counts.reduce((a, b) => a + b, 0);
  return {
    id, seq, questionId, text,
    options: KEYS.map((key, i) => ({ key, label: labels[i] ?? '', count: counts[i], correct: correct === null ? null : correct === i })),
    total, revealed, correct: correct === null ? null : KEYS[correct], present, summary: tallySummary(total, present),
    createdAt: when, createdBy: null, updatedAt: when,
  };
}
const TALLIES = [
  mkTally({ id: 't1', seq: 1, questionId: 'q01', text: 'Which layer of the TCP/IP model does TCP belong to?', labels: ['Application', 'Transport', 'Internet', 'Link'], counts: [2, 17, 2, 0], correct: 1, revealed: true, when: at(10, 6) }),
  mkTally({ id: 't2', seq: 2, text: 'Which of these does UDP give you that TCP does not?', labels: ['Ordered delivery', 'Lower delay', 'Flow control', 'Retransmission'], counts: [3, 9, 4, 2], correct: 1, when: at(10, 18) }),
  mkTally({ id: 't3', seq: 3, text: 'A receiver advertises a window of 0. What does the sender do next?', labels: ['Stops and probes', 'Sends at half rate', 'Closes the connection', ''], counts: [11, 6, 2, 0], correct: 0, when: at(10, 27) }),
];
const TALLY_BODY = { room: ROOM, present: PRESENT.length, tallies: TALLIES, privacy: PRIVACY };

function TallyDemo({ data: first, canControl = true, composer, startFlash = null }) {
  const [data, setData] = useState(first);
  const [openId, setOpenId] = useState(null);
  const [flash, setFlash] = useState(startFlash);
  const put = (t) => setData((d) => ({ ...d, tallies: d.tallies.map((x) => (x.id === t.id ? t : x)) }));
  const rebuild = (t, patch) => mkTally({
    id: t.id, seq: t.seq, questionId: t.questionId, text: t.text, labels: t.options.map((o) => o.label), when: t.createdAt,
    counts: patch.counts ?? t.options.map((o) => o.count),
    correct: patch.correct !== undefined ? (patch.correct ? KEYS.indexOf(patch.correct) : null) : t.correct ? KEYS.indexOf(t.correct) : null,
    revealed: patch.revealed ?? t.revealed,
  });

  function step(t, key, dir) {
    const counts = t.options.map((o) => o.count);
    const i = KEYS.indexOf(key);
    if (dir < 0 && counts[i] <= 0) { setFlash({ id: t.id, text: `${key} is already at 0, so nothing changed.` }); return; }
    counts[i] += dir;
    put(rebuild(t, { counts }));
    setFlash(null);
  }
  function create(body) {
    const q = body.questionId ? qOf(body.questionId) : null;
    const t = mkTally({
      id: `t${Date.now()}`, seq: data.tallies.length + 1, questionId: body.questionId ?? null, text: q?.text ?? body.text,
      labels: body.labels ?? ['', '', '', ''], counts: [0, 0, 0, 0], correct: body.correct ? KEYS.indexOf(body.correct) : null, when: new Date().toISOString(),
    });
    setData((d) => ({ ...d, tallies: [...d.tallies, t] }));
    setOpenId(t.id);
    return Promise.resolve(true);
  }

  return (
    <TallyView
      data={data}
      load={{ status: 'ready' }}
      canControl={canControl}
      openId={openId}
      onOpen={setOpenId}
      pending={{}}
      error={composer?.error ?? ''}
      flash={flash}
      onStep={step}
      onPatch={(id, patch) => put(rebuild(data.tallies.find((t) => t.id === id), patch))}
      onCreate={create}
      questions={QS}
      composer={composer}
    />
  );
}

/* ------------------------------------------------------------------ observations */

const KINDS = [
  { id: 'understood', label: 'Understood' }, { id: 'participated', label: 'Participated' },
  { id: 'revision', label: 'Needs revision' }, { id: 'support', label: 'Needs additional support' },
];
const kindLabel = (k) => KINDS.find((x) => x.id === k)?.label ?? null;
const ev = (id, kind, note, when, room = CODE) => ({ id, kind, label: kindLabel(kind), note, observedAt: when, observedBy: null, room });

const MARKS = {
  '23CS01': [ev('o1', 'participated', '', at(10, 12))],
  '23CS02': [ev('o2', 'understood', 'Talked the class through the three-way handshake on the board', at(10, 15))],
  '23CS05': [ev('o3', 'revision', '', at(9, 20), 'H3MZ8P')],
  '23CS07': [ev('o4', 'understood', '', at(10, 5))],
  '23CS09': [ev('o5', 'understood', 'Worked out the window sum without help', at(10, 32))],
  '23CS13': [ev('o6', 'understood', '', at(10, 16)), ev('o7', null, '', at(10, 19)), ev('o8', 'participated', 'Asked why sequence numbers count bytes', at(10, 21))],
  '23CS15': [ev('o9', 'support', 'Mixed up flow control and congestion control twice', at(10, 10))],
  '23CS18': [ev('o10', 'participated', '', at(10, 22))],
  '23CS22': [ev('o11', 'participated', '', at(10, 25))],
  '23CS26': [ev('o12', 'revision', '', at(10, 28))],
  '23CS30': [ev('o13', 'understood', '', at(10, 33))],
  '23CS33': [ev('o14', 'revision', 'Ask about retransmission timers next time', at(10, 35))],
  '23CS37': [ev('o15', 'participated', '', at(10, 36))],
};

function obsBody({ roster = ROSTER, marks = MARKS, klass = true, removed = [] } = {}) {
  const students = [...roster.map((s) => ({ ...s, active: true })), ...removed.map((s) => ({ ...s, active: false }))]
    .map((s) => {
      const history = marks[s.rollNo] ?? [];
      const last = history.at(-1);
      return { studentId: klass ? s.studentId : null, rollNo: s.rollNo, name: s.name, active: s.active, current: last?.kind ? last : null, history };
    });
  const counts = { understood: 0, participated: 0, revision: 0, support: 0, observed: 0, students: 0 };
  for (const s of students) {
    if (!s.active) continue;
    counts.students += 1;
    if (s.current) { counts[s.current.kind] += 1; counts.observed += 1; }
  }
  return {
    room: { ...ROOM, classId: klass ? ROOM.classId : null },
    class: klass ? { id: ROOM.classId, courseName: 'Computer Networks', section: 'CS-A', termLabel: 'Odd term 2026' } : null,
    day: DAY, kinds: KINDS, students, counts, privacy: PRIVACY,
  };
}

function ObserveDemo({ data: first, canControl = true, rowState: firstRows = {}, initialOpen = null }) {
  const [data, setData] = useState(first);
  const [rowState, setRowState] = useState(firstRows);
  function send(s, kind, note) {
    const key = keyOf(s);
    const hasContact = /@|\d{6,}/.test(note ?? '');
    if (hasContact) {
      setRowState((r) => ({ ...r, [key]: { busy: false, error: 'note holds an email address or a phone number; teacher records keep neither.' } }));
      return Promise.resolve(false);
    }
    const e = ev(`n${Date.now()}`, kind, kind ? note ?? '' : '', new Date().toISOString());
    const marks = { ...Object.fromEntries(data.students.map((x) => [x.rollNo, x.history])), [s.rollNo]: [...(s.history ?? []), e] };
    setData(obsBody({ roster: data.students.filter((x) => x.active).map((x) => ({ ...x, studentId: x.studentId ?? x.rollNo })), marks, klass: Boolean(data.class) }));
    setRowState((r) => ({ ...r, [key]: { busy: false, error: '' } }));
    return Promise.resolve(true);
  }
  return (
    <ObserveView
      data={data}
      load={{ status: 'ready' }}
      code={CODE}
      canControl={canControl}
      rowState={rowState}
      onMark={(s, kind) => send(s, kind, kind ? s.current?.note ?? '' : undefined)}
      onNote={(s, note) => send(s, s.current?.kind, note)}
      initialOpen={initialOpen}
    />
  );
}

const PHONES = [
  { rollNo: '21CS003', name: 'Asha' }, { rollNo: '21CS007', name: 'Bilal K' }, { rollNo: '21CS011', name: 'chaitanya' },
  { rollNo: '21CS014', name: 'Divya R' }, { rollNo: '21CS019', name: '' }, { rollNo: '21CS022', name: 'Faizan' },
];

/* ------------------------------------------------------------------ activities */

const ACT_KINDS = [
  { id: 'check', label: 'Quick knowledge check' }, { id: 'think', label: 'Think and explain' }, { id: 'group', label: 'Group challenge' },
  { id: 'diagram', label: 'Explain the diagram' }, { id: 'real', label: 'Real-world application' },
];
const RESULTS = [{ id: 'yes', label: 'Got it' }, { id: 'partly', label: 'Partly' }, { id: 'no', label: 'Not yet' }];
const resultOf = (id) => RESULTS.find((r) => r.id === id)?.label ?? id;
const mkAct = ({ id, seq, kind, outcome = '', groups = [], tallyId = null, when }) => ({
  id, seq, kind, label: ACT_KINDS.find((k) => k.id === kind)?.label ?? kind, outcome,
  groups: groups.map(([label, gotIt]) => ({ label, gotIt, result: resultOf(gotIt) })), tallyId, createdAt: when, createdBy: null, updatedAt: when,
});
const ACTS = [
  mkAct({ id: 'a1', seq: 1, kind: 'check', outcome: 'Most knew TCP is transport; two said internet.', tallyId: 't1', when: at(10, 7) }),
  mkAct({ id: 'a2', seq: 2, kind: 'think', outcome: 'Thirty seconds, then the wheel. Rohan explained byte numbering clearly.', when: at(10, 12) }),
  mkAct({
    id: 'a3', seq: 3, kind: 'group', outcome: 'Most benches found the window sum; the back two needed a hint.',
    groups: [['Bench 1', 'yes'], ['Bench 2', 'yes'], ['Bench 3', 'partly'], ['Bench 4', 'yes'], ['Bench 5', 'no'], ['Bench 6', 'partly']],
    when: at(10, 30),
  }),
  mkAct({ id: 'a4', seq: 4, kind: 'real', when: at(10, 38) }),
];
const ACT_BODY = { room: ROOM, kinds: ACT_KINDS, results: RESULTS, activities: ACTS, privacy: PRIVACY };
const TALLY_LIST = { status: 'ready', list: TALLIES, error: '' };

function ActivitiesDemo({ data: first, canControl = true, initialDraft = null, initialEdit = null, error = { for: '', message: '' } }) {
  const [data, setData] = useState(first);
  const create = (body) => {
    const g = (body.groups ?? []).map((x) => [x.label, x.gotIt]);
    setData((d) => ({ ...d, activities: [...d.activities, mkAct({ id: `a${Date.now()}`, seq: d.activities.length + 1, kind: body.kind, outcome: body.outcome, groups: g, tallyId: body.tallyId ?? null, when: new Date().toISOString() })] }));
    return Promise.resolve(true);
  };
  const update = (id, patch) => {
    setData((d) => ({
      ...d,
      activities: d.activities.map((a) => (a.id !== id ? a : mkAct({
        ...a, when: a.createdAt, outcome: patch.outcome ?? a.outcome, tallyId: patch.tallyId !== undefined ? patch.tallyId : a.tallyId,
        groups: (patch.groups ?? a.groups).map((x) => [x.label, x.gotIt]),
      }))),
    }));
    return Promise.resolve(true);
  };
  return (
    <ActivitiesView
      data={data}
      load={{ status: 'ready' }}
      canControl={canControl}
      tallies={TALLY_LIST}
      error={error}
      onCreate={create}
      onUpdate={update}
      onNeedTallies={() => {}}
      initialDraft={initialDraft}
      initialEdit={initialEdit}
    />
  );
}

/* ------------------------------------------------------------------ frame */

const DEFAULTS = {
  wheel: (canControl) => <WheelDemo initial={wheelBody({ round: 2, picks: LATER })} canControl={canControl} />,
  tally: (canControl) => <TallyDemo data={TALLY_BODY} canControl={canControl} />,
  observe: (canControl) => <ObserveDemo data={obsBody()} canControl={canControl} />,
  activities: (canControl) => <ActivitiesDemo data={ACT_BODY} canControl={canControl} />,
};

/** The console page around the records, as Live hosts them under "In the room". */
function Sample({ tab: first, canControl = true, children }) {
  const [tab, setTab] = useState(first);
  return (
    <AccountShell
      current="console"
      crumb={<span className="clip">Live · <span className="mono">{CODE}</span> · Computer Networks CS-A</span>}
      title="In the room"
      sub="Teacher-led: no phones today. The wheel, raised hands, observations and activities."
    >
      <RecordsLayout tab={tab} onTab={setTab} canControl={canControl}>
        {tab === first ? children : DEFAULTS[tab](canControl)}
      </RecordsLayout>
    </AccountShell>
  );
}


/* ------------------------------------------------------------------ entries */

export default [
  {
    id: 'records-wheel',
    title: 'Wheel, ready to draw',
    role: 'professor',
    note: 'Round 1, 22 present of 25, nothing drawn. Draw works: the sample server picks, the ring walks to its pick.',
    render: () => <Sample tab="wheel"><WheelDemo initial={wheelBody()} /></Sample>,
  },
  {
    id: 'records-wheel-round',
    title: 'Wheel, second round under way',
    role: 'professor',
    note: 'Two picked of 22 this round, dimmed on the ring. The latest pick was asked a bank question and answered.',
    render: () => <Sample tab="wheel"><WheelDemo initial={wheelBody({ round: 2, picks: LATER })} /></Sample>,
  },
  {
    id: 'records-wheel-absent',
    title: 'Wheel, a pick marked absent',
    role: 'professor',
    note: 'Absent also marked the student absent in attendance, so they left the wheel: 21 present now.',
    render: () => {
      const picks = [...ROUND1, mkPick({ id: 'p6', round: 1, order: 4, roll: '23CS18', poolSize: 19, status: 'absent', when: at(10, 20) })];
      const present = PRESENT.filter((s) => s.rollNo !== '23CS18');
      return <Sample tab="wheel"><WheelDemo initial={wheelBody({ present, picks })} outcome={{ p6: { marked: true, status: 'absent', studentId: who('23CS18').studentId } }} /></Sample>;
    },
  },
  {
    id: 'records-wheel-empty',
    title: 'Wheel, nobody marked present',
    role: 'professor',
    note: 'A Teacher-led room before attendance: the server’s reason, and Draw is off.',
    render: () => <Sample tab="wheel"><WheelDemo initial={wheelBody({ present: [] })} /></Sample>,
  },
  {
    id: 'records-wheel-409',
    title: 'Wheel, everyone has had a turn',
    role: 'professor',
    note: 'The draw came back 409 with the reason; New round or turning off no repeats fills it again.',
    render: () => {
      const picks = PRESENT.map((s, i) => mkPick({ id: `f${i}`, round: 1, order: i + 1, roll: s.rollNo, poolSize: PRESENT.length - i, status: i % 4 ? 'answered' : 'passed', when: at(10, 2 + i) }));
      return <Sample tab="wheel"><WheelDemo initial={wheelBody({ picks })} error={EMPTY_REASON.done} /></Sample>;
    },
  },
  {
    id: 'records-wheel-closed',
    title: 'Wheel, room closed',
    role: 'professor',
    note: 'No more draws; the picks can still be filled in after the class.',
    render: () => <Sample tab="wheel"><WheelDemo initial={wheelBody({ picks: ROUND1, status: 'closed' })} closed /></Sample>,
  },
  {
    id: 'records-wheel-hod',
    title: 'Wheel, read by a head of department',
    role: 'hod',
    note: 'canControl false: no Draw, no switches, the responses as text.',
    render: () => <Sample tab="wheel" canControl={false}><WheelDemo initial={wheelBody({ round: 2, picks: LATER })} canControl={false} /></Sample>,
  },
  {
    id: 'records-wheel-loading',
    title: 'Wheel, first read',
    role: 'professor',
    note: 'The read has not answered: the shaped skeleton.',
    render: () => <Sample tab="wheel"><WheelView wheel={null} load={{ status: 'loading' }} canControl /></Sample>,
  },
  {
    id: 'records-tally',
    title: 'Raised hands, counting',
    role: 'professor',
    note: 'Three questions asked aloud; the latest open. + and - work; - at 0 says nothing changed.',
    render: () => <Sample tab="tally"><TallyDemo data={TALLY_BODY} /></Sample>,
  },
  {
    id: 'records-tally-revealed',
    title: 'Raised hands, answer revealed',
    role: 'professor',
    note: 'A bank question, its key revealed: the correct option named and in green.',
    render: () => <Sample tab="tally"><TallyDemo data={{ ...TALLY_BODY, tallies: [...TALLIES.slice(1), TALLIES[0]] }} startFlash={{ id: 't1', text: 'D is already at 0, so nothing changed.' }} /></Sample>,
  },
  {
    id: 'records-tally-empty',
    title: 'Raised hands, nothing asked yet',
    role: 'professor',
    render: () => <Sample tab="tally"><TallyDemo data={{ ...TALLY_BODY, tallies: [] }} /></Sample>,
  },
  {
    id: 'records-tally-refused',
    title: 'Raised hands, a phone number refused',
    role: 'professor',
    note: 'The server refused a typed question with a number in it; its sentence as it came.',
    render: () => (
      <Sample tab="tally">
        <TallyDemo
          data={{ ...TALLY_BODY, tallies: [] }}
          composer={{ key: 'refused', source: 'typed', draft: { text: 'Call me on 98450 12345 if the lab is locked', labels: ['', '', '', ''], correct: '' }, error: 'text holds an email address or a phone number; teacher records keep neither.' }}
        />
      </Sample>
    ),
  },
  {
    id: 'records-tally-hod',
    title: 'Raised hands, read only',
    role: 'hod',
    render: () => <Sample tab="tally" canControl={false}><TallyDemo data={TALLY_BODY} canControl={false} /></Sample>,
  },
  {
    id: 'records-observe',
    title: 'Observations, a class of 40',
    role: 'professor',
    note: 'Thirteen marked; one set in another room of the class today; one with a note and its log open.',
    render: () => <Sample tab="observe"><ObserveDemo data={obsBody()} initialOpen={`s:${who('23CS13').studentId}`} /></Sample>,
  },
  {
    id: 'records-observe-refused',
    title: 'Observations, a note refused',
    role: 'professor',
    note: 'A note with an email address in it is a 400; the row shows the server’s sentence.',
    render: () => (
      <Sample tab="observe">
        <ObserveDemo
          data={obsBody()}
          initialOpen={`s:${who('23CS15').studentId}`}
          rowState={{ [`s:${who('23CS15').studentId}`]: { busy: false, error: 'note holds an email address or a phone number; teacher records keep neither.' } }}
        />
      </Sample>
    ),
  },
  {
    id: 'records-observe-noclass',
    title: 'Observations, a room with no class',
    role: 'professor',
    note: 'The phones that joined, by roll number, with the names they typed.',
    render: () => <Sample tab="observe"><ObserveDemo data={obsBody({ roster: PHONES, marks: { '21CS007': [ev('x1', 'participated', '', at(10, 9))] }, klass: false })} /></Sample>,
  },
  {
    id: 'records-observe-hod',
    title: 'Observations, read only',
    role: 'hod',
    render: () => <Sample tab="observe" canControl={false}><ObserveDemo data={obsBody({ removed: [ROSTER[39]] })} canControl={false} /></Sample>,
  },
  {
    id: 'records-observe-loading',
    title: 'Observations, first read',
    role: 'professor',
    render: () => <Sample tab="observe"><ObserveView data={null} load={{ status: 'loading' }} canControl /></Sample>,
  },
  {
    id: 'records-activities',
    title: 'Activities, four recorded',
    role: 'professor',
    note: 'A quick check linked to its tally, a group challenge by bench, one with no outcome yet; a group challenge being recorded.',
    render: () => <Sample tab="activities"><ActivitiesDemo data={ACT_BODY} initialDraft="group" /></Sample>,
  },
  {
    id: 'records-activities-edit',
    title: 'Activities, changing a group challenge',
    role: 'professor',
    note: 'Its groups and outcome change; its kind stays what was run.',
    render: () => <Sample tab="activities"><ActivitiesDemo data={ACT_BODY} initialEdit="a3" /></Sample>,
  },
  {
    id: 'records-activities-empty',
    title: 'Activities, none yet',
    role: 'professor',
    render: () => <Sample tab="activities"><ActivitiesDemo data={{ ...ACT_BODY, activities: [] }} /></Sample>,
  },
  {
    id: 'records-activities-hod',
    title: 'Activities, read only',
    role: 'hod',
    render: () => <Sample tab="activities" canControl={false}><ActivitiesDemo data={ACT_BODY} canControl={false} /></Sample>,
  },
  {
    id: 'records-failed',
    title: 'A read that failed',
    role: 'professor',
    note: 'The server’s 404 sentence for a room that is not there (or not yours), and a retry.',
    render: () => <Sample tab="wheel"><WheelView wheel={null} load={{ status: 'error', error: 'That room was not found.' }} onRetry={() => {}} canControl /></Sample>,
  },
];
