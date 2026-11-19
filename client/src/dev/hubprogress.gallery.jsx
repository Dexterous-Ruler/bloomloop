/**
 * The Learning Hub's staff progress views, drawn from real replies
 * (hub/samples/progress.js, captured from the hub harness as profA and the
 * HOD). Development only. Nothing here talks to a server.
 *
 * ClassProgress and ClassStates are tabs inside the class frame
 * (StaffClass.jsx); here each sits in a plain account page so it can be seen.
 */

import '../styles/hub.css';
import '../styles/hub-practice.css';
import '../styles/hub-progress.css';
import { LinkButton, Trouble } from '../hub/TestParts.jsx';
import { ClassProgressView, ProgressSkeleton } from '../hubstaff/ClassProgress.jsx';
import { ClassStatesView } from '../hubstaff/ClassStates.jsx';
import { StudentProgressView } from '../hubstaff/StudentProgress.jsx';
import {
  CLASS_PROGRESS, CLASS_PROGRESS_HOD, CLASS_STATES, E403_STAFF, E503, READY_ASHA, READY_NONE, STUDENT_ASHA, STUDENT_CARA, STUDENT_FARAH,
} from '../hub/samples/progress.js';
import AccountShell from '../shell/AccountShell.jsx';

const crumbOf = (c) => `${[c.courseName, c.section].filter(Boolean).join(' · ')} · Learning Hub`;
const err = (e) => Object.assign(new Error(e.message), { status: e.status });

/** A tab's content in a page, as the class frame would hold it. */
const tab = (data, title, children) => (
  <AccountShell current="hub" crumb={crumbOf(data.class)} title={title} width="wide">
    <div className="hub">{children}</div>
  </AccountShell>
);

const student = (progress, ready) => (
  <AccountShell
    current="hub"
    crumb={crumbOf(progress.class)}
    title={progress.student.name || progress.student.rollNo}
    sub={`Roll ${progress.student.rollNo}`}
    actions={<LinkButton to={`/hubs/c/${progress.class.id}?tab=progress`} icon="back">Class progress</LinkButton>}
    width="wide"
  >
    <div className="hub"><StudentProgressView progress={progress} ready={ready} /></div>
  </AccountShell>
);

export default [
  {
    id: 'hubs-progress',
    title: 'Class progress: students by topic',
    role: 'professor',
    note: 'GET /api/hub/classes/:id/progress as profA: roll order, each cell the state with N and open errors; Farah has no account and shows the server\'s note.',
    render: () => tab(CLASS_PROGRESS, 'Progress', <ClassProgressView data={CLASS_PROGRESS} />),
  },
  {
    id: 'hubs-progress-hod',
    title: 'Class progress: the HOD reads it',
    role: 'hod',
    note: 'The same reply with access: reader. Nothing on the page changes anything.',
    render: () => tab(CLASS_PROGRESS_HOD, 'Progress', <ClassProgressView data={CLASS_PROGRESS_HOD} />),
  },
  {
    id: 'hubs-progress-empty',
    title: 'Class progress: no topics placed yet',
    role: 'professor',
    render: () => tab(CLASS_PROGRESS, 'Progress', <ClassProgressView data={{ ...CLASS_PROGRESS, topics: [] }} />),
  },
  {
    id: 'hubs-states',
    title: 'States: one topic\'s students, a column per state',
    role: 'professor',
    note: 'GET classes/:id/states as profA: roll order in every column, N and the provisional marker; the roster rows with no account apart.',
    render: () => tab(CLASS_STATES, 'States', <ClassStatesView data={CLASS_STATES} />),
  },
  {
    id: 'hubs-states-recursion',
    title: 'States: Recursion',
    role: 'professor',
    render: () => tab(CLASS_STATES, 'States', <ClassStatesView data={CLASS_STATES} initialTopic={CLASS_STATES.topics.find((t) => t.name === 'Recursion')?.id} />),
  },
  {
    id: 'hubs-student',
    title: 'One student: asha, read-only',
    role: 'professor',
    note: 'GET …/students/:rosterId/progress and …/getready: activity (counts, never a mark), topics with N, the error log with question ids, Get Ready checks and their path.',
    render: () => student(STUDENT_ASHA, READY_ASHA),
  },
  {
    id: 'hubs-student-quiet',
    title: 'One student: no activity yet',
    role: 'professor',
    render: () => student(STUDENT_CARA, READY_NONE),
  },
  {
    id: 'hubs-student-no-account',
    title: 'One student: a roster row with no account',
    role: 'professor',
    render: () => student(STUDENT_FARAH, { ...READY_NONE, student: STUDENT_FARAH.student, note: STUDENT_FARAH.note }),
  },
  {
    id: 'hubs-progress-loading',
    title: 'Class progress: loading',
    role: 'professor',
    render: () => tab(CLASS_PROGRESS, 'Progress', <ProgressSkeleton />),
  },
  {
    id: 'hubs-progress-503',
    title: 'Staff hub: no accounts on this server (503)',
    role: 'professor',
    render: () => tab(CLASS_PROGRESS, 'Progress', <Trouble error={err(E503)} onRetry={() => {}} />),
  },
  {
    id: 'hubs-progress-403',
    title: 'Staff hub: a student account (403)',
    role: 'student',
    render: () => tab(CLASS_PROGRESS, 'Progress', <Trouble error={err(E403_STAFF)} elsewhere={{ to: '/hub', label: 'Go to your hub' }} />),
  },
];
