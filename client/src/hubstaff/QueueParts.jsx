/**
 * What the professor's review queues share (explanations, hints and option
 * feedback, lessons, translations, language statistics): reading a queue,
 * the states a queue can be in, a background run, and the small pieces each
 * row draws. Every sentence on screen is the server's; this file only places
 * them.
 *
 *   useQueue(read)                 -> { data, error, loading, reload, patch }
 *   <QueueLoading rows />          skeleton rows in the list's shape
 *   <QueueFailed error onRetry />  503 calm, 401 sign in, 403 where you belong, else Try again
 *   useRun(readRun)                -> { state, start(post, { onDone }), clear, busy }
 *   <RunLine state words onClear names />   a run's note, progress, sentence and skipped
 *   <QMeta q />                    level, topic, kind and the bank's status
 *   <WhoLine status provenance label model />   who wrote it; "AI draft" until approved
 *   <TextSlot ... />               write or rewrite one text, the refusal inline
 *   <ReadOnly />                   the line an HOD sees in place of the controls
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { newId, untilDone } from '../hub/hubApi.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { DraftTag, StatusTag } from '../teach/ItemStats.jsx';
import { Button, Empty, Icon, Level, Note } from '../ui/index.jsx';

export const list = (v) => (Array.isArray(v) ? v : []);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* ------------------------------------------------------------ the read */

/**
 * One queue's read. `read` must be stable (useCallback on its id). A new
 * `read` starts again from nothing; `reload({ quiet: true })` keeps what is on
 * screen while it asks, and a failed quiet read leaves it there.
 */
export function useQueue(read) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const req = useRef(0);

  const load = useCallback(({ quiet = false } = {}) => {
    const id = ++req.current;
    setState((s) => (quiet && s.data ? { ...s, loading: true } : { data: null, error: null, loading: true }));
    return read().then(
      (data) => { if (req.current === id) setState({ data, error: null, loading: false }); },
      (error) => { if (req.current === id) setState((s) => ({ data: quiet ? s.data : null, error, loading: false })); },
    );
  }, [read]);

  useEffect(() => { load(); }, [load]);

  /** Change what is on screen from a write's reply, before the quiet re-read lands. */
  const patch = useCallback((fn) => setState((s) => (s.data ? { ...s, data: fn(s.data) } : s)), []);

  return { ...state, reload: load, patch };
}

/* ------------------------------------------------------------ the states */

