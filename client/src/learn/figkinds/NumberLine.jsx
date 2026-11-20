/**
 * numberline: mark points, intervals (each end open or closed) and rays (a
 * start, open or closed, and a direction) on the server's number line,
 * snapping to `grid.step`. Sends `{ points, intervals: [{ from, to, fromOpen,
 * toOpen }], rays: [{ from, direction, open }] }`.
 *
 * Pick what to mark, then tap the line: a point is one tap; an interval is its
 * two ends; a ray is its start, then the side it points to. A tap on an end
 * makes it open or closed, as a hollow or filled circle on paper; a press on a
 * mark drags it. The list under the line is the keyboard's way in: each end is
 * a button that toggles open and closed, with arrow keys that move it a step.
 */

import { useEffect, useRef, useState } from 'react';

import { Icon, Segmented } from '../../ui/index.jsx';
import { Send } from '../Answer.jsx';
import { INK, KEY, SEL, More, REACH, SLOP, Stage, clean, local, show, snap, useScale, viewOf } from './Plot.jsx';

/* The most marks a key asks for (server MAX_LINE_MARKS); a mark beyond the key costs one. */
const MAX = 6;

const TOOLS = [
  { id: 'point', label: 'Point' },
  { id: 'interval', label: 'Interval' },
  { id: 'ray', label: 'Ray' },
];

const state = (open) => (open ? 'open' : 'closed');

/** A mark in words, for the list, the status line and the answer. */
function words(m) {
  if (m.type === 'point') return `Point at ${show(m.at)}`;
  if (m.type === 'interval') return `From ${show(m.from)}, ${state(m.fromOpen)}, to ${show(m.to)}, ${state(m.toOpen)}`;
  return `From ${show(m.from)}, ${state(m.open)}, to the ${m.direction}`;
}

/** The marks drawn on the line: thick ink over the axis, filled or hollow ends. */
function Marks({ marks, sx, y, k, view, colour, hot, pending }) {
  const end = (v, open, lit) => (
    <>
      {lit && <circle cx={sx(v)} cy={y} r={12 * k} fill="none" stroke={SEL} strokeWidth={2.5 * k} />}
      <circle cx={sx(v)} cy={y} r={6.5 * k} fill={open ? '#FFFFFF' : colour} stroke={colour} strokeWidth={2.5 * k} />
    </>
  );
  const on = (m, e) => hot && hot.id === m.id && hot.end === e;
  return (
    <>
      {marks.map((m) => {
        if (m.type === 'point') return <g key={m.id}>{end(m.at, false, on(m, 'at'))}</g>;
        if (m.type === 'interval') {
          return (
            <g key={m.id}>
              <line x1={sx(m.from)} y1={y} x2={sx(m.to)} y2={y} stroke={colour} strokeWidth={5 * k} />
              {end(m.from, m.fromOpen, on(m, 'from'))}
              {end(m.to, m.toOpen, on(m, 'to'))}
            </g>
          );
        }
        const d = m.direction === 'right' ? 1 : -1;
        const tip = d > 0 ? view.w - 12 * k : 12 * k;
        return (
          <g key={m.id}>
            <line x1={sx(m.from)} y1={y} x2={tip - d * 8 * k} y2={y} stroke={colour} strokeWidth={5 * k} />
            <path d={`M${tip},${y} L${tip - d * 12 * k},${y - 7 * k} L${tip - d * 12 * k},${y + 7 * k} Z`} fill={colour} />
            {end(m.from, m.open, on(m, 'from'))}
          </g>
        );
      })}
      {pending !== null && pending !== undefined && (
        <circle cx={sx(pending)} cy={y} r={9 * k} fill="none" stroke={SEL} strokeWidth={2.5 * k} strokeDasharray={`${4 * k} ${3 * k}`} />
      )}
    </>
  );
}

