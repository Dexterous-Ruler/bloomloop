/**
 * The room step, drawn from sample banks. Development only.
 *
 * Room takes the bank as props and its server calls as `create` and
 * `loadClasses`, so these entries hand it sample banks in the shape of
 * GET /api/bank/:id, a class list in the shape of GET /api/classes, and a
 * stand-in for POST /api/session with the server's rules: a set is served as
 * picked, the whole bank needs 6 approved, a Teacher-led room needs a class,
 * and the reply carries `bankCount`, `questionIds`, `settings`, `classId` and
 * `status`. Nothing here talks to the server.
 */

import { useState } from 'react';

import { LEVELS } from '../lib/bloom.js';
import AppShell from '../shell/AppShell.jsx';
import Room from '../teach/Room.jsx';
import { Note } from '../ui/index.jsx';

/* ------------------------------------------------------------------- sample */

const TITLE = 'Operating Systems - Unit 2: CPU scheduling (sample)';
const TOPICS = ['Scheduling basics', 'Round robin', 'Priority and starvation'];

/* [level, kind, text] per topic, in the bank's order. */
const WRITTEN = {
  'Scheduling basics': [
    ['remember', 'mcq', 'What does the short-term scheduler choose between?'],
    ['remember', 'truefalse', 'True or false: a process in the waiting state can be picked to run next.'],
    ['remember', 'mcq', 'Which term names the time from a process arriving to it finishing?'],
    ['understand', 'match', 'Match each scheduling criterion to what it measures.'],
    ['understand', 'categorise', 'Sort these events into those that cause a context switch and those that do not.'],
    ['understand', 'match', 'Match each process state to the event that moves a process into it.'],
    ['apply', 'numeric', 'Work out the average waiting time for these four jobs under first come, first served.'],
    ['apply', 'table', 'Complete the table of start and finish times for the jobs below under shortest job first.'],
    ['analyse', 'multi', 'Choose every statement that explains the convoy effect in this trace.'],
    ['analyse', 'hottext', 'Pick the words in the trace that show a process being pre-empted.'],
    ['evaluate', 'rank', 'Rank these algorithms for an interactive desktop, best first.'],
    ['create', 'open', 'Design a scheduling rule for a print server that keeps short jobs moving. Justify it.'],
  ],
  'Round robin': [
    ['remember', 'mcq', 'What is the fixed slice of CPU time in round robin called?'],
    ['remember', 'truefalse', 'True or false: round robin is pre-emptive.'],
    ['remember', 'mcq', 'Which queue does a process join when its time slice runs out?'],
    ['understand', 'match', 'Match each quantum size to its likely effect on the class of jobs.'],
    ['understand', 'categorise', 'Sort these workloads into those round robin suits and those it does not.'],
    ['understand', 'match', 'Match each term to its place in the ready queue.'],
    ['apply', 'numeric', 'Work out the turnaround time of P3 with a quantum of 4 ms.'],
    ['apply', 'dropdown', 'Choose the missing values in this Gantt chart for a quantum of 2 ms.'],
    ['analyse', 'multi', 'Choose every reason the average waiting time rose when the quantum was cut to 1 ms.'],
    ['analyse', 'grid', 'Tick every row of the trace where a context switch happens.'],
    ['evaluate', 'order', 'Put these quantum sizes in order from most to least responsive for this workload.'],
    ['create', 'open', 'Propose a quantum for a lab server shared by 30 students, and defend it.'],
  ],
  'Priority and starvation': [
    ['remember', 'mcq', 'What is it called when a low-priority process never gets to run?'],
    ['remember', 'truefalse', 'True or false: ageing raises the priority of a process that has waited a long time.'],
    ['remember', 'mcq', 'Which algorithm is priority scheduling by predicted burst length?'],
    ['understand', 'match', 'Match each fix to the problem it addresses.'],
    ['understand', 'categorise', 'Sort these processes into those at risk of starvation and those that are not.'],
    ['understand', 'match', 'Match each priority scheme to an example of where it is used.'],
    ['apply', 'blank', 'Fill in the priority of P4 after 30 ms of ageing at one level per 10 ms.'],
    ['apply', 'numeric', 'Work out the order these five processes run in under non-pre-emptive priority.'],
    ['analyse', 'multi', 'Choose every condition in this system that makes starvation possible.'],
    ['analyse', 'hottext', 'Pick the words in the log that show priority inversion.'],
    ['evaluate', 'rank', 'Rank these remedies for priority inversion on a real-time controller.'],
    ['create', 'open', 'Design an ageing rule that prevents starvation without undoing priorities. Explain the trade-off.'],
  ],
};

