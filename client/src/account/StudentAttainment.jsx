/**
 * One student's attainment, with every answer behind it (Phase 4), and the
 * words the class report shares with it.
 *
 *   GET /api/classes/:id/attainment/students/:studentId   (docs/API.md)
 *
 * A sheet opened from a row of the class report's student table. Staff only:
 * it is never offered to the student, the projector or the wall. The figures
 * are the server's; this file only words them. A state is always said in
 * words ("Not enough evidence" is its own state, never "not attained"), and
 * every figure says how many answers it rests on.
 *
 * The first half of the file is the shared vocabulary: evidence types, states,
 * shares and the evidence table, which account/Attainment.jsx imports.
 */

import { useState } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { Button, Chip, Dialog, Icon, Level, Note, Segmented } from '../ui/index.jsx';
import { dayOf } from './dashParts.jsx';

/* ------------------------------------------------------- shared words */

export const list = (v) => (Array.isArray(v) ? v : []);
export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const plural = (n, one, many = `${one}s`) => `${Number(n ?? 0).toLocaleString()} ${Number(n) === 1 ? one : many}`;

/** A mark as stored: up to 3 decimals, never padded. */
export const mk = (v) => (num(v) === null ? '0' : v.toLocaleString(undefined, { maximumFractionDigits: 3 }));

/**
 * A share as the server cut it (4 decimals, rounded down): "33.33%", "50%".
 * Floored again here, never rounded, so 0.5999 is "59.99%" and can never read
 * as 60% beside a 60% threshold. Null is a dash.
 */
export const pctOf = (share) => (num(share) === null ? '—' : `${Math.floor(share * 10000 + 1e-6) / 100}%`);

/** A formula share (3 decimals): "50%", "66.7%". */
export const pctRule = (share) => (num(share) === null ? '—' : `${Number((share * 100).toFixed(1))}%`);

/**
 * The evidence types every figure is split by. The provisional type is the
 * keyword marker's match of the rubric, not AI: it is named for what it is.
 * A re-vote after a class discussion (Phase 5) is always shown and never
 * counted (`never`): no formula may count it. Labels and descriptions come
 * from the server where it sends them.
 */
export const TYPES = [
  { id: 'digital', label: 'Digital answers', short: 'digital' },
  { id: 'aiProvisional', label: 'Provisional machine marks', short: 'provisional machine mark' },
  { id: 'humanReviewed', label: 'Reviewed by a professor', short: 'reviewed by a professor' },
  { id: 'revote', label: 'Re-votes after discussion', short: 're-vote', never: true },
];
/** The types a formula may count: every type but the re-vote. */
export const COUNTABLE = TYPES.filter((t) => !t.never);
export const TYPE_LABEL = Object.fromEntries([...TYPES.map((t) => [t.id, t.label]), ['ungraded', 'Polls']]);

/** The evidence types with the server's labels and descriptions where the reply carries them. */
export function typesFrom(evidenceTypes) {
  const given = new Map(list(evidenceTypes).map((t) => [t.id, t]));
  return TYPES.map((t) => ({ ...t, label: given.get(t.id)?.label || t.label, description: given.get(t.id)?.description ?? '' }));
}

/** Who wrote the question: the second split, labelled by the server where the reply carries it. */
export const SOURCES = [
  { id: 'aiGenerated', label: 'AI-generated questions' },
  { id: 'professorWritten', label: 'Professor-written questions' },
  { id: 'offlineTemplate', label: 'Offline-template questions (and professor-written ones from before 19 Nov 2026)' },
];
const SOURCE_OF_ROW = { llm: 'aiGenerated', teacher: 'professorWritten', fallback: 'offlineTemplate' };

/** The question sources with the server's labels where the reply carries them. */
export function sourcesFrom(questionSources) {
  const given = new Map(list(questionSources).map((q) => [q.id, q]));
  return SOURCES.map((q) => ({ ...q, label: given.get(q.id)?.label || q.label, description: given.get(q.id)?.description ?? '' }));
}

/** "AI-generated questions: 0; Professor-written questions: 12; ...", from a bySource count. */
export const bySourceLine = (bySource, questionSources) => (bySource && typeof bySource === 'object'
  ? sourcesFrom(questionSources).map((q) => `${q.label}: ${(num(bySource[q.id]) ?? 0).toLocaleString()}`).join('; ')
  : '');

export const STATE_LABEL = { attained: 'Attained', 'not-attained': 'Not attained', 'not-enough-evidence': 'Not enough evidence' };

