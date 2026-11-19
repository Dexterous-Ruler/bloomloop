// A number line with ticks, points, intervals and rays. An open end is a hollow
// circle and a closed end a filled one, as in every Indian school textbook.

import { scaleLinear } from 'd3-scale';

import { fmt, px, text, partAttrs, arrowMarker, INK, MUTED, AXIS, ACCENT, HIGHLIGHT, SERIES } from './common.js';

const W = 560;

/** Where the line sits in its picture, for the number-line interaction (questionTypes.js). */
export function numberlineFrame(spec) {
  const lanes = spec.intervals.length + spec.rays.length;
  const top = (spec.title ? 40 : 16) + lanes * 22;
  return { W, top, H: top + 70, axisY: top + 18, left: 36, right: W - 36 };
}

export function renderNumberline(spec, { prefix, hl }) {
  const lit = (id) => hl.has(String(id).toLowerCase());
  const { top, H, axisY } = numberlineFrame(spec);
  const x = scaleLinear().domain([spec.min, spec.max]).range([36, W - 36]);
  let body = spec.title ? text(W / 2, 20, spec.title, { size: 15, weight: '600' }) : '';
  body += `<line x1="16" y1="${px(axisY)}" x2="${W - 16}" y2="${px(axisY)}" stroke="${AXIS}" stroke-width="1.6" marker-start="url(#${prefix}-arrow)" marker-end="url(#${prefix}-arrow)"/>`;
  const n = Math.round((spec.max - spec.min) / spec.step);
  for (let i = 0; i <= n; i += 1) {
    const v = spec.min + i * spec.step;
    body += `<line x1="${px(x(v))}" y1="${px(axisY - 6)}" x2="${px(x(v))}" y2="${px(axisY + 6)}" stroke="${AXIS}" stroke-width="1.2"/>`;
    if (i % spec.labelEvery === 0) body += text(x(v), axisY + 20, fmt(v), { size: 12, fill: MUTED });
  }
  const parts = [];
  const said = [];
  const end = (v, y, open, colour) => `<circle cx="${px(x(v))}" cy="${px(y)}" r="5" fill="${open ? '#FFFFFF' : colour}" stroke="${colour}" stroke-width="2"/>`;
  let lane = 0;
  spec.intervals.forEach((iv, i) => {
    const y = top - lane * 22 - 4;
    lane += 1;
    const colour = lit(iv.id) ? HIGHLIGHT : SERIES[i % SERIES.length];
    body += `<g ${partAttrs(prefix, iv.id)}><line x1="${px(x(iv.from))}" y1="${px(y)}" x2="${px(x(iv.to))}" y2="${px(y)}" stroke="${colour}" stroke-width="${lit(iv.id) ? 5 : 3.5}"/>`
      + `${end(iv.from, y, iv.fromOpen, colour)}${end(iv.to, y, iv.toOpen, colour)}</g>`;
    if (iv.label) body += text((x(iv.from) + x(iv.to)) / 2, y - 11, iv.label, { size: 11 });
    const words = `${fmt(iv.from)} ${iv.fromOpen ? '<' : '≤'} x ${iv.toOpen ? '<' : '≤'} ${fmt(iv.to)}`;
    parts.push({ part: iv.id, label: iv.label ? `${iv.label}: ${words}` : words });
    said.push(`the interval ${words}${iv.label ? ` (labelled ${iv.label})` : ''}`);
  });
  spec.rays.forEach((r, i) => {
    const y = top - lane * 22 - 4;
    lane += 1;
    const colour = lit(r.id) ? HIGHLIGHT : SERIES[(spec.intervals.length + i) % SERIES.length];
    const to = r.direction === 'right' ? W - 20 : 20;
    body += `<g ${partAttrs(prefix, r.id)}><line x1="${px(x(r.from))}" y1="${px(y)}" x2="${to}" y2="${px(y)}" stroke="${colour}" stroke-width="${lit(r.id) ? 5 : 3.5}" marker-end="url(#${prefix}-ray)"/>`
      + `${end(r.from, y, r.open, colour)}</g>`;
    if (r.label) body += text(x(r.from) + (r.direction === 'right' ? 40 : -40), y - 11, r.label, { size: 11 });
    const words = `x ${r.direction === 'right' ? (r.open ? '>' : '≥') : (r.open ? '<' : '≤')} ${fmt(r.from)}`;
    parts.push({ part: r.id, label: r.label ? `${r.label}: ${words}` : words });
    said.push(`the ray ${words}${r.label ? ` (labelled ${r.label})` : ''}`);
  });
  for (const p of spec.points) {
    const colour = lit(p.id) ? HIGHLIGHT : ACCENT;
    body += `<g ${partAttrs(prefix, p.id)}><circle cx="${px(x(p.value))}" cy="${px(axisY)}" r="${lit(p.id) ? 7 : 5.5}" fill="${p.open ? '#FFFFFF' : colour}" stroke="${colour}" stroke-width="2"/>`
      + (p.label ? text(x(p.value), axisY + 36, p.label, { size: 12, weight: '600', fill: INK }) : '')
      + '</g>';
    parts.push({ part: p.id, label: p.label ? `${p.label} at ${fmt(p.value)}` : fmt(p.value) });
    said.push(`${p.label ? `point ${p.label}` : 'a point'} at ${fmt(p.value)}${p.open ? ', hollow' : ''}`);
  }
  const description = `A number line from ${fmt(spec.min)} to ${fmt(spec.max)} with ticks every ${fmt(spec.step)}.${said.length ? ` It marks ${said.join('; ')}.` : ''}`;
  const rows = [
    ...spec.points.map((p) => ['Point', p.label || '', fmt(p.value)]),
    ...spec.intervals.map((iv) => ['Interval', iv.label || '', `${fmt(iv.from)} to ${fmt(iv.to)} (${iv.fromOpen ? 'open' : 'closed'} at ${fmt(iv.from)}, ${iv.toOpen ? 'open' : 'closed'} at ${fmt(iv.to)})`]),
    ...spec.rays.map((r) => ['Ray', r.label || '', `from ${fmt(r.from)} to the ${r.direction} (${r.open ? 'open' : 'closed'} at ${fmt(r.from)})`]),
  ];
  return {
    width: W,
    height: H + (spec.points.some((p) => p.label) ? 14 : 0),
    title: spec.title || 'Number line',
    defs: arrowMarker(prefix, 'arrow', AXIS) + arrowMarker(prefix, 'ray', INK),
    body,
    parts,
    description,
    table: { caption: 'What the number line marks', columns: ['Part', 'Label', 'Where'], rows },
  };
}
