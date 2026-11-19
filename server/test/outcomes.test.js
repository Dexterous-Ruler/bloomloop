// Phase 4: course outcomes, which evidence belongs to which, and the roster
// import from CSV.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { parseCsv } from '../src/services/csv.js';
import {
  MAX_CLASS_SIZE,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  REFUSAL,
  addToRoster,
  rosterFromCsv,
  validateRoster,
} from '../src/services/roster.js';
import {
  MAX_STATEMENT,
  VIA,
  chapterMap,
  outcomeCoverage,
  outcomeFields,
  outcomeIndex,
  overrideFrom,
  resolveAnswer,
  topicKey,
  topicLinksFrom,
} from '../src/services/outcomes.js';

const status = (code, fn, match) => assert.throws(fn, (err) => err.status === code && (!match || match.test(err.message)));
const cells = (csv) => parseCsv(csv).records.map((r) => r.cells);

/* ------------------------------------------------------------ the parser -- */

describe('parseCsv: what spreadsheets write', () => {
  test('a UTF-8 byte-order mark is dropped, CRLF ends a record, and each record says its line', () => {
    const { delimiter, records } = parseCsv('﻿Roll,Name\r\n21CS01,Asha\r\n21CS02,Bilal\r\n');
    assert.equal(delimiter, ',');
    assert.deepEqual(records, [
      { line: 1, cells: ['Roll', 'Name'] }, { line: 2, cells: ['21CS01', 'Asha'] }, { line: 3, cells: ['21CS02', 'Bilal'] }]);
  });

  test('LF and a lone CR end records too, and a missing last line break loses nothing', () => {
    assert.deepEqual(cells('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(cells('a,b\rc,d\r'), [['a', 'b'], ['c', 'd']]);
  });

  test('a quoted field keeps its commas, and "" inside it is one quote', () => {
    assert.deepEqual(cells('roll,name\n21CS01,"Rao, Asha ""Ash"""\n'), [['roll', 'name'], ['21CS01', 'Rao, Asha "Ash"']]);
  });

  test('a line break inside quotes stays in the cell, and the next record\'s line counts it', () => {
    const { records } = parseCsv('roll,name\r\n21CS01,"Asha\r\nRao"\r\n21CS02,Bilal\r\n');
    assert.deepEqual(records.map((r) => [r.line, r.cells]), [[1, ['roll', 'name']], [2, ['21CS01', 'Asha\r\nRao']], [4, ['21CS02', 'Bilal']]]);
  });

  test('spaces before an opening quote are padding', () => {
    assert.deepEqual(cells('roll, name\n21CS01, "Rao, Asha"\n'), [['roll', ' name'], ['21CS01', 'Rao, Asha']]);
  });

  test('semicolons (Excel where the decimal mark is a comma) and tabs are told from the header', () => {
    assert.equal(parseCsv('Roll No;Name;Phone\n1;Asha, R;98450\n').delimiter, ';');
    assert.deepEqual(cells('Roll No;Name\n1;Asha, R\n'), [['Roll No', 'Name'], ['1', 'Asha, R']]);
    assert.equal(parseCsv('Roll\tName\n1\tAsha\n').delimiter, '\t');
    assert.deepEqual(cells('Roll\tName\n1\tRao, Asha\n'), [['Roll', 'Name'], ['1', 'Rao, Asha']]);
  });

  test('a delimiter inside a quoted header cell does not count towards choosing one', () => {
    assert.equal(parseCsv('"Roll; No; (as; given)","Name; full",x\n').delimiter, ',');
  });

  test('a quote that never closes is a 400 naming its line', () => {
    status(400, () => parseCsv('roll,name\n21CS01,Asha\n21CS02,"Bilal\n21CS03,Chitra\n'), /Line 3 opens a quote that never closes/);
  });

  // One import runs on the server's only event loop, so a file shaped to make
  // the reader quadratic would stall every live room. These are the shapes that
  // did (blank lines before any text; a cell followed by quote after quote): a
  // small one first, so a quadratic reader fails in seconds, not minutes, then
  // the largest body the route accepts. Generous bounds: linear reads take ms.
  test('reading is linear: adversarial files up to the 1 MB limit are read in well under a second', () => {
    const shapes = {
      'blank lines (CRLF) before any text': (n) => `${'\r\n'.repeat(Math.floor(n / 2))}x`,
      'blank lines (LF) before any text': (n) => `${'\n'.repeat(n)}x`,
      'a cell, then quote after quote': (n) => `roll,name\n1,x${'"'.repeat(n)}`,
      'spaces, a letter, then quote after quote': (n) => `roll,name\n1,${' '.repeat(Math.floor(n / 2))}x${'"'.repeat(Math.floor(n / 2))}`,
    };
    for (const [shape, make] of Object.entries(shapes)) {
      for (const [size, limitMs] of [[64 * 1024, 300], [MAX_CSV_BYTES - 64, 1500]]) {
        const text = make(size);
        const start = process.hrtime.bigint();
        try { rosterFromCsv(text); } catch (err) { assert.equal(err.status, 400, `${shape}: ${err.message}`); }
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        assert.ok(ms < limitMs, `${shape}, ${text.length} characters: ${ms.toFixed(0)} ms (at most ${limitMs})`);
      }
    }
  });
});

/* ------------------------------------------------------- the roster file -- */

describe('rosterFromCsv: a class list read for its roll numbers and names only', () => {
  test('the header is found in any case and spelling, and every other column is named back, not read', () => {
    for (const header of ['Roll No.,Student Name,Phone,Email', 'ROLLNO,NAME,Phone,Email', 'roll_number,name,Phone,Email',
      'Roll Number , Student  Name ,Phone,Email', 'roll,name,Phone,Email']) {
      const csv = rosterFromCsv(`${header}\n21CS01,Asha Rao,9845012345,asha@example.com\n`);
      assert.deepEqual(csv.rows, [{ line: 2, roll: '21CS01', name: 'Asha Rao' }], header);
      assert.deepEqual(csv.ignoredColumns, ['Phone', 'Email'], header);
      assert.equal(JSON.stringify(csv.rows).includes('9845012345'), false, 'the phone number is never read into a row');
    }
  });

  test('the two columns may be anywhere, a column with no header is named by its place, and so are cells past the header', () => {
    const csv = rosterFromCsv('S.No,Name,,Roll No\n1,Asha,x,21CS01\n2,Bilal,,21CS02,extra\n');
    assert.deepEqual(csv.rows.map((r) => [r.roll, r.name]), [['21CS01', 'Asha'], ['21CS02', 'Bilal']]);
    assert.deepEqual(csv.ignoredColumns, ['S.No', 'column 3 (no header)', 'cells past the last named column']);
    assert.deepEqual(csv.columns, { roll: 'Roll No', name: 'Name', under18: null, all: ['S.No', 'Name', '', 'Roll No'] });
  });

  // Decision 8 (19 Nov 2026): one more column is read when the file has it.
  test('an under-18 column is read as yes or no; a date of birth never is', () => {
    const csv = rosterFromCsv('Roll No,Name,Under 18,DOB\n21CS01,Asha,yes,2008-05-12\n21CS02,Bilal,,2004-01-02\n21CS03,Chitra,maybe,\n');
    assert.deepEqual(csv.rows.map((r) => [r.roll, r.under18]), [['21CS01', 'yes'], ['21CS02', ''], ['21CS03', 'maybe']]);
    assert.equal(csv.columns.under18, 'Under 18');
    assert.deepEqual(csv.ignoredColumns, ['DOB']);
    assert.equal(JSON.stringify(csv.rows).includes('2008'), false, 'the date of birth is never read into a row');
    for (const header of ['under18', 'MINOR', 'below_18']) {
      assert.equal(rosterFromCsv(`roll,name,${header}\n1,A,y\n`).rows[0].under18, 'y', header);
    }
    status(400, () => rosterFromCsv('Roll,Name,Under 18,Minor\n1,A,y,n\n'), /2 under-18 columns/);
    // Without the column a row carries no mark at all, and adds as not under 18.
    assert.equal('under18' in rosterFromCsv('roll,name\n1,A\n').rows[0], false);
  });

  test('blank lines are skipped and counted, before the header too, and every row keeps its line', () => {
    const csv = rosterFromCsv('\r\n\r\nRoll,Name\r\n21CS01,Asha\r\n,\r\n\r\n21CS02,Bilal\r\n');
    assert.deepEqual(csv.rows.map((r) => r.line), [4, 7]);
    assert.equal(csv.blankLines, 2);
  });

  test('a short row is read with what it has: a missing name is for the roster check to refuse', () => {
    assert.deepEqual(rosterFromCsv('roll,name\n21CS01\n').rows, [{ line: 2, roll: '21CS01', name: '' }]);
  });

  test('a file the import cannot read is refused whole, saying why', () => {
    status(400, () => rosterFromCsv(''), /empty/);
    status(400, () => rosterFromCsv(undefined), /empty/);
    status(400, () => rosterFromCsv('21CS01,Asha Rao\n21CS02,Bilal\n'), /Line 1 must name the columns.*It names "21CS01", "Asha Rao"/);
    status(400, () => rosterFromCsv('Roll,Phone\n1,2\n'), /name column/);
    status(400, () => rosterFromCsv('Name,Phone\nA,2\n'), /roll number column/);
    status(400, () => rosterFromCsv('Roll,Roll No,Name\n1,1,A\n'), /2 roll number columns \("Roll", "Roll No"\)/);
    status(400, () => rosterFromCsv('Roll,Name\n\n'), /no students under them/);
  });

  test(`at most ${MAX_CSV_ROWS} rows and ${MAX_CSV_BYTES} bytes`, () => {
    const rows = (n) => `Roll,Name\n${Array.from({ length: n }, (_, i) => `R${i},N`).join('\n')}\n`;
    assert.equal(rosterFromCsv(rows(MAX_CSV_ROWS)).rows.length, MAX_CSV_ROWS);
    status(400, () => rosterFromCsv(rows(MAX_CSV_ROWS + 1)), /2001 rows; 2000 is the most/);
    status(413, () => rosterFromCsv(`Roll,Name\n1,${'a'.repeat(MAX_CSV_BYTES)}\n`), /larger than 1 MB/);
  });
});

describe('the roster check the JSON list and the CSV import share', () => {
  const student = (_id, rollNo, name, removedAt = null) => ({ _id, classId: 'c1', rollNo, name, removedAt });

  test('every refusal carries a code beside its sentence, so duplicates and removed students can be listed apart', () => {
    const existing = [student('a', '21CS01', 'Asha'), student('b', '21CS02', 'Bilal', '2026-11-19T10:00:00.000Z')];
    const { refused } = validateRoster([
      { roll: '21cs01', name: 'A' }, { roll: '21CS02', name: 'B' }, { roll: '21CS03', name: 'C' }, { roll: '21CS03', name: 'C2' },
      { roll: '', name: 'D' }, { roll: '#1', name: 'E' }, { roll: '21CS04', name: 'x@y.in' }, 'not a row',
    ], existing);
    assert.deepEqual(refused.map((r) => [r.index, r.code]), [
      [0, REFUSAL.onRoster], [1, REFUSAL.removed], [3, REFUSAL.repeated], [4, REFUSAL.noRoll], [5, REFUSAL.badRoll],
      [6, REFUSAL.badName], [7, REFUSAL.notARow]]);
  });

  test('the under-18 mark: a boolean, or yes / no text from a file; anything else refuses the row with a reason', () => {
    const { accepted, refused } = validateRoster([
      { roll: 'A1', name: 'A', under18: true }, { roll: 'A2', name: 'B', under18: 'Yes' }, { roll: 'A3', name: 'C', under18: 'n' },
      { roll: 'A4', name: 'D' }, { roll: 'A5', name: 'E', under18: '' }, { roll: 'A6', name: 'F', under18: 'maybe' },
      { roll: 'A7', name: 'G', under18: 17 },
    ]);
    assert.deepEqual(accepted.map((a) => [a.rollNo, a.under18]), [['A1', true], ['A2', true], ['A3', false], ['A4', false], ['A5', false]]);
    assert.deepEqual(refused.map((r) => [r.index, r.code]), [[5, REFUSAL.badUnder18], [6, REFUSAL.badUnder18]]);
    assert.match(refused[0].reason, /must be yes or no/);
  });

  test('a longer request is allowed when the caller says so, and rows past the class\'s room are refused one by one', () => {
    const list = Array.from({ length: MAX_CLASS_SIZE + 2 }, (_, i) => ({ roll: `R${i}`, name: 'N' }));
    status(400, () => validateRoster(list), /most one request may add/);
    const { accepted, refused } = validateRoster(list, [], { maxRows: MAX_CSV_ROWS });
    assert.equal(accepted.length, MAX_CLASS_SIZE);
    assert.deepEqual(refused.map((r) => [r.index, r.code]), [[MAX_CLASS_SIZE, REFUSAL.full], [MAX_CLASS_SIZE + 1, REFUSAL.full]]);
  });

  test('addToRoster writes exactly what the check accepted, and reports the roster as it read it', async () => {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ courseName: 'N', section: 'B' });
    await repo.addClassStudents(cls._id, [{ rollNo: '01', name: 'A' }]);
    const out = await addToRoster(repo, cls._id, [{ roll: '01', name: 'Again' }, { roll: '02', name: 'B' }, { roll: '02', name: 'B2' }]);
    assert.deepEqual(out.made.map((s) => s.rollNo), ['02']);
    assert.deepEqual(out.refused.map((r) => [r.index, r.code]), [[0, REFUSAL.onRoster], [2, REFUSAL.repeated]]);
    assert.deepEqual(out.roster.map((s) => s.rollNo), ['01'], 'the roster before the write');
    assert.deepEqual((await repo.listClassStudents(cls._id)).map((s) => s.rollNo), ['01', '02']);
  });
});

