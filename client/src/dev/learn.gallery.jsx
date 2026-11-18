/**
 * The student's phone, in the states that are hard to reach by hand: a level
 * change, a retry, a marked answer, a paused room, the end of a set. Each is
 * the real component inside the real frame, handed sample data. Development
 * only, like every gallery file.
 */

import { useState } from 'react';

import Finish from '../learn/Finish.jsx';
import Join from '../learn/Join.jsx';
import LevelMove from '../learn/LevelMove.jsx';
import Question from '../learn/Question.jsx';
import { Climb, Conn, DockSlot, Hold } from '../learn/parts.jsx';
import { Button, Mark } from '../ui/index.jsx';

/** The phone frame from LearnApp: bar, climb, page and the dock slot. */
function Phone({ view = 'question', level = 'apply', children, hold }) {
  const [dock, setDock] = useState(null);
  return (
    <DockSlot.Provider value={dock}>
      <div className="learn" data-view={view}>
        <header className="ln-bar">
          <div className="ln-bar-in">
            <Mark size={30} />
            <span className="ln-room"><b>K7Q42M</b></span>
            <span className="ln-who">CSF042</span>
            <span className="push"><Conn status="online" /></span>
            {(view === 'question' || view === 'move') && <Button variant="ghost" size="sm">Not me</Button>}
          </div>
        </header>
        {view === 'question' && <Climb level={level} />}
        <main className="ln-page" data-view={view}>{children}</main>
        {hold}
        <footer className="ln-dock" ref={setDock} />
      </div>
    </DockSlot.Provider>
  );
}

const MCQ = {
  _id: 'sample-mcq',
  kind: 'mcq',
  bloom: 'apply',
  topic: 'The Calvin cycle',
  text: 'A plant is kept in bright light but with no carbon dioxide. Which stage of photosynthesis stops first?',
  options: [
    'The light-dependent reactions in the thylakoid',
    'Carbon fixation in the Calvin cycle',
    'The splitting of water',
    'The absorption of light by chlorophyll',
  ],
};
const ORDER = {
  _id: 'sample-order',
  kind: 'order',
  bloom: 'analyse',
  topic: 'Light reactions',
  text: 'Put the steps of the light-dependent reactions in order.',
  items: ['Electrons pass along the transport chain', 'Light excites chlorophyll', 'ATP and NADPH are formed', 'Water is split'],
};

const noop = () => {};
const ask = (question, index, extra = {}) => (
  <Question
    item={{ question, index, reason: '' }}
    result={null}
    awaiting={false}
    sent={null}
    level="apply"
    trail={['understand', 'understand', 'apply', 'apply', 'apply']}
    auto={false}
    onSubmit={noop}
    onNext={noop}
    {...extra}
  />
);

const SCREENS = [
  {
    id: 'phone-join',
    title: 'Student phone: join',
    el: <Join initialCode="K7Q42M" initialRoll="" initialName="" remembered={false} busy={false} error="" lead="" status="online" onJoin={noop} onForget={noop} />,
  },
  {
    id: 'phone-question',
    title: 'Student phone: a question',
    el: <Phone>{ask(MCQ, 6, { triesLeft: 2 })}</Phone>,
  },
  {
    id: 'phone-retry',
    title: 'Student phone: not quite, one more go',
    el: <Phone>{ask(MCQ, 6, { retry: { triesLeft: 1, detail: '' }, triesLeft: 2 })}</Phone>,
  },
  {
    id: 'phone-order',
    title: 'Student phone: put these in order',
    el: <Phone level="analyse">{ask(ORDER, 9)}</Phone>,
  },
  {
    id: 'phone-correct',
    title: 'Student phone: marked correct',
    el: (
      <Phone>
        {ask(MCQ, 6, {
          sent: 1,
          result: { correct: true, score: 1, solution: 1, reason: 'Three right at Apply in a row. One more and your questions step up.' },
        })}
      </Phone>
    ),
  },
  {
    id: 'phone-wrong',
    title: 'Student phone: marked wrong',
    el: (
      <Phone>
        {ask(MCQ, 6, {
          sent: 0,
          result: { correct: false, score: 0, solution: 1, detail: 'The light reactions carry on without carbon dioxide.', reason: 'Staying at Apply. Your next question is another Apply one.' },
        })}
      </Phone>
    ),
  },
  {
    id: 'phone-up',
    title: 'Student phone: moving up a level',
    el: (
      <Phone view="move">
        <LevelMove result={{ previousLevel: 'apply', workingLevel: 'analyse', reason: '4 of your last 5 Apply questions were right, at 80%. Your questions now ask you to analyse.' }} busy={false} onNext={noop} />
      </Phone>
    ),
  },
  {
    id: 'phone-down',
    title: 'Student phone: re-aiming down a level',
    el: (
      <Phone view="move">
        <LevelMove result={{ previousLevel: 'analyse', workingLevel: 'apply', reason: '2 of your last 5 Analyse questions were right. Your next ones come back to Apply to firm it up.' }} busy={false} onNext={noop} />
      </Phone>
    ),
  },
  {
    id: 'phone-paused',
    title: 'Student phone: teacher paused the room',
    el: (
      <Phone hold={<Hold icon="pause" title="Your teacher paused the room">Nothing is lost. Every answer is saved, and so is the question you are on. When the class starts again you carry on from here. There is nothing to tap and no reason to leave this page.</Hold>}>
        {ask(MCQ, 6)}
      </Phone>
    ),
  },
  {
    id: 'phone-done',
    title: 'Student phone: set complete',
    el: (
      <Phone view="done">
        <Finish
          ending="exhausted"
          onLeave={noop}
          profile={{
            workingLevel: 'analyse',
            total: { seen: 14, correct: 10 },
            levels: {
              remember: { seen: 3, correct: 3 },
              understand: { seen: 4, correct: 3 },
              apply: { seen: 5, correct: 3 },
              analyse: { seen: 2, correct: 1 },
            },
          }}
        />
      </Phone>
    ),
  },
];

export default SCREENS.map(({ el, ...entry }) => ({ ...entry, role: null, render: () => el }));
