// F6 tier 1 - the artefact the teacher actually walks out of the room with.
// Tier 2 (Classroom) can be unconfigured, unauthorised or blocked by the college
// network; this file is the path that always works, so it is pure: no I/O, no
// framework, and every number comes from mastery.js rather than being recomputed
// here. If the CSV and the dashboard ever disagreed, the mastery model would no
// longer be the single source of truth.

import { LEVELS, LABEL } from '../bloom.js';
import { hydrate, levelReport, totals, overallAccuracy, isSlowLearner } from './mastery.js';
import { HONESTY, summarise } from './integrity.js';

// Without the BOM, Excel reads the file as the local ANSI codepage and student
// names with accents open as mojibake. Sheets ignores it.
const BOM = '\ufeff';

// RFC 4180 line ending - the one both Excel and Sheets agree on.
const EOL = '\r\n';

const FORMULA_LEAD = /^[=+\-@]/;
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * One CSV field: injection guard first, then quoting.
 * A leading = + - or @ is executed as a formula by both Excel and Sheets, so a
 * student who types `=HYPERLINK(...)` as their name would otherwise run code on
 * the teacher's machine. The apostrophe is the standard neutraliser and is not
 * displayed by either program.
 */
function cell(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const line = (cells) => cells.map(cell).join(',');

/** mastery.js returns null for "no evidence"; an empty cell keeps the column numeric. */
const asPercent = (accuracy) =>
  accuracy === null || accuracy === undefined ? '' : Math.round(accuracy * 100);

function today(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function headerRow() {
  const cells = ['Roll No', 'Name', 'Working Level', 'Slow Learner'];
  for (const level of LEVELS) {
    cells.push(`${LABEL[level]} Seen`, `${LABEL[level]} Correct`, `${LABEL[level]} %`);
  }
  cells.push('Total Seen', 'Total Correct', 'Total %', 'Reason', 'Signals', 'How to read the signals');
  return cells;
}

function profileRow(raw) {
  // hydrate() guarantees all six levels exist, so the row can never come out
  // short and shift every column to the right of a missing cell.
  const profile = hydrate(raw);

  const cells = [
    profile.rollNo,
    profile.name,
    LABEL[profile.workingLevel] ?? profile.workingLevel,
    isSlowLearner(profile) ? 'Yes' : 'No',
  ];

  for (const level of levelReport(profile)) {
    cells.push(level.seen, level.correct, asPercent(level.accuracy));
  }

  const total = totals(profile);
  cells.push(total.seen, total.correct, asPercent(overallAccuracy(profile)), profile.reason);

  // The signals leave the room with the results, as the sentences integrity.js
  // wrote and not as its level word. 'watch' alone in a column beside a student's
  // name, in a file that will be read weeks later by someone who was not in the
  // room, is precisely the verdict this feature refuses to render; the sentences
  // describe what was recorded and leave the reading of it to a person.
  // An empty cell is a student nothing was recorded about.
  const signals = summarise(profile).notes.join(' ');

  // The caveat rides on the rows that make a claim, and only those. A sheet gets
  // mailed, filtered and quoted one row at a time, and this column is the only
  // thing that keeps the limits attached to the sentence they qualify once it
  // has left the dashboard that showed them together. It cannot be a caption
  // row: the header must stay exactly one row or the Classroom import reads the
  // caption as the column names.
  cells.push(signals, signals ? HONESTY : '');

  return cells;
}

/**
 * @param {object[]} profiles raw profile documents, in the order they should appear
 * @param {{sessionCode?: string, contentTitle?: string}} meta
 * @returns {string} a complete CSV file, BOM included
 */
export function profilesToCsv(profiles, { sessionCode = '', contentTitle = '' } = {}) {
  const rows = Array.isArray(profiles) ? profiles : [];

  // The header MUST be row 1 with no caption or blank line above it. Test TC-08
  // is "columns match Classroom import", and Classroom's mark import - like
  // Sheets' first-row-is-header default - reads row 1 as the column names and
  // would otherwise import a one-cell caption as the entire header.
  // Provenance lives in the filename instead: bloomloop-<CODE>-<date>.csv,
  // built by routes/export.js from sessionCode and today().
  const lines = [line(headerRow())];
  for (const raw of rows) lines.push(line(profileRow(raw)));

  return BOM + lines.join(EOL) + EOL;
}

/* -------------------------------------------------------------- writing -- */

// Phase 4's exports (services/exports.js) write through this. The writer above
// is left as it is: its single header row is what the Classroom import reads
// (TC-08), and its guard predates the tab and CR rule below.

// =, +, - and @ start a formula in Excel, Sheets and LibreOffice; a leading tab
// or carriage return is how a formula is slipped past a guard that checks only
// those four (the OWASP list).
const GUARD_LEAD = /^[=+\-@\t\r]/;
// The same lead after a semicolon or a tab inside a cell: a spreadsheet that
// splits on either (Excel where the list separator is ';', a paste into
// Sheets) starts a new cell there, and that cell would begin with a formula.
const GUARD_INNER = /([;\t])(?=[=+\-@\t\r])/g;
// RFC 4180's reasons to quote, and a semicolon or a tab, so a program that
// splits on them still keeps the cell whole.
const EXPORT_QUOTING = /[",;\t\r\n]/;

export const CSV_GUARD_NOTE = 'A text cell that begins with =, +, -, @, a tab or a carriage return is written with an '
  + 'apostrophe (\') in front of it, and quoted, so a spreadsheet keeps it as text and never runs it as a formula. The same '
  + 'is done after a semicolon or a tab inside a cell, where a spreadsheet that splits on them would start a new cell, and '
  + 'a cell holding a semicolon or a tab is always quoted. The apostrophe was added by the export; it is not part of the '
  + 'value. Numbers are written as numbers.';

/**
 * One field of an export. A number is written as itself, never guarded or
 * quoted, so a spreadsheet sums it; null and undefined are an empty cell. Any
 * other value is text: guarded (GUARD_LEAD at the start, GUARD_INNER after a
 * semicolon or a tab), and quoted when it was guarded (so the neutralised cell
 * is plain to see in the file) or holds a quote, a comma, a semicolon, a tab or
 * a line break.
 */
export function csvCell(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = value === null || value === undefined ? '' : String(value);
  const safe = (GUARD_LEAD.test(text) ? `'${text}` : text).replace(GUARD_INNER, '$1\'');
  return safe !== text || EXPORT_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows of cells to a whole file: the BOM (Excel then reads Devanagari as UTF-8), CRLF after every row. */
export function toCsv(rows = []) {
  return BOM + rows.map((r) => r.map(csvCell).join(',')).join(EOL) + EOL;
}

/* -------------------------------------------------------------- reading -- */

// Phase 4 reads CSV too (a roster import). Small and written here rather than
// added as a dependency: a class list is a few hundred short rows, and what it
// has to cope with is what Excel, Sheets and LibreOffice actually write.

export const DELIMITERS = Object.freeze([',', ';', '\t']);

const fail = (message, status) => Object.assign(new Error(message), { status });

/**
 * The delimiter the first line uses: whichever of comma, semicolon and tab it
 * holds most of outside quotes. Excel writes semicolons where the decimal mark
 * is a comma, and "Save as text" writes tabs, so a header row says which. A
 * line with none of them is one column, read with a comma.
 */
function headerDelimiter(text) {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  // Whether anything but white space has been read yet, kept as the text is
  // read. Trimming everything before each line break instead made a file of
  // blank lines quadratic: one upload held the event loop for seconds.
  let sawText = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      quoted = !quoted;
      sawText = true;
    } else if (!quoted && (c === '\n' || c === '\r')) {
      // A blank first line is skipped, as the records are.
      if (sawText) break;
    } else {
      if (!quoted && counts.has(c)) {
        counts.set(c, counts.get(c) + 1);
        sawText = true;
      }
      if (!sawText && /\S/.test(c)) sawText = true;
    }
  }
  let best = ',';
  for (const d of DELIMITERS) if (counts.get(d) > counts.get(best)) best = d;
  return best;
}

/**
 * CSV text to records: RFC 4180 as spreadsheets write it, read leniently.
 *
 *   - a UTF-8 byte-order mark is dropped (Excel writes one; see BOM above)
 *   - a record ends at CRLF, LF or a lone CR, except inside quotes
 *   - a field that starts with a quote (spaces before it allowed) runs to the
 *     closing quote, delimiters and line breaks included, and "" inside it is
 *     one quote
 *   - the delimiter is a comma, semicolon or tab, told from the first line
 *
 * Each record says the line it starts on (1 from the top of the file, blank
 * lines counted), so a refusal can name the line a professor sees in their
 * spreadsheet. Cells come back exactly as written, untrimmed. A quote that never
 * closes is a 400 naming its line: read on, it would swallow the rest of the
 * file into one cell.
 *
 * @returns {{ delimiter: string, records: { line: number, cells: string[] }[] }}
 */
export function parseCsv(input) {
  const text = String(input ?? '').replace(/^﻿/, '');
  const delimiter = headerDelimiter(text);
  const records = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let start = 1;
  let quoteLine = 1;
  // The cell so far is empty or only spaces and tabs, kept as it is read: a
  // regular expression over the growing cell at every quote made a cell
  // followed by quote after quote quadratic.
  let padding = true;

  const endCell = () => { cells.push(cell); cell = ''; wasQuoted = false; padding = true; };
  const endRecord = () => { endCell(); records.push({ line: start, cells }); cells = []; };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else {
        if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line += 1;
        cell += c;
      }
    } else if (c === '"' && !wasQuoted && padding) {
      // Spaces before the opening quote (`21CS01, "Rao, Asha"`, as some
      // exports write) are padding, not part of the cell.
      cell = '';
      quoted = true;
      wasQuoted = true;
      quoteLine = line;
    } else if (c === delimiter) {
      endCell();
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      start = line;
    } else {
      // Text after a closing quote ("ab"c) is kept as written: lenient, as
      // spreadsheets are when they open such a file.
      cell += c;
      if (c !== ' ' && c !== '\t') padding = false;
    }
  }
  if (quoted) throw fail(`Line ${quoteLine} opens a quote that never closes, so the rest of the file cannot be read.`, 400);
  // The last record, unless the file ended with a line break.
  if (cell !== '' || cells.length || wasQuoted) endRecord();
  return { delimiter, records };
}
