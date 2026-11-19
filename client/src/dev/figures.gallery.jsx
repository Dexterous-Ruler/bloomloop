/**
 * Batch 8 figures, drawn from figures the b8-vis server really drew
 * (dev/samples-b8-figures.js, from POST /api/figures/preview): every spec type
 * on its light card, the phone's question with a figure, the hub's question
 * card, stepped figures for a lesson, the answer review screen and the bank's
 * "Print figures". Development only, like every gallery file.
 *
 * B1b (projector and wall) adds its own entries to this file too.
 */

import { useEffect, useRef, useState } from 'react';

import '../styles/hub.css';
import '../styles/hub-topic.css';
import { ReviewScreen } from '../account/Review.jsx';
import HubPage from '../hub/HubPage.jsx';
import { QuestionCardView } from '../hub/QuestionCard.jsx';
import Figure from '../learn/Figure.jsx';
import Question from '../learn/Question.jsx';
import { Climb, Conn, DockSlot } from '../learn/parts.jsx';
import AccountShell from '../shell/AccountShell.jsx';
import Bank from '../teach/Bank.jsx';
import FigureSteps from '../ui/FigureSteps.jsx';
import { Button, Mark } from '../ui/index.jsx';
import { STAFF, lessonFigure, projectorFigure, studentFigure } from './samples-b8-figures.js';

const noop = () => {};

/* ------------------------------------------------------------- frames */

/** The phone frame from LearnApp: bar, climb, page and the dock slot. */
function Phone({ level = 'apply', children }) {
  const [dock, setDock] = useState(null);
  return (
    <DockSlot.Provider value={dock}>
      <div className="learn" data-view="question">
        <header className="ln-bar">
          <div className="ln-bar-in">
            <Mark size={30} />
            <span className="ln-room"><b>K7Q42M</b></span>
            <span className="ln-who">CSF042</span>
            <span className="push"><Conn status="online" /></span>
            <Button variant="ghost" size="sm">Not me</Button>
          </div>
        </header>
        <Climb level={level} />
        <main className="ln-page" data-view="question">{children}</main>
        <footer className="ln-dock" ref={setDock} />
      </div>
    </DockSlot.Provider>
  );
}

const ask = (question, index = 3) => (
  <Question
    item={{ question, index, reason: '' }}
    result={null}
    awaiting={false}
    sent={null}
    level={question.bloom}
    trail={['understand', 'understand', 'apply', 'apply']}
    auto={false}
    onSubmit={noop}
    onNext={noop}
  />
);

/** Opens every "Describe" and "Show the data" inside it, to show what they hold. */
function Opened({ children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelectorAll('details').forEach((d) => { d.open = true; }); }, []);
  return <div ref={ref} style={{ display: 'contents' }}>{children}</div>;
}

const PROVENANCE = { by: 'professor', checked: true, text: 'Written by your professor.' };

/* ------------------------------------------------------- every type */

const TYPES = [
  ['plot', 'Plot: a line, a parabola, a step function, a point, an arrow and shading'],
  ['bar', 'Chart: bar, two series'],
  ['line', 'Chart: line'],
  ['pie', 'Chart: pie'],
  ['histogram', 'Chart: histogram'],
  ['dot', 'Chart: dot plot'],
  ['box', 'Chart: box plot'],
  ['numberline', 'Number line: a point, an open interval and a ray'],
  ['geometry', 'Geometry: a triangle, an angle and an arrow'],
  ['optics', 'Geometry: convex lens ray diagram'],
  ['timeline', 'Timeline'],
  ['diagram', 'Diagram: flowchart (Graphviz)'],
  ['devanagari', 'Diagram: mind map in Marathi'],
  ['molecule', 'Molecule: ethanol (RDKit)'],
  ['pattern', 'Pattern'],
  ['stack', 'Call stack'],
];

