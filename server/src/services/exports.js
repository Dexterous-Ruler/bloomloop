// Phase 4 - the reports as files a college keeps: CSV sheets that open in a
// spreadsheet, and the names and headers every report file is sent with. The
// printable pages are in services/printable.js. Both are drawn from the JSON
// report of the same request (routes/attainment.js, routes/outcomes.js) and
// compute nothing again, so a file can never disagree with the screen.
//
// Every sheet starts with rows that describe it, a label in column A and its
// value in column B: the class, the period, the rooms, the formula with its
// exact parameters, the methodology paragraph, the evidence types, the question
// sources, what each roll number off the roster is, how to keep roll numbers
// exactly (import them as text), and the formula-injection guard. A blank row follows; then each table, as its title
// on one row and its column names on the next. One file rather than a sheet and
// a separate method file, so the numbers can never travel without the rules
// that made them; spreadsheets open leading rows as they are, and a program
// wanting one table reads from its title row (docs/API.md, "CSV and print").
//
// Students come in the report's own order (roll number), never sorted or
// numbered by a mark. Teacher records are a table of their own at class level
// only: a sheet is filtered and mailed a row at a time, and a "needs additional
// support" count beside a name is the kind of label the product refuses to
// print (decision 3; the roadmap's "Labels and leaderboards"). Each student's
// records are in that student's report.
//
// Staff only, like the reports they come from.

import { LABEL } from '../bloom.js';
import { roomWeightText, savedDay } from './attainment.js';
import { CSV_GUARD_NOTE, toCsv } from './csv.js';
import { COVERAGE_DEFINITIONS } from './outcomes.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/* ------------------------------------------------------- format and file -- */

export const KEY_IN_ADDRESS = 'A printable page or a sheet cannot be opened with the teacher key in its address: the browser '
  + 'prints the address on the page and keeps it in its history, and a sheet\'s address is saved with the download. Send the '
  + 'key in the x-teacher-key header instead.';

/**
 * ?format= on a report route: json when left out, else one of `allowed`. Read
 * after the ownership check, so an outsider learns nothing from the 400.
 *
 * A file (csv or html) with the shared teacher key in its query string (?key=,
 * which teacherAuth.js accepts in place of the header) is a 400: the address of
 * a printed page is printed on it, and stays in the browser's history and the
 * download's record. The console fetches a file with the header and opens it
 * from a blob instead.
 */
export function reportFormat(query = {}, allowed = ['json']) {
  const raw = query.format;
  if (raw === undefined || raw === '') return 'json';
  const format = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!allowed.includes(format)) throw fail(`format must be one of ${allowed.join(', ')} (json when left out).`, 400);
  if (format !== 'json' && query.key !== undefined) throw fail(KEY_IN_ADDRESS, 400);
  return format;
}

export const SHEETS = Object.freeze(['outcomes', 'bloom']);

/** ?sheet= on the class report's CSV: the course-outcome sheet (the default) or the Bloom sheet. */
export function sheetFrom(query = {}, format = 'json') {
  const raw = query.sheet;
  if (raw === undefined || raw === '') return 'outcomes';
  if (format !== 'csv') throw fail('sheet chooses a CSV sheet; send it with format=csv.', 400);
  const sheet = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!SHEETS.includes(sheet)) throw fail(`sheet must be ${SHEETS.join(' or ')}.`, 400);
  return sheet;
}

// India keeps one time zone and no daylight saving: the same rule as roomDay.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const indiaTime = (now) => new Date(now.getTime() + IST_OFFSET_MS).toISOString();

/** "2026-11-19 14:03 (India time)": when a file was made. */
export const generatedText = (now = new Date()) => `${indiaTime(now).slice(0, 10)} ${indiaTime(now).slice(11, 16)} (India time)`;

/** Lower-case ASCII letters and digits, runs of anything else one hyphen. Devanagari and the like drop out. */
const slug = (text, max = 40) => String(text ?? '')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .slice(0, max)
  .replace(/^-+|-+$/g, '');

