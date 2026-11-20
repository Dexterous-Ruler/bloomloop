/**
 * plot: place points on the server's graph, or, when `place` is 'line', exactly
 * two points with the line drawn through them across the grid. Sends
 * `[[x, y], ...]`.
 *
 * The graph is the server's SVG, untouched; the points sit on an overlay in the
 * same viewBox, and `grid.frame` turns a tap into x and y, snapped to the grid
 * step. A tap places a point (at the limit it moves the chosen one instead); a
 * press on a point drags it; the list under the graph is the keyboard's way in:
 * each point is a button whose arrow keys move it one step, and whose
 * coordinates are said in the status line.
 *
 * Also exports the pieces NumberLine.jsx shares: the stage, the snapping and
 * the number format.
 */

import { forwardRef, useEffect, useRef, useState } from 'react';

import { Icon } from '../../ui/index.jsx';
import { Send } from '../Answer.jsx';
import '../../styles/figure.css';

/* How far a finger travels before a press on a mark becomes a drag (Answer.jsx's SLOP). */
export const SLOP = 8;
/* A press this many CSS pixels from a mark takes the mark: half of a 44 px target. */
export const REACH = 22;

/* The overlay is drawn on the server's white card, so in the card's own colours:
   the student's marks in ink, the chosen one ringed in the accent, the answer
   in the light theme's ok green and dashed (never colour alone). */
export const INK = '#1F2A24';
export const SEL = '#2F6B4F';
export const KEY = '#1B7246';

/** No float dust, and never -0. */
export const clean = (v) => Number(v.toFixed(9)) + 0;
/** A number as the figure prints it, with a real minus sign. */
export const show = (v) => (v < 0 ? `−${clean(-v)}` : String(clean(v)));

/** The grid value nearest v, on an axis that starts at min and steps by step, kept on the axis. */
export function snap(v, min, max, step) {
  const top = Math.floor((max - min) / step + 1e-9);
  return clean(min + Math.min(top, Math.max(0, Math.round((v - min) / step))) * step);
}

/** The drawing's box: the server's viewBox, or the grid's frame without one. */
export function viewOf(svg, frame) {
  const m = /viewBox="[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(svg ?? '');
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: frame.width, h: frame.height };
}

/** viewBox units per CSS pixel, so marks keep a thumb's size however wide the card is. */
export function useScale(ref, w) {
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const px = el.getBoundingClientRect().width;
      if (px) setK(w / px);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ref, w]);
  return k;
}

/** Where a pointer event falls, in viewBox units. */
export function local(el, e, view) {
  const r = el.getBoundingClientRect();
  return { vx: ((e.clientX - r.left) * view.w) / r.width, vy: ((e.clientY - r.top) * view.h) / r.height, k: view.w / r.width };
}

/**
 * The server's drawing with an overlay in the same viewBox, on the figure's
 * own white card. The overlay is hidden from screen readers: the drawing names
 * itself, and the controls under it are the accessible way to answer.
 */
export const Stage = forwardRef(function Stage({ svg, view, still, foot, children, ...events }, ref) {
  return (
    <div className="fig-card fk-plot-card">
      <div className="fk-plot-stage" style={{ maxWidth: view.w }}>
        <div className="fk-plot-svg" dangerouslySetInnerHTML={{ __html: svg || `<svg viewBox="0 0 ${view.w} ${view.h}"></svg>` }} />
        <svg ref={ref} className="fk-plot-over" data-still={still || undefined} viewBox={`0 0 ${view.w} ${view.h}`} aria-hidden="true" {...events}>
          <rect width={view.w} height={view.h} fill="transparent" />
          {children}
        </svg>
      </div>
      {foot}
    </div>
  );
});

