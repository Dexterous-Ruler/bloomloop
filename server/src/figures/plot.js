// Graphs of functions from fixed families, with points, segments and shading.
//
// No expression is ever parsed: a function is a family name and its numbers, and
// evaluate() below is the whole of the maths. That is the point of the fixed
// families - a typed formula would need an expression evaluator, and evaluators
// are where code gets in (CVE-2025-12735 in expr-eval is the recent example).

import { scaleLinear } from 'd3-scale';
import { line as d3line } from 'd3-shape';

import {
  esc, fmt, px, text, partAttrs, arrowMarker,
  INK, MUTED, GRID, AXIS, ACCENT, HIGHLIGHT, SERIES, DASHES,
} from './common.js';

/** y for x on a function of a fixed family, or NaN off its domain. */
export function evaluate(f, x) {
  if (f.domain && (x < f.domain[0] || x > f.domain[1])) return NaN;
  const p = f.params ?? {};
  switch (f.family) {
    case 'linear': return p.m * x + p.c;
    case 'quadratic': return p.a * x * x + p.b * x + p.c;
    case 'cubic': return p.a * x ** 3 + p.b * x * x + p.c * x + p.d;
    case 'exponential': return p.a * p.base ** x + p.c;
    case 'logarithmic': return x - p.h > 0 ? (p.a * Math.log(x - p.h)) / Math.log(p.base) + p.c : NaN;
    case 'sine': return p.a * Math.sin(p.b * x + p.c) + p.d;
    case 'cosine': return p.a * Math.cos(p.b * x + p.c) + p.d;
    case 'absolute': return p.a * Math.abs(x - p.h) + p.k;
    case 'step': {
      const piece = (f.pieces ?? []).find((q) => x >= q.from && x <= q.to);
      return piece ? piece.y : NaN;
    }
    default: return NaN;
  }
}

/** "2x", "−x", "+ 3": a polynomial-style sum from [coefficient, what it multiplies]. */
function sum(terms) {
  let out = '';
  for (const [c, v] of terms) {
    if (c === 0) continue;
    const mag = Math.abs(c);
    const body = v ? `${mag === 1 ? '' : fmt(mag)}${v}` : fmt(mag);
    if (!out) out = c < 0 ? `−${body}` : body;
    else out += c < 0 ? ` − ${body}` : ` + ${body}`;
  }
  return out || '0';
}

const shift = (h) => (h === 0 ? 'x' : h > 0 ? `x − ${fmt(h)}` : `x + ${fmt(-h)}`);
const scaled = (a, body) => (a === 1 ? body : a === -1 ? `−${body}` : `${fmt(a)}${body}`);
const plusConst = (c) => (c === 0 ? '' : c > 0 ? ` + ${fmt(c)}` : ` − ${fmt(-c)}`);

/** The function as a reader would write it, for labels, the description and the table. */
export function equation(f) {
  const p = f.params ?? {};
  switch (f.family) {
    case 'linear': return `y = ${sum([[p.m, 'x'], [p.c, '']])}`;
    case 'quadratic': return `y = ${sum([[p.a, 'x²'], [p.b, 'x'], [p.c, '']])}`;
    case 'cubic': return `y = ${sum([[p.a, 'x³'], [p.b, 'x²'], [p.c, 'x'], [p.d, '']])}`;
    case 'exponential': return `y = ${scaled(p.a, `${p.a === 1 || p.a === -1 ? '' : ' × '}${fmt(p.base)}^x`).replace(/^ × /, '')}${plusConst(p.c)}`;
    case 'logarithmic': {
      const log = p.base === Math.E ? 'ln' : `log${p.base === 10 ? '' : `_${fmt(p.base)}`}`;
      return `y = ${scaled(p.a, `${p.a === 1 || p.a === -1 ? '' : ' '}${log}(${shift(p.h)})`).replace(/^ /, '')}${plusConst(p.c)}`;
    }
    case 'sine':
    case 'cosine': {
      const fn = f.family === 'sine' ? 'sin' : 'cos';
      const inner = sum([[p.b, 'x'], [p.c, '']]);
      return `y = ${scaled(p.a, `${p.a === 1 || p.a === -1 ? '' : ' '}${fn}(${inner})`).replace(/^ /, '')}${plusConst(p.d)}`;
    }
    case 'absolute': return `y = ${scaled(p.a, `|${shift(p.h)}|`)}${plusConst(p.k)}`;
    case 'step': return 'a step function';
    default: return '';
  }
}

