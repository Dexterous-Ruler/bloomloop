// Phase 2 - generating and editing the four kinds the phone could render but
// nothing ever created: hot text, dropdown, table and grid.
//
// Pinned here, per kind: the offline template builds from the sample chapter,
// passes the validator, says only what the source says, leaks no key to the
// phone, and scores 1 for the answer a phone would send and 0 for a wrong one
// (the same forStudent() and score() the live loop calls). Then a hand edit of
// each, valid and invalid, validated as one whole payload. Then the Mongo
// schema, which used to drop these kinds' payloads on save.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { invalidReason, forStudent, score, BLANK_MARK } from '../src/questionTypes.js';
import { fallbackForTopic, contextForTopic } from '../src/services/generate.js';
import { applyEdit, patchFor } from '../src/services/edits.js';
import { Question } from '../src/models/index.js';
import { SAMPLE } from '../src/sampleContent.js';

const LEVEL = { hottext: 'analyse', grid: 'analyse', dropdown: 'apply', table: 'apply' };
const SEED = '21CS07:q1';

const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
const SOURCE = flat(SAMPLE.rawText);
const LOW = SOURCE.toLowerCase();
const LINES = LOW.split(/(?<=[.!?;])\s+/);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (w) => new RegExp(`\\b${esc(w.toLowerCase())}\\b`);
const together = (a, b) => LINES.some((l) => word(a).test(l) && word(b).test(l));

/** Every item of one kind the templates build across the sample's topics. */
function built(kind) {
  return SAMPLE.topics.flatMap((topic) =>
    fallbackForTopic({
      topic,
      contextText: contextForTopic(SAMPLE.rawText, topic),
      mix: { [LEVEL[kind]]: 3 },
      kinds: { [LEVEL[kind]]: kind },
    }).filter((q) => q.kind === kind));
}

const KEYS = ['answerIdx', 'answerIdxs', 'accept', 'answers', 'blanks', 'answerBool', 'rubric', 'sequence', 'pairs', 'buckets'];
function leaks(value, found = []) {
  if (Array.isArray(value)) value.forEach((v) => leaks(v, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (KEYS.includes(k)) found.push(k);
      leaks(v, found);
    }
  }
  return found;
}

/** What a phone would send for the right answer, read off what it was shown. */
function rightFor(q, view) {
  switch (q.kind) {
    case 'hottext': return q.answerIdxs;
    case 'dropdown': return q.blanks.map((b, i) => view.gaps[i].options.indexOf(b.options[b.answerIdx]));
    case 'table': {
      const out = {};
      q.rows.forEach((r, ri) => r.cells.forEach((c, ci) => { if (c.accept) out[`${ri}:${ci}`] = c.accept[0]; }));
      return out;
    }
    case 'grid': {
      const out = {};
      q.answers.forEach((row, ri) => row.forEach((v, ci) => { if (v) out[`${ri}:${ci}`] = true; }));
      return out;
    }
    default: throw new Error(q.kind);
  }
}

/** A wholly wrong answer: every pick or cell wrong. */
function wrongFor(q, view) {
  switch (q.kind) {
    case 'hottext': return q.tokens.map((_, i) => i).filter((i) => !q.answerIdxs.includes(i)).slice(0, 2);
    case 'dropdown': return rightFor(q, view).map((pos, i) => (pos + 1) % view.gaps[i].options.length);
    case 'table': return Object.fromEntries(Object.keys(rightFor(q, view)).map((k) => [k, 'not this']));
    case 'grid': {
      const out = {};
      q.answers.forEach((row, ri) => row.forEach((v, ci) => { if (!v) out[`${ri}:${ci}`] = true; }));
      return out;
    }
    default: throw new Error(q.kind);
  }
}

