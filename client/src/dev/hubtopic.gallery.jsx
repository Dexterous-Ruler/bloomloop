/**
 * The Learning Hub's topic, lesson and practice screens, and the question
 * card, drawn from replies captured from the hub harness
 * (hub/samples/topic.js). Development only.
 *
 * The live cards answer from the same samples after a short wait, so the hint
 * ladder and the result can be tried here without a server.
 */

import { useState } from 'react';

// The gallery draws the views without HubApp, which is where the hub's
// stylesheets are imported for the real routes.
import '../styles/hub.css';
import '../styles/hub-map.css';
import '../styles/hub-topic.css';
import HubPage from '../hub/HubPage.jsx';
import { PracticeLoading, PracticeView } from '../hub/Practice.jsx';
import { QuestionCardView } from '../hub/QuestionCard.jsx';
import {
  ATTEMPT_PHONE_REPLY, ATTEMPT_WRONG_REPLY, CLOSED_KEPT, EXAMPLE_STEP, HINTS_OPENED_REPLY, HINT_NONE_REPLY, HINT_REPLY,
  LESSON_HI_REPLY, LESSON_NONE_REPLY, LESSON_REPLY, NEXT_CLOSED_REPLY, NEXT_HI_REPLY, NEXT_PHONE_REPLY, NEXT_REPLY,
  NEXT_REVIEW_REPLY, NO_ACCOUNTS, NO_TOPIC, PHONE_RESPONSE, PROGRESS_REPLY, SIGNED_OUT, TOPIC_FIRST_REPLY, TOPIC_REPLY,
} from '../hub/samples/topic.js';
import { HubTrouble, TopicLoading, TopicView } from '../hub/Topic.jsx';

const wait = (value, ms = 450) => new Promise((r) => { setTimeout(() => r(value), ms); });
const noop = () => {};

/** Calls answered from the samples: the hints in order, then a wrong answer. */
const fake = {
  send: () => wait(ATTEMPT_WRONG_REPLY),
  askHint: (step) => wait(step === 1 ? HINT_REPLY : HINT_NONE_REPLY),
  opened: () => wait({ ...HINTS_OPENED_REPLY, hints: [] }),
};
const lessonFake = () => ({ send: () => fake.send(), askHint: (q, a, step) => fake.askHint(step), opened: fake.opened });
const practiceFake = () => ({ send: () => fake.send(), askHint: (a, step) => fake.askHint(step), opened: fake.opened });

const STATES = Object.fromEntries(PROGRESS_REPLY.topics.map((t) => [t.id.toLowerCase(), t.state]));
const [CHUNK, CHECK] = LESSON_REPLY.lesson.steps;
const [R1, , , R2] = CHECK.questions;

/**
 * The captured lesson with a worked example after its slide (the harness has
 * no model, so its lessons carry none) and its last question closed for now,
 * as a room asking it would make it.
 */
const LESSON_FULL = {
  ...LESSON_REPLY,
  lesson: {
    ...LESSON_REPLY.lesson,
    steps: [
      CHUNK,
      EXAMPLE_STEP,
      {
        ...CHECK,
        questions: CHECK.questions.map((q, i) => (i === CHECK.questions.length - 1
          ? { ...q, closed: { reason: 'room', note: 'That question is being asked in class right now, so it stays closed here until the class has moved on.' } }
          : q)),
      },
    ],
  },
};

/** The topic, with its tab and step kept here instead of the address. */
function TopicDemo({ data = TOPIC_REPLY, lesson = LESSON_REPLY, tab: firstTab = 'introduction', progress = PROGRESS_REPLY.topics }) {
  const [tab, setTab] = useState(firstTab);
  const [step, setStep] = useState(0);
  return (
    <TopicView
      data={data}
      lesson={lesson}
      progress={progress}
      tab={tab}
      onTab={setTab}
      step={step}
      onStep={setStep}
      lessonOps={lessonFake}
    />
  );
}

