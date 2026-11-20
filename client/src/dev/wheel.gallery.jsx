/**
 * The wheel (Batch 9, E6), drawn from sample data. Development only.
 *
 * One class of 60, cut to the size each entry needs: 10 and 30 on a wheel, 60
 * on the reel (past 30 a wheel is slivers). Draw works: a stand-in server picks
 * at random and the wheel spins to its pick, as the real screen spins to the
 * server's. The still entries hold a spin at one point for a picture
 * (`spin.at`), or show it as prefers-reduced-motion does (`spin.still`).
 */

import { useEffect, useState } from 'react';

import AccountShell from '../shell/AccountShell.jsx';
import { RecordsLayout } from '../teach/Records.jsx';
import { THINK_SECONDS, WheelView, ringOf } from '../teach/Wheel.jsx';

const FIRST = [
  'Aarav', 'Aditi', 'Ananya', 'Arjun', 'Ishaan', 'Kavya', 'Rohan', 'Sneha', 'Vihaan', 'Diya', 'Aryan', 'Meera', 'Kabir', 'Saanvi',
  'Yash', 'Tanvi', 'Om', 'Riya', 'Neel', 'Pooja', 'Harsh', 'Nisha', 'Aditya', 'Shruti', 'Varun', 'Zoya', 'Siddharth', 'Gauri',
  'Pranav', 'Ira', 'Dev', 'Anika', 'Rahul', 'Leela', 'Farhan', 'Mitali', 'Kunal', 'Esha', 'Tejas', 'Prisha', 'Venkataraman',
  'Bhavna', 'Chaitanya', 'Gayatri', 'Hrithik', 'Jahnavi', 'Keshav', 'Lavanya', 'Manav', 'Navya', 'Omkar', 'Parth', 'Rutuja',
  'Samarth', 'Trisha', 'Uday', 'Vaishnavi', 'Wasim', 'Yamini', 'Zubin',
];
const LAST = ['Shah', 'Rao', 'Iyer', 'Patil', 'Kulkarni', 'Nair', 'Deshmukh', 'Joshi', 'Mehta', 'Kapoor', 'Gupta', 'Pillai', 'Subramanian', 'Reddy', 'Pawar', 'Bhosale', 'Jadhav', 'Sharma', 'Chavan', 'Gaikwad', 'Menon', 'Krishnamurthy', 'Thakur', 'Banerjee'];
const ROSTER = FIRST.map((f, i) => ({ studentId: `5e1f${String(i + 1).padStart(20, '0')}`, rollNo: `23CS${String(i + 1).padStart(2, '0')}`, name: `${f} ${LAST[(i * 7) % LAST.length]}` }));

const ASKS = [
  { id: 'bank', label: 'Bank', hint: 'A question from the room\'s bank.' },
  { id: 'diagram', label: 'Diagram', hint: 'Ask them to explain the diagram on the projector, one step at a time.' },
  { id: 'demo', label: 'Demo', hint: 'Ask them to work it through on the board while the class follows.' },
];
const STATUSES = [
  { id: 'answered', label: 'Answered' }, { id: 'passed', label: 'Passed to partner' }, { id: 'help', label: 'Needs help' },
  { id: 'skipped', label: 'Skipped' }, { id: 'absent', label: 'Absent' },
];
const QS = { status: 'ready', list: [], error: '', load: () => {} };
const PRIVACY = 'Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level.';

const mkPick = (s, order, poolSize) => ({
  id: `w${order}-${s.rollNo}`, round: 1, order, rollNo: s.rollNo, name: s.name, classStudentId: s.studentId, poolSize,
  presentOnly: false, noRepeat: true, ask: 'bank', askLabel: 'Bank', questionId: null, question: null,
  status: 'pending', statusLabel: 'Pending', pickedAt: new Date(Date.UTC(2026, 10, 20, 4, 30 + order)).toISOString(),
  pickedBy: null, statusAt: null, statusBy: null,
});

/** The wheel read for a class of `n`, no repeats, present only off. */
function body(n, picks) {
  const base = ROSTER.slice(0, n);
  const had = new Set(picks.map((p) => p.rollNo));
  const eligible = base.filter((s) => !had.has(s.rollNo));
  return {
    room: { code: 'K7Q2WD', status: 'open' },
    round: { number: 1, started: picks.length > 0, presentOnly: false, noRepeat: true, picks: picks.length },
    pool: {
      total: base.length, left: eligible.length, picked: had.size, summary: `${had.size} picked of ${base.length}`,
      onWheel: eligible.map(({ rollNo, name }) => ({ rollNo, name })),
      empty: eligible.length ? null : 'Everyone on the wheel has had a turn this round. Start a new round, or turn off no repeats.',
    },
    rounds: [{ number: 1, presentOnly: false, noRepeat: true }],
    picks,
    asks: ASKS,
    statuses: STATUSES,
    privacy: PRIVACY,
  };
}

/**
 * `at`: a draw is made on arrival and held at that point of its spin (1 is
 * landed). `still`: every draw shows as reduced motion shows it.
 */
