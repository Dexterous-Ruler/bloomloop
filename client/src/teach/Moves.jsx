/**
 * Batch 8: AI teaching moves on the console (docs/UI_ZIP_AUDIT.md L1 and C2).
 * Staff only: nothing here is ever drawn on a phone or the projector.
 *
 * L1, "Suggest a move": one press asks the server for a two-minute activity
 * that needs no device, aimed at the level where the class is stuck. The
 * server answers 202 at once and writes it in the background from the room's
 * counts only (never a name) and the chapter's own slides. This screen shows
 * "Reading the class data…" until `teacher:teaching-move` arrives for its
 * request or the request reads done or failed, then the suggestion with the
 * server's basis sentence, "AI suggestion, your call" and the slides it cites.
 * "Another idea" is the same press again; "Use it" records the activity with
 * the suggestion's id. With no model the server says so in a sentence, shown
 * as it comes: this screen never makes a suggestion up.
 *
 * C2, "Ask AI for a prompt": the same route asked for one activity kind (and
 * optionally one of the chapter's topics). The prompt shows large with its
 * slide citation and the AI label. Activities.jsx draws it with PromptPanel.
 *
 * Every figure and sentence here is the server's; this file lays them out.
 * A server without batch 8 answers the list with a 404: the card hides.
 *
 *   <MoveCard code canControl closed pushed onOpenActivities />   the live card (Insights space)
 *   <MoveCardView state onAsk onUse onOpenActivities />           the same, pure (gallery)
 *   <PromptPanel kind state topics topic onTopic onAsk onUse onClose />   C2, pure
 *   useMoveAsk(code, pushed)                                       one request's life
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { record } from '../lib/consoleOutbox.js';
import { Button, Icon } from '../ui/index.jsx';
import '../styles/moves.css';

/** The server's label; used only when a reply leaves it out. */
export const AI_LABEL = 'AI suggestion, your call';
const POLL_MS = 2500;
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const clock = (iso) => {
  const at = iso ? new Date(iso) : null;
  return at && !Number.isNaN(at.getTime()) ? CLOCK.format(at) : '';
};

/* ------------------------------------------------------------- citation */

