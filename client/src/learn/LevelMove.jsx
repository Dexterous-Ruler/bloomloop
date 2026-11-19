/**
 * The level changed. It is what the product is for, so it gets the whole
 * screen: it goes espresso, and the six-rung tower climbs to the new level or
 * comes back down to it, rung by rung.
 *
 * Moving down is re-aiming, never failure. The copy says so in both directions
 * and neither is coloured as good or bad: the only colour here is the level's.
 */

import { useLayoutEffect, useRef } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { EASE, gsap, reduced } from '../lib/motion.js';
import { Button, Icon, Level } from '../ui/index.jsx';
import { Dock } from './parts.jsx';

export default function LevelMove({ result, busy, onNext }) {
  const from = result.previousLevel;
  const to = result.workingLevel;
  const fromN = LEVELS.indexOf(from) + 1;
  const toN = LEVELS.indexOf(to) + 1;
  const up = toN > fromN;
  const tower = useRef(null);

  // Read once: with reduced motion the tower is simply drawn where it ends.
  const still = useRef(reduced()).current;

  useLayoutEffect(() => {
    if (still || !tower.current) return undefined;
    // The rungs between the two levels are the ones that move: drawn up from
    // the floor on the way up, folded away on the way down.
    const moving = [...tower.current.querySelectorAll('[data-moving] i')];
    if (!moving.length) return undefined;
    const tl = gsap.timeline({ delay: 0.25 });
    if (up) {
      tl.fromTo(moving, { scaleY: 0, opacity: 0.3 }, { scaleY: 1, opacity: 1, duration: 0.6, ease: EASE, stagger: 0.16 });
    } else {
      tl.to(moving.reverse(), { scaleY: 0.12, opacity: 0.35, duration: 0.55, ease: EASE, stagger: 0.14 });
    }
    tl.fromTo(tower.current.querySelector('[data-here] i'), { scale: 1 }, { scale: 1.08, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out' });
    // A phone that backgrounds the tab stops animation frames, and the tower
    // would sit half-drawn. A timer is not frame-bound, so it finishes the move.
    const guard = setTimeout(() => tl.progress(1), 2600);
    return () => { clearTimeout(guard); tl.kill(); };
  }, [still, fromN, toN, up]);

  const lo = Math.min(fromN, toN);
  const hi = Math.max(fromN, toN);

  return (
    <>
      <div className="ln-move on-panel">
        <span className="tag-mint">{up ? 'Moving up' : 'Re-aiming'}</span>

        <div className="ln-tower" ref={tower} role="img" aria-label={`Level ${toN} of 6: ${LABEL[to] ?? to}`}>
          {LEVELS.map((l, i) => {
            const n = i + 1;
            // Lit up to the new level. On the way down the rungs above it start
            // lit, so the fold has something to fold.
            const on = still ? n <= toN : n <= (up ? toN : fromN);
            const moving = n > lo && n <= hi;
            return (
              <div
                key={l}
                data-level={l}
                data-on={on ? 'true' : undefined}
                data-here={n === toN ? 'true' : undefined}
                data-moving={moving ? 'true' : undefined}
              >
                <i />
                <span>{l.slice(0, 3)}</span>
              </div>
            );
          })}
        </div>

        <h1>
          {up
            ? <>Your questions step up to <em>{LABEL[to] ?? to}</em>.</>
            : <>Your next questions come back to <em>{LABEL[to] ?? to}</em>.</>}
        </h1>

        <div className="cluster" style={{ justifyContent: 'center' }}>
          <Level level={from} size="lg" solid />
          <Icon name="forward" />
          <Level level={to} size="lg" solid />
        </div>

        {/* The server's own sentence for this phone (`profile.next.why`): the
            levels and the answers behind the move, never a band. */}
        {result.reason && <p className="said">{result.reason}</p>}

        <p className="t-meta">Level {toN} of 6. You move between them all session.</p>
      </div>

      <Dock>
        <Button variant="accent" size="xl" block busy={busy} onClick={onNext}>Keep going <Icon name="forward" /></Button>
      </Dock>
    </>
  );
}