for (const kind of ['hottext', 'dropdown', 'table', 'grid']) {
  describe(`the ${kind} template`, () => {
    const items = built(kind);

    test('builds on every sample topic, at its own level, and passes the validator', () => {
      assert.equal(items.length, SAMPLE.topics.length * 3, `${items.length} built`);
      for (const q of items) {
        assert.equal(q.bloom, LEVEL[kind]);
        assert.equal(q.source, 'fallback');
        assert.equal(invalidReason(q), null, invalidReason(q));
      }
    });

    test('the phone is shown no part of the key, and the right answer scores 1, a wrong one 0', () => {
      for (const q of items) {
        const view = forStudent({ ...q, _id: 'q1' }, SEED);
        assert.deepEqual(leaks(view), [], JSON.stringify(view));
        const right = score(q, rightFor(q, view), SEED);
        assert.equal(right.score, 1, `${q.text} ${right.detail}`);
        assert.equal(right.correct, true);
        const wrong = score(q, wrongFor(q, view), SEED);
        assert.equal(wrong.score, 0, `${q.text} ${wrong.detail}`);
        assert.equal(wrong.correct, false);
      }
    });

    test('two items of it in one topic are two different questions', () => {
      for (const topic of SAMPLE.topics) {
        const mine = items.filter((q) => q.topic === topic);
        const prints = new Set(mine.map((q) => JSON.stringify({ ...q, text: '' })));
        assert.equal(prints.size, mine.length, topic);
      }
    });
  });
}

describe('the templates say only what the source says', () => {
  test('hot text: the line is the source\'s own, and each right pick is a word the source defines', () => {
    for (const q of built('hottext')) {
      assert.ok(SOURCE.includes(q.tokens.join(' ')), q.tokens.join(' '));
      const core = (t) => t.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
      const defines = (w) => new RegExp(`(?:^|[.!?;] )(?:the |a |an )?${esc(w)} (?:is|are|means|refers to)\\b`).test(LOW);
      q.tokens.forEach((t, i) => {
        if (q.answerIdxs.includes(i)) assert.ok(defines(core(t)), `${t} is picked but not defined`);
        else assert.ok(!core(t) || !defines(core(t)), `${t} is defined but not picked`);
      });
    }
  });

  test('dropdown: the right options rebuild a line of the source, and no wrong option is in that line', () => {
    for (const q of built('dropdown')) {
      const passage = q.text.slice(q.text.indexOf(': ') + 2);
      let i = 0;
      const rebuilt = passage.replace(new RegExp(esc(BLANK_MARK), 'g'), () => {
        const b = q.blanks[i++];
        return b.options[b.answerIdx];
      });
      assert.ok(LOW.includes(rebuilt.toLowerCase()), rebuilt);
      q.blanks.forEach((b) => b.options.forEach((o, j) => {
        if (j !== b.answerIdx) assert.ok(!word(o).test(rebuilt.toLowerCase()), `${o} in "${rebuilt}"`);
      }));
    }
  });

  test('table: each row\'s idea shares a line with its term and the other idea never does; the quote is the source\'s', () => {
    for (const q of built('table')) {
      const ideas = [...new Set(q.rows.map((r) => r.cells[1].given ?? r.cells[1].accept[0]))];
      assert.equal(ideas.length, 2, JSON.stringify(ideas));
      assert.ok(q.rows[0].cells.every((c) => c.given !== undefined), 'the first row is the worked example');
      const blanks = q.rows.slice(1).map((r) => r.cells[1].accept[0]);
      assert.equal(new Set(blanks).size, 2, 'the rows left to do need both ideas');
      for (const r of q.rows) {
        const idea = r.cells[1].given ?? r.cells[1].accept[0];
        const other = ideas.find((x) => x !== idea);
        assert.ok(together(r.header, idea), `${r.header} with ${idea}`);
        assert.ok(!together(r.header, other), `${r.header} also with ${other}`);
        const quote = r.cells[0].given.replace(/\.\.\.$/, '');
        assert.ok(SOURCE.includes(quote), quote);
        assert.ok(word(r.header).test(quote.toLowerCase()) && !word(idea).test(quote.toLowerCase()), quote);
      }
    }
  });

  test('grid: every tick is a line holding both, every box left alone has none; no row or column is uniform', () => {
    for (const q of built('grid')) {
      q.rows.forEach((row, ri) => q.columns.forEach((col, ci) => {
        assert.equal(together(row, col), q.answers[ri][ci], `${row} x ${col}`);
      }));
      for (const row of q.answers) assert.ok(row.some(Boolean) && !row.every(Boolean));
      q.columns.forEach((_, ci) => {
        assert.ok(q.answers.some((r) => r[ci]) && q.answers.some((r) => !r[ci]), q.columns[ci]);
      });
    }
  });
});