function Demo({ n, drawn = 0, names = true, at = null, still = false, think = null }) {
  const [picks, setPicks] = useState(() => ROSTER.slice(0, drawn).map((s, i) => mkPick(s, i + 1, n - i)));
  const [spin, setSpin] = useState(null);
  const [prefs, setPrefs] = useState({ think: Boolean(think), names, withQuestion: false });
  const wheel = body(n, picks);

  function draw(fixed = null) {
    const pool = wheel.pool.onWheel;
    if (!pool.length) return;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const chosen = ROSTER.find((s) => s.rollNo === pool[fixed ?? buf[0] % pool.length].rollNo);
    const pick = mkPick(chosen, picks.length + 1, pool.length);
    setSpin({ ring: ringOf(wheel), pick, ...(at != null && fixed != null ? { at } : {}), ...(still ? { still: true } : {}) });
    setPicks([...picks, pick]);
  }
  // A held entry draws once on arrival, always the same student.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (at != null) draw(Math.floor(wheel.pool.onWheel.length * 0.62)); }, []);

  return (
    <AccountShell
      current="console"
      crumb={<span className="clip">Live · <span className="mono">K7Q2WD</span> · Computer Networks CS-A</span>}
      title="In the room"
      sub={`Teacher-led: no phones today. A class of ${n}.`}
    >
      <RecordsLayout tab="wheel" onTab={() => {}} canControl>
        <WheelView
          wheel={wheel}
          load={{ status: 'ready' }}
          canControl
          classRoom
          spin={spin}
          onLanded={() => setSpin(null)}
          onSelect={() => {}}
          onDraw={() => draw()}
          prefs={prefs}
          onPref={(key, value) => setPrefs((p) => ({ ...p, [key]: value }))}
          think={think}
          onSkip={() => {}}
          onCancel={() => {}}
          onRound={() => { setPicks([]); setSpin(null); }}
          onSetting={() => {}}
          onPick={() => {}}
          questions={QS}
        />
      </RecordsLayout>
    </AccountShell>
  );
}

export default [
  {
    id: 'wheel-10',
    title: 'Wheel, 10 on it',
    role: 'professor',
    note: 'Ten segments, whole names. Press Draw: a flick, then friction, the pointer ticking over each peg as it slows. It stops in the pick’s segment.',
    render: () => <Demo n={10} />,
  },
  {
    id: 'wheel-30',
    title: 'Wheel, 30 on it',
    role: 'professor',
    note: 'The most a wheel takes. A name that does not fit is cut to "First L.", then the first name. Labels on the left half turn over to read upright.',
    render: () => <Demo n={30} />,
  },
  {
    id: 'wheel-30-rolls',
    title: 'Wheel, 30 on it, names off',
    role: 'professor',
    note: 'Roll numbers only, for a laptop the class can see.',
    render: () => <Demo n={30} names={false} />,
  },
  {
    id: 'wheel-60',
    title: 'Reel, 60 on it',
    role: 'professor',
    note: 'Past 30 the wheel becomes a reel: one row per student, the band in the middle is the pointer. Draw spins it to the pick.',
    render: () => <Demo n={60} />,
  },
  {
    id: 'wheel-midspin',
    title: 'Wheel, mid-spin',
    role: 'professor',
    note: 'Held at 55% of the spin, 22 on the wheel. The pick is already made; the hub says Drawing and the log waits for the landing.',
    render: () => <Demo n={22} at={0.55} />,
  },
  {
    id: 'wheel-landed',
    title: 'Wheel, landed',
    role: 'professor',
    note: 'The pick’s segment turns green at the pointer, its name level; the hub has the roll number.',
    render: () => <Demo n={22} drawn={3} at={1} />,
  },
  {
    id: 'wheel-60-midspin',
    title: 'Reel, mid-spin',
    role: 'professor',
    note: 'Held at 45% of the spin, 60 on the reel.',
    render: () => <Demo n={60} at={0.45} />,
  },
  {
    id: 'wheel-60-landed',
    title: 'Reel, landed',
    role: 'professor',
    render: () => <Demo n={60} drawn={4} at={1} />,
  },
  {
    id: 'wheel-reduced',
    title: 'Wheel, reduced motion',
    role: 'professor',
    note: 'As prefers-reduced-motion shows it: Draw does not spin. The wheel stands with the pick at the pointer at once.',
    render: () => <Demo n={16} still />,
  },
  {
    id: 'wheel-think',
    title: 'Wheel, think time',
    role: 'professor',
    note: `The ring round the rim empties from the pointer over ${THINK_SECONDS} seconds; the hub counts them. Held at 6.`,
    render: () => <Demo n={18} think={{ left: 6, of: THINK_SECONDS }} />,
  },
  {
    id: 'wheel-60-think',
    title: 'Reel, think time',
    role: 'professor',
    note: 'On the reel, the bar under its window empties.',
    render: () => <Demo n={60} think={{ left: 6, of: THINK_SECONDS }} />,
  },
];
