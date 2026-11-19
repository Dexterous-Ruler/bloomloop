/**
 * The pieces the self-test, Get Ready and the staff progress views share:
 * loading a reply and the states around it (loading, refused, failed), the
 * ids kept for a retry, the calm clock and the answered count above the
 * questions, the numbered way between questions, the check before handing in,
 * and the feedback shown after an answer.
 *
 * Every sentence a refusal carries is shown as the server wrote it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button, Dialog, Empty, Icon, Note } from '../ui/index.jsx';
import { newId } from './hubApi.js';
import RichText from './RichText.jsx';
import { langAttr } from './lang.js';

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
/** "Three topics", "1 answer", for a sentence's start. */
export const counted = (n, one, many = `${one}s`) => `${WORDS[n] ?? n} ${n === 1 ? one : many}`;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "A", "A and B", "A, B and C". */
export function listWords(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** "19 Nov, 13:44" in the reader's own time. */
export function when(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** A link styled as a button: going somewhere, not doing something. */
export function LinkButton({ to, variant = 'ghost', size, icon, children, className = '', ...rest }) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, className].filter(Boolean).join(' ');
  return <Link className={cls} to={to} {...rest}>{icon && <Icon name={icon} />}{children}</Link>;
}

/** Moves the page back to its top when a step changes (the shell scrolls inside .scroll). */
export function toTop() {
  requestAnimationFrame(() => {
    const s = document.querySelector('.scroll');
    if (s) s.scrollTop = 0;
  });
}

/** Puts focus on `ref` once, when the view arrives, so a screen reader starts there. */
export function useFocusOnArrive(ref) {
  useLayoutEffect(() => { ref.current?.focus({ preventScroll: true }); }, [ref]);
}

/* ---------------------------------------------------------------- loading */

/**
 * One reply, loaded: { state: 'loading' | 'ready' | 'failed', data, error,
 * retry, set }. A retry while the reply is on screen keeps it there until the
 * new one lands (so a poll never flashes a skeleton).
 */