/**
 * A report file's name: bloomloop-<report>-<course>-<section>-<class>-<day>.<ext>,
 * ASCII only, so it needs no encoding in Content-Disposition and nothing in it
 * can break the header. A class has no code of its own, so the first eight
 * characters of its id stand for it (two sections of one course in two terms
 * stay apart). The class's own course and section are the only words in it: no
 * student's name or roll number, even for one student's report.
 */
export function exportFilename(cls, kind, ext, now = new Date()) {
  const classCode = String(cls?._id ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 8).toLowerCase();
  const parts = ['bloomloop', slug(kind), slug(cls?.courseName), slug(cls?.section), classCode, indiaTime(now).slice(0, 10)];
  return `${parts.filter(Boolean).join('-')}.${ext}`;
}

/**
 * The printable page's policy: nothing may load or run but its own inline
 * style. Carried in the page too (a <meta>), so it holds when the console opens
 * the page from a blob or srcdoc, where no response header reaches it.
 */
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'";

/** Headers for a report file. Never cached: it names students, and the next request may differ. */
export function fileHeaders(format, filename) {
  const common = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (format === 'csv') {
    return { ...common, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` };
  }
  return {
    ...common,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `inline; filename="${filename}"`,
    // frame-ancestors only works as a header.
    'Content-Security-Policy': `${PAGE_CSP}; frame-ancestors 'self'`,
  };
}

/* ----------------------------------------------------------- the words -- */

// The report's own type order (EVIDENCE_TYPES in services/attainment.js). A
// re-vote after discussion (Phase 5) comes last, and no formula counts it.
export const TYPES = Object.freeze(['digital', 'aiProvisional', 'humanReviewed', 'revote']);
/** What one answer of each type is called in a column, as restsOn says them. */
export const TYPE_COLUMN = Object.freeze({
  digital: 'digital answers',
  aiProvisional: 'provisional written answers',
  humanReviewed: 'reviewed written answers',
  revote: 're-votes after discussion',
});

// Who wrote the question (QUESTION_SOURCES in services/attainment.js), in its order.
export const SOURCES = Object.freeze(['aiGenerated', 'professorWritten', 'offlineTemplate']);
/** Each question source as a column says it. */
export const SOURCE_COLUMN = Object.freeze({
  aiGenerated: 'AI-generated questions',
  professorWritten: 'professor-written questions',
  offlineTemplate: 'offline-template questions (and professor-written before 19 Nov 2026)',
});

/** The leading row every sheet that lists roll numbers carries: how to keep them exactly. */
export const ROLL_NUMBERS_AS_TEXT = 'Roll numbers are text. A spreadsheet that opens this file directly may drop a leading '
  + 'zero (0042 becomes 42) or show a long roll number in scientific notation. To keep them exactly, import the file '
  + 'instead: Data > From Text/CSV, then set the Roll No column\'s type to Text.';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const countedWord = (on) => (on ? 'counted' : 'not counted');

/** A share (0 to 1) as a percentage with at most two decimals, or null for none. */
export const percentOf = (share) => (share === null || share === undefined ? null : Math.round(share * 10000) / 100);
const pctText = (share) => `${Number((share * 100).toFixed(1))}%`;

export const ATTENDANCE_LABEL = Object.freeze({ present: 'Present', late: 'Late', absent: 'Absent', unmarked: 'Unmarked' });

export const classLine = (c) => [c.courseName, c.section, c.termLabel].filter(Boolean).join(', ');

/** Which rooms a report counts, in words, from its `window`. */
export function periodText(window = {}) {
  const parts = [];
  if (window.from && window.to) parts.push(`rooms opened from ${window.from} to ${window.to}`);
  else if (window.from) parts.push(`rooms opened on or after ${window.from}`);
  else if (window.to) parts.push(`rooms opened on or before ${window.to}`);
  if (window.rooms?.length) parts.push(`only the rooms ${window.rooms.join(', ')}`);
  return parts.length ? `${cap(parts.join('; '))} (days in India's time)` : 'Every room of the class (no dates or rooms chosen)';
}

/** One room as a report names it. `weights`: whether room weights apply (not in the register). */
export const roomLine = (r, { weights = true } = {}) => `${r.code}, opened ${r.day}${r.title ? `, "${r.title}"` : ''}`
  + `${weights && r.weight !== 1 ? `, weight ${r.weight}` : ''}`;

/** The formula a report used, in one line: which, which version, and whether it is the default example. */
export function formulaLabel(formula) {
  if (formula.source === 'example') {
    return `"${formula.preset.name}". No formula has been saved for this class, so the default example is used: an example `
      + 'to start from, not an institutional standard';
  }
  const when = formula.savedAt ? `, saved ${savedDay(formula.savedAt)}` : '';
  const same = formula.preset ? `; the same as the example "${formula.preset.name}" (an example, not an institutional standard)` : '';
  return `Version ${formula.version} of this class's own formula${when}${same}`;
}

/**
 * The formula's parameters, one per line, as [name, value]. The register uses
 * only the evidence types and the attempts rule, and says the rest do not apply.
 */
export function formulaParameters(formula, { register = false } = {}) {
  const c = formula.config;
  const counted = TYPES.filter((t) => c.evidence[t]).map((t) => TYPE_COLUMN[t]);
  const shown = TYPES.filter((t) => !c.evidence[t]).map((t) => TYPE_COLUMN[t]);
  const evidence = [
    ['Evidence counted', counted.join('; ')],
    ['Evidence shown, not counted', shown.length ? shown.join('; ') : 'none'],
    ['Teacher records', 'never counted (decision 3)'],
    ['Attempts', c.attempts === 'best'
      ? `best attempt at each question${register ? ', within each room' : ', across attempts and rooms'}; a written answer's `
        + 'attempt followed by a retry is left out, since only a final attempt can be reviewed'
      : 'final attempts (an attempt followed by a retry is left out)'],
  ];
  if (register) {
    return [...evidence, ['Not applied in the register', 'the student threshold, the minimum answers, the class levels, course outcomes and room weights']];
  }
  const weights = formula.roomWeights ?? c.roomWeights.map((w) => ({ ...w, code: null, found: false }));
  return [
    ['Student threshold', `${pctText(c.studentThreshold)} of the marks possible`],
    ['Minimum counted answers', `${c.minAnswers}, per outcome or level; fewer is "not enough evidence", never "not attained"`],
    // A first level at 0% is reached by any class counted, so there is no level
    // 0 to state (the methodology leaves it out too).
    ['Class levels', `${c.levels.map((l) => `level ${l.level} from ${pctText(l.minShare)}`).join(', ')} of the students counted`
      + `${c.levels[0].minShare > 0 ? `; level 0 below ${pctText(c.levels[0].minShare)}` : ''}`],
    ...evidence,
    ['Room weights', weights.length
      ? weights.map(roomWeightText).join('; ') + '; every other room x 1'
      : 'none: every room counts 1'],
  ];
}

/** The class report's answer totals in one sentence. */
export function answersText(a) {
  return `${plural(a.rows, 'attempt')} stored in these rooms; ${a.setAside} set aside by the attempts rule; `
    + `${plural(a.graded, 'marked answer')} (${a.byType.digital} digital, ${a.byType.humanReviewed} reviewed written, `
    + `${a.byType.aiProvisional} provisional written, ${a.byType.revote ?? 0} re-votes after discussion, never counted), of `
    + `which ${a.mapped} reach a course outcome, ${a.excluded} are `
    + `excluded from every outcome by an override and ${a.unmapped} reach none; by who wrote the question, `
    + `${listed(SOURCES.map((s) => `${a.bySource?.[s] ?? 0} on ${SOURCE_COLUMN[s]}`))}; `
    + `${plural(a.ungraded, 'poll')} (not marked).`;
}

const listed = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** What every roll number off the roster is, in one cell. */
export const rollNotesText = (notes = []) => (notes.length ? notes.map((n) => n.note).join(' ')
  : 'None: every answer and phone here is a roster student\'s.');

/** What reaches no outcome, by chapter and topic. */
export function unmappedText(unmapped = []) {
  if (!unmapped.length) return 'Nothing: every marked answer reaches a course outcome or is excluded by an override.';
  return unmapped.map((u) => `${u.chapter ?? 'a chapter since deleted'} / ${u.topic || '(no topic)'}: ${plural(u.answers, 'answer')}`
    + `${u.inChapter ? '' : ' (that topic is not in the chapter\'s list now)'}`).join('; ');
}

/** An outcome's mapping in words: its topics with their weights, and questions mapped to it directly. */
export function mappedText(o) {
  const parts = (o.topics ?? []).map((t) => `${t.chapter ?? 'a chapter since deleted'} / ${t.topic}`
    + `${t.weight !== 1 ? ` (weight ${t.weight})` : ''}${t.inChapter ? '' : ' (not in the chapter\'s list now)'}`);
  if (o.directQuestions) parts.push(`${plural(o.directQuestions, 'question')} mapped to it directly`);
  return parts.length ? parts.join('; ') : 'nothing mapped';
}

/** The teacher-records summary as [record, kind, count] rows. */
export function teacherRecordRows(t) {
  return [
    ...t.observations.kinds.map((k) => ['Observations (student-days, the mark in force)', k.label, t.observations.counts[k.id] ?? 0]),
    ...t.picks.statuses.map((s) => ['Wheel picks, by response', s.label, t.picks.counts[s.id] ?? 0]),
    ['Hand tallies', 'Questions asked aloud', t.tallies.questions],
    ['Hand tallies', 'Hands raised, in all', t.tallies.hands],
    ...t.activities.kinds.map((k) => ['Activities', k.label, t.activities.counts[k.id] ?? 0]),
  ];
}

/* ------------------------------------------------------------ the sheets -- */

const HOW_TO_READ = 'These first rows describe the report: a label in column A, its value in column B. After the blank row, '
  + 'each table starts with its title on one row and its column names on the next; tables are separated by a blank row.';

const TEACHER_RECORDS_NOTE = 'Observations, wheel picks, hand tallies and activities are listed in their own table at the '
  + 'end, at class level. They never enter a mark, a share, a state or a level (decision 3). Each student\'s are in that '
  + 'student\'s report.';

/** The rows every attainment sheet and the register start with. */
function reportMeta(title, r, { now, register = false }) {
  return [
    ['BloomLoop', title],
    ['Class', r.class.courseName],
    ['Section', r.class.section],
    ['Term', r.class.termLabel ?? ''],
    ['Generated', generatedText(now)],
    ['Period', periodText(r.window)],
    ['Rooms counted', r.rooms.length],
    ['Rooms', r.rooms.map((room) => roomLine(room, { weights: !register })).join('; ') || 'none'],
    ['Formula', formulaLabel(r.formula)],
    ['Formula version', r.formula.version],
    ...formulaParameters(r.formula, { register }).map(([name, value]) => [`Formula: ${name}`, value]),
    ['Formula, exactly as stored', JSON.stringify(r.formula.config)],
    ['Methodology', r.methodology],
    ['Evidence types', r.evidenceTypes.map((t) => `${t.label}: ${t.description}`).join(' ')],
    ['Question sources', r.questionSources.map((s) => `${s.label}: ${s.description}`).join(' ')],
    ['Roll numbers not on the roster', rollNotesText(r.rollNotes)],
    ['Privacy', r.privacy],
    ['How to read this file', HOW_TO_READ],
    ['Roll numbers', ROLL_NUMBERS_AS_TEXT],
    ['Formula guard', CSV_GUARD_NOTE],
  ];
}

/** One student's columns on one outcome, level or band. */
function groupHeaders(name, evidence) {
  return [
    `${name} state`, `${name} answers counted`, `${name} marks obtained`, `${name} marks possible`, `${name} %`,
    ...TYPES.map((t) => `${name} ${TYPE_COLUMN[t]} (${countedWord(evidence[t])})`),
  ];
}
const groupCells = (cell) => [
  cell.stateLabel, cell.answers, cell.obtained, cell.possible, percentOf(cell.share), ...TYPES.map((t) => cell.marks[t].answers),
];

/**
 * One class figure's columns (an outcome, a level or a band). The answer and
 * mark columns are the share's evidence: the answers of the students counted.
 * A roster student with too few counted answers is outside the share, with
 * their answers in columns of their own, as are removed students and roll
 * numbers off the roster. The counted marks are split again by who wrote the
 * question.
 */
function figureHeaders(evidence) {
  return [
    'Students on the roster', 'Counted (attained or not attained)', 'Attained', 'Not attained', 'Not enough evidence',
    'Not enough evidence: no counted answer at all', '% of counted who attained', 'Attainment level',
    ...TYPES.flatMap((t) => [`${cap(TYPE_COLUMN[t])} behind the share (${countedWord(evidence[t])})`,
      `${cap(TYPE_COLUMN[t])} behind the share: marks obtained`, `${cap(TYPE_COLUMN[t])} behind the share: marks possible`]),
    ...SOURCES.flatMap((s) => [`Counted answers behind the share on ${SOURCE_COLUMN[s]}`,
      `Marks obtained behind the share on ${SOURCE_COLUMN[s]}`, `Marks possible behind the share on ${SOURCE_COLUMN[s]}`]),
    'Polls behind the share (not marked)',
    'Roster students with not enough evidence who have counted answers (outside the share)', 'Their counted answers',
    'Removed students with evidence (not counted)', 'Their answers',
    'Roll numbers not on the roster with evidence (not counted)', 'Their answers', 'Summary',
  ];
}
function figureCells(f) {
  const s = f.students;
  const ne = f.outside.notEnoughEvidence;
  return [
    s.roster, s.counted, s.attained, s.notAttained, s.notEnoughEvidence, s.withNoAnswers, percentOf(f.share), f.attainmentLevel,
    ...TYPES.flatMap((t) => [f.marks[t].answers, f.marks[t].obtained, f.marks[t].possible]),
    ...SOURCES.flatMap((src) => [f.marks.questionSources[src].answers, f.marks.questionSources[src].obtained,
      f.marks.questionSources[src].possible]),
    f.marks.ungraded.answers, ne.students, ne.answers, f.outside.removed.students, f.outside.removed.answers,
    f.outside.notOnRoster.students, f.outside.notOnRoster.answers, f.summary,
  ];
}

const recordsTable = (t) => [
  [t.label],
  ['Record', 'Kind', 'Count'],
  ...teacherRecordRows(t),
  ['Note', t.note],
];

/**
 * The course-outcome attainment sheet (GET /api/classes/:id/attainment?format=csv):
 * each outcome's class row with its level, then the students by outcome, then
 * the teacher records. `r` is classAttainment's report.
 */
export function attainmentCsv(r, { now = new Date() } = {}) {
  const ev = r.formula.config.evidence;
  return toCsv([
    ...reportMeta('Course-outcome attainment sheet', r, { now }),
    ['Answers', answersText(r.answers)],
    ['Not mapped to any outcome', unmappedText(r.unmapped)],
    ['Teacher records', TEACHER_RECORDS_NOTE],
    [],
    ['Course outcomes: the class'],
    ['Course outcome', 'Statement', 'Target Bloom level', 'Archived', 'Mapped to', ...figureHeaders(ev)],
    ...r.outcomes.map((o) => [
      o.code, o.statement, o.targetLevel ? LABEL[o.targetLevel] : '', o.archived ? 'yes' : 'no', mappedText(o), ...figureCells(o),
    ]),
    [],
    ['Students by course outcome, in roll-number order (never ranked)'],
    ['Roll No', 'Name', 'Status', ...r.outcomes.flatMap((o) => groupHeaders(o.archived ? `${o.code} (archived)` : o.code, ev))],
    ...r.students.map((s) => [s.rollNo, s.name, s.statusLabel, ...s.outcomes.flatMap(groupCells)]),
    [],
    ...recordsTable(r.teacherRecords),
  ]);
}

/**
 * The Bloom attainment sheet (?format=csv&sheet=bloom): decision 6's three level
 * bands first, then the six levels, as class rows and per student.
 */
export function bloomCsv(r, { now = new Date() } = {}) {
  const ev = r.formula.config.evidence;
  const { bands, levels } = r.bloom;
  return toCsv([
    ...reportMeta('Bloom attainment sheet', r, { now }),
    ['Answers', answersText(r.answers)],
    ['Bloom levels', 'Every marked answer counts at its question\'s Bloom level, mapped to a course outcome or not; topic '
      + 'weights do not apply, room weights do.'],
    ['Teacher records', TEACHER_RECORDS_NOTE],
    [],
    ['Bloom level bands and levels: the class'],
    ['Band or level', 'Levels included', ...figureHeaders(ev)],
    ...bands.map((b) => [b.label, b.levels.map((l) => LABEL[l]).join(' and '), ...figureCells(b)]),
    ...levels.map((l) => [l.label, l.label, ...figureCells(l)]),
    [],
    ['Students by Bloom level band and level, in roll-number order (never ranked)'],
    ['Roll No', 'Name', 'Status', ...bands.flatMap((b) => groupHeaders(b.label, ev)), ...levels.flatMap((l) => groupHeaders(l.label, ev))],
    ...r.students.map((s) => [s.rollNo, s.name, s.statusLabel, ...s.bloom.bands.flatMap(groupCells), ...s.bloom.levels.flatMap(groupCells)]),
    [],
    ...recordsTable(r.teacherRecords),
  ]);
}

/**
 * The marks register (GET /api/classes/:id/register?format=csv): per student,
 * each room's attendance mark and marks obtained of possible, then the totals.
 * A room with no answer is 0 of 0 with an empty %, exactly as the JSON gives it,
 * and the attendance mark beside it says why: never a zero.
 */
export function registerCsv(r, { now = new Date() } = {}) {
  const ev = r.formula.config.evidence;
  const roomName = (room) => `${room.code} ${room.day}`;
  return toCsv([
    ...reportMeta('Marks register', r, { now, register: true }),
    ['Answers', `${plural(r.answers.rows, 'attempt')} stored in these rooms; ${r.answers.setAside} set aside by the attempts `
      + `rule; ${r.answers.chosen} in the register (polls included, as a count).`],
    ['No answers in a room', r.definitions.absent],
    ['Teacher records', 'Not marks, and not in this register (decision 3): they are in their own section of the attainment '
      + 'report and of each student\'s report.'],
    [],
    ['Marks register, in roll-number order (never ranked)'],
    [
      'Roll No', 'Name', 'Status',
      ...r.rooms.flatMap((room) => [`${roomName(room)} attendance`, `${roomName(room)} marks obtained`,
        `${roomName(room)} marks possible`, `${roomName(room)} %`]),
      'Total marks obtained', 'Total marks possible', 'Total %',
      ...TYPES.map((t) => `Total ${TYPE_COLUMN[t]} (${countedWord(ev[t])})`),
      ...SOURCES.map((src) => `Total counted answers on ${SOURCE_COLUMN[src]}`),
      'Polls (not marked)', 'Present', 'Late', 'Absent', 'Unmarked',
    ],
    ...r.students.map((s) => {
      const att = s.total.attendance;
      return [
        s.rollNo, s.name, s.statusLabel,
        ...s.rooms.flatMap((c) => [ATTENDANCE_LABEL[c.attendance] ?? '', c.counted.obtained, c.counted.possible, percentOf(c.counted.share)]),
        s.total.counted.obtained, s.total.counted.possible, percentOf(s.total.counted.share),
        ...TYPES.map((t) => s.total.marks[t].answers),
        ...SOURCES.map((src) => s.total.marks.questionSources[src].answers), s.total.marks.ungraded.answers,
        ...(att ? [att.present, att.late, att.absent, att.unmarked] : [null, null, null, null]),
      ];
    }),
  ]);
}

/**
 * The course outcomes with their mappings (GET /api/classes/:id/outcomes?format=csv):
 * one row per outcome and topic, per question an override maps to it, and per
 * excluded question; an outcome with nothing mapped has a row saying so.
 * `body` is the outcome list as the route answers it; `formula` and
 * `methodology` are the class's formula in force, which the reports apply to
 * these mappings.
 */
export function outcomesCsv(body, { formula, methodology, now = new Date() } = {}) {
  const head = (o) => [o.code, o.statement, o.targetLevel ? LABEL[o.targetLevel] : '', o.archived ? 'Archived' : 'In use'];
  const question = (ov) => (ov.question
    ? [ov.question.chapter ?? '', '', null, '', ov.question.text, ov.question.topic, LABEL[ov.question.level] ?? '',
      ov.question.kind, ov.question.status ?? '', ov.questionId]
    : ['', '', null, '', '(the question has been deleted; the override still applies to its answers)', '', '', '', '', ov.questionId]);
  const rows = [];
  for (const o of body.outcomes) {
    const direct = body.overrides.filter((ov) => !ov.excluded && ov.outcomes.some((x) => x.id === o.id));
    for (const t of o.topics) {
      rows.push([...head(o), 'Topic', t.chapter ?? '', t.topic, t.weight, t.inChapter ? 'yes' : 'no', '', '', '', '', '', '']);
    }
    for (const ov of direct) rows.push([...head(o), 'Question (override)', ...question(ov)]);
    if (!o.topics.length && !direct.length) rows.push([...head(o), 'Nothing mapped yet', '', '', null, '', '', '', '', '', '', '']);
  }
  for (const ov of body.overrides.filter((x) => x.excluded)) {
    rows.push(['', '', '', '', 'Excluded from every outcome (override)', ...question(ov)]);
  }
  return toCsv([
    ['BloomLoop', 'Course outcomes and their mappings'],
    ['Class', body.class.courseName],
    ['Section', body.class.section],
    ['Term', body.class.termLabel ?? ''],
    ['Generated', generatedText(now)],
    ['How an answer reaches an outcome', `${COVERAGE_DEFINITIONS.resolution} ${COVERAGE_DEFINITIONS.topics} `
      + `${COVERAGE_DEFINITIONS.renamedTopics}`],
    ['Topic weights', COVERAGE_DEFINITIONS.weights],
    ['Teacher records', COVERAGE_DEFINITIONS.evidence],
    ['Formula in force', `${formulaLabel(formula)}. The attainment reports apply it to these mappings; this list itself counts nothing.`],
    ['Formula, exactly as stored', JSON.stringify(formula.config)],
    ['Methodology', methodology],
    ['Privacy', body.privacy],
    ['How to read this file', HOW_TO_READ],
    ['Formula guard', CSV_GUARD_NOTE],
    [],
    ['Course outcomes and what they are mapped to'],
    ['Course outcome', 'Statement', 'Target Bloom level', 'Status', 'Mapped by', 'Chapter', 'Topic', 'Topic weight',
      'Topic in the chapter\'s list now', 'Question', 'Question topic', 'Question Bloom level', 'Question kind', 'Question status',
      'Question id'],
    ...rows,
  ]);
}
