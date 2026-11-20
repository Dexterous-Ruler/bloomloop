/**
 * The wheel itself (Batch 9, E6): a wheel of the students on it, and past
 * WHEEL_MAX of them a reel, since a wheel of forty names is forty slivers
 * nobody can read.
 *
 * The server has already drawn. This never picks: a spin is a picture of the
 * server's pick, and it always stops inside that student's segment (the reel:
 * on that student's row). Only the students on the wheel get a segment; who
 * has had a turn this round is in "Who is on the wheel", not on the wheel.
 *
 * The spin is one flick and friction: up to speed in a fifth of a second, then
 * slowing to a stop, the pointer ticking over each peg as it slows. Under
 * prefers-reduced-motion there is no spin: the pick is simply there. Think time
 * is the ring round the rim (the reel: a bar under its window), emptying from
 * the pointer.
 *
 * `spin` is { ring, pick } as the screen passes it. Two optional keys are for
 * the gallery: `at` (0 to 1) holds the spin still at that point, and `still`
 * shows it as reduced motion does.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { gsap, reduced } from '../lib/motion.js';

/** Past this many students on the wheel, the reel. */
export const WHEEL_MAX = 30;

const C = 200; // the drawing is 400 by 400
const R = 176; // the rim
const HUB = 62;
const BEZEL = 189; // think time's ring
const LABEL_OUT = R - 18;
const PIVOT = 387; // the pointer hangs from here, on the right
const TURNS = 4; // whole turns before the wheel starts looking for the pick
const SPIN_S = 3.6;
const REEL_S = 3.2;
const ROW = 44; // a reel row, px
const ROWS = 5; // rows the reel's window shows

const mod = (a, n) => ((a % n) + n) % n;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const keyOf = (people) => people.map((p) => `${p.rollNo}:${p.name ?? ''}${p.off ? '~' : ''}`).join('|');

/**
 * A flick and friction, as an ease: the speed climbs for the first 5% of the
 * time, then falls as (1 - t)^1.7 to nothing. Sampled once into a table.
 */
const spinEase = (() => {
  const N = 400;
  const speed = (t) => Math.min(1, t / 0.05) * (1 - t) ** 1.7;
  const acc = [0];
  for (let i = 1; i <= N; i += 1) acc.push(acc[i - 1] + speed((i - 0.5) / N));
  const total = acc[N];
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const x = t * N;
    const i = Math.floor(x);
    return (acc[i] + (acc[i + 1] - acc[i]) * (x - i)) / total;
  };
})();

