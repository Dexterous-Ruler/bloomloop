/**
 * Misconceptions: which wrong options students chose, linked to the
 * misunderstanding a professor named for each (or the model proposed, as a
 * draft). Staff only; a label never reaches a phone or the projector.
 *
 * Every figure and sentence is the server's (docs/API.md "Phase 5:
 * misconception labels on wrong options", "The reports"): this file only lays
 * them out. Counts only: no student is named, and nothing is ordered by a
 * student's score. `top` is the server's order of misunderstandings (most
 * students first), and the questions come in the server's order (ladder,
 * topic, text).
 *
 *   <MisconceptionsView data loading error onRetry filter? />   the report, drawn from what it is handed
 *   <RoomMisconceptions code />          GET /api/session/:code/misconceptions, with its own read-again
 *   <ClassMisconceptions classId />      GET /api/classes/:id/misconceptions, narrowed by the shared
 *                                        ReportWindow (dates and rooms), as the attainment tab is
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import ReportWindow, { NO_WINDOW, windowParams } from '../account/ReportWindow.jsx';
import { api } from '../lib/api.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { Button, Empty, Icon, Level, Note } from '../ui/index.jsx';
import { DraftTag, StatusTag } from './ItemStats.jsx';

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const width = (part, whole) => `${whole > 0 ? Math.min(100, (100 * part) / whole) : 0}%`;
/** "Choose one", "Choose all that apply" or "True or false": the kinds a label goes on. */
const LABELLED_KINDS = (() => {
  const k = ['mcq', 'multi', 'truefalse'].map((id) => `“${KIND_LABEL[id] ?? id}”`);
  return `${k.slice(0, -1).join(', ')} or ${k[k.length - 1]}`;
})();

/* ------------------------------------------------------------ the parts */

function Skeleton() {
  return (
    <div className="mc-skel" aria-busy="true" aria-label="Counting the misconceptions">
      <span className="skel mc-skel-line" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mc-skel-row"><span className="skel" /><span className="skel" /><span className="skel" /></div>
      ))}
      <span className="skel mc-skel-line" />
      {[0, 1].map((i) => (
        <div key={i} className="mc-skel-q"><span className="skel" /><span className="skel" /><span className="skel" /></div>
      ))}
    </div>
  );
}

/**
 * One of the misunderstandings most students chose. The figure and the label
 * are drawn large; a screen reader is read the server's sentence instead.
 * `of` is how many students answered the question, from the same report.
 */
function TopRow({ t, q }) {
  const students = num(t.students) ?? 0;
  const of = num(q?.students);
  const opt = list(q?.options).find((o) => o.optionIdx === t.optionIdx);
  const draft = t.provenance === 'ai';
  return (
    <li className="mc-top-row" data-draft={draft ? 'true' : undefined}>
      <span className="mc-top-n" aria-hidden="true">
        <b>{students}</b>
        <small>{students === 1 ? 'student' : 'students'}</small>
      </span>
      <div className="mc-top-body">
        <p className="mc-top-label" aria-hidden="true">
          <span>{t.label}</span>
          {draft && <DraftTag>{opt?.provenanceLabel || 'AI draft'}</DraftTag>}
        </p>
        <p className="sr-only">{t.sentence}</p>
        <p className="mc-top-q clip" title={t.text}>{t.text}</p>
        {of !== null && of > 0 && (
          <div className="mc-share">
            <span className="mc-bar" aria-hidden="true"><i style={{ width: width(students, of) }} /></span>
            <span className="mc-share-t"><b className="mono">{students}</b> of <b className="mono">{of}</b> who answered it</span>
          </div>
        )}
      </div>
    </li>
  );
}

/** One labelled option: the server's sentence, which option it is, and when the label came. */
function OptionRow({ o, of }) {
  const students = num(o.students) ?? 0;
  const answers = num(o.answers) ?? 0;
  const draft = o.provenance === 'ai' && o.confirmed !== true;
  return (
    <li className="mc-opt" data-zero={students === 0 ? 'true' : undefined} data-draft={draft ? 'true' : undefined}>
      <span className="mc-opt-n" aria-hidden="true">
        <b>{students}</b>
        {of > 0 && <small>of {of}</small>}
        <span className="mc-mini"><i style={{ width: width(students, of) }} /></span>
      </span>
      <div className="mc-opt-body">
        <p className="mc-sentence">{o.sentence}</p>
        <p className="mc-opt-line">
          <span className="mc-opt-k">Option {Number(o.optionIdx) + 1}<span className="sr-only">: </span></span>
          <span className="mc-opt-t clip" title={o.option}>{o.option}</span>
          {answers !== students && <span className="mc-opt-a">{plural(answers, 'answer')}</span>}
          {draft && <DraftTag>{o.provenanceLabel || 'AI draft'}</DraftTag>}
        </p>
        {o.note && <p className="mc-opt-note"><Icon name="history" size={13} />{o.note}</p>}
      </div>
    </li>
  );
}