/** A state in words. The tint only repeats the words. */
export function State({ state, label }) {
  const s = STATE_LABEL[state] ? state : 'unknown';
  return <span className="atn-st" data-state={s}>{label || STATE_LABEL[state] || state || 'No state'}</span>;
}

/** Answers of a type the formula does not count, polls aside. */
export const notCounted = (marks) => TYPES.reduce((n, t) => n + (marks?.[t.id] && marks[t.id].counted === false ? num(marks[t.id].answers) ?? 0 : 0), 0);

/**
 * What one student's cell rests on, in a line: "40% of the marks, 4 of 10,
 * 10 answers"; for not enough evidence, how many counted answers there are
 * against the formula's minimum.
 */
export function cellLine(c, minAnswers) {
  if (!c) return 'No figure';
  const answers = num(c.answers) ?? 0;
  if (c.state === 'not-enough-evidence') {
    if (!answers) return 'No counted answers';
    return `${plural(answers, 'counted answer')}${num(minAnswers) ? `, ${minAnswers} needed` : ''}`;
  }
  return `${pctOf(c.share)} of the marks: ${mk(c.obtained)} of ${mk(c.possible)}, ${plural(answers, 'answer')}`;
}

/** One cell of a student matrix, or one line of a student's own report. */
export function Cell({ c, minAnswers }) {
  const off = notCounted(c?.marks);
  return (
    <span className="atn-cell">
      <State state={c?.state} label={c?.stateLabel} />
      <small>{cellLine(c, minAnswers)}</small>
      {off > 0 && <small className="atn-cell-off">{plural(off, 'answer')} shown, not counted</small>}
    </span>
  );
}

/**
 * A figure's marks by evidence type, each said to be counted or not; then, when
 * the server sends it, the same counted marks by who wrote the question.
 */
