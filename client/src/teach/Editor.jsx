/**
 * Editing one question, or writing a new one, in a sheet beside the bank it
 * belongs to.
 *
 * Level and interaction are one decision: the level offers only its own
 * interactions, so retagging a question can change how it is asked, and the
 * editor fills in the shape the new interaction needs rather than leaving the
 * teacher to guess what the server will refuse.
 *
 * `question === null` is a question the teacher writes outright. It goes into
 * the bank as approved, since the person who wrote it is the person who would
 * approve it, and rooms can serve it at once.
 *
 * `onDone(info)` follows every action that worked. `info.note` is one sentence
 * for the bank to show afterwards (the checks that failed, the server's note,
 * where a new draft went), `info.tone` is 'ok' when nothing in it needs a
 * second look, and `info.retired` is the id an approval retired: the question
 * a regenerated draft replaced, which the bank names.
 */

import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { BLANK_MARK, KIND_LABEL, KIND_SHAPE } from '../lib/kinds.js';
import { Button, Dialog, Field, Icon, Level, Note, Segmented } from '../ui/index.jsx';
import { StimulusEditor, seedStimulus, stimulusFor } from './Media.jsx';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** As long as a topic may be (MAX_TOPIC_CHARS in server/src/routes/bank.js). */
const MAX_TOPIC = 160;

// What each kind sends. Anything not listed for the chosen kind stays out of
// the request, so a retag cannot smuggle a stale answer key along with it.
const FIELDS = {
  mcq: ['options', 'answerIdx'],
  truefalse: ['answerBool'],
  match: ['pairs'],
  categorise: ['buckets'],
  blank: ['accept'],
  cloze: ['blanks'],
  numeric: ['value', 'tolerance', 'unit'],
  multi: ['options', 'answerIdxs'],
  order: ['sequence'],
  rank: ['sequence', 'criterion'],
  open: ['rubric'],
  hottext: ['tokens', 'answerIdxs', 'criterion'],
  dropdown: ['blanks'],
  table: ['columns', 'rows'],
  grid: ['rows', 'columns', 'answers'],
};

const markers = (text) => String(text ?? '').split(BLANK_MARK).length - 1;
const arr = (v) => (Array.isArray(v) ? v : []);
const numText = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** One set of accepted answers per marker in the text, keeping what was typed. */
function syncBlanks(text, blanks) {
  const n = markers(text);
  return Array.from({ length: n }, (_, i) => ({ accept: arr(blanks[i]?.accept).length ? arr(blanks[i].accept) : [''] }));
}

/** One list of choices per marker, as cloze keeps its blanks in step with the text. */
function syncGaps(text, gaps) {
  const n = markers(text);
  return Array.from({ length: n }, (_, i) => ({
    options: arr(gaps[i]?.options).length ? arr(gaps[i].options) : ['', ''],
    answerIdx: Number.isInteger(gaps[i]?.answerIdx) ? gaps[i].answerIdx : 0,
  }));
}

/** A few words either side of a marker, so a teacher knows which gap is which. */
function around(parts, i) {
  const before = String(parts[i] ?? '').trim().split(/\s+/).slice(-4).join(' ');
  const after = String(parts[i + 1] ?? '').trim().split(/\s+/).slice(0, 4).join(' ');
  return `${before} ${BLANK_MARK} ${after}`;
}

/** Where a picked index lands once the row at `removed` is gone. */
function shiftIdx(idx, removed, length) {
  if (removed === undefined) return Math.min(idx, Math.max(0, length - 1));
  if (removed < idx) return idx - 1;
  return removed === idx ? 0 : idx;
}

/**
 * A hot text's sentence, split at the spaces, with each picked word followed to
 * wherever the edit moved it: the same position if it is still there, else
 * the nearest copy of the same word, else it is no longer picked.
 */
function retoken(sentence, d) {
  const tokens = sentence.split(/\s+/).filter(Boolean);
  const taken = new Set();
  for (const i of d.hotIdxs) {
    const word = d.tokens[i];
    let best = tokens[i] === word && !taken.has(i) ? i : -1;
    if (best < 0) {
      tokens.forEach((t, j) => {
        if (t === word && !taken.has(j) && (best < 0 || Math.abs(j - i) < Math.abs(best - i))) best = j;
      });
    }
    if (best >= 0) taken.add(best);
  }
  return { hotText: sentence, tokens, hotIdxs: [...taken].sort((a, b) => a - b) };
}

const givenCell = () => ({ mode: 'given', given: '', accept: [''] });
const writtenCell = () => ({ mode: 'accept', given: '', accept: [''] });

/** A table cell as the editor holds it: both sides kept, so the toggle loses nothing. */
const seedCell = (c) => (c?.accept !== undefined
  ? { mode: 'accept', given: '', accept: arr(c.accept).length ? arr(c.accept) : [''] }
  : { mode: 'given', given: c?.given ?? '', accept: [''] });

function seed(stored) {
  const q = stored ?? {};
  // Two kinds may store different shapes under one field name (hot text and
  // multi share answerIdxs, rank and hot text criterion, cloze and dropdown
  // blanks, table and grid rows and columns), so each is read into its own
  // slot by the kind that wrote it, and a swap between them starts clean.
  const kind = q.kind ?? (stored ? 'mcq' : null);
  const hot = kind === 'hottext';
  const tokens = hot ? arr(q.tokens).map(String) : [];
  return {
    text: q.text ?? '',
    bloom: q.bloom ?? null,
    kind,
    topic: '',
    options: arr(q.options),
    answerIdx: Number.isInteger(q.answerIdx) ? q.answerIdx : 0,
    answerIdxs: hot ? [] : arr(q.answerIdxs).map(Number),
    answerBool: typeof q.answerBool === 'boolean' ? q.answerBool : true,
    pairs: arr(q.pairs).map((p) => ({ left: p?.left ?? '', right: p?.right ?? '' })),
    buckets: arr(q.buckets).map((b) => ({ name: b?.name ?? '', items: arr(b?.items) })),
    sequence: arr(q.sequence),
    criterion: hot ? '' : q.criterion ?? '',
    accept: arr(q.accept),
    blanks: arr(q.blanks).map((b) => ({ accept: arr(b?.accept) })),
    value: numText(q.value),
    tolerance: numText(q.tolerance),
    unit: q.unit ?? '',
    rubric: arr(q.rubric),
    tokens,
    hotText: tokens.join(' '),
    hotIdxs: hot ? arr(q.answerIdxs).map(Number) : [],
    hotCriterion: hot ? q.criterion ?? '' : '',
    gaps: kind === 'dropdown'
      ? arr(q.blanks).map((b) => ({ options: arr(b?.options), answerIdx: Number.isInteger(b?.answerIdx) ? b.answerIdx : 0 }))
      : [],
    tableCols: kind === 'table' ? arr(q.columns).map(String) : [],
    tableRows: kind === 'table' ? arr(q.rows).map((r) => ({ header: r?.header ?? '', cells: arr(r?.cells).map(seedCell) })) : [],
    gridCols: kind === 'grid' ? arr(q.columns).map(String) : [],
    gridRows: kind === 'grid' ? arr(q.rows).map(String) : [],
    gridAnswers: kind === 'grid' ? arr(q.answers).map((r) => arr(r).map((v) => v === true)) : [],
    stim: seedStimulus(q.stimulus),
  };
}