function Card({ children }) {
  return (
    <HubPage crumb="Learning Hub · Question card" title="One question">
      <div style={{ maxWidth: 720 }}>{children}</div>
    </HubPage>
  );
}

export default [
  {
    id: 'hubtopic-intro',
    title: 'Topic: Introduction',
    role: 'student',
    note: 'Recursion (asha): the lesson’s label and outline, what the topic needs first (Prereqs), and the facts still to come.',
    render: () => <TopicDemo />,
  },
  {
    id: 'hubtopic-step',
    title: 'Topic: a lesson step',
    role: 'student',
    note: 'The slide, a worked example (hand-written: the harness has no model), and four questions in their kinds; the last closed for now. Live: hints and answers come from the samples.',
    render: () => <TopicDemo lesson={LESSON_FULL} tab="explanation" />,
  },
  {
    id: 'hubtopic-hindi',
    title: 'Topic: in Hindi',
    role: 'student',
    note: 'dev, who chose हिन्दी: the lesson translated (lang="hi"), two questions still in English with their note.',
    render: () => <TopicDemo lesson={LESSON_HI_REPLY} tab="explanation" />,
  },
  {
    id: 'hubtopic-nolesson',
    title: 'Topic: no lesson yet',
    role: 'student',
    note: 'Functions with Base case’s reply: the server’s `empty` sentence, nothing needed first.',
    render: () => <TopicDemo data={TOPIC_FIRST_REPLY} lesson={LESSON_NONE_REPLY} />,
  },
  {
    id: 'hubtopic-lesson-loading',
    title: 'Topic: lesson still loading',
    role: 'student',
    note: 'The topic has arrived; its lesson and the student’s state have not.',
    render: () => <TopicDemo lesson={null} progress={null} />,
  },
  {
    id: 'hubtopic-visual',
    title: 'Topic: Visual, coming later',
    role: 'student',
    note: 'The Visual tab before the server sends one: said plainly, nothing drawn.',
    render: () => <TopicDemo tab="visual" />,
  },
  {
    id: 'hubtopic-practice-tab',
    title: 'Topic: Practice tab',
    role: 'student',
    note: 'The way into practice, and “Skip what I know · short check” because the topic has prerequisites.',
    render: () => <TopicDemo tab="practice" />,
  },
  { id: 'hubtopic-loading', title: 'Topic: loading', role: 'student', render: () => <TopicLoading /> },
  {
    id: 'hubtopic-503',
    title: 'Topic: no accounts on this server',
    role: 'student',
    note: 'A 503 from the memory server: calm, the sentence as sent.',
    render: () => <HubTrouble error={NO_ACCOUNTS} what="This topic" />,
  },
  { id: 'hubtopic-401', title: 'Topic: signed out', role: 'student', render: () => <HubTrouble error={SIGNED_OUT} what="This topic" /> },
  {
    id: 'hubtopic-404',
    title: 'Topic: not found',
    role: 'student',
    note: 'A 404 looks like any missing page.',
    render: () => <HubTrouble error={NO_TOPIC} what="This topic" />,
  },
  {
    id: 'hubtopic-q-hints',
    title: 'Question: two hints opened',
    role: 'student',
    note: 'R2, two of its three hints (what a reload brings back): label, words with formulas, slide, who wrote it; the plan’s `why` with the first.',
    render: () => (
      <Card>
        <QuestionCardView
          question={R2}
          label="Question 4 of 4"
          offer={R2.hints}
          hints={HINTS_OPENED_REPLY.hints}
          hintWhy={HINTS_OPENED_REPLY.why}
          hintLeft={HINTS_OPENED_REPLY.remaining}
          onHint={noop}
          onSubmit={noop}
        />
      </Card>
    ),
  },
  {
    id: 'hubtopic-q-wrong',
    title: 'Question: a wrong answer',
    role: 'student',
    note: 'R1 after one hint: the right answer, the professor’s feedback on the option chosen, the explanation with its label, and the topic’s new state with N.',
    render: () => (
      <Card>
        <QuestionCardView
          question={R1}
          label="Question 1"
          offer={R1.hints}
          hints={[HINT_REPLY.hint]}
          hintWhy={HINT_REPLY.why}
          choice={1}
          onChoose={noop}
          result={ATTEMPT_WRONG_REPLY}
        />
      </Card>
    ),
  },
  {
    id: 'hubtopic-q-kept',
    title: 'Question: kept on this device',
    role: 'student',
    note: 'A 409 “closed for now”: the server’s sentence, and the answer kept to send later. No mark.',
    render: () => (
      <Card>
        <QuestionCardView question={R1} label="Question 3" choice={2} onChoose={noop} kept={{ sentence: CLOSED_KEPT.message }} />
      </Card>
    ),
  },
  {
    id: 'hubtopic-q-phone',
    title: 'Question: a phone kind, partly right',
    role: 'student',
    note: 'Choose for each gap, drawn by the room phone’s own Answer: the verdict with its detail, the word for each gap, the new state. The phone keeps the words picked in its own state, so here the gaps read “Choose”; in use they show what was picked.',
    render: () => (
      <Card>
        <QuestionCardView question={NEXT_PHONE_REPLY.question} label="Question 2" sent={PHONE_RESPONSE} onSubmit={noop} result={ATTEMPT_PHONE_REPLY} />
      </Card>
    ),
  },
  {
    id: 'hubtopic-practice',
    title: 'Practice: a question',
    role: 'student',
    note: 'Recursion practice (asha). The card is live against the samples: open a hint, then answer.',
    render: () => <PracticeView turn={NEXT_REPLY} states={STATES} calls={practiceFake} onResult={noop} onNext={noop} />,
  },
  {
    id: 'hubtopic-practice-phone',
    title: 'Practice: a phone kind',
    role: 'student',
    note: 'The phone’s own dropdown passage inside the hub card, its Submit in the card’s foot.',
    render: () => <PracticeView turn={NEXT_PHONE_REPLY} states={STATES} number={3} calls={practiceFake} onResult={noop} onNext={noop} />,
  },
  {
    id: 'hubtopic-practice-hindi',
    title: 'Practice: in Hindi',
    role: 'student',
    note: 'dev: a reviewed Hindi translation of the question (lang="hi").',
    render: () => <PracticeView turn={NEXT_HI_REPLY} states={STATES} calls={practiceFake} onResult={noop} onNext={noop} />,
  },
  {
    id: 'hubtopic-review',
    title: 'Practice: a review set',
    role: 'student',
    note: 'Question 2 of 5 across two topics, each with its state; one answer kept on this device.',
    render: () => <PracticeView mode="review" turn={NEXT_REVIEW_REPLY} states={STATES} number={2} given={1} kept={1} calls={practiceFake} onResult={noop} onNext={noop} />,
  },
  {
    id: 'hubtopic-review-done',
    title: 'Practice: the set is done',
    role: 'student',
    render: () => <PracticeView mode="review" turn={NEXT_REVIEW_REPLY} states={STATES} given={5} finished onNext={noop} />,
  },
  {
    id: 'hubtopic-practice-closed',
    title: 'Practice: everything closed for now',
    role: 'student',
    note: '`question: null` (asha’s open self-test closes Binary search trees): the server’s message, and the way back.',
    render: () => <PracticeView turn={NEXT_CLOSED_REPLY} states={STATES} onNext={noop} />,
  },
  {
    id: 'hubtopic-practice-503',
    title: 'Practice: no accounts on this server',
    role: 'student',
    render: () => <HubTrouble error={NO_ACCOUNTS} what="Practice" />,
  },
  { id: 'hubtopic-practice-loading', title: 'Practice: loading', role: 'student', render: () => <PracticeLoading /> },
];
