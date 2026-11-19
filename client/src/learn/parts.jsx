/**
 * Small pieces every student screen shares: the dock that holds the one action,
 * the connection state, and the panel that says the session is waiting.
 */

import { createContext, useContext, useId } from 'react';
import { createPortal } from 'react-dom';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { Icon, Level } from '../ui/index.jsx';

/**
 * The bar fixed to the bottom of the screen. LearnApp owns the element; whoever
 * has the action right now - an answer kind with its Submit, a result with its
 * Next - renders into it from wherever it sits in the tree.
 *
 * A portal and not a `position: fixed` child, because the page's blocks arrive
 * on a transform, and a fixed element inside a transformed parent is fixed to
 * that parent: the bar would ride up with the question for 400ms.
 */
export const DockSlot = createContext(null);

export function Dock({ children }) {
  const slot = useContext(DockSlot);
  return slot ? createPortal(children, slot) : null;
}

/**
 * True while the answer on screen is held on this phone waiting for a
 * connection. The answer kinds read it to drop their Submit, which would
 * otherwise spin for as long as the wifi is gone.
 */
export const Held = createContext(false);

/* Where an answer or a vote is, in the outbox's words (Phase 7). Nothing here
   says right or wrong: that is the server's, and only once it has marked. */
const SAVE = {
  queued: ['clock', 'Saved on this phone'],
  sending: [null, 'Saved on this phone, sending'],
  sent: ['send', 'Sent'],
  // A vote the server kept and did not count: confirmed, with its sentence.
  uncounted: ['send', 'Sent, not counted'],
  marked: ['check', 'Marked'],
  refused: ['info', 'Kept on this phone, not sent'],
};

export function SaveState({ state, note = '', live = false }) {
  const s = SAVE[state];
  if (!s) return null;
  return (
    <p className="ln-save" data-state={state} role={live ? 'status' : undefined}>
      {s[0] ? <Icon name={s[0]} size={14} /> : <span className="spinner" aria-hidden="true" />}
      <span>
        {s[1]}
        {note && <span className="ln-save-n">{note}</span>}
      </span>
    </p>
  );
}

