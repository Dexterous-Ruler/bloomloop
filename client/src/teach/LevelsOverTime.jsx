/**
 * Levels over time (Batch 8, insights gaps 2 and 6). Staff only, inside the
 * live insights (teach/Insights.jsx): never on a phone or the projector.
 *
 *   <LevelTrend series />   each level's accuracy minute by minute, one small
 *                           chart per level, with the room's own goal as a line
 *   <SupportThen p />       beside the Needs support tile: the same students in
 *                           the class's previous room, then against now
 *
 * Every figure and sentence is the server's (GET /api/session/:code/insights,
 * `series.points[].levels`, `series.threshold`, `kpis.support.previousRoom`).
 * A point without `levels` (a server before Batch 8) draws nothing, and with no
 * such point the chart is not shown at all. The goal is the room's, never a
 * fixed 60%.
 *
 * Six levels are six small charts rather than six lines on one: each is named
 * by its level chip (colour and word), so no line is told apart by colour alone.
 */

import { useId, useMemo, useState } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { Icon, Level } from '../ui/index.jsx';

import '../styles/levels.css';

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v) => (num(v) === null ? '—' : `${Math.round(v * 100)}%`);
const clock = (iso) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

/** A change in percentage points as the server gives it (one decimal at most), signed. */
export function pointsText(change) {
  const c = num(change);
  if (c === null) return '';
  const n = Math.round(c * 10) / 10;
  if (n === 0) return 'No change';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)} pts`;
}

/** One level's figure at one point: "62%" and "8 of 13 right", or nothing answered yet. */
function said(cell) {
  const answers = num(cell?.answers) ?? 0;
  if (!answers || num(cell?.accuracy) === null) return null;
  return { value: pct(cell.accuracy), counts: `${cell.correct ?? 0} of ${answers} right` };
}

/* ------------------------------------------------------- one small chart */

const W = 100;
const H = 100;

/** The line's path over the points (x 0..1, accuracy 0..1), broken where a level had no answer. */
function pathOf(xs, values) {
  let d = '';
  let open = false;
  values.forEach((v, i) => {
    if (v === null) { open = false; return; }
    const x = (xs[i] * W).toFixed(2);
    const y = ((1 - v) * H).toFixed(2);
    d += `${open ? 'L' : 'M'}${x} ${y}`;
    open = true;
  });
  return d;
}

/** The wash under the line, one closed shape per unbroken run. */
function areaOf(xs, values) {
  let d = '';
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      d += `M${(xs[run[0]] * W).toFixed(2)} ${H}`;
      run.forEach((i) => { d += `L${(xs[i] * W).toFixed(2)} ${((1 - values[i]) * H).toFixed(2)}`; });
      d += `L${(xs[run.at(-1)] * W).toFixed(2)} ${H}Z`;
    }
    run = [];
  };
  values.forEach((v, i) => { if (v === null) flush(); else run.push(i); });
  flush();
  return d;
}

function Small({ level, cells, xs, goal, at, onAt }) {
  const values = cells.map((c) => (said(c) ? c.accuracy : null));
  const answered = values.some((v) => v !== null);
  // The figure shown: at the minute pointed at, else the latest with an answer.
  const lastKnown = values.reduce((k, v, i) => (v === null ? k : i), -1);
  const shownAt = at ?? lastKnown;
  const now = shownAt >= 0 ? said(cells[shownAt]) : null;
  const dot = shownAt >= 0 && values[shownAt] !== null ? { x: xs[shownAt], y: values[shownAt] } : null;

  function move(e) {
    const box = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - box.left) / Math.max(1, box.width)));
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - f) < Math.abs(xs[best] - f)) best = i; });
    onAt(best);
  }

  return (
    <li className="lo-sm" data-level={level} data-empty={answered ? undefined : 'true'}>
      <div className="lo-sm-h">
        <Level level={level} />
        <span className="lo-sm-fig">
          {now ? <><b>{now.value}</b><small>{now.counts}</small></> : <small>{answered ? 'No answer yet then' : 'No answer yet'}</small>}
        </span>
      </div>
      <div className="lo-plot" onPointerMove={answered ? move : undefined} onPointerLeave={() => onAt(null)} aria-hidden="true">
        <i className="lo-grid" style={{ top: 0 }} />
        <i className="lo-grid" style={{ top: '50%' }} />
        <i className="lo-grid lo-base" style={{ top: '100%' }} />
        <span className="lo-tick" style={{ top: 0 }}>100%</span>
        <span className="lo-tick" style={{ top: '50%' }}>50%</span>
        <span className="lo-tick" style={{ top: '100%' }}>0</span>
        {goal !== null && <i className="lo-goal" style={{ top: `${(1 - goal) * 100}%` }} />}
        {answered ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" focusable="false">
            <path className="lo-area" d={areaOf(xs, values)} />
            <path className="lo-line" d={pathOf(xs, values)} vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <span className="lo-plot-none">Nobody has answered at this level in this room yet.</span>
        )}
        {at !== null && <i className="lo-cross" style={{ left: `${xs[at] * 100}%` }} />}
        {dot && <i className="lo-dot" style={{ left: `${dot.x * 100}%`, top: `${(1 - dot.y) * 100}%` }} />}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------ the chart */

/**
 * Each level's accuracy in this room, minute by minute. Pointing at a chart (or
 * the arrow keys, once the charts have focus) moves every chart to that minute
 * together; "Show the data" gives the same figures as a table.
 */
export function LevelTrend({ series }) {
  const id = useId();
  const [at, setAt] = useState(null);
  const [table, setTable] = useState(false);
  const [spoken, setSpoken] = useState('');

  const points = useMemo(
    () => list(series?.points).filter((p) => p && p.levels && typeof p.levels === 'object' && !Number.isNaN(Date.parse(p.at))),
    [series],
  );
  const xs = useMemo(() => {
    if (points.length < 2) return points.map(() => 1);
    const t0 = Date.parse(points[0].at);
    const span = Math.max(1, Date.parse(points.at(-1).at) - t0);
    return points.map((p) => (Date.parse(p.at) - t0) / span);
  }, [points]);

  if (!points.length) return null;
  const goal = num(series?.threshold?.goal);
  const sentence = series?.threshold?.sentence;
  const cur = at !== null && at < points.length ? at : null;
  const first = clock(points[0].at);
  const last = clock(points.at(-1).at);

  const lineAt = (i) => `${clock(points[i].at)}. ${LEVELS.map((l) => {
    const s = said(points[i].levels[l]);
    return `${LABEL[l] ?? l}: ${s ? `${s.value}, ${s.counts}` : 'no answer'}`;
  }).join('; ')}.`;

  function onKey(e) {
    const end = points.length - 1;
    let next = null;
    if (e.key === 'ArrowRight') next = cur === null ? end : Math.min(end, cur + 1);
    else if (e.key === 'ArrowLeft') next = cur === null ? end : Math.max(0, cur - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = end;
    else if (e.key === 'Escape') { setAt(null); setSpoken(''); return; }
    else return;
    e.preventDefault();
    setAt(next);
    setSpoken(lineAt(next));
  }

  const summary = LEVELS.map((l) => {
    const s = said(points.at(-1).levels[l]);
    return `${LABEL[l] ?? l} ${s ? s.value : 'no answer'}`;
  }).join(', ');

  return (
    <section className="card lo-trend" aria-labelledby={`${id}-h`}>
      <div className="co-head co-head-wrap">
        <div className="sec">
          <h2 id={`${id}-h`}>Accuracy by level over time</h2>
          <p>
            Each level’s share of graded answers right so far in this room, minute by minute
            {points.length > 1 ? `, from ${first} to ${last}` : `, at ${last}`}, with the answers each figure rests on.
          </p>
        </div>
        <button type="button" className="co-link lo-show" aria-expanded={table} aria-controls={`${id}-tbl`} onClick={() => setTable((v) => !v)}>
          <Icon name={table ? 'chevronUp' : 'list'} size={14} />{table ? 'Hide the data' : 'Show the data'}
        </button>
      </div>

      <div className="lo-key">
        {goal !== null && <span className="lo-key-goal"><i aria-hidden="true" />{sentence || `Goal ${pct(goal)}`}</span>}
        <span className="lo-key-at" aria-hidden="true">
          {cur !== null ? <>At <b className="mono">{clock(points[cur].at)}</b></> : <>Latest, <b className="mono">{last}</b></>}
        </span>
      </div>

      <div
        className="lo-smalls-wrap"
        role="group"
        tabIndex={0}
        aria-label={`Six small charts, one per level, latest: ${summary}. Use the left and right arrow keys to move through the minutes.`}
        onKeyDown={onKey}
        onBlur={() => { setAt(null); setSpoken(''); }}
      >
        <ul className="lo-smalls">
          {LEVELS.map((l) => (
            <Small key={l} level={l} cells={points.map((p) => p.levels[l])} xs={xs} goal={goal} at={cur} onAt={setAt} />
          ))}
        </ul>
      </div>
      <p className="sr-only" aria-live="polite">{spoken}</p>

      {table && (
        <div className="tbl-wrap lo-tbl" id={`${id}-tbl`}>
          <table className="tbl">
            <caption className="sr-only">Accuracy at each level, minute by minute: share right, then right of answered</caption>
            <thead>
              <tr>
                <th scope="col">Minute</th>
                {LEVELS.map((l) => <th key={l} scope="col" className="r"><Level level={l} /></th>)}
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.at ?? i}>
                  <th scope="row" className="mono">{clock(p.at)}</th>
                  {LEVELS.map((l) => {
                    const s = said(p.levels[l]);
                    return <td key={l} className="r mono">{s ? <>{s.value} <small>{p.levels[l].correct}/{p.levels[l].answers}</small></> : '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------- the support band, last time */

/**
 * The students in Needs support now, set against how the same students did in
 * the class's previous room. Counts and the server's sentence only, never a
 * name. With no comparison to make (the class's first room, nobody below 40%,
 * nobody of them answered last time) it is the sentence alone.
 */
export function SupportThen({ p }) {
  if (!p || typeof p !== 'object') return null;
  const then = p.then;
  const now = p.now;
  const both = then && now && num(then.accuracy) !== null;
  const ch = pointsText(p.change);
  const bar = (v) => ({ width: `${Math.max(0, Math.min(1, num(v) ?? 0)) * 100}%` });
  return (
    <div className="lo-then">
      <span className="lo-then-k">
        <Icon name="hand" size={14} />
        <span>Needs support, against the previous room{p.room?.code ? <> <b className="mono">{p.room.code}</b></> : ''}</span>
      </span>
      {both && (
        <dl className="lo-then-figs">
          <div>
            <dt>Then</dt>
            <dd><b>{pct(then.accuracy)}</b><small>{then.correct} of {then.answers}</small></dd>
            <i className="lo-then-bar" data-side="then" aria-hidden="true"><b style={bar(then.accuracy)} /></i>
          </div>
          <div>
            <dt>Now</dt>
            <dd><b>{pct(now.accuracy)}</b><small>{now.correct ?? 0} of {now.answers ?? 0}</small></dd>
            <i className="lo-then-bar" data-side="now" aria-hidden="true"><b style={bar(now.accuracy)} /></i>
          </div>
          {ch && (
            <div className="lo-then-ch">
              <dt>Change</dt>
              <dd><b>{ch}</b></dd>
            </div>
          )}
        </dl>
      )}
      {p.sentence && <p className="lo-then-said">{p.sentence}</p>}
    </div>
  );
}
