/**
 * The Learning Hub's batch 9 parts, drawn from replies of the batch 9 server
 * (captured on the hub harness at 53ccc4b, as asha, while a room held the
 * Recursion trees and Memoisation questions): a question closed by a class
 * still running, a resent answer held, held hints, a practice drawing, and the
 * two "nothing to practise" messages. Development only.
 */

import { useState } from 'react';

import '../styles/hub.css';
import '../styles/hub-topic.css';
import '../styles/hub-practice.css';
import HubPage from '../hub/HubPage.jsx';
import { PracticeView } from '../hub/Practice.jsx';
import QuestionCard, { QuestionCardView } from '../hub/QuestionCard.jsx';

const noop = () => {};
const wait = (value, ms = 400) => new Promise((r) => { setTimeout(() => r(value), ms); });

/* ------------------------------------------------------------- replies */

const CHAPTER = { id: '04e0a8f711e0bb656615e991', title: 'Recursion and the call stack', titleHtml: 'Recursion and the call stack' };
const TREES = { id: 'e88c467363ada53b73d453c0', name: 'Recursion trees', nameHtml: 'Recursion trees', chapter: CHAPTER };
const MEMO = { id: '06740ff3de44c93bf06d2eba', name: 'Memoisation', nameHtml: 'Memoisation', chapter: CHAPTER };
const BY_PROFESSOR = { by: 'professor', checked: true, text: 'Written by your professor.' };

/** GET /hub/practice/next: RT2, as served. */
const RT2 = {
  _id: 'f1c7bb8ef56261d71f15fe34',
  text: 'Naive `fib(n)` calls `fib(n - 1)` and `fib(n - 2)`; `fib(0)` and `fib(1)` return at once. How many calls does `fib(4)` make in all, counting itself?',
  bloom: 'apply', topic: 'Recursion trees', kind: 'numeric', source: 'teacher', unit: '', provenance: BY_PROFESSOR, rich: {},
};

/** The drawing question, as served (allowText, with the long answer's limits). */
const DRAWING_Q = {
  _id: '915766cd7df64a455501103c',
  text: 'Draw the recursion tree for fib(4), one node per call, and say in a line how many calls it makes.',
  bloom: 'apply', topic: 'Recursion trees', kind: 'drawing', source: 'teacher', allowText: true, maxWords: 600, maxChars: 9000,
  provenance: BY_PROFESSOR, rich: {},
};

/** POST /hub/practice/attempts while a class runs: the 409, kept on the device. */
const CLOSED_409 = 'That question is part of a class that is still running, so it stays closed here. It opens when your professor closes the class.';

const STATE_NOT_SURE = {
  state: 'not-sure', label: 'Not sure yet', answers: 1, attempts: 1, provisional: true, pRight: null, outOf10: null,
  estimateState: 'not-sure', sentence: 'Not sure yet: this rests on 1 answer. After 3 answers you get a first estimate.',
  review: { due: false, when: 'in 1 minute', sessions: 1, lastRating: 'again' },
};

/**
 * A resent answer (its id already stored) whose question a running class now
 * holds: the earlier mark with held and heldNote, and no key, explanation or
 * feedback. Captured from a categorise resend; the mark is put in the numeric
 * question's terms here.
 */
const HELD = {
  attempt: { id: 'bc131fc8d2821344fc9a7648', attemptId: '0708aead-8de2-4d1b-85d2-a199415086a9', mode: 'practice', language: 'en', hintsUsed: 0 },
  duplicate: true,
  correct: true,
  score: 1,
  detail: '',
  solution: null,
  explanation: null,
  optionFeedback: [],
  topic: { ...TREES, state: STATE_NOT_SURE },
  held: true,
  heldNote: 'This question is part of a class that is still running, so what was right, and why, is shown here once your professor closes the class.',
};

/** GET /hub/practice/hints for a question a running class holds. */
const HINTS_HELD = { hints: [], hintsUsed: 1, remaining: 0, why: '', note: CLOSED_409, held: true };

/** A practice drawing's reply: kept, not marked. */
const DRAWING_REPLY = {
  attempt: { id: '68e589d61d7ac10b287b3840', attemptId: '5033bbaf-1c5f-43f9-9885-47265d8e2662', mode: 'practice', language: 'en', hintsUsed: 0 },
  duplicate: false,
  correct: null,
  score: null,
  detail: 'not marked: a drawing',
  notMarked: true,
  note: 'Your drawing is saved with your practice. Drawings are not marked by the machine, so this one does not count either way; compare it with your notes, or show it to your professor.',
  solution: null,
  explanation: null,
  optionFeedback: [],
  topic: {
    ...TREES,
    state: {
      ...STATE_NOT_SURE, state: 'needs-review', label: 'Needs review',
      sentence: 'Due for review: a short practice set now helps you keep this topic. Not sure yet: this rests on 1 answer. After 3 answers you get a first estimate.',
      review: { due: true, when: 'now', sessions: 1, lastRating: 'again' },
    },
  },
};