export function useLoad(read, deps) {
  const [s, setS] = useState({ state: 'loading', data: null, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setS((p) => (p.state === 'ready' ? p : { state: 'loading', data: null, error: null }));
    read().then(
      (data) => { if (live) setS({ state: 'ready', data, error: null }); },
      (error) => { if (live) setS({ state: 'failed', data: null, error }); },
    );
    return () => { live = false; };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useCallback(() => setN((x) => x + 1), []);
  const set = useCallback((data) => setS({ state: 'ready', data, error: null }), []);
  return { ...s, retry, set };
}

/* ---------------------------------------------------------- kept run ids */

const RUN_KEY = 'bloomloop.hubRun.';
const inMemory = new Map();

/**
 * The clientRunId for one start (a self-test, a Get Ready check), kept for
 * this tab until the server has answered: a retry after a lost reply resends
 * the same id, so the server returns the one it made (200) and never a second.
 */
export function keptRunId(scope) {
  const key = RUN_KEY + scope;
  try {
    let id = sessionStorage.getItem(key);
    if (!id) { id = newId(); sessionStorage.setItem(key, id); }
    return id;
  } catch {
    if (!inMemory.has(key)) inMemory.set(key, newId());
    return inMemory.get(key);
  }
}

/** Forgets a start's id once the server has it (or has refused it for good). */
export function dropRunId(scope) {
  const key = RUN_KEY + scope;
  inMemory.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* private mode */ }
}

/* ------------------------------------------------------- refused, failed */

/**
 * What a failed read shows, by its status. 503: the hub is not set up on this
 * server, said calmly. 401: signed out, with the way to sign in. 403: the
 * wrong kind of account, with the way to where it belongs (`elsewhere`). 404:
 * the sentence and the way back. Anything else (no reply, a 5xx, a 400): the
 * sentence and Try again.
 */
export function Trouble({ error, onRetry, back = null, elsewhere = null }) {
  const status = error?.status ?? 0;
  const sentence = error?.message || 'This could not load.';
  if (status === 503) {
    return (
      <div className="card hub-trouble" data-calm="true">
        <Empty icon="info" title="The Learning Hub is not open on this server">
          {sentence}
        </Empty>
        {back && <div className="cluster hub-trouble-acts">{back}</div>}
      </div>
    );
  }
  if (status === 401) {
    return (
      <div className="card hub-trouble">
        <Empty icon="login" title="You are signed out" action={<LinkButton to="/signin" variant="primary" icon="login">Sign in</LinkButton>}>
          {sentence}
        </Empty>
      </div>
    );
  }
  if (status === 403) {
    return (
      <div className="card hub-trouble">
        <Empty
          icon="lock"
          title="Not for this account"
          action={elsewhere ? <LinkButton to={elsewhere.to} variant="primary" icon="forward">{elsewhere.label}</LinkButton> : null}
        >
          {sentence}
        </Empty>
      </div>
    );
  }
  if (status === 404) {
    return (
      <div className="card hub-trouble">
        <Empty icon="info" title="Not found" action={back}>{sentence}</Empty>
      </div>
    );
  }
  return (
    <div className="card card-pad hub-test-failed">
      <Note tone="bad" role="alert">
        <b>This could not load.</b> {sentence}
      </Note>
      <div className="cluster">
        {onRetry && <Button variant="primary" icon="refresh" onClick={onRetry}>Try again</Button>}
        {back}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ clock */

/**
 * Seconds left until `endsAt` (milliseconds on this device's clock, worked out
 * from the server's `secondsLeft` when the reply came), counted each second so
 * a tab in the background catches up. Null when there is no time limit.
 */
export function useCountdown(endsAt) {
  const [now, setNow] = useState(() => Date.now());
  const left = Number.isFinite(endsAt) ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;
  const running = left != null && left > 0;
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return left;
}

/** When a reply's clock runs out, in this device's milliseconds: `secondsLeft` first, `deadlineAt` if that is all there is. */
export function endsAtOf(exam, receivedAt = Date.now()) {
  if (!exam || exam.status !== 'open') return null;
  if (Number.isFinite(exam.secondsLeft)) return receivedAt + exam.secondsLeft * 1000;
  const d = Date.parse(exam.deadlineAt ?? '');
  return Number.isFinite(d) ? d : null;
}

const clockText = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/**
 * The calm clock: a quiet pill that never turns red and never covers a
 * question. It says when five minutes and one minute are left (once each),
 * and at zero that time is up. `minutes` is the limit chosen, so a short test
 * is not told "five minutes left" at its start.
 */
export function TestClock({ left, minutes }) {
  const up = left === 0;
  const say = up ? ''
    : left <= 60 && minutes > 1 ? 'One minute left.'
      : left <= 300 && minutes > 5 ? 'Five minutes left.' : '';
  return (
    <span className="hub-test-clock-wrap">
      <span className="hub-test-clock" data-up={up ? 'true' : undefined} role="timer" aria-label={up ? 'Time is up' : `${clockText(left)} left`}>
        <Icon name="timer" size={14} />
        <span className="mono num">{clockText(left)}</span>
        <span className="hub-test-clock-l">{up ? 'time is up' : 'left'}</span>
      </span>
      <span className="hub-test-clock-say" role="status">{say}</span>
    </span>
  );
}

/* -------------------------------------------------------------------- bar */

/**
 * The strip above the questions: answered of total (the server's figures), as
 * a figure and a thin line, and whatever the screen adds on the right. Sticky,
 * so it stays in view while the questions scroll under it.
 */
export function TestBar({ done, of, status, children }) {
  const pct = of ? Math.round((done / of) * 100) : 0;
  return (
    <div className="hub-test-bar">
      <div className="hub-test-bar-count" role="status">
        <span><b className="mono num">{done}</b> of {of} answered</span>
        <span className="hub-test-bar-line" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
        {status && <span className="hub-test-status" data-s={status}>{status === 'open' ? 'Open' : 'Ended'}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * The numbered way between questions. A filled number has an answer saved;
 * the current one is ringed. Each says both in words to a screen reader.
 * `tone` is 'panel' inside the forest panel, otherwise light.
 */
export function TestNav({ answered, current, onGo, label = 'Questions', tone }) {
  return (
    <nav className="hub-test-nav" data-tone={tone} aria-label={label}>
      <ol>
        {answered.map((a, i) => (
          <li key={i}>
            <button
              type="button"
              data-done={a === true ? 'true' : undefined}
              data-gone={a === null ? 'true' : undefined}
              aria-current={current === i ? 'step' : undefined}
              aria-label={`Question ${i + 1}, ${a === null ? 'not asked' : a ? 'answered' : 'no answer yet'}`}
              onClick={() => onGo(i)}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------- the check */

/**
 * Before handing in with questions unanswered, or answers still on this
 * device: which ones, what that means, and a way back to the first of them.
 */
export function HandInCheck({ open, onOpenChange, missing, kept = 0, onGo, onHandIn, busy }) {
  if (!missing.length && !kept) return null;
  const nums = missing.map((i) => i + 1);
  const title = missing.length
    ? `Hand in with ${counted(missing.length, 'question').toLowerCase()} unanswered?`
    : 'Hand in before every answer has reached the server?';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title.charAt(0).toUpperCase() + title.slice(1)}
      description="An unanswered question is not marked, and its answer stays hidden until you have tried it."
      footer={(
        <>
          {missing.length > 0 && <Button variant="ghost" onClick={() => onGo(missing[0])}>Go to question {nums[0]}</Button>}
          <Button variant="primary" busy={busy} onClick={onHandIn}>Hand in</Button>
        </>
      )}
    >
      {missing.length > 0 && (
        <p className="hub-test-check">
          {nums.length === 1 ? 'Question' : 'Questions'} {listWords(nums.map(String))} {nums.length === 1 ? 'has' : 'have'} no answer yet.
        </p>
      )}
      {kept > 0 && (
        <p className="hub-test-check">
          {counted(kept, 'answer')} {kept === 1 ? 'is' : 'are'} kept on this device and not sent yet. Handed in now, {kept === 1 ? 'it' : 'they'} would arrive after the end and not count.
        </p>
      )}
    </Dialog>
  );
}

/* ----------------------------------------------------- after an answer */

/** Right, not right, or a provisional machine mark, in words with a mark. */
export function Verdict({ correct, provisional = false, answered = true, held = false }) {
  const v = held ? 'held' : !answered ? 'none' : provisional ? 'part' : correct ? 'right' : 'wrong';
  const word = { right: 'Right', wrong: 'Not right', none: 'Not answered', part: 'Provisional mark', held: 'Held back for now' }[v];
  const icon = { right: 'ok', wrong: 'wrong', none: 'minus', part: 'hourglass', held: 'clock' }[v];
  return <span className="hub-test-verdict" data-v={v}><Icon name={icon} size={15} />{word}</span>;
}

/**
 * The explanation and the feedback on the option chosen, as the server sends
 * them after an answer: never before. Each with who wrote it.
 */
export function WhyBlock({ explanation, optionFeedback = [], optionText }) {
  const fb = Array.isArray(optionFeedback) ? optionFeedback : [];
  if (!explanation && !fb.length) return null;
  return (
    <div className="hub-test-whys">
      {fb.map((f, i) => (
        <div key={`fb${i}`} className="hub-test-why" data-kind="feedback">
          <span className="hub-test-why-l">
            {optionText?.(f.option) ? `On your choice: ${optionText(f.option)}` : 'On your choice'}
          </span>
          <RichText html={f.html} text={f.text} lang={langAttr(f.language?.language ?? f.language)} />
          {(f.byLabel || citeWords(f.cite)) && (
            <p className="hub-test-src">{[f.byLabel, citeWords(f.cite)].filter(Boolean).join(' · ')}</p>
          )}
        </div>
      ))}
      {explanation && (
        <div className="hub-test-why" data-kind="explanation">
          <span className="hub-test-why-l">Why</span>
          <RichText html={explanation.textHtml} text={explanation.text} lang={langAttr(explanation.language?.language)} />
          {explanation.label && <p className="hub-test-src">{explanation.label}</p>}
          {explanation.language?.note && <p className="hub-test-src">{explanation.language.note}</p>}
        </div>
      )}
    </div>
  );
}

/** Where a piece of feedback comes from ("Slides 4, 5"), however the server sends it. */
export function citeWords(cite) {
  if (!cite) return '';
  if (typeof cite === 'string') return cite;
  if (Array.isArray(cite)) return cite.length ? `Slide${cite.length === 1 ? '' : 's'} ${cite.join(', ')}` : '';
  return cite.text ?? cite.label ?? '';
}

/* --------------------------------------------------------- loading shape */

/** The shape of a test page while it loads: the brief, then two cards. */
export function TestSkeleton() {
  return (
    <div className="hub-test-skel" role="status" aria-busy="true" aria-label="Loading">
      <div className="skel hub-test-skel-panel" />
      <div className="hub-test-skel-row">
        <div className="card card-pad stack-3 stack">
          <div className="skel" style={{ height: 14, width: '32%' }} />
          {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 44 }} />)}
        </div>
        <div className="card card-pad stack-3 stack">
          <div className="skel" style={{ height: 14, width: '45%' }} />
          <div className="skel" style={{ height: 36 }} />
          <div className="skel" style={{ height: 36 }} />
          <div className="skel" style={{ height: 44, marginTop: 8 }} />
        </div>
      </div>
    </div>
  );
}

/** Re-runs `fn` every `ms` while `on`, the latest `fn` each time. */
export function useEvery(on, ms, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}
