// Formulas and code, rendered on the server (Phase 6, decision H15).
//
// A professor's question, lesson or topic name may hold maths ("$x^2 + 1$"),
// chemistry ("$\ce{H2O}$") or a block of code. The phone must not run a maths
// or highlighting library: a low-end Android phone on a classroom hotspot gets
// finished markup and zero script. So the server turns the text into HTML here:
//
//   $...$ and $$...$$   TeX to MathML with temml's server build (temml.cjs,
//                       which carries mhchem, so \ce{} works), trust off
//   ```lang ... ```     a fenced block of code to highlighted HTML with shiki
//   everything else     escaped, character by character; a line break is <br>
//
// What this promises a caller, because a page will put the HTML straight in:
//   - Every character of the input that is not inside a formula or a code block
//     is escaped. No tag, attribute or entity the input wrote survives as markup.
//   - TeX is rendered with trust off, so \href, \url, \includegraphics, \class,
//     \style and the rest of the trust-gated commands are refused, and temml
//     escapes all text it emits. Colours are checked by temml itself.
//   - No id and no link from the input: temml writes an element id for \label
//     and a link for \ref and \eqref even with trust off, so a formula using
//     them is shown as its escaped source, and so is any rendering that comes
//     out holding an id or an href by another way (SETS_ID_OR_LINK).
//   - A formula temml cannot read is shown as its escaped source, marked with a
//     class; this never throws. So is a formula over MAX_FORMULA characters, and
//     every formula past MAX_FORMULAS in one input.
//   - The input is capped (MAX_RICH_INPUT characters); `truncated` says so.
//
// A dollar sign follows pandoc's rule, so prices in a question survive: an
// opening $ must have a non-space character right after it, and the closing $
// a non-space character right before it and no digit right after it. "$20 and
// $30" stays text. \$ is a literal dollar sign anywhere.
//
// Shiki's highlighter is loaded the first time a code block is rendered, with
// the JavaScript regex engine (no WebAssembly) and a fixed set of languages
// (CODE_LANGUAGES); a fence naming any other language is shown as plain text.
// richTextSync() is for callers that cannot wait (a class question's payload is
// built synchronously): it highlights only once the highlighter has loaded, and
// shows a code block escaped, unhighlighted, before then.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The `require` condition of temml's exports: dist/temml.cjs, the build that
// includes mhchem (decision H15). The ESM build is not relied on for \ce.
const temml = require('temml');

/** The most characters one input is read to. Past it the rest is dropped and `truncated` is true. */
export const MAX_RICH_INPUT = 20000;
/** The longest formula rendered; a longer one is shown as its escaped source. */
export const MAX_FORMULA = 2000;
/** The most formulas rendered in one input; the rest are shown as escaped source. */
export const MAX_FORMULAS = 200;
/** The longest code block highlighted; a longer one is shown escaped, unhighlighted. */
export const MAX_CODE = 10000;

/**
 * The languages a fence may name, each with the names a professor might type
 * for it. A fence naming none of these (or no language) is shown as plain text.
 */
export const CODE_LANGUAGES = Object.freeze({
  c: ['c', 'h'],
  cpp: ['cpp', 'c++', 'cc', 'hpp', 'cxx'],
  java: ['java'],
  python: ['python', 'py', 'python3'],
  javascript: ['javascript', 'js', 'node', 'mjs', 'cjs'],
  typescript: ['typescript', 'ts'],
  sql: ['sql', 'mysql', 'postgres', 'postgresql', 'plsql'],
  shellscript: ['shell', 'sh', 'bash', 'zsh', 'shellscript', 'console'],
  html: ['html', 'htm'],
  css: ['css'],
  json: ['json'],
  xml: ['xml'],
  go: ['go', 'golang'],
  rust: ['rust', 'rs'],
  kotlin: ['kotlin', 'kt'],
  php: ['php'],
  r: ['r'],
  csharp: ['csharp', 'c#', 'cs'],
});

const LANGUAGE_OF = new Map(Object.entries(CODE_LANGUAGES).flatMap(([id, names]) => names.map((n) => [n, id])));

// Light first: what a phone shows unless the page asks for the dark colours,
// which shiki writes beside them as CSS variables (--shiki-dark).
const THEMES = { light: 'github-light', dark: 'github-dark' };

const TEMML_OPTIONS = Object.freeze({
  throwOnError: true,
  trust: false,
  // A sizing command cannot make a formula larger than this (in em), and a
  // macro cannot expand without end: a hostile formula costs little.
  maxSize: [20, 20],
  maxExpand: 300,
});

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Every character that means something in HTML, escaped. */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Does this text hold anything the renderer does more than escape? A dollar sign or a fence. */
export const hasMarkup = (value) => typeof value === 'string' && (value.includes('$') || value.includes('```'));

/* ----------------------------------------------------------- highlighter -- */

let highlighter = null;
let loading = null;

/**
 * Load shiki once, on first need. Never rejects: a failure leaves code blocks
 * shown as escaped text, which is what they are without colours.
 */
