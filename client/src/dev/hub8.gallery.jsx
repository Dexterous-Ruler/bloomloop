/**
 * The Learning Hub's batch 8 parts, drawn from replies of the batch 8 server
 * (dev/samples-b8-hub8.js, captured on the hub harness against b8-z2):
 * the concept panel on a topic's Introduction and Explanation tabs, a lesson's
 * figure step, an answer refused for its serve token, and Get Ready's "End
 * this check" and "Why this path". Development only.
 */

import { useState } from 'react';

import '../styles/hub.css';
import '../styles/hub-map.css';
import '../styles/hub-topic.css';
import '../styles/hub-practice.css';
import { LABEL, ReadyAsk, ReadyResults, ReadyWaiting } from '../hub/GetReady.jsx';
import HubPage from '../hub/HubPage.jsx';
import { PracticeView } from '../hub/Practice.jsx';
import { QuestionCardView } from '../hub/QuestionCard.jsx';
import { PROGRESS_REPLY, TOPIC_FIRST_REPLY, TOPIC_REPLY } from '../hub/samples/topic.js';
import { LinkButton } from '../hub/TestParts.jsx';
import { TopicView } from '../hub/Topic.jsx';
import { lessonFigure } from './samples-b8-figures.js';
import {
  LESSON_NO_SECTIONS, LESSON_SECTIONS, LESSON_SECTIONS_HI, NEXT_TOKEN, READY_COMPLETE8, READY_ENDED, READY_OPEN8,
  TOKEN_EXPIRED, TOKEN_MISSING,
} from './samples-b8-hub8.js';

const wait = (value, ms = 450) => new Promise((r) => { setTimeout(() => r(value), ms); });
const refuse = (e) => wait(null).then(() => { throw Object.assign(new Error(e.message), { status: e.status, kept: true, reopen: true }); });
const noop = () => {};

/** Lesson cards answered from the samples: every answer comes back refused for its serve token. */
const lessonRefused = () => ({ send: () => refuse(TOKEN_MISSING), askHint: () => wait({ hint: null, message: 'No hints here.' }), opened: () => wait({ hints: [] }) });
const STATES = Object.fromEntries(PROGRESS_REPLY.topics.map((t) => [t.id.toLowerCase(), t.state]));

/**
 * The sectioned lesson with its slide followed by a figure step: the call stack
 * of fact(3), as the batch 8 figure server draws it (dev/samples-b8-figures.js).
 */
const [CHUNK, CHECK] = LESSON_SECTIONS.lesson.steps;
const LESSON_FIGURE = {
  ...LESSON_SECTIONS,
  lesson: {
    ...LESSON_SECTIONS.lesson,
    steps: [
      CHUNK,
      CHECK,
      {
        type: 'figure',
        cite: 'Slide 4',
        text: 'Each call waits on the stack for the call it made. Step through fact(3) to see the stack grow and shrink.',
        html: 'Each call waits on the stack for the call it made. Step through fact(3) to see the stack grow and shrink.',
        figure: lessonFigure('stack'),
      },
    ],
  },
};

/** The topic, with its tab and step kept here instead of the address. */
function TopicDemo({ data = TOPIC_REPLY, lesson, tab: firstTab = 'introduction', step: firstStep = 0, reopen = false }) {
  const [tab, setTab] = useState(firstTab);
  const [step, setStep] = useState(firstStep);
  return (
    <TopicView
      data={data}
      lesson={lesson}
      progress={PROGRESS_REPLY.topics}
      tab={tab}
      onTab={setTab}
      step={step}
      onStep={setStep}
      lessonOps={lessonRefused}
      onReopenLesson={reopen ? noop : undefined}
    />
  );
}

const READY_CRUMB = `Learning Hub · ${LABEL}`;
const ready = (title, body, sub) => (
  <HubPage crumb={READY_CRUMB} title={title} sub={sub} actions={<LinkButton to="/hub/ready" icon="back">All checks</LinkButton>}>
    {body}
  </HubPage>
);
const ASK_SUB = 'No hints here. After each answer you see whether it was right, and why.';
const RESULT_SUB = 'What the check found, and what to look at first.';

/** "End this check" answered from the samples: the ended check after a short wait. */
function EndDemo({ error = null }) {
  const [data, setData] = useState(READY_OPEN8);
  const [busy, setBusy] = useState(false);
  if (data.check.status === 'complete') return ready(`Before ${data.target.name}`, <ReadyResults data={data} />, RESULT_SUB);
  const onEnd = () => { setBusy(true); wait(READY_ENDED).then((r) => { setBusy(false); setData(r); }); };
  return ready(
    `Before ${data.target.name}`,
    <ReadyAsk data={data} onChoose={noop} onSubmit={noop} onNext={noop} onRetry={noop} end={{ onEnd, busy, error }} />,
    ASK_SUB,
  );
}

const R1 = CHECK.questions[0];

