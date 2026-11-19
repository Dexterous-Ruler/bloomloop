// Phase 4 - the reports as pages to print: one self-contained HTML document per
// report (the class's attainment, the marks register, one student's report),
// drawn on the server from the same JSON report the route answers with.
//
// Self-contained on purpose: no script, and no external font, stylesheet or
// image, so a page saved into a college's files prints the same years later,
// and a page the console opens from a blob or srcdoc needs nothing more from
// this server. The page's own Content-Security-Policy (PAGE_CSP) tells the
// browser the same: nothing but the inline style may load or run.
//
// Every value is escaped. The page is built with the `html` tag below, which
// escapes everything put into it unless it is a fragment the tag itself made,
// so a course-outcome statement or a name holding "<script>" prints as text,
// and no part of a page is assembled any other way.
//
// Print rules: A4, each part from a new page, table headers repeated on every
// page, rows never split across pages, the student matrices on landscape pages.
// A state or a level is a coloured badge that also says what it is in words, so
// a black-and-white print loses nothing.
//
// Students are in the report's roll-number order, never ranked. Teacher records
// are a section of their own, never beside a mark. Staff only, like the reports.

import { LABEL } from '../bloom.js';
import { PICK_STATUSES } from './wheel.js';
import {
  ATTENDANCE_LABEL, PAGE_CSP, SOURCES, SOURCE_COLUMN, TYPES, TYPE_COLUMN, answersText, classLine, countedWord, formulaLabel,
  formulaParameters, generatedText, mappedText, percentOf, periodText, teacherRecordRows, unmappedText,
} from './exports.js';

/* ------------------------------------------------------------- escaping -- */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Markup the `html` tag made, and so already escaped. Nothing else makes one. */
class Fragment {
  constructor(text) { this.text = text; }
}

const piece = (v) => {
  if (v instanceof Fragment) return v.text;
  if (Array.isArray(v)) return v.map(piece).join('');
  // So `${cond && html`...`}` leaves nothing when cond is false.
  if (v === null || v === undefined || v === false) return '';
  return escapeHtml(v);
};

/** The one way markup is made here: every value put in is escaped unless this tag made it. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += piece(v) + strings[i + 1]; });
  return new Fragment(out);
}

/* ----------------------------------------------------------------- page -- */

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0 auto; max-width: 1120px; padding: 24px; color: #1d2320; background: #fff;
  font: 10pt/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", "Nirmala UI", Mangal, Arial, sans-serif; }
