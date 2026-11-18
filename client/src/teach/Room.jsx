/**
 * Step three, before a room exists: the room-to-be on a forest panel, the
 * rules it opens with as rows, and the waiting room it will fill.
 * Opening mints the code and hands the whole window to the projector.
 *
 * The three room rules are set here because the server fixes them when the
 * room is minted: a room's standard does not move under the students in it.
 */

import { useState } from 'react';

import { LEVELS } from '../lib/bloom.js';
import { api } from '../lib/api.js';
import { Button, Chip, Empty, Note, Panel, Section, Segmented, Switch } from '../ui/index.jsx';
import { LevelSpread } from '../ui/viz.jsx';

// The server's own lists (server/src/services/mastery.js MASTERY_GOALS and
// MAX_REATTEMPTS). It rejects anything else with a 400, so a drift here shows
// up as an error on this card, never as a room quietly run on other rules.
const GOALS = [
  { id: '0.8', label: '80%' },
  { id: '0.9', label: '90%' },
  { id: '1', label: '100%' },
];
const TRIES = [
  { id: '0', label: 'None' },
  { id: '1', label: 'One' },
  { id: '2', label: 'Two' },
];

export default function Room({ content, activeCount, levels, onSession, onBack }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [goal, setGoal] = useState('0.8');
  const [tries, setTries] = useState('0');
  const [redeem, setRedeem] = useState('off');

  async function start() {
    setError(''); setBusy(true);
    try {
      onSession(await api.createSession(content.contentId, content.title, {
        masteryGoal: Number(goal),
        reattempts: Number(tries),
        redemption: redeem === 'on',
      }));
    }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (!content || activeCount === 0) {
    return (
      <div className="card">
        <Empty icon="bank" title="No questions to run" action={<Button variant="primary" icon="back" onClick={onBack}>Back to the questions</Button>}>
          A room hands every phone its next question out of the bank behind it. Write one first, and the room opens on
          exactly the questions you kept.
        </Empty>
      </div>
    );
  }

  const topicCount = content.topics?.length ?? 0;
  const covered = levels ? LEVELS.filter((l) => (levels[l] ?? 0) > 0).length : 0;

  return (
    <div className="tc-room">
      <div className="tc-room-main">
        <Panel className="tc-room-brief" aria-label="The room to be">
          <span className="tag-mint">The room to be</span>
          <h2>{content.title}</h2>
          <p>
            {activeCount} question{activeCount === 1 ? '' : 's'}
            {topicCount > 0 ? ` over ${topicCount} topic${topicCount === 1 ? '' : 's'}` : ''}
            {levels ? `, at ${covered} of the six levels` : ''}. Students join from any phone browser with the code and
            their roll number. No app, no account.
          </p>
          {levels && <LevelSpread counts={levels} />}
          {error && <Note tone="bad">{error}</Note>}
          <div className="cluster">
            <Button variant="accent" size="lg" icon="room" busy={busy} onClick={start}>Open the room</Button>
            <Button size="lg" onClick={onBack}>Back to the questions</Button>
          </div>
        </Panel>

        <section className="card tc-rules" aria-label="Room rules">
          <div className="tc-rules-head">
            <Section title="Room rules" sub="Fixed when the room opens, so the standard does not move under the students in it." />
          </div>
          <div className="tc-rule">
            <div className="tc-rule-txt">
              <b>Mastery goal</b>
              <p>The accuracy at a level you would sign off as mastered. Separate from moving up a level, which stays at 70%.</p>
            </div>
            <Segmented label="Mastery goal" options={GOALS} value={goal} onChange={setGoal} />
          </div>
          <div className="tc-rule">
            <div className="tc-rule-txt">
              <b>Extra goes at a wrong answer</b>
              <p>Nothing is revealed between goes. A true-or-false never gets one, and no question gets so many that only one option is left.</p>
            </div>
            <Segmented label="Extra goes at a wrong answer" options={TRIES} value={tries} onChange={setTries} />
          </div>
          <div className="tc-rule">
            <div className="tc-rule-txt">
              <b>Redemption</b>
              <p>A question right first time sets aside the oldest wrong answer at the same level. Nothing is deleted: you still see every answer.</p>
            </div>
            <Switch label="Redemption" checked={redeem === 'on'} onChange={(on) => setRedeem(on ? 'on' : 'off')} />
          </div>
          <div className="tc-rule">
            <div className="tc-rule-txt">
              <b>Question set</b>
              <p>{activeCount} kept question{activeCount === 1 ? '' : 's'} from {content.title}. The room serves these and no others.</p>
            </div>
            <Button size="sm" onClick={onBack}>Change</Button>
          </div>
        </section>
      </div>

      <aside className="card tc-wait" aria-label="Waiting room">
        <div className="tc-wait-head">
          <Section title="Waiting room" sub="Who has joined, once the room is open." />
          <Chip>Not open</Chip>
        </div>
        <div className="tc-wait-body">
          {/* Six places for a code that does not exist yet. */}
          <div className="tc-codeslots" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => <span key={i}>·</span>)}
          </div>
          <h3>No one is here yet</h3>
          <p>The code is minted when you open the room. Until then there is nothing to join.</p>
        </div>
        <ol className="tc-wait-how">
          <li><span className="mono">01</span>Opening puts a six-character code on the projector, large enough to read from the back.</li>
          <li><span className="mono">02</span>Students type it on their phones with their roll number, and the projector counts them in.</li>
          <li><span className="mono">03</span>From the class view you watch each student climb, level by level.</li>
        </ol>
      </aside>
    </div>
  );
}
