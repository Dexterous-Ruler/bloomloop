/**
 * Six glass tubes of liquid, one per level.
 *
 * A tube fills toward `value / max`, and its surface is disturbed when - and
 * only when - the value goes up. Watching a bank being written, a ripple is
 * literally a question landing at that level.
 *
 * The surface is a row of springs: each column is pulled back to rest, loses
 * energy and drags its neighbours. That is the whole model and it is enough to
 * read as water. It is not a loop - once the surface has settled the tube takes
 * itself off the ticker and draws nothing until the next change. With reduced
 * motion it never goes on the ticker and the fill is drawn where it belongs.
 */

import { useEffect, useRef } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { gsap, reduced } from '../lib/motion.js';
import { onThemeChange, token } from '../lib/theme.js';

const N = 32;           // columns across the surface
const TENSION = 0.028;
const DAMPING = 0.055;
const SPREAD = 0.18;
const PASSES = 3;
const HEADROOM = 0.9;   // a full tube stops short of the rim so a ripple has room

function step(st) {
  const { h, v } = st;
  const gap = st.target - st.level;
  st.level += gap * 0.08;
  for (let i = 0; i < N; i += 1) {
    v[i] += -TENSION * h[i] - DAMPING * v[i];
    h[i] += v[i];
  }
  for (let p = 0; p < PASSES; p += 1) {
    for (let i = 0; i < N; i += 1) {
      if (i > 0) { const d = SPREAD * (h[i] - h[i - 1]); v[i - 1] += d; h[i - 1] += d; }
      if (i < N - 1) { const d = SPREAD * (h[i] - h[i + 1]); v[i + 1] += d; h[i + 1] += d; }
    }
  }
  let energy = Math.abs(gap) * 60;
  for (let i = 0; i < N; i += 1) energy = Math.max(energy, Math.abs(h[i]), Math.abs(v[i]) * 8);
  return energy > 0.06;
}

function draw(ctx, st) {
  const { w, hgt, h } = st;
  ctx.clearRect(0, 0, w, hgt);
  if (!w || !hgt || st.level < 0.003) return;
  const rest = hgt - st.level * hgt * HEADROOM;
  const y = (i) => Math.max(1, Math.min(hgt, rest - h[i]));
  const x = (i) => (i / (N - 1)) * w;
  const surface = () => {
    ctx.moveTo(0, y(0));
    for (let i = 1; i < N - 1; i += 1) ctx.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
    ctx.lineTo(w, y(N - 1));
  };
  ctx.beginPath(); surface(); ctx.lineTo(w, hgt); ctx.lineTo(0, hgt); ctx.closePath();
  ctx.fillStyle = st.color; ctx.fill();
  // Light through the liquid: a little brighter just under the surface.
  const sheen = ctx.createLinearGradient(0, rest - 4, 0, Math.min(hgt, rest + 48));
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sheen; ctx.fill();
  // The meniscus: without it the two palest levels have no top edge.
  ctx.beginPath(); surface();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = st.edge; ctx.lineWidth = 1.25; ctx.stroke();
  ctx.globalAlpha = 1;
}

/** One tube. `fill` is 0 to 1; `n` is the level ordinal, 1 to 6. */
export function Tube({ fill = 0, n = 1, height = 160 }) {
  const canvas = useRef(null);
  const sim = useRef(null);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv.getContext('2d');
    const st = { h: new Float32Array(N), v: new Float32Array(N), level: 0, target: 0, w: 0, hgt: 0, on: false, color: '', edge: '' };
    // Read from the tube's own element, so a rack on a forest panel picks up
    // that panel's turned-over ink for the meniscus.
    const paint = () => {
      st.color = token(`--l${n}`, cv) || '#888';
      st.edge = token('--text', cv) || '#000';
      draw(ctx, st);
    };
    const tick = () => {
      const moving = step(st);
      draw(ctx, st);
      if (!moving) { gsap.ticker.remove(tick); st.on = false; }
    };
    st.wake = () => {
      if (reduced()) { st.level = st.target; st.h.fill(0); st.v.fill(0); draw(ctx, st); return; }
      if (!st.on) { st.on = true; gsap.ticker.add(tick); }
    };
    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      st.w = r.width; st.hgt = r.height;
      draw(ctx, st);
    };
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    paint(); size();
    const off = onThemeChange(paint);
    sim.current = st;
    return () => { ro.disconnect(); off(); gsap.ticker.remove(tick); sim.current = null; };
  }, [n]);

  useEffect(() => {
    const st = sim.current;
    if (!st) return;
    const next = Math.max(0, Math.min(1, fill));
    const rose = next > st.target + 0.0005;
    st.target = next;
    if (rose && !reduced()) {
      const at = 4 + Math.floor(Math.random() * (N - 8));
      st.v[at] -= 5; st.v[at - 1] -= 2.8; st.v[at + 1] -= 2.8;
    }
    st.wake();
  }, [fill]);

  return (
    <div className="tube-glass" style={{ height }}>
      <canvas ref={canvas} aria-hidden="true" />
      <span className="tube-scale" aria-hidden="true" />
    </div>
  );
}

/**
 * The rack. `values` and `targets` are keyed by level id; a tube with no target
 * shows its value against the largest value in the rack.
 * `caption(level, value, target)` returns what is printed under each tube.
 */
export default function Tubes({ values = {}, targets, height, caption, onPick, current }) {
  const peak = Math.max(1, ...LEVELS.map((l) => values[l] ?? 0));
  return (
    <div className="tubes" role="list">
      {LEVELS.map((l, i) => {
        const value = values[l] ?? 0;
        const target = targets ? (targets[l] ?? 0) : peak;
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag
            key={l}
            className="tube"
            role="listitem"
            data-level={l}
            data-current={current === l ? 'true' : undefined}
            type={onPick ? 'button' : undefined}
            onClick={onPick ? () => onPick(l) : undefined}
            aria-label={`${LABEL[l]}: ${value}${targets ? ` of ${target}` : ''}`}
          >
            <Tube fill={target > 0 ? value / target : 0} n={i + 1} height={height} />
            <span className="tube-cap">
              <span className="tube-name">{LABEL[l]}</span>
              <span className="tube-ct">{caption ? caption(l, value, target) : targets ? `${value}/${target}` : value}</span>
            </span>
          </Tag>
        );
      })}
    </div>
  );
}
