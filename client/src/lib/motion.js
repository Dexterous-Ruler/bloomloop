/**
 * Motion in one place, on one curve.
 *
 * GSAP is used for the things CSS transitions cannot do: counting a figure to
 * its new value, sliding one indicator between targets it has to measure, and
 * staging an entrance. Nothing loops. Every helper stands down under
 * prefers-reduced-motion and the end state is simply shown.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';

export { gsap };

/** cubic-bezier(0.22, 1, 0.36, 1), as GSAP spells it. */
export const EASE = 'expo.out';

export const reduced = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A page arriving: its top-level blocks rise 8px and fade in, 50ms apart, six
 * at most. Re-runs when `key` changes, which is how a step change replays it.
 */
export function useEnter(ref, key) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return undefined;
    const kids = [...el.children].slice(0, 6);
    if (!kids.length) return undefined;
    const tween = gsap.fromTo(
      kids,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.38, ease: EASE, stagger: 0.05, clearProps: 'opacity,transform' },
    );
    // The tween runs on animation frames, and a tab that is starved of them
    // (in the background, or throttled) would sit half-invisible. A timer is
    // not frame-bound, so it finishes the entrance if the frames never came.
    const guard = setTimeout(() => tween.progress(1), 900);
    // A killed tween leaves its inline styles behind. If the page re-renders
    // mid-entrance, anything left at opacity 0 would stay invisible for good.
    return () => { clearTimeout(guard); tween.kill(); gsap.set(kids, { clearProps: 'opacity,transform' }); };
  }, [ref, key]);
}

/**
 * A number that counts to its target when the target changes. The first value
 * is shown at once: counting up from zero on load would put a wrong figure on
 * screen in front of a class.
 */
export function useCount(target, duration = 0.5) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    if (!Number.isFinite(target) || reduced() || !Number.isFinite(from.current) || from.current === target) {
      from.current = target;
      setShown(target);
      return undefined;
    }
    const state = { v: from.current };
    const tween = gsap.to(state, {
      v: target,
      duration,
      ease: EASE,
      onUpdate: () => setShown(state.v),
      onComplete: () => { from.current = target; setShown(target); },
    });
    // A tab starved of animation frames (in the background, or throttled)
    // would leave the figure part way. A timer is not frame-bound, so it
    // lands the true value, as useEnter does for its entrance.
    const guard = setTimeout(() => tween.progress(1), duration * 1000 + 600);
    return () => { clearTimeout(guard); from.current = state.v; tween.kill(); };
  }, [target, duration]);

  return shown;
}

/**
 * Slide `thumb` to sit exactly under `target` inside their shared parent. The
 * first placement is instant, so the indicator never flies in from the corner.
 */
export function slideTo(thumb, target, first) {
  if (!thumb) return;
  if (!target) { gsap.set(thumb, { opacity: 0 }); return; }
  const to = { x: target.offsetLeft, y: target.offsetTop, width: target.offsetWidth, height: target.offsetHeight, opacity: 1 };
  if (first || reduced()) gsap.set(thumb, to);
  else gsap.to(thumb, { ...to, duration: 0.38, ease: EASE, overwrite: true });
}
