// Phase 4: the reports as files. The CSV writer and its formula-injection guard,
// the filename and format rules, the sheets read back against the JSON report
// they were drawn from, and the printable pages' escaping and self-containment.
// End to end (real server, sockets, signed-in callers) in scripts/acceptance4.mjs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { csvCell, parseCsv, toCsv } from '../src/services/csv.js';
import { DEFAULT_PRESET, presetById } from '../src/services/attainmentPresets.js';
import { classAttainment, marksRegister, studentAttainment, validateConfig } from '../src/services/attainment.js';
import {
  KEY_IN_ADDRESS, ROLL_NUMBERS_AS_TEXT, attainmentCsv, bloomCsv, exportFilename, fileHeaders, formulaParameters, outcomesCsv,
  registerCsv, reportFormat, sheetFrom,
} from '../src/services/exports.js';
import { attainmentHtml, escapeHtml, html, registerHtml, studentHtml } from '../src/services/printable.js';

const status = (code, fn, match) => assert.throws(fn, (err) => err.status === code && (!match || match.test(err.message)));

/* ------------------------------------------------------------- fixtures -- */

const CLS = { _id: '3f2a9c1e-1111-4000-8000-000000000000', courseName: 'Operating Systems', section: 'TY-CS A', termLabel: 'Sem V' };
const C1 = 'cccccccccccccccccccccc01';
const ROOM = { _id: 'aaaaaaaaaaaaaaaaaaaaaa01', code: 'ROOMA1', title: 'Week 1', status: 'closed', startedAt: '2026-11-02T04:00:00.000Z', contentId: C1 };
const OUTCOME = { _id: 'co1', classId: CLS._id, code: 'CO1', statement: 'Explain <script>alert(1)</script> & "quotes".', position: 1, archivedAt: null };
const LINKS = [{ outcomeId: 'co1', classId: CLS._id, contentId: C1, topic: 'Processes', weight: 1 }];
const ROSTER = [
  { _id: 's1', classId: CLS._id, rollNo: '21CS01', name: 'Asha Rao', removedAt: null },
  { _id: 's2', classId: CLS._id, rollNo: '21CS02', name: '=cmd|calc', removedAt: null },
];
let n = 0;
const ans = (roll, score, extra = {}) => {
  n += 1;
  return {
    _id: `ans${n}`, sessionId: ROOM._id, rollNo: roll, questionId: `q${n}`, contentId: C1, topic: 'Processes', bloom: 'remember',
    kind: 'mcq', questionSnapshot: { id: `q${n}`, text: `Question <${n}>?` }, response: 1, attempt: 1, final: true,
    correct: score >= 0.7, score, ungraded: false, reviewStatus: 'auto', answeredAt: `2026-11-02T05:00:0${n}.000Z`, ...extra,
  };
};
// 21CS01 1, 1, 0 (2 of 3: attained at 60%); 21CS02 1 and a provisional written 1 (not counted): not enough evidence.
const ANSWERS = [ans('21CS01', 1), ans('21CS01', 1), ans('21CS01', 0), ans('21CS02', 1), ans('21CS02', 1, { reviewStatus: 'provisional', kind: 'open' })];
const FORMULA = { source: 'example', version: 0, savedAt: null, savedBy: null, preset: { id: DEFAULT_PRESET, name: presetById(DEFAULT_PRESET).name }, config: validateConfig(presetById(DEFAULT_PRESET).config) };
const CHAPTERS = new Map([[C1, { title: 'Unit 1', keys: new Set(['processes']) }]]);
const inputs = {
  cls: CLS, rooms: [ROOM], window: {}, formula: FORMULA, answers: ANSWERS, roster: ROSTER, outcomes: [OUTCOME], links: LINKS,
  overrides: [], questions: [], chapters: CHAPTERS,
};
const REPORT = classAttainment(inputs);
const NOW = new Date('2026-11-19T08:30:00.000Z'); // 14:00 in India

