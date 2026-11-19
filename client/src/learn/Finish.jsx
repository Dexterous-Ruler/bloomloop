/**
 * The end of a session: this student's own set, across their own six levels.
 * No ranking anywhere. The product exists so the student who is struggling is
 * not shown a league table.
 */

import Tubes from '../fx/Tubes.jsx';
import { LEVELS } from '../lib/bloom.js';
import { Button, Level, Num, Panel, Section } from '../ui/index.jsx';
import { Dock } from './parts.jsx';

// Six tubes across a phone leave about 44px each, which is not room for
// "Understand". The rack's own aria-label still carries the full name.
const SHORT = { remember: 'Rem', understand: 'Und', apply: 'App', analyse: 'Ana', evaluate: 'Eva', create: 'Cre' };

const R = 42;
const C = 2 * Math.PI * R;

export default function Finish({ profile, ending, reason = '', led = null, onLeave }) {
  // A Teacher-led room takes no answers on phones, so there is no set to show:
  // only the server's sentence, and the way out.
  if (ending === 'teacher-led') {
    return (
      <>
        <Panel className="ln-done">
          <div className="stack stack-2">
            <span className="tag-mint">Teacher-led</span>
            <h1>{led?.title || 'Follow along in class'}</h1>
            <p>{led?.message}</p>
          </div>
        </Panel>
        <Dock>
          <Button size="xl" block icon="logout" onClick={onLeave}>Leave the room</Button>
        </Dock>
      </>
    );
  }

  const closed = ending === 'closed';
  const levels = profile?.levels || {};
  const total = profile?.total || { seen: 0, correct: 0 };
  const overall = total.seen ? Math.round((total.correct / total.seen) * 100) : null;
  const reached = profile?.workingLevel;

  const pick = (field) => Object.fromEntries(LEVELS.map((l) => [l, levels[l]?.[field] ?? 0]));

  return (
    <>
      {/* The student's own brief: what they did, said plainly. */}
      <Panel className="ln-done">
        <div className="ln-done-top">
          <div className="stack stack-2">
            <span className="tag-mint">{closed ? 'Room closed' : 'Set complete'}</span>
            <h1>{closed ? 'Your teacher closed the room.' : 'That is your set.'}</h1>
            {/* Not "every question in the bank": a student in the lower band is
                only ever served part of it, so they finish with items left over. */}
            <p>
              {closed
                ? 'Everything you answered is saved.'
                : reason || `${total.seen} question${total.seen === 1 ? '' : 's'}, chosen for you as you went.`}
            </p>
          </div>
          {overall != null && (
            <div className="ln-ring" role="img" aria-label={`${overall}% correct overall`}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <circle className="bg" cx="50" cy="50" r={R} />
                <circle className="fg" cx="50" cy="50" r={R} strokeDasharray={`${(overall / 100) * C} ${C}`} />
              </svg>
              <b><Num value={`${overall}%`} /></b>
            </div>
          )}
        </div>

        <div className="ln-done-figs">
          <div className="ptile"><span>Correct overall</span><b>{overall == null ? '—' : `${overall}%`}</b></div>
          <div className="ptile" style={{ '--d': '0.6s' }}>
            <span>{total.seen === 1 ? 'Question answered' : 'Questions answered'}</span>
            <b><Num value={total.seen} /></b>
          </div>
          <div className="ptile" style={{ '--d': '1.2s' }}>
            <span>Level reached</span>
            {reached ? <Level level={reached} solid /> : <b>—</b>}
          </div>
        </div>
      </Panel>

      <section className="ln-card ln-tubes">
        <Section title="Correct at each level" sub="Each tube fills with how many of that level's questions you got right." as="h3" />
        <Tubes
          values={pick('correct')}
          targets={pick('seen')}
          current={reached}
          height={140}
          caption={(l, value, target) => (
            <>
              <span className="ln-short">{SHORT[l]}</span>
              {target ? `${value}/${target}` : '—'}
            </>
          )}
        />
      </section>

      <p className="said">
        Your set was built as you went, so it is not the same as anyone else's. You are not being compared with the rest
        of the class.
      </p>

      <Dock>
        <Button size="xl" block icon="logout" onClick={onLeave}>Leave the room</Button>
      </Dock>
    </>
  );
}
