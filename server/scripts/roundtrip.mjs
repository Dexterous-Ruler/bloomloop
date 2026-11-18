// Round-trip check for all sixteen question kinds.
// invalidReason -> null, score(correct) -> 1, score(wrong) -> 0, forStudent -> no answer fields.
//
// A poll has no wrong answer to give. Its "wrong" response here is one that is
// not an answer at all - a position off the end of its list - which records
// nothing and scores 0, the nearest honest thing to a wrong answer it has.

import { KINDS, invalidReason, score, forStudent } from 'file:///C:/Users/tanis/wayground/server/src/questionTypes.js';

// `answers` is a grid's whole key. A table's key is `accept` inside its cells,
// already listed, and the deep scan below finds it at any depth.
const FORBIDDEN = [
  'answerBool', 'value', 'tolerance', 'accept', 'rubric', 'sequence',
  'pairs', 'answerIdx', 'answerIdxs', 'buckets', 'blanks', 'answers',
];

// one question of every kind, at a level that legitimately offers it
const Q = {
  mcq: {
    _id: 'q-mcq', bloom: 'remember', kind: 'mcq', topic: 'Cells',
    text: 'Which organelle releases most of a cell’s ATP?',
    options: ['Mitochondrion', 'Ribosome', 'Golgi body', 'Lysosome'],
    answerIdx: 0,
  },
  truefalse: {
    _id: 'q-tf', bloom: 'remember', kind: 'truefalse', topic: 'Cells',
    text: 'Chloroplasts are found in animal cells.',
    answerBool: false,
  },
  match: {
    _id: 'q-match', bloom: 'understand', kind: 'match', topic: 'Cells',
    text: 'Match each organelle with what it does.',
    pairs: [
      { left: 'Mitochondrion', right: 'Releases energy' },
      { left: 'Ribosome', right: 'Builds protein' },
      { left: 'Nucleus', right: 'Holds the DNA' },
    ],
  },
  categorise: {
    _id: 'q-cat', bloom: 'understand', kind: 'categorise', topic: 'Cells',
    text: 'Sort each structure by where it is found.',
    buckets: [
      { name: 'Plant only', items: ['Cell wall', 'Chloroplast'] },
      { name: 'Both', items: ['Nucleus', 'Mitochondrion'] },
    ],
  },
  blank: {
    _id: 'q-blank', bloom: 'apply', kind: 'blank', topic: 'Cells',
    text: 'Water crosses the membrane by ____ .',
    accept: ['osmosis'],
  },
  cloze: {
    _id: 'q-cloze', bloom: 'apply', kind: 'cloze', topic: 'Cells',
    text: 'Photosynthesis takes in ____ and light, and gives out ____ .',
    blanks: [{ accept: ['carbon dioxide', 'CO2'] }, { accept: ['oxygen', 'O2'] }],
  },
  numeric: {
    _id: 'q-num', bloom: 'apply', kind: 'numeric', topic: 'Cells',
    text: 'A cell divides every 20 minutes. How many cells after one hour, starting from one?',
    value: 8, tolerance: 0, unit: 'cells',
  },
  multi: {
    _id: 'q-multi', bloom: 'analyse', kind: 'multi', topic: 'Cells',
    text: 'Which of these would slow respiration in a yeast culture?',
    options: ['Lower temperature', 'More glucose', 'Less oxygen', 'Warmer water', 'More yeast'],
    answerIdxs: [0, 2],
  },
  order: {
    _id: 'q-order', bloom: 'evaluate', kind: 'order', topic: 'Cells',
    text: 'Put the stages of mitosis in order.',
    sequence: ['Prophase', 'Metaphase', 'Anaphase', 'Telophase'],
  },
  rank: {
    _id: 'q-rank', bloom: 'evaluate', kind: 'rank', topic: 'Cells',
    text: 'Rank these by how much they would raise the reaction rate.',
    criterion: 'largest increase in rate first',
    sequence: ['Raising temperature', 'Adding a catalyst', 'Stirring the mixture'],
  },
  open: {
    _id: 'q-open', bloom: 'create', kind: 'open', topic: 'Cells',
    text: 'Design an experiment to show that light affects the rate of photosynthesis.',
    rubric: ['change light intensity', 'measure oxygen bubbles', 'keep temperature constant'],
  },
  hottext: {
    _id: 'q-hot', bloom: 'analyse', kind: 'hottext', topic: 'Cells',
    text: 'Pick out every word in this sentence that names an organelle.',
    tokens: ['The', 'nucleus', 'sends', 'instructions', 'to', 'the', 'ribosome', 'in', 'the', 'cytoplasm.'],
    criterion: 'every word that names an organelle',
    answerIdxs: [1, 6],
  },
  dropdown: {
    _id: 'q-drop', bloom: 'apply', kind: 'dropdown', topic: 'Cells',
    text: 'In daylight a leaf takes in ____ and gives out ____ .',
    blanks: [
      { options: ['carbon dioxide', 'oxygen', 'nitrogen'], answerIdx: 0 },
      { options: ['carbon dioxide', 'oxygen', 'water vapour', 'helium'], answerIdx: 1 },
    ],
  },
  table: {
    _id: 'q-table', bloom: 'apply', kind: 'table', topic: 'Cells',
    text: 'Complete the table. The first row is done for you.',
    columns: ['Found in', 'Job'],
    rows: [
      { header: 'Chloroplast', cells: [{ given: 'Plant cells' }, { given: 'Photosynthesis' }] },
      { header: 'Mitochondrion', cells: [{ given: 'Both' }, { accept: ['respiration', 'releases energy'] }] },
      { header: 'Cell wall', cells: [{ accept: ['plant cells', 'plants'] }, { given: 'Support' }] },
    ],
  },
  grid: {
    _id: 'q-grid', bloom: 'analyse', kind: 'grid', topic: 'Cells',
    text: 'Tick every cell type each structure is found in.',
    rows: ['Cell wall', 'Nucleus', 'Chloroplast'],
    columns: ['Plant', 'Animal'],
    answers: [[true, false], [true, true], [true, false]],
  },
  poll: {
    _id: 'q-poll', bloom: 'understand', kind: 'poll', topic: 'Cells',
    text: 'How sure are you about the difference between plant and animal cells?',
    options: ['Very sure', 'Fairly sure', 'Not sure yet'],
  },
};