function EveryType() {
  return (
    <AccountShell current="bank" crumb="Figures" title="Every figure type" sub="As a phone, the hub and the review screen show them: the server’s drawing on its own card, then Describe and Show the data.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 24, alignItems: 'start' }}>
        {TYPES.map(([name, label]) => (
          <section key={name} className="card card-pad stack stack-2" aria-label={label}>
            <h2 className="t-label">{label}</h2>
            <Figure figure={studentFigure(name)} />
          </section>
        ))}
      </div>
    </AccountShell>
  );
}

/* -------------------------------------------------------- the phone */

const PLOT_Q = {
  _id: 'fig-plot-q',
  kind: 'multi',
  bloom: 'analyse',
  topic: 'Linear and quadratic functions',
  provenance: PROVENANCE,
  stimulus: studentFigure('plot'),
  text: 'Which of these are true of the graph between x = −1 and x = 1?',
  options: ['The line is above the parabola', 'The shading is under the parabola', 'A lies on the parabola', 'The two graphs cross there'],
};
const BAR_Q = {
  _id: 'fig-bar-q',
  kind: 'mcq',
  bloom: 'remember',
  topic: 'Reading charts',
  provenance: PROVENANCE,
  stimulus: studentFigure('bar'),
  text: 'Which month had the most rain in 2025?',
  options: ['June', 'July', 'August', 'None of them'],
};
const MARATHI_Q = {
  _id: 'fig-mr-q',
  kind: 'truefalse',
  bloom: 'understand',
  topic: 'प्रकाश संश्लेषण',
  provenance: PROVENANCE,
  stimulus: studentFigure('devanagari'),
  text: 'The mind map links sunlight to photosynthesis.',
};
const PENDING_Q = {
  ...BAR_Q,
  _id: 'fig-pending-q',
  // What renderFigure gives in the moment before the drawing engines load.
  stimulus: { kind: 'figure', type: 'diagram', title: 'Figure', svg: null, description: 'This figure is still being prepared: try again in a moment.', table: null },
};

/* ---------------------------------------------------------- the hub */

const TIMELINE_Q = {
  _id: 'fig-timeline-q',
  kind: 'mcq',
  bloom: 'remember',
  topic: 'The freedom struggle',
  provenance: PROVENANCE,
  stimulus: studentFigure('timeline'),
  text: 'Which event on the timeline came first?',
  options: ['Salt March', 'Jallianwala Bagh', 'Non-cooperation begins', 'Independence'],
};

function HubCard({ children }) {
  return (
    <HubPage crumb="Learning Hub · Question card" title="One question">
      <div style={{ maxWidth: 720 }}>{children}</div>
    </HubPage>
  );
}

function Lesson({ name, words }) {
  return (
    <HubPage crumb="Learning Hub · Lesson step" title="A stepped figure">
      <div className="stack stack-3" style={{ maxWidth: 720 }}>
        <p>{words}</p>
        <FigureSteps figure={lessonFigure(name)} />
      </div>
    </HubPage>
  );
}

