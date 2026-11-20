/**
 * chart: set the height of each bar on an empty bar chart (docs/API.md, "The
 * new kinds"). The server sends the empty chart as `board` and no drawing, so
 * it is drawn here, on the white card and in the colours of the server's own
 * figures (server/src/figures/common.js), in both themes.
 *
 * Each bar is a slider. Press anywhere in its column and the top comes to the
 * finger, then follows it (a thumb need not find a 4px edge first); or focus it
 * and use the arrow keys, one `step` a press. Heights snap to the scale and
 * every bar starts at `min`. Sends one height per category, in their order.
 */
import { useRef, useState } from 'react';

import { Send } from '../Answer.jsx';

const W = 340;          // viewBox width; the card scales it to the phone
const PLOT_H = 200;     // the bars' travel
const TOP = 24;         // room for a value above a full bar
const RIGHT = 8;

const placesOf = (n) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(6, s.length - i - 1); };

/** A category name in at most two lines of about `n` characters. */
function wrap(name, n) {
  const lines = [];
  for (const w of String(name).split(/\s+/).filter(Boolean)) {
    const last = lines.length - 1;
    if (last >= 0 && (lines[last] + ' ' + w).length <= n) lines[last] += ' ' + w;
    else lines.push(w);
  }
  if (lines.length > 2) lines.splice(1, lines.length, lines.slice(1).join(' '));
  return lines.map((l) => (l.length > n ? `${l.slice(0, n - 1)}…` : l));
}

