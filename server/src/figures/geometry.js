// Geometry and vectors: points, segments, rays, shapes, circles, angles, arrows
// (free-body diagrams) and simple ray diagrams for a lens or a mirror.
//
// The ray diagram is worked out here from the lens or mirror formula, not drawn
// from anyone's numbers for the image: the professor gives the element, its
// focal length and where the object stands, and the image follows. So a
// diagram can never show an image where optics would not put it.

import { fmt, px, text, partAttrs, arrowMarker, esc, INK, MUTED, GRID, AXIS, ACCENT, HIGHLIGHT, SERIES } from './common.js';

const MAX_W = 520;
const MAX_H = 400;
const PAD = 28;
/** The most grid lines drawn across (or up) a frame. */
const GRID_LINES = 60;

/**
 * The gap between grid lines: one unit, or a rounder step (2, 5, 10, 20, ...)
 * when the frame is wider than GRID_LINES units. A frame in real-world units (a
 * field 500 m across) then gets a readable grid in a picture of bounded size,
 * rather than one line per metre drawn on the server and sent to every phone.
 */
export function gridStep(span) {
  let step = 1;
  for (let i = 0; span / step > GRID_LINES; i += 1) step *= i % 3 === 1 ? 2.5 : 2;
  return step;
}

/** Where the image forms, by the lens or mirror formula (Cartesian signs, light from the left, element at x = 0). */
export function opticsImage(o) {
  const u = -o.objectDistance;
  const h = o.objectHeight;
  if (o.element === 'plane-mirror') return { v: o.objectDistance, hi: h, real: false, infinite: false };
  const lens = o.element.endsWith('lens');
  // A converging element has its focus where the light goes; a diverging one behind.
  const f = o.element === 'convex-lens' ? o.focal : o.element === 'concave-lens' ? -o.focal : o.element === 'concave-mirror' ? -o.focal : o.focal;
  const inv = lens ? 1 / f + 1 / u : 1 / f - 1 / u;
  if (Math.abs(inv) < 1e-9) return { v: Infinity, hi: Infinity, real: true, infinite: true, f };
  const v = 1 / inv;
  const mag = lens ? v / u : -v / u;
  return { v, hi: mag * h, real: lens ? v > 0 : v < 0, infinite: false, f };
}

/** What the ray diagram is drawn from: the professor's own numbers, nothing worked out. */
function opticsGiven(o, imageShown) {
  const name = o.element.replace('-', ' ');
  const focal = o.element === 'plane-mirror' ? '' : ` of focal length ${fmt(o.focal)}`;
  return `A ray diagram for a ${name}${focal}. The object stands ${fmt(o.objectDistance)} from it and is ${fmt(Math.abs(o.objectHeight))} tall. `
    + `Two rays from the top of the object are drawn${imageShown ? ', and the image is marked' : ''}.`;
}

/** Where the image forms and what it is like: worked out by the lens or mirror formula, so the professor's only. */
function opticsWords(o, img) {
  const name = o.element.replace('-', ' ');
  const focal = o.element === 'plane-mirror' ? '' : ` of focal length ${fmt(o.focal)}`;
  if (img.infinite) return `A ray diagram for a ${name}${focal}. The object stands ${fmt(o.objectDistance)} from it, at the focus, ${fmt(Math.abs(o.objectHeight))} tall. The rays leave parallel, so the image forms at infinity.`;
  const side = o.element.endsWith('lens') ? (img.v > 0 ? 'on the other side' : 'on the same side as the object') : (img.v < 0 ? 'in front of the mirror' : 'behind the mirror');
  const upright = Math.sign(img.hi) === Math.sign(o.objectHeight);
  const size = Math.abs(img.hi) > Math.abs(o.objectHeight) + 1e-9 ? 'larger' : Math.abs(img.hi) < Math.abs(o.objectHeight) - 1e-9 ? 'smaller' : 'the same size';
  return `A ray diagram for a ${name}${focal}. The object stands ${fmt(o.objectDistance)} from it and is ${fmt(Math.abs(o.objectHeight))} tall. `
    + `The image is ${img.real ? 'real' : 'virtual'}, ${upright ? 'upright' : 'inverted'} and ${size}, ${fmt(Math.abs(img.v))} away ${side}, ${fmt(Math.abs(img.hi))} tall.`;
}

