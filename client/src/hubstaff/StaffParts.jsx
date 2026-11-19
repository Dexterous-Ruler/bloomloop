/**
 * Pieces every staff hub screen shares: the frame, loading a reply, the states
 * a hub call can end in (503, 401, 403, 404, anything else), the read-only
 * line, tabs kept in ?tab=, and a confirm dialog.
 *
 * Replies and sentences are shown as the server sends them.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import AccountShell from '../shell/AccountShell.jsx';
import { Button, Dialog, Icon } from '../ui/index.jsx';
import RichText from '../hub/RichText.jsx';

/**
 * A student who opens a staff page is sent their own shape by the shared read
 * routes (no canEdit, no links); the page says what the staff routes say.
 */
export const STAFF_ONLY = Object.assign(new Error('This is for a professor or an HOD only.'), { status: 403 });

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A server-built name or title, drawn inline in the surrounding type. */
export function Name({ html, text, className = '' }) {
  return <RichText as="span" className={`hubs-name ${className}`} html={html} text={text} />;
}

/**
 * The frame: the account shell with the hub's crumb trail.
 * `trail` is [{ label, to }]; the last one is where you are.
 */
export function StaffPage({ trail = [], title, sub, actions, width, children }) {
  const crumb = trail.length ? (
    <nav aria-label="Breadcrumb" className="hubs-trail">
      {trail.map((t, i) => (
        <span key={`${i}:${t.to ?? ''}`} className="hubs-trail-step">
          {i > 0 && <Icon name="chevronRight" size={12} />}
          {t.to && i < trail.length - 1 ? <Link to={t.to}>{t.label}</Link> : <span aria-current={i === trail.length - 1 ? 'page' : undefined}>{t.label}</span>}
        </span>
      ))}
    </nav>
  ) : null;
  return (
    <AccountShell current="hub" crumb={crumb} title={title} sub={sub} actions={actions} width={width}>
      <div className="hub hubs">{children}</div>
    </AccountShell>
  );
}

/**
 * Calls `load` (a function returning a promise) when `deps` change.
 * A reply that arrives after a newer call started is dropped.
 */
export function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const turn = useRef(0);
  const run = useCallback(() => {
    turn.current += 1;
    const mine = turn.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(load)
      .then((data) => { if (turn.current === mine) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (turn.current === mine) setState({ data: null, error, loading: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
    return () => { turn.current += 1; };
  }, [run]);
  const set = useCallback((data) => setState({ data, error: null, loading: false }), []);
  return { ...state, reload: run, set };
}

/**
 * A call that ended without a reply to draw: the server's sentence, and the
 * one way on that fits it. 503 is a calm full-page state, not a fault.
 */
export function Problem({ error, onRetry, back = { to: '/hubs', label: 'All classes' } }) {
  const status = error?.status;
  const said = error?.message || 'That did not load.';
  if (status === 503) {
    return (
      <section className="hubs-calm" aria-live="polite">
        <span className="hubs-calm-ic"><Icon name="school" size={20} /></span>
        <h2>The Learning Hub is not open on this server</h2>
        <p>{said}</p>
      </section>
    );
  }
  let action = null;
  if (status === 401) action = <Link className="btn btn-primary" to="/signin"><Icon name="login" />Sign in</Link>;
  // A staff page's read is refused only to a student; a student's hub is /hub.
  else if (status === 403) action = <Link className="btn" to="/hub"><Icon name="forward" />Go to your hub</Link>;
  else if (status === 404) action = <Link className="btn" to={back.to}><Icon name="back" />{back.label}</Link>;
  else if (onRetry) action = <Button icon="refresh" onClick={onRetry}>Try again</Button>;
  return (
    <section className="hubs-problem" role="alert">
      <span className="hubs-calm-ic" data-tone={status === 401 || status === 403 ? 'lock' : 'bad'}>
        <Icon name={status === 401 || status === 403 ? 'lock' : status === 404 ? 'search' : 'alert'} size={18} />
      </span>
      <p>{said}</p>
      {action}
    </section>
  );
}

/** A sentence under the control that was refused, as the server said it. */
export function Refusal({ error, onDismiss }) {
  if (!error) return null;
  return (
    <p className="hubs-refusal" role="alert">
      <Icon name="alert" size={14} />
      <span className="grow">{error.message || String(error)}</span>
      {onDismiss && <button type="button" className="hubs-x" onClick={onDismiss} aria-label="Dismiss"><Icon name="close" size={13} /></button>}
    </p>
  );
}

/** The one quiet line an HOD sees in place of every control. */
export function ReadOnly({ children = 'Read-only. Only the professor who owns this can change it.' }) {
  return <p className="hubs-ro"><Icon name="eye" size={14} />{children}</p>;
}

/** The tab named in ?tab=, if it is one of `ids`, else the first. */
export function useTab(ids) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab = ids.includes(asked) ? asked : ids[0];
  const setTab = useCallback((id) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id === ids[0]) next.delete('tab'); else next.set('tab', id);
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams, ids.join('|')]);
  return [tab, setTab];
}

/**
 * Tabs with roving focus: Left and Right (and Home, End) move between them
 * and open the one reached. `tabs` is [{ id, label }].
 */
export function Tabs({ tabs, value, onChange, label, children }) {
  const base = useId();
  const btns = useRef({});
  const ids = tabs.map((t) => t.id);
  const onKey = (e) => {
    const i = ids.indexOf(value);
    let next = null;
    if (e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next);
    btns.current[next]?.focus();
  };
  return (
    <div className="hubs-tabbed">
      <div className="hubs-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => { btns.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`${base}-t-${t.id}`}
            aria-selected={value === t.id}
            aria-controls={`${base}-p-${t.id}`}
            tabIndex={value === t.id ? 0 : -1}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="hubs-tabpanel" role="tabpanel" id={`${base}-p-${value}`} aria-labelledby={`${base}-t-${value}`} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

/** Asks before something that cannot be undone from here. */
export function Confirm({ open, title, children, yes, danger, busy, error, onYes, onNo }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) onNo(); }}
      title={title}
      locked={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onNo} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onYes}>{yes}</Button>
        </>
      )}
    >
      <div className="stack">
        {children}
        <Refusal error={error} />
      </div>
    </Dialog>
  );
}

/** Grey bars in the page's own shape while it loads. */
export function Skeleton({ rows = 4, panel = true, label = 'Loading' }) {
  return (
    <div className="hubs-skel" role="status" aria-label={label}>
      {panel && <div className="skel hubs-skel-panel" />}
      <div className="card hubs-skel-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="hubs-skel-row">
            <div className="skel" style={{ width: 18, height: 18 }} />
            <div className="skel" style={{ width: `${55 - (i % 3) * 12}%`, height: 14 }} />
            <div className="skel" style={{ width: 70, height: 14, marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
