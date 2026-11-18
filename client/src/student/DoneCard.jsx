import { LABEL, LEVELS } from '../bloom.js';

// The ramp, indexed the same way LEVELS is. The counts above the tally bars are
// coloured by level for the same reason the bars are: level is the only thing
// colour is allowed to mean in this product.
const RAMP = ['--l1', '--l2', '--l3', '--l4', '--l5', '--l6'];

// .tally is a flex row with align-items:flex-end, so its columns are only as
// tall as their contents — a percentage height on a bar has nothing to resolve
// against. Bars are sized in pixels off the 148px the class reserves.
const BAR_MAX = 112;

/* S5. Their own set, their own six levels. No ranking anywhere — this project
   exists so the struggling student is not shown a league table. */
export default function DoneCard({ profile, ending }) {
  const closed = ending === 'closed';
  const levels = profile?.levels || {};
  const total = profile?.total || { seen: 0, correct: 0 };
  const overall = total.seen ? Math.round((total.correct / total.seen) * 100) : null;
  const finishedAt = profile?.workingLevel;

  return (
    <>
      <div className="eyebrow on-d" style={{ marginTop: 26 }}>{closed ? 'Room closed' : 'Set complete'}</div>
      <h1 style={{ marginTop: 12, fontSize: 32 }}>
        {closed ? 'Session closed.' : 'That is your set.'}
      </h1>
      {/* Not "every question in the bank": a student inside the band is only
          ever served the Remember and Understand slice, so they finish with
          items still left. Saying otherwise tells them something untrue. */}
      <p className="hint" style={{ marginTop: 12, fontSize: 14.5 }}>
        {closed
          ? 'Your teacher ended the session. Everything you answered is already saved.'
          : `${total.seen} question${total.seen === 1 ? '' : 's'}, chosen for you as you went.`}
      </p>

      <div className="tally">
        {LEVELS.map((l, i) => {
          const { seen = 0, correct = 0 } = levels[l] || {};
          const pct = seen ? Math.round((correct / seen) * 100) : 0;
          return (
            <div key={l}>
              <span className="n" style={{ color: seen ? `var(${RAMP[i]})` : 'var(--on-d-6)' }}>
                {seen ? `${correct}/${seen}` : '—'}
              </span>
              {seen
                ? <i className={`swatch ${l}`} style={{ height: Math.round(10 + (pct / 100) * BAR_MAX) }} />
                : <i style={{ height: 6, background: 'var(--d-4)' }} />}
            </div>
          );
        })}
      </div>
      <div className="tally-names">
        {LEVELS.map((l) => {
          const seen = (levels[l] || {}).seen ?? 0;
          return <span key={l} className={seen ? '' : 'none'}>{LABEL[l]}</span>;
        })}
      </div>

      <div className="summary">
        <div>
          <div className="v">{overall == null ? '—' : `${overall}%`}</div>
          <div className="k">overall</div>
        </div>
        <div>
          {finishedAt
            ? <span className={`tag lg ${finishedAt}`}>{LABEL[finishedAt]}</span>
            : <div className="v">—</div>}
          <div className="k">finished at</div>
        </div>
      </div>

      <div className="stu-said">
        <span>
          Your set was built as you went, so it is not the same as anyone else&apos;s. You are not being
          compared to the rest of the class.
        </span>
      </div>
    </>
  );
}