/* ---------------------------------------------------------- the outcomes -- */

describe('a course outcome\'s fields', () => {
  test('the code is a short label, stored trimmed, single-spaced and upper case', () => {
    assert.equal(outcomeFields({ code: ' co  1 ', statement: 'S' }).code, 'CO 1');
    assert.equal(outcomeFields({ code: 'cs301.2', statement: 'S' }).code, 'CS301.2');
    for (const bad of ['', '   ', '#1', '-CO1', 'C'.repeat(17), 7, null]) {
      status(400, () => outcomeFields({ code: bad, statement: 'S' }), /code/);
    }
  });

  test('the statement is required, single-spaced, at most 300 characters, and holds no email or phone number', () => {
    assert.equal(outcomeFields({ code: 'CO1', statement: '  Explain   TCP  ' }).statement, 'Explain TCP');
    status(400, () => outcomeFields({ code: 'CO1' }), /statement is required/);
    status(400, () => outcomeFields({ code: 'CO1', statement: 's'.repeat(MAX_STATEMENT + 1) }), /longer than 300/);
    assert.equal(outcomeFields({ code: 'CO1', statement: 's'.repeat(MAX_STATEMENT) }).statement.length, MAX_STATEMENT);
    status(400, () => outcomeFields({ code: 'CO1', statement: 'Ask hod@college.in' }), /email address or a phone number/);
    status(400, () => outcomeFields({ code: 'CO1', statement: 'Call 98450 12345' }), /email address or a phone number/);
  });

  test('the target level is one of the six, British spelling, or none', () => {
    assert.equal(outcomeFields({ code: 'CO1', statement: 'S' }).targetLevel, null);
    assert.equal(outcomeFields({ code: 'CO1', statement: 'S', targetLevel: ' Analyse ' }).targetLevel, 'analyse');
    assert.equal(outcomeFields({ code: 'CO1', statement: 'S', targetLevel: null }).targetLevel, null);
    status(400, () => outcomeFields({ code: 'CO1', statement: 'S', targetLevel: 'analyze' }), /targetLevel/);
    status(400, () => outcomeFields({ code: 'CO1', statement: 'S', targetLevel: 3 }), /targetLevel/);
  });

  test('an edit carries only what was sent, and must send something', () => {
    assert.deepEqual(outcomeFields({ statement: 'New' }, { partial: true }), { statement: 'New' });
    assert.deepEqual(outcomeFields({ targetLevel: null }, { partial: true }), { targetLevel: null });
    status(400, () => outcomeFields({}, { partial: true }), /Send code, statement or targetLevel/);
  });
});