/** A sheet's leading rows by label, and its tables by title. */
function readSheet(text) {
  const rows = parseCsv(text).records.map((r) => r.cells);
  const blank = (r) => r.length === 1 && r[0] === '';
  const meta = new Map();
  let i = 0;
  for (; !blank(rows[i]); i += 1) meta.set(rows[i][0], rows[i][1]);
  const tables = new Map();
  while (i < rows.length) {
    if (blank(rows[i])) { i += 1; continue; }
    const [title, header] = [rows[i][0], rows[i + 1]];
    const body = [];
    for (i += 2; i < rows.length && !blank(rows[i]); i += 1) body.push(Object.fromEntries(header.map((h, k) => [h, rows[i][k]])));
    tables.set(title, body);
  }
  return { meta, tables };
}

/* --------------------------------------------------------------- writer -- */

describe('the CSV writer', () => {
  test('numbers are written as numbers, never guarded or quoted; null is an empty cell', () => {
    assert.equal(csvCell(4), '4');
    assert.equal(csvCell(2.8), '2.8');
    assert.equal(csvCell(-1), '-1', 'a negative number is a number, not a formula');
    assert.equal(csvCell(0), '0');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
    assert.equal(csvCell(Number.NaN), '');
  });

  test('a text cell starting with = + - @ tab or CR gets an apostrophe and is always quoted', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      assert.equal(csvCell(`${lead}SUM(A1)`), `"'${lead}SUM(A1)"`, JSON.stringify(lead));
    }
    assert.equal(csvCell('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"');
    assert.equal(csvCell('-5'), '"\'-5"', 'text that looks like a negative number is text');
    assert.equal(csvCell('a=b'), 'a=b', 'only a leading character counts');
  });

  test('a formula lead after a semicolon or a tab inside a cell gets an apostrophe too, and such a cell is always quoted', () => {
    // A spreadsheet that splits on ; (Excel where it is the list separator) or on a tab (a paste) starts a new cell there.
    assert.equal(csvCell('Asha;=HYPERLINK("http://x")'), '"Asha;\'=HYPERLINK(""http://x"")"');
    assert.equal(csvCell('Asha\t@SUM(A1)'), '"Asha\t\'@SUM(A1)"');
    assert.equal(csvCell('a;+1;-2'), '"a;\'+1;\'-2"', 'every one of them');
    assert.equal(csvCell('=a;=b'), '"\'=a;\'=b"', 'with the leading guard as well');
    assert.equal(csvCell('a; b'), '"a; b"', 'a semicolon alone is quoted, never changed');
    assert.equal(csvCell('a\tb'), '"a\tb"', 'and so is a tab');
    assert.deepEqual(parseCsv(toCsv([['Asha;=1', 'x\ty']])).records[0].cells, ["Asha;'=1", 'x\ty'], 'read back whole');
  });

  test('other text is quoted only when it needs to be (RFC 4180)', () => {
    assert.equal(csvCell('Asha Rao'), 'Asha Rao');
    assert.equal(csvCell('Rao, Asha'), '"Rao, Asha"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('two\nlines'), '"two\nlines"');
    assert.equal(csvCell('मीरा जोशी'), 'मीरा जोशी');
  });

  test('a file: the BOM, CRLF after every row, a blank row as an empty line, and the reader gets it back', () => {
    const text = toCsv([['a', 1], [], ['=x', 'y,z']]);
    assert.equal(text, '﻿a,1\r\n\r\n"\'=x","y,z"\r\n');
    assert.deepEqual(parseCsv(text).records.map((r) => r.cells), [['a', '1'], [''], ["'=x", 'y,z']]);
  });
});

/* ---------------------------------------------------- formats and files -- */

