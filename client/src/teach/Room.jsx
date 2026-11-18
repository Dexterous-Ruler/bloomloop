/**
 * Step three, before a room exists: one decision, so one card.
 * Opening mints the code and hands the whole window to the projector.
 *
 * The three room rules are set here because the server fixes them when the
 * room is minted: a room's standard does not move under the students in it.
 */

import { useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Empty, Field, Fig, Note, Segmented } from '../ui/index.jsx';

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
const REDEEM = [
  { id: 'off', label: 'Off' },
  { id: 'on', label: 'On' },
];

export default function Room({ content, activeCount, onSession, onBack }) {
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
      <Empty icon="bank" title="No questions to run" action={<Button variant="primary" icon="back" onClick={onBack}>Back to the questions</Button>}>
        A room hands every phone its next question out of the bank behind it. Write one first, and the room opens on
        exactly the questions you kept.
      </Empty>
    );
  }

  return (
    <div className="room-open">
      <div className="stack stack-2">
        <div className="eyebrow">{content.title}</div>
        <h1 className="t-display">Open a room</h1>
        <p className="t-lead measure">
          Opening mints a six-character code and puts it on the projector. Students join from any phone browser with the
          code and their roll number. No app, no account.
        </p>
      </div>

      <div className="figs ruled">
        <Fig value={activeCount} label="questions kept" />
        <Fig value={content.topics?.length ?? '—'} label="topics in the chapter" />
      </div>

      <div className="stack stack-3">
        <Field
          label="Mastery goal"
          hint="The accuracy at a level you would sign off as mastered. Separate from moving up a level, which stays at 70%."
        >
          <Segmented label="Mastery goal" options={GOALS} value={goal} onChange={setGoal} />
        </Field>
        <Field
          label="Extra goes at a wrong answer"
          hint="Nothing is revealed between goes. A true-or-false never gets one, and no question gets so many that only one option is left."
        >
          <Segmented label="Extra goes at a wrong answer" options={TRIES} value={tries} onChange={setTries} />
        </Field>
        <Field
          label="Redemption"
          hint="A question right first time sets aside the oldest wrong answer at the same level. Nothing is deleted: you still see every answer."
        >
          <Segmented label="Redemption" options={REDEEM} value={redeem} onChange={setRedeem} />
        </Field>
      </div>

      {error && <Note tone="bad">{error}</Note>}

      <div className="cluster">
        <Button variant="primary" size="xl" icon="room" busy={busy} onClick={start}>Open the room</Button>
        <Button variant="ghost" size="xl" onClick={onBack}>Back to the questions</Button>
      </div>
    </div>
  );
}