export default [
  {
    id: 'hub8-intro',
    title: 'Concept panel: Introduction',
    role: 'student',
    note: 'Recursion (asha): the introduction with its slide, the three fact cards with their labels and cites; then the lesson’s outline and what the topic needs first.',
    render: () => <TopicDemo lesson={LESSON_SECTIONS} />,
  },
  {
    id: 'hub8-explain',
    title: 'Concept panel: Explanation',
    role: 'student',
    note: 'After the lesson’s steps: key ideas numbered with the term in bold, the code example as the server highlighted it with its caption, then the common mistakes. Each with its cite.',
    render: () => <TopicDemo lesson={LESSON_SECTIONS} tab="explanation" />,
  },
  {
    id: 'hub8-hindi-intro',
    title: 'Concept panel: Introduction in Hindi',
    role: 'student',
    note: 'dev, who chose हिन्दी: the introduction and facts translated (lang="hi"); the labels are the screen’s own.',
    render: () => <TopicDemo lesson={LESSON_SECTIONS_HI} />,
  },
  {
    id: 'hub8-hindi-explain',
    title: 'Concept panel: Explanation in Hindi',
    role: 'student',
    note: 'The steps’ sentences, the caption and the mistakes in Hindi; each term and the code stay in English.',
    render: () => <TopicDemo lesson={LESSON_SECTIONS_HI} tab="explanation" />,
  },
  {
    id: 'hub8-none',
    title: 'Concept panel: a lesson without sections',
    role: 'student',
    note: 'Functions, a slides-only lesson: sections.available is false, so the server’s note stands where the introduction and facts would be (and under the steps on Explanation).',
    render: () => <TopicDemo data={TOPIC_FIRST_REPLY} lesson={LESSON_NO_SECTIONS} />,
  },
  {
    id: 'hub8-figure-step',
    title: 'Lesson: a figure step',
    role: 'student',
    note: 'Step 2 is a figure (H9c): its text, then the call stack of fact(3) stepped with Back, Next and Replay, a caption per step and progress dots. Every drawing is in the reply.',
    render: () => <TopicDemo lesson={LESSON_FIGURE} tab="explanation" step={1} />,
  },
  {
    id: 'hub8-visual',
    title: 'Topic: Visual with a figure',
    role: 'student',
    note: 'The Visual tab lists the lesson’s figures, each with its text and slide.',
    render: () => <TopicDemo lesson={LESSON_FIGURE} tab="visual" />,
  },
  {
    id: 'hub8-lesson-refused',
    title: 'Lesson: an answer refused for its token',
    role: 'student',
    note: 'Live: answer any question. The sample refuses it with the “not sent with the question” 409: the answer is kept, the sentence shown, and “Open the question again” starts the card afresh.',
    render: () => <TopicDemo lesson={LESSON_SECTIONS} tab="explanation" reopen />,
  },
  {
    id: 'hub8-q-expired',
    title: 'Question: answered too long ago',
    role: 'student',
    note: 'The “too long ago” 409 (the token lasts 7 days): the answer kept on this device, the sentence, and the way back to the question.',
    render: () => (
      <HubPage crumb="Learning Hub · Question card" title="One question">
        <div style={{ maxWidth: 720 }}>
          <QuestionCardView question={R1} label="Question 1 of 4" choice={2} onChoose={noop} kept={{ sentence: TOKEN_EXPIRED.message, reopen: true }} onReopen={noop} />
        </div>
      </HubPage>
    ),
  },
  {
    id: 'hub8-practice-refused',
    title: 'Practice: kept answers refused for their token',
    role: 'student',
    note: 'A practice question with its serveToken. The brief lists an answer kept from earlier that was refused, with its sentence, the way to its question (another topic’s practice) and “Forget this answer”.',
    render: () => (
      <PracticeView
        turn={NEXT_TOKEN}
        states={STATES}
        kept={1}
        refused={[
          { key: 'k1', sentence: TOKEN_EXPIRED.message, to: '/hub/t/recursion/practice' },
        ]}
        calls={() => ({ send: () => refuse(TOKEN_MISSING), askHint: () => wait({ hint: null }), opened: () => wait({ hints: [] }) })}
        onResult={noop}
        onNext={noop}
        onReopen={noop}
        onForget={noop}
      />
    ),
  },
  {
    id: 'hub8-ready-end',
    title: 'Get Ready: End this check',
    role: 'student',
    note: 'asha’s open check. Live: “End this check”, the confirm, then the check as the server ended it, with its note.',
    render: () => <EndDemo />,
  },
  {
    id: 'hub8-ready-end-error',
    title: 'Get Ready: ending refused',
    role: 'student',
    note: 'A refusal from the end route, in the server’s words under the control.',
    render: () => <EndDemo error="That Get Ready check was not found." />,
  },
  {
    id: 'hub8-ready-waiting-end',
    title: 'Get Ready: nothing to ask, End this check',
    role: 'student',
    note: 'No question for now: the student can still end the check.',
    render: () => ready(
      `Before ${READY_OPEN8.target.name}`,
      <ReadyWaiting
        data={{ ...READY_OPEN8, question: null, waiting: 'The questions left on this topic are closed for now: being asked in class, or on a self-test you have not handed in. The check carries on once one of them opens again.' }}
        onRetry={noop}
        end={{ onEnd: noop }}
      />,
      ASK_SUB,
    ),
  },
  {
    id: 'hub8-ready-ended',
    title: 'Get Ready: a check ended early',
    role: 'student',
    note: 'bilal ended his check after one answer: every prerequisite Not sure yet, check.note under the result, and why the path is empty.',
    render: () => ready(`Before ${READY_ENDED.target.name}`, <ReadyResults data={READY_ENDED} />, RESULT_SUB),
  },
  {
    id: 'hub8-ready-why',
    title: 'Get Ready: why this path',
    role: 'student',
    note: 'asha’s complete check: path.why.sentence names each change the evidence made, with path.why.source.label under it.',
    render: () => ready(`Before ${READY_COMPLETE8.target.name}`, <ReadyResults data={READY_COMPLETE8} />, RESULT_SUB),
  },
];