h1 { font-size: 17pt; margin: 2px 0 2px; }
h2 { font-size: 13pt; margin: 0 0 8px; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 10.5pt; margin: 14px 0 4px; break-after: avoid; page-break-after: avoid; }
p { margin: 0 0 8px; }
ul { margin: 4px 0 10px; padding-left: 18px; }
.sub { color: #4a524e; margin: 0 0 2px; }
.staff { display: inline-block; border: 1px solid #1d2320; border-radius: 3px; padding: 0 6px; font-size: 8pt; font-weight: 600; margin: 0; }
section { margin-top: 22px; }
section.page { break-before: page; page-break-before: always; }
section.wide { page: wide; }
table { border-collapse: collapse; width: 100%; margin: 4px 0 12px; font-size: 9pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #c3cac6; padding: 3px 5px; text-align: left; vertical-align: top; }
th { background: #eef1ef; font-weight: 600; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
td.n { white-space: nowrap; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; margin: 0 0 8px; }
dl.facts dt { font-weight: 600; }
dl.facts dd { margin: 0; }
.method { border-left: 3px solid #7d8883; padding: 2px 0 2px 10px; }
.badge { display: inline-block; border: 1px solid; border-radius: 3px; padding: 0 5px; font-size: 8pt; font-weight: 600; white-space: nowrap; }
.st-attained { background: #dcefe3; border-color: #2f7a4b; color: #17482a; }
.st-not-attained { background: #f8e6cf; border-color: #a5621a; color: #5c3409; }
.st-not-enough-evidence { background: #fff; border-color: #7d8883; border-style: dashed; color: #3f4743; }
.lv-0 { background: #f1f2f1; border-color: #7d8883; color: #2b302d; }
.lv-1 { background: #e4eef6; border-color: #3d6f93; color: #1c3d55; }
.lv-2 { background: #cfe1f1; border-color: #2c5f86; color: #163650; }
.lv-3 { background: #b6d1ea; border-color: #1f4f75; color: #0f2c44; }
.lv-none { background: #fff; border-color: #7d8883; border-style: dashed; color: #3f4743; }
td small, th small { display: block; color: #4a524e; font-size: 8pt; font-weight: 400; }
.note { color: #4a524e; font-size: 8.5pt; }
.records { border: 1px solid #7d8883; border-radius: 3px; padding: 8px 10px; }
footer { margin-top: 22px; color: #4a524e; font-size: 8.5pt; }
@page { size: A4; margin: 14mm 12mm; }
@page wide { size: A4 landscape; margin: 12mm; }
@media print { body { padding: 0; max-width: none; } }
`;

/** A whole document. The policy rides in the page so a blob or srcdoc copy keeps it. */
function page(title, body) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    html`<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`.text,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="robots" content="noindex, nofollow">',
    html`<title>${title}</title>`.text,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    body.text,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/* --------------------------------------------------------------- pieces -- */

const STATE_CLASS = { attained: 'st-attained', 'not-attained': 'st-not-attained', 'not-enough-evidence': 'st-not-enough-evidence' };

/** A state as a badge that says it in words. */
const stateBadge = (cell) => html`<span class="badge ${STATE_CLASS[cell.state] ?? 'st-not-enough-evidence'}">${cell.stateLabel}</span>`;

/** A class level as a badge that says it in words; none when nobody was counted. */
const levelBadge = (level) => (level === null || level === undefined
  ? html`<span class="badge lv-none">No level: nobody counted</span>`
  : html`<span class="badge lv-${Math.min(Number(level), 3)}">Level ${level}</span>`);

/** The evidence-type columns' heads: what is counted, and whether this formula counts it. */
const typeHeads = (ev) => TYPES.map((t) => html`<th class="n">${cap(TYPE_COLUMN[t])}<small>${countedWord(ev[t])}</small></th>`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const pctCell = (share) => (share === null || share === undefined ? '' : `${percentOf(share)}%`);

/** Marks as "obtained / possible (share)". */
const marksText = (m) => `${m.obtained} / ${m.possible}${m.share === null || m.share === undefined ? '' : ` (${percentOf(m.share)}%)`}`;

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

function header(title, cls, { now, lines = [] }) {
  return html`<header>
<p class="staff">Staff only</p>
<h1>${title}</h1>
<p class="sub">${classLine(cls)}</p>
${lines.map((l) => html`<p class="sub">${l}</p>`)}
<p class="sub">Generated ${generatedText(now)}</p>
</header>`;
}

/** The evidence types as rows: what each is, how many answers this report holds of it, and whether it counts. */
function evidenceTable(r, counts) {
  const ev = r.formula.config.evidence;
  return html`<table>
<thead><tr><th>Evidence</th><th>What it is</th><th class="n">Answers here</th><th>In the marks</th></tr></thead>
<tbody>
${r.evidenceTypes.map((t) => html`<tr><td>${t.label}</td><td>${t.description}</td><td class="n">${counts[t.id] ?? 0}</td><td>${t.id === 'revote' ? 'Never counted: shown only' : ev[t.id] ? 'Counted' : 'Shown, not counted'}</td></tr>`)}
<tr><td>Polls</td><td>Questions with no right answer.</td><td class="n">${counts.ungraded}</td><td>Not marked; a count only</td></tr>
<tr><td>Teacher records</td><td>Observations, wheel picks, hand tallies and activities recorded by the professor.</td><td class="n"></td><td>Never counted: reported in their own section</td></tr>
</tbody>
</table>`;
}

/** Who wrote the questions: each source, what it is, and how many marked answers here are on its questions. */
function sourcesTable(r, sourceCounts) {
  return html`<table>
<thead><tr><th>Question source</th><th>What it is</th><th class="n">Marked answers here</th></tr></thead>
<tbody>
${r.questionSources.map((s) => html`<tr><td>${s.label}</td><td>${s.description}</td><td class="n">${sourceCounts[s.id] ?? 0}</td></tr>`)}
</tbody>
</table>`;
}

/** Every roll number off the roster, and what it is. */
const rollNotesList = (notes = []) => (notes.length
  ? html`<h3>Roll numbers not on the roster</h3>
<ul>
${notes.map((n) => html`<li>${n.note}</li>`)}
</ul>` : '');

/** "How this report was made": period, rooms, formula, its parameters, the methodology, the evidence types. */
function about(r, { counts, sourceCounts, register = false }) {
  return html`<section>
<h2>How this report was made</h2>
<dl class="facts">
<dt>Period</dt><dd>${periodText(r.window)}</dd>
<dt>Rooms included</dt><dd>${r.rooms.length ? r.rooms.length : 'None: no room of this class matches'}</dd>
<dt>Formula</dt><dd>${formulaLabel(r.formula)}</dd>
</dl>
${r.rooms.length > 0 && html`<table>
<thead><tr><th>Room</th><th>Title</th><th>Opened</th><th>Status</th>${!register && html`<th class="n">Weight</th>`}</tr></thead>
<tbody>
${r.rooms.map((room) => html`<tr><td>${room.code}</td><td>${room.title}</td><td>${room.day}</td><td>${room.status}</td>${!register && html`<td class="n">${room.weight}</td>`}</tr>`)}
</tbody>
</table>`}
<h3>The formula's parameters</h3>
<table>
<tbody>
${formulaParameters(r.formula, { register }).map(([name, value]) => html`<tr><th>${name}</th><td>${value}</td></tr>`)}
<tr><th>Exactly as stored (version ${r.formula.version})</th><td><small>${JSON.stringify(r.formula.config)}</small></td></tr>
</tbody>
</table>
<h3>Methodology</h3>
<p class="method">${r.methodology}</p>
<h3>Evidence types</h3>
${evidenceTable(r, counts)}
<h3>Question sources</h3>
${sourcesTable(r, sourceCounts)}
</section>`;
}

/**
 * A class figure's rows: an outcome, a level or a band. The answer columns are
 * the share's evidence (the students counted); a roster student with too few
 * counted answers is outside it, in its own column.
 */
function figureRow(name, f, ev) {
  const s = f.students;
  const ne = f.outside.notEnoughEvidence;
  return html`<tr>
<td>${name}</td>
<td class="n">${s.roster}</td><td class="n">${s.counted}</td><td class="n">${s.attained}</td><td class="n">${s.notAttained}</td>
<td class="n">${s.notEnoughEvidence}${s.withNoAnswers ? html`<small>${s.withNoAnswers} with no answers</small>` : ''}</td>
<td class="n">${pctCell(f.share)}</td><td>${levelBadge(f.attainmentLevel)}</td>
${TYPES.map((t) => html`<td class="n">${f.marks[t].answers}${f.marks[t].answers ? html`<small>${f.marks[t].obtained} / ${f.marks[t].possible}</small>` : ''}</td>`)}
<td class="n">${ne.answers}${ne.answers ? html`<small>from ${ne.students} student${ne.students === 1 ? '' : 's'}</small>` : ''}</td>
</tr>`;
}

function figureHead(first, ev) {
  return html`<thead><tr>
<th>${first}</th><th class="n">On the roster</th><th class="n">Counted</th><th class="n">Attained</th><th class="n">Not attained</th>
<th class="n">Not enough evidence</th><th class="n">% attained</th><th>Class level</th>
${TYPES.map((t) => html`<th class="n">${cap(TYPE_COLUMN[t])}<small>behind the share; ${countedWord(ev[t])}</small></th>`)}
<th class="n">Outside the share<small>counted answers of roster students with not enough evidence</small></th>
</tr></thead>`;
}

/** The counted marks behind each figure's share, by who wrote the question. */
function sourceFigures(first, figures) {
  return html`<table>
<thead><tr><th>${first}</th>${SOURCES.map((s) => html`<th class="n">${cap(SOURCE_COLUMN[s])}<small>counted answers behind the share</small></th>`)}</tr></thead>
<tbody>
${figures.map(([name, f]) => html`<tr><td>${name}</td>${SOURCES.map((s) => {
    const m = f.marks.questionSources[s];
    return html`<td class="n">${m.answers}${m.answers ? html`<small>${m.obtained} / ${m.possible}</small>` : ''}</td>`;
  })}</tr>`)}
</tbody>
</table>`;
}

/** Students by groups (outcomes, levels or bands), six groups to a table so a landscape page holds them. */
function studentMatrix(students, groups) {
  return chunk(groups, 6).map((part) => html`<table>
<thead><tr><th>Roll No</th><th>Name</th><th>Status</th>${part.map((g) => html`<th>${g.name}</th>`)}</tr></thead>
<tbody>
${students.map((s) => html`<tr><td>${s.rollNo}</td><td>${s.name}</td><td>${s.statusLabel}</td>${part.map((g) => {
    const cell = g.cellOf(s);
    const left = TYPES.filter((t) => !cell.marks[t].counted).reduce((n, t) => n + cell.marks[t].answers, 0);
    // Marks, then answers: with topic weights the two differ.
    return html`<td>${stateBadge(cell)}<small>${cell.possible ? `${marksText(cell)}, ${cell.answers} answer${cell.answers === 1 ? '' : 's'}` : 'no counted answers'}${left ? `; ${left} not counted` : ''}</small></td>`;
  })}</tr>`)}
</tbody>
</table>`);
}

function recordsSection(t) {
  return html`<section class="page">
<h2>Teacher records</h2>
<div class="records">
<p><strong>${t.label}.</strong> ${t.note}</p>
<table>
<thead><tr><th>Record</th><th>Kind</th><th class="n">Count</th></tr></thead>
<tbody>
${teacherRecordRows(t).map(([record, kind, n]) => html`<tr><td>${record}</td><td>${kind}</td><td class="n">${n}</td></tr>`)}
</tbody>
</table>
</div>
</section>`;
}

function footer(r) {
  return html`<section class="page">
<h2>Definitions</h2>
<dl class="facts">
${Object.entries(r.definitions).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
</dl>
</section>
<footer><p>${r.privacy}</p></footer>`;
}

/** The answers of each type a report holds, polls included, for the evidence table. */
const typeCounts = (byType, ungraded) => ({ ...byType, ungraded });

const pickLabel = (id) => PICK_STATUSES.find((s) => s.id === id)?.label ?? 'Pending';

/* ---------------------------------------------------------- the reports -- */

/** The class's course-outcome and Bloom attainment, from classAttainment's report. */
export function attainmentHtml(r, { now = new Date() } = {}) {
  const ev = r.formula.config.evidence;
  const outcomeGroups = r.outcomes.map((o, i) => ({ name: o.archived ? `${o.code} (archived)` : o.code, cellOf: (s) => s.outcomes[i] }));
  const bandGroups = r.bloom.bands.map((b, i) => ({ name: b.label, cellOf: (s) => s.bloom.bands[i] }));
  const levelGroups = r.bloom.levels.map((l, i) => ({ name: l.label, cellOf: (s) => s.bloom.levels[i] }));
  const body = html`${header('Course-outcome attainment', r.class, { now })}
${about(r, { counts: typeCounts(r.answers.byType, r.answers.ungraded), sourceCounts: r.answers.bySource })}
<section class="page">
<h2>Course outcomes: the class</h2>
<p>${answersText(r.answers)}</p>
${r.outcomes.length ? html`<table>
<thead><tr><th>Outcome</th><th>Statement</th><th>Target Bloom level</th><th>Mapped to</th></tr></thead>
<tbody>
${r.outcomes.map((o) => html`<tr><td>${o.code}${o.archived ? html`<small>archived</small>` : ''}</td><td>${o.statement}</td><td>${o.targetLevel ? LABEL[o.targetLevel] : ''}</td><td>${mappedText(o)}</td></tr>`)}
</tbody>
</table>
<table>
${figureHead('Outcome', ev)}
<tbody>
${r.outcomes.map((o) => figureRow(o.code, o, ev))}
</tbody>
</table>
<h3>Who wrote the questions behind each share</h3>
${sourceFigures('Outcome', r.outcomes.map((o) => [o.code, o]))}
<ul>
${r.outcomes.map((o) => html`<li><strong>${o.code}</strong>: ${o.summary}</li>`)}
</ul>` : html`<p>This class has no course outcomes yet.</p>`}
<h3>Not mapped to any outcome</h3>
<p>${unmappedText(r.unmapped)}</p>
</section>
<section class="page">
<h2>Bloom attainment: the class</h2>
<p class="note">Decision 6's three level bands first, then the six levels. Every marked answer counts at its question's level, mapped to an outcome or not.</p>
<table>
${figureHead('Band or level', ev)}
<tbody>
${r.bloom.bands.map((b) => figureRow(b.label, b, ev))}
${r.bloom.levels.map((l) => figureRow(l.label, l, ev))}
</tbody>
</table>
<h3>Who wrote the questions behind each share</h3>
${sourceFigures('Band or level', [...r.bloom.bands, ...r.bloom.levels].map((f) => [f.label, f]))}
<ul>
${[...r.bloom.bands, ...r.bloom.levels].map((f) => html`<li><strong>${f.label}</strong>: ${f.summary}</li>`)}
</ul>
</section>
<section class="page wide">
<h2>Students by course outcome</h2>
<p class="note">In roll-number order: the roster, then removed students with evidence, then roll numbers not on the roster; never ranked. Only students on the roster now are counted in the class figures.</p>
${outcomeGroups.length ? studentMatrix(r.students, outcomeGroups) : html`<p>No course outcomes yet.</p>`}
${rollNotesList(r.rollNotes)}
</section>
<section class="page wide">
<h2>Students by Bloom level band and level</h2>
<p class="note">In roll-number order; never ranked.</p>
${studentMatrix(r.students, bandGroups)}
${studentMatrix(r.students, levelGroups)}
</section>
${recordsSection(r.teacherRecords)}
${footer(r)}`;
  return page(`Course-outcome attainment: ${classLine(r.class)}`, body);
}

/** The marks register, from marksRegister's report. */
export function registerHtml(r, { now = new Date() } = {}) {
  const ev = r.formula.config.evidence;
  const counts = { ungraded: 0 };
  for (const t of TYPES) counts[t] = 0;
  const sourceCounts = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  for (const s of r.students) {
    for (const t of TYPES) counts[t] += s.total.marks[t].answers;
    counts.ungraded += s.total.marks.ungraded.answers;
    for (const src of SOURCES) sourceCounts[src] += s.total.marks.questionSources[src].answers + s.total.marks.questionSources[src].notCounted;
  }
  const roomParts = chunk(r.rooms.map((room, i) => ({ room, i })), 6);
  const body = html`${header('Marks register', r.class, { now })}
${about(r, { counts, sourceCounts, register: true })}
<section class="page wide">
<h2>The register</h2>
<p class="note">In roll-number order; never ranked. One question is one mark. ${r.definitions.absent}</p>
${roomParts.map((part) => html`<table>
<thead><tr><th>Roll No</th><th>Name</th><th>Status</th>${part.map(({ room }) => html`<th>${room.code}<small>${room.day}</small></th>`)}</tr></thead>
<tbody>
${r.students.map((s) => html`<tr><td>${s.rollNo}</td><td>${s.name}</td><td>${s.statusLabel}</td>${part.map(({ i }) => {
    const c = s.rooms[i];
    const mark = c.attendance ? ATTENDANCE_LABEL[c.attendance] : (c.joined ? 'Joined (not on the roster)' : 'Not on the roster');
    return html`<td>${c.answered ? marksText(c.counted) : 'No answers'}<small>${mark}</small></td>`;
  })}</tr>`)}
</tbody>
</table>`)}
${rollNotesList(r.rollNotes)}
<h3>Totals</h3>
<table>
<thead><tr><th>Roll No</th><th>Name</th><th class="n">Marks</th><th class="n">%</th>
${typeHeads(ev)}
<th class="n">Polls</th><th class="n">Present</th><th class="n">Late</th><th class="n">Absent</th><th class="n">Unmarked</th></tr></thead>
<tbody>
${r.students.map((s) => {
    const att = s.total.attendance;
    return html`<tr><td>${s.rollNo}</td><td>${s.name}</td><td class="n">${s.total.counted.obtained} / ${s.total.counted.possible}</td><td class="n">${pctCell(s.total.counted.share)}</td>
${TYPES.map((t) => html`<td class="n">${s.total.marks[t].answers}</td>`)}<td class="n">${s.total.marks.ungraded.answers}</td>
${att ? html`<td class="n">${att.present}</td><td class="n">${att.late}</td><td class="n">${att.absent}</td><td class="n">${att.unmarked}</td>` : html`<td colspan="4">Not on the roster</td>`}</tr>`;
  })}
</tbody>
</table>
</section>
<section class="page">
<h2>Teacher records</h2>
<div class="records">
<p><strong>Not part of the register.</strong> Observations, wheel picks, hand tallies and activities are not marks (decision 3). They are reported in their own section of the attainment report and of each student's report, never in a cell here.</p>
</div>
</section>
${footer(r)}`;
  return page(`Marks register: ${classLine(r.class)}`, body);
}

/** One student's attainment with the answers behind it, from studentAttainment's report. */
export function studentHtml(r, { now = new Date() } = {}) {
  const ev = r.formula.config.evidence;
  const s = r.student;
  const tally = (list) => ['attained', 'not-attained', 'not-enough-evidence']
    .map((id) => `${list.filter((x) => x.state === id).length} ${id.replace(/-/g, ' ')}`).join(', ');
  const typeLabel = (id) => r.evidenceTypes.find((t) => t.id === id)?.label ?? 'Poll (not marked)';
  const cellRow = (name, extra, cell) => html`<tr><td>${name}</td>${extra}<td>${stateBadge(cell)}</td><td class="n">${cell.answers}</td>
<td class="n">${cell.obtained} / ${cell.possible}</td><td class="n">${pctCell(cell.share)}</td>
${TYPES.map((t) => html`<td class="n">${cell.marks[t].answers}</td>`)}</tr>`;
  const cellHead = (first, extra) => html`<thead><tr><th>${first}</th>${extra}<th>State</th><th class="n">Answers counted</th><th class="n">Marks</th><th class="n">%</th>
${typeHeads(ev)}</tr></thead>`;
  const t = r.teacherRecords;

  const body = html`${header('Student attainment report', r.class, {
    now, lines: [`${s.rollNo} ${s.name} (${s.statusLabel})`, `Course outcomes: ${tally(r.outcomes)}.`],
  })}
${about(r, { counts: typeCounts(r.answerCounts.byType, r.answerCounts.ungraded), sourceCounts: r.answerCounts.bySource })}
<section class="page">
<h2>Course outcomes</h2>
${r.outcomes.length ? html`<table>
${cellHead('Outcome', html`<th>Statement</th>`)}
<tbody>
${r.outcomes.map((o) => cellRow(o.archived ? `${o.code} (archived)` : o.code, html`<td>${o.statement}</td>`, o))}
</tbody>
</table>` : html`<p>This class has no course outcomes yet.</p>`}
<h3>Bloom level bands and levels</h3>
<table>
${cellHead('Band or level', '')}
<tbody>
${r.bloom.bands.map((b) => cellRow(b.label, '', b))}
${r.bloom.levels.map((l) => cellRow(l.label, '', l))}
</tbody>
</table>
</section>
<section class="page">
<h2>The answers behind it</h2>
<p class="note">Every answer this student gave in the rooms included, oldest first, with its evidence type and whether it counted.</p>
<table>
<thead><tr><th>Room</th><th>Question</th><th>Bloom level</th><th class="n">Mark</th><th>Evidence</th><th>Counted</th><th>Outcomes</th></tr></thead>
<tbody>
${r.answers.map((a) => html`<tr>
<td>${a.room?.code ?? ''}<small>${String(a.answeredAt ?? '').slice(0, 10)}</small></td>
<td>${a.snapshot?.text ?? a.question?.text ?? ''}<small>${a.topic ? `Topic: ${a.topic}. ` : ''}${typeof a.response === 'string' && a.response.trim() ? `Answer: ${a.response}` : ''}</small></td>
<td>${LABEL[a.level] ?? ''}</td>
<td class="n">${a.ungraded ? 'Poll' : a.score ?? ''}</td>
<td>${typeLabel(a.evidenceType)}<small>${r.questionSources.find((s) => s.id === a.questionSourceType)?.label ?? ''}</small></td>
<td>${a.counts ? 'Yes' : 'No'}<small>${a.note}</small></td>
<td>${a.outcomes.map((o) => o.code).join(', ')}</td>
</tr>`)}
</tbody>
</table>
</section>
<section class="page">
<h2>Teacher records</h2>
<div class="records">
<p><strong>${t.label}.</strong> ${t.note}</p>
<h3>Observations (the mark in force each day)</h3>
${t.observations.days.length ? html`<table>
<thead><tr><th>Day</th><th>Observation</th><th>Note</th></tr></thead>
<tbody>
${t.observations.days.map((d) => html`<tr><td>${d.day}</td><td>${d.label}</td><td>${d.note}</td></tr>`)}
</tbody>
</table>` : html`<p>None recorded in these rooms.</p>`}
<h3>Wheel picks</h3>
${t.picks.list.length ? html`<table>
<thead><tr><th>Room</th><th class="n">Round</th><th>Response</th></tr></thead>
<tbody>
${t.picks.list.map((p) => html`<tr><td>${p.room ?? ''}</td><td class="n">${p.round}</td><td>${pickLabel(p.status)}</td></tr>`)}
</tbody>
</table>` : html`<p>None in these rooms.</p>`}
</div>
</section>
${footer(r)}`;
  return page(`Student attainment report: ${classLine(r.class)}`, body);
}