/** The empty shape a kind needs, for whatever the draft does not already have. */
function fill(kind, d) {
  const next = {};
  const need = (field, value) => { if (!arr(d[field]).length) next[field] = value; };
  if (kind === 'mcq' || kind === 'multi') need('options', ['', '', '', '']);
  if (kind === 'multi' && !d.answerIdxs.length) next.answerIdxs = [d.answerIdx];
  if (kind === 'mcq' && d.answerIdxs.length) next.answerIdx = Math.min(...d.answerIdxs);
  if (kind === 'match') need('pairs', [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }]);
  if (kind === 'categorise') need('buckets', [{ name: '', items: ['', ''] }, { name: '', items: ['', ''] }]);
  if (kind === 'blank') need('accept', ['']);
  if (kind === 'cloze') next.blanks = syncBlanks(d.text, d.blanks);
  if (kind === 'numeric' && String(d.tolerance).trim() === '') next.tolerance = '0';
  if (kind === 'order' || kind === 'rank') need('sequence', ['', '', '']);
  if (kind === 'open') need('rubric', ['', '']);
  if (kind === 'dropdown') next.gaps = syncGaps(d.text, d.gaps);
  if (kind === 'table') {
    need('tableCols', ['', '']);
    need('tableRows', [0, 1].map(() => ({ header: '', cells: [givenCell(), writtenCell()] })));
  }
  if (kind === 'grid') {
    need('gridCols', ['', '']);
    need('gridRows', ['', '']);
    need('gridAnswers', [[false, false], [false, false]]);
  }
  return next;
}

/** The grid's ticks, cut or padded to exactly its rows and columns. */
const gridOf = (d) => d.gridRows.map((_, r) => d.gridCols.map((__, c) => d.gridAnswers[r]?.[c] === true));

// Where a field comes from when the draft keeps it under another name.
const OUT = {
  hottext: { answerIdxs: (d) => d.hotIdxs, criterion: (d) => d.hotCriterion },
  dropdown: { blanks: (d) => syncGaps(d.text, d.gaps) },
  table: {
    columns: (d) => d.tableCols,
    rows: (d) => d.tableRows.map((r) => ({
      header: r.header,
      cells: d.tableCols.map((_, c) => {
        const cell = r.cells[c] ?? writtenCell();
        return cell.mode === 'given' ? { given: cell.given } : { accept: cell.accept };
      }),
    })),
  },
  grid: { columns: (d) => d.gridCols, rows: (d) => d.gridRows, answers: gridOf },
};

function payload(d) {
  const out = { text: d.text, bloom: d.bloom, kind: d.kind };
  for (const field of FIELDS[d.kind] ?? []) {
    const from = OUT[d.kind]?.[field];
    if (from) out[field] = from(d);
    else if (field === 'value' || field === 'tolerance') out[field] = String(d[field]).trim() === '' ? null : Number(d[field]);
    else if (field === 'blanks') out.blanks = syncBlanks(d.text, d.blanks);
    else out[field] = d[field];
  }
  return out;
}

/**
 * The sentence the bank shows after a save, a create or an approval: what
 * happened, then the rule checks that failed, if any did.
 */
function noteFor(lead, failed) {
  const list = arr(failed);
  if (!list.length) return { note: lead, tone: 'ok' };
  const first = list[0].message;
  return {
    note: list.length === 1
      ? `${lead} One rule check failed: ${first}`
      : `${lead} ${list.length} rule checks failed. The first: ${first}`,
  };
}

/**
 * A list of one-line entries, optionally with a "this one is right" control.
 * `onChange(items, removed)` names the row taken out, so whatever is keyed by
 * position can follow it.
 */