export function warmRichText() {
  if (highlighter) return Promise.resolve(highlighter);
  if (!loading) {
    loading = (async () => {
      try {
        const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
          import('shiki/core'),
          import('shiki/engine/javascript'),
        ]);
        highlighter = await createHighlighterCore({
          themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
          langs: Object.keys(CODE_LANGUAGES).map((id) => import(`shiki/langs/${id}.mjs`)),
          engine: createJavaScriptRegexEngine(),
        });
      } catch (err) {
        console.error('[richText] the code highlighter could not load; code is shown unhighlighted:', err.message);
        highlighter = null;
      }
      return highlighter;
    })();
  }
  return loading;
}

/* ----------------------------------------------------------- the reading -- */

// A fence opens a line: up to three spaces, three or more backticks, then an
// optional language word. It closes at a line of at least as many backticks.
const FENCE_OPEN = /^ {0,3}(`{3,})[ \t]*([^\s`]*)[^\n`]*$/;

/**
 * The input in order as text, code and maths pieces:
 *   { type: 'text', value }
 *   { type: 'code', lang, value, raw }
 *   { type: 'math', display, tex, raw }
 */
export function readPieces(input) {
  const pieces = [];
  const lines = input.split('\n');
  let text = [];
  const flushText = () => {
    if (text.length) pieces.push(...mathPieces(text.join('\n')));
    text = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) { text.push(lines[i]); continue; }
    const ticks = open[1].length;
    const close = new RegExp(`^ {0,3}\`{${ticks},}[ \\t]*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end += 1;
    flushText();
    const body = lines.slice(i + 1, end).join('\n');
    pieces.push({ type: 'code', lang: open[2].toLowerCase(), value: body, raw: lines.slice(i, end + 1).join('\n') });
    i = end;
  }
  flushText();
  return pieces;
}

const isSpace = (c) => c === undefined || /\s/.test(c);
const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';

/** One stretch of prose as text and maths pieces, by the dollar rule in the header. */
function mathPieces(source) {
  const out = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', value: text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\' && source[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }
    if (c === '$' && source[i + 1] === '$') {
      const end = source.indexOf('$$', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'math', display: true, tex: source.slice(i + 2, end), raw: source.slice(i, end + 2) });
        i = end + 2;
        continue;
      }
      text += '$$';
      i += 2;
      continue;
    }
    if (c === '$' && !isSpace(source[i + 1])) {
      // The closing $: not escaped, a non-space before it, no digit after it,
      // and no blank line between: a formula sits inside one paragraph.
      let j = i + 1;
      let end = -1;
      while (j < source.length) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '\n' && source[j + 1] === '\n') break;
        if (source[j] === '$') {
          if (!isSpace(source[j - 1]) && !isDigit(source[j + 1]) && source[j + 1] !== '$') end = j;
          break;
        }
        j += 1;
      }
      if (end > i + 1) {
        flush();
        out.push({ type: 'math', display: false, tex: source.slice(i + 1, end), raw: source.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }
    text += c;
    i += 1;
  }
  flush();
  return out;
}

/* ---------------------------------------------------------- the writing -- */

const textHtml = (value) => escapeHtml(value).replace(/\r?\n/g, '<br>');

const texError = (raw) => `<span class="rich-tex-error">${escapeHtml(raw)}</span>`;

/** The commands with which temml writes an element id or a link, trust or no trust. */
const ID_OR_LINK_COMMAND = /\\(?:label|ref|eqref)(?![A-Za-z])/;
/** A tag in temml's output carrying an id or an href. Text inside is escaped, so every `<` here opens a real tag. */
const SETS_ID_OR_LINK = /<[^>]*\s(?:id|href)\s*=/i;

function mathHtml(piece, tally) {
  tally.math += 1;
  if (tally.math > MAX_FORMULAS || piece.tex.length > MAX_FORMULA || !piece.tex.trim() || ID_OR_LINK_COMMAND.test(piece.tex)) {
    tally.errors += 1;
    return texError(piece.raw);
  }
  try {
    const html = temml.renderToString(piece.tex, { ...TEMML_OPTIONS, displayMode: piece.display });
    if (SETS_ID_OR_LINK.test(html)) throw new Error('an id or a link');
    return html;
  } catch {
    // A ParseError, or anything else temml throws: the reader sees what was
    // written, escaped, and the page can mark it.
    tally.errors += 1;
    return texError(piece.raw);
  }
}

const plainCode = (value) => `<pre class="rich-code"><code>${escapeHtml(value)}</code></pre>`;

function codeHtml(piece, tally, hl) {
  tally.code += 1;
  const lang = LANGUAGE_OF.get(piece.lang) ?? 'text';
  if (!hl || piece.value.length > MAX_CODE) {
    if (!hl) tally.unhighlighted += 1;
    return plainCode(piece.value);
  }
  try {
    return hl.codeToHtml(piece.value, { lang, themes: THEMES, defaultColor: 'light' });
  } catch {
    tally.unhighlighted += 1;
    return plainCode(piece.value);
  }
}

function render(raw, hl) {
  const source = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n') : '';
  const truncated = source.length > MAX_RICH_INPUT;
  const text = truncated ? source.slice(0, MAX_RICH_INPUT) : source;
  const tally = { math: 0, code: 0, errors: 0, unhighlighted: 0 };
  if (!hasMarkup(text)) {
    return { text, html: textHtml(text), math: 0, code: 0, errors: 0, truncated, highlighted: true };
  }
  const html = readPieces(text).map((p) => {
    if (p.type === 'math') return mathHtml(p, tally);
    if (p.type === 'code') return codeHtml(p, tally, hl);
    return textHtml(p.value);
  }).join('');
  return {
    text,
    html,
    math: tally.math,
    code: tally.code,
    errors: tally.errors,
    truncated,
    // False when a code block was shown without colours because the
    // highlighter had not loaded yet (richTextSync only).
    highlighted: tally.unhighlighted === 0,
  };
}

// The same text is rendered again and again (every phone in a room is served
// the same questions), so finished results are kept, a bounded number of them.
const CACHE_SIZE = 2000;
const cache = new Map();

function remember(key, result) {
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

/**
 * One text as plain text and HTML.
 *
 * @returns {Promise<{ text, html, math, code, errors, truncated, highlighted }>}
 *   `text` is the input as read (capped, line ends as \n); `html` the fragment
 *   to show; `math` and `code` how many formulas and code blocks it held;
 *   `errors` how many formulas are shown as their source; `truncated` whether
 *   the input was over MAX_RICH_INPUT.
 */
export async function richText(input) {
  const key = typeof input === 'string' ? input : '';
  const held = cache.get(key);
  if (held) return held;
  const hl = key.includes('```') ? await warmRichText() : highlighter;
  const result = Object.freeze(render(key, hl));
  return result.highlighted ? remember(key, result) : result;
}