const KINDS = {
  forLevel: {
    remember: ['mcq', 'truefalse'], understand: ['match', 'categorise'], apply: ['blank', 'numeric', 'dropdown', 'table'],
    analyse: ['multi', 'hottext', 'grid'], evaluate: ['order', 'rank'], create: ['open'],
  },
  label: {
    mcq: 'Choose one', truefalse: 'True or false', match: 'Match the pairs', categorise: 'Sort into groups',
    blank: 'Fill in the blank', numeric: 'Work out the value', dropdown: 'Choose for each gap', table: 'Complete the table',
    multi: 'Choose all that apply', hottext: 'Pick the words', grid: 'Tick every match', order: 'Put these in order',
    rank: 'Rank them', open: 'Write your answer',
  },
};

const ALL = TOPICS.flatMap((topic, t) => WRITTEN[topic].map(([bloom, kind, text], i) => ({
  _id: `5a${String(t).padStart(2, '0')}${String(i).padStart(2, '0')}c0ffee`.padEnd(24, '0'),
  topic, bloom, kind, text, status: 'active',
})));

const CONTENT = { contentId: '64f00000000000000000beef', title: TITLE, topics: TOPICS };

/** A bank reply from a list of questions, counted the way the server counts. */
function bankOf(questions) {
  const active = questions.filter((q) => q.status === 'active');
  return {
    questions,
    counts: LEVELS.reduce((a, l) => ({ ...a, [l]: active.filter((q) => q.bloom === l).length }), {}),
    total: questions.length,
    active: active.length,
    drafts: questions.filter((q) => q.status === 'draft').length,
    kinds: KINDS,
  };
}

const as = (status) => (q) => ({ ...q, status });

const BANKS = {
  whole: bankOf(ALL),
  drafts: bankOf([...ALL.slice(0, 28).map(as('draft')), ...ALL.slice(28).map(as('discarded'))]),
  // Four approved over two topics and three levels, five drafts behind them.
  under: bankOf([
    ALL[0], ALL[3], ALL[13], ALL[18],
    ...[ALL[1], ALL[6], ALL[14], ALL[24], ALL[27]].map(as('draft')),
  ]),
  // Six approved here, two drafts; the stand-in server has since seen two
  // rejected in another tab, so it answers with its 409.
  stale: bankOf([...ALL.slice(0, 6), ...ALL.slice(6, 8).map(as('draft'))]),
  empty: bankOf([]),
};

// Some of every topic, at five of the six levels.
const PICKED = [ALL[0], ALL[1], ALL[6], ALL[8], ALL[12], ALL[15], ALL[19], ALL[22], ALL[34]].map((q) => q._id);

/* ------------------------------------------------------- the stand-in server */

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const fail = (message, status) => Object.assign(new Error(message), { status });

function serverFor(bank, refuse) {
  return async (contentId, title, settings) => {
    await wait(450);
    if (refuse) throw fail(refuse.message, refuse.status);
    const ids = settings.questionIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length === 0)) {
      throw fail('questionIds is empty. Pick at least one question, or leave questionIds out to use every approved question.', 400);
    }
    const active = bank.questions.filter((q) => q.status === 'active');
    if (!ids && active.length < 6) {
      throw fail(`Only ${active.length} active questions in the bank for "${title}". Generate questions first - a session needs at least 6.`, 400);
    }
    if (settings.classId && !CLASSES.some((c) => c.id === settings.classId && c.canEdit)) {
      throw fail('That class was not found.', 404);
    }
    if (settings.mode === 'teacher-led' && !settings.classId) {
      throw fail('A Teacher-led room needs a class: no phones join it, so the wheel, attendance and observations '
        + 'work from the class roster. Send classId, or open the room for Student devices or Mixed.', 400);
    }
    return {
      code: 'GA7KRX',
      sessionId: 'sample',
      bankCount: ids ? ids.length : active.length,
      // Every setting comes back, the ones not sent at the old behaviour's value.
      settings: {
        masteryGoal: settings.masteryGoal, reattempts: settings.reattempts, redemption: settings.redemption,
        mode: settings.mode ?? 'devices', adapt: settings.adapt ?? true, startLevel: settings.startLevel ?? 'understand',
        questionsPerStudent: settings.questionsPerStudent ?? null, timePerQuestion: settings.timePerQuestion ?? null,
      },
      questionIds: ids ?? null,
      classId: settings.classId ?? null,
      status: settings.lobby ? 'waiting' : 'open',
      // Not in the server's reply: what the form sent, for this page's note.
      sent: settings,
    };
  };
}