describe('an outcome\'s topics and a question\'s override, off a body', () => {
  const C = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  test('topics: chapter and topic, weight 1 unless given, a topic once per chapter whatever its case or spacing', () => {
    assert.deepEqual(topicLinksFrom([{ contentId: C.toUpperCase(), topic: '  TCP   handshake ' }, { contentId: C, topic: 'UDP', weight: 2.5 }]),
      [{ contentId: C, topic: 'TCP handshake', weight: 1 }, { contentId: C, topic: 'UDP', weight: 2.5 }]);
    assert.equal(topicLinksFrom([{ contentId: C, topic: 'T', weight: 1.23456 }])[0].weight, 1.235);
    assert.deepEqual(topicLinksFrom([]), []);
    status(400, () => topicLinksFrom([{ contentId: C, topic: 'TCP' }, { contentId: C, topic: 'tcp ' }]), /same topic/);
    for (const weight of [0, -1, 100.1, '2', Number.NaN, 0.0001]) {
      status(400, () => topicLinksFrom([{ contentId: C, topic: 'T', weight }]), /weight/);
    }
    status(400, () => topicLinksFrom([{ contentId: 'nope', topic: 'T' }]), /contentId/);
    status(400, () => topicLinksFrom([{ contentId: C, topic: '  ' }]), /topic is required/);
    status(400, () => topicLinksFrom({}), /must be a list/);
  });

  test('an override maps to some outcomes or excludes, one or the other', () => {
    assert.deepEqual(overrideFrom({ exclude: true }), { excluded: true, outcomeIds: [] });
    assert.deepEqual(overrideFrom({ outcomeIds: [C, C.toUpperCase(), 'b'.repeat(24)] }), { excluded: false, outcomeIds: [C, 'b'.repeat(24)] });
    status(400, () => overrideFrom({}), /outcomeIds.*exclude/);
    status(400, () => overrideFrom({ exclude: true, outcomeIds: [C] }), /outcomeIds.*exclude/);
    status(400, () => overrideFrom({ exclude: false }), /DELETE/);
    status(400, () => overrideFrom({ outcomeIds: [] }), /at least one/);
    status(400, () => overrideFrom({ outcomeIds: ['x'] }), /not a valid id/);
  });
});