/* -------------------------------------------------- the review screen */

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const ROOM = { code: 'FIG4KX', title: 'Unit II: Functions and graphs', status: 'open' };
const reviewItem = (n, figure, text, response, rubric, points) => ({
  answerId: `fa${String(n).padStart(22, '0')}`,
  room: { ...ROOM },
  student: { rollNo: `21MA0${n}`, name: ['Asha Rao', 'Kabir Mehta', 'Tara Menon'][n - 1] },
  topic: 'Functions and graphs',
  bloom: 'analyse',
  kind: 'open',
  // The snapshot keeps the spec; the reply draws it (figureForStaff) as `figure`.
  question: { id: `fq${n}`, text, rubric, modelAnswer: null, stimulus: { kind: 'figure', spec: { type: figure.type } }, figure },
  response,
  autoCorrect: points / rubric.length >= 0.7,
  autoScore: Math.round((points / rubric.length) * 1000) / 1000,
  autoDetail: `${points}/${rubric.length} rubric points`,
  correct: points / rubric.length >= 0.7,
  score: Math.round((points / rubric.length) * 1000) / 1000,
  reviewStatus: 'provisional',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: '',
  attempt: 1,
  servedAt: minsAgo(30 + n * 4),
  answeredAt: minsAgo(28 + n * 4),
});
const REVIEW_ITEMS = [
  reviewItem(1, STAFF.plot, 'Compare the line f and the parabola between x = −1 and x = 1. Which is higher, and how does the shading show it?',
    'The line is above the parabola there, since at x = 0 the line is at 1 and the parabola is at −4. The shading sits under the curve from −1 to 1.',
    ['the line is higher on that interval', 'a value compared at one x', 'the shading is under the parabola'], 3),
  reviewItem(2, STAFF.molecule, 'From the structure, explain why ethanol mixes with water.',
    'It has an OH group that can hydrogen bond with water.', ['the OH group', 'hydrogen bonding with water', 'the short carbon chain'], 2),
  // A snapshot whose figure no longer draws: the description stands in, with the reason.
  reviewItem(3, {
    kind: 'figure', type: 'molecule', title: 'Figure', svg: null, description: 'This figure could not be drawn.', table: null,
    ok: false, reason: 'The structure "C1CC" is not a molecule the chemistry engine can read: check the SMILES string.', parts: [], stepCount: 0, steps: [],
  }, 'Name the functional group shown.', 'An alcohol.', ['names the hydroxyl group'], 0),
];
const wait = (value, ms = 300) => new Promise((r) => { setTimeout(() => r(value), ms); });
const REVIEW_SERVICES = {
  listSessions: () => wait({ rooms: [{ ...ROOM, startedAt: minsAgo(60) }] }),
  reviewQueue: ({ status = 'provisional' } = {}) => wait({
    items: REVIEW_ITEMS.filter((i) => status === 'all' || i.reviewStatus === status), status, limit: 50, hasMore: false, next: null,
  }),
  reviewItem: (id) => wait({ item: REVIEW_ITEMS.find((i) => i.answerId === id), log: [] }),
  review: () => Promise.reject(Object.assign(new Error('Decisions are not saved in this sample.'), { status: 400 })),
};

/* ------------------------------------------------------------ the bank */

const CONTENT = { contentId: 'g-fig-content', title: 'Unit II: Functions and graphs', kind: 'pptx', topics: ['Linear and quadratic functions', 'Reading charts'] };
const bankQ = (n, over) => ({
  _id: `fb${String(n).padStart(22, '0')}`,
  status: 'active',
  source: 'teacher',
  model: null,
  sourceRef: null,
  checks: null,
  createdBy: null,
  approvedBy: null,
  approvedAt: '2026-11-19T08:00:00.000Z',
  misconceptions: [],
  ...over,
});
const BANK = {
  kinds: { forLevel: { remember: ['mcq', 'truefalse'], understand: ['match'], apply: ['blank'], analyse: ['multi'], evaluate: ['order'], create: ['open'] }, label: {} },
  questions: [
    bankQ(1, {
      ...PLOT_Q, _id: undefined, answerIdxs: [0, 1],
      stimulus: { kind: 'figure', spec: { type: 'plot' } }, figure: STAFF.plot,
    }),
    bankQ(2, {
      ...BAR_Q, _id: undefined, answerIdx: 1,
      stimulus: { kind: 'figure', spec: { type: 'chart' } }, figure: STAFF.bar,
    }),
    bankQ(3, { topic: 'Reading charts', kind: 'truefalse', bloom: 'remember', text: 'A pie chart shows parts of a whole.', answerBool: true }),
  ].map((q, i) => ({ ...q, _id: `fb${String(i + 1).padStart(22, '0')}` })),
};

function BankDemo() {
  const [bank, setBank] = useState(BANK);
  return <Bank content={CONTENT} selected={CONTENT.topics} bank={bank} onBank={setBank} onPhase={noop} onBack={noop} onNext={noop} />;
}