/* GET /api/classes: newest first, without rosters. The last is a colleague's,
   readable here (as an HOD reads a department) but not this account's to open
   a room for, so the form leaves it out. */
const CLASSES = [
  { id: 'ec349fd84c312402e637884a', courseName: 'Operating Systems', section: 'SY-CS A', termLabel: 'Odd term 2026', size: 58, canEdit: true },
  { id: 'a1b2c3d4e5f60718293a4b5c', courseName: 'Operating Systems', section: 'SY-CS B', termLabel: 'Odd term 2026', size: 61, canEdit: true },
  { id: 'f0e1d2c3b4a5968778695a4b', courseName: 'Computer Networks', section: 'TY-CS A', termLabel: 'Odd term 2026', size: 49, canEdit: false },
];

function classesFor(kind) {
  return async () => {
    if (kind === 'loading') return new Promise(() => {});
    await wait(350);
    if (kind === 'error') throw fail('The class list could not be read: the server did not answer.', 503);
    return { classes: kind === 'none' ? [] : CLASSES };
  };
}

/* ---------------------------------------------------------------- the frame */

const NAV = [
  { id: 'content', label: 'Material', icon: 'material', group: 'prepare' },
  { id: 'bank', label: 'Questions', icon: 'bank', group: 'prepare' },
  { id: 'session', label: 'Room', icon: 'room', group: 'prepare' },
  { id: 'live', label: 'Live class', icon: 'live', group: 'teach', locked: true, why: 'Open a room to watch the class.' },
];

function Demo({ bank, initialSet = null, refuse = null, classes = 'some', initialRun }) {
  const [create] = useState(() => serverFor(bank, refuse));
  const [loadClasses] = useState(() => classesFor(classes));
  const [opened, setOpened] = useState(null);
  const [went, setWent] = useState('');
  const [key, setKey] = useState(0);

  const questions = bank.questions;
  const approved = questions.filter((q) => q.status === 'active');
  const levels = LEVELS.reduce((a, l) => ({ ...a, [l]: approved.filter((q) => q.bloom === l).length }), {});

  return (
    <AppShell
      crumb={<span className="clip">{TITLE}</span>}
      title="Room"
      sub="Set the rules the room runs on, then open it. Opening mints a six-character code and puts it on the projector."
      nav={NAV}
      current="session"
      onNav={() => {}}
    >
      {(opened || went) && (
        <Note tone={opened ? 'ok' : undefined} role="status">
          {opened
            ? <>The sample server opened <b className="mono">{opened.code}</b> on {opened.questionIds ? `a set of ${opened.questionIds.length}` : 'the whole bank'}: <span className="mono">bankCount {opened.bankCount}, status {opened.status}, classId {opened.classId ?? 'null'}</span>. Sent: <span className="mono">{JSON.stringify(Object.fromEntries(Object.entries(opened.sent).filter(([k]) => k !== 'questionIds')))}</span>. In the console the projector takes over here.</>
            : `In the console this goes to ${went}.`}
          {' '}
          <button type="button" className="link rs-linkbtn" onClick={() => { setOpened(null); setWent(''); setKey((k) => k + 1); }}>Start again</button>
        </Note>
      )}
      <Room
        key={key}
        content={CONTENT}
        bank={bank}
        activeCount={approved.length}
        draftCount={questions.filter((q) => q.status === 'draft').length}
        levels={levels}
        initialSet={initialSet}
        initialRun={initialRun}
        create={create}
        loadClasses={loadClasses}
        onSession={setOpened}
        onBack={() => setWent('the question bank')}
        onDrafts={() => setWent('the bank’s Drafts view')}
      />
    </AppShell>
  );
}