/* ------------------------------------------------------------ resolution -- */

describe('resolveAnswer: one answer to its course outcomes, and why', () => {
  const CH = 'c0000000000000000000000a';
  const OTHER = 'c0000000000000000000000b';
  const outcomes = [
    { _id: 'o1', code: 'CO1', position: 1 }, { _id: 'o2', code: 'CO2', position: 2 }, { _id: 'o3', code: 'CO3', position: 3 }];
  const links = [
    { outcomeId: 'o2', contentId: CH, topic: 'Routing', weight: 1 },
    { outcomeId: 'o1', contentId: CH, topic: 'Routing', weight: 2 },
    { outcomeId: 'o3', contentId: CH, topic: 'Old name', weight: 1 },
  ];
  const questions = [{ _id: 'q1', contentId: CH, topic: 'Routing' }, { _id: 'q2', contentId: CH, topic: 'Routing' }];
  const index = (overrides = [], qs = questions) => outcomeIndex({ outcomes, links, overrides, questions: qs });

  test('through its topic, in its chapter, to every outcome the topic maps to, in the class\'s order, with their weights', () => {
    const r = resolveAnswer({ questionId: 'q1', contentId: CH, topic: 'Routing' }, index());
    assert.equal(r.via, VIA.topic);
    assert.deepEqual(r.outcomes, [{ id: 'o1', weight: 2 }, { id: 'o2', weight: 1 }]);
    assert.equal(r.topic, 'Routing');
    assert.equal(r.topicFrom, 'question');
  });

  test('a topic is matched ignoring case and runs of spaces, and only in its own chapter', () => {
    assert.equal(resolveAnswer({ questionId: 'gone', contentId: CH, topic: '  routing ' }, index()).via, VIA.topic);
    const other = resolveAnswer({ questionId: 'gone', contentId: OTHER, topic: 'Routing' }, index());
    assert.equal(other.via, VIA.unmapped, 'the same name in another chapter is another topic');
  });

  test('a question\'s override beats its topic: mapped straight to its outcomes, weight 1', () => {
    const r = resolveAnswer({ questionId: 'q1', contentId: CH, topic: 'Routing' }, index([{ questionId: 'q1', outcomeIds: ['o3'], excluded: false }]));
    assert.equal(r.via, VIA.question);
    assert.deepEqual(r.outcomes, [{ id: 'o3', weight: 1 }]);
    const other = resolveAnswer({ questionId: 'q2', contentId: CH, topic: 'Routing' }, index([{ questionId: 'q1', outcomeIds: ['o3'] }]));
    assert.equal(other.via, VIA.topic, 'and only for that question');
  });

  test('an excluded question reaches no outcome, and says it was excluded rather than unmapped', () => {
    const r = resolveAnswer({ questionId: 'q1', contentId: CH, topic: 'Routing' }, index([{ questionId: 'q1', outcomeIds: [], excluded: true }]));
    assert.equal(r.via, VIA.excluded);
    assert.deepEqual(r.outcomes, []);
  });

  test('a deleted question\'s answers: the override still holds through the id kept in the snapshot', () => {
    const answer = { questionId: null, questionSnapshot: { id: 'q1', topic: 'Routing' }, contentId: CH, topic: 'Routing' };
    const r = resolveAnswer(answer, index([{ questionId: 'q1', outcomeIds: ['o3'] }], []));
    assert.equal(r.via, VIA.question);
    assert.equal(r.questionId, 'q1');
  });

  test('a renamed topic: once the question is gone, the topic frozen on the answer decides', () => {
    // The chapter now calls it something else; the answer was given under 'Old name'.
    const r = resolveAnswer({ questionId: null, questionSnapshot: { id: 'q9' }, contentId: CH, topic: 'Old name' }, index([], []));
    assert.equal(r.via, VIA.topic);
    assert.deepEqual(r.outcomes, [{ id: 'o3', weight: 1 }]);
    assert.equal(r.topicFrom, 'answer');
  });

  test('while the question exists its topic is tried first, then the answer\'s', () => {
    const renamed = [{ _id: 'q1', contentId: CH, topic: 'Routing' }];
    const viaQuestion = resolveAnswer({ questionId: 'q1', contentId: CH, topic: 'Old name' }, index([], renamed));
    assert.deepEqual([viaQuestion.via, viaQuestion.topicFrom, viaQuestion.topic], [VIA.topic, 'question', 'Routing']);
    const unmappedNow = [{ _id: 'q1', contentId: CH, topic: 'Brand new' }];
    const viaAnswer = resolveAnswer({ questionId: 'q1', contentId: CH, topic: 'Old name' }, index([], unmappedNow));
    assert.deepEqual([viaAnswer.via, viaAnswer.topicFrom, viaAnswer.topic], [VIA.topic, 'answer', 'Old name']);
  });

  test('unmapped: no outcome, and the topic it carries, so a report can say what to map', () => {
    const r = resolveAnswer({ questionId: 'q5', contentId: CH, topic: 'Switching' }, index());
    assert.deepEqual([r.via, r.outcomes, r.topic, r.topicFrom, r.contentId], [VIA.unmapped, [], 'Switching', 'answer', CH]);
    const untagged = resolveAnswer({ questionId: 'q5', contentId: CH, topic: '' }, index());
    assert.deepEqual([untagged.via, untagged.topic, untagged.topicFrom], [VIA.unmapped, '', null]);
  });

  test('the chapter is the one frozen on the answer, else its question\'s', () => {
    const r = resolveAnswer({ questionId: 'q1', topic: 'Routing' }, index());
    assert.equal(r.contentId, CH);
    assert.equal(r.via, VIA.topic);
  });

  test('topicKey is the rule the chapter\'s own list de-duplicates by', () => {
    assert.equal(topicKey('  TCP   Handshake '), 'tcp handshake');
  });
});