export function MarksTable({ marks, sources, types, caption }) {
  if (!marks) return null;
  const qs = marks.questionSources;
  const srcRows = qs && typeof qs === 'object' ? sourcesFrom(sources).filter((s) => qs[s.id]) : [];
  return (
    <div className="atn-marks">
      <div className="tbl-wrap">
        <table className="tbl atn-mtbl">
          {caption && <caption className="atn-cap">{caption}</caption>}
          <thead>
            <tr><th scope="col">Evidence</th><th scope="col" className="r">Answers</th><th scope="col" className="r">Marks</th><th scope="col">Under this formula</th></tr>
          </thead>
          <tbody>
            {typesFrom(types).map((t) => {
              // A re-vote is always shown, with or without answers, and never counted.
              const m = marks[t.id] ?? (t.never ? { answers: 0, counted: false } : null);
              if (!m) return null;
              return (
                <tr key={t.id} data-off={m.counted === false || undefined}>
                  <th scope="row">{t.label}</th>
                  <td className="r mono">{num(m.answers) ?? 0}</td>
                  <td className="r mono">{m.answers ? `${mk(m.obtained)} of ${mk(m.possible)}` : '—'}</td>
                  <td>{t.never ? 'Never counted' : m.counted === false ? 'Shown, not counted' : 'Counted'}</td>
                </tr>
              );
            })}
            {marks.ungraded && (
              <tr data-off>
                <th scope="row">Polls</th>
                <td className="r mono">{num(marks.ungraded.answers) ?? 0}</td>
                <td className="r">—</td>
                <td>Not marked: a count only</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {srcRows.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl atn-mtbl">
            <caption className="atn-cap">The counted answers in the table above, again by who wrote the question. This moves no mark.</caption>
            <thead>
              <tr><th scope="col">Question source</th><th scope="col" className="r">Counted answers</th><th scope="col" className="r">Marks</th><th scope="col" className="r">Shown, not counted</th></tr>
            </thead>
            <tbody>
              {srcRows.map((s) => {
                const m = qs[s.id] ?? {};
                return (
                  <tr key={s.id}>
                    <th scope="row">{s.label}</th>
                    <td className="r mono">{num(m.answers) ?? 0}</td>
                    <td className="r mono">{m.answers ? `${mk(m.obtained)} of ${mk(m.possible)}` : '—'}</td>
                    <td className="r mono">{num(m.notCounted) ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A sentence from the server with its `backticked` names drawn as code. Nothing is reworded. */
export function Said({ text }) {
  return String(text ?? '').split('`').map((part, i) => (i % 2 ? <code key={i} className="mono">{part}</code> : part));
}

/** Titles for the definitions a report carries; any other key is shown under its own name. */
const DEF_TITLE = {
  evidenceTypes: 'Evidence types', questionSources: 'Question sources', marks: 'Marks', states: 'States',
  classFigure: 'The class figure', mapping: 'What an outcome is mapped to', answers: 'Answers', bloom: 'Bloom attainment',
  rooms: 'Rooms', order: 'Order', rolls: 'Roll numbers',
};

/** A report's `definitions`, each as it comes, in a disclosure. */
export function Definitions({ definitions }) {
  const rows = Object.entries(definitions ?? {}).filter(([, v]) => typeof v === 'string' && v.trim());
  if (!rows.length) return null;
  return (
    <details className="atn-defs">
      <summary><Icon name="chevron" className="atn-more-ic" />Definitions, as the server gives them</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}><dt>{DEF_TITLE[k] ?? k}</dt><dd><Said text={v} /></dd></div>
        ))}
      </dl>
    </details>
  );
}

/* ------------------------------------------------------- the student sheet */

const VIA = {
  topic: 'through its topic',
  question: 'mapped to it directly by an override',
  excluded: 'kept out of every outcome by an override',
  unmapped: 'no outcome is mapped to its topic',
};

/** "0/4 pairs", a written answer's own words, or nothing. */
function given(a) {
  const kind = a.kind || a.question?.kind;
  if (kind === 'open' && typeof a.response === 'string' && a.response.trim()) return { written: a.response };
  return { detail: a.detail || a.auto?.detail || '' };
}

function markWords(a) {
  if (a.ungraded || a.evidenceType === 'ungraded') return 'A poll: not marked';
  const s = num(a.score);
  if (s === null) return typeof a.correct === 'boolean' ? (a.correct ? 'Right' : 'Wrong') : 'No mark recorded';
  return `${mk(s)} of 1`;
}

function AnswerItem({ a, typeLabel, sourceLabel }) {
  const g = given(a);
  const level = a.level || a.question?.bloom;
  const kind = a.kind || a.question?.kind;
  const source = a.questionSourceType || SOURCE_OF_ROW[a.questionSource];
  const reaches = list(a.outcomes);
  // A vote on a question put to the whole class (`classQuestion: { id, round }`).
  // Its `note` says why one was set aside, e.g. a student who had already
  // answered the question alone and been shown its answer.
  const cq = a.classQuestion ?? (a.classQuestionId ? { id: a.classQuestionId, round: a.round } : null);
  return (
    <li className="atn-ans" data-counts={a.counts ? 'true' : 'false'}>
      <div className="atn-ans-top">
        <span className="atn-ans-where">
          <span className="mono">{a.room?.code ?? '—'}</span>
          {a.answeredAt && <span>{dayOf(a.answeredAt)}</span>}
          {num(a.attempt) && a.attempt > 1 && <span>attempt {a.attempt}</span>}
          {cq && <span className="atn-ans-cq">{Number(cq.round) === 2 ? 'Class question, re-vote' : 'Class question, first vote'}</span>}
        </span>
        <span className="atn-ans-verdict">
          {a.counts ? <Chip tone="accent" icon="check">Counted</Chip> : <Chip tone="line">{a.chosen === false ? 'Set aside' : 'Not counted'}</Chip>}
        </span>
      </div>
      <p className="atn-ans-q">{a.question?.text || 'The question text was not kept.'}</p>
      {g.written && <blockquote className="atn-ans-said">{g.written}</blockquote>}
      <dl className="atn-ans-facts">
        <div><dt>Mark</dt><dd>{markWords(a)}{g.detail ? ` (${g.detail})` : ''}</dd></div>
        <div><dt>Evidence</dt><dd>{typeLabel[a.evidenceType] ?? a.evidenceType ?? '—'}</dd></div>
        {level && <div><dt>Level</dt><dd><Level level={level} /></dd></div>}
        {kind && <div><dt>Kind</dt><dd>{KIND_LABEL[kind] ?? kind}</dd></div>}
        {source && <div><dt>Source</dt><dd>{sourceLabel[source] ?? source}</dd></div>}
        {a.givenAs && <div><dt>Given as</dt><dd className="mono">{a.givenAs}</dd></div>}
        <div>
          <dt>Outcomes</dt>
          <dd>
            {reaches.length
              ? reaches.map((o) => `${o.code ?? 'An outcome'}${num(o.weight) && o.weight !== 1 ? ` (weight ${mk(o.weight)})` : ''}`).join(', ')
              : 'None'}
            {a.via && VIA[a.via] ? `, ${VIA[a.via]}` : ''}
          </dd>
        </div>
      </dl>
      {a.note && a.note !== 'Counted.' && <p className="atn-ans-note">{a.note}</p>}
    </li>
  );
}

function CellList({ cells, minAnswers, head }) {
  return (
    <ul className="atn-slist">
      {cells.map((c) => (
        <li key={c.id ?? c.level}>
          <span className="atn-slist-head">{head(c)}</span>
          <Cell c={c} minAnswers={minAnswers} />
        </li>
      ))}
    </ul>
  );
}

// A student's bands come without their levels; these are decision 6's pairs
// (server/src/services/classAnalytics.js, LEVEL_BANDS), for the marks only.
const BAND_LEVELS = { lower: ['remember', 'understand'], middle: ['apply', 'analyse'], higher: ['evaluate', 'create'] };

const countStates = (cells) => {
  const n = { attained: 0, 'not-attained': 0, 'not-enough-evidence': 0 };
  cells.forEach((c) => { if (c.state in n) n[c.state] += 1; });
  return `${n.attained} attained, ${n['not-attained']} not attained, ${n['not-enough-evidence']} not enough evidence`;
};

/**
 * One student's report in a sheet.
 *
 * @param row      the class report's row that was opened: { studentId, rollNo, name, statusLabel }
 * @param state    { data, loading, error } for GET .../attainment/students/:studentId
 * @param onPrint  opens the student's printable page; `printing` while it is fetched
 * @param first    'bands' (decision 6, the default) or 'levels'
 * @param filter   gallery only: 'all' | 'counted' | 'not'
 */
export function StudentSheet({ row, state, onClose, onRetry, onPrint, printing, printError, first = 'bands', filter: firstFilter = 'all' }) {
  const [reading, setReading] = useState(first);
  const [filter, setFilter] = useState(firstFilter);
  const d = state?.data;
  const s = d?.student ?? row;
  const minAnswers = d?.formula?.config?.minAnswers;
  const outcomes = list(d?.outcomes);
  const answers = list(d?.answers);
  const counted = answers.filter((a) => a.counts).length;
  const shown = filter === 'counted' ? answers.filter((a) => a.counts) : filter === 'not' ? answers.filter((a) => !a.counts) : answers;
  const bloom = reading === 'levels' ? list(d?.bloom?.levels) : list(d?.bloom?.bands);
  const ac = d?.answerCounts;
  const tr = d?.teacherRecords;
  const removed = s?.status === 'removed' || s?.active === false;
  const types = typesFrom(d?.evidenceTypes);
  const typeLabel = { ...Object.fromEntries(types.map((t) => [t.id, t.label])), ungraded: 'Polls' };
  const sourceLabel = Object.fromEntries(sourcesFrom(d?.questionSources).map((q) => [q.id, q.label]));

  return (
    <Dialog
      sheet
      open={Boolean(row)}
      onOpenChange={(open) => { if (!open) onClose?.(); }}
      title={s ? (s.name || s.rollNo) : 'One student'}
      description={s ? [s.rollNo, s.statusLabel].filter(Boolean).join(' · ') : undefined}
    >
      {row && (
        <div className="stack atn-sheet">
          <div className="cluster between">
            <span className="t-meta">{d ? `Formula version ${d.formula?.version ?? '—'}, ${plural(list(d.rooms).length, 'room')} in this report` : ' '}</span>
            <Button size="sm" icon="print" busy={printing} onClick={onPrint} disabled={!d}>Printable page</Button>
          </div>
          {printError && <Note tone="bad" role="alert">{printError}</Note>}
          {removed && <Note>Removed from the roster. Their evidence stays readable here and is never counted in a class figure.</Note>}

          {state?.loading && !d && (
            <div className="stack stack-3" aria-busy="true">
              <div className="skel" style={{ height: 44 }} />
              <div className="skel" style={{ height: 120 }} />
              <div className="skel" style={{ height: 90 }} />
              <div className="skel" style={{ height: 90 }} />
            </div>
          )}
          {state?.error && (
            <Note tone="bad" role="alert">
              {state.error}{' '}
              {onRetry && <button type="button" className="link ac-linkbtn" onClick={onRetry}>Try again</button>}
            </Note>
          )}

          {d && (
            <>
              {d.privacy && <p className="said atn-privacy">{d.privacy}</p>}

              <section className="stack stack-2" aria-labelledby="atn-s-co">
                <div className="atn-sh">
                  <h3 id="atn-s-co">Course outcomes</h3>
                  <span className="t-meta">{outcomes.length ? countStates(outcomes) : 'No course outcomes yet'}</span>
                </div>
                {outcomes.length > 0 && (
                  <CellList
                    cells={outcomes}
                    minAnswers={minAnswers}
                    head={(c) => (
                      <>
                        <b className="mono">{c.code}</b>
                        {c.archived && <Chip>Archived</Chip>}
                        {c.statement && <span className="atn-slist-st">{c.statement}</span>}
                      </>
                    )}
                  />
                )}
              </section>

              <section className="stack stack-2" aria-labelledby="atn-s-bl">
                <div className="atn-sh">
                  <h3 id="atn-s-bl">Bloom attainment</h3>
                  <Segmented
                    label="Read by"
                    value={reading}
                    onChange={setReading}
                    options={[{ id: 'bands', label: 'Three bands' }, { id: 'levels', label: 'Six levels' }]}
                  />
                </div>
                <CellList
                  cells={bloom}
                  minAnswers={minAnswers}
                  head={(c) => (reading === 'levels'
                    ? <Level level={c.level}>{c.label ?? LABEL[c.level]}</Level>
                    : (
                      <>
                        <span className="atn-pair">{list(c.levels ?? BAND_LEVELS[c.id]).map((l) => <Level key={l} level={l}>{LEVELS.indexOf(l) + 1}</Level>)}</span>
                        <b>{c.label}</b>
                      </>
                    ))}
                />
              </section>

              <section className="stack stack-2" aria-labelledby="atn-s-ans">
                <div className="atn-sh">
                  <h3 id="atn-s-ans">Every answer behind these figures</h3>
                  <Segmented
                    label="Show"
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { id: 'all', label: 'All', count: answers.length },
                      { id: 'counted', label: 'Counted', count: counted },
                      { id: 'not', label: 'Not counted', count: answers.length - counted },
                    ]}
                  />
                </div>
                {ac && (
                  <p className="t-meta">
                    Oldest first. {plural(ac.rows, 'attempt')} stored in these rooms
                    {ac.setAside ? `, ${ac.setAside} set aside by the attempts rule` : ''}; {plural(ac.graded, 'marked answer')}
                    {/* A re-vote is named even at 0, since no formula ever counts it. */}
                    {` (${types.filter((t) => ac.byType?.[t.id] || t.never).map((t) => `${t.label}: ${ac.byType?.[t.id] ?? 0}${t.never ? ', never counted' : ''}`).join('; ')})`}
                    {ac.ungraded ? `; ${plural(ac.ungraded, 'poll')}` : ''}.
                    {ac.bySource && ` By who wrote the question: ${bySourceLine(ac.bySource, d.questionSources)}.`}
                  </p>
                )}
                {shown.length === 0 ? (
                  <p className="atn-none">{answers.length ? 'Nothing here under this filter.' : 'No answers from this student in the rooms of this report.'}</p>
                ) : (
                  <ol className="atn-anslist">{shown.map((a, i) => <AnswerItem key={a.answerId ?? i} a={a} typeLabel={typeLabel} sourceLabel={sourceLabel} />)}</ol>
                )}
              </section>

              {tr && (
                <section className="stack stack-2 atn-recs-own" aria-labelledby="atn-s-tr">
                  <div className="atn-sh">
                    <h3 id="atn-s-tr">Teacher records</h3>
                  </div>
                  <p className="t-meta">{tr.label}. {tr.note}</p>
                  {list(tr.observations?.days).length === 0 && list(tr.picks?.list).length === 0 ? (
                    <p className="atn-none">No observations or wheel picks for this student in these rooms.</p>
                  ) : (
                    <>
                      {list(tr.observations?.days).length > 0 && (
                        <ul className="atn-obs">
                          {tr.observations.days.map((o) => (
                            <li key={o.day}>
                              <span className="mono">{o.day}</span>
                              <b>{o.label ?? o.kind}</b>
                              {o.note && <span className="atn-obs-note">{o.note}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {list(tr.picks?.list).length > 0 && (
                        <ul className="atn-obs">
                          {tr.picks.list.map((p, i) => (
                            <li key={`${p.room}-${p.round}-${i}`}>
                              <span className="mono">{p.room ?? '—'}</span>
                              <b>Wheel pick: {PICK[p.status] ?? p.status}</b>
                              {p.pickedAt && <span className="atn-obs-note">{dayOf(p.pickedAt)}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </section>
              )}
            </>
          )}
          <p className="cl-foot-privacy"><Icon name="shield" />Staff only. Never shown to the student, on the projector or on the wall.</p>
        </div>
      )}
    </Dialog>
  );
}

const PICK = { pending: 'pending', answered: 'answered', passed: 'passed to partner', help: 'needs help', skipped: 'skipped', absent: 'absent' };