// ------------------------------------------------------------------ edits --

const stored = {
  hottext: {
    _id: 'h1', contentId: 'c1', topic: 'Cells', bloom: 'analyse', kind: 'hottext', status: 'draft', source: 'fallback',
    text: 'Pick every word that names an organelle.',
    tokens: ['The', 'nucleus', 'sends', 'instructions', 'to', 'the', 'ribosome.'],
    criterion: 'every word that names an organelle',
    answerIdxs: [1, 6],
  },
  dropdown: {
    _id: 'd1', contentId: 'c1', topic: 'Cells', bloom: 'apply', kind: 'dropdown', status: 'active', source: 'llm',
    text: 'A leaf takes in ____ and gives out ____ .',
    blanks: [{ options: ['carbon dioxide', 'oxygen', 'nitrogen'], answerIdx: 0 }, { options: ['oxygen', 'helium'], answerIdx: 0 }],
  },
  table: {
    _id: 't1', contentId: 'c1', topic: 'Cells', bloom: 'apply', kind: 'table', status: 'active', source: 'llm',
    text: 'Complete the table.',
    columns: ['Found in', 'Job'],
    rows: [
      { header: 'Chloroplast', cells: [{ given: 'Plants' }, { given: 'Photosynthesis' }] },
      { header: 'Mitochondrion', cells: [{ given: 'Both' }, { accept: ['respiration'] }] },
    ],
  },
  grid: {
    _id: 'g1', contentId: 'c1', topic: 'Cells', bloom: 'analyse', kind: 'grid', status: 'draft', source: 'fallback',
    text: 'Tick where each is found.',
    rows: ['Cell wall', 'Nucleus'],
    columns: ['Plant', 'Animal'],
    answers: [[true, false], [true, true]],
  },
};