export function renderGeometry(spec, { prefix, hl }) {
  const lit = (id) => hl.has(String(id).toLowerCase());
  const pts = new Map(spec.points.map((p) => [p.id, p]));
  const at = (r) => (typeof r === 'string' ? [pts.get(r).x, pts.get(r).y] : r);
  const img = spec.optics ? opticsImage(spec.optics) : null;

  // The frame: as given, or one that fits the ray diagram.
  let view = spec.view;
  if (!view) {
    const o = spec.optics;
    const reach = Math.max(o.objectDistance, o.focal ?? 0, img.infinite ? 0 : Math.min(Math.abs(img.v), 4 * Math.max(o.objectDistance, o.focal ?? 0))) * 1.25;
    const tall = Math.max(Math.abs(o.objectHeight), img.infinite ? 0 : Math.min(Math.abs(img.hi), 4 * Math.abs(o.objectHeight))) * 1.6;
    // Never flatter than about 5:2, or the rays meet the axis at angles too shallow to follow.
    const half = Math.max(tall, reach * 0.4);
    view = { xMin: -reach, xMax: reach, yMin: -half, yMax: half };
  }
  const titleH = spec.title ? 30 : 0;
  const unit = Math.min((MAX_W - 2 * PAD) / (view.xMax - view.xMin), (MAX_H - 2 * PAD - titleH) / (view.yMax - view.yMin));
  const W = (view.xMax - view.xMin) * unit + 2 * PAD;
  const H = (view.yMax - view.yMin) * unit + 2 * PAD + titleH;
  const sx = (x) => PAD + (x - view.xMin) * unit;
  const sy = (y) => titleH + PAD + (view.yMax - y) * unit;
  const S = (p) => [sx(p[0]), sy(p[1])];
  const clip = `${prefix}-clip`;
  const far = (view.xMax - view.xMin + view.yMax - view.yMin) * 2;
  const parts = [];
  const said = [];
  // Sentences about what the engine worked out (a length, an angle, the image):
  // for the professor (figures/index.js), never in a student's description.
  const worked = [];
  /** A corner or an end as a reader names it: the point's label (or name), or its coordinates. */
  const named = (r) => (typeof r === 'string' ? (pts.get(r).label || r) : `(${fmt(r[0])}, ${fmt(r[1])})`);
  let body = spec.title ? text(W / 2, 20, spec.title, { size: 15, weight: '600' }) : '';

  if (spec.grid) {
    const gx = gridStep(view.xMax - view.xMin);
    const gy = gridStep(view.yMax - view.yMin);
    body += `<g stroke="${GRID}">`;
    for (let k = Math.ceil(view.xMin / gx); k * gx <= view.xMax; k += 1) body += `<line x1="${px(sx(k * gx))}" y1="${px(sy(view.yMin))}" x2="${px(sx(k * gx))}" y2="${px(sy(view.yMax))}"/>`;
    for (let k = Math.ceil(view.yMin / gy); k * gy <= view.yMax; k += 1) body += `<line x1="${px(sx(view.xMin))}" y1="${px(sy(k * gy))}" x2="${px(sx(view.xMax))}" y2="${px(sy(k * gy))}"/>`;
    body += '</g>';
  }
  if (spec.axes) {
    if (view.yMin <= 0 && view.yMax >= 0) body += `<line x1="${px(sx(view.xMin))}" y1="${px(sy(0))}" x2="${px(sx(view.xMax))}" y2="${px(sy(0))}" stroke="${AXIS}" stroke-width="1.3"/>`;
    if (view.xMin <= 0 && view.xMax >= 0) body += `<line x1="${px(sx(0))}" y1="${px(sy(view.yMin))}" x2="${px(sx(0))}" y2="${px(sy(view.yMax))}" stroke="${AXIS}" stroke-width="1.3"/>`;
  }

  spec.polygons.forEach((g, i) => {
    const corners = g.points.map(at);
    const colour = lit(g.id) ? HIGHLIGHT : SERIES[i % SERIES.length];
    body += `<polygon ${partAttrs(prefix, g.id)} points="${corners.map((c) => S(c).map(px).join(',')).join(' ')}" fill="${colour}" fill-opacity="${g.shaded || lit(g.id) ? 0.22 : 0.06}" stroke="${lit(g.id) ? HIGHLIGHT : INK}" stroke-width="${lit(g.id) ? 3 : 1.8}" stroke-linejoin="round" clip-path="url(#${clip})"/>`;
    if (g.label) {
      const c = corners.reduce((a, b) => [a[0] + b[0] / corners.length, a[1] + b[1] / corners.length], [0, 0]);
      body += text(sx(c[0]), sy(c[1]), g.label, { size: 12, weight: '600' });
    }
    const names = g.points.map((r) => (typeof r === 'string' ? (pts.get(r).label || r) : `(${fmt(r[0])}, ${fmt(r[1])})`));
    parts.push({ part: g.id, label: g.label || `shape ${names.join('')}`, drawn: g.label });
    said.push(`${g.label ? `the shape ${g.label}` : 'a shape'} with corners ${names.join(', ')}`);
  });

  for (const c of spec.circles) {
    const [cx, cy] = S(at(c.centre));
    body += `<circle ${partAttrs(prefix, c.id)} cx="${px(cx)}" cy="${px(cy)}" r="${px(c.radius * unit)}" fill="none" stroke="${lit(c.id) ? HIGHLIGHT : INK}" stroke-width="${lit(c.id) ? 3 : 1.8}" clip-path="url(#${clip})"/>`;
    if (c.label) body += text(cx + c.radius * unit * 0.72 + 6, cy - c.radius * unit * 0.72 - 6, c.label, { size: 12, anchor: 'start' });
    const centre = typeof c.centre === 'string' ? (pts.get(c.centre).label || c.centre) : `(${fmt(c.centre[0])}, ${fmt(c.centre[1])})`;
    parts.push({ part: c.id, label: c.label || `circle centre ${centre}`, drawn: c.label });
    said.push(`${c.label ? `the circle ${c.label}` : 'a circle'} with centre ${centre} and radius ${fmt(c.radius)}`);
  }

  for (const s of spec.segments) {
    const a = S(at(s.from));
    const b = S(at(s.to));
    let marks = '';
    if (s.marks) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      for (let k = 0; k < s.marks; k += 1) {
        const off = (k - (s.marks - 1) / 2) * 5;
        const mx = (a[0] + b[0]) / 2 + ux * off;
        const my = (a[1] + b[1]) / 2 + uy * off;
        marks += `<line x1="${px(mx - uy * 6)}" y1="${px(my + ux * 6)}" x2="${px(mx + uy * 6)}" y2="${px(my - ux * 6)}" stroke="${INK}" stroke-width="1.5"/>`;
      }
    }
    body += `<g ${partAttrs(prefix, s.id)}><line x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="${lit(s.id) ? HIGHLIGHT : INK}" stroke-width="${lit(s.id) ? 3.2 : 2}"${s.dashed ? ' stroke-dasharray="6 4"' : ''} clip-path="url(#${clip})"/>${marks}</g>`;
    if (s.label) body += text((a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2 - 8, s.label, { size: 12, anchor: 'start' });
    const [p, q] = [at(s.from), at(s.to)];
    parts.push({ part: s.id, label: s.label || 'segment', drawn: s.label });
    said.push(`${s.label ? `the segment ${s.label}` : 'a segment'} from ${named(s.from)} to ${named(s.to)}`);
    worked.push(`${s.label ? `The segment ${s.label}` : `The segment from ${named(s.from)} to ${named(s.to)}`} is ${fmt(Math.hypot(q[0] - p[0], q[1] - p[1]))} long.`);
  }

  for (const r of spec.rays) {
    const [p, q] = [at(r.from), at(r.through)];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const end = [p[0] + ((q[0] - p[0]) / len) * far, p[1] + ((q[1] - p[1]) / len) * far];
    const [a, b] = [S(p), S(end)];
    body += `<line ${partAttrs(prefix, r.id)} x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="${lit(r.id) ? HIGHLIGHT : INK}" stroke-width="${lit(r.id) ? 3.2 : 2}" clip-path="url(#${clip})"/>`;
    if (r.label) body += text(S(q)[0] + 8, S(q)[1] - 8, r.label, { size: 12, anchor: 'start' });
    parts.push({ part: r.id, label: r.label || 'ray', drawn: r.label });
    said.push(`${r.label ? `the ray ${r.label}` : 'a ray'} from (${fmt(p[0])}, ${fmt(p[1])}) through (${fmt(q[0])}, ${fmt(q[1])})`);
  }

  for (const a of spec.angles) {
    const [v, p, q] = [S(at(a.at)), S(at(a.from)), S(at(a.to))];
    const s1 = Math.atan2(p[1] - v[1], p[0] - v[0]);
    const s2 = Math.atan2(q[1] - v[1], q[0] - v[0]);
    let delta = s2 - s1;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const degrees = Math.abs(delta) * (180 / Math.PI);
    const r = 20;
    const colour = lit(a.id) ? HIGHLIGHT : ACCENT;
    let mark;
    if (a.right) {
      const u1 = [Math.cos(s1) * 12, Math.sin(s1) * 12];
      const u2 = [Math.cos(s2) * 12, Math.sin(s2) * 12];
      mark = `<polyline points="${px(v[0] + u1[0])},${px(v[1] + u1[1])} ${px(v[0] + u1[0] + u2[0])},${px(v[1] + u1[1] + u2[1])} ${px(v[0] + u2[0])},${px(v[1] + u2[1])}" fill="none" stroke="${colour}" stroke-width="${lit(a.id) ? 3 : 1.8}"/>`;
    } else {
      const e1 = [v[0] + Math.cos(s1) * r, v[1] + Math.sin(s1) * r];
      const e2 = [v[0] + Math.cos(s2) * r, v[1] + Math.sin(s2) * r];
      mark = `<path d="M${px(e1[0])},${px(e1[1])} A${r},${r} 0 0 ${delta > 0 ? 1 : 0} ${px(e2[0])},${px(e2[1])}" fill="none" stroke="${colour}" stroke-width="${lit(a.id) ? 3 : 1.8}"/>`;
    }
    body += `<g ${partAttrs(prefix, a.id)}>${mark}</g>`;
    const mid = s1 + delta / 2;
    if (a.label) body += text(v[0] + Math.cos(mid) * (r + 14), v[1] + Math.sin(mid) * (r + 14), a.label, { size: 12, fill: colour, weight: '600' });
    const name = [a.from, a.at, a.to].map((x) => (typeof x === 'string' ? (pts.get(x).label || x) : '')).join('');
    parts.push({ part: a.id, label: a.label || `angle ${name}`, drawn: a.label });
    said.push(`${a.label ? `the angle ${a.label}` : 'an angle'}${name.length === 3 ? ` (${name})` : ''}${a.right ? ', marked as a right angle' : ''}`);
    worked.push(`${a.label ? `The angle ${a.label}` : 'An angle'}${name.length === 3 ? ` (${name})` : ''} measures ${fmt(Math.round(degrees * 10) / 10)} degrees.`);
  }

  for (const v of spec.vectors) {
    const p = at(v.from);
    const [a, b] = [S(p), S([p[0] + v.dx, p[1] + v.dy])];
    const colour = lit(v.id) ? HIGHLIGHT : ACCENT;
    body += `<line ${partAttrs(prefix, v.id)} x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="${colour}" stroke-width="${lit(v.id) ? 3.6 : 2.6}" marker-end="url(#${prefix}-${lit(v.id) ? 'hl' : 'vec'})"/>`;
    if (v.label) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      body += text(b[0] + ((b[0] - a[0]) / len) * 14, b[1] + ((b[1] - a[1]) / len) * 14, v.label, { size: 12, fill: colour, weight: '600' });
    }
    const size = Math.hypot(v.dx, v.dy);
    const dir = Math.round(((Math.atan2(v.dy, v.dx) * 180) / Math.PI + 360) % 360);
    parts.push({ part: v.id, label: v.label || 'arrow', drawn: v.label });
    said.push(`${v.label ? `the arrow ${v.label}` : 'an arrow'} from ${named(v.from)}, going ${fmt(v.dx)} across and ${fmt(v.dy)} up`);
    worked.push(`${v.label ? `The arrow ${v.label}` : 'An arrow'} has length ${fmt(size)} and points ${dir === 90 ? 'up' : dir === 270 ? 'down' : dir === 0 ? 'right' : dir === 180 ? 'left' : `at ${dir} degrees from the right`}.`);
  }

  if (spec.optics) {
    const o = spec.optics;
    const tall = Math.max(Math.abs(o.objectHeight), img.infinite ? 0 : Math.abs(img.hi)) * 1.35;
    const mirror = o.element.endsWith('mirror');
    const axisY = sy(0);
    body += `<line ${partAttrs(prefix, 'axis')} x1="${px(sx(view.xMin))}" y1="${px(axisY)}" x2="${px(sx(view.xMax))}" y2="${px(axisY)}" stroke="${lit('axis') ? HIGHLIGHT : MUTED}" stroke-width="1.2" stroke-dasharray="8 4"/>`;
    // The element, drawn as the textbook symbol.
    const top = sy(Math.min(tall, view.yMax * 0.95));
    const bottom = sy(-Math.min(tall, -view.yMin * 0.95));
    const ex = sx(0);
    let element = `<line x1="${px(ex)}" y1="${px(top)}" x2="${px(ex)}" y2="${px(bottom)}" stroke="${lit('element') ? HIGHLIGHT : INK}" stroke-width="2.4"/>`;
    if (o.element === 'convex-lens') element += `<path d="M${px(ex)},${px(top)} Q${px(ex + 14)},${px(axisY)} ${px(ex)},${px(bottom)} Q${px(ex - 14)},${px(axisY)} ${px(ex)},${px(top)} Z" fill="${ACCENT}" fill-opacity="0.12" stroke="${INK}" stroke-width="1.2"/>`;
    if (o.element === 'concave-lens') element += `<path d="M${px(ex - 8)},${px(top)} Q${px(ex)},${px(axisY)} ${px(ex - 8)},${px(bottom)} L${px(ex + 8)},${px(bottom)} Q${px(ex)},${px(axisY)} ${px(ex + 8)},${px(top)} Z" fill="${ACCENT}" fill-opacity="0.12" stroke="${INK}" stroke-width="1.2"/>`;
    if (mirror) {
      for (let y = top + 6; y < bottom; y += 10) element += `<line x1="${px(ex)}" y1="${px(y)}" x2="${px(ex + 8)}" y2="${px(y - 6)}" stroke="${MUTED}" stroke-width="1"/>`;
    }
    body += `<g ${partAttrs(prefix, 'element')}>${element}</g>`;
    if (o.element !== 'plane-mirror') {
      const F = o.focal;
      const marks = mirror
        ? [[o.element === 'concave-mirror' ? -F : F, 'F'], [o.element === 'concave-mirror' ? -2 * F : 2 * F, 'C']]
        : [[-F, 'F'], [F, 'F'], [-2 * F, '2F'], [2 * F, '2F']];
      for (const [x, name] of marks) {
        if (x < view.xMin || x > view.xMax) continue;
        body += `<circle cx="${px(sx(x))}" cy="${px(axisY)}" r="2.6" fill="${INK}"/>${text(sx(x), axisY + 15, name, { size: 11, fill: MUTED })}`;
      }
    }
    const objTop = [-o.objectDistance, o.objectHeight];
    body += `<line ${partAttrs(prefix, 'object')} x1="${px(sx(objTop[0]))}" y1="${px(axisY)}" x2="${px(sx(objTop[0]))}" y2="${px(sy(objTop[1]))}" stroke="${lit('object') ? HIGHLIGHT : ACCENT}" stroke-width="3" marker-end="url(#${prefix}-vec)"/>`;
    body += text(sx(objTop[0]), sy(objTop[1]) + (o.objectHeight > 0 ? -12 : 14), 'Object', { size: 11 });
    // Two rays from the top of the object: one parallel to the axis, one through
    // the centre or the pole. Each leaves through the image (real) or as if from
    // it (virtual, with its dashed extension back to the image).
    const hits = [[0, o.objectHeight], [0, 0]];
    hits.forEach((hit, i) => {
      const id = `ray${i + 1}`;
      const colour = lit(id) ? HIGHLIGHT : SERIES[i + 1];
      let dir;
      if (img.infinite) {
        const fx = img.f;
        dir = [fx - 0, 0 - o.objectHeight];
      } else if (img.real) dir = [img.v - hit[0], img.hi - hit[1]];
      else dir = [hit[0] - img.v, hit[1] - img.hi];
      const len = Math.hypot(dir[0], dir[1]) || 1;
      const out = [hit[0] + (dir[0] / len) * far, hit[1] + (dir[1] / len) * far];
      let g = `<line x1="${px(sx(objTop[0]))}" y1="${px(sy(objTop[1]))}" x2="${px(sx(hit[0]))}" y2="${px(sy(hit[1]))}" stroke="${colour}" stroke-width="1.8"/>`
        + `<line x1="${px(sx(hit[0]))}" y1="${px(sy(hit[1]))}" x2="${px(sx(out[0]))}" y2="${px(sy(out[1]))}" stroke="${colour}" stroke-width="1.8"/>`;
      if (!img.real && !img.infinite) g += `<line x1="${px(sx(hit[0]))}" y1="${px(sy(hit[1]))}" x2="${px(sx(img.v))}" y2="${px(sy(img.hi))}" stroke="${colour}" stroke-width="1.4" stroke-dasharray="5 4"/>`;
      body += `<g ${partAttrs(prefix, id)} clip-path="url(#${clip})">${g}</g>`;
      parts.push({ part: id, label: i === 0 ? 'the ray parallel to the axis' : (mirror ? 'the ray to the pole' : 'the ray through the centre') });
    });
    const imageShown = !img.infinite && img.v >= view.xMin && img.v <= view.xMax;
    if (imageShown) {
      body += `<line ${partAttrs(prefix, 'image')} x1="${px(sx(img.v))}" y1="${px(axisY)}" x2="${px(sx(img.v))}" y2="${px(sy(img.hi))}" stroke="${lit('image') ? HIGHLIGHT : SERIES[2]}" stroke-width="3"${img.real ? '' : ' stroke-dasharray="6 4"'} marker-end="url(#${prefix}-vec)" clip-path="url(#${clip})"/>`;
      body += text(sx(img.v), sy(img.hi) + (img.hi > 0 ? -12 : 14), 'Image', { size: 11 });
    }
    // The object and the image are written beside them and the element is named
    // in the description, so none of the three can be a label question's target.
    parts.push(
      { part: 'element', label: o.element.replace('-', ' '), drawn: o.element.replace('-', ' ') },
      { part: 'object', label: 'the object', drawn: 'Object' },
      { part: 'image', label: 'the image', drawn: 'Image' },
      { part: 'axis', label: 'the principal axis' },
    );
    said.push(opticsGiven(o, imageShown));
    worked.push(opticsWords(o, img));
  }

  for (const p of spec.points) {
    if (p.hidden) continue;
    const [x, y] = S([p.x, p.y]);
    body += `<g ${partAttrs(prefix, p.id)}><circle cx="${px(x)}" cy="${px(y)}" r="${lit(p.id) ? 5.5 : 3.8}" fill="${lit(p.id) ? HIGHLIGHT : INK}"/>`
      + (p.label ? text(x + 7, y - 9, p.label, { size: 13, anchor: 'start', weight: '600' }) : '')
      + '</g>';
    parts.push({ part: p.id, label: p.label || p.id, drawn: p.label });
  }

  const visible = spec.points.filter((p) => !p.hidden);
  const description = [
    spec.optics ? '' : `A drawing on a frame from (${fmt(view.xMin)}, ${fmt(view.yMin)}) to (${fmt(view.xMax)}, ${fmt(view.yMax)}).`,
    visible.length ? `Points: ${visible.map((p) => `${p.label || p.id} at (${fmt(p.x)}, ${fmt(p.y)})`).join(', ')}.` : '',
    said.length ? `It shows ${said.filter((s) => !s.startsWith('A ray diagram')).join('; ')}${said.some((s) => !s.startsWith('A ray diagram')) ? '.' : ''}` : '',
    said.find((s) => s.startsWith('A ray diagram')) ?? '',
  ].filter((s) => s && s !== 'It shows ').join(' ').replace(/\s+/g, ' ').trim();

  const rows = [
    ...visible.map((p) => ['Point', p.label || p.id, `(${fmt(p.x)}, ${fmt(p.y)})`]),
    ...spec.vectors.map((v) => ['Arrow', v.label || v.id, `${fmt(v.dx)} across, ${fmt(v.dy)} up`]),
  ];
  if (spec.optics) {
    const o = spec.optics;
    if (o.element !== 'plane-mirror') rows.push(['Focal length', '', fmt(o.focal)]);
    rows.push(['Object distance', '', fmt(o.objectDistance)], ['Object height', '', fmt(o.objectHeight)]);
  }

  const defs = `<clipPath id="${esc(clip)}"><rect x="${px(PAD - 6)}" y="${px(titleH + PAD - 6)}" width="${px(W - 2 * PAD + 12)}" height="${px(H - titleH - 2 * PAD + 12)}"/></clipPath>`
    + arrowMarker(prefix, 'vec', ACCENT) + arrowMarker(prefix, 'hl', HIGHLIGHT);
  return {
    width: W, height: H, defs, body, parts, description, worked,
    title: spec.title || (spec.optics ? 'Ray diagram' : 'Geometry drawing'),
    table: { caption: 'What the drawing shows', columns: ['Part', 'Name', 'Value'], rows },
  };
}
