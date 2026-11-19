// Data charts: bar, line, pie, histogram, dot plot and box plot.
//
// Every chart comes with its data table, and series never differ by colour
// alone: lines differ by dash and marker, bars carry a legend and their values,
// pie slices carry their labels and percentages.

import { scaleLinear, scaleBand } from 'd3-scale';
import { arc as d3arc, pie as d3pie, line as d3line } from 'd3-shape';

import { fmt, px, text, partAttrs, wrap, INK, MUTED, GRID, AXIS, HIGHLIGHT, SERIES, DASHES } from './common.js';

const W = 520;
const H = 380;

const WORD = { bar: 'A bar chart', line: 'A line chart', pie: 'A pie chart', histogram: 'A histogram', dot: 'A dot plot', box: 'A box plot' };

/** A value axis down the left with grid lines, and its label. */
function valueAxis(y, m, label, ticks = y.ticks(6)) {
  let out = `<g stroke="${GRID}">`;
  for (const t of ticks) out += `<line x1="${px(m.l)}" y1="${px(y(t))}" x2="${px(W - m.r)}" y2="${px(y(t))}"/>`;
  out += '</g>';
  for (const t of ticks) out += text(m.l - 7, y(t), fmt(t), { size: 11, fill: MUTED, anchor: 'end' });
  out += `<line x1="${px(m.l)}" y1="${px(m.t)}" x2="${px(m.l)}" y2="${px(H - m.b)}" stroke="${AXIS}" stroke-width="1.4"/>`;
  out += `<line x1="${px(m.l)}" y1="${px(H - m.b)}" x2="${px(W - m.r)}" y2="${px(H - m.b)}" stroke="${AXIS}" stroke-width="1.4"/>`;
  if (label) out += `<g transform="translate(16 ${px((m.t + H - m.b) / 2)}) rotate(-90)">${text(0, 0, label, { size: 12 })}</g>`;
  return out;
}

function domainOf(values, axis, { zero = true } = {}) {
  let lo = Math.min(...values, zero ? 0 : Infinity);
  let hi = Math.max(...values, zero ? 0 : -Infinity);
  if (axis.min !== undefined) lo = axis.min;
  if (axis.max !== undefined) hi = axis.max;
  if (hi === lo) hi = lo + 1;
  return [lo, hi];
}

function legend(series, m, marker) {
  if (series.length < 2) return '';
  let out = '';
  let x = m.l;
  series.forEach((s, i) => {
    out += marker(x, m.t - 14, i) + text(x + 16, m.t - 14, s.name, { size: 11, anchor: 'start' });
    x += 34 + s.name.length * 6.5;
  });
  return out;
}