/** [3, 4, 5, 8] -> "3–5, 8". */
function runs(nums) {
  const sorted = [...new Set(nums.filter(Number.isInteger))].sort((a, b) => a - b);
  const out = [];
  for (const n of sorted) {
    const last = out.at(-1);
    if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
}

/**
 * What a suggestion cites, in words: "Slides 3–4 · Binary trees", "Slide 6",
 * or "The chapter's text · Binary trees". Null when it cites nothing.
 */
export function citeOf(sourceRef) {
  if (!sourceRef || typeof sourceRef !== 'object') return null;
  const topic = String(sourceRef.topic ?? '').trim();
  const slides = Array.isArray(sourceRef.slides) ? sourceRef.slides.filter(Number.isInteger) : [];
  let where = null;
  if (sourceRef.kind === 'slides' && slides.length) where = `${slides.length === 1 ? 'Slide' : 'Slides'} ${runs(slides)}`;
  else if (sourceRef.kind === 'text') where = 'The chapter’s text';
  return [where, topic].filter(Boolean).join(' · ') || null;
}

/* ------------------------------------------------------------- one request */

const IDLE = { phase: 'idle' };

/**
 * One ask at a time, from the press to its outcome. `pushed` is the latest
 * `teacher:teaching-move` (useRoomFeed), matched by requestId; the request is
 * also read every few seconds, so a missed push (or none, on a screen with no
 * socket) still ends the wait.
 *
 * state.phase: idle | asking | running | done | offline | failed | refused | error
 *   done      suggestion (moveView)
 *   offline   message: the server's sentence, nothing made up
 *   failed    message: the server's FAILED sentence
 *   refused   message, status: a 409 (no graded answers yet, one already being
 *             written, the room closed), a 400 or a 403, as the server said it
 *   error     message: no answer from the server
 */
export function useMoveAsk(code, pushed) {
  const [state, setState] = useState(IDLE);
  const asked = useRef(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const settle = useCallback((requestId, next) => {
    if (!live.current || asked.current?.requestId !== requestId) return;
    asked.current = { ...asked.current, requestId: null };
    setState(next);
  }, []);

  const ask = useCallback(async (body = {}) => {
    asked.current = { requestId: null, at: Date.now(), body };
    setState({ phase: 'asking', body });
    try {
      const r = await api.askTeachingMove(code, body);
      if (!live.current) return;
      if (r?.state === 'offline') { setState({ phase: 'offline', body, message: r.message, label: r.label }); return; }
      if (r?.state === 'running' && r.requestId) {
        asked.current = { requestId: r.requestId, at: asked.current?.at ?? Date.now(), body, purpose: r.purpose };
        setState({ phase: 'running', body, requestId: r.requestId, label: r.label });
        return;
      }
      setState({ phase: 'error', body, message: 'The server answered in a way this screen does not read.' });
    } catch (err) {
      if (!live.current) return;
      setState(err.status
        ? { phase: 'refused', body, status: err.status, message: err.message }
        : { phase: 'error', body, message: err.message });
    }
  }, [code]);

  // The push for this request.
  const requestId = state.phase === 'running' ? state.requestId : null;
  useEffect(() => {
    if (!requestId || pushed?.requestId !== requestId) return;
    if (pushed.state === 'done' && pushed.suggestion) settle(requestId, { phase: 'done', suggestion: pushed.suggestion, body: state.body });
    else if (pushed.state === 'failed') settle(requestId, { phase: 'failed', message: pushed.message, body: state.body });
  }, [pushed, requestId, settle, state.body]);

  // And the request itself, read until it is done or failed.
  useEffect(() => {
    if (!requestId) return undefined;
    const body = state.body;
    let stop = false;
    async function fromList(suggestionId) {
      const list = await api.teachingMoves(code);
      const all = Array.isArray(list?.suggestions) ? list.suggestions : [];
      if (suggestionId) return all.find((s) => s.id === suggestionId) ?? null;
      // After a restart the request is gone; its suggestion, if one was made, is in the list.
      const since = (asked.current?.at ?? 0) - 5000;
      return all.filter((s) => Date.parse(s.askedAt) >= since && s.purpose === (asked.current?.purpose ?? s.purpose)).at(-1) ?? null;
    }
    async function poll() {
      try {
        const r = await api.teachingMoveRequest(code, requestId);
        if (stop) return;
        if (r?.state === 'done') {
          const suggestion = r.suggestion ?? await fromList(r.suggestionId);
          if (suggestion) settle(requestId, { phase: 'done', suggestion, body });
        } else if (r?.state === 'failed') {
          settle(requestId, { phase: 'failed', message: r.message, body });
        }
      } catch (err) {
        if (stop || err.status !== 404) return; // no answer: read again on the next tick
        const suggestion = await fromList(null).catch(() => null);
        if (stop) return;
        settle(requestId, suggestion ? { phase: 'done', suggestion, body } : { phase: 'failed', message: err.message, body });
      }
    }
    const timer = setInterval(poll, POLL_MS);
    return () => { stop = true; clearInterval(timer); };
  }, [code, requestId, settle]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Show a suggestion read from the list (after a reload), as if just made. */
  const restore = useCallback((suggestion) => {
    if (suggestion) setState((s) => (s.phase === 'idle' ? { phase: 'done', suggestion, restored: true } : s));
  }, []);

  return { state, ask, restore };
}

/**
 * "Use it": the activity recorded through the console outbox with the
 * suggestion's id (its kind comes with it). Resolves { ok, activity } |
 * { kept } | { error }.
 */
export async function recordSuggestion(code, s) {
  const out = await record('activityCreate', { code, body: { suggestionId: s.id, kind: s.kind } }, {
    label: `${s.kindLabel || s.kind}, from an AI suggestion`,
  });
  if (out.refused) return { error: out.error };
  if (out.kept) return { kept: true };
  return { ok: true, activity: out.reply?.activity ?? null };
}

/* ------------------------------------------------------------- the pieces */

/** The suggestion itself: title, text, basis + label, what it cites. */
function Suggestion({ s, large = false }) {
  const cite = citeOf(s.sourceRef);
  const basis = String(s.basis?.sentence ?? '').trim();
  return (
    <div className="mv-said">
      {s.title && <h3 className="mv-title">{s.title}</h3>}
      <p className={large ? 'mv-text mv-text-lg' : 'mv-text'}>{s.text}</p>
      <p className="mv-basis">{basis ? `${basis} · ` : ''}{s.label || AI_LABEL}</p>
      {cite && <p className="mv-cite"><Icon name="deck" size={13} />{cite}</p>}
    </div>
  );
}

function Waiting({ children }) {
  return (
    <p className="mv-wait" role="status">
      <span className="spinner" aria-hidden="true" />
      {children}
    </p>
  );
}

/** The outcome of "Use it", in a line. */
function Used({ used, onOpenActivities }) {
  if (!used) return null;
  if (used.error) return <p className="mv-say" data-tone="bad" role="alert">{used.error}</p>;
  return (
    <p className="mv-used" role="status">
      <Icon name={used.kept ? 'clock' : 'check'} size={14} />
      <span>
        {used.kept
          ? 'Saved on this device. It is recorded as an activity when the laptop reconnects.'
          : `Recorded as ${used.label || 'an activity'}${used.at ? ` at ${clock(used.at)}` : ''}.`}
      </span>
      {onOpenActivities && <button type="button" className="mv-link" onClick={onOpenActivities}>Open Activities</button>}
    </p>
  );
}

/* ------------------------------------------------------------- L1: the card */

/**
 * The card, drawn from a request's state. `use` is { busy } while "Use it" is
 * out, then { at, label } | { kept } | { error }.
 */
export function MoveCardView({ state = IDLE, use = null, onAsk, onUse, onOpenActivities }) {
  const { phase } = state;
  const s = phase === 'done' ? state.suggestion : null;
  const waiting = phase === 'asking' || phase === 'running';
  const usedHere = Boolean(use && !use.busy && !use.error);
  const usedBefore = !use && Array.isArray(s?.used) && s.used.length > 0;

  return (
    <section className="card mv-card" aria-labelledby="mv-card-k" aria-busy={waiting || undefined}>
      <span className="mv-ic" aria-hidden="true"><Icon name="spark" size={16} /></span>
      <div className="mv-body">
        <p className="mv-k" id="mv-card-k">
          AI teaching move
          {s?.kindLabel && <span className="mv-kind">{s.kindLabel}</span>}
          {state.restored && s?.askedAt && <span className="mv-when">Suggested at {clock(s.askedAt)}</span>}
        </p>

        {waiting ? (
          <Waiting>Reading the class data…</Waiting>
        ) : s ? (
          <Suggestion s={s} />
        ) : phase === 'offline' ? (
          <p className="mv-say">{state.message}</p>
        ) : phase === 'failed' ? (
          <p className="mv-say" data-tone="bad" role="alert">{state.message}</p>
        ) : (
          <>
            <p className="mv-lead">Get a two-minute, no-device activity aimed at where the class is stuck.</p>
            <p className="mv-hint">Built from this room’s counts only, never a name. Nothing goes on a phone or the projector.</p>
            {(phase === 'refused' || phase === 'error') && (
              <p className="mv-say" data-tone={phase === 'error' ? 'bad' : undefined} role="alert">
                {phase === 'error' ? `The request did not reach the server: ${state.message}` : state.message}
              </p>
            )}
          </>
        )}

        {s && <Used used={use?.busy ? null : use} onOpenActivities={onOpenActivities} />}
        {usedBefore && <p className="mv-used"><Icon name="check" size={14} /><span>Recorded as an activity.</span></p>}
        {phase === 'offline' && onOpenActivities && (
          <p className="mv-foot"><button type="button" className="mv-link" onClick={onOpenActivities}>Open Activities</button></p>
        )}
      </div>

      {!waiting && (
        <div className="mv-acts">
          {s ? (
            <>
              {!usedHere && !usedBefore && (
                <Button size="sm" variant="primary" icon="check" busy={Boolean(use?.busy)} onClick={() => onUse?.(s)}>Use it</Button>
              )}
              <Button size="sm" variant="ghost" icon="refresh" disabled={Boolean(use?.busy)} onClick={() => onAsk?.()}>Another idea</Button>
            </>
          ) : phase === 'failed' || phase === 'error' ? (
            <Button size="sm" icon="refresh" onClick={() => onAsk?.()}>Try again</Button>
          ) : phase === 'offline' ? null : (
            <Button size="sm" icon="spark" onClick={() => onAsk?.()}>Suggest a move</Button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The live card for one room. Hidden for an HOD (the press is the write rule's)
 * and on a closed room, and when the server has no teaching moves (404).
 */
export function MoveCard({ code, canControl, closed, pushed, onOpenActivities }) {
  const [known, setKnown] = useState(undefined); // undefined reading, false no route, true ready
  const { state, ask, restore } = useMoveAsk(code, pushed);
  const [use, setUse] = useState(null);

  useEffect(() => {
    if (!canControl || closed) return undefined;
    let alive = true;
    api.teachingMoves(code).then(
      (r) => {
        if (!alive) return;
        setKnown(true);
        // The room's latest move, after a reload: shown with when it was made.
        const moves = (r?.suggestions ?? []).filter((m) => m.purpose === 'move');
        restore(moves.at(-1) ?? null);
      },
      (err) => { if (alive) setKnown(err.status === 404 ? false : true); },
    );
    return () => { alive = false; };
  }, [code, canControl, closed, restore]);

  // A new suggestion starts with "Use it" again.
  const shownId = state.phase === 'done' ? state.suggestion?.id : null;
  useEffect(() => { setUse(null); }, [shownId]);

  if (!canControl || closed || !known) return null;

  async function onUse(s) {
    setUse({ busy: true });
    const out = await recordSuggestion(code, s);
    setUse(out.error ? { error: out.error } : out.kept ? { kept: true } : { at: out.activity?.createdAt ?? new Date().toISOString(), label: out.activity?.label ?? s.kindLabel });
  }

  return <MoveCardView state={state} use={use} onAsk={() => ask({})} onUse={onUse} onOpenActivities={onOpenActivities} />;
}

/* ------------------------------------------------------------- C2: a prompt */

/**
 * "Ask AI for a prompt" for one activity kind, inside its row on Activities.
 * `topics` are the chapter's (null while unknown: then the server chooses);
 * `topic` '' lets the server choose from the room's answers.
 */
export function PromptPanel({ kind, state = IDLE, topics = null, topic = '', onTopic, onAsk, onUse, use = null, onClose }) {
  const id = useId();
  const { phase } = state;
  const s = phase === 'done' ? state.suggestion : null;
  const waiting = phase === 'asking' || phase === 'running';
  const usedHere = Boolean(use && !use.busy && !use.error);
  const list = Array.isArray(topics) ? topics.filter(Boolean) : [];

  const topicPick = list.length > 0 && !waiting && (
    <label className="mv-topic" htmlFor={`${id}-t`}>
      <span className="label">Topic <span className="opt">optional</span></span>
      <select id={`${id}-t`} className="select input-sm" value={topic} onChange={(e) => onTopic?.(e.target.value)}>
        <option value="">Let the room’s answers choose</option>
        {list.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </label>
  );

  return (
    <div className="mv-prompt" role="group" aria-labelledby={`${id}-k`} aria-busy={waiting || undefined}>
      <div className="mv-prompt-h">
        <p className="mv-k" id={`${id}-k`}><Icon name="spark" size={13} /><span>AI prompt for {kind.label}</span></p>
        <Button size="sm" variant="ghost" icon="close" aria-label={`Close the AI prompt for ${kind.label}`} onClick={onClose} />
      </div>

      {waiting ? (
        <Waiting>Reading the chapter…</Waiting>
      ) : s ? (
        <Suggestion s={s} large />
      ) : phase === 'offline' ? (
        <p className="mv-say">{state.message}</p>
      ) : phase === 'failed' ? (
        <p className="mv-say" data-tone="bad" role="alert">{state.message}</p>
      ) : (
        <p className="mv-hint">A prompt for this activity, written from the chapter’s own slides. You read it out or put it on the board.</p>
      )}
      {(phase === 'refused' || phase === 'error') && (
        <p className="mv-say" data-tone={phase === 'error' ? 'bad' : undefined} role="alert">
          {phase === 'error' ? `The request did not reach the server: ${state.message}` : state.message}
        </p>
      )}
      {s && <Used used={use?.busy ? null : use} />}

      {!waiting && phase !== 'offline' && (
        <div className="mv-prompt-acts">
          {topicPick}
          <span className="mv-prompt-btns">
            {s && !usedHere && (
              <Button size="sm" variant="primary" icon="check" busy={Boolean(use?.busy)} onClick={() => onUse?.(s)}>Use it</Button>
            )}
            {s ? (
              <Button size="sm" variant="ghost" icon="refresh" disabled={Boolean(use?.busy)} onClick={() => onAsk?.()}>Another idea</Button>
            ) : (
              <Button size="sm" icon={phase === 'failed' || phase === 'error' ? 'refresh' : 'spark'} onClick={() => onAsk?.()}>
                {phase === 'failed' || phase === 'error' ? 'Try again' : 'Write a prompt'}
              </Button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