/** "Describe" and "Show the data", as learn/Figure.jsx offers them. */
export function More({ stimulus }) {
  const table = stimulus?.table;
  const rows = table?.rows ?? [];
  if (!stimulus?.description && !rows[0]) return null;
  return (
    <div className="fig-more">
      {stimulus.description && (
        <details>
          <summary>Describe</summary>
          <p>{stimulus.description}</p>
        </details>
      )}
      {rows[0] && (
        <details>
          <summary>Show the data</summary>
          <div className="fig-table" tabIndex={0} role="region" aria-label="The figure's data">
            <table>
              {table.caption && <caption>{table.caption}</caption>}
              <thead><tr>{table.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/** The whole line through a and b, cut to the box (Liang-Barsky with no ends). Pixel space. */
function across(a, b, box) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (!dx && !dy) return null;
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [p, q] of [[-dx, a[0] - box.left], [dx, box.right - a[0]], [-dy, a[1] - box.top], [dy, box.bottom - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 > t1 ? null : [a[0] + t0 * dx, a[1] + t0 * dy, a[0] + t1 * dx, a[1] + t1 * dy];
}

/** `y = 2x + 1` as the server writes a linear function, read back to m and c; null for anything else. */
function linear(eq) {
  const s = String(eq ?? '').replace(/\s/g, '').replace(/−/g, '-');
  const m = /^y=(?:([+-]?(?:\d+(?:\.\d+)?)?)x)?([+-]?\d+(?:\.\d+)?)?$/.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const slope = m[1] === undefined ? 0 : m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
  return { m: slope, c: m[2] === undefined ? 0 : Number(m[2]) };
}

const okPair = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const pair = (x, y) => `(${show(x)}, ${show(y)})`;

export default function Plot({ question, result, locked, busy, onSubmit }) {
  const { grid, stimulus } = question;
  const { x: gx, y: gy, frame: f } = grid;
  const view = viewOf(stimulus?.svg, f);
  const isLine = question.place === 'line';
  const max = isLine ? 2 : Math.max(1, Number(question.maxPoints) || 1);

  const [pts, setPts] = useState([]);    // [{ id, x, y }], in the order placed
  const [sel, setSel] = useState(null);  // the chosen point's id
  const [said, setSaid] = useState('');
  const nextId = useRef(1);
  const overRef = useRef(null);
  const grab = useRef(null);             // the live press: which point, where it began, has it moved
  const pickRefs = useRef(new Map());
  const addRef = useRef(null);
  const wantFocus = useRef(null);
  const k = useScale(overRef, view.w);

  // A point a tap or a removal chose takes the focus, so the arrow keys work on it next.
  useEffect(() => {
    const id = wantFocus.current;
    if (id === null) return;
    wantFocus.current = null;
    (id === 'add' ? addRef.current : pickRefs.current.get(id))?.focus({ preventScroll: true });
  });

  const sx = (x) => f.left + ((x - gx.min) / (gx.max - gx.min)) * (f.right - f.left);
  const sy = (y) => f.bottom - ((y - gy.min) / (gy.max - gy.min)) * (f.bottom - f.top);
  const valueAt = (vx, vy) => [
    snap(gx.min + ((vx - f.left) / (f.right - f.left)) * (gx.max - gx.min), gx.min, gx.max, gx.step),
    snap(gy.min + ((f.bottom - vy) / (f.bottom - f.top)) * (gy.max - gy.min), gy.min, gy.max, gy.step),
  ];
  const nameOf = (id) => `Point ${pts.findIndex((p) => p.id === id) + 1}`;
  const taken = (x, y, but) => pts.find((p) => p.id !== but && p.x === x && p.y === y);

  const choose = (id) => {
    const p = pts.find((q) => q.id === id);
    setSel(id);
    setSaid(`${nameOf(id)} at ${pair(p.x, p.y)} is chosen.${pts.length >= max ? ' Tap where it should go.' : ''}`);
  };

  /** A tap on the grid: a new point, or at the limit the chosen point moved there. */
  const place = (x, y) => {
    const there = taken(x, y);
    if (there) { choose(there.id); return there.id; }
    if (pts.length < max) {
      const id = nextId.current++;
      setPts([...pts, { id, x, y }]);
      setSel(id);
      setSaid(`Point ${pts.length + 1} placed at ${pair(x, y)}.${isLine && pts.length === 1 ? ' The line goes through both.' : ''}`);
      return id;
    }
    const id = sel ?? pts[pts.length - 1].id;
    setPts(pts.map((p) => (p.id === id ? { ...p, x, y } : p)));
    setSel(id);
    setSaid(`${nameOf(id)} moved to ${pair(x, y)}.`);
    return id;
  };

  const nudge = (id, dx, dy) => {
    const p = pts.find((q) => q.id === id);
    const x = snap(p.x + dx * gx.step, gx.min, gx.max, gx.step);
    const y = snap(p.y + dy * gy.step, gy.min, gy.max, gy.step);
    setSel(id);
    if (x === p.x && y === p.y) { setSaid(`${nameOf(id)} is at the edge of the graph, ${pair(x, y)}.`); return; }
    if (taken(x, y, id)) { setSaid(`Another point is already at ${pair(x, y)}.`); return; }
    setPts(pts.map((q) => (q.id === id ? { ...q, x, y } : q)));
    setSaid(`${nameOf(id)} at ${pair(x, y)}.`);
  };

  const remove = (id) => {
    const i = pts.findIndex((p) => p.id === id);
    const rest = pts.filter((p) => p.id !== id);
    setPts(rest);
    const next = rest[Math.min(i, rest.length - 1)];
    setSel(next ? next.id : null);
    wantFocus.current = next ? next.id : 'add';
    setSaid(`Point ${i + 1} removed.${rest.length ? '' : ' No points on the graph.'}`);
  };

  /** The keyboard's way to place one: at the origin, or the nearest free spot to it. */
  const add = () => {
    const x0 = snap(0, gx.min, gx.max, gx.step);
    const y0 = snap(0, gy.min, gy.max, gy.step);
    let spot = [x0, y0];
    for (let n = 1; taken(...spot) && n < 40; n += 1) {
      spot = [[x0 + n * gx.step, y0], [x0 - n * gx.step, y0], [x0, y0 + n * gy.step], [x0, y0 - n * gy.step]]
        .map(([x, y]) => [snap(x, gx.min, gx.max, gx.step), snap(y, gy.min, gy.max, gy.step)])
        .find((s) => !taken(...s)) ?? spot;
    }
    wantFocus.current = place(...spot);
  };

  const keys = (id) => (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (d) { e.preventDefault(); nudge(id, ...d); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(id); }
  };

  /* ---------------------------------------------------- pointer on the graph */
  const onDown = (e) => {
    if (locked || e.button > 0) return;
    const { vx, vy, k: kk } = local(overRef.current, e, view);
    const reach = REACH * kk;
    let hit = null;
    let best = reach;
    for (const p of pts) {
      const d = Math.hypot(sx(p.x) - vx, sy(p.y) - vy);
      if (d <= best) { best = d; hit = p.id; }
    }
    // Off the plotting area and on no point: the axis labels, not the graph.
    if (hit === null && (vx < f.left - reach || vx > f.right + reach || vy < f.top - reach || vy > f.bottom + reach)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { id: hit, x0: e.clientX, y0: e.clientY, moved: false };
  };
  const onMove = (e) => {
    const g = grab.current;
    if (!g || g.id === null) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < SLOP) return;
    g.moved = true;
    const { vx, vy } = local(overRef.current, e, view);
    const [x, y] = valueAt(vx, vy);
    if (taken(x, y, g.id)) return;
    setPts((list) => list.map((p) => (p.id === g.id ? { ...p, x, y } : p)));
    setSel(g.id);
  };
  const onUp = (e) => {
    const g = grab.current;
    grab.current = null;
    if (!g) return;
    if (g.id !== null && g.moved) {
      const p = pts.find((q) => q.id === g.id);
      setSaid(`${nameOf(g.id)} moved to ${pair(p.x, p.y)}.`);
      wantFocus.current = g.id;
    } else if (g.id !== null) {
      choose(g.id);
      wantFocus.current = g.id;
    } else {
      const { vx, vy } = local(overRef.current, e, view);
      wantFocus.current = place(...valueAt(vx, vy));
    }
  };
  const onCancel = () => { grab.current = null; };

  /* --------------------------------------------------------------- marking */
  const sol = result?.solution;
  const keyPts = Array.isArray(sol?.points) ? sol.points.filter(okPair) : [];
  let keySeg = null;
  if (sol?.place === 'line') {
    const l = keyPts.length === 2 ? null : linear(sol.equation);
    if (keyPts.length === 2) keySeg = across([sx(keyPts[0][0]), sy(keyPts[0][1])], [sx(keyPts[1][0]), sy(keyPts[1][1])], f);
    else if (l) keySeg = across([sx(0), sy(l.c)], [sx(1), sy(l.m + l.c)], f);
  }
  const drawn = Boolean(keySeg || keyPts.length);
  let keyWords = null;
  if (keyPts.length) keyWords = `${sol.place === 'line' ? 'The line through' : 'The points'} ${keyPts.map((p) => pair(p[0], p[1])).join(sol.place === 'line' ? ' and ' : ', ')}`;
  else if (sol?.equation) keyWords = sol.place === 'line' ? `The line ${sol.equation}` : `Points on ${sol.equation}`;

  const mine = isLine && pts.length === 2 ? across([sx(pts[0].x), sy(pts[0].y)], [sx(pts[1].x), sy(pts[1].y)], f) : null;
  const ready = isLine ? pts.length === 2 : pts.length > 0;

  let lead;
  if (result) lead = !sol ? 'Your points are in.' : drawn ? 'The answer is drawn dashed, beside yours.' : 'The answer is under the graph.';
  else if (said) lead = said;
  else if (pts.length < max) lead = isLine ? `Tap the graph to place ${pts.length ? 'the second point' : 'two points on the line'}.` : `Tap the graph to place ${max === 1 ? 'the point' : `up to ${max} points`}.`;
  else lead = 'Drag a point to move it, or tap it and then where it should go.';

  return (
    <div className="fk-plot">
      <p className="hint" role="status">{lead}</p>

      <Stage
        ref={overRef}
        svg={stimulus?.svg}
        view={view}
        still={locked}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        foot={result && drawn && (
          <p className="fk-plot-legend" aria-hidden="true">
            <span><svg width="24" height="8"><line x1="1" y1="4" x2="23" y2="4" stroke={INK} strokeWidth="2.5" /></svg>Yours</span>
            <span><svg width="24" height="8"><line x1="1" y1="4" x2="23" y2="4" stroke={KEY} strokeWidth="2.5" strokeDasharray="6 4" /></svg>The answer</span>
          </p>
        )}
      >
        {/* The answer over the student's own, so a right line still shows both. */}
        {mine && <line x1={mine[0]} y1={mine[1]} x2={mine[2]} y2={mine[3]} stroke={INK} strokeWidth={2.5 * k} strokeLinecap="round" />}
        {keySeg && <line x1={keySeg[0]} y1={keySeg[1]} x2={keySeg[2]} y2={keySeg[3]} stroke={KEY} strokeWidth={2.5 * k} strokeDasharray={`${7 * k} ${5 * k}`} />}
        {pts.map((p) => (
          <g key={p.id}>
            {sel === p.id && !locked && <circle cx={sx(p.x)} cy={sy(p.y)} r={12 * k} fill="none" stroke={SEL} strokeWidth={2.5 * k} />}
            <circle cx={sx(p.x)} cy={sy(p.y)} r={6 * k} fill={INK} stroke="#FFFFFF" strokeWidth={2 * k} />
          </g>
        ))}
        {keyPts.map((p, i) => (
          <circle key={`k${i}`} cx={sx(p[0])} cy={sy(p[1])} r={10 * k} fill="none" stroke={KEY} strokeWidth={2.5 * k} strokeDasharray={`${4 * k} ${3 * k}`} />
        ))}
      </Stage>

      {(pts.length > 0 || !locked) && (
        <ul className="fk-plot-list" aria-label="Your points">
          {pts.map((p, i) => (
            <li key={p.id} className="fk-plot-chip" data-on={(sel === p.id && !locked) || undefined}>
              <button
                ref={(el) => (el ? pickRefs.current.set(p.id, el) : pickRefs.current.delete(p.id))}
                type="button"
                className="fk-plot-pick"
                disabled={locked}
                aria-label={`Point ${i + 1} at x ${show(p.x)}, y ${show(p.y)}. Arrow keys move it; Delete removes it.`}
                onClick={() => choose(p.id)}
                onKeyDown={keys(p.id)}
              >
                <span className="fk-plot-dot" aria-hidden="true" />
                {pair(p.x, p.y)}
              </button>
              {!locked && (
                <button type="button" className="fk-plot-x" aria-label={`Remove point ${i + 1}`} onClick={() => remove(p.id)}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </li>
          ))}
          {!locked && pts.length < max && (
            <li>
              <button ref={addRef} type="button" className="fk-plot-add" onClick={add}>
                <Icon name="plus" size={16} />Add a point
              </button>
            </li>
          )}
        </ul>
      )}

      {result && (keyWords || sol?.conditions) && (
        <div className="well ln-keybox">
          <span className="t-label">The answer</span>
          {keyWords && <b>{keyWords}</b>}
          {Array.isArray(sol?.conditions) && (
            <>
              <b>A line that</b>
              <ul className="fk-plot-conds">{sol.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </>
          )}
        </div>
      )}

      <More stimulus={stimulus} />

      {!result && <Send label="Submit answer" disabled={!ready} busy={busy} onClick={() => onSubmit(pts.map((p) => [p.x, p.y]))} />}
    </div>
  );
}
