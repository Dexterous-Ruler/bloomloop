// Three figures that are sequences: a timeline, a pattern of shapes with a
// blank to continue, and a stack of frames (a call stack) that steps can push
// and pop.

import { fmt, px, text, lines, partAttrs, wrap, textWidth, INK, MUTED, AXIS, ACCENT, HIGHLIGHT, SERIES } from './common.js';
import { readDate } from './spec.js';

/* -------------------------------------------------------------- timeline -- */

/**
 * Labels are laid out in lanes above and below the line, each label taking the
 * first lane where it clears the one before it, so close years never print on
 * top of each other (the prototype's flaw). Only past eight lanes would a label
 * overlap, and thirty events is the cap.
 */
export function renderTimeline(spec, { prefix, hl }) {
  const lit = (id) => hl.has(String(id).toLowerCase());
  const W = 640;
  const events = spec.events.map((e) => ({ ...e, d: readDate(e.date, 'a date') }));
  const lo = events[0].d.value;
  const hi = events.at(-1).d.value;
  const span = hi - lo || 1;
  const x = (v) => 40 + ((v - lo) / span) * (W - 80);
  const LANES = 4;
  const laneH = 46;
  const ends = { above: Array(LANES).fill(-Infinity), below: Array(LANES).fill(-Infinity) };
  const placed = events.map((e, i) => {
    const textLines = wrap(e.label, 120, 11).slice(0, 2);
    const w = Math.max(textWidth(e.d.text, 11), ...textLines.map((l) => textWidth(l, 11))) + 8;
    const cx = Math.min(Math.max(x(e.d.value), w / 2 + 4), W - w / 2 - 4);
    const order = i % 2 === 0 ? ['above', 'below'] : ['below', 'above'];
    let spot = null;
    for (let lane = 0; lane < LANES && !spot; lane += 1) {
      for (const side of order) {
        if (!spot && ends[side][lane] + 6 < cx - w / 2) spot = { side, lane };
      }
    }
    // Every lane is full here: take the one that frees soonest.
    if (!spot) {
      let best = { side: 'above', lane: 0, end: Infinity };
      for (const side of ['above', 'below']) ends[side].forEach((end, lane) => { if (end < best.end) best = { side, lane, end }; });
      spot = best;
    }
    ends[spot.side][spot.lane] = cx + w / 2;
    return { ...e, cx, w, textLines, ...spot };
  });
  const usedAbove = Math.max(0, ...placed.filter((p) => p.side === 'above').map((p) => p.lane + 1));
  const usedBelow = Math.max(0, ...placed.filter((p) => p.side === 'below').map((p) => p.lane + 1));
  const top = (spec.title ? 36 : 10) + usedAbove * laneH + 10;
  const axisY = top;
  const H = axisY + usedBelow * laneH + 24;
  let body = spec.title ? text(W / 2, 20, spec.title, { size: 15, weight: '600' }) : '';
  body += `<line x1="24" y1="${px(axisY)}" x2="${W - 24}" y2="${px(axisY)}" stroke="${AXIS}" stroke-width="2"/>`;
  const parts = [];
  for (const p of placed) {
    const colour = lit(p.id) ? HIGHLIGHT : ACCENT;
    const blockY = p.side === 'above' ? axisY - 14 - p.lane * laneH - 26 : axisY + 14 + p.lane * laneH + 4;
    const leaderEnd = p.side === 'above' ? blockY + 26 : blockY - 2;
    body += `<g ${partAttrs(prefix, p.id)}>`
      + `<line x1="${px(x(p.d.value))}" y1="${px(axisY)}" x2="${px(p.cx)}" y2="${px(leaderEnd)}" stroke="${MUTED}" stroke-width="1"/>`
      + `<circle cx="${px(x(p.d.value))}" cy="${px(axisY)}" r="${lit(p.id) ? 6 : 4.5}" fill="${colour}"/>`
      + text(p.cx, blockY + 4, p.d.text, { size: 11, weight: '700', fill: colour })
      + lines(p.cx, blockY + 17 + (p.textLines.length - 1) * 7, p.textLines, { size: 11 })
      + '</g>';
    parts.push({ part: p.id, label: `${p.d.text}: ${p.label}` });
  }
  return {
    width: W,
    height: H,
    title: spec.title || 'Timeline',
    defs: '',
    body,
    parts,
    description: `A timeline from ${events[0].d.text} to ${events.at(-1).d.text} with ${events.length} events, in order: ${events.map((e) => `${e.d.text}, ${e.label}`).join('; ')}.`,
    table: { caption: 'The events in order', columns: ['Date', 'Event'], rows: events.map((e) => [e.d.text, e.label]) },
  };
}

/* --------------------------------------------------------------- pattern -- */

const COLOUR = { green: SERIES[0], gold: SERIES[1], blue: SERIES[2], grey: SERIES[5] };
const SIZE = { small: 11, medium: 17, large: 24 };