export default function ChartBars({ question, result, locked, busy, onSubmit }) {
  const b = question.board ?? {};
  const cats = Array.isArray(b.categories) ? b.categories.map(String) : [];
  const min = Number(b.min) || 0;
  const step = Number(b.step) > 0 ? Number(b.step) : 1;
  const steps = Math.max(1, Math.floor((Number(b.max) - min) / step + 1e-9));   // the highest bar, in steps
  const places = placesOf(step);
  const at = (k) => Number((min + k * step).toFixed(places));
  const max = at(steps);
  const fmt = (v) => String(Number(Number(v).toFixed(places)));
  const snap = (v) => at(Math.min(steps, Math.max(0, Math.round((v - min) / step))));

  const [h, setH] = useState(() => cats.map(() => min));
  const [active, setActive] = useState(null);
  const [said, setSaid] = useState('');
  const svgRef = useRef(null);
  const grab = useRef(null);
  const live = useRef(h);
  live.current = h;

  const right = Array.isArray(result?.solution) ? result.solution.map(Number) : null;

  /* ---- the layout, in viewBox units ---- */
  const stride = Math.ceil(steps / 8);                       // a labelled line every `stride` steps
  const ticks = Array.from({ length: steps + 1 }, (_, k) => k);
  const left = 12 + (b.label ? 16 : 0) + Math.max(...ticks.filter((k) => k % stride === 0).map((k) => fmt(at(k)).length)) * 6.6;
  const band = (W - left - RIGHT) / Math.max(1, cats.length);
  const names = cats.map((c) => wrap(c, Math.max(4, Math.floor(band / 6.2))));
  const rows = Math.max(1, ...names.map((l) => l.length));
  const base = TOP + PLOT_H;
  const H = base + 10 + rows * 14 + (b.xLabel ? 20 : 4);
  const y = (v) => TOP + PLOT_H * (1 - (v - min) / (max - min));
  const mid = (i) => left + band * (i + 0.5);
  const barW = right ? Math.min(34, band * 0.36) : Math.min(56, band * 0.56);

  const put = (i, v) => {
    const s = snap(v);
    setH((hs) => (hs[i] === s ? hs : hs.map((x, j) => (j === i ? s : x))));
    return s;
  };
  const tell = (i, v) => setSaid(`${cats[i]} set to ${fmt(v)}.`);

  // The pointer, in viewBox units: the card scales the drawing to the phone.
  const valueAt = (e) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return min + (1 - (p.y - TOP) / PLOT_H) * (max - min);
  };

  const down = (i) => (e) => {
    if (locked || e.button > 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // The height is kept here too: a quick release can come before a render.
    grab.current = { i, v: live.current[i] };
    setActive(i);
    move(e);
  };
  const move = (e) => {
    const g = grab.current;
    const v = g && valueAt(e);
    if (v != null) g.v = put(g.i, v);
  };
  const up = () => {
    const g = grab.current;
    if (!g) return;
    grab.current = null;
    setActive(null);
    tell(g.i, g.v);
  };

  const keys = (i) => (e) => {
    if (locked) return;
    const cur = live.current[i];
    const by = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: step * stride, PageDown: -step * stride }[e.key];
    let v;
    if (by !== undefined) v = cur + by;
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else return;
    e.preventDefault();
    tell(i, put(i, v));
  };

  const bar = (cls, x, v, w) => {
    const top = y(v);
    return <rect className={cls} x={x} y={top} width={w} height={Math.max(0, base - top)} rx="2" />;
  };

  return (
    <div className="fk-bar">
      <p className="hint" role="status">
        {right
          ? 'Your bars, and beside each one the right height.'
          : said || 'Drag each bar to its height, or pick a bar and use the arrow keys.'}
      </p>

      <div className="fk-bar-card">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="fk-bar-svg" data-drag={active !== null ? 'true' : undefined}>
          <g aria-hidden="true">
            {ticks.map((k) => (
              <line key={k} className={k % stride === 0 ? 'fk-bar-grid' : 'fk-bar-grid fk-bar-minor'} x1={left} x2={W - RIGHT} y1={y(at(k))} y2={y(at(k))} />
            ))}
            {ticks.filter((k) => k % stride === 0).map((k) => (
              <text key={k} className="fk-bar-tick" x={left - 6} y={y(at(k))} textAnchor="end" dominantBaseline="middle">{fmt(at(k))}</text>
            ))}
            <line className="fk-bar-axis" x1={left} x2={left} y1={TOP - 6} y2={base} />
            <line className="fk-bar-axis" x1={left} x2={W - RIGHT} y1={base} y2={base} />
            {b.label && (
              <text className="fk-bar-name" transform={`translate(12 ${TOP + PLOT_H / 2}) rotate(-90)`} textAnchor="middle" dominantBaseline="middle">{b.label}</text>
            )}
            {names.map((lines, i) => (
              <text key={i} className="fk-bar-cat" x={mid(i)} y={base + 18} textAnchor="middle">
                {lines.map((l, n) => <tspan key={n} x={mid(i)} dy={n ? 14 : 0}>{l}</tspan>)}
              </text>
            ))}
            {b.xLabel && <text className="fk-bar-name" x={left + (W - RIGHT - left) / 2} y={H - 6} textAnchor="middle">{b.xLabel}</text>}
          </g>

          {cats.map((c, i) => {
            const v = h[i];
            const x = right ? mid(i) - barW - 2 : mid(i) - barW / 2;
            return (
              <g
                key={i}
                className="fk-bar-col"
                role="slider"
                tabIndex={locked ? -1 : 0}
                aria-label={c}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={v}
                aria-valuetext={right ? `${fmt(v)}, right height ${fmt(right[i])}` : fmt(v)}
                aria-disabled={locked || undefined}
                data-active={active === i ? 'true' : undefined}
                onPointerDown={down(i)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onKeyDown={keys(i)}
              >
                {/* The whole column is the target: a band wide and the full travel tall. */}
                <rect className="fk-bar-hit" x={mid(i) - band / 2} y={TOP - 12} width={band} height={PLOT_H + 12} />
                <rect className="fk-bar-ring" x={mid(i) - band / 2 + 2} y={TOP - 14} width={band - 4} height={PLOT_H + 18} rx="6" />
                {bar(right ? 'fk-bar-mine' : 'fk-bar-fill', x, v, barW)}
                {!locked && <rect className="fk-bar-grip" x={mid(i) - Math.min(14, barW / 2 - 4)} y={y(v) - 3} width={Math.min(28, barW - 8)} height="6" rx="3" />}
                <text className="fk-bar-val" x={x + barW / 2} y={y(v) - 8} textAnchor="middle" aria-hidden="true">{fmt(v)}</text>
                {right && (
                  <g aria-hidden="true">
                    {bar('fk-bar-right', mid(i) + 2, right[i], barW)}
                    <text className="fk-bar-val fk-bar-val-right" x={mid(i) + 2 + barW / 2} y={y(right[i]) - 8} textAnchor="middle">{fmt(right[i])}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
        {right && (
          <p className="fk-bar-legend" aria-hidden="true">
            <span><i className="fk-bar-sw" />Your bars</span>
            <span><i className="fk-bar-sw fk-bar-sw-right" />The right heights</span>
          </p>
        )}
      </div>

      {!result && <Send label="Submit bars" disabled={cats.length === 0} busy={busy} onClick={() => onSubmit(h)} />}
    </div>
  );
}