/** One labelled question: what it is, who answered it, and each labelled option. */
function QuestionBlock({ q }) {
  const hid = useId();
  const answers = num(q.answers) ?? 0;
  const students = num(q.students) ?? 0;
  const prov = q.provenance;
  return (
    <article className="mc-q" aria-labelledby={hid}>
      <div className="mc-q-head">
        <span className="mc-q-meta">
          <Level level={q.bloom} />
          {q.topic && <span className="mc-topic clip">{q.topic}</span>}
          <i className="it-dot" aria-hidden="true" />
          <span>{q.kindLabel || KIND_LABEL[q.kind] || q.kind}</span>
          {prov?.label && (
            prov.aiDraft
              ? <DraftTag title={prov.sentence || undefined}>{prov.label}</DraftTag>
              : <><i className="it-dot" aria-hidden="true" /><span className="mc-prov" title={prov.sentence || undefined}>{prov.label}</span></>
          )}
          <StatusTag status={q.status} />
        </span>
        <h4 id={hid} className="mc-q-text">{q.text || 'Question text not stored'}</h4>
        <p className="mc-q-count">
          {answers > 0
            ? <><b className="mono">{students}</b> {students === 1 ? 'student' : 'students'} answered it · <b className="mono">{answers}</b> counted {answers === 1 ? 'answer' : 'answers'}</>
            : 'Nobody has answered it yet.'}
        </p>
      </div>
      {q.otherWordingNote && <p className="mc-aside">{q.otherWordingNote}</p>}
      <ul className="mc-opts" aria-label="Labelled wrong options">
        {list(q.options).map((o) => <OptionRow key={o.optionIdx} o={o} of={students} />)}
      </ul>
    </article>
  );
}

/* ------------------------------------------------------------ the view */

/**
 * The report for a room or a class, drawn from what it is handed.
 *
 * @param data     the body of GET /api/session/:code/misconceptions or
 *                 GET /api/classes/:id/misconceptions (null before the first read)
 * @param loading  a read is out
 * @param error    the last read's error ('' for none); with data, the figures
 *                 on screen are the earlier read's
 * @param onRetry  read again (optional)
 * @param filter   optional element drawn under the heading (the class's ReportWindow)
 */