function barOrLine(spec, prefix, lit) {
  const m = { l: 56, r: 16, t: (spec.title ? 38 : 14) + (spec.series.length > 1 ? 18 : 0), b: spec.x.label ? 58 : 42 };
  const all = spec.series.flatMap((s) => s.values);
  const y = scaleLinear().domain(domainOf(all, spec.y, { zero: spec.chart === 'bar' })).range([H - m.b, m.t]).nice();
  const band = scaleBand().domain(spec.categories.map((_, i) => i)).range([m.l, W - m.r]).padding(spec.chart === 'bar' ? 0.22 : 0.5);
  let body = valueAxis(y, m, spec.y.label);
  const parts = [];
  const step = Math.ceil(spec.categories.length / 12);
  spec.categories.forEach((c, i) => {
    if (i % step === 0) body += text(band(i) + band.bandwidth() / 2, H - m.b + 14, wrap(c, band.step() * step, 11)[0], { size: 11, fill: MUTED });
  });
  if (spec.x.label) body += text((m.l + W - m.r) / 2, H - 16, spec.x.label, { size: 12 });
  if (spec.chart === 'bar') {
    const inner = scaleBand().domain(spec.series.map((_, i) => i)).range([0, band.bandwidth()]).padding(0.08);
    spec.series.forEach((s, si) => {
      s.values.forEach((v, ci) => {
        const id = `bar-${si + 1}-${ci + 1}`;
        const y0 = y(Math.max(0, y.domain()[0]));
        const top = Math.min(y(v), y0);
        const h = Math.abs(y(v) - y0);
        body += `<rect ${partAttrs(prefix, id)} x="${px(band(ci) + inner(si))}" y="${px(top)}" width="${px(inner.bandwidth())}" height="${px(h)}" fill="${lit(id) || lit(s.id) ? HIGHLIGHT : SERIES[si]}" stroke="${INK}" stroke-width="${lit(id) || lit(s.id) ? 2 : 0}"/>`;
        if (spec.categories.length * spec.series.length <= 16) body += text(band(ci) + inner(si) + inner.bandwidth() / 2, top - 8, fmt(v), { size: 10, fill: INK });
        parts.push({ part: id, label: `${s.name ? `${s.name}, ` : ''}${spec.categories[ci]}: ${fmt(v)}` });
      });
    });
    body += legend(spec.series, m, (x, yy, i) => `<rect x="${px(x)}" y="${px(yy - 5)}" width="10" height="10" fill="${SERIES[i]}"/>`);
  } else {
    spec.series.forEach((s, si) => {
      const colour = lit(s.id) ? HIGHLIGHT : SERIES[si];
      const gen = d3line().x((_, i) => band(i) + band.bandwidth() / 2).y((v) => y(v)).digits(2);
      body += `<g ${partAttrs(prefix, s.id)}><path d="${gen(s.values)}" fill="none" stroke="${colour}" stroke-width="${lit(s.id) ? 3.4 : 2.2}"${DASHES[si] ? ` stroke-dasharray="${DASHES[si]}"` : ''}/>`;
      s.values.forEach((v, ci) => {
        const id = `pt-${si + 1}-${ci + 1}`;
        const cx = band(ci) + band.bandwidth() / 2;
        // A different marker per series, so print in grey still tells them apart.
        body += si % 2 === 0
          ? `<circle ${partAttrs(prefix, id)} cx="${px(cx)}" cy="${px(y(v))}" r="4" fill="${lit(id) ? HIGHLIGHT : colour}"/>`
          : `<rect ${partAttrs(prefix, id)} x="${px(cx - 4)}" y="${px(y(v) - 4)}" width="8" height="8" fill="${lit(id) ? HIGHLIGHT : colour}"/>`;
        parts.push({ part: id, label: `${s.name ? `${s.name}, ` : ''}${spec.categories[ci]}: ${fmt(v)}` });
      });
      body += '</g>';
      parts.push({ part: s.id, label: s.name || 'the line' });
    });
    body += legend(spec.series, m, (x, yy, i) => `<line x1="${px(x)}" y1="${px(yy)}" x2="${px(x + 12)}" y2="${px(yy)}" stroke="${SERIES[i]}" stroke-width="2.4"${DASHES[i] ? ` stroke-dasharray="${DASHES[i]}"` : ''}/>`);
  }
  const columns = ['Category', ...spec.series.map((s, i) => s.name || (spec.series.length > 1 ? `Series ${i + 1}` : (spec.y.label || 'Value')))];
  const rows = spec.categories.map((c, i) => [c, ...spec.series.map((s) => fmt(s.values[i]))]);
  const highest = spec.series.map((s) => {
    const i = s.values.indexOf(Math.max(...s.values));
    return `${s.name ? `${s.name}: ` : ''}highest at ${spec.categories[i]} (${fmt(s.values[i])})`;
  });
  const description = `${WORD[spec.chart]} of ${spec.series.length === 1 ? (spec.series[0].name || spec.y.label || 'values') : spec.series.map((s) => s.name).join(', ')} across ${spec.categories.length} categories${spec.x.label ? ` of ${spec.x.label}` : ''}: ${spec.categories.join(', ')}. ${highest.join('; ')}. The values are in the table.`;
  return { body, parts, description, table: { caption: spec.title || 'The chart\'s data', columns, rows } };
}

function pieChart(spec, prefix, lit) {
  const total = spec.slices.reduce((t, s) => t + s.value, 0);
  const cx = W / 2;
  const cy = (spec.title ? 38 : 14) + 160;
  const r = 130;
  const arcs = d3pie().sort(null).value((d) => d.value)(spec.slices);
  const gen = d3arc().innerRadius(0).outerRadius(r).digits(2);
  const labelArc = d3arc().innerRadius(r + 18).outerRadius(r + 18);
  let body = '';
  const parts = [];
  arcs.forEach((a, i) => {
    const s = a.data;
    body += `<path ${partAttrs(prefix, s.id)} transform="translate(${px(cx)} ${px(cy)})" d="${gen(a)}" fill="${lit(s.id) ? HIGHLIGHT : SERIES[i]}" stroke="#FFFFFF" stroke-width="${lit(s.id) ? 3 : 1.5}"/>`;
    const [lx, ly] = labelArc.centroid(a);
    const share = `${fmt(Math.round((s.value / total) * 1000) / 10)}%`;
    if (s.value > 0) body += text(cx + lx, cy + ly, `${s.label} ${share}`, { size: 11, anchor: lx >= 0 ? 'start' : 'end' });
    parts.push({ part: s.id, label: `${s.label}: ${fmt(s.value)} (${share})` });
  });
  const rows = spec.slices.map((s) => [s.label, fmt(s.value), `${fmt(Math.round((s.value / total) * 1000) / 10)}%`]);
  const biggest = spec.slices.reduce((a, b) => (b.value > a.value ? b : a));
  return {
    body,
    parts,
    description: `A pie chart of ${spec.slices.length} parts making a total of ${fmt(total)}: ${rows.map((r) => `${r[0]} ${r[2]}`).join(', ')}. The largest is ${biggest.label}.`,
    table: { caption: spec.title || 'The chart\'s data', columns: ['Part', 'Value', 'Share'], rows },
  };
}