describe('formats, sheets, filenames and headers', () => {
  test('format is json when left out, else one the route offers; sheet only with csv', () => {
    assert.equal(reportFormat({}, ['json', 'csv']), 'json');
    assert.equal(reportFormat({ format: 'CSV' }, ['json', 'csv']), 'csv');
    status(400, () => reportFormat({ format: 'html' }, ['json', 'csv']), /json, csv/);
    status(400, () => reportFormat({ format: ['csv', 'html'] }, ['json', 'csv', 'html']));
    assert.equal(sheetFrom({}, 'csv'), 'outcomes');
    assert.equal(sheetFrom({ sheet: 'Bloom' }, 'csv'), 'bloom');
    status(400, () => sheetFrom({ sheet: 'bloom' }, 'html'), /format=csv/);
    status(400, () => sheetFrom({ sheet: 'marks' }, 'csv'));
  });

  test('a sheet or a page asked for with the teacher key in its address is a 400 that says to send the header', () => {
    for (const format of ['csv', 'html']) {
      status(400, () => reportFormat({ format, key: 'ABCD1234' }, ['json', 'csv', 'html']), /x-teacher-key header/);
      status(400, () => reportFormat({ format, key: '' }, ['json', 'csv', 'html']), /x-teacher-key header/);
    }
    assert.match(KEY_IN_ADDRESS, /prints the address on the page/);
    assert.equal(reportFormat({ key: 'ABCD1234' }, ['json', 'csv']), 'json', 'JSON is not a file anyone prints');
    assert.equal(reportFormat({ format: 'csv' }, ['json', 'csv']), 'csv');
  });

  test('a filename is ASCII: the course and section slugged, the class id\'s first 8, the day in India', () => {
    assert.equal(exportFilename(CLS, 'attainment', 'csv', NOW), 'bloomloop-attainment-operating-systems-ty-cs-a-3f2a9c1e-2026-11-19.csv');
    // 23:00 UTC is the next morning in India.
    assert.equal(exportFilename(CLS, 'register', 'html', new Date('2026-11-19T23:00:00.000Z')).slice(-15), '2026-11-20.html');
    const odd = exportFilename({ _id: 'abcdef0123456789abcdef01', courseName: 'संगणक "x"\r\nSet-Cookie: a', section: 'Sécti/on' }, 'outcomes', 'csv', NOW);
    assert.equal(odd, 'bloomloop-outcomes-x-set-cookie-a-secti-on-abcdef01-2026-11-19.csv');
    assert.match(odd, /^[a-z0-9.-]+$/, 'nothing in it can break the header');
  });

  test('a CSV is an attachment, a page is inline with its own policy; neither is cached', () => {
    const c = fileHeaders('csv', 'f.csv');
    assert.equal(c['Content-Type'], 'text/csv; charset=utf-8');
    assert.equal(c['Content-Disposition'], 'attachment; filename="f.csv"');
    assert.equal(c['Cache-Control'], 'no-store');
    const h = fileHeaders('html', 'f.html');
    assert.equal(h['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(h['Content-Disposition'], 'inline; filename="f.html"');
    assert.match(h['Content-Security-Policy'], /^default-src 'none'; style-src 'unsafe-inline';.*frame-ancestors 'self'$/);
  });
});

/* -------------------------------------------------------------- sheets -- */

describe('the sheets are the JSON report', () => {
  test('the report carries what each outcome is mapped to', () => {
    assert.deepEqual(REPORT.outcomes[0].topics.map((t) => [t.chapter, t.topic, t.weight]), [['Unit 1', 'Processes', 1]]);
    assert.equal(REPORT.outcomes[0].directQuestions, 0);
  });

  test('the attainment sheet: the method first, then the class row, the students and the records', () => {
    const { meta, tables } = readSheet(attainmentCsv(REPORT, { now: NOW }));
    assert.equal(meta.get('BloomLoop'), 'Course-outcome attainment sheet');
    assert.equal(meta.get('Generated'), '2026-11-19 14:00 (India time)');
    assert.equal(meta.get('Methodology'), REPORT.methodology);
    assert.equal(meta.get('Formula, exactly as stored'), JSON.stringify(REPORT.formula.config));
    assert.equal(meta.get('Formula version'), '0');
    const [co] = tables.get('Course outcomes: the class');
    assert.equal(co.Statement, OUTCOME.statement, 'a CSV keeps the statement as text; escaping is the page\'s job');
    assert.deepEqual([co['Students on the roster'], co['Counted (attained or not attained)'], co.Attained, co['% of counted who attained'],
      co['Attainment level']], ['2', '1', '1', '100', '3']);
    // The answer columns are the share's: Asha's 3. 21CS02's counted answer is outside it, in its own columns.
    assert.deepEqual([co['Digital answers behind the share (counted)'], co['Digital answers behind the share: marks possible'],
      co['Provisional written answers behind the share (not counted)'],
      co['Roster students with not enough evidence who have counted answers (outside the share)'], co['Their counted answers']],
    ['3', '3', '0', '1', '1']);
    assert.equal(co.Summary, REPORT.outcomes[0].summary);
    assert.match(co.Summary, /Rests on 3 counted answers from the 1 student counted: 3 digital\. Outside the share: 1 counted answer from 1 student with not enough evidence\./);
    const students = tables.get('Students by course outcome, in roll-number order (never ranked)');
    assert.deepEqual(students.map((s) => [s['Roll No'], s.Name, s['CO1 state'], s['CO1 marks obtained'], s['CO1 marks possible'], s['CO1 %']]), [
      ['21CS01', 'Asha Rao', 'Attained', '2', '3', '66.66'],
      ['21CS02', "'=cmd|calc", 'Not enough evidence', '1', '1', '100'],
    ]);
    assert.equal(students[1]['CO1 provisional written answers (not counted)'], '1');
    // The share's counted marks again by who wrote the question: every question here is the model's.
    assert.deepEqual([co['Counted answers behind the share on AI-generated questions'], co['Marks obtained behind the share on AI-generated questions'],
      co['Counted answers behind the share on professor-written questions'],
      co['Counted answers behind the share on offline-template questions (and professor-written before 19 Nov 2026)']], ['3', '2', '0', '0']);
    assert.equal(meta.get('Question sources'), REPORT.questionSources.map((x) => `${x.label}: ${x.description}`).join(' '));
    assert.equal(meta.get('Roll numbers'), ROLL_NUMBERS_AS_TEXT);
    assert.match(meta.get('Roll numbers'), /Data > From Text\/CSV, then set the Roll No column's type to Text/);
    assert.equal(meta.get('Roll numbers not on the roster'), 'None: every answer and phone here is a roster student\'s.');
    const records = tables.get('Teacher records: reported beside the marks, never part of one');
    assert.ok(records.length > 10 && records.every((r) => !/21CS0/.test(JSON.stringify(r))), 'class level only');
  });

  test('a weighted room outside the report is named as such in the sheet\'s and the page\'s parameters', () => {
    const ROOM2 = { ...ROOM, _id: 'aaaaaaaaaaaaaaaaaaaaaa02', code: 'ROOMB2', startedAt: '2026-11-09T04:00:00.000Z' };
    const formula = { ...FORMULA, source: 'saved', version: 2, preset: null, config: { ...FORMULA.config, roomWeights: [{ roomId: ROOM2._id, weight: 2 }] } };
    const r = classAttainment({ ...inputs, formula, rooms: [ROOM], classRooms: [ROOM, ROOM2] });
    const { meta } = readSheet(attainmentCsv(r, { now: NOW }));
    assert.equal(meta.get('Formula: Room weights'), 'ROOMB2 x 2 (a room not in this report); every other room x 1');
    assert.ok(attainmentHtml(r, { now: NOW }).includes('ROOMB2 x 2 (a room not in this report); every other room x 1'));
  });

  test('a share a hair under the threshold prints under it, in the sheet and on the page, beside "Not attained"', () => {
    // Topic weights 59.996 and 40.004, one right and one wrong: 59.996 of 100.
    const links = [
      { outcomeId: 'co1', classId: CLS._id, contentId: C1, topic: 'Processes', weight: 59.996 },
      { outcomeId: 'co1', classId: CLS._id, contentId: C1, topic: 'Threads', weight: 40.004 },
    ];
    const r = classAttainment({
      ...inputs, links, formula: { ...FORMULA, config: { ...FORMULA.config, minAnswers: 1 } },
      answers: [ans('21CS01', 1), ans('21CS01', 0, { topic: 'Threads' })],
    });
    const { tables } = readSheet(attainmentCsv(r, { now: NOW }));
    const asha = tables.get('Students by course outcome, in roll-number order (never ranked)')[0];
    assert.deepEqual([asha['CO1 state'], asha['CO1 marks obtained'], asha['CO1 %']], ['Not attained', '59.996', '59.99']);
    assert.ok(attainmentHtml(r, { now: NOW }).includes('59.996 / 100 (59.99%)'));
  });

  test('a first level at 0% has no "level 0 below" clause in the parameters, as in the methodology', () => {
    const formula = { ...FORMULA, config: validateConfig({ ...FORMULA.config, levels: [{ level: 1, minShare: 0 }, { level: 2, minShare: 0.5 }] }) };
    const levels = formulaParameters(formula).find(([name]) => name === 'Class levels')[1];
    assert.equal(levels, 'level 1 from 0%, level 2 from 50% of the students counted');
    assert.match(formulaParameters(FORMULA).find(([name]) => name === 'Class levels')[1], /; level 0 below 50%$/);
  });

  test('the Bloom sheet: bands, then levels, as in the JSON', () => {
    const { tables } = readSheet(bloomCsv(REPORT, { now: NOW }));
    const rows = tables.get('Bloom level bands and levels: the class');
    assert.deepEqual(rows.map((r) => r['Band or level']), [...REPORT.bloom.bands, ...REPORT.bloom.levels].map((f) => f.label));
    assert.equal(rows.find((r) => r['Band or level'] === 'Remember')['Attainment level'], '3');
    assert.equal(rows.find((r) => r['Band or level'] === 'Create')['Attainment level'], '', 'nobody counted: no level, an empty cell');
    assert.equal(readSheet(bloomCsv(REPORT, { now: NOW })).meta.get('Roll numbers'), ROLL_NUMBERS_AS_TEXT);
  });

  test('the register: a room with nothing answered is 0 of 0 with no percentage, the attendance mark beside it', () => {
    const reg = marksRegister({
      cls: CLS, rooms: [ROOM], window: {}, formula: FORMULA, answers: ANSWERS.slice(0, 3), roster: ROSTER,
      attendance: new Map([[ROOM._id, [{ classStudentId: 's1', status: 'present' }, { classStudentId: 's2', status: 'absent' }]]]),
      profiles: new Map(),
    });
    const { meta, tables } = readSheet(registerCsv(reg, { now: NOW }));
    const rows = tables.get('Marks register, in roll-number order (never ranked)');
    assert.deepEqual(Object.values(rows[1]).slice(0, 7), ['21CS02', "'=cmd|calc", 'On the roster', 'Absent', '0', '0', '']);
    assert.equal(rows[0]['ROOMA1 2026-11-02 marks obtained'], '2');
    assert.equal(meta.get('Methodology'), reg.methodology);
    assert.ok(!meta.has('Formula: Student threshold'), 'thresholds do not apply in the register');
    assert.equal(meta.get('Roll numbers'), ROLL_NUMBERS_AS_TEXT);
    assert.equal(rows[0]['Total counted answers on AI-generated questions'], '3');
  });

  test('the outcome list: a row per topic, a row for an outcome with nothing mapped, excluded questions after', () => {
    const body = {
      class: { courseName: 'OS', section: 'A', termLabel: '' },
      outcomes: [
        { id: 'co1', code: 'CO1', statement: 'One', targetLevel: 'apply', archived: false,
          topics: [{ contentId: C1, chapter: 'Unit 1', topic: 'Processes', weight: 2, inChapter: true }] },
        { id: 'co2', code: 'CO2', statement: 'Two', targetLevel: null, archived: true, topics: [] },
      ],
      overrides: [{ questionId: 'q9', excluded: true, outcomes: [], question: null }],
      privacy: 'staff only',
    };
    const { tables } = readSheet(outcomesCsv(body, { formula: FORMULA, methodology: 'M', now: NOW }));
    const rows = tables.get('Course outcomes and what they are mapped to');
    assert.deepEqual(rows.map((r) => [r['Course outcome'], r['Target Bloom level'], r.Status, r['Mapped by'], r.Topic, r['Topic weight']]), [
      ['CO1', 'Apply', 'In use', 'Topic', 'Processes', '2'],
      ['CO2', '', 'Archived', 'Nothing mapped yet', '', ''],
      ['', '', '', 'Excluded from every outcome (override)', '', ''],
    ]);
    assert.equal(rows[2]['Question id'], 'q9');
  });
});

/* --------------------------------------------------------------- pages -- */

describe('a roll number off the roster, in the files', () => {
  test('its note is in the sheet\'s leading rows and on the page', () => {
    const r = classAttainment({ ...inputs, answers: [...ANSWERS, ans('GUEST1', 1)] });
    const note = 'GUEST1 is not on the class roster, so its answers in ROOMA1 are listed apart and counted in no class figure.';
    assert.deepEqual(r.rollNotes.map((x) => x.note), [note]);
    assert.equal(readSheet(attainmentCsv(r, { now: NOW })).meta.get('Roll numbers not on the roster'), note);
    assert.ok(attainmentHtml(r, { now: NOW }).includes(`<h3>Roll numbers not on the roster</h3>\n<ul>\n<li>${note}</li>`));
  });
});

describe('the printable pages', () => {
  test('the html tag escapes every value it is given, and never a fragment it made', () => {
    assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    const inner = html`<b>${'<i>'}</b>`;
    assert.equal(html`<p>${'<script>'}${[inner, ' & ']}${false}${null}${0}</p>`.text, '<p>&lt;script&gt;<b>&lt;i&gt;</b> &amp; 0</p>');
  });

  const selfContained = (page) => !/<script|<img|<link|<iframe|@import|url\(|\ssrc=|\shref=/i.test(page);

  test('the class page: escaped, self-contained, with the method, the evidence types and the records apart', () => {
    const page = attainmentHtml(REPORT, { now: NOW });
    assert.ok(page.startsWith('<!doctype html>'));
    assert.ok(page.includes('<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;;'));
    assert.ok(selfContained(page));
    assert.ok(page.includes('Explain &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;.'));
    assert.ok(page.includes('<td>=cmd|calc</td>'));
    assert.ok(page.includes(escapeHtml(REPORT.methodology)));
    assert.ok(page.includes('<td>Provisional machine marks</td>') && page.includes('Shown, not counted'));
    assert.ok(page.includes('<td>AI-generated questions</td>') && page.includes('<h3>Who wrote the questions behind each share</h3>'));
    assert.ok(page.includes('<th class="n">Outside the share<small>'), 'a figure says what is outside its share');
    assert.ok(page.includes('<h2>Teacher records</h2>'));
    assert.ok(page.includes('<span class="badge lv-3">Level 3</span>') && page.includes('No level: nobody counted'));
    assert.ok(page.includes('>Not enough evidence</span>'), 'a state says itself in words');
  });

  test('one student\'s page and the register\'s are escaped and self-contained too', () => {
    const one = studentAttainment({ ...inputs, student: ROSTER[1], records: {} });
    const page = studentHtml(one, { now: NOW });
    assert.ok(selfContained(page) && page.includes('21CS02 =cmd|calc (On the roster)'));
    assert.ok(page.includes('Question &lt;5&gt;?'), 'the question text is escaped');
    assert.ok(page.includes('Course outcomes: 0 attained, 0 not attained, 1 not enough evidence.'));
    const reg = marksRegister({ cls: CLS, rooms: [ROOM], window: {}, formula: FORMULA, answers: ANSWERS, roster: ROSTER });
    const regPage = registerHtml(reg, { now: NOW });
    assert.ok(selfContained(regPage) && regPage.includes('Not part of the register.') && regPage.includes(escapeHtml(reg.methodology)));
  });
});