export function MisconceptionsView({ data, loading = false, error = '', onRetry, filter }) {
  const hid = useId();
  const isClass = Boolean(data?.class);
  const questions = list(data?.questions);
  const top = list(data?.top);
  const byQ = useMemo(() => new Map(questions.map((q) => [q.questionId, q])), [questions]);
  const counted = data?.counted ?? {};
  const answers = num(counted.answers) ?? 0;
  const labels = num(counted.labels) ?? 0;
  const drafts = num(counted.aiDrafts) ?? 0;
  const rooms = list(data?.rooms).length;
  const where = isClass ? (rooms ? `across ${plural(rooms, 'room')} of this class` : 'in this class’s rooms') : 'in this room';

  let sub = 'Which wrong options students chose, and the misunderstanding each one is linked to. Counts only.';
  if (data && questions.length) {
    sub = answers
      ? `${plural(labels, 'label')} on ${plural(questions.length, 'question')}, from ${plural(answers, 'counted answer')} ${where}.`
      : `${plural(labels, 'label')} on ${plural(questions.length, 'question')} ${where}; nobody has answered one yet.`;
  }

  const head = (
    <header className="mc-head">
      <div className="sec">
        <h2 id={hid}>Misconceptions</h2>
        <p>{sub}</p>
      </div>
      {onRetry && data && (
        <Button size="sm" variant="ghost" icon="refresh" busy={loading} onClick={onRetry}>Read again</Button>
      )}
    </header>
  );

  if (!data) {
    return (
      <section className="card mc" aria-labelledby={hid}>
        {head}
        {filter && <div className="mc-filter">{filter}</div>}
        {error ? (
          <div className="mc-pad">
            <Note tone="bad" role="alert">
              Could not read the misconception counts: {error}
              {onRetry && <div className="mc-retry"><Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button></div>}
            </Note>
          </div>
        ) : <Skeleton />}
      </section>
    );
  }

  const foot = (
    <footer className="mc-foot">
      {data.privacy && <p className="mc-privacy"><Icon name="eyeOff" size={14} /><span>{data.privacy}</span></p>}
      {data.method && (
        <details className="mc-method">
          <summary><Icon name="chevron" size={14} className="mc-method-chev" />How these are counted</summary>
          <p>{data.method}</p>
        </details>
      )}
    </footer>
  );

  return (
    <section className="card mc" aria-labelledby={hid} aria-busy={loading || undefined}>
      {head}
      {filter && <div className="mc-filter">{filter}</div>}
      {error && <p className="mc-stale" role="status">Could not read the counts again just now ({error}). These were read earlier.</p>}

      {questions.length === 0 ? (
        <Empty icon="idea" title={isClass ? 'No labelled question was answered in these rooms' : 'No labelled question was answered in this room'}>
          A count appears here once students answer a question that has a misconception label on a wrong option.
          Labels are added in the question bank, beside the wrong options of a {LABELLED_KINDS} question.
        </Empty>
      ) : (
        <div className="mc-body">
          {drafts > 0 && (
            <p className="mc-drafts">
              <DraftTag />
              <span>
                {drafts === labels
                  ? (drafts === 1 ? 'The label here is the model’s draft' : `All ${drafts} labels here are the model’s drafts`)
                  : `${drafts} of the ${labels} labels here ${drafts === 1 ? 'is the model’s draft' : 'are the model’s drafts'}`}
                , not yet confirmed by the professor.
              </span>
            </p>
          )}

          <section className="mc-top" aria-labelledby={`${hid}-top`}>
            <h3 id={`${hid}-top`} className="eyebrow mc-eyebrow">Most chosen</h3>
            {top.length ? (
              <ul className="mc-top-list">
                {top.map((t) => <TopRow key={`${t.questionId}:${t.optionIdx}`} t={t} q={byQ.get(t.questionId)} />)}
              </ul>
            ) : (
              <p className="mc-hint">No student has chosen a labelled option yet.</p>
            )}
          </section>

          <section className="mc-qs" aria-labelledby={`${hid}-qs`}>
            <h3 id={`${hid}-qs`} className="eyebrow mc-eyebrow">By question</h3>
            {questions.map((q) => <QuestionBlock key={q.questionId} q={q} />)}
          </section>
        </div>
      )}
      {foot}
    </section>
  );
}

/* ------------------------------------------------------------ the reads */

/**
 * One read keyed by `key`: a newer read always wins, a read again keeps the
 * figures on screen until it answers, and a new key (another room, another
 * window) starts from the skeleton so one report is never shown as another.
 */
function useReport(key, read) {
  const [s, setS] = useState({ for: null, data: null, error: '', loading: false });
  const seq = useRef(0);
  const readRef = useRef(read);
  readRef.current = read;

  const load = useCallback(() => {
    const id = ++seq.current;
    if (!key) { setS({ for: null, data: null, error: '', loading: false }); return; }
    setS((p) => (p.for === key ? { ...p, loading: true, error: '' } : { for: key, data: null, error: '', loading: true }));
    readRef.current().then(
      (data) => { if (seq.current === id) setS({ for: key, data, error: '', loading: false }); },
      (err) => { if (seq.current === id) setS((p) => ({ ...p, for: key, error: err.message, loading: false })); },
    );
  }, [key]);

  useEffect(() => { load(); }, [load]);
  const mine = s.for === key;
  return { data: mine ? s.data : null, error: mine ? s.error : '', loading: !mine || s.loading, reload: load };
}

/** A room's report: GET /api/session/:code/misconceptions, read again on request. */
export function RoomMisconceptions({ code }) {
  const r = useReport(code || null, () => api.roomMisconceptions(code));
  return <MisconceptionsView data={r.data} loading={r.loading} error={r.error} onRetry={r.reload} />;
}

/**
 * A class's report over its rooms: GET /api/classes/:id/misconceptions with
 * the dates and rooms of the shared ReportWindow, as the attainment tab.
 */
export function ClassMisconceptions({ classId }) {
  const [win, setWin] = useState(NO_WINDOW);
  const params = windowParams(win);
  const key = classId ? `${classId}?${JSON.stringify(params)}` : null;
  const r = useReport(key, () => api.classMisconceptions(classId, params));
  return (
    <MisconceptionsView
      data={r.data}
      loading={r.loading}
      error={r.error}
      onRetry={r.reload}
      filter={<ReportWindow classId={classId} value={win} onChange={setWin} />}
    />
  );
}

export default MisconceptionsView;