/* ------------------------------------------------------------------ entries */

export default [
  {
    id: 'room-whole',
    title: 'Room set-up: the whole approved bank',
    note: '36 approved questions over three topics. The default: the room serves every approved question.',
    render: () => <Demo bank={BANKS.whole} />,
  },
  {
    id: 'room-set',
    title: 'Room set-up: picking a set',
    note: 'Nine questions ticked across three topics and five levels. Open the room to see the reply the projector gets.',
    render: () => <Demo bank={BANKS.whole} initialSet={PICKED} />,
  },
  {
    id: 'room-drafts',
    title: 'Room set-up: drafts only',
    note: '28 drafts and nothing approved, so the room cannot open. Explained before the server would refuse it.',
    render: () => <Demo bank={BANKS.drafts} />,
  },
  {
    id: 'room-under-six',
    title: 'Room set-up: under six approved',
    note: 'Four approved and five drafts: too few for a whole-bank room, so it offers a set instead.',
    render: () => <Demo bank={BANKS.under} />,
  },
  {
    id: 'room-409',
    title: 'Room set-up: the server refuses with a 409',
    note: 'The bank changed in another tab. Press Open the room: the sentence is shown as given, with a way to the bank.',
    render: () => (
      <Demo
        bank={BANKS.stale}
        refuse={{
          status: 409,
          message: `"${TITLE}" has 4 generated questions waiting for your approval and 4 approved. A room serves approved questions only and needs at least 6: approve them in the question bank first.`,
        }}
      />
    ),
  },
  {
    id: 'room-mixed-lobby',
    title: 'Room set-up: a class, Mixed, with a waiting room',
    note: 'SY-CS A chosen, Mixed, a waiting room, levels fixed at Apply, 12 questions each and 60 seconds a question. Open it to see what is sent and the reply.',
    render: () => (
      <Demo
        bank={BANKS.whole}
        initialRun={{ classId: CLASSES[0].id, mode: 'mixed', lobby: true, adapt: false, startLevel: 'apply', cap: '12', timer: '60' }}
      />
    ),
  },
  {
    id: 'room-teacher-led-no-class',
    title: 'Room set-up: Teacher-led with no class',
    note: 'Explained before the server would refuse it, and Open stays off until a class is chosen. The pace rules do not apply.',
    render: () => <Demo bank={BANKS.whole} initialRun={{ mode: 'teacher-led' }} />,
  },
  {
    id: 'room-teacher-led-400',
    title: 'Room set-up: the server refuses Teacher-led',
    note: 'A class is chosen here, but the stand-in server answers as if it were not. Press Open the room: its sentence is shown as given.',
    render: () => (
      <Demo
        bank={BANKS.whole}
        initialRun={{ classId: CLASSES[1].id, mode: 'teacher-led' }}
        refuse={{
          status: 400,
          message: 'A Teacher-led room needs a class: no phones join it, so the wheel, attendance and observations work from the class roster. Send classId, or open the room for Student devices or Mixed.',
        }}
      />
    ),
  },
  {
    id: 'room-out-of-range',
    title: 'Room set-up: a cap and a timer out of range',
    note: '0 questions and 5 seconds: each says its range under it, and Open stays off.',
    render: () => <Demo bank={BANKS.whole} initialRun={{ cap: '0', timer: '5' }} />,
  },
  {
    id: 'room-no-class',
    title: 'Room set-up: no class yet',
    note: 'The account has no class. The form says so, with a way to set one up in a new tab; the list is read again when this tab comes back into focus.',
    render: () => <Demo bank={BANKS.whole} classes="none" />,
  },
  {
    id: 'room-classes-loading',
    title: 'Room set-up: reading the classes',
    note: 'The class list has not answered yet.',
    render: () => <Demo bank={BANKS.whole} classes="loading" />,
  },
  {
    id: 'room-classes-error',
    title: 'Room set-up: the class list failed',
    note: 'The sentence as given, and a way to try again. The room can still open with no class.',
    render: () => <Demo bank={BANKS.whole} classes="error" />,
  },
  {
    id: 'room-empty',
    title: 'Room set-up: nothing written yet',
    note: 'No question at all, approved or draft.',
    render: () => <Demo bank={BANKS.empty} />,
  },
];
