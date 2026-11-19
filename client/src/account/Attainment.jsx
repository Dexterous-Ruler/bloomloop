/**
 * The class's attainment report (Phase 4): the Attainment tab of
 * /classes/:id?view=attainment.
 *
 *   GET /api/classes/:id/attainment?from=&to=&rooms=          (docs/API.md)
 *   GET /api/classes/:id/attainment/config                     (canEdit, the formula in force)
 *   ?format=csv (&sheet=bloom) and ?format=html, through api.downloadCsv and
 *   api.openReport: fetched with this browser's credentials, never a link.
 *
 * Staff only. Every figure is the server's and says what it rests on: the
 * students counted, the answers by evidence type (each "counted" or "shown,
 * not counted"), and beside it, never inside it, the evidence of students
 * outside the figure. Students are in roll-number order and are never ranked,
 * sorted or numbered by a mark. A state is always written out; "Not enough
 * evidence" is its own state. Teacher records have their own section and move
 * no figure. Bloom attainment opens on the three bands (decision 6) with the
 * six levels one press away.
 *
 * The container at the foot reads and writes; everything above it draws what
 * it is handed, which is what lets dev/attain.gallery.jsx draw every state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { Button, Chip, Empty, Icon, Level, Menu, Note, Panel, Segmented, Tip } from '../ui/index.jsx';
import FormulaEdit, { FormulaPart, formulaName } from './AttainmentFormula.jsx';
import ReportWindow, { NO_WINDOW, windowParams } from './ReportWindow.jsx';
import {
  Cell, MarksTable, StudentSheet, bySourceLine, list, mk, num, plural, pctOf, typesFrom,
} from './StudentAttainment.jsx';
import { dateOf } from './dashParts.jsx';

/* ----------------------------------------------------------------- helpers */

const topLevelOf = (formula) => list(formula?.config?.levels).reduce((m, l) => Math.max(m, num(l.level) ?? 0), 0);

/** "Every room of the class", "Rooms opened 1 Nov to 19 Nov", "3 chosen rooms". */
function periodOf(w) {
  const day = (d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d ?? ''));
    return m ? dateOf(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString()) : d;
  };
  const rooms = String(w?.rooms ?? '').split(',').filter(Boolean);
  const dates = w?.from && w?.to ? `opened ${day(w.from)} to ${day(w.to)}` : w?.from ? `opened from ${day(w.from)}` : w?.to ? `opened up to ${day(w.to)}` : '';
  if (rooms.length) return `${rooms.length === 1 ? `Room ${rooms[0]}` : `${rooms.length} chosen rooms`}${dates ? `, ${dates}` : ''}`;
  return dates ? `Rooms ${dates}` : 'Every room of the class';
}

const hasWindow = (w) => Boolean(w?.from || w?.to || String(w?.rooms ?? ''));

/* --------------------------------------------------------------- skeleton */