describe('editing the four kinds validates the whole payload', () => {
  test('hot text: a valid edit lands whole; an index off the sentence is refused', () => {
    const ok = applyEdit(stored.hottext, { tokens: ['  The', 'nucleus ', 'and', 'the', 'ribosome', 'work.'], answerIdxs: [1, 4] });
    assert.equal(ok.reason, undefined);
    assert.deepEqual(ok.question.tokens, ['The', 'nucleus', 'and', 'the', 'ribosome', 'work.']);
    assert.deepEqual(patchFor(ok.question).answerIdxs, [1, 4]);
    assert.equal(ok.question.status, 'draft');

    assert.equal(applyEdit(stored.hottext, { answerIdxs: [1, 9] }).reason, 'hottext answerIdxs out of range');
    assert.equal(applyEdit(stored.hottext, { tokens: ['The', '  ', 'ribosome'] }).reason, 'hottext has an empty token');
    assert.equal(applyEdit(stored.hottext, { criterion: '' }).reason, 'hottext needs a criterion saying which words to pick');
  });

  test('dropdown: a valid edit lands whole; a gap whose answer is off its list is refused', () => {
    const blanks = [{ options: ['carbon dioxide ', 'oxygen'], answerIdx: 0 }, { options: ['oxygen', 'water'], answerIdx: 0 }];
    const ok = applyEdit(stored.dropdown, { blanks });
    assert.equal(ok.reason, undefined);
    assert.deepEqual(ok.question.blanks[0], { options: ['carbon dioxide', 'oxygen'], answerIdx: 0 });
    assert.ok(!('accept' in ok.question.blanks[0]), 'a dropdown gap is not handed an empty cloze field');

    assert.equal(applyEdit(stored.dropdown, { blanks: [blanks[0], { options: ['a', 'b'], answerIdx: 2 }] }).reason,
      'a dropdown gap has an answerIdx out of range');
    assert.equal(applyEdit(stored.dropdown, { text: 'One gap only: ____ .' }).reason, 'dropdown needs 2-4 ____ markers in its text');
    assert.equal(applyEdit(stored.dropdown, { blanks: [blanks[0], null] }).reason, 'a dropdown gap is not a gap');
  });

  test('table: a valid edit lands whole; a cell that is both given and blank is refused, not repaired', () => {
    const rows = [
      { header: 'Chloroplast ', cells: [{ given: ' Plants' }, { given: 'Photosynthesis' }] },
      { header: 'Mitochondrion', cells: [{ accept: ['both ', 'plants and animals'] }, { accept: ['respiration'] }] },
    ];
    const ok = applyEdit(stored.table, { rows });
    assert.equal(ok.reason, undefined);
    assert.deepEqual(ok.question.rows[0], { header: 'Chloroplast', cells: [{ given: 'Plants' }, { given: 'Photosynthesis' }] });
    assert.deepEqual(ok.question.rows[1].cells[0], { accept: ['both', 'plants and animals'] });

    const both = [rows[0], { header: 'Mitochondrion', cells: [{ given: 'Both', accept: ['both'] }, { accept: ['respiration'] }] }];
    assert.equal(applyEdit(stored.table, { rows: both }).reason,
      'every table cell is either given or blank, never both and never neither');
    assert.equal(applyEdit(stored.table, { columns: ['Found in'] }).reason, 'table needs 2-4 columns');
    const noBlank = [rows[0], { header: 'Mitochondrion', cells: [{ given: 'Both' }, { given: 'Respiration' }] }];
    assert.equal(applyEdit(stored.table, { rows: noBlank }).reason, 'a table with no blank cells has nothing to answer');
  });

  test('grid: a valid edit lands whole; a board of all ticks, or a short row, is refused', () => {
    const ok = applyEdit(stored.grid, { rows: ['Cell wall', ' Chloroplast'], answers: [[true, false], [true, false]] });
    assert.equal(ok.reason, undefined);
    assert.deepEqual(ok.question.rows, ['Cell wall', 'Chloroplast']);
    assert.equal(ok.question.status, 'draft');

    assert.equal(applyEdit(stored.grid, { answers: [[true, true], [true, true]] }).reason,
      'a grid where every intersection is true asks nothing');
    assert.equal(applyEdit(stored.grid, { answers: [[true], [true, false]] }).reason,
      'every grid answers row needs one true or false per column');
    assert.equal(applyEdit(stored.grid, { rows: ['Cell wall', 'Nucleus', 'Vacuole'] }).reason, 'grid needs one answers row per row');
  });

  test('swapping into one of these kinds inside the level needs that kind\'s payload', () => {
    const cloze = { ...stored.dropdown, kind: 'cloze', blanks: [{ accept: ['carbon dioxide'] }, { accept: ['oxygen'] }] };
    assert.equal(applyEdit(cloze, { kind: 'dropdown' }).reason, 'every dropdown gap needs 2-5 options');
    const swapped = applyEdit(cloze, { kind: 'dropdown', blanks: stored.dropdown.blanks });
    assert.equal(swapped.reason, undefined);
    assert.equal(swapped.question.kind, 'dropdown');
    // Across levels is still refused, by name.
    assert.match(applyEdit(stored.table, { kind: 'grid' }).reason, /cannot cross levels/);
  });
});

describe('the Mongo schema keeps these kinds whole', () => {
  // Built without a database: Mongoose casts and drops on construction, which
  // is exactly where the payloads used to disappear.
  const base = { contentId: '64b7f0c2a1b2c3d4e5f60718', text: 'x', bloom: 'apply', topic: 'T' };
  const kept = (doc) => new Question({ ...base, ...doc }).toObject();

  for (const kind of ['hottext', 'dropdown', 'table', 'grid']) {
    test(`a ${kind} keeps every payload field`, () => {
      const { _id, contentId, status, source, topic, ...payload } = stored[kind];
      const out = kept(payload);
      for (const [k, v] of Object.entries(payload)) assert.deepEqual(out[k], v, k);
    });
  }

  test('a cloze keeps its gaps as they were, and a stimulus survives on any kind', () => {
    const out = kept({ kind: 'cloze', blanks: [{ accept: ['a', 'b'] }], stimulus: { kind: 'passage', text: 'Read this.' } });
    assert.deepEqual(out.blanks, [{ accept: ['a', 'b'] }]);
    assert.deepEqual(out.stimulus, { kind: 'passage', text: 'Read this.' });
  });
});
