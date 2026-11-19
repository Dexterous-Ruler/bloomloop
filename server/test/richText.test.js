// Phase 6 (decision H15): formulas and code rendered on the server
// (services/richText.js). Pinned here: every character outside a formula or a
// code block is escaped; maths and chemistry become MathML through temml's
// server build with trust off; a fenced block is highlighted by shiki; a
// malformed or over-long formula is shown as its escaped source and nothing
// throws; prices stay text; the input is capped; and a phone's question gets
// HTML only for the fields that hold markup, with the key never in reach.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_FORMULA, MAX_FORMULAS, MAX_RICH_INPUT, escapeHtml, hasMarkup, labelHtml, phoneRich, phoneRichSync, readPieces, richText,
  richTextSync, warmRichText,
} from '../src/services/richText.js';
import { forStudent } from '../src/questionTypes.js';

/** Every tag the HTML opens, by name. */
const tags = (html) => [...new Set([...html.matchAll(/<([a-z][a-z0-9-]*)/gi)].map((m) => m[1].toLowerCase()))].sort();

describe('escaping', () => {
  test('text without markup is escaped character by character, line breaks as <br>', async () => {
    const r = await richText('Tom & Jerry say "<b>hi</b>" & it\'s\nnext');
    assert.equal(r.html, 'Tom &amp; Jerry say &quot;&lt;b&gt;hi&lt;/b&gt;&quot; &amp; it&#39;s<br>next');
    assert.deepEqual([r.math, r.code, r.errors, r.truncated], [0, 0, 0, false]);
    assert.equal(r.text, 'Tom & Jerry say "<b>hi</b>" & it\'s\nnext');
  });

  test('a script tag is text, outside a formula and inside one', async () => {
    const r = await richText('<script>alert(1)</script> and $<script>alert(2)</script>$ and <img src=x onerror=alert(3)>');
    assert.doesNotMatch(r.html, /<script|<img/i);
    assert.match(r.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(r.html, /&lt;img src=x onerror=alert\(3\)&gt;$/);
    assert.deepEqual(tags(r.html), ['math', 'mi', 'mn', 'mo', 'mrow']);
  });

  test('escapeHtml and hasMarkup', () => {
    assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
    assert.equal(hasMarkup('plain'), false);
    assert.equal(hasMarkup('a $x$'), true);
    assert.equal(hasMarkup('```js\nx\n```'), true);
    assert.equal(hasMarkup(null), false);
  });
});

describe('maths and chemistry', () => {
  test('$...$ inline and $$...$$ display become MathML', async () => {
    const r = await richText('Solve $x^2 + 1 = 0$ and $$\\frac{a}{b}$$ then.');
    assert.equal(r.math, 2);
    assert.match(r.html, /^Solve <math><mrow><msup><mi>x<\/mi>/);
    assert.match(r.html, /<math display="block"[^>]*><mfrac><mi>a<\/mi><mi>b<\/mi><\/mfrac><\/math> then\.$/);
  });

  test('\\ce{} renders chemistry (mhchem is in temml\'s server build)', async () => {
    const r = await richText('Water is $\\ce{H2O}$; burning: $\\ce{2H2 + O2 -> 2H2O}$');
    assert.equal(r.errors, 0);
    assert.match(r.html, /<msub><mrow><\/mrow><mn>2<\/mn><\/msub>/);
    assert.match(r.html, /→/);
  });

  test('a malformed formula is shown as its escaped source, and nothing throws', async () => {
    const r = await richText('Broken $\\frac{1}{$ and <fine>');
    assert.equal(r.errors, 1);
    assert.equal(r.html, 'Broken <span class="rich-tex-error">$\\frac{1}{$</span> and &lt;fine&gt;');
  });

  test('trust is off: \\href, \\url and \\includegraphics are refused, and shown as source', async () => {
    for (const tex of ['\\href{javascript:alert(1)}{x}', '\\url{javascript:alert(1)}', '\\includegraphics{http://x/y.png}', '\\htmlClass{a}{b}']) {
      const r = await richText(`$${tex}$`);
      assert.equal(r.errors, 1, tex);
      assert.doesNotMatch(r.html, /href=|src=|class="a"/, tex);
    }
  });

  test('a price is text: $20 and $30, a closing $ before a digit, \\$ as a dollar sign', async () => {
    assert.equal((await richText('Costs $20 and $30 today')).html, 'Costs $20 and $30 today');
    assert.equal((await richText('Pay $ 5 now')).html, 'Pay $ 5 now');
    const escaped = await richText('Escaped \\$5 and $y$');
    assert.match(escaped.html, /^Escaped \$5 and <math><mi>y<\/mi><\/math>$/);
  });

  test('an over-long formula, and formulas past the limit, are shown as source', async () => {
    const long = await richText(`$${'x+'.repeat(MAX_FORMULA)}x$`);
    assert.equal(long.errors, 1);
    const many = await richText(Array.from({ length: MAX_FORMULAS + 2 }, (_, i) => `$${i}$`).join(' '));
    assert.equal(many.math, MAX_FORMULAS + 2);
    assert.equal(many.errors, 2);
  });

  test('the input is capped', async () => {
    const r = await richText('a'.repeat(MAX_RICH_INPUT + 50));
    assert.equal(r.truncated, true);
    assert.equal(r.text.length, MAX_RICH_INPUT);
  });

  test('a hostile macro cannot expand without end', async () => {
    const r = await richText('$\\def\\a{\\a}\\a$');
    assert.equal(r.errors, 1);
  });
});

describe('code', () => {
  test('a fenced block is highlighted, its text escaped by shiki, and maths inside it left alone', async () => {
    const r = await richText('Read this:\n```python\nprint("<b>$x$</b>")\n```\nWhat prints?');
    assert.equal(r.code, 1);
    assert.equal(r.math, 0);
    assert.match(r.html, /^Read this:<pre class="shiki/);
    assert.match(r.html, /<\/pre>What prints\?$/);
    assert.doesNotMatch(r.html, /<b>/);
    assert.match(r.html, /&#x3C;b>\$x\$&#x3C;\/b>/);
    assert.match(r.html, /--shiki-dark/);
  });

  test('a language not on the list is plain text, and the fence\'s word never reaches the HTML', async () => {
    const r = await richText('```"><script>\nx = 1\n```');
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.html, /<script|"><script/);
  });

  test('without waiting, a code block is highlighted once the highlighter has loaded', async () => {
    await warmRichText();
    const r = richTextSync('```js\nconst a = 1;\n```');
    assert.equal(r.highlighted, true);
    assert.match(r.html, /<pre class="shiki/);
  });

  test('the pieces: text, a fenced block, a formula', () => {
    assert.deepEqual(readPieces('a $x$\n```c\nint i;\n```\nb').map((p) => [p.type, p.value ?? p.tex]),
      [['text', 'a '], ['math', 'x'], ['code', 'int i;'], ['text', 'b']]);
  });
});

describe('a room phone\'s question (the additive field)', () => {
  const MCQ = {
    _id: 'q1', kind: 'mcq', bloom: 'apply', topic: 'Roots', text: 'If $x^2 = 4$, what is $x$?', options: ['$2$ or $-2$', 'only 2', '$\\pm 4$', '4'],
    answerIdx: 0, source: 'teacher', status: 'active',
  };

  test('HTML for each field with markup, from what the phone is sent: never the key', async () => {
    const shown = forStudent(MCQ, 'R1:q1');
    const rich = await phoneRich(shown);
    assert.deepEqual(Object.keys(rich).sort(), ['options', 'text']);
    assert.equal(rich.options.length, shown.options.length);
    shown.options.forEach((o, i) => assert.equal(rich.options[i], richTextSync(o).html));
    assert.doesNotMatch(JSON.stringify(rich), /answerIdx/);
  });

  test('a question without markup gets {}, prices included, and so does nonsense', async () => {
    assert.deepEqual(await phoneRich(forStudent({ ...MCQ, text: 'Plain?', options: ['a', 'b', 'c', 'd'] }, 's')), {});
    assert.deepEqual(await phoneRich(forStudent({ ...MCQ, text: 'Costs $20 or $30?', options: ['$5', 'b', 'c', 'd'] }, 's')), {});
    assert.deepEqual(Object.keys(phoneRichSync({ text: 'Pay \\$5' })), ['text'], 'an escaped dollar sign reads differently, so it is sent');
    assert.deepEqual(phoneRichSync(null), {});
    assert.deepEqual(await phoneRich(undefined), {});
  });

  test('a passage, a dropdown\'s gaps and a grid\'s rows', () => {
    const rich = phoneRichSync({
      kind: 'grid', text: 'Tick', rows: ['$a$', 'b'], columns: ['x', 'y'], stimulus: { kind: 'passage', text: 'Given $\\ce{NaCl}$' },
      gaps: [{ options: ['$1$', '2'] }],
    });
    assert.deepEqual(Object.keys(rich).sort(), ['gaps', 'passage', 'rows']);
    assert.match(rich.passage, /<math>/);
    assert.equal(rich.rows[1], 'b');
  });

  test('labelHtml renders a topic name\'s maths', () => {
    assert.match(labelHtml('Groups $\\mathbb{Z}_n$'), /^Groups <math>/);
    assert.equal(labelHtml('<i>x</i>'), '&lt;i&gt;x&lt;/i&gt;');
  });
});