// a fully correct response, and a fully wrong one, per kind
const RIGHT = {
  mcq: 0,
  truefalse: false,
  match: [0, 1, 2],
  categorise: { 0: 0, 1: 0, 2: 1, 3: 1 },
  blank: 'Osmosis',
  cloze: ['carbon dioxide', 'oxygen'],
  numeric: '8',
  multi: [0, 2],
  order: [0, 1, 2, 3],
  rank: [0, 1, 2],
  open: 'I would change the light intensity, measure the oxygen bubbles given off, and keep the temperature constant throughout.',
  hottext: [1, 6],
  // table and grid are addressed by real coordinates, never shuffled.
  table: { '1:1': 'Respiration', '2:0': 'plants' },
  grid: { '0:0': true, '1:0': true, '1:1': true, '2:0': true },
  poll: 1,
};

const WRONG = {
  mcq: 2,
  truefalse: true,
  match: [1, 2, 0],          // full derangement: no pair lands on itself
  categorise: { 0: 1, 1: 1, 2: 0, 3: 0 },
  blank: 'diffusion of salt',
  cloze: ['nitrogen', 'helium'],
  numeric: '3',
  multi: [1, 3],             // only distractors
  order: [3, 2, 1, 0],       // exact reverse
  rank: [2, 1, 0],
  open: 'banana',
  hottext: [0, 2],           // only words that are not organelles
  table: { '1:1': 'photosynthesis', '2:0': 'animal cells' },
  grid: { '0:1': true, '2:1': true }, // every false cell and no true one
  poll: 3,                   // off the end of a three-option list: not an answer
};