/** The list's shape, while it comes. */
export function QueueLoading({ rows = 3 }) {
  return (
    <div className="hq" aria-busy="true" aria-label="Loading">
      <div className="hq-bar">
        <div className="skel" style={{ width: 260, height: 32, borderRadius: 9 }} />
        <div className="skel" style={{ width: 150, height: 32, borderRadius: 9 }} />
      </div>
      <div className="card hq-list">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="hq-skel-row">
            <div className="cluster">
              <div className="skel" style={{ width: 84, height: 16 }} />
              <div className="skel" style={{ width: 120, height: 14 }} />
            </div>
            <div className="skel" style={{ width: '82%', height: 16 }} />
            <div className="skel" style={{ height: 56, borderRadius: 10 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Why the queue did not load, in the server's sentence. A 503 (no accounts on
 * this server) is a calm state, not a fault; a 401 points at sign-in; a 403 on
 * a staff read means a student, who belongs in their own hub.
 */
export function QueueFailed({ error, onRetry, busy = false, what = 'This queue' }) {
  const status = error?.status;
  const sentence = error?.message || 'The server did not answer.';
  if (status === 503) {
    return (
      <div className="card hq-calm" role="status">
        <Empty icon="info" title="The Learning Hub is not open on this server">{sentence}</Empty>
      </div>
    );
  }
  if (status === 401) {
    return (
      <div className="card" role="alert">
        <Empty icon="lock" title="You are signed out" action={<Link className="btn btn-primary" to="/signin"><Icon name="login" />Sign in</Link>}>{sentence}</Empty>
      </div>
    );
  }
  if (status === 403) {
    return (
      <div className="card" role="alert">
        <Empty icon="lock" title="Not for this account" action={<Link className="btn" to="/hub"><Icon name="back" />Your Learning Hub</Link>}>{sentence}</Empty>
      </div>
    );
  }
  if (status === 404) {
    return (
      <div className="card" role="alert">
        <Empty icon="alert" title="Not found" action={<Link className="btn" to="/hubs"><Icon name="back" />Your classes in the hub</Link>}>{sentence}</Empty>
      </div>
    );
  }
  return (
    <div className="card" role="alert">
      <Empty icon="alert" title={`${what} did not load`} action={onRetry && <Button variant="primary" icon="refresh" busy={busy} onClick={() => onRetry()}>Try again</Button>}>
        {sentence}
      </Empty>
    </div>
  );
}

/** In place of every control, for an HOD (canEdit false). */
export function ReadOnly({ children = 'Read-only. Only the professor who owns this can change it.' }) {
  return <p className="hq-readonly"><Icon name="eye" size={14} />{children}</p>;
}

/** A read that came back after one already on screen failed to refresh. */
export function StaleRead({ error }) {
  if (!error) return null;
  return <Note tone="bad" role="alert">{error.message} What is shown is the last answer the server gave.</Note>;
}

/* ------------------------------------------------------------ a run */

/**
 * A background run on the professor's button. `post(runId)` sends the press
 * with a device-made run id; a 202 answers at once and the run is polled to
 * its end (untilDone), while a press that does its work before answering
 * (explanations) has its run watched meanwhile, for progress.
 *
 * state: null | { phase: 'running' | 'done' | 'failed' | 'refused' | 'lost', runId, reply, run, error }
 */
export function useRun(readRun) {
  const [state, setState] = useState(null);
  const ctl = useRef(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const start = useCallback(async (post, { onDone } = {}) => {
    ctl.current?.abort();
    const ac = new AbortController();
    ctl.current = ac;
    const live = () => !ac.signal.aborted;
    const runId = newId();
    const put = (patch) => { if (live()) setState((s) => ({ ...s, ...patch })); };
    setState({ phase: 'running', runId, reply: null, run: null, error: null });

    let settled = false;
    (async () => {
      while (!settled && live()) {
        await wait(1500);
        if (settled || !live()) return;
        try {
          const { run } = await readRun(runId);
          if (!settled && run) put({ run });
        } catch { /* the run is not there until the press reaches it */ }
      }
    })();

    let reply;
    try {
      reply = await post(runId);
    } catch (error) {
      settled = true;
      put({ phase: 'refused', error });
      return;
    }
    settled = true;
    if (!live()) return;
    const id = reply?.runId || runId;
    put({ runId: id, reply });
    try {
      const run = await untilDone(readRun, id, { signal: ac.signal, onTick: (r) => put({ run: r }) });
      put({ phase: run?.state === 'failed' ? 'failed' : 'done', run });
      if (live()) onDone?.(run, reply);
    } catch (error) {
      if (error?.aborted) return;
      put({ phase: 'lost', error });
      if (live()) onDone?.(null, reply);
    }
  }, [readRun]);

  const clear = useCallback(() => { ctl.current?.abort(); setState(null); }, []);
  return { state, start, clear, busy: state?.phase === 'running' };
}

/**
 * What a run says: the press's note (the offline note plainly), progress while
 * it runs, the run's sentence when it ends (`run.error`: on a finished run it
 * says what was not done), what was skipped and why. `words.running` names
 * the work ("Drafting hints"); `words.progress(run)` words its progress;
 * `names` maps a question id to its text, for the skipped list.
 */
export function RunLine({ state, words, onClear, names }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  if (!state) return null;
  const { phase, reply, run, error } = state;
  const note = reply?.note || '';
  const said = run?.error || '';
  const skipped = list(reply?.skipped);
  const warnings = list(reply?.warnings);
  const progress = run && words.progress ? words.progress(run) : '';

  let head;
  if (phase === 'running') {
    head = (
      <p className="hq-run-head" role="status">
        <span className="spinner" aria-hidden="true" />
        <b>{words.running}</b>
        {progress && <span className="t-meta">{progress}</span>}
      </p>
    );
  } else if (phase === 'done') {
    head = (
      <p className="hq-run-head" role="status">
        <Icon name={said ? 'info' : 'ok'} size={16} className={said ? 'hq-ic-warn' : 'hq-ic-ok'} />
        <b>{words.done}</b>
      </p>
    );
  }

  return (
    <div className="hq-run" data-phase={phase}>
      <div className="hq-run-body">
        {head}
        {(phase === 'refused' || phase === 'lost') && <Note tone="bad" role="alert">{error?.message}</Note>}
        {phase === 'failed' && <Note tone="bad" role="alert">{said || 'The run stopped before it finished.'}</Note>}
        {note && <p className="hq-run-note">{note}</p>}
        {phase === 'done' && said && said !== note && <Note tone="warn" role="note">{said}</Note>}
        {warnings.map((w) => <Note key={w} tone="warn" role="note">{w}</Note>)}
        {skipped.length > 0 && (
          <div className="hq-skipped">
            <button type="button" className="hq-disclose" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)}>
              <Icon name={open ? 'chevronUp' : 'chevron'} size={14} />
              {plural(skipped.length, 'question')} left out, and why
            </button>
            {open && (
              <ul id={panel} className="hq-skipped-list">
                {skipped.map((s, i) => (
                  <li key={`${s.questionId}-${i}`}>
                    <span className="hq-skipped-q">{names?.get?.(String(s.questionId).toLowerCase()) || 'A question'}</span>
                    <span className="hq-skipped-why">{s.why}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {phase !== 'running' && onClear && (
        <Button variant="ghost" size="sm" icon="close" aria-label="Dismiss" onClick={onClear} />
      )}
    </div>
  );
}

/** Does the run's line already say this sentence? Then a note above it need not say it again. */
export const saysRun = (state, sentence) => Boolean(sentence) && (state?.reply?.note === sentence || state?.run?.error === sentence);

/** questionId (lower case) -> its text, for naming what a run skipped. */
export function namesOf(questions) {
  return new Map(list(questions).map((q) => [String(q.questionId ?? q.id).toLowerCase(), q.text]));
}

/* ------------------------------------------------------------ a row */

/** Level, topic, kind and, when it is not simply approved, the bank's status. */
export function QMeta({ q, children }) {
  return (
    <span className="hq-meta">
      <Level level={q.bloom} />
      {q.topic && <span className="hq-topic clip" title={q.topic}>{q.topic}</span>}
      <i className="it-dot" aria-hidden="true" />
      <span>{q.kindLabel ?? KIND_LABEL[q.kind] ?? q.kind}</span>
      <StatusTag status={q.status} />
      {children}
    </span>
  );
}

/**
 * Who wrote it and where it stands, as the server labels it. An AI draft
 * carries the dashed "AI draft" mark beside the server's sentence ("AI draft:
 * not shown to students until approved"); the model's name is staff-only.
 */
export function WhoLine({ status, provenance, label, model, children }) {
  const draft = provenance === 'ai' && status === 'draft';
  // The mark only where the server's own label does not already open with it.
  const tag = draft && !/^AI draft/i.test(String(label ?? ''));
  return (
    <p className="hq-who">
      {tag && <DraftTag />}
      <span className={draft ? 'hq-who-draft' : undefined}>{label}</span>
      {model && provenance === 'ai' && <span className="hq-model mono">{model}</span>}
      {children}
    </p>
  );
}

/**
 * Write or rewrite one piece of text. `onSave(text)` returns a promise; a
 * refusal's sentence (a hint that gives the answer away, say) stays under the
 * box, with the text kept, until the next try.
 */
export function TextSlot({ label, initial = '', max, rows = 4, lang, saveLabel = 'Save', onSave, onCancel, hint }) {
  const id = useId();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef(null);
  useEffect(() => { box.current?.focus(); }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(text);
    } catch (err) {
      setError(err?.message || 'The server did not answer.');
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const over = max && text.length > max;
  return (
    <div className="hq-edit">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <textarea
        ref={box}
        id={id}
        className="textarea hq-textarea"
        rows={rows}
        lang={lang}
        value={text}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy) { e.preventDefault(); save(); }
        }}
      />
      {error && <p id={`${id}-err`} className="hq-refused" role="alert"><Icon name="alert" size={15} /><span>{error}</span></p>}
      <div className="hq-edit-foot">
        <span className="t-meta">
          {hint}
          {max ? <span className={`mono hq-count${over ? ' is-over' : ''}`}>{text.length} / {max}</span> : null}
        </span>
        <span className="cluster cluster-1">
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}
          <Button size="sm" variant="primary" icon="check" busy={busy} disabled={!text.trim()} onClick={save}>{saveLabel}</Button>
        </span>
      </div>
    </div>
  );
}

/**
 * The server's notes on how a queue works: `lead` (strings) said in the open,
 * the rest (an object of sentences, or strings) behind one disclosure.
 */
export function Notes({ lead = [], rest = [], label = 'How this works' }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const more = (Array.isArray(rest) ? rest : Object.values(rest ?? {})).filter((s) => typeof s === 'string' && s && !lead.includes(s));
  const said = lead.filter(Boolean);
  if (!said.length && !more.length) return null;
  return (
    <div className="hq-notes">
      {said.map((s) => <p key={s} className="hq-note">{s}</p>)}
      {more.length > 0 && (
        <>
          <button type="button" className="hq-disclose" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? 'chevronUp' : 'chevron'} size={14} />{label}
          </button>
          {open && <ul id={panel} className="hq-notes-more">{more.map((s) => <li key={s}>{s}</li>)}</ul>}
        </>
      )}
    </div>
  );
}

/** A filter over a queue: [{ id, label, count }] and the one shown. Counts are rows on screen. */
export function pickFilter(options, wanted) {
  const ids = options.map((o) => o.id);
  if (ids.includes(wanted)) return wanted;
  return options.find((o) => o.count > 0 && o.id !== 'all')?.id ?? 'all';
}