export default function NumberLine({ question, result, locked, busy, onSubmit }) {
  const { grid, stimulus } = question;
  const { min, max, step, frame: f } = grid;
  const svg = stimulus?.svg;
  const view = viewOf(svg, f);

  const [tool, setTool] = useState('point');
  const [marks, setMarks] = useState([]);   // {id, type:'point', at} | {id, type:'interval', from, to, fromOpen, toOpen} | {id, type:'ray', from, direction, open}
  const [pending, setPending] = useState(null); // the first tap of an interval or a ray
  const [hot, setHot] = useState(null);     // the end the keyboard is on: { id, end }
  const [said, setSaid] = useState('');
  const nextId = useRef(1);
  const overRef = useRef(null);
  const grab = useRef(null);
  const endRefs = useRef(new Map());
  const addRef = useRef(null);
  const wantFocus = useRef(null);
  const k = useScale(overRef, view.w);

  useEffect(() => {
    const key = wantFocus.current;
    if (key === null) return;
    wantFocus.current = null;
    (key === 'add' ? addRef.current : endRefs.current.get(key))?.focus({ preventScroll: true });
  });

  const sx = (v) => f.left + ((v - min) / (max - min)) * (f.right - f.left);
  const valueAt = (vx) => snap(min + ((vx - f.left) / (f.right - f.left)) * (max - min), min, max, step);
  const nameOf = (m) => `${m.type[0].toUpperCase()}${m.type.slice(1)} ${marks.filter((q) => q.type === m.type).indexOf(m) + 1}`;
  const valueOf = (m, end) => (end === 'at' ? m.at : m[end]);
  const isOpen = (m, end) => (end === 'to' ? m.toOpen : m.type === 'ray' ? m.open : m.fromOpen);

  const put = (m) => {
    setMarks([...marks, m]);
    setSaid(`${words(m)}.${m.type === 'point' ? '' : ' Tap an end to make it open or closed.'}`);
  };

  /** A tap on the line, away from any mark. */
  const tapAt = (v) => {
    if (pending === null && marks.length >= MAX) { setSaid(`${MAX} marks is the most. Remove one to add another.`); return; }
    if (tool === 'point') {
      if (marks.some((m) => m.type === 'point' && m.at === v)) { setSaid(`There is already a point at ${show(v)}.`); return; }
      put({ id: nextId.current++, type: 'point', at: v });
      return;
    }
    if (pending === null) {
      setPending(v);
      setSaid(tool === 'interval' ? `Starts at ${show(v)}. Now tap where it ends.` : `Starts at ${show(v)}. Now tap the side it points to.`);
      return;
    }
    if (v === pending) { setSaid(tool === 'interval' ? 'Tap a different place for the other end.' : 'Tap to the left or the right of its start.'); return; }
    setPending(null);
    put(tool === 'interval'
      ? { id: nextId.current++, type: 'interval', from: Math.min(pending, v), to: Math.max(pending, v), fromOpen: false, toOpen: false }
      : { id: nextId.current++, type: 'ray', from: pending, direction: v > pending ? 'right' : 'left', open: false });
  };

  const change = (id, patch) => setMarks((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  /** An end moved to v, kept on its own side of the interval's other end. */
  const moveTo = (m, end, v) => {
    let to = v;
    if (m.type === 'interval' && end === 'from') to = Math.min(v, clean(m.to - step));
    if (m.type === 'interval' && end === 'to') to = Math.max(v, clean(m.from + step));
    if (m.type === 'point' && marks.some((q) => q.id !== m.id && q.type === 'point' && q.at === to)) return null;
    change(m.id, { [end]: to });
    return to;
  };

  const flip = (m, end) => {
    const field = end === 'to' ? 'toOpen' : m.type === 'ray' ? 'open' : 'fromOpen';
    change(m.id, { [field]: !m[field] });
    setSaid(`${nameOf(m)}: the end at ${show(valueOf(m, end))} is now ${state(!m[field])}.`);
  };

  const remove = (m) => {
    const i = marks.indexOf(m);
    const rest = marks.filter((q) => q.id !== m.id);
    setMarks(rest);
    setHot(null);
    const next = rest[Math.min(i, rest.length - 1)];
    wantFocus.current = next ? `${next.id}:${next.type === 'point' ? 'at' : 'from'}` : 'add';
    setSaid(`${nameOf(m)} removed.`);
  };

  /** The keyboard's way to add one: near 0, on a free place, ready to move with the arrows. */
  const add = () => {
    if (marks.length >= MAX) return;
    const a = snap(0, min, max, step);
    let m;
    if (tool === 'point') {
      let at = a;
      for (let n = 1; marks.some((q) => q.type === 'point' && q.at === at) && n < 200; n += 1) at = snap(a + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * step, min, max, step);
      m = { id: nextId.current++, type: 'point', at };
    } else if (tool === 'interval') {
      const b = snap(a + 2 * step, min, max, step);
      const [from, to] = b > a ? [a, b] : [snap(a - 2 * step, min, max, step), a];
      m = { id: nextId.current++, type: 'interval', from, to, fromOpen: false, toOpen: false };
    } else {
      m = { id: nextId.current++, type: 'ray', from: a, direction: 'right', open: false };
    }
    setPending(null);
    put(m);
    wantFocus.current = `${m.id}:${m.type === 'point' ? 'at' : 'from'}`;
  };

  const keys = (m, end) => (e) => {
    const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (d) {
      e.preventDefault();
      const was = valueOf(m, end);
      const v = moveTo(m, end, snap(was + d * step, min, max, step));
      setSaid(v === null ? `Another point is already at ${show(snap(was + d * step, min, max, step))}.`
        : v === was ? `It cannot go further that way; it is at ${show(v)}.`
          : `${nameOf(m)}: ${end === 'at' ? 'at' : end === 'to' ? 'end at' : 'start at'} ${show(v)}.`);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(m);
    }
  };

  /* ----------------------------------------------------- pointer on the line */
  const onDown = (e) => {
    if (locked || e.button > 0) return;
    const { vx, k: kk } = local(overRef.current, e, view);
    const reach = REACH * kk;
    let hit = null;
    let best = reach;
    // While an interval or a ray waits for its second tap, a tap is that tap.
    if (pending === null) {
      for (const m of marks) {
        for (const end of m.type === 'point' ? ['at'] : m.type === 'interval' ? ['from', 'to'] : ['from']) {
          const d = Math.abs(sx(valueOf(m, end)) - vx);
          if (d <= best) { best = d; hit = { id: m.id, end }; }
        }
      }
    }
    if (!hit && (vx < f.left - reach || vx > f.right + reach)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { hit, x0: e.clientX, y0: e.clientY, moved: false };
  };
  const onMove = (e) => {
    const g = grab.current;
    if (!g?.hit) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < SLOP) return;
    g.moved = true;
    const m = marks.find((q) => q.id === g.hit.id);
    if (m) moveTo(m, g.hit.end, valueAt(local(overRef.current, e, view).vx));
  };
  const onUp = (e) => {
    const g = grab.current;
    grab.current = null;
    if (!g) return;
    const m = g.hit && marks.find((q) => q.id === g.hit.id);
    if (m && g.moved) setSaid(`${nameOf(m)}: ${words(m).replace(/^Point at/, 'at')}.`);
    else if (m && m.type === 'point') setSaid(`${words(m)}. Drag it to move it.`);
    else if (m) flip(m, g.hit.end);
    else tapAt(valueAt(local(overRef.current, e, view).vx));
  };
  const onCancel = () => { grab.current = null; };

  /* --------------------------------------------------------------- marking */
  const sol = result?.solution;
  const keyMarks = sol ? [
    ...(Array.isArray(sol.points) ? sol.points : []).map((at, i) => ({ id: `p${i}`, type: 'point', at })),
    ...(Array.isArray(sol.intervals) ? sol.intervals : []).map((iv, i) => ({ id: `i${i}`, type: 'interval', from: iv.from, to: iv.to, fromOpen: Boolean(iv.fromOpen), toOpen: Boolean(iv.toOpen) })),
    ...(Array.isArray(sol.rays) ? sol.rays : []).map((r, i) => ({ id: `r${i}`, type: 'ray', from: r.from, direction: r.direction, open: Boolean(r.open) })),
  ] : [];
  // A second copy of the drawing for the answer, with its ids renamed so the two never share one.
  const rootId = /<svg[^>]*\sid="([^"]+)"/.exec(svg ?? '')?.[1];
  const keySvg = rootId ? svg.split(rootId).join(`${rootId}-key`) : svg;

  let lead;
  if (result) lead = keyMarks.length ? 'The answer is drawn under yours.' : 'Your marks are in.';
  else if (said) lead = said;
  else if (pending !== null) lead = tool === 'interval' ? 'Now tap where it ends.' : 'Now tap the side it points to.';
  else lead = { point: 'Tap the line to mark a point.', interval: 'Tap where the interval starts, then where it ends.', ray: 'Tap where the ray starts, then the side it points to.' }[tool];

  const response = () => ({
    points: marks.filter((m) => m.type === 'point').map((m) => m.at),
    intervals: marks.filter((m) => m.type === 'interval').map(({ from, to, fromOpen, toOpen }) => ({ from, to, fromOpen, toOpen })),
    rays: marks.filter((m) => m.type === 'ray').map(({ from, direction, open }) => ({ from, direction, open })),
  });

  const endButton = (m, end, label) => {
    const v = valueOf(m, end);
    const open = isOpen(m, end);
    const key = `${m.id}:${end}`;
    return (
      <button
        ref={(el) => (el ? endRefs.current.set(key, el) : endRefs.current.delete(key))}
        type="button"
        className="fk-line-end"
        disabled={locked}
        aria-label={end === 'at'
          ? `${nameOf(m)} at ${show(v)}. Arrow keys move it; Delete removes it.`
          : `${label} of ${nameOf(m).toLowerCase()}: ${show(v)}, ${state(open)}. Press to make it ${state(!open)}. Arrow keys move it.`}
        onClick={() => (end === 'at' ? setSaid(`${words(m)}. Arrow keys move it.`) : flip(m, end))}
        onKeyDown={keys(m, end)}
        onFocus={() => setHot({ id: m.id, end })}
        onBlur={() => setHot(null)}
      >
        <span className="fk-line-glyph" data-open={end !== 'at' && open ? 'true' : undefined} aria-hidden="true" />
        {show(v)}
      </button>
    );
  };

  return (
    <div className="fk-line">
      <p className="hint" role="status">{lead}</p>

      {!locked && (
        <div className="fk-line-tools">
          <Segmented
            label="What to mark"
            options={TOOLS}
            value={tool}
            onChange={(t) => { setTool(t); setPending(null); setSaid(''); }}
          />
        </div>
      )}

      <Stage
        ref={overRef}
        svg={svg}
        view={view}
        still={locked}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        <Marks marks={marks} sx={sx} y={f.y} k={k} view={view} colour={INK} hot={locked ? null : hot} pending={locked ? null : pending} />
      </Stage>

      {(marks.length > 0 || !locked) && (
        <ul className="fk-line-list" aria-label="Your marks">
          {marks.map((m) => (
            <li key={m.id} className="fk-line-mark">
              <span className="fk-line-what">{m.type === 'point' ? 'Point' : m.type === 'interval' ? 'Interval' : 'Ray'}</span>
              {m.type === 'point' && endButton(m, 'at')}
              {m.type === 'interval' && (
                <>
                  {endButton(m, 'from', 'Start')}
                  <span className="fk-line-to" aria-hidden="true">to</span>
                  {endButton(m, 'to', 'End')}
                </>
              )}
              {m.type === 'ray' && (
                <>
                  {endButton(m, 'from', 'Start')}
                  <button
                    type="button"
                    className="fk-line-end"
                    disabled={locked}
                    aria-label={`${nameOf(m)} points ${m.direction}. Press to point it ${m.direction === 'right' ? 'left' : 'right'}.`}
                    onClick={() => {
                      const direction = m.direction === 'right' ? 'left' : 'right';
                      change(m.id, { direction });
                      setSaid(`${nameOf(m)} now points ${direction}.`);
                    }}
                  >
                    <Icon name="forward" size={16} className={m.direction === 'left' ? 'fk-line-left' : undefined} />
                    {m.direction === 'right' ? 'Right' : 'Left'}
                  </button>
                </>
              )}
              {!locked && (
                <button type="button" className="fk-plot-x fk-line-x" aria-label={`Remove ${nameOf(m).toLowerCase()}`} onClick={() => remove(m)}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </li>
          ))}
          {!locked && marks.length < MAX && (
            <li>
              <button ref={addRef} type="button" className="fk-plot-add" onClick={add}>
                <Icon name="plus" size={16} />{tool === 'point' ? 'Add a point' : tool === 'interval' ? 'Add an interval' : 'Add a ray'}
              </button>
            </li>
          )}
        </ul>
      )}

      {result && keyMarks.length > 0 && (
        <div className="well ln-keybox">
          <span className="t-label">The answer</span>
          <Stage svg={keySvg} view={view} still>
            <Marks marks={keyMarks} sx={sx} y={f.y} k={k} view={view} colour={KEY} />
          </Stage>
          {keyMarks.map((m) => <b key={m.id}>{words(m)}</b>)}
        </div>
      )}

      <More stimulus={stimulus} />

      {!result && <Send label="Submit answer" disabled={marks.length === 0} busy={busy} onClick={() => onSubmit(response())} />}
    </div>
  );
}