// deep scan: a forbidden key nested inside an item is still a leak
function leaks(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => leaks(v, `${path}[${i}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.includes(k)) found.push(`${path}.${k}`);
      leaks(v, `${path}.${k}`, found);
    }
  }
  return found;
}

const rows = [];
let failures = 0;

for (const kind of KINDS) {
  const q = Q[kind];
  const row = { kind, valid: '', right: '', wrong: '', student: '', notes: [] };

  if (!q) {
    row.valid = 'NO FIXTURE';
    failures += 1;
    rows.push(row);
    continue;
  }


const SEED = 'student-42';

/**
 * Build the correct response the way the phone would: read what was actually
 * shown, find each item in it, and answer in SHOWN positions. Hard-coding
 * original indices tested a protocol the server deliberately no longer speaks.
 */
function rightFor(kind, q) {
  const view = forStudent(q, SEED);
  if (kind === 'order' || kind === 'rank') return q.sequence.map((t) => view.items.indexOf(t));
  if (kind === 'match') return q.pairs.map((p) => view.right.indexOf(p.right));
  if (kind === 'categorise') {
    const out = {};
    view.items.forEach((t, pos) => { out[pos] = q.buckets.findIndex((b) => b.items.includes(t)); });
    return out;
  }
  // Each gap is shuffled on its own seed, so the answer is the shown position
  // of the right word in that gap's own list.
  if (kind === 'dropdown') return q.blanks.map((b, i) => view.gaps[i].options.indexOf(b.options[b.answerIdx]));
  return RIGHT[kind];
}

/** A genuinely wrong answer, still expressed in shown positions. */
function wrongFor(kind, q) {
  const r = rightFor(kind, q);
  if (kind === 'order' || kind === 'rank') return r.slice().reverse();
  if (kind === 'match') return r.map((_, i) => r[(i + 1) % r.length]);
  if (kind === 'categorise') {
    const groups = q.buckets.length;
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (Number(v) + 1) % groups]));
  }
  // The next shown option along at every gap, which is never the right one.
  if (kind === 'dropdown') return r.map((pos, i) => (pos + 1) % q.blanks[i].options.length);
  return WRONG[kind];
}

  // 1. invalidReason -> null
  let reason;
  try {
    reason = invalidReason(q);
  } catch (err) {
    reason = `threw: ${err.message}`;
  }
  row.valid = reason === null ? 'PASS' : 'FAIL';
  if (reason !== null) {
    failures += 1;
    row.notes.push(`invalid: ${reason}`);
  }

  // 2. score(correct) -> 1
  try {
    const s = score(q, rightFor(kind, q), SEED);
    row.right = s.score === 1 ? 'PASS' : `FAIL ${s.score}`;
    if (s.score !== 1) {
      failures += 1;
      row.notes.push(`correct scored ${s.score}`);
    }
  } catch (err) {
    row.right = 'THREW';
    failures += 1;
    row.notes.push(`score(right) threw: ${err.message}`);
  }

  // 3. score(wrong) -> 0
  try {
    const s = score(q, wrongFor(kind, q), SEED);
    row.wrong = s.score === 0 ? 'PASS' : `FAIL ${s.score}`;
    if (s.score !== 0) {
      failures += 1;
      row.notes.push(`wrong scored ${s.score}`);
    }
  } catch (err) {
    row.wrong = 'THREW';
    failures += 1;
    row.notes.push(`score(wrong) threw: ${err.message}`);
  }

  // 4. forStudent leaks nothing
  try {
    const view = forStudent(q, SEED);
    const bad = leaks(view);
    row.student = bad.length === 0 ? 'PASS' : 'LEAK';
    if (bad.length) {
      failures += 1;
      row.notes.push(`leaks ${bad.join(', ')}`);
    }
  } catch (err) {
    row.student = 'THREW';
    failures += 1;
    row.notes.push(`forStudent threw: ${err.message}`);
  }

  rows.push(row);
}

const w = (s, n) => String(s).padEnd(n);
const line = `+${'-'.repeat(13)}+${'-'.repeat(9)}+${'-'.repeat(11)}+${'-'.repeat(9)}+${'-'.repeat(13)}+`;
console.log(line);
console.log(`| ${w('kind', 11)} | ${w('valid', 7)} | ${w('score(1)', 9)} | ${w('score(0)', 7)} | ${w('forStudent', 11)} |`);
console.log(line);
for (const r of rows) {
  console.log(`| ${w(r.kind, 11)} | ${w(r.valid, 7)} | ${w(r.right, 9)} | ${w(r.wrong, 7)} | ${w(r.student, 11)} |`);
}
console.log(line);

const noted = rows.filter((r) => r.notes.length);
if (noted.length) {
  console.log('\ndetail:');
  for (const r of noted) for (const n of r.notes) console.log(`  ${r.kind}: ${n}`);
}

console.log(`\nkinds: ${KINDS.length}   checks: ${KINDS.length * 4}   failures: ${failures}`);

// what the phone actually receives, so a leak can be read rather than trusted
if (process.argv.includes('--dump')) {
  console.log('\nforStudent payloads:');
  for (const kind of KINDS) {
    console.log(`\n${kind}:`, JSON.stringify(forStudent(Q[kind], 'student-42')));
  }
}

process.exit(failures ? 1 : 0);
