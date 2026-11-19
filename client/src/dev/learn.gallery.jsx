/**
 * The student's phone, in the states that are hard to reach by hand: a level
 * change, a retry, a marked answer, a paused room, the end of a set. Each is
 * the real component inside the real frame, handed sample data. Development
 * only, like every gallery file.
 */

import { useEffect, useRef, useState } from 'react';

import ClassVote from '../learn/ClassVote.jsx';
import Finish from '../learn/Finish.jsx';
import Join from '../learn/Join.jsx';
import LevelMove from '../learn/LevelMove.jsx';
import Question from '../learn/Question.jsx';
import { Climb, Conn, DockSlot, Hold, Kept, Offline } from '../learn/parts.jsx';
import { Button, Mark, Note } from '../ui/index.jsx';

/** The phone frame from LearnApp: bar, climb, page and the dock slot. */
function Phone({ view = 'question', level = 'apply', children, hold, offline = false }) {
  const [dock, setDock] = useState(null);
  return (
    <DockSlot.Provider value={dock}>
      <div className="learn" data-view={view}>
        <header className="ln-bar">
          <div className="ln-bar-in">
            <Mark size={30} />
            <span className="ln-room"><b>K7Q42M</b></span>
            <span className="ln-who">CSF042</span>
            <span className="push"><Conn status={offline ? 'offline' : 'online'} /></span>
            {(view === 'question' || view === 'move') && <Button variant="ghost" size="sm">Not me</Button>}
          </div>
          {offline && <Offline />}
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
  provenance: { by: 'not-ai', checked: true, text: "Made without AI from your professor's material, and checked by your professor." },
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

const OPEN = {
  _id: 'sample-open',
  kind: 'open',
  bloom: 'evaluate',
  topic: 'Factors affecting the rate',
  text: 'A farmer adds carbon dioxide to a greenhouse on a cloudy day. Will it raise the rate of photosynthesis? Justify your answer.',
  rubric: ['light is the limiting factor', 'extra carbon dioxide has little effect', 'names the evidence'],
};

const noop = () => {};

/* Phase 5 and the owner's decisions of 19 Nov 2026. Shapes and sentences as
   docs/API.md gives them. */
const TAPS = [{ id: 'sure', label: 'Sure' }, { id: 'think_so', label: 'Think so' }, { id: 'guessing', label: 'Guessing' }];

const LINK_NOTE = 'This room is not linked to your account, so your answers here will not appear in your history. Check that you are signed in and typed your own roll number.';

const CQ = {
  id: 'cq-sample',
  seq: 1,
  round: 1,
  state: 'open',
  voting: true,
  // Since the review fixes `question._id` is the class question's own id.
  question: { _id: 'cq-sample', text: 'Which layer routes packets between networks?', bloom: 'remember', topic: 'Layers', kind: 'mcq', source: 'llm', options: ['Link', 'Transport', 'Network', 'Physical'], provenance: { by: 'ai', checked: false, text: 'Written with AI help and chosen by your professor.' } },
  options: [{ key: 'A', label: 'Link' }, { key: 'B', label: 'Transport' }, { key: 'C', label: 'Network' }, { key: 'D', label: 'Physical' }],
  confidence: TAPS,
  mine: null,
  message: 'Your professor has put this question to the whole class. Choose your answer and say how sure you are.',
};
const CQ_PAUSED = { ...CQ, state: 'paused', voting: false, message: 'Voting is paused. Talk it over with the people around you.' };
const CQ_REVOTE = { ...CQ, round: 2, state: 'revote', voting: true, message: 'Vote again, now that you have talked it over. You can keep your answer or change it.' };
const SAVED = 'Vote saved. You can change it until your professor closes the vote.';

/**
 * A class question that answers its own votes, the way the server does, so the
 * flow can be tried here: pick, tap, send, change. `change` taps another option
 * after it mounts, to show a vote being changed before it is sent.
 */
function LiveVote({ q, start = null, change = null, ...rest }) {
  const [mine, setMine] = useState(start);
  const [sending, setSending] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (change === null) return;
    ref.current?.querySelectorAll('.ln-opt')[change]?.click();
  }, [change]);
  const onVote = (response, confidence) => {
    setSending({ response, confidence, state: 'sending' });
    setTimeout(() => { setSending(null); setMine({ response, confidence, message: SAVED }); }, 700);
  };
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      <ClassVote q={q} mine={mine} kept={sending} choices={TAPS} onVote={onVote} onBack={noop} {...rest} />
    </div>
  );
}