function poly(cx, cy, r, n, start = -Math.PI / 2) {
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i * 2 * Math.PI) / n;
    return `${px(cx + r * Math.cos(a))},${px(cy + r * Math.sin(a))}`;
  }).join(' ');
}

function shapeSvg(shape, cx, cy, r, paint) {
  switch (shape) {
    case 'circle': return `<circle cx="${px(cx)}" cy="${px(cy)}" r="${px(r)}" ${paint}/>`;
    case 'square': return `<rect x="${px(cx - r * 0.85)}" y="${px(cy - r * 0.85)}" width="${px(r * 1.7)}" height="${px(r * 1.7)}" ${paint}/>`;
    case 'triangle': return `<polygon points="${poly(cx, cy + r * 0.15, r * 1.05, 3)}" ${paint}/>`;
    case 'diamond': return `<polygon points="${poly(cx, cy, r, 4)}" ${paint}/>`;
    case 'pentagon': return `<polygon points="${poly(cx, cy, r, 5)}" ${paint}/>`;
    case 'hexagon': return `<polygon points="${poly(cx, cy, r, 6, 0)}" ${paint}/>`;
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r : r * 0.45;
        return `${px(cx + rr * Math.cos(a))},${px(cy + rr * Math.sin(a))}`;
      }).join(' ');
      return `<polygon points="${pts}" ${paint}/>`;
    }
    case 'cross': {
      const t = r * 0.32;
      return `<polygon points="${[[-t, -r], [t, -r], [t, -t], [r, -t], [r, t], [t, t], [t, r], [-t, r], [-t, t], [-r, t], [-r, -t], [-t, -t]].map(([a, b]) => `${px(cx + a)},${px(cy + b)}`).join(' ')}" ${paint}/>`;
    }
    case 'arrow': return `<polygon points="${[[-r, -r * 0.3], [r * 0.2, -r * 0.3], [r * 0.2, -r * 0.7], [r, 0], [r * 0.2, r * 0.7], [r * 0.2, r * 0.3], [-r, r * 0.3]].map(([a, b]) => `${px(cx + a)},${px(cy + b)}`).join(' ')}" ${paint}/>`;
    case 'semicircle': return `<path d="M${px(cx - r)},${px(cy + r * 0.4)} A${px(r)},${px(r)} 0 0 1 ${px(cx + r)},${px(cy + r * 0.4)} Z" ${paint}/>`;
    default: return '';
  }
}

const ITEM_WORD = (it) => `${it.count > 1 ? `${it.count} ` : 'a '}${it.size} ${it.colour} ${it.fill} ${it.shape}${it.count > 1 ? 's' : ''}${it.rotate ? ` turned ${it.rotate} degrees` : ''}`;

export function renderPattern(spec, { prefix, hl }) {
  const lit = (id) => hl.has(String(id).toLowerCase());
  const cell = 76;
  const perRow = Math.min(spec.items.length, 6);
  const rows = Math.ceil(spec.items.length / perRow);
  const top = spec.title ? 34 : 8;
  const W = perRow * cell + 16;
  const H = top + rows * (cell + 18) + 4;
  let body = spec.title ? text(W / 2, 20, spec.title, { size: 15, weight: '600' }) : '';
  const parts = [];
  spec.items.forEach((it, i) => {
    const id = `item-${i + 1}`;
    const x0 = 8 + (i % perRow) * cell;
    const y0 = top + Math.floor(i / perRow) * (cell + 18);
    const cx = x0 + cell / 2;
    const cy = y0 + cell / 2;
    let g = `<rect x="${px(x0 + 4)}" y="${px(y0 + 4)}" width="${cell - 8}" height="${cell - 8}" rx="10" fill="#FFFFFF" stroke="${lit(id) ? HIGHLIGHT : '#D5D8D2'}" stroke-width="${lit(id) ? 3 : 1.2}"${it.blank ? ' stroke-dasharray="6 4"' : ''}/>`;
    if (it.blank) {
      g += text(cx, cy, '?', { size: 28, weight: '700', fill: MUTED });
    } else {
      const colour = COLOUR[it.colour];
      const paint = it.fill === 'solid' ? `fill="${colour}" stroke="${colour}" stroke-width="1.5"` : `fill="#FFFFFF" stroke="${colour}" stroke-width="2.4"`;
      const n = it.count;
      const across = Math.ceil(Math.sqrt(n));
      const down = Math.ceil(n / across);
      const r = n === 1 ? SIZE[it.size] : Math.min(SIZE[it.size], (cell - 18) / (2.3 * Math.max(across, down)));
      const gap = r * 2.3;
      for (let k = 0; k < n; k += 1) {
        const sx = cx + ((k % across) - (across - 1) / 2) * gap;
        const sy = cy + (Math.floor(k / across) - (down - 1) / 2) * gap;
        let s = shapeSvg(it.shape, sx, sy, r, paint);
        if (it.fill === 'dotted') s += `<circle cx="${px(sx)}" cy="${px(sy)}" r="${px(Math.max(2, r * 0.18))}" fill="${colour}"/>`;
        g += it.rotate ? `<g transform="rotate(${it.rotate} ${px(sx)} ${px(sy)})">${s}</g>` : s;
      }
    }
    body += `<g ${partAttrs(prefix, id)}>${g}</g>${text(cx, y0 + cell + 8, String(i + 1), { size: 10, fill: MUTED })}`;
    parts.push({ part: id, label: it.blank ? `item ${i + 1}: the blank` : `item ${i + 1}: ${ITEM_WORD(it)}` });
  });
  const blanks = spec.items.map((it, i) => (it.blank ? i + 1 : null)).filter(Boolean);
  return {
    width: W,
    height: H,
    title: spec.title || 'Pattern',
    defs: '',
    body,
    parts,
    description: `A pattern of ${spec.items.length} items in a row: ${spec.items.map((it, i) => `${i + 1}, ${it.blank ? 'blank, to work out' : ITEM_WORD(it)}`).join('; ')}.${blanks.length ? ` The blank${blanks.length > 1 ? 's are' : ' is'} at position${blanks.length > 1 ? 's' : ''} ${blanks.join(', ')}.` : ''}`,
    table: { caption: 'The pattern, item by item', columns: ['Position', 'Item'], rows: spec.items.map((it, i) => [String(i + 1), it.blank ? 'Blank' : ITEM_WORD(it)]) },
  };
}