describe('outcomeCoverage: how much evidence each outcome has, and what reaches none', () => {
  const CH = 'c0000000000000000000000a';
  const outcomes = [
    { _id: 'o1', code: 'CO1', statement: 'One', position: 1 },
    { _id: 'o2', code: 'CO2', statement: 'Two', position: 2 },
    { _id: 'o3', code: 'CO3', statement: 'Three', position: 3 },
    { _id: 'o4', code: 'CO4', statement: 'Four', position: 4, archivedAt: '2026-11-19T10:00:00.000Z' },
  ];
  const links = [
    { outcomeId: 'o1', contentId: CH, topic: 'Layers', weight: 1 },
    { outcomeId: 'o4', contentId: CH, topic: 'Layers', weight: 1 },
    { outcomeId: 'o2', contentId: CH, topic: 'Routing', weight: 1 },
  ];
  const questions = [
    { _id: 'qa', contentId: CH, topic: 'Layers', status: 'active' },
    { _id: 'qb', contentId: CH, topic: 'Layers', status: 'active' },
    { _id: 'qc', contentId: CH, topic: 'Routing', status: 'draft' },
    { _id: 'qd', contentId: CH, topic: 'Switching', status: 'active' },
    { _id: 'qe', contentId: CH, topic: 'Layers', status: 'active' },
  ];
  const overrides = [{ questionId: 'qb', outcomeIds: ['o3'], excluded: false }, { questionId: 'qe', outcomeIds: [], excluded: true }];
  const answer = (rollNo, questionId, topic, extra = {}) => ({ rollNo, questionId, contentId: CH, topic, final: true, ungraded: false, ...extra });
  const answers = [
    answer('01', 'qa', 'Layers'), answer('02', 'qa', 'Layers'), answer('01', 'qa', 'Layers', { final: false }),
    answer('01', 'qb', 'Layers'), answer('03', 'qd', 'Switching'), answer('03', 'qe', 'Layers'),
    answer('04', 'qp', 'Layers', { ungraded: true }),
  ];
  const report = outcomeCoverage({
    outcomes, links, overrides, questions, answers,
    chapters: chapterMap([{ _id: CH, title: 'Networks', topics: ['Layers', 'Routing'] }]),
  });
  const of = (code) => report.outcomes.find((o) => o.code === code);

  test('per outcome and topic: approved questions and counted answers, with the students behind them', () => {
    const co1 = of('CO1');
    assert.deepEqual(co1.topics.map((t) => [t.topic, t.chapter, t.inChapter, t.questions, t.answers]), [['Layers', 'Networks', true, 1, 2]]);
    assert.deepEqual([co1.questions, co1.answers, co1.students, co1.evidence], [1, 2, 2, 'answers']);
    assert.match(co1.summary, /2 answers from 2 students/);
  });

  test('what an override maps straight to an outcome is counted under `direct`', () => {
    assert.deepEqual(of('CO3').direct, { questions: 1, answers: 1 });
    assert.deepEqual([of('CO3').answers, of('CO3').evidence], [1, 'answers']);
  });

  test('an outcome whose topics have only a draft and no answers has no evidence, and says so', () => {
    assert.deepEqual([of('CO2').questions, of('CO2').answers, of('CO2').evidence], [0, 0, 'none']);
    assert.match(of('CO2').summary, /no approved question and no answer/);
  });

  test('an archived outcome is still counted, and listed after the rest, marked', () => {
    assert.deepEqual(report.outcomes.map((o) => o.code), ['CO1', 'CO2', 'CO3', 'CO4']);
    assert.equal(of('CO4').archived, true);
    assert.equal(of('CO4').answers, 2);
  });

  test('every counted answer is mapped, excluded or unmapped: they add up, and polls and retried attempts are not counted', () => {
    assert.deepEqual(report.answers, { counted: 5, mapped: 3, excluded: 1, unmapped: 1 });
    assert.equal(report.answers.mapped + report.answers.excluded + report.answers.unmapped, report.answers.counted);
    assert.deepEqual(report.excluded, { questions: 1, answers: 1 });
    assert.deepEqual(report.unmapped, [{ contentId: CH, chapter: 'Networks', topic: 'Switching', inChapter: false, questions: 1, answers: 1 }]);
  });
});

