/**
 * The chrome every signed-in screen sits inside.
 *
 * Shape, top to bottom: a white page margin, a soft grey rounded canvas, a white
 * bar riding on the canvas with the nav on a black pill track. Screens render
 * into <Shell>'s children and never draw their own header.
 *
 * Nothing in here knows what a Bloom level is or where questions come from. It
 * takes nav items, a title, and slots. That is deliberate: the HOD, professor
 * and student dashboards are three different products wearing one chrome, and
 * the only way that holds together is if the chrome has no opinion about them.
 */

import { useEffect, useState } from 'react';

import Icon from './Icon.jsx';

/** The three-bar ramp mark. Light, mid, dark — the taxonomy, shrunk. */
export function Mark({ className = '' }) {
  return (
    <span className={`mark ${className}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

/** The gradient logo square. */
export function LogoTile({ size = 36 }) {
  return (
    <span className="logotile" style={{ width: size, height: size }}>
      <Mark className="on-d" />
    </span>
  );
}

/**
 * `href` turns it into a link. The avatar in the top bar is where everyone
 * expects to find their own account, so it points at /profile; the ones inside
 * a roster row are labels for somebody else and stay inert.
 */
export function Avatar({ name = '', size, className = '', href, title }) {
  const initials = String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
  const cls = `avatar ${size ?? ''} ${className}`;
  const label = title ?? (href ? `${name} — your profile` : name) ?? undefined;
  if (href) return <a className={cls} href={href} title={label || undefined}>{initials}</a>;
  return <span className={cls} title={label || undefined}>{initials}</span>;
}

/**
 * The nav track. `items` is [{ id, label, disabled }]; a disabled item still
 * renders, because hiding a step the teacher has not reached yet makes the
 * product look like it has fewer capabilities than it does.
 */
export function NavPill({ items, value, onChange }) {
  // A step that is not reachable yet stays clickable and says why. Disabling it
  // outright left a dead control whose only explanation was a title attribute -
  // which never appears on a touch screen, so on a phone the steps were simply
  // grey for no stated reason.
  const [blocked, setBlocked] = useState(null);

  useEffect(() => {
    if (!blocked) return undefined;
    const t = setTimeout(() => setBlocked(null), 4000);
    return () => clearTimeout(t);
  }, [blocked]);

  return (
    <div className="navwrap">
      <nav className="navpill">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            aria-current={value === it.id}
            aria-disabled={it.disabled || undefined}
            className={it.disabled ? 'locked' : undefined}
            onClick={() => (it.disabled ? setBlocked(it) : onChange(it.id))}
            title={it.disabled ? it.why : undefined}
          >
            {it.disabled && <Icon name="lock" size={11} />}
            {it.label}
          </button>
        ))}
      </nav>
      {blocked && (
        <span className="navwhy" role="status">
          {blocked.why ?? `${blocked.label} is not ready yet.`}
        </span>
      )}
    </div>
  );
}

/**
 * @param {object} p
 * @param {string} p.title        product name in the top-left
 * @param {string} [p.tagline]    the small grey line under it
 * @param {React.ReactNode} [p.badge]  the pill immediately right of the brand
 * @param {React.ReactNode} [p.nav]    usually <NavPill/>
 * @param {React.ReactNode} [p.right]  icon buttons, flags, avatar
 */
export function TopBar({ title = 'BloomLoop', tagline = 'Questions at the level each student reached.', badge, nav, right }) {
  // Three explicit columns. The nav lives in the middle one and therefore stays
  // put whatever length the brand, the chapter badge or the right-hand controls
  // happen to be — which they cannot be relied on to be, since one of them is a
  // filename somebody chose.
  return (
    <header className="bar">
      <div className="bar-left">
        <a className="bar-brand" href="/" onClick={(e) => e.preventDefault()}>
          <LogoTile />
          <span className="bar-txt">
            <b>{title}</b>
            <span>{tagline}</span>
          </span>
        </a>
        {badge}
      </div>
      {nav}
      <div className="bar-right">{right}</div>
    </header>
  );
}

/** Page title block. `actions` sits hard right and is usually one primary button. */
export function PageHead({ title, sub, onBack, actions, aside }) {
  return (
    <div className="phead">
      {onBack && (
        <button type="button" className="back" onClick={onBack} aria-label="Back">
          <Icon name="back" size={15} strokeWidth={2} />
        </button>
      )}
      <div className="txt">
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {aside}
      {actions}
    </div>
  );
}

/**
 * A number worth looking at. `tail` is the visual under the delta line — a bar
 * row, a sparkline, a set of mini buttons. A stat card with an empty tail is
 * what makes a dashboard look unfinished, so prefer giving it something.
 */
export function Stat({ label, icon, tone = '', value, unit, delta, deltaTone = '', tail, flushTail }) {
  return (
    <div className={`stat${flushTail ? ' flush-tail' : ''}`}>
      <div className="k">
        <span>{label}</span>
        {icon && <span className={`ico ${tone}`}><Icon name={icon} size={13} /></span>}
      </div>
      <div className="v">
        {value}
        {unit && <small> {unit}</small>}
      </div>
      {delta && (
        <div className={`d ${deltaTone}`}>
          {deltaTone === 'up' && <Icon name="trendUp" size={10} />}
          {deltaTone === 'down' && <Icon name="trendDown" size={10} />}
          {delta}
        </div>
      )}
      {tail && <div className="tail">{tail}</div>}
    </div>
  );
}

/** A row of bars for a Stat tail. `bars` is [{ label, value, on }]. */
export function TailBars({ bars }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="tailbars">
      {bars.map((b, i) => (
        <div key={`${b.label}-${i}`}>
          <i className={b.on ? 'on' : ''} style={{ height: Math.round(8 + (b.value / max) * 46) }} />
          <span>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Card({ children, className = '', ...rest }) {
  return <div className={`card ${className}`} {...rest}>{children}</div>;
}

export function Empty({ icon = 'info', title, children, action }) {
  return (
    <div className="empty">
      <span className="ic"><Icon name={icon} size={24} /></span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export default function Shell({ children, ...bar }) {
  return (
    <div className="shell">
      <div className="frame">
        <TopBar {...bar} />
        <div className="frame-body">{children}</div>
      </div>
    </div>
  );
}