/* ----------------------------------------------------------------- stack -- */

/**
 * A stack of frames, bottom to top, the top one in the accent colour. `frames`
 * is the stack shown; a step passes its own. The height is set by the tallest
 * stack in any step, so stepping through never makes the picture jump.
 */
export function renderStack(spec, { prefix, hl, frames = spec.frames, caption = '' }) {
  const lit = (id) => hl.has(String(id).toLowerCase());
  const most = Math.max(spec.frames.length, ...(spec.steps ?? []).map((s) => s.frames.length), 1);
  const W = 340;
  const fh = 46;
  const top = spec.title ? 36 : 12;
  const H = top + most * (fh + 6) + 30 + (caption ? 28 : 0);
  const base = top + most * (fh + 6);
  let body = spec.title ? text(W / 2, 20, spec.title, { size: 15, weight: '600' }) : '';
  body += `<polyline points="40,${px(top)} 40,${px(base + 4)} ${W - 40},${px(base + 4)} ${W - 40},${px(top)}" fill="none" stroke="${AXIS}" stroke-width="2"/>`;
  const parts = [];
  frames.forEach((f, i) => {
    const y = base - (i + 1) * (fh + 6) + 2;
    const isTop = i === frames.length - 1;
    const on = lit(f.id) || (isTop && !hl.size);
    body += `<g ${partAttrs(prefix, f.id)}><rect x="48" y="${px(y)}" width="${W - 96}" height="${fh}" rx="8" fill="${on ? ACCENT : '#FFFFFF'}" fill-opacity="${on ? 0.9 : 1}" stroke="${on ? ACCENT : INK}" stroke-width="1.6"/>`
      + text(W / 2, y + (f.note ? 17 : fh / 2), f.label, { size: 14, weight: '700', fill: on ? '#FFFFFF' : INK })
      + (f.note ? text(W / 2, y + 34, f.note, { size: 11, fill: on ? '#FFFFFF' : MUTED }) : '')
      + '</g>';
    parts.push({ part: f.id, label: f.note ? `${f.label}: ${f.note}` : f.label });
  });
  if (!frames.length) body += text(W / 2, base - fh / 2, 'Empty', { size: 13, fill: MUTED });
  body += text(W / 2, base + 20, 'Bottom of the stack', { size: 10, fill: MUTED });
  if (caption) body += text(W / 2, base + 44, caption.length > 60 ? `${caption.slice(0, 57)}...` : caption, { size: 12, fill: INK });
  const order = frames.map((f) => (f.note ? `${f.label} (${f.note})` : f.label));
  return {
    width: W,
    height: H,
    title: spec.title || 'Stack',
    defs: '',
    body,
    parts,
    description: frames.length
      ? `A stack of ${frames.length} frame${frames.length === 1 ? '' : 's'}, bottom to top: ${order.join(', ')}. The top frame is ${frames.at(-1).label}.${caption ? ` ${caption}` : ''}`
      : `An empty stack.${caption ? ` ${caption}` : ''}`,
    table: { caption: 'The stack, bottom to top', columns: ['Position', 'Frame', 'Note'], rows: frames.map((f, i) => [String(i + 1), f.label, f.note || '']) },
  };
}

export { fmt };
