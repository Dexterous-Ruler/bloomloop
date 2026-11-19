/**
 * Levels over time and evidence (Batch 8, builder B4), drawn from replies a
 * b8-z1 server sent (dev/samples-b8-levels.js) and from those replies with one
 * field changed to show each other case the server can send.
 *
 *   insights    per-level small charts with the room's goal; the Needs support
 *               strip against the class's previous room, and its three
 *               sentence-only cases; a reply from before Batch 8
 *   classes     the latest room against the one before (A1), "Open in question
 *               bank" on the hardest list (A3); a class with one room
 *   evidence    practisedNote on the student card and the attainment sheet, and
 *               each answer's reference (answerKey, 9c)
 */

import { useState } from 'react';

import { ClassView } from '../account/Classes.jsx';
import { StudentSheet } from '../account/StudentAttainment.jsx';
import AccountShell from '../shell/AccountShell.jsx';
import { InsightsView } from '../teach/Insights.jsx';
import { StudentCardView } from '../teach/StudentCard.jsx';
import { LIVE } from './samples-b8-levels.js';

/* ------------------------------------------------------------ insights */

const INS = LIVE.insights;
const PREV = INS.kpis.support.previousRoom;
const withPrevious = (previousRoom) => ({ ...INS, kpis: { ...INS.kpis, support: { ...INS.kpis.support, previousRoom } } });

// The three sentence-only cases, worded as services/insights.js words them.
const FIRST_ROOM = withPrevious({
  room: null, students: 6, compared: 0, then: null, now: null, change: null,
  sentence: 'This is the class\'s first room, so there is no earlier room to set these students against.',
});
const NOBODY = withPrevious({
  room: null, students: 0, compared: 0, then: null, now: null, change: null,
  sentence: 'Nobody is below 40% overall now, so there is nobody to set against the previous room.',
});
const NONE_LAST_TIME = withPrevious({
  room: PREV.room, students: 2, compared: 0, then: null, now: null, change: null,
  sentence: `None of the 2 students below 40% now had a graded answer in the previous room (${PREV.room.code}).`,
});
// A fall, so the change reads with its minus sign.
const FELL = withPrevious({
  ...PREV, then: { answers: 24, correct: 9, accuracy: 0.375 }, now: { answers: 40, correct: 11, accuracy: 0.275 }, change: -10,
  sentence: `6 of the 6 students below 40% now answered in the previous room (${PREV.room.code}): 9 of 24 graded answers right there (38%), 11 of 40 here (28%).`,
});
// The first minute of a room: one point.
const ONE_MINUTE = { ...INS, series: { ...INS.series, points: INS.series.points.slice(1, 2) } };
// A reply from before Batch 8: no per-level figures, no goal, no previous room.
const BEFORE_B8 = {
  ...INS,
  series: { since: INS.series.since, interval: INS.series.interval, points: INS.series.points.map(({ levels, ...p }) => p) },
  kpis: { ...INS.kpis, support: (({ previousRoom, ...s }) => s)(INS.kpis.support) },
};

function Frame({ code, children }) {
  return (
    <AccountShell current="console" crumb={`Live · room ${code}`} title="Insights" sub="Batch 8: levels over time, and the support band against the room before." width="wide">
      {children}
    </AccountShell>
  );
}

function Room({ data }) {
  const [sort, setSort] = useState(null);
  return (
    <Frame code={data.room.code}>
      <InsightsView data={data} canControl sort={sort} onSort={setSort} onAction={async () => {}} onOpenStudent={() => {}} />
    </Frame>
  );
}

/* ------------------------------------------------------------- classes */

const AN = LIVE.analytics;
const ONE_ROOM = {
  ...AN,
  rooms: AN.rooms.slice(-1),
  comparison: null,
  // A question whose chapter is unknown (deleted) has no bank link.
  hardest: { ...AN.hardest, items: AN.hardest.items.map((it, i) => (i === 0 ? { ...it, contentId: null } : it)) },
};

function Klass({ analytics }) {
  return (
    <ClassView
      data={LIVE.klass}
      classId={LIVE.klass.class.id}
      view="rooms"
      onView={() => {}}
      onReload={() => {}}
      analytics={{ last: 4, data: analytics, loading: false, error: '' }}
      onLast={() => {}}
      onRetryAnalytics={() => {}}
    />
  );
}