/** GET /hub/practice/next with nothing open: ALL_CLOSED, then DRAWINGS_DONE. */
const ALL_CLOSED = {
  mode: 'practice', question: null, topics: [MEMO],
  message: 'Every question you could practise here is closed for now: part of a class that is still running, on a self-test you have not handed in, or the one your Get Ready check is asking. Come back once that is done.',
};
const DRAWINGS_DONE = {
  mode: 'practice', question: null, topics: [TREES],
  message: 'The questions left here are drawings you have already drawn as many times as practice keeps. Show your drawings to your professor, or practise another topic.',
};

const STATES = { [TREES.id]: STATE_NOT_SURE, [MEMO.id]: { ...STATE_NOT_SURE, state: 'not-started', label: 'Not started', answers: 0 } };

/* ------------------------------------------------------------- parts */

function Card({ children }) {
  return (
    <HubPage crumb="Learning Hub · Question card" title="One question">
      <div style={{ maxWidth: 720 }}>{children}</div>
    </HubPage>
  );
}

/** Live: draw on the board and send; the sample answers with the reply a practice drawing got. */
function DrawingLive() {
  return (
    <Card>
      <QuestionCard
        question={DRAWING_Q}
        slot="practice:gallery-drawing"
        label="Question 1"
        offer={{ available: 0, note: 'Your professor has not added hints to this question.' }}
        send={() => wait(DRAWING_REPLY)}
        askHint={() => wait({ hint: null })}
        opened={() => wait({ hints: [] })}
      />
    </Card>
  );
}

/** A reload of a question whose hints were opened: the read comes back held. */
function HintsHeld() {
  const slot = 'practice:gallery-held-hints';
  useState(() => { try { sessionStorage.setItem(`bloomloop.hubAttempt:${slot}`, 'asha-pr-0014'); } catch { /* storage off */ } return 0; });
  return (
    <Card>
      <QuestionCard
        question={RT2}
        slot={slot}
        label="Question 2"
        offer={{ available: 2, note: 'Hints are written by your professor.' }}
        send={() => wait(null).then(() => { throw Object.assign(new Error(CLOSED_409), { status: 409, kept: true, closed: true }); })}
        askHint={() => wait(null).then(() => { throw Object.assign(new Error(CLOSED_409), { status: 409 }); })}
        opened={() => wait(HINTS_HELD)}
      />
    </Card>
  );
}

/* ------------------------------------------------------------- entries */

export default [
  {
    id: 'hub9-closed-409',
    title: 'Question: part of a class still running',
    role: 'student',
    note: 'The answer reached the server while a room held the question: the 409 sentence, and the answer kept on this device, sent once the class closes.',
    render: () => <Card><QuestionCardView question={RT2} label="Question 1" sent={9} kept={{ sentence: CLOSED_409 }} onSubmit={noop} /></Card>,
  },
  {
    id: 'hub9-held-resend',
    title: 'Question: a resent answer, held',
    role: 'student',
    note: 'An answer already stored, sent again while a class holds its question: the earlier mark and heldNote, with no answer, explanation or feedback.',
    render: () => <Card><QuestionCardView question={RT2} label="Question 1" sent={9} result={HELD} onSubmit={noop} /></Card>,
  },
  {
    id: 'hub9-hints-held',
    title: 'Question: hints held',
    role: 'student',
    note: 'A reload of a question whose hints were opened, while a class holds it: the hints read comes back held, and its note stands where the hint button was.',
    render: () => <HintsHeld />,
  },
  {
    id: 'hub9-drawing',
    title: 'Practice: a drawing',
    role: 'student',
    note: 'Live: draw, add a line of words and send. The board hands up { image, text }; the sample answers with a practice drawing’s reply: the board’s note that it is not marked, no verdict, and the topic after.',
    render: () => <DrawingLive />,
  },
  {
    id: 'hub9-all-closed',
    title: 'Practice: every question held by a class',
    role: 'student',
    note: 'practice/next with nothing open: the server’s ALL_CLOSED message.',
    render: () => <PracticeView turn={ALL_CLOSED} states={STATES} onNext={noop} />,
  },
  {
    id: 'hub9-drawings-done',
    title: 'Practice: only drawings already drawn',
    role: 'student',
    note: 'practice/next when only drawings the student has sent 10 times are left: the server’s DRAWINGS_DONE message.',
    render: () => <PracticeView turn={DRAWINGS_DONE} states={STATES} onNext={noop} />,
  },
];
