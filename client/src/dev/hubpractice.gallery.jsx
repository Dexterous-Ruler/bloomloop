/**
 * The Learning Hub's self-test and Get Ready, drawn from real replies
 * (hub/samples/tests.js, captured from the hub harness). Development only.
 * Nothing here talks to a server: each entry hands a pure view one reply.
 */

import '../styles/hub.css';
import '../styles/hub-practice.css';
import { ExamOpen, ExamPast, ExamResults, ExamSetup, ExamTake } from '../hub/Exam.jsx';
import { ReadyAsk, ReadyList, ReadyResults, ReadyStart, ReadyWaiting } from '../hub/GetReady.jsx';
import HubPage from '../hub/HubPage.jsx';
import { LinkButton, TestSkeleton, Trouble } from '../hub/TestParts.jsx';
import {
  E401, E403, E404, E503, EXAMS, EXAM_ENDED, EXAM_ENDED_KINDS, EXAM_OPEN, HOME, READY_ANSWER_WRONG,
  READY_ASKING_CODE, READY_CHECKS, READY_COMPLETE, READY_COMPLETE_B, READY_OPEN, READY_TOPIC, READY_TOPIC_EARLIER,
  READY_TOPIC_NONE,
} from '../hub/samples/tests.js';

const LIMITS = EXAMS.limits;
const CRUMB = 'Learning Hub · Self-test';
const READY_CRUMB = 'Learning Hub · Skip what I know · short check';
const err = (e) => Object.assign(new Error(e.message), { status: e.status });
const noop = () => {};

/* ------------------------------------------------------------ self-test */

const home = (props = {}) => (
  <HubPage crumb={CRUMB} title="Test yourself" sub="A self-test is for you. It counts in no mark, and nobody is compared with you.">
    <ExamSetup home={HOME} limits={LIMITS} onStart={noop} {...props}>
      <ExamOpen exams={EXAMS.exams} />
    </ExamSetup>
    <ExamPast exams={EXAMS.exams} />
  </HubPage>
);

/** The open self-test as the route hands it to the view: the saved answers from the reply. */
const responsesOf = (data) => Object.fromEntries(data.questions.filter((q) => q.answered).map((q) => [q.questionId, q.response]));
const countsOf = (data) => ({ answered: data.answered, total: data.exam.total, status: data.exam.status });
const take = (props = {}) => (
  <HubPage crumb={CRUMB} title="Self-test" sub="Binary search trees">
    <ExamTake
      data={EXAM_OPEN}
      responses={responsesOf(EXAM_OPEN)}
      saves={{}}
      counts={countsOf(EXAM_OPEN)}
      left={EXAM_OPEN.exam.secondsLeft}
      onAnswer={noop}
      onHandIn={noop}
      {...props}
    />
  </HubPage>
);

const ended = (result) => (
  <HubPage crumb={CRUMB} title="Your self-test" sub={result.exam.topics.map((t) => t.name).join(' and ')} actions={<LinkButton to="/hub/exam" icon="back">All self-tests</LinkButton>}>
    <ExamResults result={result} />
  </HubPage>
);

const trouble = (e, title = 'Test yourself') => (
  <HubPage crumb={CRUMB} title={title}>
    <Trouble error={err(e)} onRetry={noop} back={<LinkButton to="/hub" icon="back">Back to your hub</LinkButton>} elsewhere={{ to: '/hubs', label: 'Go to the staff hub' }} />
  </HubPage>
);

/* ------------------------------------------------------------ Get Ready */

const ready = (title, children, sub) => (
  <HubPage crumb={READY_CRUMB} title={title} sub={sub} actions={<LinkButton to="/hub/ready" icon="back">All checks</LinkButton>}>
    {children}
  </HubPage>
);
const checksFor = (topicId) => READY_CHECKS.checks.filter((c) => c.target?.id === topicId);
const ASK_SUB = 'No hints here. After each answer you see whether it was right, and why.';

