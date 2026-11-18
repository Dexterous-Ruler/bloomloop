import { LABEL, LEVELS } from '../bloom.js';

/* S4. The moment the whole demo builds to, so it gets the whole screen.
   Moving down is re-aiming, never failure — the copy says so in both
   directions and neither is coloured as good or bad. */
export default function LevelChange({ result, onNext }) {
  const from = result.previousLevel;
  const to = result.workingLevel;
  const up = LEVELS.indexOf(to) > LEVELS.indexOf(from);
  const toIdx = LEVELS.indexOf(to);

  return (
    <>
      <div className="change">
        {/* Lime is the "you are here" colour everywhere else in the product, and
            this screen is the one that says where here now is. */}
        <div className="eyebrow" style={{ color: 'var(--lime)' }}>{up ? 'Moving up' : 'Re-aiming'}</div>

        <div className="row" style={{ marginTop: 20, gap: 10 }}>
          <span className={`tag lg ${from}`}>{LABEL[from]}</span>
          <span className="arrow">{up ? '↑' : '↓'}</span>
          <span className={`tag lg ${to}`}>{LABEL[to]}</span>
        </div>

        <h2>
          {up
            ? `Your questions step up to ${LABEL[to]}.`
            : `Your next questions come back to ${LABEL[to]}.`}
        </h2>

        {/* The server's own sentence — the same one the teacher sees on the
            grid, so the student and the teacher are told the same thing. */}
        <div className="body">{result.reason}</div>

        {/* All six, so the move reads as a position on a ladder rather than a
            score. The new level is outlined; everything past it is dimmed. */}
        <div className="ladder" aria-hidden="true">
          {LEVELS.map((l, i) => (
            <i key={l} className={`swatch ${l}${l === to ? ' here' : ''}`} style={{ opacity: i <= toIdx ? 1 : 0.22 }} />
          ))}
        </div>
        <div className="tally-names" aria-hidden="true">
          {LEVELS.map((l) => <span key={l} className={l === to ? '' : 'none'}>{LABEL[l]}</span>)}
        </div>

        <p className="hintline">Six levels. You move between them all session.</p>
      </div>

      <button type="button" className="btn lime" onClick={onNext}>Keep going</button>
    </>
  );
}