function Lines({ items, onChange, pick, markOf, min = 0, max = 99, placeholder, label, addLabel = 'Add one' }) {
  const set = (i, v) => onChange(items.map((it, j) => (j === i ? v : it)));
  const named = label ?? placeholder ?? 'Row';
  return (
    <div className="stack stack-2">
      {items.map((it, i) => (
        <div key={i} className="tc-ed-row" data-on={pick?.on(i) ? 'true' : undefined}>
          {pick ? (
            <label className="tc-ed-mark">
              <input
                type={pick.mode === 'one' ? 'radio' : 'checkbox'}
                name={pick.name}
                checked={pick.on(i)}
                onChange={() => pick.toggle(i)}
                aria-label={pick.label ? pick.label(i) : `Option ${KEYS[i] ?? i + 1} is correct`}
              />
              {markOf ? markOf(i) : KEYS[i] ?? i + 1}
            </label>
          ) : (
            <span className="tc-ed-mark">{markOf ? markOf(i) : i + 1}</span>
          )}
          <input className="input grow" value={it ?? ''} placeholder={placeholder} aria-label={`${named} ${i + 1}`} onChange={(e) => set(i, e.target.value)} />
          <Button
            variant="ghost" size="sm" icon="close"
            aria-label={`Remove ${named.toLowerCase()} ${i + 1}`}
            title={items.length <= min ? `${min} is the fewest this kind allows` : undefined}
            disabled={items.length <= min}
            onClick={() => onChange(items.filter((_, j) => j !== i), i)}
          />
        </div>
      ))}
      <div>
        <Button size="sm" icon="plus" disabled={items.length >= max} title={items.length >= max ? `${max} is the most this kind allows` : undefined} onClick={() => onChange([...items, ''])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

function Pairs({ pairs, onChange }) {
  const set = (i, patch) => onChange(pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="stack stack-2">
      {pairs.map((p, i) => (
        <div key={i} className="tc-ed-pair">
          <input className="input" value={p.left ?? ''} placeholder="Term" aria-label={`Term ${i + 1}`} onChange={(e) => set(i, { left: e.target.value })} />
          <Icon name="forward" className="muted" />
          <input className="input" value={p.right ?? ''} placeholder="What it matches" aria-label={`Match for term ${i + 1}`} onChange={(e) => set(i, { right: e.target.value })} />
          <Button
            variant="ghost" size="sm" icon="close"
            aria-label={`Remove pair ${i + 1}`}
            title={pairs.length <= 3 ? 'Three pairs is the fewest a match allows' : undefined}
            disabled={pairs.length <= 3}
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Button size="sm" icon="plus" disabled={pairs.length >= 5} title={pairs.length >= 5 ? 'Five pairs is the most a match allows' : undefined} onClick={() => onChange([...pairs, { left: '', right: '' }])}>
          Add a pair
        </Button>
      </div>
    </div>
  );
}

/** Pick the words: type the sentence, then click the words that meet the criterion. */
function HotText({ draft, set }) {
  const picked = new Set(draft.hotIdxs);
  const n = draft.tokens.length;
  const toggle = (i) => set({
    hotIdxs: picked.has(i) ? draft.hotIdxs.filter((j) => j !== i) : [...draft.hotIdxs, i].sort((a, b) => a - b),
  });
  return (
    <div className="stack stack-3">
      <Field label="What to pick" htmlFor="q-hot-crit" hint="Shown to the student with the sentence. Name the job the words do, for example every verb.">
        <input id="q-hot-crit" className="input" value={draft.hotCriterion} placeholder="every word that names a term the material defines" onChange={(e) => set({ hotCriterion: e.target.value })} />
      </Field>
      <Field label="The sentence" htmlFor="q-hot-text" hint="Type or paste it. It is split into words at the spaces, so punctuation stays with its word.">
        <textarea id="q-hot-text" className="textarea au-hot-src" value={draft.hotText} onChange={(e) => set(retoken(e.target.value, draft))} />
      </Field>
      {n > 0 ? (
        <div className="stack stack-2">
          <div className="cluster between">
            <span className="t-label" id="q-hot-words">Click every word that meets it</span>
            <span className="t-meta" aria-live="polite">{picked.size} of {n} words picked</span>
          </div>
          <div className="au-hot" role="group" aria-labelledby="q-hot-words">
            {draft.tokens.map((t, i) => (
              <button key={i} type="button" className="au-tok" aria-pressed={picked.has(i)} onClick={() => toggle(i)}>
                {picked.has(i) && <Icon name="check" size={12} />}
                {t}
              </button>
            ))}
          </div>
          {(n < 3 || n > 40) && <p className="au-warn"><Icon name="alert" size={14} />{n} words. A sentence here needs 3 to 40.</p>}
        </div>
      ) : (
        <p className="au-wait">The words appear here to click once the sentence is typed.</p>
      )}
    </div>
  );
}

/** Choose for each gap: one list of choices per marker, one of them right. */
function Gaps({ draft, set }) {
  const parts = String(draft.text).split(BLANK_MARK);
  const gaps = syncGaps(draft.text, draft.gaps);
  if (gaps.length === 0) {
    return (
      <Note icon="alert">
        There is no {BLANK_MARK} in the text yet. Type {BLANK_MARK} where each choice goes, two to four of them, and a list of choices appears here for every one.
      </Note>
    );
  }
  const setGap = (i, patch) => set({ gaps: gaps.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  return (
    <div className="stack">
      {gaps.map((g, i) => (
        <div key={i} className="stack stack-2">
          <div className="tc-ed-blank"><span className="t-label">Gap {i + 1}</span> <span className="t-meta mono">{around(parts, i)}</span></div>
          <Lines
            items={g.options}
            min={2}
            max={5}
            placeholder="Choice"
            label={`Gap ${i + 1} choice`}
            addLabel="Add a choice"
            pick={{
              mode: 'one',
              name: `q-gap-${i}`,
              on: (j) => g.answerIdx === j,
              toggle: (j) => setGap(i, { answerIdx: j }),
              label: (j) => `Gap ${i + 1}: choice ${KEYS[j] ?? j + 1} is right`,
            }}
            onChange={(options, removed) => setGap(i, { options, answerIdx: shiftIdx(g.answerIdx, removed, options.length) })}
          />
        </div>
      ))}
    </div>
  );
}

/** Complete the table: headings, and per cell either what is shown or what is accepted. */
function TableEd({ draft, set }) {
  const cols = draft.tableCols;
  const rows = draft.tableRows;
  const setRow = (r, patch) => set({ tableRows: rows.map((x, j) => (j === r ? { ...x, ...patch } : x)) });
  const cellAt = (r, c) => rows[r].cells[c] ?? writtenCell();
  const setCell = (r, c, patch) => setRow(r, { cells: cols.map((_, j) => (j === c ? { ...cellAt(r, c), ...patch } : cellAt(r, j))) });

  const onCols = (next, removed) => set({
    tableCols: next,
    tableRows: rows.map((row) => ({
      ...row,
      cells: removed !== undefined
        ? row.cells.filter((_, j) => j !== removed)
        : next.length > cols.length ? [...cols.map((_, j) => row.cells[j] ?? writtenCell()), writtenCell()] : row.cells,
    })),
  });

  const colName = (c) => cols[c]?.trim() || `Column ${c + 1}`;

  return (
    <div className="stack">
      <div className="stack stack-2">
        <span className="t-label">Columns</span>
        <Lines items={cols} min={2} max={4} placeholder="Column heading" addLabel="Add a column" onChange={onCols} />
      </div>
      <div className="stack stack-2">
        <span className="t-label">Rows</span>
        <p className="hint">Each cell is shown to the student, or left for them to write. At least one cell must be theirs to write.</p>
        {rows.map((row, r) => (
          <div key={r} className="au-trow">
            <div className="cluster nowrap-flex">
              <span className="au-trow-n mono">{r + 1}</span>
              <input className="input grow" value={row.header} placeholder="Row heading" aria-label={`Row ${r + 1} heading`} onChange={(e) => setRow(r, { header: e.target.value })} />
              <Button
                variant="ghost" size="sm" icon="close"
                aria-label={`Remove row ${r + 1}`}
                title={rows.length <= 2 ? 'Two rows is the fewest a table allows' : undefined}
                disabled={rows.length <= 2}
                onClick={() => set({ tableRows: rows.filter((_, j) => j !== r) })}
              />
            </div>
            {cols.map((_, c) => {
              const cell = cellAt(r, c);
              const where = `Row ${r + 1}, ${colName(c)}`;
              return (
                <div key={c} className="au-tcell" data-mode={cell.mode}>
                  <div className="au-tcell-head">
                    <span className="t-meta clip">{colName(c)}</span>
                    <Segmented
                      label={`${where}: who fills it`}
                      value={cell.mode}
                      onChange={(mode) => setCell(r, c, { mode })}
                      options={[{ id: 'given', label: 'Given' }, { id: 'accept', label: 'Student writes' }]}
                    />
                  </div>
                  {cell.mode === 'given' ? (
                    <input className="input" value={cell.given} placeholder="Shown to the student" aria-label={`${where}: shown to the student`} onChange={(e) => setCell(r, c, { given: e.target.value })} />
                  ) : (
                    <Lines
                      items={cell.accept}
                      min={1}
                      placeholder="Accepted answer"
                      label={`${where}: accepted answer`}
                      addLabel="Accept another"
                      markOf={(j) => (j === 0 ? '=' : 'or')}
                      onChange={(accept) => setCell(r, c, { accept })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <div>
          <Button
            size="sm" icon="plus"
            disabled={rows.length >= 6}
            title={rows.length >= 6 ? 'Six rows is the most a table allows' : undefined}
            onClick={() => set({ tableRows: [...rows, { header: '', cells: cols.map(() => writtenCell()) }] })}
          >
            Add a row
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Tick every match: row and column labels, and the pairings that hold. */
function GridEd({ draft, set }) {
  const rows = draft.gridRows;
  const cols = draft.gridCols;
  const answers = gridOf(draft);
  const onRows = (next, removed) => set({
    gridRows: next,
    gridAnswers: removed !== undefined
      ? answers.filter((_, j) => j !== removed)
      : next.length > rows.length ? [...answers, cols.map(() => false)] : answers,
  });
  const onCols = (next, removed) => set({
    gridCols: next,
    gridAnswers: answers.map((row) => (removed !== undefined
      ? row.filter((_, j) => j !== removed)
      : next.length > cols.length ? [...row, false] : row)),
  });
  const tick = (r, c) => set({ gridAnswers: answers.map((row, i) => (i === r ? row.map((v, j) => (j === c ? !v : v)) : row)) });
  const ticked = answers.flat().filter(Boolean).length;
  const rowName = (r) => rows[r]?.trim() || `Row ${r + 1}`;
  const colName = (c) => cols[c]?.trim() || `Column ${c + 1}`;

  return (
    <div className="stack">
      <div className="tc-ed-cols">
        <div className="stack stack-2">
          <span className="t-label">Rows</span>
          <Lines items={rows} min={2} max={6} placeholder="Row" addLabel="Add a row" onChange={onRows} />
        </div>
        <div className="stack stack-2">
          <span className="t-label">Columns</span>
          <Lines items={cols} min={2} max={5} placeholder="Column" addLabel="Add a column" onChange={onCols} />
        </div>
      </div>
      <div className="stack stack-2">
        <div className="cluster between">
          <span className="t-label" id="q-grid-ticks">Tick every pairing that holds</span>
          <span className="t-meta" aria-live="polite">{ticked} of {rows.length * cols.length} ticked</span>
        </div>
        <div className="au-grid-wrap">
          <table className="au-grid" aria-labelledby="q-grid-ticks">
            <thead>
              <tr>
                <td />
                {cols.map((_, c) => <th key={c} scope="col">{colName(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((_, r) => (
                <tr key={r}>
                  <th scope="row">{rowName(r)}</th>
                  {cols.map((__, c) => (
                    <td key={c} data-on={answers[r][c] ? 'true' : undefined}>
                      <label className="au-gcell">
                        <input type="checkbox" checked={answers[r][c]} onChange={() => tick(r, c)} aria-label={`${rowName(r)} with ${colName(c)}`} />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Body({ draft, set }) {
  const { kind } = draft;

  if (kind === 'mcq' || kind === 'multi') {
    const many = kind === 'multi';
    const on = (i) => (many ? draft.answerIdxs.includes(i) : draft.answerIdx === i);
    const toggle = (i) => set(
      many
        ? { answerIdxs: draft.answerIdxs.includes(i) ? draft.answerIdxs.filter((j) => j !== i) : [...draft.answerIdxs, i].sort((x, y) => x - y) }
        : { answerIdx: i },
    );
    return (
      <Lines
        items={draft.options}
        min={4}
        max={many ? 6 : 4}
        placeholder="Option"
        addLabel="Add an option"
        pick={{ mode: many ? 'many' : 'one', name: 'correct', on, toggle }}
        // A removed option takes its tick with it, and the ticks below it move
        // up one, so the key stays on the options it was on.
        onChange={(options, removed) => {
          const shift = (i) => (removed != null && i > removed ? i - 1 : i);
          set({
            options,
            ...(many
              ? { answerIdxs: draft.answerIdxs.filter((i) => i !== removed).map(shift).filter((i) => i < options.length) }
              : { answerIdx: Math.min(draft.answerIdx === removed ? 0 : shift(draft.answerIdx), Math.max(0, options.length - 1)) }),
          });
        }}
      />
    );
  }

  if (kind === 'truefalse') {
    return (
      <Segmented
        label="The statement is"
        value={String(draft.answerBool)}
        onChange={(v) => set({ answerBool: v === 'true' })}
        options={[{ id: 'true', label: 'True' }, { id: 'false', label: 'False' }]}
      />
    );
  }

  if (kind === 'match') return <Pairs pairs={draft.pairs} onChange={(pairs) => set({ pairs })} />;

  if (kind === 'categorise') {
    const setBucket = (i, patch) => set({ buckets: draft.buckets.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
    return (
      <div className="stack stack-3">
        <div className="tc-ed-cols">
          {draft.buckets.map((b, i) => (
            <div className="well stack stack-3" key={i}>
              <div className="cluster nowrap-flex">
                <input className="input grow" value={b.name ?? ''} placeholder="Group name" aria-label={`Group ${i + 1} name`} onChange={(e) => setBucket(i, { name: e.target.value })} />
                <Button
                  variant="ghost" size="sm" icon="close"
                  aria-label={`Remove group ${i + 1}`}
                  title={draft.buckets.length <= 2 ? 'Two groups is the fewest' : undefined}
                  disabled={draft.buckets.length <= 2}
                  onClick={() => set({ buckets: draft.buckets.filter((_, j) => j !== i) })}
                />
              </div>
              <Lines items={b.items} markOf={() => ''} placeholder="Item" addLabel="Add an item" onChange={(items) => setBucket(i, { items })} />
            </div>
          ))}
        </div>
        <div>
          <Button size="sm" icon="plus" disabled={draft.buckets.length >= 4} title={draft.buckets.length >= 4 ? 'Four groups is the most' : undefined} onClick={() => set({ buckets: [...draft.buckets, { name: '', items: [''] }] })}>
            Add a group
          </Button>
        </div>
      </div>
    );
  }

  if (kind === 'blank') {
    return (
      <div className="stack stack-3">
        <p className="hint">Everything here is accepted, so add the spellings and synonyms a student would reasonably type. Case and spacing are already ignored.</p>
        <Lines items={draft.accept} min={1} placeholder="Accepted answer" addLabel="Accept another" markOf={(i) => (i === 0 ? '=' : 'or')} onChange={(accept) => set({ accept })} />
      </div>
    );
  }

  if (kind === 'cloze') {
    const parts = String(draft.text).split(BLANK_MARK);
    const blanks = syncBlanks(draft.text, draft.blanks);
    if (blanks.length === 0) {
      return (
        <Note icon="alert">
          There is no {BLANK_MARK} in the passage yet. Type {BLANK_MARK} where each word should be taken out, and a set of accepted answers appears here for every one.
        </Note>
      );
    }
    return (
      <div className="stack">
        {blanks.map((b, i) => (
          <div key={i} className="stack stack-2">
            <div className="tc-ed-blank"><span className="t-label">Blank {i + 1}</span> <span className="t-meta mono">{around(parts, i)}</span></div>
            <Lines
              items={b.accept}
              min={1}
              placeholder="Accepted answer"
              addLabel="Accept another"
              markOf={(j) => (j === 0 ? '=' : 'or')}
              onChange={(accept) => set({ blanks: blanks.map((x, j) => (j === i ? { accept } : x)) })}
            />
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'numeric') {
    return (
      <div className="grid-3">
        <Field label="Correct value" htmlFor="q-value">
          <input id="q-value" className="input num" inputMode="decimal" value={draft.value} onChange={(e) => set({ value: e.target.value })} />
        </Field>
        <Field label="Tolerance" htmlFor="q-tol" hint="How far out an answer may be. Zero means exact.">
          <input id="q-tol" className="input num" inputMode="decimal" value={draft.tolerance} onChange={(e) => set({ tolerance: e.target.value })} />
        </Field>
        <Field label="Unit" htmlFor="q-unit" hint="Shown beside the box. Nobody is marked on typing it.">
          <input id="q-unit" className="input" value={draft.unit} placeholder="kJ, %, cm" onChange={(e) => set({ unit: e.target.value })} />
        </Field>
      </div>
    );
  }

  if (kind === 'order' || kind === 'rank') {
    return (
      <div className="stack stack-3">
        {kind === 'rank' && (
          <Field label="Ranked against" htmlFor="q-criterion" hint="A ranking with no stated criterion is ordered by what? The server refuses one without it.">
            <input id="q-criterion" className="input" value={draft.criterion} placeholder="strongest evidence first, most severe first" onChange={(e) => set({ criterion: e.target.value })} />
          </Field>
        )}
        <p className="hint">Written in the correct order, top first. Every student sees them shuffled, each in their own order.</p>
        <Lines items={draft.sequence} min={3} max={5} placeholder="Item" addLabel="Add an item" onChange={(sequence) => set({ sequence })} />
      </div>
    );
  }

  if (kind === 'open') {
    return (
      <div className="stack stack-3">
        <p className="hint">Each point is matched against the words a student actually writes, so use the content words a correct answer would use, not a sentence about it.</p>
        <Lines items={draft.rubric} min={2} max={5} placeholder="Point a full answer must make" addLabel="Add a point" onChange={(rubric) => set({ rubric })} />
      </div>
    );
  }

  if (kind === 'hottext') return <HotText draft={draft} set={set} />;
  if (kind === 'dropdown') return <Gaps draft={draft} set={set} />;
  if (kind === 'table') return <TableEd draft={draft} set={set} />;
  if (kind === 'grid') return <GridEd draft={draft} set={set} />;

  return <Note icon="alert">"{KIND_LABEL[kind] ?? kind}" has no editor yet.</Note>;
}

/**
 * The rule checks the stored question failed, as advice. Null means it was
 * never checked, which says nothing either way, so nothing is drawn.
 */
function Checks({ checks }) {
  if (!Array.isArray(checks)) return null;
  const failed = checks.filter((c) => c && c.ok === false);
  if (!failed.length) {
    return <p className="au-checks-ok"><Icon name="ok" size={14} />Every rule check passed when it was last saved.</p>;
  }
  return (
    <section className="au-checks" aria-label="Rule checks that failed">
      <ul>
        {failed.map((c, i) => (
          <li key={c.id ?? i}><Icon name="alert" size={14} /><span>{c.message}</span></li>
        ))}
      </ul>
      <p className="au-checks-why">
        Rule checks are advice, not refusals: saving and approving still work. They run again on every save.
      </p>
    </section>
  );
}

/** A refusal, brought into view wherever the sheet is scrolled to. */
function Refusal({ text }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest' }); }, [text]);
  return <div ref={ref}><Note tone="bad" role="alert">{text}</Note></div>;
}

function Act({ title, line, children, action }) {
  return (
    <div className="au-act">
      <div className="au-act-row">
        <div className="grow">
          <b>{title}</b>
          <p>{line}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * The server's `provenance.label` ("AI draft", "Offline template, approved",
 * ...) when the reply carries it. Otherwise "AI draft · gemini-2.5-flash",
 * "Offline template", "Professor-written" (source 'teacher', since 19 Nov
 * 2026), or, for 'fallback' with no model, both of the last two: a
 * professor's own question was stored that way before then.
 */
function sourceOf(q) {
  if (q?.provenance?.label) return q.provenance.label;
  if (q?.source === 'teacher') return 'Professor-written';
  if (q?.model === 'offline-template') return 'Offline template';
  if (q?.model) return `AI draft · ${q.model}`;
  if (q?.source === 'fallback') return 'Offline template, or professor-written before 19 Nov 2026';
  return null;
}

/**
 * The question a regenerated draft replaces (`replacesId`), from the bank
 * already loaded: its reference and text, or a line saying it is gone.
 * `old.status` other than active means it left rooms some other way since.
 */
export function Replaces({ old, name }) {
  return (
    <span className="au-replaces">
      <span className="au-replaces-k"><Icon name="refresh" size={13} />Replaces:</span>
      {old ? (
        <>
          {name && <span className="tc-ref">{name}</span>}
          <span className="au-replaces-t">{old.text}</span>
          {old.status !== 'active' && <span className="au-replaces-off">set aside since</span>}
        </>
      ) : <span className="au-replaces-t">a question no longer in this bank</span>}
    </span>
  );
}

/**
 * The labels an edit or a retag took off, so the bank can list them to be
 * added again: from a PATCH reply ([{ option, label, provenance }], one
 * question, `id`) or a bulk retag's ([{ id, labels: [...] }]). Null when none.
 */
export function removedLabels(reply, id) {
  const items = arr(reply?.misconceptionsRemoved)
    .flatMap((r) => (Array.isArray(r?.labels) ? r.labels.map((l) => ({ id: r.id, ...l })) : [{ id, ...r }]));
  return items.length ? { note: reply.misconceptionsNote ?? '', items } : null;
}

const LABEL_SAID = {
  added: 'Saved.',
  edited: 'Saved.',
  confirmed: 'Confirmed: it is your label now.',
  cleared: 'Cleared.',
};

/**
 * Misconception labels (Phase 5): beside each wrong option of the question as
 * stored, the misunderstanding a student who picks it most likely holds.
 * Each is saved on its own (PATCH …/misconceptions, one option at a time), so
 * it is never part of an edit: the question keeps its status, an approved one
 * stays approved and a draft stays a draft. An AI draft label reads as a draft
 * until it is confirmed or rewritten. The counts are the server's: how many
 * students chose each labelled option across the chapter's rooms, never who.
 * `canEdit` false (an HOD) reads the labels only.
 */
function Labels({ id, services, onChanged }) {
  const [state, setState] = useState({ data: null, error: '' });
  const [text, setText] = useState({});
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState({});

  useEffect(() => {
    let alive = true;
    services.questionMisconceptions(id).then(
      (data) => { if (alive) setState({ data, error: '' }); },
      (err) => { if (alive) setState({ data: null, error: err.message }); },
    );
    return () => { alive = false; };
  }, [id, services]);

  const d = state.data;
  if (state.error) return <p className="au-mc-gone">The labels did not load: {state.error}</p>;
  if (!d) return <div className="skel" style={{ height: 96 }} aria-busy="true" aria-label="Reading the labels" />;
  if (!d.labelled) return null;

  const kind = d.question?.kind ?? 'mcq';
  const options = arr(d.question?.options);
  const wrong = arr(d.wrongOptions);
  const held = new Map(arr(d.misconceptions).map((m) => [m.optionIdx, m]));
  const counted = arr(d.report?.questions?.[0]?.options);
  const countOf = (i) => counted.find((o) => o.optionIdx === i);
  const other = d.report?.questions?.[0]?.otherWordingNote;
  const max = d.maxLength ?? 120;

  async function change(i, body, what) {
    setBusy(`${i}:${what}`);
    setSaid((s) => ({ ...s, [i]: null }));
    try {
      const reply = await services.setMisconceptions(id, [{ option: i, ...body }]);
      // The PATCH answers the labels whole; the counts follow with a fresh read,
      // since their sentences name the label and whether it is a draft.
      setState((s) => ({ ...s, data: { ...s.data, ...reply, report: s.data?.report } }));
      setText((t) => { const next = { ...t }; delete next[i]; return next; });
      const done = arr(reply?.changed).find((c) => c.optionIdx === i);
      setSaid((s) => ({ ...s, [i]: { tone: 'ok', text: done ? LABEL_SAID[done.action] : 'Nothing changed.' } }));
      if (done) {
        onChanged?.();
        services.questionMisconceptions(id).then((data) => setState({ data, error: '' }), () => {});
      }
    } catch (err) {
      setSaid((s) => ({ ...s, [i]: { tone: 'bad', text: err.message } }));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="stack stack-2">
      {d.note && <p className="hint">{d.note} Labels act on the options as stored.</p>}
      {wrong.length === 0 ? (
        <p className="au-mc-gone">This question has no wrong option to label.</p>
      ) : (
        <ul className="au-mc-list">
          {wrong.map((i) => {
            const m = held.get(i);
            const value = text[i] ?? m?.label ?? '';
            const trimmed = value.replace(/\s+/g, ' ').trim();
            const changed = trimmed !== (m?.label ?? '');
            const n = countOf(i);
            const tag = kind === 'truefalse' ? options[i] : KEYS[i] ?? i + 1;
            const note = said[i];
            const off = Boolean(busy);
            return (
              <li key={i} className="au-mc" data-ai={m?.provenance === 'ai' ? 'true' : undefined}>
                <div className="au-mc-opt">
                  <span className="tc-ed-mark">{tag}</span>
                  {kind !== 'truefalse' && <span className="au-mc-otext">{options[i]}</span>}
                </div>
                {d.canEdit ? (
                  <div className="au-mc-row">
                    <input
                      className="input grow"
                      value={value}
                      placeholder="The misunderstanding behind this answer"
                      aria-label={`Misconception for ${kind === 'truefalse' ? `"${options[i]}"` : `option ${tag}`}`}
                      aria-invalid={note?.tone === 'bad' || undefined}
                      onChange={(e) => { setText((t) => ({ ...t, [i]: e.target.value })); setSaid((s) => ({ ...s, [i]: null })); }}
                    />
                    <span className="au-count" data-over={trimmed.length > max ? 'true' : undefined}>{trimmed.length} of {max}</span>
                    {m?.provenance === 'ai' && !changed ? (
                      <Button size="sm" icon="check" busy={busy === `${i}:confirm`} disabled={off} onClick={() => change(i, { confirm: true }, 'confirm')}>Confirm</Button>
                    ) : (
                      <Button size="sm" busy={busy === `${i}:save`} disabled={off || !changed || !trimmed} onClick={() => change(i, { label: value }, 'save')}>Save</Button>
                    )}
                    {m && (
                      <Button size="sm" variant="ghost" busy={busy === `${i}:clear`} disabled={off} onClick={() => change(i, { label: null }, 'clear')}>Clear</Button>
                    )}
                  </div>
                ) : (
                  <p className="au-mc-read">{m?.label ?? <span className="au-mc-gone">No label</span>}</p>
                )}
                {(m || n?.sentence) && (
                  <p className="au-mc-meta">
                    {m && <span className="au-mc-prov" data-ai={m.provenance === 'ai' ? 'true' : undefined}>{m.provenanceLabel ?? (m.provenance === 'ai' ? 'AI draft' : 'Professor’s label')}</span>}
                    {n?.sentence && <span>{n.sentence}</span>}
                    {n?.note && <span>{n.note}</span>}
                  </p>
                )}
                {note && (
                  <p className="au-mc-said" data-tone={note.tone} role={note.tone === 'bad' ? 'alert' : 'status'}>
                    <Icon name={note.tone === 'bad' ? 'alert' : 'ok'} size={13} />{note.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {other && <p className="hint">{other}</p>}
      {!d.canEdit && <p className="hint"><Icon name="eye" size={13} /> Read only: the professor who keeps this chapter writes its labels.</p>}
    </div>
  );
}

/**
 * @param replaces    for a draft with `replacesId`: { old, name }, the replaced
 *                    question and its reference, from the bank
 * @param labelKinds  the bank's `misconceptionLabels` ({ kinds, maxLength, note }):
 *                    which kinds take misconception labels
 * @param onLabels    after a label is saved, confirmed or cleared (the sheet stays open)
 */
export default function Editor({
  question, contentId, kinds, replaces = null, labelKinds = null, start = null, onClose, onDone, onLabels, services = api,
}) {
  const creating = question == null;
  // A question written from scratch starts at the bank's filters in force
  // (`start`: { bloom, topic }), the level's first interaction filled in, as
  // picking that level here would.
  const [draft, setDraft] = useState(() => {
    const d = seed(question);
    if (!creating || !start) return d;
    const at = { ...d, topic: String(start.topic ?? '') };
    const kind = start.bloom ? (kinds?.forLevel?.[start.bloom] ?? [])[0] : null;
    return kind ? { ...at, bloom: start.bloom, kind, ...fill(kind, at) } : at;
  });
  const started = creating && Boolean(start?.bloom || start?.topic);
  const [busy, setBusy] = useState('');
  const [refused, setRefused] = useState(null);

  const set = (patch) => { setRefused(null); setDraft((d) => ({ ...d, ...patch })); };

  // What this level may be asked as: the server's list, so the editor can
  // never offer a swap the server would refuse.
  const swaps = draft.bloom ? (kinds?.forLevel?.[draft.bloom] ?? [draft.kind]) : [];
  const label = (k) => kinds?.label?.[k] ?? KIND_LABEL[k] ?? k;
  const retagged = !creating && draft.bloom !== question.bloom;
  const status = question?.status;
  const isDraft = status === 'draft';
  const chapter = contentId ?? question?.contentId ?? null;

  function pickKind(kind) {
    if (kind === draft.kind) return;
    setRefused(null);
    setDraft((d) => ({ ...d, kind, ...fill(kind, d) }));
  }

  function pickLevel(bloom) {
    if (bloom === draft.bloom) return;
    setRefused(null);
    setDraft((d) => {
      const offered = kinds?.forLevel?.[bloom] ?? [];
      const kind = offered.includes(d.kind) ? d.kind : (offered[0] ?? d.kind);
      return { ...d, bloom, kind, ...fill(kind, d) };
    });
  }

  async function run(what, at, fn) {
    setBusy(what); setRefused(null);
    try {
      const info = await fn();
      await onDone(info ?? {});
    } catch (err) {
      setRefused({ text: err.message, at });
    } finally {
      setBusy('');
    }
  }

  // The stimulus goes only when it changed: an untouched question is saved
  // with exactly the context it had.
  const stimulus = stimulusFor(draft.stim);
  const stimulusChanged = creating || JSON.stringify(stimulus) !== JSON.stringify(stimulusFor(seedStimulus(question?.stimulus)));
  const editBody = () => ({ ...payload(draft), ...(stimulusChanged ? { stimulus } : {}) });

  // An edit that rewords or removes a labelled option, or makes it a right
  // answer, takes that label off: the reply names each one (`removed`).
  const save = () => run('save', 'top', async () => {
    const reply = await services.editQuestion(question._id, editBody());
    return { ...noteFor('Saved.', arr(reply?.question?.checks).filter((c) => c && c.ok === false)), removed: removedLabels(reply, question._id) };
  });

  const saveAndApprove = () => run('approve', 'top', async () => {
    const edited = await services.editQuestion(question._id, editBody());
    const reply = await services.approveQuestion(question._id);
    return {
      ...noteFor('Saved and approved, so rooms can serve it.', reply?.failedChecks),
      retired: reply?.retired ?? null,
      removed: removedLabels(edited, question._id),
    };
  });

  const create = () => run('create', 'top', async () => {
    const topic = draft.topic.trim();
    const reply = await services.createQuestion(chapter, {
      ...payload(draft),
      ...(topic ? { topic } : {}),
      ...(stimulus ? { stimulus } : {}),
    });
    return noteFor('Added to the bank as approved, so rooms can serve it.', reply?.failedChecks);
  });

  const shift = (direction) => run(direction, 'actions', async () => {
    const reply = await services.regenerateQuestion(question._id, direction);
    const at = LABEL[reply?.question?.bloom];
    return {
      note: `${direction === 'harder' ? 'A harder' : 'An easier'} draft${at ? ` at ${at}` : ''} is waiting in Drafts. This question is unchanged.`,
      tone: 'ok',
    };
  });

  // An active question stays in rooms until its rewrite is approved: the
  // reply's `note` says so, word for word. Anything else is discarded now.
  const rewrite = () => run('rewrite', 'actions', async () => {
    const reply = await services.regenerateQuestion(question._id);
    return reply?.note
      ? { note: `The rewrite is waiting in Drafts. ${reply.note}`, tone: 'ok' }
      : { note: 'The rewrite is waiting in Drafts. The old wording is in the discarded pile.', tone: 'ok' };
  });

  const split = () => run('split', 'actions', async () => {
    const reply = await services.splitQuestion(question._id);
    const drafts = arr(reply?.questions).length > 0 && arr(reply.questions).every((q) => q.status === 'draft');
    return { note: `Split into two${drafts ? ' drafts' : ''}. The original is in the discarded pile.`, tone: 'ok' };
  });

  const discard = () => run('discard', 'actions', async () => {
    await services.discardQuestion(question._id);
    return { note: 'Discarded. It has left rooms, and it can be restored from the discarded pile.', tone: 'ok' };
  });

  const reject = () => run('reject', 'actions', async () => {
    await services.rejectQuestion(question._id);
    return { note: 'Rejected. It stays out of rooms, and it can still be restored.', tone: 'ok' };
  });

  const restore = () => run('restore', 'actions', async () => {
    const reply = await services.restoreQuestion(question._id);
    return { note: 'Back in the bank as approved, so rooms can serve it.', tone: 'ok', retired: reply?.retired ?? null };
  });

  const blanks = markers(draft.text);
  const fillIn = draft.kind === 'blank' || draft.kind === 'cloze' || draft.kind === 'dropdown';
  const topicLength = draft.topic.length;

  // Harder and Easier act on the level stored, not the one being picked above.
  const at = creating ? -1 : LEVELS.indexOf(question.bloom);
  const up = at >= 0 ? LEVELS[at + 1] : undefined;
  const down = at > 0 ? LEVELS[at - 1] : undefined;
  const poll = question?.kind === 'poll';
  const pollWhy = 'A poll is not marked, so it has no level to make harder or easier.';
  const harderWhy = poll ? pollWhy : !up ? `${LABEL[question?.bloom] ?? 'This'} is the top of the ladder, so there is no harder level to write it at.` : '';
  const easierWhy = poll ? pollWhy : !down ? `${LABEL[question?.bloom] ?? 'This'} is the bottom of the ladder, so there is no easier level to write it at.` : '';

  const source = sourceOf(question);
  // Labels sit on the stored question, for the kinds the bank says take them (never a poll).
  const labelled = !creating && arr(labelKinds?.kinds).includes(question.kind ?? 'mcq');
  const slides = arr(question?.sourceRef?.slides);

  const description = creating
    ? 'It goes straight into the bank as approved, and rooms can serve it as soon as it is added.'
    : (
      <>
        {[question.topic || 'Untitled topic', LABEL[question.bloom] ?? question.bloom, label(question.kind ?? 'mcq')].join(' · ')}
        {source && ` · ${source}`}
        {slides.length > 0 && <> · <span className="mono">{slides.length === 1 ? 'Slide' : 'Slides'} {slides.join(', ')}</span></>}
      </>
    );

  const off = Boolean(busy);

  return (
    <Dialog
      sheet
      open
      onOpenChange={(v) => { if (!v) onClose(); }}
      locked={off}
      title={creating ? 'Write a question' : isDraft ? 'Edit draft' : 'Edit question'}
      description={description}
      footer={creating ? (
        <>
          <Button variant="ghost" disabled={off} onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy === 'create'} disabled={off || !draft.bloom} title={!draft.bloom ? 'Pick a level first' : undefined} onClick={create}>
            Add to the bank
          </Button>
        </>
      ) : isDraft ? (
        <>
          <Button variant="ghost" disabled={off} onClick={onClose}>Cancel</Button>
          <Button busy={busy === 'save'} disabled={off} onClick={save}>Save</Button>
          <Button variant="primary" icon="check" busy={busy === 'approve'} disabled={off} onClick={saveAndApprove}>Save and approve</Button>
        </>
      ) : (
        <>
          <Button variant="ghost" disabled={off} onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy === 'save'} disabled={off} onClick={save}>Save changes</Button>
        </>
      )}
    >
      <div className="tc-ed">
        {refused?.at === 'top' && <Refusal text={refused.text} />}
        {!creating && question.provenance?.sentence && <p className="au-prov">{question.provenance.sentence}</p>}
        {!creating && <Checks checks={question.checks} />}
        {replaces && status !== 'active' && (
          <div className="au-replaces-box">
            <Replaces old={replaces.old} name={replaces.name} />
            {replaces.old?.status === 'active' && (
              <p>
                {isDraft
                  ? `Approving this draft takes ${replaces.name ?? 'that question'} out of rooms; rejecting it leaves ${replaces.name ?? 'that question'} as it is.`
                  : `Restoring this draft approves it and takes ${replaces.name ?? 'that question'} out of rooms.`}
              </p>
            )}
          </div>
        )}

        <section className="tc-ed-sec" aria-labelledby="ed-level">
          <h4 className="tc-ed-h" id="ed-level">Level</h4>
          <div className="tc-ed-levels">
            {LEVELS.map((l) => (
              <Level key={l} as="button" type="button" level={l} solid={draft.bloom === l} aria-pressed={draft.bloom === l} onClick={() => pickLevel(l)} />
            ))}
          </div>
          {started && (
            <p className="hint">
              Started at the bank’s filter in force
              {start.bloom ? `: ${LABEL[start.bloom]}` : ''}{start.topic ? `${start.bloom ? ',' : ':'} on “${start.topic}”` : ''}. Change either here.
            </p>
          )}
          {draft.bloom ? (
            <>
              <div className="stack stack-2 au-kinds">
                <span className="t-label">Asked as</span>
                <Segmented label="Interaction" value={draft.kind} onChange={pickKind} options={swaps.map((k) => ({ id: k, label: label(k) }))} />
              </div>
              <p className="said">
                {LABEL[draft.bloom]} is asked as {swaps.map(label).join(' or ')} and nothing else, because the level decides the
                interaction. To ask this another way, change the level, and expect to rewrite the question with it.
              </p>
            </>
          ) : (
            <p className="hint">Pick the level first. It decides how the question can be asked, and the answer fields follow from it.</p>
          )}
          {retagged && (
            <Note>
              Moving this from {LABEL[question.bloom]} to {LABEL[draft.bloom]}
              {draft.kind !== (question.kind ?? 'mcq')
                ? `, so it becomes "${label(draft.kind)}" and needs that shape filled in below.`
                : '. The interaction it has is asked at both levels, so it carries over.'}
            </Note>
          )}
          {!creating && question.levelCheck?.uncertain && question.levelCheck.sentence && (
            <p className="au-unsure-line"><Icon name="help" size={14} /><span>{question.levelCheck.sentence}</span></p>
          )}
        </section>

        <section className="tc-ed-sec" aria-labelledby="ed-text">
          <div className="cluster between">
            <h4 className="tc-ed-h" id="ed-text">Question</h4>
            {fillIn && <span className="t-meta">{blanks} {BLANK_MARK} marker{blanks === 1 ? '' : 's'} in the text</span>}
          </div>
          <textarea className="textarea" style={{ minHeight: 96 }} value={draft.text} aria-label="Question text" onChange={(e) => set({ text: e.target.value })} />
          <p className="hint">
            {draft.kind === 'truefalse'
              ? 'A statement, not a question: "Photosynthesis needs light." and never "Does photosynthesis need light?"'
              : fillIn
                ? `Type ${BLANK_MARK} wherever a word is taken out. Everything else is read as written.`
                : 'Plain, exam-ready English. No markdown and no numbering inside the stem.'}
          </p>
          {creating && (
            <Field
              label="Topic"
              optional
              htmlFor="q-topic"
              hint={(
                <span className="au-hint-row">
                  <span>Which part of the chapter it is on. Questions on one topic are grouped together.</span>
                  <span className="au-count" data-over={topicLength > MAX_TOPIC ? 'true' : undefined}>{topicLength} of {MAX_TOPIC}</span>
                </span>
              )}
            >
              <input id="q-topic" className="input" value={draft.topic} onChange={(e) => set({ topic: e.target.value })} />
            </Field>
          )}
        </section>

        <section className="tc-ed-sec" aria-labelledby="ed-kind">
          {draft.kind ? (
            <>
              <div className="stack stack-1">
                <h4 className="tc-ed-h" id="ed-kind">{label(draft.kind)}</h4>
                {KIND_SHAPE[draft.kind] && <p className="hint">{KIND_SHAPE[draft.kind]}</p>}
              </div>
              <Body draft={draft} set={set} />
            </>
          ) : (
            <>
              <h4 className="tc-ed-h" id="ed-kind">Answer</h4>
              <p className="au-wait">The answer fields appear here once a level is picked.</p>
            </>
          )}
        </section>

        {labelled && (
          <section className="tc-ed-sec" aria-labelledby="ed-mc">
            <h4 className="tc-ed-h" id="ed-mc">Misconceptions on wrong options</h4>
            <Labels id={question._id} services={services} onChanged={onLabels} />
          </section>
        )}

        <section className="tc-ed-sec" aria-labelledby="ed-stim">
          <div className="stack stack-1">
            <h4 className="tc-ed-h" id="ed-stim">Passage or image</h4>
            <p className="hint">Optional. What the question is about, shown above it.</p>
          </div>
          <StimulusEditor
            value={draft.stim}
            onChange={(fn) => { setRefused(null); setDraft((d) => ({ ...d, stim: fn(d.stim) })); }}
            contentId={chapter}
            services={services}
            disabled={off}
          />
        </section>

        {!creating && (
          <section className="tc-ed-sec" aria-labelledby="ed-more">
            <div className="stack stack-1">
              <h4 className="tc-ed-h" id="ed-more">Other versions</h4>
              <p className="hint">
                These act on the question as it is stored, so save first if the edits above are worth keeping. Anything
                new written here is a draft that waits for your approval.
              </p>
            </div>
            {refused?.at === 'actions' && <Refusal text={refused.text} />}
            <div className="au-acts">
              <Act
                title="A harder version"
                line={harderWhy || `A new draft at ${LABEL[up]}, on the same topic. This question stays as it is.`}
                action={<Button size="sm" icon="up" busy={busy === 'harder'} disabled={off || Boolean(harderWhy)} title={harderWhy || undefined} onClick={() => shift('harder')}>Harder</Button>}
              />
              <Act
                title="An easier version"
                line={easierWhy || `A new draft at ${LABEL[down]}, on the same topic. This question stays as it is.`}
                action={<Button size="sm" icon="down" busy={busy === 'easier'} disabled={off || Boolean(easierWhy)} title={easierWhy || undefined} onClick={() => shift('easier')}>Easier</Button>}
              />
              <Act
                title="Rewrite it"
                line={status === 'active'
                  ? 'A new draft at the same level, to take its place. This question stays in rooms until you approve the rewrite.'
                  : `${status === 'discarded'
                    ? 'A new draft at the same level, written from the material again.'
                    : 'A new draft at the same level takes its place, and this one moves to the discarded pile.'}${
                    question?.replacesId && !question.approvedAt ? ` The new draft still replaces ${replaces?.name ?? 'the question this one replaces'}.` : ''}`}
                action={<Button size="sm" icon="refresh" busy={busy === 'rewrite'} disabled={off} onClick={rewrite}>Rewrite</Button>}
              />
              <Act
                title="Split into two"
                line={`Two ${isDraft ? 'drafts' : 'questions'} from one, each checked again. The original moves to the discarded pile.`}
                action={<Button size="sm" icon="split" busy={busy === 'split'} disabled={off} onClick={split}>Split</Button>}
              />
              {status === 'discarded' ? (
                <Act
                  title="Restore it"
                  line="Back into the bank as approved, so rooms can serve it."
                  action={<Button size="sm" icon="undo" busy={busy === 'restore'} disabled={off} onClick={restore}>Restore</Button>}
                />
              ) : isDraft ? (
                <Act
                  title="Reject it"
                  line="It never reaches a room. It moves to the discarded pile, where it can still be restored."
                  action={<Button size="sm" variant="danger" icon="close" busy={busy === 'reject'} disabled={off} onClick={reject}>Reject</Button>}
                />
              ) : (
                <Act
                  title="Discard it"
                  line="It leaves rooms and moves to the discarded pile, where it can be restored."
                  action={<Button size="sm" variant="danger" icon="trash" busy={busy === 'discard'} disabled={off} onClick={discard}>Discard</Button>}
                />
              )}
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
