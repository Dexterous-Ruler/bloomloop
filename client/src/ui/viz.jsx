/**
 * The two static charts every dashboard needs, drawn in the level colours.
 * Both are plain elements, not canvases: they are read, not watched.
 */

import { LABEL, LEVELS } from '../lib/bloom.js';

const SHORT = { remember: 'Rem', understand: 'Und', apply: 'App', analyse: 'Ana', evaluate: 'Eva', create: 'Cre' };

/**
 * Six bars, one per level. Each is filled to that level's accuracy and
 * captioned with correct/seen, so "how well" and "on how much" are read
 * together and a 100% from one answer cannot pass for mastery.
 *
 * @param byLevel  { remember: { seen, correct }, ... } - missing levels read as unseen
 * @param current  the level to outline as "working here now"
 */
export function LevelBars({ byLevel = {}, current, height = 72, short = false }) {
  return (
    <div className="lbars" style={{ '--lbar-h': `${height}px` }}>
      {LEVELS.map((l) => {
        const seen = byLevel[l]?.seen ?? 0;
        const correct = byLevel[l]?.correct ?? 0;
        const pct = seen ? Math.round((correct / seen) * 100) : 0;
        return (
          <div
            key={l}
            className="lbar"
            data-level={l}
            data-current={current === l ? 'true' : undefined}
            title={seen ? `${LABEL[l]}: ${correct} of ${seen} correct (${pct}%)` : `${LABEL[l]}: not attempted`}
          >
            <span className="lbar-ct">{seen ? `${correct}/${seen}` : '—'}</span>
            <div className="lbar-track"><i style={{ height: `${seen ? Math.max(pct, 4) : 0}%` }} /></div>
            <span className="lbar-name">{short ? SHORT[l] : LABEL[l]}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One bar split by level, with a key underneath.
 * @param counts  { remember: 12, ... }
 */
export function LevelSpread({ counts = {}, showKey = true }) {
  const total = LEVELS.reduce((n, l) => n + (counts[l] ?? 0), 0);
  return (
    <div>
      <div className="spread" role="img" aria-label={LEVELS.map((l) => `${LABEL[l]} ${counts[l] ?? 0}`).join(', ')}>
        {total > 0 && LEVELS.map((l) => ((counts[l] ?? 0) > 0 ? <i key={l} data-level={l} style={{ flex: counts[l] }} /> : null))}
      </div>
      {showKey && (
        <div className="spread-key">
          {LEVELS.map((l) => (
            <span key={l} data-level={l}><i className="swatch" />{LABEL[l]} <b>{counts[l] ?? 0}</b></span>
          ))}
        </div>
      )}
    </div>
  );
}