export default [
  {
    id: 'hub-exam-start',
    title: 'Self-test: start, resume, past results',
    role: 'student',
    note: 'GET /hub/exams and /hub/home as asha: the forest brief, her open timed self-test to carry on, the topics from her own map, levels, count, time limit; past results below.',
    render: () => home(),
  },
  {
    id: 'hub-exam-start-chosen',
    title: 'Self-test: topics chosen, timed',
    role: 'student',
    note: 'As /hub/exam?topicIds= opens it from a topic, with a 30-minute limit.',
    render: () => home({ initial: { topicIds: HOME.classes[0].units[0].chapters[0].topics.slice(0, 3).map((t) => t.id), minutes: 30 } }),
  },
  {
    id: 'hub-exam-start-refused',
    title: 'Self-test: the server refuses the choice',
    role: 'student',
    note: 'The 400 when nothing matches, in the server\'s words (services/hubExam.js NONE_MATCH).',
    render: () => home({
      initial: { topicIds: [HOME.classes[0].units[0].chapters[0].topics[0].id], levels: ['create'] },
      error: 'None of your professor\'s approved questions match those topics and levels yet. Choose other levels or topics.',
    }),
  },
  {
    id: 'hub-exam-take',
    title: 'Self-test: answering, one at a time',
    role: 'student',
    note: 'GET /hub/exams/:id, open and timed. Only "saved", answered of total and the status; the clock from secondsLeft. No hints, no marks.',
    render: () => take(),
  },
  {
    id: 'hub-exam-take-all',
    title: 'Self-test: every question on one page',
    role: 'student',
    note: 'A true or false, choose one, a table (the phone\'s own control in the card), a categorise and a cloze.',
    render: () => take({ initialMode: 'all' }),
  },
  {
    id: 'hub-exam-take-kept',
    title: 'Self-test: an answer kept on the device',
    role: 'student',
    note: 'No reply came back: the answer stays on the device with the same attempt id and is sent later.',
    render: () => take({
      initialIndex: 1,
      saves: { [EXAM_OPEN.questions[1].questionId]: { state: 'kept', message: 'Failed to fetch' } },
      responses: { ...responsesOf(EXAM_OPEN), [EXAM_OPEN.questions[1].questionId]: 0 },
      kept: 1,
    }),
  },
  {
    id: 'hub-exam-time-up',
    title: 'Self-test: time is up',
    role: 'student',
    note: 'At zero the questions lock and the page waits for the server to end it (deadline plus its grace); "Hand in now" ends it at once.',
    render: () => take({ left: 0 }),
  },
  {
    id: 'hub-exam-hand-in-check',
    title: 'Self-test: handing in with questions unanswered',
    role: 'student',
    render: () => take({ initialCheck: true }),
  },
  {
    id: 'hub-exam-results',
    title: 'Self-test: results',
    role: 'student',
    note: 'GET /hub/exams/:id once ended (asha): summary overall, by topic and by level, then each question with the answer, the right one and why.',
    render: () => ended(EXAM_ENDED),
  },
  {
    id: 'hub-exam-results-kinds',
    title: 'Self-test: results across every kind',
    role: 'student',
    note: 'POST /hub/exams/:id/submit (bilal): rank, open (provisional machine mark), hottext, numeric, categorise (not answered: no key shown), grid, order.',
    render: () => ended(EXAM_ENDED_KINDS),
  },
  {
    id: 'hub-exam-loading',
    title: 'Self-test: loading',
    role: 'student',
    render: () => <HubPage crumb={CRUMB} title="Test yourself"><TestSkeleton /></HubPage>,
  },
  { id: 'hub-exam-503', title: 'Hub: no accounts on this server (503)', role: 'student', render: () => trouble(E503) },
  { id: 'hub-exam-401', title: 'Hub: signed out (401)', role: 'student', render: () => trouble(E401) },
  { id: 'hub-exam-403', title: 'Hub: a staff account on a student page (403)', role: 'professor', render: () => trouble(E403) },
  { id: 'hub-exam-404', title: 'Self-test: not found (404)', role: 'student', render: () => trouble(E404, 'Self-test') },
  {
    id: 'hub-exam-failed',
    title: 'Self-test: no reply',
    role: 'student',
    render: () => trouble({ status: 0, message: 'Failed to fetch' }),
  },

  /* ---------------------------------------------------------- Get Ready */
  {
    id: 'hub-ready-list',
    title: 'Get Ready: your checks',
    role: 'student',
    note: 'GET /hub/getready as asha: one open (carry on), one complete; the rule.',
    render: () => (
      <HubPage crumb={READY_CRUMB} title="Get Ready" sub="Short checks before a topic, and the paths they made.">
        <ReadyList checks={READY_CHECKS.checks} rule={READY_CHECKS.rule} />
      </HubPage>
    ),
  },
  {
    id: 'hub-ready-list-empty',
    title: 'Get Ready: no checks yet',
    role: 'student',
    render: () => (
      <HubPage crumb={READY_CRUMB} title="Get Ready" sub="Short checks before a topic, and the paths they made.">
        <ReadyList checks={[]} rule={READY_CHECKS.rule} />
      </HubPage>
    ),
  },
  {
    id: 'hub-ready-start',
    title: 'Get Ready: before Recursion trees',
    role: 'student',
    note: 'GET /hub/topics/:id (prerequisites nearest first; Loops is earlier material) and GET /hub/getready?topicId=.',
    render: () => ready(`Before ${READY_TOPIC.topic.name}`, <ReadyStart topic={READY_TOPIC} checks={checksFor(READY_TOPIC.topic.id)} rule={READY_CHECKS.rule} onStart={noop} />),
  },
  {
    id: 'hub-ready-start-earlier',
    title: 'Get Ready: a prerequisite from last semester',
    role: 'student',
    render: () => ready(`Before ${READY_TOPIC_EARLIER.topic.name}`, <ReadyStart topic={READY_TOPIC_EARLIER} checks={[]} rule={READY_CHECKS.rule} onStart={noop} error="That id belongs to a self-test. Start the check with a new id." />),
    note: 'With a start refused by the server (its 409 sentence).',
  },
  {
    id: 'hub-ready-start-none',
    title: 'Get Ready: nothing to check first',
    role: 'student',
    render: () => ready(`Before ${READY_TOPIC_NONE.topic.name}`, <ReadyStart topic={READY_TOPIC_NONE} checks={[]} rule={READY_CHECKS.rule} onStart={noop} />),
  },
  {
    id: 'hub-ready-ask',
    title: 'Get Ready: the question it asks now',
    role: 'student',
    note: 'GET /hub/getready/:id as asha: a match question, with why; no hint button (the note says why).',
    render: () => ready(`Before ${READY_OPEN.target.name}`, <ReadyAsk data={READY_OPEN} onChoose={noop} onSubmit={noop} onNext={noop} onRetry={noop} />, ASK_SUB),
  },
  {
    id: 'hub-ready-ask-chosen',
    title: 'Get Ready: an answer chosen, before checking it',
    role: 'student',
    render: () => ready(`Before ${READY_ASKING_CODE.target.name}`, <ReadyAsk data={READY_ASKING_CODE} value={1} onChoose={noop} onSubmit={noop} onNext={noop} onRetry={noop} />, ASK_SUB),
  },
  {
    id: 'hub-ready-feedback',
    title: 'Get Ready: feedback after an answer',
    role: 'student',
    note: 'POST /hub/getready/:id/answers (bilal): not right, the right option, the professor\'s explanation, the topic\'s new state; then the next question.',
    render: () => ready(`Before ${READY_ASKING_CODE.target.name}`, <ReadyAsk data={READY_ASKING_CODE} value={1} sent={1} reply={READY_ANSWER_WRONG} onChoose={noop} onSubmit={noop} onNext={noop} onRetry={noop} />, ASK_SUB),
  },
  {
    id: 'hub-ready-kept',
    title: 'Get Ready: an answer kept on the device',
    role: 'student',
    render: () => ready(`Before ${READY_ASKING_CODE.target.name}`, <ReadyAsk data={READY_ASKING_CODE} value={0} sent={0} error={{ kept: true, message: 'Failed to fetch' }} onChoose={noop} onSubmit={noop} onNext={noop} onRetry={noop} />, ASK_SUB),
  },
  {
    id: 'hub-ready-waiting',
    title: 'Get Ready: nothing to ask just now',
    role: 'student',
    note: 'READY_OPEN with no question and the server\'s waiting sentence (services/hubGetReady.js CHECK_WAITS).',
    render: () => ready(`Before ${READY_OPEN.target.name}`, <ReadyWaiting data={{ ...READY_OPEN, question: null, waiting: 'The questions left on this topic are closed for now: being asked in class, or on a self-test you have not handed in. The check carries on once one of them opens again.' }} onRetry={noop} />, ASK_SUB),
  },
  {
    id: 'hub-ready-result',
    title: 'Get Ready: what the check found, and the path',
    role: 'student',
    note: 'GET /hub/getready/:id complete (asha): outcomes with their sentences; the refresher path, next step marked, the target last.',
    render: () => ready(`Before ${READY_COMPLETE.target.name}`, <ReadyResults data={READY_COMPLETE} />, 'What the check found, and what to look at first.'),
  },
  {
    id: 'hub-ready-result-b',
    title: 'Get Ready: a result with earlier material',
    role: 'student',
    note: 'bilal\'s check walked through the screens: three Ready, one Needs review, Loops Not sure yet (not on his classes).',
    render: () => ready(`Before ${READY_COMPLETE_B.target.name}`, <ReadyResults data={READY_COMPLETE_B} />, 'What the check found, and what to look at first.'),
  },
];