const KIND_WORD = {
  linear: 'the straight line', quadratic: 'the parabola', cubic: 'the cubic curve', exponential: 'the exponential curve',
  logarithmic: 'the logarithmic curve', sine: 'the sine curve', cosine: 'the cosine curve', absolute: 'the V-shaped graph', step: 'the step graph',
};

const W = 520;
const H = 380;

/**
 * Where the graph sits in its picture: the plot interaction (questionTypes.js)
 * hands this to a phone so a tap can be turned back into x and y, so it is the
 * renderer's own layout rather than a copy of it.
 */
export function plotFrame(spec) {
  return { W, H, m: { l: 56, r: 20, t: spec.title ? 38 : 16, b: spec.x.label ? 52 : 34 } };
}

/** The gap between grid lines on an axis: its stated step, or the one the drawing picks. */
export function axisStep(ax) {
  if (ax.step) return ax.step;
  const t = scaleLinear().domain([ax.min, ax.max]).ticks(8);
  return t.length > 1 ? Number((t[1] - t[0]).toPrecision(12)) : ax.max - ax.min;
}

export function renderPlot(spec, { prefix, hl }) {
  const { m } = plotFrame(spec);
  const x = scaleLinear().domain([spec.x.min, spec.x.max]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([spec.y.min, spec.y.max]).range([H - m.b, m.t]);
  const lit = (id) => hl.has(String(id).toLowerCase());
  const ticks = (ax, s) => (ax.step ? Array.from({ length: Math.floor((ax.max - ax.min) / ax.step + 1e-9) + 1 }, (_, i) => ax.min + i * ax.step) : s.ticks(8));
  const xt = ticks(spec.x, x);
  const yt = ticks(spec.y, y);
  const clip = `${prefix}-clip`;
  const parts = [];
  // A labelled function's equation: worked out from its numbers and not drawn
  // (the label is drawn instead, often to hide it), so the professor's only.
  const worked = [];
  let body = '';

  if (spec.title) body += text(W / 2, 20, spec.title, { size: 15, weight: '600' });
  if (spec.grid) {
    body += `<g stroke="${GRID}" stroke-width="1">`;
    for (const t of xt) body += `<line x1="${px(x(t))}" y1="${px(m.t)}" x2="${px(x(t))}" y2="${px(H - m.b)}"/>`;
    for (const t of yt) body += `<line x1="${px(m.l)}" y1="${px(y(t))}" x2="${px(W - m.r)}" y2="${px(y(t))}"/>`;
    body += '</g>';
  }
  // Axes through zero when zero is on the graph, else along the edge.
  const ax0 = spec.y.min <= 0 && spec.y.max >= 0 ? y(0) : H - m.b;
  const ay0 = spec.x.min <= 0 && spec.x.max >= 0 ? x(0) : m.l;
  body += `<g stroke="${AXIS}" stroke-width="1.4"><line x1="${px(m.l)}" y1="${px(ax0)}" x2="${px(W - m.r)}" y2="${px(ax0)}"/>`
    + `<line x1="${px(ay0)}" y1="${px(m.t)}" x2="${px(ay0)}" y2="${px(H - m.b)}"/></g>`;
  for (const t of xt) {
    body += `<line x1="${px(x(t))}" y1="${px(ax0)}" x2="${px(x(t))}" y2="${px(ax0 + 4)}" stroke="${AXIS}"/>`;
    if (Math.abs(t) > 1e-12 || ay0 === m.l) body += text(x(t), Math.min(ax0 + 14, H - m.b + 14), fmt(t), { size: 11, fill: MUTED });
  }
  for (const t of yt) {
    body += `<line x1="${px(ay0 - 4)}" y1="${px(y(t))}" x2="${px(ay0)}" y2="${px(y(t))}" stroke="${AXIS}"/>`;
    if (Math.abs(t) > 1e-12 || ax0 === H - m.b) body += text(Math.max(ay0 - 7, m.l - 7), y(t), fmt(t), { size: 11, fill: MUTED, anchor: 'end' });
  }
  if (spec.x.label) body += text((m.l + W - m.r) / 2, H - 14, spec.x.label, { size: 12, fill: INK });
  if (spec.y.label) body += `<g transform="translate(16 ${px((m.t + H - m.b) / 2)}) rotate(-90)">${text(0, 0, spec.y.label, { size: 12 })}</g>`;

  const plotted = [];
  // Shading first, so the curves sit on top of it.
  for (const s of spec.shade) {
    const f = s.under ? spec.functions.find((g) => g.id === s.under) : null;
    const a = Math.max(s.from, spec.x.min);
    const b = Math.min(s.to, spec.x.max);
    let d = '';
    if (b > a) {
      if (f) {
        const n = 80;
        const pts = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n).map((t) => [t, evaluate(f, t)]).filter(([, v]) => Number.isFinite(v));
        if (pts.length > 1) {
          d = `M${px(x(pts[0][0]))},${px(ax0)} ${pts.map(([t, v]) => `L${px(x(t))},${px(y(v))}`).join(' ')} L${px(x(pts.at(-1)[0]))},${px(ax0)} Z`;
        }
      } else {
        d = `M${px(x(a))},${px(m.t)} L${px(x(b))},${px(m.t)} L${px(x(b))},${px(H - m.b)} L${px(x(a))},${px(H - m.b)} Z`;
      }
    }
    body += `<path ${partAttrs(prefix, s.id)} d="${d || 'M0,0'}" fill="${lit(s.id) ? HIGHLIGHT : ACCENT}" fill-opacity="${lit(s.id) ? 0.35 : 0.16}" stroke="none" clip-path="url(#${clip})"/>`;
    if (s.label && b > a) body += text(x((a + b) / 2), m.t + 14, s.label, { size: 11, fill: INK });
    parts.push({ part: s.id, label: s.label || `shaded from ${fmt(s.from)} to ${fmt(s.to)}`, drawn: s.label });
    plotted.push(`a region shaded from x = ${fmt(s.from)} to x = ${fmt(s.to)}${f ? ` under ${f.label || equation(f)}` : ''}${s.label ? ` (labelled ${s.label})` : ''}`);
  }

  spec.functions.forEach((f, i) => {
    const colour = lit(f.id) ? HIGHLIGHT : SERIES[i % SERIES.length];
    const width = lit(f.id) ? 3.5 : 2.2;
    const dash = f.dashed ? '6 4' : DASHES[i % DASHES.length];
    let paths = '';
    if (f.family === 'step') {
      for (const p of f.pieces) {
        paths += `<line x1="${px(x(p.from))}" y1="${px(y(p.y))}" x2="${px(x(p.to))}" y2="${px(y(p.y))}" stroke="${colour}" stroke-width="${width}"/>`;
        for (const [t, closed] of [[p.from, p.fromClosed], [p.to, p.toClosed]]) {
          paths += `<circle cx="${px(x(t))}" cy="${px(y(p.y))}" r="4" fill="${closed ? colour : '#FFFFFF'}" stroke="${colour}" stroke-width="1.6"/>`;
        }
      }
    } else {
      const a = Math.max(f.domain?.[0] ?? spec.x.min, spec.x.min);
      const b = Math.min(f.domain?.[1] ?? spec.x.max, spec.x.max);
      const n = 200;
      const span = spec.y.max - spec.y.min;
      // Values far off the graph are cut, so an asymptote is a break, not a wall.
      const pts = Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n).map((t) => [t, evaluate(f, t)]);
      const gen = d3line().defined(([, v]) => Number.isFinite(v) && v > spec.y.min - span && v < spec.y.max + span)
        .x(([t]) => x(t)).y(([, v]) => y(v)).digits(1);
      paths = `<path d="${gen(pts) ?? ''}" fill="none" stroke="${colour}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>`;
    }
    body += `<g ${partAttrs(prefix, f.id)} clip-path="url(#${clip})">${paths}</g>`;
    const name = f.label || equation(f);
    // The label sits at the right end of the visible curve, where it is easiest to tie to its line.
    const lx = Math.min(f.domain?.[1] ?? spec.x.max, spec.x.max) - (spec.x.max - spec.x.min) * 0.02;
    const ly = evaluate(f, lx);
    if (Number.isFinite(ly) && ly >= spec.y.min && ly <= spec.y.max) {
      body += text(Math.min(x(lx), W - m.r - 4), Math.max(m.t + 8, y(ly) - 10), name, { size: 12, anchor: 'end', fill: colour, weight: '600' });
    }
    // An unlabelled curve has its equation written beside it, so that is what
    // the description says; a labelled one shows only its label.
    parts.push({ part: f.id, label: f.label ? `${f.label}: ${equation(f)}` : equation(f), drawn: name });
    const what = f.family === 'step' ? `with ${f.pieces.length} piece${f.pieces.length === 1 ? '' : 's'}` : (f.label ? `labelled ${f.label}` : equation(f));
    plotted.push(`${KIND_WORD[f.family]} ${what}${f.domain ? ` for x from ${fmt(f.domain[0])} to ${fmt(f.domain[1])}` : ''}`);
    if (f.label && f.family !== 'step') worked.push(`${f.label} is ${equation(f)}.`);
  });

  for (const s of spec.segments) {
    const colour = lit(s.id) ? HIGHLIGHT : INK;
    body += `<line ${partAttrs(prefix, s.id)} x1="${px(x(s.from[0]))}" y1="${px(y(s.from[1]))}" x2="${px(x(s.to[0]))}" y2="${px(y(s.to[1]))}" stroke="${colour}" stroke-width="${lit(s.id) ? 3.2 : 2}"${s.dashed ? ' stroke-dasharray="6 4"' : ''}${s.arrow ? ` marker-end="url(#${prefix}-arrow)"` : ''} clip-path="url(#${clip})"/>`;
    if (s.label) body += text(x((s.from[0] + s.to[0]) / 2) + 6, y((s.from[1] + s.to[1]) / 2) - 8, s.label, { size: 12, anchor: 'start' });
    parts.push({ part: s.id, label: s.label || `segment from (${fmt(s.from[0])}, ${fmt(s.from[1])}) to (${fmt(s.to[0])}, ${fmt(s.to[1])})`, drawn: s.label });
    plotted.push(`a ${s.arrow ? 'arrow' : 'segment'} from (${fmt(s.from[0])}, ${fmt(s.from[1])}) to (${fmt(s.to[0])}, ${fmt(s.to[1])})${s.label ? ` labelled ${s.label}` : ''}`);
  }

  for (const p of spec.points) {
    const inView = p.x >= spec.x.min && p.x <= spec.x.max && p.y >= spec.y.min && p.y <= spec.y.max;
    const colour = lit(p.id) ? HIGHLIGHT : INK;
    body += `<g ${partAttrs(prefix, p.id)}><circle cx="${px(x(p.x))}" cy="${px(y(p.y))}" r="${lit(p.id) ? 6 : 4.5}" fill="${p.open ? '#FFFFFF' : colour}" stroke="${colour}" stroke-width="1.8"/>`
      + (p.label && inView ? text(x(p.x) + 8, y(p.y) - 10, p.label, { size: 12, anchor: 'start', weight: '600' }) : '')
      + '</g>';
    parts.push({ part: p.id, label: p.label ? `${p.label} (${fmt(p.x)}, ${fmt(p.y)})` : `(${fmt(p.x)}, ${fmt(p.y)})`, drawn: p.label });
    plotted.push(`${p.label ? `point ${p.label}` : 'a point'} at (${fmt(p.x)}, ${fmt(p.y)})${p.open ? ', drawn open' : ''}`);
  }

  const defs = `<clipPath id="${esc(clip)}"><rect x="${px(m.l)}" y="${px(m.t)}" width="${px(W - m.l - m.r)}" height="${px(H - m.t - m.b)}"/></clipPath>`
    + arrowMarker(prefix, 'arrow', INK);
  const axes = `x from ${fmt(spec.x.min)} to ${fmt(spec.x.max)}${spec.x.label ? ` (${spec.x.label})` : ''} and y from ${fmt(spec.y.min)} to ${fmt(spec.y.max)}${spec.y.label ? ` (${spec.y.label})` : ''}`;
  const description = `A graph with ${axes}. It shows ${plotted.length ? plotted.join('; ') : 'nothing yet'}.`;

  const rows = [
    ...spec.functions.map((f) => [f.label || 'Function', f.family === 'step'
      ? f.pieces.map((q) => `y = ${fmt(q.y)} for x from ${fmt(q.from)} to ${fmt(q.to)}`).join('; ')
      : (f.label ? KIND_WORD[f.family].replace(/^the /, '') : equation(f))]),
    ...spec.points.map((p) => [p.label || 'Point', `(${fmt(p.x)}, ${fmt(p.y)})`]),
    ...spec.segments.map((s) => [s.label || 'Segment', `(${fmt(s.from[0])}, ${fmt(s.from[1])}) to (${fmt(s.to[0])}, ${fmt(s.to[1])})`]),
    ...spec.shade.map((s) => [s.label || 'Shaded', `x from ${fmt(s.from)} to ${fmt(s.to)}`]),
  ];
  return {
    width: W, height: H, defs, body, parts, description, worked,
    title: spec.title || 'Graph',
    table: { caption: 'What the graph shows', columns: ['Part', 'Value'], rows },
  };
}
