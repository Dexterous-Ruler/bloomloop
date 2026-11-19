// What every figure engine shares: escaping, number formatting, the palette,
// text measurement, the SVG wrapper and the check that runs on every picture
// before it leaves the server.
//
// The rule behind all of it: a figure is DATA a person or a model described, and
// the server alone turns it into a picture. Nothing in a spec is ever pasted into
// the SVG unescaped, and every finished SVG is read back against a short list of
// elements and attributes (safeSvg) before anyone is sent it, so a mistake in one
// engine cannot become script on a phone.

/** Thrown inside the validators and engines; always caught before a caller sees it. */
export class FigureRefusal extends Error {}

/** Refuse with one plain sentence unless `ok`. */
export function need(ok, sentence) {
  if (!ok) throw new FigureRefusal(sentence);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Text and attribute values, every time: there is no unescaped path into a figure. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * A number as a label shows it: at most four significant decimals, no "-0", and
 * a real minus sign, which reads better on a projector than a hyphen.
 */
export function fmt(n) {
  if (!Number.isFinite(n)) return '';
  const r = Math.abs(n) < 1e-9 ? 0 : Number(n.toPrecision(6));
  const s = Math.abs(r) >= 1e5 || (Math.abs(r) < 1e-3 && r !== 0)
    ? r.toExponential(2)
    : String(Number(r.toFixed(4)));
  return s.replace(/^-/, '−');
}

/** Coordinates in the SVG: two decimals are finer than any screen. */
export const px = (n) => String(Math.round(n * 100) / 100);

/** The colours: the app's Forest palette on a white card, legible in either theme. */
export const INK = '#1F2A24';
export const MUTED = '#585C63';
export const GRID = '#E3E5E0';
export const AXIS = '#3A4540';
export const ACCENT = '#2F6B4F';
export const HIGHLIGHT = '#B7862B';
export const PAPER = '#FFFFFF';
/** Series colours, in order. Never the only difference: series also differ by dash or marker, and carry labels. */
export const SERIES = ['#2F6B4F', '#B7862B', '#4F6D8A', '#8A4F5E', '#6B8A3A', '#5E5E5E', '#A0663A', '#3A8A85'];
export const DASHES = ['', '6 4', '2 3', '10 3 2 3', '1 4', '8 2'];

/** Manrope as the app uses, Noto Sans Devanagari for Hindi and Marathi labels. */
export const FONT = 'Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif';

/* ------------------------------------------------------------ text width -- */

const segmenter = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** The grapheme clusters of a string: what a reader counts as one letter, conjuncts and matras included. */
export function graphemes(text) {
  const s = String(text ?? '');
  if (segmenter) return [...segmenter.segment(s)].map((g) => g.segment);
  return [...s];
}

const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/;

/**
 * Roughly how wide a grapheme is, in ems, for a sans-serif face.
 *
 * Why an estimate of our own: Graphviz measures every character it does not
 * know at a Latin default, per code point, so a Devanagari conjunct of four code
 * points was given four letters' room and boxes came out far too wide. Counting
 * grapheme clusters, each at about the advance Noto Sans Devanagari gives one,
 * keeps a Hindi box close to its words. It errs a little wide, never narrow.
 */
function emWidth(g) {
  if (DEVANAGARI.test(g)) return 0.66;
  if (WIDE.test(g)) return 1;
  if (g === ' ') return 0.28;
  if (/^[iljtfr.,:;|!'`]$/.test(g)) return 0.32;
  if (/^[mwMW@%]$/.test(g)) return 0.88;
  if (/^[A-Z]$/.test(g)) return 0.68;
  if (/^[0-9]$/.test(g)) return 0.58;
  if (/^[a-z]$/.test(g)) return 0.55;
  return 0.62;
}

/** Estimated width of a single line of text, in px, at `size` px. */
export const textWidth = (text, size = 12) => graphemes(text).reduce((w, g) => w + emWidth(g), 0) * size;

/**
 * Text broken into lines no wider than `maxPx`, at word boundaries (a single
 * word longer than the line is kept whole rather than cut mid-letter).
 */
export function wrap(text, maxPx, size = 12) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && textWidth(next, size) > maxPx) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/* --------------------------------------------------------------- pieces -- */

/** A text element, escaped, in the figure font. */
export function text(x, y, value, { size = 12, anchor = 'middle', fill = INK, weight = null, baseline = 'middle', id = null, part = null } = {}) {
  const attrs = [
    id ? `id="${esc(id)}"` : '',
    part ? `data-part="${esc(part)}"` : '',
    `x="${px(x)}"`, `y="${px(y)}"`,
    `font-size="${size}"`, `text-anchor="${anchor}"`, `dominant-baseline="${baseline}"`,
    `fill="${fill}"`,
    weight ? `font-weight="${weight}"` : '',
  ].filter(Boolean).join(' ');
  return `<text ${attrs}>${esc(value)}</text>`;
}

/** Several lines of text centred on (x, y). */
export function lines(x, y, list, { size = 12, anchor = 'middle', fill = INK, weight = null } = {}) {
  const lh = size * 1.25;
  const top = y - ((list.length - 1) * lh) / 2;
  return list.map((l, i) => text(x, top + i * lh, l, { size, anchor, fill, weight })).join('');
}

/**
 * Attributes naming an addressable part: a stable id unique on the page (the
 * figure's own prefix, so two figures on one page never share an id) and the
 * part's own name in data-part, which is what steps and later interactions use.
 */
export const partAttrs = (prefix, part) => `id="${esc(`${prefix}-${part}`)}" data-part="${esc(part)}"`;

/** An arrowhead marker for this figure, by colour. */
export function arrowMarker(prefix, name, colour) {
  return `<marker id="${esc(`${prefix}-${name}`)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">`
    + `<path d="M0,0 L10,5 L0,10 Z" fill="${colour}"/></marker>`;
}

/**
 * The finished figure: one <svg> with role="img", a title and a description,
 * on a white card so it reads on a dark screen too.
 */
export function wrapSvg({ prefix, width, height, title, description, body, defs = '' }) {
  const t = `${prefix}-title`;
  const d = `${prefix}-desc`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(width)} ${px(height)}" width="${px(width)}" height="${px(height)}"`
    + ` role="img" aria-labelledby="${t} ${d}" font-family="${esc(FONT)}" id="${esc(prefix)}">`
    + `<title id="${t}">${esc(title)}</title><desc id="${d}">${esc(description)}</desc>`
    + (defs ? `<defs>${defs}</defs>` : '')
    + `<rect x="0" y="0" width="${px(width)}" height="${px(height)}" fill="${PAPER}"/>`
    + `${body}</svg>`;
}

/* ------------------------------------------------------ the safety check -- */

const ELEMENTS = new Set([
  'svg', 'g', 'title', 'desc', 'defs', 'marker', 'clipPath', 'path', 'line', 'polyline', 'polygon',
  'rect', 'circle', 'ellipse', 'text', 'tspan',
]);
const ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'role', 'aria-labelledby', 'aria-hidden', 'id', 'class', 'data-part',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'dx', 'dy',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'fill-opacity', 'stroke-opacity', 'opacity', 'fill-rule',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
  'transform', 'marker-end', 'marker-start', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits',
  'clip-path', 'clipPathUnits', 'preserveAspectRatio',
]);