/* Phase 7: the outbox, as the student sees it. */
const OUTBOX = [
  { answerId: 'g1', label: 'Which layer routes packets between networks?', status: 'queued' },
  { answerId: 'g2', label: 'Put the steps of the light-dependent reactions in order.', status: 'queued' },
  { answerId: 'g3', label: 'Class question: your vote B', status: 'sent', counted: false, note: 'Your professor has paused the room, so this vote was kept but not counted. Vote again when the room carries on.' },
  { answerId: 'g4', label: 'A plant is kept in bright light but with no carbon dioxide. Which stage of photosynthesis stops first?', status: 'marked' },
  { answerId: 'g5', label: 'Which stage of photosynthesis needs light?', status: 'refused', note: 'The room closed before this reached your teacher.' },
];

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
    id: 'phone-provisional',
    title: 'Student phone: written answer, mark may be reviewed',
    el: (
      <Phone level="evaluate">
        {ask(OPEN, 11, {
          sent: 'On a cloudy day light is low, so adding carbon dioxide will not help much.',
          result: {
            correct: false,
            score: 0.67,
            provisional: true,
            kind: 'open',
            solution: ['light is the limiting factor', 'extra carbon dioxide has little effect', 'names the evidence'],
            detail: '2/3 rubric points',
            reason: 'Staying at Evaluate. Your next question is another Evaluate one.',
          },
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
  // Phase 3.
  {
    id: 'phone-waiting',
    title: 'Student phone: waiting room',
    note: 'Joined a room opened with a waiting room. The sentence is the server’s; the start sends the first question.',
    el: (
      <Phone hold={<Hold icon="clock" title="Waiting to start">You are in. Your professor will start the questions soon - keep this page open.</Hold>}>
        {ask(null, 0)}
      </Phone>
    ),
  },
  {
    id: 'phone-timed',
    title: 'Student phone: a timed question',
    note: 'The room set 60 seconds a question. The phone counts; nothing locks when it runs out.',
    el: <Phone>{ask(MCQ, 3, { timer: 60 })}</Phone>,
  },
  {
    id: 'phone-time-up',
    title: 'Student phone: time is up',
    note: 'Said in words, read out once. Submit works as before, because a late answer is still taken.',
    el: <Phone>{ask({ ...MCQ, _id: 'sample-up' }, 4, { timer: 1 })}</Phone>,
  },
  {
    id: 'phone-teacher-led',
    title: 'Student phone: Teacher-led room',
    note: 'Sent in place of being let in; nothing follows. No profile, no attendance, no questions.',
    el: (
      <Phone view="done">
        <Finish
          ending="teacher-led"
          onLeave={noop}
          led={{ title: 'Trees and traversals', message: 'This class is teacher-led: no answers are taken on phones today. Follow along on the board and answer when your professor asks.' }}
        />
      </Phone>
    ),
  },
  {
    id: 'phone-cap',
    title: 'Student phone: the room’s cap reached',
    note: 'The room asks each student a fixed number of questions; the reason is the server’s.',
    el: (
      <Phone view="done">
        <Finish
          ending="exhausted"
          reason="This room asks each student 10 questions, and you have answered them all."
          onLeave={noop}
          profile={{ workingLevel: 'apply', total: { seen: 10, correct: 7 }, levels: { understand: { seen: 4, correct: 3 }, apply: { seen: 6, correct: 4 } } }}
        />
      </Phone>
    ),
  },
  // The owner's decisions (19 Nov 2026) and Phase 5.
  {
    id: 'phone-link-note',
    title: 'Student phone: signed in, but not linked',
    note: 'A sign-in was sent and could not link. The server’s one sentence, which never says which check failed; shown until hidden.',
    el: (
      <Phone>
        <div className="ln-notes">
          <Note icon="info" role="status">
            {LINK_NOTE}
            <span className="cluster cluster-4 ln-note-acts"><button type="button" className="ln-quiet">Hide this</button></span>
          </Note>
        </div>
        {ask(MCQ, 1, { item: { question: MCQ, index: 1, reason: 'This question is at Apply, the level you are working at.' }, sure: { choices: TAPS, value: null, onChange: noop } })}
      </Phone>
    ),
  },
  {
    id: 'phone-taps',
    title: 'Student phone: how sure, before a single tap',
    note: 'Optional Sure / Think so / Guessing, labels from session:accepted. Above the answer, because a single choice is sent on its tap. A second tap takes it off.',
    el: <Phone>{ask({ ...MCQ, source: 'teacher', provenance: { by: 'professor', checked: true, text: 'Written by your professor.' } }, 2, { sure: { choices: TAPS, value: 'think_so', onChange: noop } })}</Phone>,
  },
  {
    id: 'phone-taps-order',
    title: 'Student phone: how sure, on a built answer',
    note: 'Every kind gets the same row. Sent with the answer as `confidence`; skipping sends nothing.',
    el: <Phone level="analyse">{ask(ORDER, 9, { sure: { choices: TAPS, value: null, onChange: noop } })}</Phone>,
  },
  {
    id: 'phone-next',
    title: 'Student phone: marked, with what comes next',
    note: 'profile.next from server:result: the levels, the answers they rest on, and the server’s sentence. Never a band.',
    el: (
      <Phone level="understand">
        {ask({ ...MCQ, bloom: 'understand' }, 4, {
          sent: 0,
          sure: { choices: TAPS, value: 'sure', onChange: noop },
          result: {
            correct: false,
            score: 0,
            solution: 1,
            reason: 'From your 4 answers so far, your next questions are at Remember and Understand, to build a firm base before the levels above.',
            profile: { next: { levels: ['remember', 'understand'], answers: 4, why: 'From your 4 answers so far, your next questions are at Remember and Understand, to build a firm base before the levels above.' } },
          },
        })}
      </Phone>
    ),
  },
  {
    id: 'phone-cq-open',
    title: 'Student phone: class question, round 1',
    note: 'class:question, voting. The phone’s own question is parked behind it. Try it: pick, tap how sure, send, change.',
    el: <Phone view="class"><LiveVote key="open" q={CQ} /></Phone>,
  },
  {
    id: 'phone-cq-saved',
    title: 'Student phone: class question, vote saved',
    note: 'class:vote said back: what was sent and the server’s sentence. Never right or wrong.',
    el: <Phone view="class"><LiveVote key="saved" q={CQ} start={{ response: 2, confidence: 'sure', message: SAVED }} /></Phone>,
  },
  {
    id: 'phone-cq-change',
    title: 'Student phone: class question, changing the vote',
    note: 'The vote in force stays tagged until the new one is sent. Each vote goes with a fresh answerId.',
    el: <Phone view="class"><LiveVote key="change" q={CQ} start={{ response: 1, confidence: 'think_so', message: SAVED }} change={2} /></Phone>,
  },
  {
    id: 'phone-cq-paused',
    title: 'Student phone: class question, paused to discuss',
    note: 'state paused: the server’s sentence and this phone’s own vote. Nothing to tap.',
    el: <Phone view="class"><ClassVote q={CQ_PAUSED} mine={{ response: 1, confidence: 'think_so' }} choices={TAPS} onVote={noop} onBack={noop} /></Phone>,
  },
  {
    id: 'phone-cq-paused-none',
    title: 'Student phone: class question, paused, no vote',
    el: <Phone view="class"><ClassVote q={CQ_PAUSED} choices={TAPS} onVote={noop} onBack={noop} /></Phone>,
  },
  {
    id: 'phone-cq-revote',
    title: 'Student phone: class question, re-vote',
    note: 'Round 2: vote again. The first vote is shown for reference, not chosen for them.',
    el: <Phone view="class"><LiveVote key="revote" q={CQ_REVOTE} first={{ response: 1, confidence: 'think_so' }} /></Phone>,
  },
  {
    id: 'phone-cq-late',
    title: 'Student phone: class question, vote not counted',
    note: 'class:vote counted false: its sentence, as given. The vote in force is unchanged.',
    el: (
      <Phone view="class">
        <ClassVote
          q={CQ_PAUSED}
          mine={{ response: 1, confidence: 'think_so' }}
          note="Voting had closed for that round, so this vote was kept but not counted."
          choices={TAPS}
          onVote={noop}
          onBack={noop}
        />
      </Phone>
    ),
  },
  {
    id: 'phone-cq-revealed',
    title: 'Student phone: class question closed, answer shown',
    note: 'class:closed with revealed: the key, and this phone’s last vote, then back to its own question.',
    el: (
      <Phone view="class">
        <ClassVote
          q={CQ_REVOTE}
          end={{ id: 'cq-sample', revealed: true, answer: 2, correct: ['C'], message: 'Voting is closed, and the answer is shown. Back to your own questions now.' }}
          mine={{ response: 1, confidence: 'think_so' }}
          first={{ response: 1, confidence: 'sure' }}
          choices={TAPS}
          onVote={noop}
          onBack={noop}
        />
      </Phone>
    ),
  },
  {
    id: 'phone-cq-closed',
    title: 'Student phone: class question closed, answer not shown',
    note: 'class:closed without the key: straight back to the parked question, with the server’s sentence.',
    el: (
      <Phone>
        <div className="ln-notes"><Note icon="users" role="status">Voting is closed. Back to your own questions now.</Note></div>
        {ask(MCQ, 6, { sure: { choices: TAPS, value: null, onChange: noop } })}
      </Phone>
    ),
  },
  {
    id: 'phone-done-next',
    title: 'Student phone: set complete, signed in',
    note: 'profile.next.why on the finish, and the line for a room linked to the signed-in student.',
    el: (
      <Phone view="done">
        <Finish
          ending="exhausted"
          linked
          onLeave={noop}
          profile={{
            workingLevel: 'apply',
            total: { seen: 9, correct: 6 },
            levels: { understand: { seen: 4, correct: 3 }, apply: { seen: 5, correct: 3 } },
            next: { levels: ['apply'], answers: 5, provisional: false, why: 'Your next questions are at Apply, from your last 5 answers there.' },
            masteryBasis: [
              { level: 'understand', answers: 4, correct: 3, mastered: true, provisional: false, sentence: "3 of 4 right at Understand: at or above this room's goal, so Understand counts as mastered." },
              { level: 'apply', answers: 5, correct: 3, mastered: false, provisional: false, sentence: "3 of 5 right at Apply: below this room's goal so far." },
            ],
          }}
        />
      </Phone>
    ),
  },
  // Phase 7, "First": the outbox and the offline line.
  {
    id: 'phone-offline-saved',
    title: 'Student phone: offline, answer saved on this phone',
    note: 'The connection line under the bar, and the answer held in the outbox. Its Submit goes; nothing says right or wrong.',
    el: <Phone offline>{ask(MCQ, 3, { sent: 1, save: { state: 'queued' }, sure: { choices: TAPS, value: 'sure', onChange: noop } })}</Phone>,
  },
  {
    id: 'phone-offline-built',
    title: 'Student phone: offline, a built answer saved',
    note: 'A kind with a Submit: held on this phone, the Submit is gone rather than spinning for the whole outage.',
    el: <Phone offline level="analyse">{ask(ORDER, 9, { sent: [1, 0, 3, 2], save: { state: 'queued' } })}</Phone>,
  },
  {
    id: 'phone-sending',
    title: 'Student phone: back online, sending',
    note: 'Case A: the pinned question comes back with the held answer on it, shown as on its way, not as a fresh question.',
    el: <Phone>{ask(MCQ, 3, { sent: 1, awaiting: true, save: { state: 'sending' } })}</Phone>,
  },
  {
    id: 'phone-sent',
    title: 'Student phone: sent, not marked yet',
    note: 'A written answer the professor may review: the server has it; the mark is not final.',
    el: (
      <Phone level="evaluate">
        {ask(OPEN, 11, {
          sent: 'On a cloudy day light is low, so adding carbon dioxide will not help much.',
          save: { state: 'sent' },
          result: { correct: false, score: 0.67, provisional: true, kind: 'open', solution: OPEN.rubric, detail: '2/3 rubric points', reason: 'Your next questions are at Evaluate, from your last 3 answers there.' },
        })}
      </Phone>
    ),
  },
  {
    id: 'phone-marked',
    title: 'Student phone: marked',
    note: 'The result came back: Marked, under the question; the verdict is the server’s, in the dock.',
    el: <Phone>{ask(MCQ, 3, { sent: 1, save: { state: 'marked' }, result: { correct: true, score: 1, solution: 1, reason: 'Your next questions are at Apply, from your last 4 answers there.' } })}</Phone>,
  },
  {
    id: 'phone-outbox',
    title: 'Student phone: reopened offline, with the outbox',
    note: 'A reload with no network: the page opens from the service worker and lists what is on this phone, in every state.',
    el: (
      <Phone view="resume" offline>
        <div className="ln-card">
          <span className="eyebrow">Picking you back up</span>
          <h1 className="ln-text">You are already in room <span className="mono">K7Q42M</span>.</h1>
        </div>
        <Kept items={OUTBOX} flying="g2" />
      </Phone>
    ),
  },
  {
    id: 'phone-cq-vote-offline',
    title: 'Student phone: class vote saved on this phone',
    note: 'A vote made while offline: kept, said as such, and sent with a fresh answerId on reconnect. It can still be changed.',
    el: <Phone view="class" offline><ClassVote q={CQ} kept={{ response: 1, confidence: 'think_so', state: 'queued' }} choices={TAPS} onVote={noop} onBack={noop} /></Phone>,
  },
  // Phase 5, part 2: honest indicators and the review fixes.
  {
    id: 'phone-provenance',
    title: 'Student phone: who wrote the question',
    note: 'question.provenance.text as given, a quiet line under the question. It replaces the old source chip; never "template" or a model name.',
    el: <Phone>{ask({ ...MCQ, provenance: { by: 'ai', checked: true, text: 'Written with AI help and checked by your professor.' } }, 5)}</Phone>,
  },
  {
    id: 'phone-early-days',
    title: 'Student phone: early days, beside the reason',
    note: 'next.provisional: the level rests on too few answers to be firm, said gently beside next.why.',
    el: (
      <Phone level="understand">
        {ask({ ...MCQ, bloom: 'understand' }, 1, {
          sent: 1,
          result: {
            correct: true, score: 1, solution: 1,
            reason: 'Your next questions are at Understand. You have 1 answer there so far, and your level can change once you have 3.',
            profile: { next: { levels: ['understand'], answers: 1, provisional: true, why: 'Your next questions are at Understand. You have 1 answer there so far, and your level can change once you have 3.' } },
          },
        })}
      </Phone>
    ),
  },
  {
    id: 'phone-cq-room-paused',
    title: 'Student phone: class vote sent as the room paused',
    note: 'class:vote counted false with the server’s sentence (one of four), then session:paused. The earlier vote stays in force; after the resume the student can vote again.',
    el: (
      <Phone view="class">
        <ClassVote
          q={CQ}
          mine={{ response: 1, confidence: 'think_so' }}
          note="Your professor has paused the room, so this vote was kept but not counted. Vote again when the room carries on."
          choices={TAPS}
          onVote={noop}
          onBack={noop}
        />
      </Phone>
    ),
  },
];

export default SCREENS.map(({ el, ...entry }) => ({ ...entry, role: null, render: () => el }));