/* ------------------------------------------------------------ evidence */

// services/bankShare.js PRACTISED_NOTE, as the b8-z2 server sends it.
const PRACTISED_NOTE = 'The student had practised this question in the Learning Hub before answering it here. '
  + 'It counts as usual; it may say less about what they knew.';
const practised = (items, at) => items.map((a, i) => (at.includes(i) ? { ...a, practisedInHub: true, practisedNote: PRACTISED_NOTE } : a));

const CARD = { ...LIVE.card, lastAnswers: { ...LIVE.card.lastAnswers, items: practised(LIVE.card.lastAnswers.items, [1, 3]) } };
const ATTAIN = { ...LIVE.attain, answers: practised(LIVE.attain.answers, [0, 2]) };
const ROW = { studentId: LIVE.attain.student.id, rollNo: LIVE.attain.student.rollNo, name: LIVE.attain.student.name, statusLabel: LIVE.attain.student.statusLabel };

function Card() {
  const [open, setOpen] = useState(true);
  return (
    <Frame code={INS.room.code}>
      <InsightsView data={INS} canControl onAction={async () => {}} onOpenStudent={() => setOpen(true)} />
      {open && <StudentCardView card={CARD} roll={CARD.student.rollNo} onClose={() => setOpen(false)} />}
    </Frame>
  );
}

function Sheet() {
  const [row, setRow] = useState(ROW);
  return (
    <AccountShell current="classes" crumb="Classes / CS-A" title="Computer Networks" sub="Attainment, one student’s answers.">
      <button type="button" className="btn" onClick={() => setRow(ROW)}>Open {ROW.name}</button>
      <StudentSheet row={row} state={row ? { data: ATTAIN, loading: false, error: '' } : null} onClose={() => setRow(null)} onPrint={() => {}} />
    </AccountShell>
  );
}

export default [
  {
    id: 'levels-insights', title: 'Insights: per level over time, and Needs support against the room before', role: 'professor',
    note: 'A live reply: six small charts (one per level, named by its chip) with the room\'s 80% goal dashed; point at one or use the arrow keys and all six move to that minute. Under the tiles, the same students then and now.',
    render: () => <Room data={INS} />,
  },
  { id: 'levels-insights-fell', title: 'Insights: the same students did worse than last time', role: 'professor', render: () => <Room data={FELL} /> },
  { id: 'levels-insights-first-room', title: 'Insights: the class\'s first room', role: 'professor', note: 'Sentence only: no earlier room.', render: () => <Room data={FIRST_ROOM} /> },
  { id: 'levels-insights-nobody', title: 'Insights: nobody below 40%', role: 'professor', note: 'Sentence only.', render: () => <Room data={NOBODY} /> },
  { id: 'levels-insights-none-last-time', title: 'Insights: none of them answered last time', role: 'professor', note: 'Sentence only, naming the previous room.', render: () => <Room data={NONE_LAST_TIME} /> },
  { id: 'levels-insights-one-minute', title: 'Insights: the first minute', role: 'professor', note: 'One point: a dot per level that has answers.', render: () => <Room data={ONE_MINUTE} /> },
  { id: 'levels-insights-before-b8', title: 'Insights: a reply from before Batch 8', role: 'professor', note: 'No per-level figures, goal or previous room: the screen as it was.', render: () => <Room data={BEFORE_B8} /> },
  {
    id: 'levels-class', title: 'A class across rooms: against the room before, and the bank link', role: 'professor',
    note: 'A live reply. Three bands first, six levels one press away; each room\'s bar named by its code. Each hardest question opens in the bank.',
    render: () => <Klass analytics={AN} />,
  },
  { id: 'levels-class-one-room', title: 'A class with one room', role: 'professor', note: 'comparison is null: no card. The first hardest question has no chapter, so no bank link.', render: () => <Klass analytics={ONE_ROOM} /> },
  { id: 'levels-card', title: 'Student card: practised in the hub first, and answer references', role: 'professor', note: 'The note sits under the answer, never on the student. The references are folded away.', render: () => <Card /> },
  { id: 'levels-attain', title: 'Attainment sheet: practised in the hub first, and each answer\'s reference', role: 'professor', render: () => <Sheet /> },
];