/** The outbox, for the student: what is on this phone and where each item is. */
export function Kept({ items, flying = '' }) {
  if (!items?.length) return null;
  return (
    <section className="ln-kept" aria-label="On this phone" aria-live="polite">
      <span className="eyebrow">On this phone</span>
      <ul>
        {items.map((i) => (
          <li key={i.answerId}>
            <span className="ln-kept-t">{i.label}</span>
            <SaveState state={i.status === 'queued' && flying === i.answerId ? 'sending' : i.counted === false ? 'uncounted' : i.status} note={i.note} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The connection line: calm, one sentence, never an error. */
export function Offline() {
  return (
    <p className="ln-off" role="status">
      <i aria-hidden="true" />
      Offline: your answers are kept on this phone and will be sent when you reconnect
    </p>
  );
}

// What the bar may say about the socket. Only `lost` is an error: `offline` is
// socket.io working on it, and telling a student it has stopped while it is
// still retrying teaches them to close a tab that was fine.
const CONNECTION_WORD = {
  connecting: 'Connecting',
  online: 'Online',
  offline: 'Reconnecting',
  lost: 'No connection',
};

/** `idle` is the join screen, where a live socket means "ready" and not "online". */
export function Conn({ status, idle = false }) {
  return (
    <span className="ln-conn" role="status">
      {status === 'online'
        ? <i className="ln-conn-dot" aria-hidden="true" />
        : status === 'lost'
          ? <Icon name="alert" size={14} />
          // Spinning because something is happening: socket.io is retrying.
          : <span className="spinner" aria-hidden="true" />}
      {status === 'online' && idle ? 'Ready' : CONNECTION_WORD[status] || 'Reconnecting'}
    </span>
  );
}

/**
 * The session is waiting on something. It covers the question and does not
 * replace it: the answer kinds keep a half-built answer in their own state, so
 * swapping the question out would hand back a blank one afterwards.
 */
export function Hold({ icon, title, action, children }) {
  return (
    <div className="ln-hold" role="status" aria-live="polite">
      <div className="ln-hold-in on-panel">
        <span className="ln-hold-ic">{icon ? <Icon name={icon} size={30} /> : <span className="spinner" aria-hidden="true" />}</span>
        <h2>{title}</h2>
        <p>{children}</p>
        {action}
      </div>
    </div>
  );
}

/**
 * How sure the student is, tapped before or while they answer (Phase 5). The
 * three choices are the server's, from `session:accepted`; with none sent,
 * nothing is drawn. Optional, and it never touches a mark or a level, so the
 * line under it says exactly that and nothing about being right.
 *
 * A second tap on the chosen one takes it back off: skipping is a real answer
 * here, not a gap.
 */
export function Sure({ choices, value, onChange, locked = false }) {
  const id = useId();
  if (!Array.isArray(choices) || choices.length === 0) return null;
  return (
    <div className="ln-sure" role="group" aria-labelledby={`${id}-q`} aria-describedby={`${id}-h`}>
      <span className="ln-sure-t">
        <span className="ln-sure-q" id={`${id}-q`}>How sure are you?</span>
        <span className="ln-sure-h" id={`${id}-h`}>Optional. It never changes your mark or your level.</span>
      </span>
      <span className="ln-sure-row">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={value === c.id}
            disabled={locked}
            onClick={() => onChange(value === c.id ? null : c.id)}
          >
            {c.label}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * Said beside the server's reason while the level rests on too few answers to
 * be firm (`next.provisional`): gently, and never as a verdict.
 */
export function EarlyDays({ next }) {
  return next?.provisional === true ? <p className="ln-early">Early days: your level settles after a few more answers.</p> : null;
}

/**
 * What comes next for this student, as the server put it: the levels their
 * next questions are at, how many answers that rests on, and the server's own
 * sentence about why. The sentence is never rewritten here.
 */
export function NextUp({ next, fallback = '' }) {
  const why = typeof next?.why === 'string' && next.why ? next.why : fallback;
  const levels = Array.isArray(next?.levels) ? next.levels.filter((l) => LEVELS.includes(l)) : [];
  const answers = Number.isInteger(next?.answers) && next.answers > 0 ? next.answers : null;
  if (!why && !levels.length) return null;
  return (
    <div className="ln-next">
      {levels.length > 0 && (
        <div className="ln-next-head">
          <span className="ln-next-k">Next questions</span>
          {levels.map((l) => <Level key={l} level={l} />)}
          {answers && <span className="ln-next-n">{answers === 1 ? '1 answer' : `${answers} answers`}</span>}
        </div>
      )}
      {why && <p className="said">{why}</p>}
      <EarlyDays next={next} />
    </div>
  );
}

const SHORT = { remember: 'Rem', understand: 'Und', apply: 'App', analyse: 'Ana', evaluate: 'Eva', create: 'Cre' };

/**
 * The climb: the six levels as rungs across the top of the phone, lit up to
 * where this student is working, with that rung ringed. Short names on a
 * phone, so all six fit; the full name is in the label read out.
 */
export function Climb({ level }) {
  const n = LEVELS.indexOf(level) + 1;
  if (n < 1) return null;
  return (
    <div className="ln-climb" role="img" aria-label={`Working at ${LABEL[level]}, level ${n} of 6`}>
      {/* The rung being worked on gets the room for its full name. */}
      <div className="ln-climb-in" style={{ gridTemplateColumns: LEVELS.map((_, i) => (i === n - 1 ? '1.9fr' : '1fr')).join(' ') }}>
        {LEVELS.map((l, i) => (
          <div key={l} className="ln-rung" data-level={l} data-on={i < n ? 'true' : undefined} data-here={i === n - 1 ? 'true' : undefined}>
            <i />
            <span>{i === n - 1 ? LABEL[l] : SHORT[l]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
