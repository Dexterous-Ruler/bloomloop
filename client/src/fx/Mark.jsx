/**
 * A mark that draws itself once: a tick, a cross, or a dash for "partly".
 *
 * Used on a marked answer. The student has just committed and is looking at
 * exactly this spot to find out, so the mark arrives as a stroke being made
 * rather than a state that was always there - and then it is still.
 *
 * Lottie plays it. The animation is three strokes and a trim path, so it is
 * built here as data instead of shipped as a file; the player (the light, SVG
 * build) is imported on demand. Until it arrives, and under reduced motion, the
 * same glyph is shown as a plain icon: the verdict never waits on the drawing.
 */

import { useEffect, useRef, useState } from 'react';

import { reduced } from '../lib/motion.js';
import Icon from '../ui/Icon.jsx';

const FRAMES = 30;

function stroke(points, from, to) {
  const flat = points.map(() => [0, 0]);
  return {
    ty: 'gr',
    it: [
      { ty: 'sh', ks: { a: 0, k: { i: flat, o: flat, v: points, c: false } } },
      {
        ty: 'tm',
        s: { a: 0, k: 0 },
        e: { a: 1, k: [{ t: from, s: [0], o: { x: [0.22], y: [1] }, i: { x: [0.36], y: [1] } }, { t: to, s: [100] }] },
        o: { a: 0, k: 0 },
        m: 1,
      },
      { ty: 'st', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 2.25 }, lc: 2, lj: 2 },
      { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    ],
  };
}

// On the same 24-unit grid lucide draws on, so the animated mark lands exactly
// where the static icon sat a moment before.
const STROKES = {
  check: () => [stroke([[4, 12], [9, 17], [20, 6]], 2, 26)],
  close: () => [stroke([[6, 6], [18, 18]], 2, 16), stroke([[18, 6], [6, 18]], 12, 26)],
  minus: () => [stroke([[5, 12], [19, 12]], 2, 22)],
};

const animationFor = (kind) => ({
  v: '5.7.4', fr: 60, ip: 0, op: FRAMES, w: 24, h: 24, ddd: 0, assets: [],
  layers: [{
    ddd: 0, ind: 1, ty: 4, sr: 1, ao: 0, ip: 0, op: FRAMES, st: 0, bm: 0,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [12, 12, 0] }, a: { a: 0, k: [12, 12, 0] }, s: { a: 0, k: [100, 100, 100] } },
    shapes: STROKES[kind]().reverse(),
  }],
});

/**
 * @param {'check' | 'close' | 'minus'} kind
 * The stroke is drawn white; the caller puts the mark on a filled disc and may
 * recolour the stroke in CSS (the student result does, see .ln-disc).
 */
export default function Mark({ kind, size = 20 }) {
  const stage = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (reduced() || !STROKES[kind]) return undefined;
    let dead = false;
    let anim = null;
    import('lottie-web/build/player/lottie_light').then((mod) => {
      if (dead || !stage.current) return;
      const lottie = mod.default ?? mod;
      anim = lottie.loadAnimation({ container: stage.current, renderer: 'svg', loop: false, autoplay: true, animationData: animationFor(kind) });
      setPlaying(true);
    }).catch(() => { /* the static icon stays */ });
    return () => { dead = true; anim?.destroy(); setPlaying(false); };
  }, [kind]);

  return (
    <span className="mark" style={{ width: size, height: size }}>
      {/* Two layers: React owns the icon, Lottie owns the stage. */}
      <span ref={stage} className="mark-stage" aria-hidden="true" />
      {!playing && <Icon name={kind} size={size} />}
    </span>
  );
}