function Skeleton() {
  return (
    <div className="stack stack-5" aria-busy="true" aria-label="Reading the attainment report">
      <div className="skel" style={{ height: 212, borderRadius: 18 }} />
      <div className="card atn-skel">
        <div className="skel" style={{ height: 14, width: 220 }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="stack stack-2">
            <div className="skel" style={{ height: 16, width: '56%' }} />
            <div className="skel" style={{ height: 40 }} />
            <div className="skel" style={{ height: 12, width: '80%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- brief */

function Brief({ r, busy }) {
  const a = r.answers ?? {};
  const rooms = list(r.rooms);
  const outcomes = list(r.outcomes);
  const ev = r.formula?.config?.evidence ?? {};
  const types = typesFrom(r.evidenceTypes);
  const on = types.filter((t) => ev[t.id]);
  const off = types.filter((t) => ev[t.id] === false);
  const sources = bySourceLine(a.bySource, r.questionSources);
  const students = list(r.students);
  const roster = students.filter((s) => s.status === 'active').length;
  const removed = students.filter((s) => s.status === 'removed').length;
  const offRoster = students.filter((s) => s.status === 'not-on-roster').length;
  const f = r.formula;
  const lead = !rooms.length
    ? (hasWindow(r.window) ? 'No room in this window can be counted.' : 'No room opened for this class can be counted yet.')
    : `${plural(a.graded ?? 0, 'marked answer')} from ${plural(rooms.length, 'room')}, read against ${outcomes.length ? plural(outcomes.length, 'course outcome') : 'no course outcomes yet'}.`;

  return (
    <Panel className="atn-brief" aria-busy={busy || undefined}>
      <div className="atn-brief-say">
        <span className="tag-mint">Attainment · staff only</span>
        <p className="atn-lead">{lead}</p>
        <div className="brief">
          <b>Period</b><span>{periodOf(r.window)}</span>
          <b>Formula</b>
          <span>
            {f?.source === 'example' ? `“${formulaName(f)}”, version 0: an example, since no formula has been saved` : `${formulaName(f)}${f?.savedAt ? `, saved ${dateOf(f.savedAt)}` : ''}`}
          </span>
          <b>Counted</b><span>{on.length ? on.map((t) => t.label).join(', ') : 'Nothing'}</span>
          <b>Shown</b><span>{[...off.map((t) => `${t.label}, not counted`), 'polls as a count', 'teacher records apart'].join('; ')}</span>
          {sources && <><b>Written by</b><span>{sources}</span></>}
          <b>Left out</b><span>Deleted rooms and rooms not opened for this class</span>
        </div>
        <span className="cluster">
          <Button
            variant="accent"
            size="sm"
            icon="info"
            onClick={() => document.getElementById('atn-how')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            How this report was made
          </Button>
        </span>
      </div>
      <div className="atn-tiles">
        <div className="ptile">
          <span>Marked answers</span>
          <b>{(a.graded ?? 0).toLocaleString()}</b>
          <small>{plural(a.rows ?? 0, 'attempt')} stored<i>{a.setAside ? `${a.setAside} set aside` : 'none set aside'}</i></small>
        </div>
        <div className="ptile" style={{ '--d': '0.6s' }}>
          <span>Reach a course outcome</span>
          <b>{(a.mapped ?? 0).toLocaleString()}</b>
          <small>{(a.unmapped ?? 0).toLocaleString()} reach none<i>{(a.excluded ?? 0).toLocaleString()} excluded</i></small>
        </div>
        <div className="ptile" style={{ '--d': '1.2s' }}>
          <span>On the roster</span>
          <b>{roster.toLocaleString()}</b>
          <small>{removed || offRoster ? `${removed} removed, ${offRoster} off the roster` : 'nobody outside the roster'}<i>{removed || offRoster ? 'never counted' : ''}</i></small>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- a figure */

function Outside({ out }) {
  const o = out ?? {};
  const lines = [];
  const nee = o.notEnoughEvidence;
  if (nee && (num(nee.answers) || num(nee.students))) {
    lines.push(`${plural(nee.students, 'student')} with not enough evidence: ${plural(nee.answers, 'answer')}`);
  }
  if (o.removed && (num(o.removed.students) || num(o.removed.answers))) {
    lines.push(`${plural(o.removed.students, 'removed student')}: ${plural(o.removed.answers, 'answer')}`);
  }
  if (o.notOnRoster && (num(o.notOnRoster.students) || num(o.notOnRoster.answers))) {
    lines.push(`${plural(o.notOnRoster.students, 'roll number')} not on the roster: ${plural(o.notOnRoster.answers, 'answer')}`);
  }
  return (
    <div className="atn-outside">
      <span className="eyebrow">Outside the figure</span>
      {lines.length ? <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p>None in these rooms</p>}
    </div>
  );
}

/**
 * One class figure: an outcome, a Bloom band or a level.
 * @param head   what the figure is about
 * @param open   gallery only: open "What it rests on"
 */
function FigureRow({ fig, head, topLevel, sources, types, open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const st = fig.students ?? {};
  const nobody = !num(st.counted);
  const lvl = num(fig.attainmentLevel);
  const neeMarks = fig.outside?.notEnoughEvidence;
  const id = `atn-rest-${fig.id ?? fig.level ?? fig.code}`;
  return (
    <li className="atn-fig" data-archived={fig.archived || undefined}>
      <div className="atn-fig-head">
        <div className="atn-fig-what">{head}</div>
        <div className="atn-fig-result">
          <span className="atn-share">
            <b>{pctOf(fig.share)}</b>
            <small>{nobody ? 'nobody counted yet' : `of ${plural(st.counted, 'student')} counted attained`}</small>
          </span>
          <span className="atn-lvl" data-none={lvl === null || undefined}>
            <b>{lvl === null ? 'No level' : `Level ${lvl}`}</b>
            {lvl !== null && <small>{topLevel ? `of ${topLevel} in this formula` : 'from the formula'}</small>}
          </span>
        </div>
      </div>
      <div className="atn-fig-body">
        <dl className="atn-counts">
          <div><dt>On the roster</dt><dd>{num(st.roster) ?? '—'}</dd></div>
          <div><dt>Counted</dt><dd>{num(st.counted) ?? '—'}</dd></div>
          <div><dt>Attained</dt><dd>{num(st.attained) ?? '—'}</dd></div>
          <div><dt>Not attained</dt><dd>{num(st.notAttained) ?? '—'}</dd></div>
          <div>
            <dt>Not enough evidence</dt>
            <dd>{num(st.notEnoughEvidence) ?? '—'}{num(st.withNoAnswers) ? <small>{st.withNoAnswers} with no answers</small> : null}</dd>
          </div>
        </dl>
        <Outside out={fig.outside} />
      </div>
      {fig.summary && <p className="said atn-sum">{fig.summary}</p>}
      <button type="button" className="atn-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <Icon name="chevron" className="atn-more-ic" />
        What it rests on
      </button>
      {open && (
        <div className="atn-rest" id={id}>
          <MarksTable marks={fig.marks} sources={sources} types={types} caption="The students counted: their answers by evidence type." />
          {neeMarks?.marks && num(neeMarks.answers) > 0 && (
            <MarksTable marks={neeMarks.marks} sources={sources} types={types} caption="Outside the figure: the answers of roster students with not enough evidence." />
          )}
        </div>
      )}
    </li>
  );
}

function OutcomeHead({ o }) {
  const topics = list(o.topics);
  const direct = num(o.directQuestions) ?? 0;
  return (
    <>
      <span className="atn-fig-title">
        <span className="atn-code mono">{o.code}</span>
        <span className="atn-statement">{o.statement}</span>
      </span>
      <span className="atn-fig-meta">
        {o.archived && <Chip>Archived</Chip>}
        {o.targetLevel && <span className="cluster cluster-1">Target <Level level={o.targetLevel} /></span>}
        {topics.length === 0 && !direct ? (
          <span>Nothing mapped yet</span>
        ) : (
          <span>
            Mapped to{' '}
            {topics.map((t, i) => (
              <span key={`${t.contentId}-${t.topic}`}>
                {i > 0 && ', '}
                {t.topic}{num(t.weight) && t.weight !== 1 ? ` (weight ${mk(t.weight)})` : ''}
                {t.inChapter === false && <span className="atn-warn"> (renamed or no longer in the chapter: map the old name to keep this evidence)</span>}
              </span>
            ))}
            {direct ? `${topics.length ? ', and ' : ''}${plural(direct, 'question')} directly` : ''}
          </span>
        )}
      </span>
    </>
  );
}

function BandHead({ b }) {
  return (
    <span className="atn-fig-title">
      <span className="atn-pair">{list(b.levels).map((l) => <Level key={l} level={l}>{LEVELS.indexOf(l) + 1}</Level>)}</span>
      <span className="atn-statement">{b.label}</span>
    </span>
  );
}

function LevelHead({ l }) {
  return (
    <span className="atn-fig-title">
      <Level level={l.level}>{LEVELS.indexOf(l.level) + 1}</Level>
      <span className="atn-statement">{l.label ?? LABEL[l.level]}</span>
    </span>
  );
}

/* ---------------------------------------------------------- the sections */

function Outcomes({ r, openFirst }) {
  const outcomes = list(r.outcomes);
  const top = topLevelOf(r.formula);
  return (
    <section className="card ac-card" aria-labelledby="atn-co-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="atn-co-h">Course outcomes: the class</h2>
          <p>
            Per outcome, the students on the roster now by state, the share of those counted who attained it and the level the
            formula gives that share. Students outside the roster sit beside each figure, never in it.
          </p>
        </div>
      </div>
      {outcomes.length === 0 ? (
        <div className="atn-empty">
          <Icon name="target" size={18} />
          <div className="stack stack-1">
            <b>No course outcomes yet</b>
            <span className="t-small muted">Add them and map them to topics under <Link className="link" to="?view=outcomes">Outcomes</Link>; this report then reads every room against them.</span>
          </div>
        </div>
      ) : (
        <ol className="atn-figs">
          {outcomes.map((o, i) => (
            <FigureRow key={o.id ?? o.code} fig={o} head={<OutcomeHead o={o} />} topLevel={top} sources={r.questionSources} types={r.evidenceTypes} open={openFirst && i === 0} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Bloom({ r, first = 'bands' }) {
  const [reading, setReading] = useState(first);
  const top = topLevelOf(r.formula);
  const bands = list(r.bloom?.bands);
  const levels = list(r.bloom?.levels);
  return (
    <section className="card ac-card" aria-labelledby="atn-bl-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="atn-bl-h">Bloom attainment: the class</h2>
          <p>
            {reading === 'levels'
              ? 'The same rules for each of the six levels on its own, over every counted answer at that level, mapped to an outcome or not. Each figure rests on fewer answers than a band.'
              : 'The same rules for three pairs of levels, over every counted answer at those levels, mapped to an outcome or not. Six levels shows each one on its own.'}
          </p>
        </div>
        <Segmented
          label="Read by"
          value={reading}
          onChange={setReading}
          options={[{ id: 'bands', label: 'Three bands' }, { id: 'levels', label: 'Six levels' }]}
        />
      </div>
      <ol className="atn-figs">
        {reading === 'levels'
          ? levels.map((l) => <FigureRow key={l.level} fig={l} head={<LevelHead l={l} />} topLevel={top} sources={r.questionSources} types={r.evidenceTypes} />)
          : bands.map((b) => <FigureRow key={b.id} fig={b} head={<BandHead b={b} />} topLevel={top} sources={r.questionSources} types={r.evidenceTypes} />)}
      </ol>
    </section>
  );
}

/** The columns of the student table, and each student's cell under them. */
function columnsOf(r, matrix) {
  if (matrix === 'bands') {
    return list(r.bloom?.bands).map((b, i) => ({
      key: b.id, head: b.label, title: b.label, cell: (s) => list(s.bloom?.bands).find((c) => c.id === b.id) ?? list(s.bloom?.bands)[i],
    }));
  }
  if (matrix === 'levels') {
    return LEVELS.map((l, i) => ({
      key: l, head: LABEL[l], level: l, cell: (s) => list(s.bloom?.levels).find((c) => c.level === l) ?? list(s.bloom?.levels)[i],
    }));
  }
  return list(r.outcomes).map((o, i) => ({
    key: o.id ?? o.code, head: `${o.code}${o.archived ? ' (archived)' : ''}`, title: o.statement,
    cell: (s) => list(s.outcomes).find((c) => c.id === o.id) ?? list(s.outcomes)[i],
  }));
}

function Students({ r, onOpen, matrix: firstMatrix = 'outcomes' }) {
  const [matrix, setMatrix] = useState(firstMatrix);
  const students = list(r.students);
  const cols = columnsOf(r, matrix);
  const minAnswers = r.formula?.config?.minAnswers;
  const notes = list(r.rollNotes).length
    ? list(r.rollNotes)
    : students.filter((s) => s.status === 'not-on-roster' && s.note).map((s) => ({ rollNo: s.rollNo, note: s.note }));
  return (
    <section className="card ac-card" aria-labelledby="atn-st-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="atn-st-h">Students, in roll-number order</h2>
          <p>
            The roster, then removed students with evidence, then roll numbers not on the roster. Never ranked. Open a name
            for every answer behind that student’s figures.
          </p>
        </div>
        <Segmented
          label="Columns"
          value={matrix}
          onChange={setMatrix}
          options={[{ id: 'outcomes', label: 'Outcomes' }, { id: 'bands', label: 'Bloom bands' }, { id: 'levels', label: 'Bloom levels' }]}
        />
      </div>
      {students.length === 0 ? (
        <p className="atn-none">Nobody is on the roster, and no roll number answered in these rooms.</p>
      ) : cols.length === 0 ? (
        <p className="atn-none">No course outcomes yet, so there is nothing to read each student against.</p>
      ) : (
        <div className="tbl-wrap atn-twrap">
          <table className="tbl atn-tbl">
            <caption className="sr-only">Students by {matrix === 'outcomes' ? 'course outcome' : matrix === 'bands' ? 'Bloom level band' : 'Bloom level'}, in roll-number order</caption>
            <thead>
              <tr>
                <th scope="col" className="atn-roll">Roll no</th>
                <th scope="col" className="atn-name">Name</th>
                {cols.map((c) => (
                  <th scope="col" key={c.key} title={c.title}>
                    {c.level ? <Level level={c.level}>{c.head}</Level> : c.head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={`${s.status}-${s.studentId ?? s.rollNo}`} data-status={s.status}>
                  <th scope="row" className="atn-roll mono">{s.rollNo}</th>
                  <td className="atn-name">
                    {s.studentId ? (
                      <button type="button" className="atn-who" onClick={() => onOpen?.(s)}>
                        {s.name || s.rollNo}
                        <span className="sr-only">: open every answer behind this student’s figures</span>
                      </button>
                    ) : (
                      <span className="atn-who-plain">{s.name || 'No name typed'}</span>
                    )}
                    {s.status !== 'active' && <small className="atn-status">{s.statusLabel ?? s.status}</small>}
                  </td>
                  {cols.map((c) => <td key={c.key}><Cell c={c.cell(s)} minAnswers={minAnswers} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="atn-rollnotes" aria-label="Roll numbers not on the roster">
          {notes.map((n) => <li key={n.rollNo}><Icon name="info" /><span>{n.note}</span></li>)}
        </ul>
      )}
    </section>
  );
}

function Unmapped({ r }) {
  const a = r.answers ?? {};
  const items = list(r.unmapped);
  return (
    <section className="card ac-card" aria-labelledby="atn-un-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="atn-un-h">Not mapped to any outcome</h2>
          <p>Marked answers whose topic no course outcome is mapped to. They count in Bloom attainment, not in any outcome.</p>
        </div>
      </div>
      <div className="atn-pad">
        <p className="t-small">
          {(a.unmapped ?? 0).toLocaleString()} of {plural(a.graded ?? 0, 'marked answer')} {a.unmapped === 1 ? 'reaches' : 'reach'} no
          outcome; {(a.excluded ?? 0).toLocaleString()} {a.excluded === 1 ? 'is' : 'are'} kept out of every outcome by an override.
        </p>
        {items.length > 0 ? (
          <ul className="atn-unlist">
            {items.map((u) => (
              <li key={`${u.contentId}-${u.topic}`}>
                <span className="grow">
                  <b>{u.topic || 'No topic'}</b>
                  <small>{u.chapter}{u.inChapter === false ? ': renamed or no longer in the chapter' : ''}</small>
                </span>
                <span className="mono">{plural(u.answers ?? 0, 'answer')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-meta">Every marked answer in these rooms reaches a course outcome or is excluded on purpose.</p>
        )}
        <Link className="link t-small" to="?view=outcomes">Mappings are kept under Outcomes</Link>
      </div>
    </section>
  );
}

function Counts({ title, rows }) {
  return (
    <div className="atn-rec">
      <h3>{title}</h3>
      <dl>
        {rows.map(([label, n]) => (
          <div key={label} data-zero={!n || undefined}><dt>{label}</dt><dd className="mono">{num(n) ?? 0}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function Records({ r }) {
  const t = r.teacherRecords;
  if (!t) return null;
  const by = (group, key) => list(group?.[key]).map((k) => [k.label, group?.counts?.[k.id]]);
  return (
    <section className="card ac-card" aria-labelledby="atn-tr-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="atn-tr-h">{t.label || 'Teacher records'}</h2>
          <p>{t.note}</p>
        </div>
      </div>
      <div className="atn-recs">
        <Counts title="Observations, in student-days" rows={by(t.observations, 'kinds')} />
        <Counts title="Wheel picks" rows={[...by(t.picks, 'statuses'), ['All picks', t.picks?.total]]} />
        <Counts title="Hand tallies" rows={[['Questions asked aloud', t.tallies?.questions], ['Hands raised', t.tallies?.hands]]} />
        <Counts title="Activities" rows={[...by(t.activities, 'kinds'), ['All activities', t.activities?.total]]} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- the files */

function Files({ busy, onCsv, onPrint, disabled }) {
  return (
    <span className="atn-files">
      <Menu
        trigger={<Button size="sm" icon="download" busy={busy === 'outcomes' || busy === 'bloom'} disabled={disabled}>CSV</Button>}
        items={[
          { heading: 'Download a sheet of this report' },
          { id: 'outcomes', label: 'Course outcomes sheet', icon: 'material', onSelect: () => onCsv('outcomes') },
          { id: 'bloom', label: 'Bloom attainment sheet', icon: 'material', onSelect: () => onCsv('bloom') },
        ]}
      />
      <Button size="sm" icon="print" busy={busy === 'print'} disabled={disabled} onClick={onPrint}>Printable report</Button>
    </span>
  );
}

/* ================================================================ the view */

/**
 * The tab, drawn from what it is handed.
 *
 * @param report     { data, error, status, loading } for GET .../attainment
 * @param config     { data, error } for GET .../attainment/config (canEdit, the formula in force)
 * @param windowBar  the ReportWindow element (the container's), drawn on top
 * @param files      { busy: 'outcomes'|'bloom'|'print'|null, note: { tone, text } }
 * @param notice     { tone, text } from the last formula save, shown with the formula
 * @param first      gallery only: Bloom 'bands' (default) or 'levels'
 * @param matrix     gallery only: the student table's first columns
 * @param openFirst  gallery only: open the first outcome's "What it rests on"
 */
export function AttainmentView({
  report, config, windowBar, onReload, files, onCsv, onPrint, onOpenStudent, onEditFormula, notice,
  first, matrix, openFirst,
}) {
  const r = report?.data;
  const head = (
    <div className="atn-head">
      <div className="atn-bar">
        {windowBar}
        <span className="atn-bar-end">
          <Files busy={files?.busy} onCsv={onCsv} onPrint={onPrint} disabled={!r} />
          <Tip label="Read the report again">
            <Button size="sm" variant="ghost" icon="refresh" busy={report?.loading && Boolean(r)} aria-label="Read the report again" onClick={onReload} />
          </Tip>
        </span>
      </div>
      <p className="atn-filenote" data-tone={files?.note?.tone} role="status">{files?.note?.text ?? ''}</p>
    </div>
  );

  if (!r) {
    if (report?.loading || !report) return <div className="stack stack-5 atn">{head}<Skeleton /></div>;
    const notFound = report.status === 404;
    return (
      <div className="stack stack-5 atn">
        {head}
        <div className="card">
          <Empty
            icon={notFound ? 'search' : 'alert'}
            title={notFound ? 'Not found' : 'The attainment report did not load'}
            action={!notFound && <Button variant="primary" icon="refresh" onClick={onReload}>Try again</Button>}
          >
            {report.error || 'Nothing came back.'}
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="stack stack-5 atn" aria-busy={report.loading || undefined}>
      {head}
      {report.error && <Note tone="bad" role="alert">The report below is the last one that loaded: {report.error}</Note>}
      {config?.error && !config?.data && <Note tone="bad">The formula settings did not load: {config.error}</Note>}
      <Brief r={r} busy={report.loading} />
      <Outcomes r={r} openFirst={openFirst} />
      <Bloom r={r} first={first} />
      <Students r={r} onOpen={onOpenStudent} matrix={matrix} />
      <div className="atn-pair-cards">
        <Unmapped r={r} />
        <Records r={r} />
      </div>
      <FormulaPart
        formula={r.formula}
        methodology={r.methodology}
        rooms={r.rooms}
        evidenceTypes={r.evidenceTypes}
        definitions={r.definitions}
        windowed={hasWindow(r.window)}
        inForce={config?.data?.formula}
        canEdit={config?.data ? Boolean(config.data.canEdit) : null}
        onEdit={onEditFormula}
        notice={notice}
      />
      {r.privacy && <p className="cl-foot-privacy"><Icon name="shield" />{r.privacy}</p>}
    </div>
  );
}

/* ============================================================ the container */

/** One read: a newer read always wins, and a failed re-read keeps what is on screen. */
function useRead(read, deps) {
  const [s, setS] = useState({ data: null, error: '', status: 0, loading: true });
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    setS((p) => ({ ...p, loading: true, error: '', status: 0 }));
    return read().then(
      (data) => { if (seq.current === id) setS({ data, error: '', status: 0, loading: false }); return data; },
      (err) => { if (seq.current === id) setS((p) => ({ ...p, error: err.message, status: err.status ?? 0, loading: false })); return null; },
    );
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const set = useCallback((data) => setS({ data, error: '', status: 0, loading: false }), []);
  return { ...s, reload: load, set };
}

export default function Attainment({ classId }) {
  const [win, setWin] = useState(NO_WINDOW);
  const params = windowParams(win);
  const key = JSON.stringify(params);
  const report = useRead(() => api.attainment(classId, params), [classId, key]);
  const config = useRead(() => api.attainmentConfig(classId), [classId]);
  const [files, setFiles] = useState({ busy: null, note: null });
  const [student, setStudent] = useState(null); // { row, params, data, loading, error }
  const [printing, setPrinting] = useState({ busy: false, error: '' });
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(null);
  const path = `/classes/${encodeURIComponent(classId)}/attainment`;

  async function csv(sheet) {
    setFiles({ busy: sheet, note: null });
    try {
      const name = await api.downloadCsv(path, { ...params, ...(sheet === 'bloom' ? { sheet: 'bloom' } : {}) });
      setFiles({ busy: null, note: { tone: 'ok', text: `Saved ${name}` } });
    } catch (err) {
      setFiles({ busy: null, note: { tone: 'bad', text: err.message } });
    }
  }

  async function print() {
    setFiles({ busy: 'print', note: null });
    try {
      await api.openReport(path, params);
      setFiles({ busy: null, note: { tone: 'ok', text: 'Opened in a new tab: print it from there.' } });
    } catch (err) {
      setFiles({ busy: null, note: { tone: 'bad', text: err.message } });
    }
  }

  const readStudent = useCallback((row, at) => {
    setStudent({ row, params: at, data: null, loading: true, error: '' });
    api.studentAttainment(classId, row.studentId, at).then(
      (data) => setStudent((s) => (s?.row === row ? { ...s, data, loading: false } : s)),
      (err) => setStudent((s) => (s?.row === row ? { ...s, loading: false, error: err.message } : s)),
    );
  }, [classId]);

  async function printStudent() {
    if (!student?.row) return;
    setPrinting({ busy: true, error: '' });
    try {
      await api.openReport(`${path}/students/${encodeURIComponent(student.row.studentId)}`, student.params);
      setPrinting({ busy: false, error: '' });
    } catch (err) {
      setPrinting({ busy: false, error: err.message });
    }
  }

  return (
    <>
      <AttainmentView
        report={report}
        config={config}
        windowBar={<ReportWindow classId={classId} value={win} onChange={setWin} />}
        onReload={() => { report.reload(); config.reload(); }}
        files={files}
        onCsv={csv}
        onPrint={print}
        onOpenStudent={(row) => { setPrinting({ busy: false, error: '' }); readStudent(row, params); }}
        onEditFormula={() => setEditing(true)}
        notice={notice}
      />
      <StudentSheet
        row={student?.row}
        state={student}
        onClose={() => setStudent(null)}
        onRetry={() => student && readStudent(student.row, student.params)}
        onPrint={printStudent}
        printing={printing.busy}
        printError={printing.error}
      />
      {config.data?.canEdit && (
        <FormulaEdit
          classId={classId}
          open={editing}
          onOpenChange={setEditing}
          current={config.data}
          onReread={() => config.reload()}
          onSaved={(reply) => {
            if (reply?.formula) config.set(reply);
            setNotice(reply?.message ? { tone: reply.changed ? 'ok' : undefined, text: reply.message } : null);
            if (reply?.changed) report.reload();
          }}
        />
      )}
    </>
  );
}
