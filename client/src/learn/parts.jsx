/**
 * Small pieces every student screen shares: the dock that holds the one action,
 * the connection state, and the panel that says the session is waiting.
 */

import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { Icon } from '../ui/index.jsx';

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