/** As richText(), without waiting: a code block is highlighted only once shiki has loaded (see the header). */
export function richTextSync(input) {
  const key = typeof input === 'string' ? input : '';
  const held = cache.get(key);
  if (held) return held;
  if (key.includes('```') && !highlighter) warmRichText();
  const result = Object.freeze(render(key, highlighter));
  return result.highlighted ? remember(key, result) : result;
}

/** A short label (a topic, a chapter, a unit) as HTML: maths rendered, the rest escaped. */
export const labelHtml = (value) => richTextSync(typeof value === 'string' ? value : '').html;

/* ------------------------------------------------- a room phone's question -- */

/**
 * The phone's question fields that can hold markup: one string each, or a list
 * of strings. Which exist depends on the question's kind (forStudent() in
 * questionTypes.js); the rest are absent.
 */
const PHONE_STRINGS = ['text', 'criterion'];
const PHONE_LISTS = ['options', 'left', 'right', 'items', 'groups', 'columns'];

/**
 * The additive `rich` field of a phone's question (decision H15), without
 * waiting: HTML for each field of the question as the phone was sent it
 * (forStudent()'s output, so never a key) whose HTML says more than its plain
 * text: a formula, a code block, a formula shown as its source, or an escaped
 * dollar sign. Any other field is left out, so `rich` is {} for most questions
 * (prices included) and the phone shows its plain text as before. A list is
 * sent whole, item for item, when any item qualifies. A passage stimulus is
 * `rich.passage`; a dropdown's gaps `rich.gaps`; a grid's row labels `rich.rows`.
 *
 * Never throws: on any failure `rich` is {} and the plain text stands. Used for
 * class:question, whose payload is built synchronously; a code block there is
 * highlighted once shiki has loaded (richTextSync).
 */
export function phoneRichSync(shown) {
  if (!shown || typeof shown !== 'object') return {};
  const out = {};
  try {
    const html = (value) => (typeof value === 'string' ? richTextSync(value).html : escapeHtml(value));
    const says = (value) => hasMarkup(value) && richTextSync(value).html !== textHtml(richTextSync(value).text);
    for (const k of PHONE_STRINGS) if (says(shown[k])) out[k] = html(shown[k]);
    for (const k of PHONE_LISTS) {
      if (Array.isArray(shown[k]) && shown[k].some(says)) out[k] = shown[k].map(html);
    }
    if (shown.kind === 'grid' && Array.isArray(shown.rows) && shown.rows.some(says)) out.rows = shown.rows.map(html);
    if (shown.stimulus?.kind === 'passage' && says(shown.stimulus.text)) out.passage = html(shown.stimulus.text);
    if (Array.isArray(shown.gaps) && shown.gaps.some((g) => (g?.options ?? []).some(says))) {
      out.gaps = shown.gaps.map((g) => ({ options: (g?.options ?? []).map(html) }));
    }
    return out;
  } catch (err) {
    console.error('[richText] a phone question could not be rendered; its plain text stands:', err.message);
    return {};
  }
}

/**
 * The same, for server:question: when the question holds a code block, shiki is
 * loaded first, so the block arrives highlighted. Never rejects.
 */
export async function phoneRich(shown) {
  try {
    if (JSON.stringify(shown ?? {}).includes('```')) await warmRichText();
  } catch {
    // Unhighlighted code is still the professor's code; nothing to report.
  }
  return phoneRichSync(shown);
}
