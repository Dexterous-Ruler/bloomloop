/**
 * Two pieces the student's home and analytics both draw: the six bars, sized
 * to the room they are given, and strongest and weakest said in sentences.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { LABEL } from '../lib/bloom.js';
import { Level } from '../ui/index.jsx';
import { LevelBars } from '../ui/viz.jsx';
import { MIN_EVIDENCE, asPct } from './insightData.js';

/**
 * Accuracy by level. `bloom` is the server's report, six rows in taxonomy
 * order; it is keyed here so a level that never came back cannot shift the
 * chart by a column.
 *
 * Six full level names need about 76px of column each. That is measured off
 * the chart and not off a breakpoint, because what decides it is the width
 * this chart was given, which the page around it is free to change.
 */
export function Levels({ bloom, current, height = 112 }) {
  const box = useRef(null);
  const [tight, setTight] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setTight(entry.contentRect.width < 456));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byLevel = useMemo(() => Object.fromEntries((bloom ?? []).map((r) => [r.level, r])), [bloom]);

  return (
    <div ref={box}>
      <LevelBars byLevel={byLevel} current={current ?? undefined} height={height} short={tight} />
    </div>
  );
}

const ADVICE = {
  you: 'That is where the next hour goes.',
  they: 'The level to aim their next questions at.',
  classes: 'The level to aim the next bank at.',
};

const names = (rows, withCount) =>
  rows.map((r) => `${LABEL[r.level] ?? r.level}${withCount ? ` (${r.seen})` : ''}`).join(', ');

/**
 * Strongest and weakest, in words.
 *
 * `confident` is the server's flag. It is false when fewer than two levels
 * have MIN_EVIDENCE answers behind them, and in that state `best` can still
 * hold the one level that qualified. Naming it would call someone "best at
 * Create" off a lucky answer, so when the flag is false no level is named,
 * whatever is in the field. Levels too thin to judge are listed as exactly
 * that, with their counts.
 *
 * @param who  'you' | 'they' | 'classes' - whose record this is, for the advice
 */
export function InWords({ bloom, best, weakest, confident, who }) {
  const thin = bloom.filter((r) => r.seen > 0 && r.seen < MIN_EVIDENCE);
  const unmet = bloom.filter((r) => !r.seen);
  const tally = (r) => `${r.correct} of ${r.seen} right (${asPct(r.accuracy)})`;

  return (
    <div className="in-words">
      {!confident || !best || !weakest ? (
        <p>
          Not enough to compare yet. Two levels need at least {MIN_EVIDENCE} answers each before one
          can be called stronger than the other, so nothing is named.
        </p>
      ) : best.accuracy === weakest.accuracy ? (
        <p>No gap to name. Every level with enough answers is at {asPct(best.accuracy)}.</p>
      ) : (
        <>
          <p>Strongest at <Level level={best.level} />, with {tally(best)}.</p>
          <p>Weakest at <Level level={weakest.level} />, with {tally(weakest)}. {ADVICE[who]}</p>
        </>
      )}
      {thin.length > 0 && <p className="muted">Too few answers to judge: {names(thin, true)}.</p>}
      {unmet.length > 0 && <p className="muted">Not asked yet: {names(unmet)}.</p>}
    </div>
  );
}