/* ----------------------------------------------------------- entries */

export default [
  {
    id: 'fig-types',
    title: 'Figures: every type',
    note: 'All nine spec types (six chart kinds, a lens ray diagram, a Marathi mind map), each the server’s own SVG on its light card.',
    render: () => <EveryType />,
  },
  {
    id: 'fig-phone-plot',
    title: 'Figures: a question on the phone',
    note: 'A plot as the question’s stimulus: under the fold, uncapped, with Describe and Show the data.',
    render: () => <Phone level="analyse">{ask(PLOT_Q)}</Phone>,
  },
  {
    id: 'fig-phone-data',
    title: 'Figures: phone, description and data open',
    note: 'The bar chart with Describe and Show the data opened: the description is the SVG’s own, the data a real table.',
    render: () => <Phone level="remember"><Opened>{ask(BAR_Q)}</Opened></Phone>,
  },
  {
    id: 'fig-phone-marathi',
    title: 'Figures: phone, a Marathi diagram',
    note: 'Devanagari labels measured by grapheme cluster on the server.',
    render: () => <Phone level="understand">{ask(MARATHI_Q)}</Phone>,
  },
  {
    id: 'fig-phone-nosvg',
    title: 'Figures: phone, no drawing yet',
    note: 'svg null: the description alone (here the sentence the server sends before its drawing engines load).',
    render: () => <Phone level="remember">{ask(PENDING_Q)}</Phone>,
  },
  {
    id: 'fig-hub-question',
    title: 'Figures: hub question card',
    role: 'student',
    note: 'QuestionCard renders the stimulus through learn/Stimulus.jsx, so it gets the figure too.',
    render: () => <HubCard><QuestionCardView question={TIMELINE_Q} label="Question 2 of 4" onSubmit={noop} onChoose={noop} /></HubCard>,
  },
  {
    id: 'fig-steps-diagram',
    title: 'Figures: stepped flowchart',
    role: 'student',
    note: 'A lesson’s figure step (H9c): Back, Next, then Replay on the last step; a caption per step, dots, every frame in the payload.',
    render: () => <Lesson name="diagram" words="Follow the factorial one decision at a time." />,
  },
  {
    id: 'fig-steps-plot',
    title: 'Figures: stepped plot',
    role: 'student',
    note: 'Two steps, each lighting up parts of the same plot.',
    render: () => <Lesson name="plot" words="Look at the line first, then where A sits." />,
  },
  {
    id: 'fig-steps-stack',
    title: 'Figures: stepped call stack',
    role: 'student',
    note: 'Each step is the stack at that moment.',
    render: () => <Lesson name="stack" words="Watch the stack while fact(3) runs." />,
  },
  {
    id: 'fig-at-step',
    title: 'Figures: at a step, as the projector sends it',
    note: 'figure.step and stepCount from the projector: the line under the card says where it is, with the step’s caption.',
    render: () => (
      <AccountShell current="bank" crumb="Figures" title="A figure at step 1 of 2">
        <div style={{ maxWidth: 640 }}><Figure figure={projectorFigure('diagram', 1)} /></div>
      </AccountShell>
    ),
  },
  {
    id: 'fig-review',
    title: 'Figures: answer review',
    role: 'professor',
    note: 'question.figure drawn from the answer’s snapshot: a plot, a molecule, and one that no longer draws (its reason under the description).',
    render: () => <ReviewScreen services={REVIEW_SERVICES} initialOpen={REVIEW_ITEMS[0].answerId} />,
  },
  {
    id: 'fig-bank-print',
    title: 'Figures: Print figures on the bank',
    role: 'professor',
    note: 'Shown only when an approved question carries a figure. It opens GET /api/figures/content/:id/print from a blob, with credentials in headers (here it has no server, so it says so).',
    render: () => <BankDemo />,
  },
];