function histogram(spec, prefix, lit) {
  const m = { l: 56, r: 16, t: spec.title ? 38 : 14, b: spec.x.label ? 58 : 42 };
  const lo = spec.bins[0].from;
  const hi = spec.bins.at(-1).to;
  const x = scaleLinear().domain([lo, hi]).range([m.l, W - m.r]);
  const y = scaleLinear().domain(domainOf(spec.bins.map((b) => b.count), spec.y)).range([H - m.b, m.t]).nice();
  let body = valueAxis(y, m, spec.y.label || 'Frequency');
  const parts = [];
  const edges = [...new Set(spec.bins.flatMap((b) => [b.from, b.to]))];
  const every = Math.ceil(edges.length / 12);
  edges.forEach((e, i) => { if (i % every === 0) body += text(x(e), H - m.b + 14, fmt(e), { size: 11, fill: MUTED }); });
  for (const b of spec.bins) {
    body += `<rect ${partAttrs(prefix, b.id)} x="${px(x(b.from))}" y="${px(y(b.count))}" width="${px(x(b.to) - x(b.from))}" height="${px(y(0) - y(b.count))}" fill="${lit(b.id) ? HIGHLIGHT : SERIES[0]}" stroke="#FFFFFF" stroke-width="1"/>`;
    parts.push({ part: b.id, label: `${fmt(b.from)} to ${fmt(b.to)}: ${fmt(b.count)}` });
  }
  if (spec.x.label) body += text((m.l + W - m.r) / 2, H - 16, spec.x.label, { size: 12 });
  const total = spec.bins.reduce((t, b) => t + b.count, 0);
  const modal = spec.bins.reduce((a, b) => (b.count > a.count ? b : a));
  return {
    body,
    parts,
    description: `A histogram of ${fmt(total)} values${spec.x.label ? ` of ${spec.x.label}` : ''} in ${spec.bins.length} groups from ${fmt(lo)} to ${fmt(hi)}. The tallest group is ${fmt(modal.from)} to ${fmt(modal.to)}, with ${fmt(modal.count)}.`,
    table: { caption: spec.title || 'The histogram\'s groups', columns: ['From', 'To', 'Count'], rows: spec.bins.map((b) => [fmt(b.from), fmt(b.to), fmt(b.count)]) },
  };
}