/** A number in [-1, 1) from a pick's id: where in its segment the pointer stops, the same each time. */
function jitter(id) {
  let h = 2166136261;
  for (const ch of String(id ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 2 ** 32) * 2 - 1;
}

/* ------------------------------------------------------------- labels */

let ctx = null;
function measure(text, size, mono) {
  try {
    ctx ??= document.createElement('canvas').getContext('2d');
    ctx.font = mono ? `500 ${size}px 'JetBrains Mono Variable', monospace` : `600 ${size}px 'Manrope Variable', 'Noto Sans Devanagari', system-ui, sans-serif`;
    return ctx.measureText(text).width;
  } catch {
    return text.length * size * 0.6;
  }
}

const sizeFor = (n) => (n <= 8 ? 18 : n <= 14 ? 16 : n <= 22 ? 15 : 14);

/** What fits in `room`: the whole name, then "First L.", then the first name, then that cut short. */
function fit(p, names, size, room) {
  const mono = !names || !p.name;
  const parts = mono ? [String(p.rollNo)] : String(p.name).trim().split(/\s+/);
  const tries = mono ? parts : [parts.join(' '), parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : null, parts[0]];
  for (const t of tries) if (t && measure(t, size, mono) <= room) return { text: t, mono };
  let t = parts[0];
  while (t.length > 1 && measure(`${t}…`, size, mono) > room) t = t.slice(0, -1);
  return { text: `${t}…`, mono };
}

/** Where the label of segment `i` of `n` sits, in the wheel's own turn (0 is the pointer). */
const midOf = (i, s) => -(i + 0.5) * s;

/* ------------------------------------------------------------- the spin */

/**
 * What the wheel shows and where it stands. `u` is the position in segments
 * (or reel rows): the pointer reads entry floor(u) of the list. A landing is
 * kept until the people on the wheel change (a new round, a setting).
 */
function useSpin({ people, spin, latest, onLanded }) {
  const peopleKey = keyOf(people);
  const [state, setState] = useState(() => {
    const list = people.filter((p) => !p.off);
    const k = latest ? list.findIndex((p) => p.rollNo === latest.rollNo) : -1;
    return k < 0
      ? { u: 0.5, n: list.length, flap: 0, landed: null }
      : { u: k + 0.5, n: list.length, flap: 0, landed: { list, roll: latest.rollNo, key: peopleKey } };
  });
  const now = useRef(state);
  now.current = state;
  const key = useRef(peopleKey);
  key.current = peopleKey;
  const landed = useRef(onLanded);
  landed.current = onLanded;

  useEffect(() => {
    if (!spin) return undefined;
    const list = spin.ring.filter((p) => !p.off);
    const n = list.length;
    const k = list.findIndex((p) => p.rollNo === spin.pick?.rollNo);
    const prev = now.current;
    // The wheel turns on from where it stands, whatever its new number of segments.
    const from = prev.n ? (prev.u / prev.n) * n : 0;
    const reel = n > WHEEL_MAX;
    const aim = k + 0.5 + (reel ? 0 : jitter(spin.pick?.id) * 0.32);
    const to = from + n * (reel ? Math.max(1, Math.ceil(40 / n)) : TURNS) + mod(aim - from, n);
    const land = () => {
      setState({ u: mod(to, n || 1), n, flap: 0, landed: k < 0 ? null : { list, roll: spin.pick.rollNo, key: key.current } });
      landed.current?.();
    };
    if (k < 0 || spin.still || reduced() || spin.at >= 1) { land(); return undefined; }

    const frame = (p, step) => {
      const u = from + (to - from) * spinEase(p);
      const per = Math.abs((to - from) * step); // segments passing per frame
      const amp = reel ? 0 : 13 * smooth(0.01, 0.1, per) * (1 - smooth(0.4, 0.8, per));
      setState({ u, n, flap: -amp * mod(u, 1) ** 2.2, landed: null });
    };
    if (spin.at != null) {
      frame(spin.at, spinEase(Math.min(1, spin.at + 1 / 216)) - spinEase(spin.at));
      return undefined;
    }
    const dur = reel ? REEL_S : SPIN_S;
    const t = { p: 0 };
    let last = 0;
    const tween = gsap.to(t, {
      p: 1,
      duration: dur,
      ease: 'none',
      onUpdate: () => { const e = spinEase(t.p); frame(t.p, e - last); last = e; },
      onComplete: land,
    });
    // A tab starved of frames would never land: a timer is not frame-bound.
    const guard = setTimeout(() => tween.progress(1), (dur + 1.5) * 1000);
    return () => { clearTimeout(guard); tween.kill(); };
  }, [spin]);

  const spinning = Boolean(spin) && !state.landed;
  const rest = !spin && state.landed?.key === peopleKey ? state.landed : null;
  const spinList = useMemo(() => spin?.ring.filter((p) => !p.off) ?? null, [spin]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the list
  const onList = useMemo(() => people.filter((p) => !p.off), [peopleKey]);
  const list = spinList ?? rest?.list ?? onList;
  // A new list (the people changed) starts from where the wheel stands.
  const u = state.n && state.n !== list.length ? (state.u / state.n) * list.length : state.u;
  return { list, u, flap: state.flap, spinning, pickRoll: rest?.roll ?? null };
}

/* ------------------------------------------------------------- the middle */

function Hub({ think, spinning, latest, left, names, className }) {
  return (
    <div className={className} key={think ? 'think' : spinning ? 'spin' : latest?.id ?? 'none'}>
      {think ? (
        <>
          <span className="rc-hub-eye">Think time</span>
          <b className="rc-hub-count mono">{think.left}</b>
          <span className="rc-hub-sub">{think.left === 1 ? 'second' : 'seconds'}</span>
        </>
      ) : spinning ? (
        <span className="rc-hub-eye">Drawing</span>
      ) : latest ? (
        <>
          <span className="rc-hub-eye">Drawn</span>
          <b className="rc-hub-roll mono">{latest.rollNo}</b>
          {names && latest.name && <span className="rc-hub-name clip">{latest.name}</span>}
        </>
      ) : (
        <>
          <b className="rc-hub-count mono">{left}</b>
          <span className="rc-hub-sub">on the wheel</span>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- the wheel */

function Disc({ list, u, flap, spinning, pickRoll, think, names, hub }) {
  const n = list.length;
  const s = n ? 360 / n : 360;
  const turn = u * s;
  const size = sizeFor(n);
  // Names are measured in the page's own font, once it has loaded.
  const [fonts, setFonts] = useState(() => document.fonts?.status === 'loaded');
  useEffect(() => { let on = true; document.fonts?.ready.then(() => on && setFonts(true)); return () => { on = false; }; }, []);
  const labels = useMemo(() => {
    const inner = Math.max(HUB + 10, s < 90 ? (0.92 * size) / Math.sin((s * Math.PI) / 180) : 0);
    return list.map((p) => fit(p, names, size, LABEL_OUT - inner));
  }, [list, names, size, s, fonts]);
  const mid = (HUB + 10 + LABEL_OUT) / 2;

  return (
    <div className="rc-disc" data-at-rest={spinning ? undefined : 'true'}>
      <svg viewBox="0 0 400 400" aria-hidden="true" focusable="false">
        <circle className="rc-disc-bezel" cx={C} cy={C} r={BEZEL} />
        {think && (
          <circle
            className="rc-disc-think"
            cx={C} cy={C} r={BEZEL}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - think.left / think.of}
          />
        )}
        <g transform={`rotate(${turn.toFixed(3)} ${C} ${C})`}>
          {n === 1 && <circle className="rc-disc-seg" data-pick={pickRoll ? 'true' : undefined} cx={C} cy={C} r={R} />}
          {n > 1 && list.map((p, i) => {
            const a0 = (-i * s * Math.PI) / 180;
            const a1 = (-(i + 1) * s * Math.PI) / 180;
            const d = `M${C} ${C}L${(C + R * Math.cos(a0)).toFixed(2)} ${(C + R * Math.sin(a0)).toFixed(2)}`
              + `A${R} ${R} 0 ${s > 180 ? 1 : 0} 0 ${(C + R * Math.cos(a1)).toFixed(2)} ${(C + R * Math.sin(a1)).toFixed(2)}Z`;
            return (
              <path
                key={p.rollNo}
                className="rc-disc-seg"
                data-alt={i % 2 ? 'true' : undefined}
                data-pick={p.rollNo === pickRoll ? 'true' : undefined}
                d={d}
              />
            );
          })}
          {n > 1 && list.map((p, i) => {
            const a = (-i * s * Math.PI) / 180;
            return (
              <g key={p.rollNo}>
                <line className="rc-disc-sep" x1={C + HUB * Math.cos(a)} y1={C + HUB * Math.sin(a)} x2={C + R * Math.cos(a)} y2={C + R * Math.sin(a)} />
                <circle className="rc-disc-peg" cx={C + (R - 6) * Math.cos(a)} cy={C + (R - 6) * Math.sin(a)} r={2} />
              </g>
            );
          })}
          {list.map((p, i) => {
            const at = midOf(i, s);
            const where = mod(at + turn, 360);
            // Labels on the left half turn over, so every name reads the right way up.
            const flip = where > 90 && where < 270;
            const { text, mono } = labels[i];
            return (
              <g key={p.rollNo} transform={`rotate(${at.toFixed(3)} ${C} ${C})`}>
                <text
                  className={`rc-disc-label${mono ? ' is-roll' : ''}`}
                  data-pick={p.rollNo === pickRoll ? 'true' : undefined}
                  x={flip ? C + HUB + 10 : C + LABEL_OUT}
                  y={C}
                  fontSize={size}
                  textAnchor={flip ? 'start' : 'end'}
                  dominantBaseline="central"
                  transform={flip ? `rotate(180 ${C + mid} ${C})` : undefined}
                >
                  {text}
                </text>
              </g>
            );
          })}
        </g>
        <circle className="rc-disc-rim" cx={C} cy={C} r={R} />
        {n === 0 && <circle className="rc-disc-empty" cx={C} cy={C} r={R - 1} />}
        <circle className="rc-disc-hubring" cx={C} cy={C} r={HUB} />
        <g transform={`rotate(${flap.toFixed(2)} ${PIVOT} ${C})`}>
          <path className="rc-disc-pointer" d={`M${PIVOT} ${C - 12}L${C + R - 11} ${C}L${PIVOT} ${C + 12}Z`} />
          <circle className="rc-disc-pointer" cx={PIVOT} cy={C} r={11} />
          <circle className="rc-disc-pivot" cx={PIVOT} cy={C} r={3.5} />
        </g>
      </svg>
      {hub('rc-disc-hub')}
    </div>
  );
}

/* ------------------------------------------------------------- the reel */

function Reel({ list, u: at, spinning, pickRoll, think, names, hub }) {
  const n = list.length;
  // Standing still, a row sits in the band, never two halves.
  const u = spinning ? at : Math.floor(at) + 0.5;
  const first = Math.floor(u - 0.5) - 3;
  const rows = n ? Array.from({ length: 7 }, (_, j) => first + j) : [];
  return (
    <div className="rc-reel" data-landed={pickRoll ? 'true' : undefined} data-at-rest={spinning ? undefined : 'true'}>
      {hub('rc-reel-head')}
      <div className="rc-reel-win" style={{ height: ROW * ROWS }} aria-hidden="true">
        <span className="rc-reel-band" style={{ top: (ROW * (ROWS - 1)) / 2, height: ROW }} />
        <div className="rc-reel-rows">
          {rows.map((i) => {
            const p = list[mod(i, n)];
            const y = (i + 0.5 - u) * ROW;
            return (
              <div
                key={i}
                className="rc-reel-row"
                data-pick={!spinning && p.rollNo === pickRoll && Math.abs(y) < ROW / 2 ? 'true' : undefined}
                style={{ top: (ROW * (ROWS - 1)) / 2, height: ROW, transform: `translateY(${y.toFixed(2)}px)` }}
              >
                <b className="mono">{p.rollNo}</b>
                {names && p.name && <span className="clip">{p.name}</span>}
              </div>
            );
          })}
        </div>
        {think && <span className="rc-reel-think" style={{ transform: `scaleX(${think.left / think.of})` }} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the view */

/**
 * The wheel, or the reel past WHEEL_MAX. `people` is ringOf(wheel): who is on
 * the wheel now (and who has had a turn, marked off, who get no segment).
 */
export default function WheelDisc({ people, spin, latest, left, onLanded, think = null, names = true }) {
  const { list, u, flap, spinning, pickRoll } = useSpin({ people, spin, latest, onLanded });
  const hub = (className) => <Hub className={className} think={think} spinning={spinning} latest={latest} left={left} names={names} />;
  const props = { list, u, flap, spinning, pickRoll, think, names, hub };
  return list.length > WHEEL_MAX ? <Reel {...props} /> : <Disc {...props} />;
}