/* ----------------------------------------------------------- the store -- */

describe('course outcomes in the in-process store (as in Postgres and Mongo)', () => {
  test('one code per class among outcomes not archived; archiving frees it; restoring over it is a 409', async () => {
    const repo = createMemoryRepo();
    const a = await repo.createOutcome({ classId: 'k1', code: 'CO1', statement: 'S', position: 1 });
    await assert.rejects(repo.createOutcome({ classId: 'k1', code: 'CO1', statement: 'T', position: 2 }), (e) => e.status === 409);
    await repo.createOutcome({ classId: 'k2', code: 'CO1', statement: 'Another class', position: 1 });
    await repo.updateOutcome(a._id, { archivedAt: '2026-11-19T10:00:00.000Z' });
    const b = await repo.createOutcome({ classId: 'k1', code: 'CO1', statement: 'New', position: 2 });
    await assert.rejects(repo.updateOutcome(a._id, { archivedAt: null }), (e) => e.status === 409);
    await assert.rejects(repo.createOutcome({ classId: 'k1', code: 'CO2', statement: 'S', position: 3 })
      .then((c) => repo.updateOutcome(c._id, { code: 'CO1' })), (e) => e.status === 409);
    assert.deepEqual((await repo.listOutcomes('k1')).map((o) => [o.code, Boolean(o.archivedAt)]), [['CO1', true], ['CO1', false], ['CO2', false]]);
    assert.equal((await repo.getOutcome(b._id)).statement, 'New');
  });

  test('setting an outcome\'s topics replaces them: kept rows stay, new ones are added, the rest removed', async () => {
    const repo = createMemoryRepo();
    const o = await repo.createOutcome({ classId: 'k1', code: 'CO1', statement: 'S', position: 1 });
    const first = await repo.setOutcomeTopics(o._id, 'k1', [{ contentId: 'c1', topic: 'Layers', weight: 1 }, { contentId: 'c1', topic: 'UDP', weight: 1 }]);
    const layers = first.find((l) => l.topic === 'Layers');
    const second = await repo.setOutcomeTopics(o._id, 'k1', [{ contentId: 'c1', topic: 'layers', weight: 3 }, { contentId: 'c2', topic: 'TCP', weight: 1 }]);
    assert.deepEqual(second.map((l) => [l.contentId, l.topic, l.weight]).sort(), [['c1', 'layers', 3], ['c2', 'TCP', 1]]);
    assert.equal(second.find((l) => l.contentId === 'c1')._id, layers._id, 'the same topic keeps its row');
    assert.equal((await repo.listOutcomeTopics('k1')).length, 2);
    await repo.deleteOutcome(o._id);
    assert.deepEqual(await repo.listOutcomeTopics('k1'), [], 'deleting an outcome takes its topics');
  });

  // Not a database test: no Supabase is reachable from here. This pins the
  // requests the Supabase repo sends, against the names 0019 gives.
  test('the Supabase repo\'s requests: columns as 0019 names them, a code clash as 409, a topic set by difference', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const replies = [];
    const CLASS = '11111111-1111-4111-8111-111111111111';
    const OUT = '22222222-2222-4222-8222-222222222222';
    const CH = '33333333-3333-4333-8333-333333333333';
    const Q = '44444444-4444-4444-8444-444444444444';
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      seen.push({ url: u, method: init.method ?? 'GET', prefer: new Headers(init.headers).get('prefer') ?? '', body: init.body ? JSON.parse(init.body) : null });
      const r = replies.shift() ?? { status: 200, body: [] };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    const row = { id: OUT, class_id: CLASS, code: 'CO1', statement: 'S', target_level: null, position: 1, created_at: 'T', updated_at: 'T', archived_at: null };
    try {
      const repo = createSupabaseRepo();
      replies.push({ status: 201, body: row });
      const made = await repo.createOutcome({ classId: CLASS, code: 'CO1', statement: 'S', targetLevel: null, position: 1 });
      assert.equal(seen[0].url.pathname, '/rest/v1/course_outcomes');
      assert.deepEqual(Object.keys(seen[0].body).sort(), ['class_id', 'code', 'created_at', 'position', 'statement', 'target_level', 'updated_at']);
      assert.deepEqual([made._id, made.position, made.archivedAt], [OUT, 1, null]);

      replies.push({ status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "course_outcomes_class_code_key"' } });
      await assert.rejects(repo.createOutcome({ classId: CLASS, code: 'CO1', statement: 'S', position: 2 }), (e) => e.status === 409);

      replies.push({ status: 200, body: { ...row, archived_at: null, position: 4 } });
      await repo.updateOutcome(OUT, { archivedAt: null, position: 4 });
      assert.equal(seen[2].method, 'PATCH');
      assert.deepEqual([seen[2].body.archived_at, seen[2].body.position, typeof seen[2].body.updated_at], [null, 4, 'string']);

      // Held: Layers (weight 1) and UDP. Wanted: layers at weight 2, and TCP. So one update, one insert, one delete.
      const held = (id, topic, weight) => ({ id, outcome_id: OUT, class_id: CLASS, content_id: CH, topic, weight: String(weight), created_at: 'T' });
      replies.push({ status: 200, body: [held('l1', 'Layers', 1), held('l2', 'UDP', 1)] }, { status: 200, body: [] },
        { status: 201, body: [] }, { status: 200, body: [] }, { status: 200, body: [held('l1', 'layers', 2), held('l3', 'TCP', 1)] });
      const now = await repo.setOutcomeTopics(OUT, CLASS, [{ contentId: CH, topic: 'layers', weight: 2 }, { contentId: CH, topic: 'TCP', weight: 1 }]);
      const [read, upd, ins, gone] = seen.slice(3, 7);
      assert.deepEqual([read.method, read.url.searchParams.get('outcome_id')], ['GET', `eq.${OUT}`]);
      assert.deepEqual([upd.method, upd.url.searchParams.get('id'), upd.body], ['PATCH', 'eq.l1', { topic: 'layers', weight: 2 }]);
      assert.deepEqual([ins.method, ins.body], ['POST', [{ outcome_id: OUT, class_id: CLASS, content_id: CH, topic: 'TCP', weight: 1 }]]);
      assert.deepEqual([gone.method, gone.url.searchParams.get('id')], ['DELETE', 'in.(l2)']);
      assert.deepEqual(now.map((l) => [l.topic, l.weight]), [['layers', 2], ['TCP', 1]], 'weight is read back as a number');

      replies.push({ status: 201, body: { id: 'v', class_id: CLASS, question_id: Q, outcome_ids: [OUT], excluded: false, updated_at: 'T', updated_by: null } });
      const ov = await repo.setQuestionOverride({ classId: CLASS, questionId: Q, outcomeIds: [OUT], excluded: false });
      const up = seen.at(-1);
      assert.deepEqual([up.method, up.url.searchParams.get('on_conflict')], ['POST', 'class_id,question_id']);
      assert.match(up.prefer, /resolution=merge-duplicates/);
      assert.deepEqual(up.body.outcome_ids, [OUT]);
      assert.deepEqual(ov.outcomeIds, [OUT]);

      replies.push({ status: 200, body: [{ id: 'v' }] });
      assert.equal(await repo.deleteQuestionOverride(CLASS, Q), true);
      assert.deepEqual([seen.at(-1).method, seen.at(-1).url.searchParams.get('class_id'), seen.at(-1).url.searchParams.get('question_id')],
        ['DELETE', `eq.${CLASS}`, `eq.${Q}`]);

      const before = seen.length;
      assert.deepEqual(await repo.listOutcomes('0123456789abcdef01234567'), []);
      assert.equal(await repo.getOutcome('nope'), null);
      assert.equal(await repo.deleteQuestionOverride(CLASS, 'nope'), false);
      assert.equal(seen.length, before, 'no request for an id that cannot be a uuid');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });

  test('the Mongo schemas keep the same fields and refuse the same shapes (built, not saved: no Mongo here)', async () => {
    const { CourseOutcome, OutcomeTopic, QuestionOutcomeOverride } = await import('../src/models/index.js');
    const o = new CourseOutcome({ classId: 'k1', code: 'CO1', statement: 'S', position: 1 });
    assert.deepEqual([o.targetLevel, o.archivedAt, o.validateSync()], [null, null, undefined]);
    assert.ok(new CourseOutcome({ classId: 'k1', code: 'CO1', statement: 'S', position: 1, targetLevel: 'analyze' }).validateSync());
    assert.ok(new CourseOutcome({ classId: 'k1', code: 'CO1', statement: 's'.repeat(301), position: 1 }).validateSync());
    assert.ok(new OutcomeTopic({ outcomeId: 'o', classId: 'k', contentId: 'c', topic: 'T', topicKey: 't', weight: 0 }).validateSync());
    const ov = new QuestionOutcomeOverride({ classId: 'k', questionId: 'q', outcomeIds: ['o1'], phone: '9845012345' }).toObject();
    assert.deepEqual([ov.excluded, ov.outcomeIds, 'phone' in ov], [false, ['o1'], false]);
  });

  test('one override per question per class, replaced by the next; removing it returns whether there was one', async () => {
    const repo = createMemoryRepo();
    await repo.setQuestionOverride({ classId: 'k1', questionId: 'q1', outcomeIds: ['o1'], excluded: false });
    const now = await repo.setQuestionOverride({ classId: 'k1', questionId: 'q1', excluded: true, outcomeIds: ['ignored'] });
    assert.deepEqual([now.excluded, now.outcomeIds], [true, []]);
    await repo.setQuestionOverride({ classId: 'k2', questionId: 'q1', outcomeIds: ['o9'], excluded: false });
    assert.equal((await repo.listQuestionOverrides('k1')).length, 1);
    assert.equal(await repo.deleteQuestionOverride('k1', 'q1'), true);
    assert.equal(await repo.deleteQuestionOverride('k1', 'q1'), false);
    assert.equal((await repo.listQuestionOverrides('k2')).length, 1);
  });
});