function dotPlot(spec, prefix, lit) {
  const m = { l: 30, r: 30, t: spec.title ? 38 : 14, b: spec.x.label ? 58 : 42 };
  const counts = new Map();
  for (const v of spec.values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const values = [...counts.keys()].sort((a, b) => a - b);
  const [lo, hi] = domainOf(values, spec.x, { zero: false });
  const x = scaleLinear().domain([lo, hi]).range([m.l, W - m.r]).nice();
  const tallest = Math.max(...counts.values());
  const r = Math.max(3, Math.min(9, (H - m.t - m.b) / (tallest * 2.2)));
  let body = `<line x1="${px(m.l)}" y1="${px(H - m.b)}" x2="${px(W - m.r)}" y2="${px(H - m.b)}" stroke="${AXIS}" stroke-width="1.4"/>`;
  for (const t of x.ticks(10)) body += `<line x1="${px(x(t))}" y1="${px(H - m.b)}" x2="${px(x(t))}" y2="${px(H - m.b + 4)}" stroke="${AXIS}"/>${text(x(t), H - m.b + 16, fmt(t), { size: 11, fill: MUTED })}`;
  const parts = [];
  values.forEach((v, vi) => {
    const id = `dots-${vi + 1}`;
    let g = '';
    for (let k = 0; k < counts.get(v); k += 1) g += `<circle cx="${px(x(v))}" cy="${px(H - m.b - r - 2 - k * r * 2.1)}" r="${px(r)}" fill="${lit(id) ? HIGHLIGHT : SERIES[0]}"/>`;
    body += `<g ${partAttrs(prefix, id)}>${g}</g>`;
    parts.push({ part: id, label: `${fmt(v)}: ${counts.get(v)}` });
  });
  if (spec.x.label) body += text((m.l + W - m.r) / 2, H - 16, spec.x.label, { size: 12 });
  const mode = values.filter((v) => counts.get(v) === tallest);
  return {
    body,
    parts,
    description: `A dot plot of ${spec.values.length} values${spec.x.label ? ` of ${spec.x.label}` : ''}, from ${fmt(values[0])} to ${fmt(values.at(-1))}. The most common ${mode.length === 1 ? `value is ${fmt(mode[0])}` : `values are ${mode.map(fmt).join(', ')}`}, with ${tallest} dot${tallest === 1 ? '' : 's'}.`,
    table: { caption: spec.title || 'The dot plot\'s values', columns: ['Value', 'How many'], rows: values.map((v) => [fmt(v), String(counts.get(v))]) },
  };
}

function boxPlot(spec, prefix, lit) {
  const m = { l: 56, r: 16, t: spec.title ? 38 : 14, b: spec.x.label ? 58 : 42 };
  const all = spec.boxes.flatMap((b) => [b.min, b.max]);
  const y = scaleLinear().domain(domainOf(all, spec.y, { zero: false })).range([H - m.b, m.t]).nice();
  const band = scaleBand().domain(spec.boxes.map((_, i) => i)).range([m.l, W - m.r]).padding(0.4);
  let body = valueAxis(y, m, spec.y.label);
  const parts = [];
  spec.boxes.forEach((b, i) => {
    const x0 = band(i);
    const w = band.bandwidth();
    const c = x0 + w / 2;
    const colour = lit(b.id) ? HIGHLIGHT : SERIES[0];
    body += `<g ${partAttrs(prefix, b.id)} stroke="${INK}" stroke-width="1.6">`
      + `<line x1="${px(c)}" y1="${px(y(b.min))}" x2="${px(c)}" y2="${px(y(b.q1))}"/><line x1="${px(c)}" y1="${px(y(b.q3))}" x2="${px(c)}" y2="${px(y(b.max))}"/>`
      + `<line x1="${px(c - w / 4)}" y1="${px(y(b.min))}" x2="${px(c + w / 4)}" y2="${px(y(b.min))}"/><line x1="${px(c - w / 4)}" y1="${px(y(b.max))}" x2="${px(c + w / 4)}" y2="${px(y(b.max))}"/>`
      + `<rect x="${px(x0)}" y="${px(y(b.q3))}" width="${px(w)}" height="${px(y(b.q1) - y(b.q3))}" fill="${colour}" fill-opacity="0.25"/>`
      + `<line x1="${px(x0)}" y1="${px(y(b.median))}" x2="${px(x0 + w)}" y2="${px(y(b.median))}" stroke-width="3"/></g>`;
    if (b.label) body += text(c, H - m.b + 14, b.label, { size: 11, fill: MUTED });
    parts.push({ part: b.id, label: `${b.label || `Box ${i + 1}`}: median ${fmt(b.median)}` });
  });
  if (spec.x.label) body += text((m.l + W - m.r) / 2, H - 16, spec.x.label, { size: 12 });
  const rows = spec.boxes.map((b, i) => [b.label || `Box ${i + 1}`, fmt(b.min), fmt(b.q1), fmt(b.median), fmt(b.q3), fmt(b.max)]);
  return {
    body,
    parts,
    description: `A box plot of ${spec.boxes.length} group${spec.boxes.length === 1 ? '' : 's'}${spec.y.label ? ` of ${spec.y.label}` : ''}. ${rows.map((r) => `${r[0]}: lowest ${r[1]}, lower quartile ${r[2]}, median ${r[3]}, upper quartile ${r[4]}, highest ${r[5]}`).join('. ')}.`,
    table: { caption: spec.title || 'The box plot\'s five-number summaries', columns: ['Group', 'Lowest', 'Lower quartile', 'Median', 'Upper quartile', 'Highest'], rows },
  };
}

const BUILD = { bar: barOrLine, line: barOrLine, pie: pieChart, histogram, dot: dotPlot, box: boxPlot };

export function renderChart(spec, { prefix, hl }) {
  const lit = (id) => hl.has(String(id).toLowerCase());
  const out = BUILD[spec.chart](spec, prefix, lit);
  const title = spec.title ? text(W / 2, 20, spec.title, { size: 15, weight: '600' }) : '';
  return { ...out, width: W, height: H, body: title + out.body, defs: '', title: spec.title || WORD[spec.chart].replace(/^An? /, '').replace(/^./, (c) => c.toUpperCase()) };
}