/**
 * Is this SVG made only of drawing? Every tag is on the element list, every
 * attribute on the attribute list, every url() points inside the figure (#id),
 * and there is no comment, processing instruction, CDATA or entity beyond the
 * five XML ones. Anything else - a script, an event handler, a link, an image,
 * foreignObject, a style sheet - fails, whichever engine wrote it.
 */
export function safeSvg(svg) {
  if (typeof svg !== 'string' || !svg.startsWith('<svg')) return false;
  if (/<!|<\?|\]\]>/.test(svg)) return false;
  if (/&(?!(?:amp|lt|gt|quot|#39|#x?[0-9a-fA-F]+);)/.test(svg)) return false;
  const tag = /<\/?([A-Za-z][\w:-]*)([^<>]*)>/g;
  let m;
  let last = 0;
  while ((m = tag.exec(svg))) {
    // Between tags there may be text, never another '<' or '>'.
    if (/[<>]/.test(svg.slice(last, m.index))) return false;
    last = tag.lastIndex;
    if (!ELEMENTS.has(m[1])) return false;
    const rest = m[2].replace(/\/\s*$/, '');
    const attr = /\s*([A-Za-z][\w:-]*)\s*=\s*"([^"]*)"/gy;
    let a;
    let used = 0;
    while ((a = attr.exec(rest))) {
      used = attr.lastIndex;
      if (!ATTRIBUTES.has(a[1])) return false;
      if (/url\(/i.test(a[2]) && !/^url\(#[\w-]+\)$/.test(a[2])) return false;
      if (/javascript:|data:/i.test(a[2])) return false;
    }
    if (rest.slice(used).trim()) return false;
  }
  return !/[<>]/.test(svg.slice(last));
}
