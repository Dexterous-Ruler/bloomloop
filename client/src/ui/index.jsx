/**
 * The component set. Screens import from here and from nowhere else in ui/.
 *
 * Behaviour that is hard to get right - focus traps, escape, roving focus in a
 * menu, tooltip timing - comes from Radix. What it looks like comes from
 * styles/ui.css. Nothing in this file knows what screen it is on.
 */

import { forwardRef } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RTip from '@radix-ui/react-tooltip';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { useCount } from '../lib/motion.js';
import Icon from './Icon.jsx';

export { Icon };

/* ----------------------------------------------------------- the ladder */

// Six rungs, rising: one per level. Heights climb from a third to the full box.
const RUNG_H = [0.36, 0.48, 0.6, 0.72, 0.86, 1];

/**
 * The ladder: six rungs, each in its level colour, lit up to `level` (a level
 * id or a count from 0 to 6). With no level it is fully lit: the logo's shape.
 * Exported as Loop as well, which is the name the screens grew up with.
 */
export function Ladder({ level, size = 16, className = '', title }) {
  const lit = level == null ? 6 : typeof level === 'number' ? level : LEVELS.indexOf(level) + 1;
  const gap = Math.max(1, size / 16);
  const w = (size - gap * 5) / 6;
  return (
    <svg className={`ladder ${className}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {LEVELS.map((l, i) => {
        const h = Math.max(2, size * RUNG_H[i]);
        return (
          <rect
            key={l}
            className={`rung${i < lit ? ' on' : ''}`}
            x={(i * (w + gap)).toFixed(2)}
            y={(size - h).toFixed(2)}
            width={w.toFixed(2)}
            height={h.toFixed(2)}
            rx={Math.min(w / 2, size / 12).toFixed(2)}
            style={{ '--rung': `var(--l${i + 1})` }}
          />
        );
      })}
    </svg>
  );
}
export const Loop = Ladder;

/** The logo: the ladder on a green tile. */
export function Mark({ size = 28 }) {
  return (
    <span className="mark-tile" style={{ width: size, height: size, borderRadius: Math.round(size * 0.29) }} aria-hidden="true">
      <Ladder size={Math.round(size * 0.54)} />
    </span>
  );
}

/** The lines that drift behind a forest panel. Decoration only. */
export function Flow() {
  return (
    <svg className="flow" viewBox="0 0 1200 320" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0,250 C200,180 300,290 500,220 S800,120 1000,200 S1150,260 1200,240" />
      <path d="M0,290 C250,240 350,310 600,260 S850,170 1050,240 S1150,290 1200,280" />
      <path d="M0,200 C180,140 320,230 520,170 S780,80 980,150 S1120,220 1200,190" />
    </svg>
  );
}

/**
 * The one dark panel a screen gets: forest glass with lines drifting behind
 * it. What sits inside is drawn for a dark ground.
 */
export function Panel({ as: Tag = 'section', className = '', children, ...rest }) {
  return (
    <Tag className={`panel on-panel ${className}`} {...rest}>
      <Flow />
      {children}
    </Tag>
  );
}

/**
 * A sparkline from real numbers: a line that draws itself in, and an area
 * under it. `values` is a plain array; fewer than two points draws nothing.
 */
export function Spark({ values = [], height = 26, area = false, className = '', label }) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  const pts = nums.map((v, i) => [(i / (nums.length - 1)) * 100, 30 - ((v - lo) / span) * 28]);
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  return (
    <svg className={`spark ${className}`} viewBox="0 0 100 32" preserveAspectRatio="none" style={{ height }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {area && <polygon points={`0,32 ${line} 100,32`} className="spark-area" />}
      <polyline points={line} className="spark-line" />
    </svg>
  );
}

/** A level, named: the ladder lit to it and its label. */
export function Level({ level, solid = false, size, as: Tag = 'span', children, className = '', ...rest }) {
  if (!level) return null;
  return (
    <Tag className={`lv${solid ? ' lv-solid' : ''}${size === 'lg' ? ' lv-lg' : ''} ${className}`} data-level={level} {...rest}>
      <Ladder level={level} size={size === 'lg' ? 16 : 13} />
      {children ?? LABEL[level] ?? level}
    </Tag>
  );
}

/* --------------------------------------------------------------- basics */

export const Button = forwardRef(function Button(
  { variant, size, block, icon, busy, children, className = '', type = 'button', ...rest }, ref,
) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', !children && 'btn-icon', className]
    .filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} {...rest} disabled={rest.disabled || busy}>
      {busy ? <span className="spinner" /> : icon && <Icon name={icon} />}
      {children}
    </button>
  );
});

export function Field({ label, optional, hint, htmlFor, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}{optional && <span className="opt"> optional</span>}
        </label>
      )}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Tick({ on }) {
  return <span className="tick" data-on={on ? 'true' : 'false'} aria-hidden="true">{on && <Icon name="check" size={12} />}</span>;
}

export const Chip = forwardRef(function Chip({ tone, icon, dot, children, className = '', ...rest }, ref) {
  return (
    <span ref={ref} className={`chip${tone ? ` chip-${tone}` : ''} ${className}`} {...rest}>
      {dot && <i className="dot" />}
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
});

export function Note({ tone, icon = 'info', children, className = '', ...rest }) {
  return (
    <div className={`note${tone ? ` note-${tone}` : ''} ${className}`} {...rest}>
      <Icon name={tone === 'bad' ? 'alert' : tone === 'ok' ? 'ok' : icon} />
      <div className="grow">{children}</div>
    </div>
  );
}

export function Empty({ icon = 'info', title, children, action }) {
  return (
    <div className="empty">
      <span className="ic"><Icon name={icon} size={18} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

// Warm tints for initials, picked by name so a student keeps theirs. None of
// them is a level colour, so a face is never read as a level.
const AV = ['#D5E8DC', '#E9E3D3', '#DCE6EC', '#EFE2C4', '#E4E1DA', '#CFE3D8', '#F0E6D8'];
const tintFor = (name) => {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV[h % AV.length];
};

export function Avatar({ name = '', size, href, title }) {
  const initials = String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const cls = `avatar${size === 'lg' ? ' avatar-lg' : size === 'xl' ? ' avatar-xl' : ''}`;
  const style = { '--av': tintFor(name), '--av-ink': '#14161A' };
  return href
    ? <a className={cls} href={href} title={title ?? name} style={style}>{initials}</a>
    : <span className={cls} title={title ?? name} style={style}>{initials}</span>;
}

/** An on/off switch with its own label for screen readers. */
export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/** A number stepped with - and +. */
export function Stepper({ value, onChange, min = 0, max = 99, label, step = 1 }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Fewer" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Icon name="minus" /></button>
      <b aria-live="polite">{value}</b>
      <button type="button" aria-label="More" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Icon name="plus" /></button>
    </span>
  );
}

/**
 * The way through a task. `steps` is [{ id, label, sub, done, locked, why }].
 * A locked step still answers a press, with `why`, through onLocked.
 */
export function Steps({ steps, current, onStep, onLocked, label = 'Steps' }) {
  return (
    <nav className="steps" aria-label={label}>
      {steps.map((st, i) => (
        <span key={st.id} style={{ display: 'contents' }}>
          {i > 0 && <span className="step-rule" data-done={steps[i - 1].done ? 'true' : undefined} aria-hidden="true" />}
          <button
            type="button"
            className="step"
            aria-current={current === st.id ? 'step' : undefined}
            aria-disabled={st.locked || undefined}
            data-done={st.done && current !== st.id ? 'true' : undefined}
            onClick={() => (st.locked ? onLocked?.(st) : onStep(st.id))}
          >
            <i>{st.done && current !== st.id ? <Icon name="check" size={14} /> : i + 1}</i>
            {st.label}
            {st.sub != null && st.sub !== '' && <small>{st.sub}</small>}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** A section heading: what it is, and one line on what it is for. */
export function Section({ title, sub, as: Tag = 'h2', children, className = '' }) {
  return (
    <div className={`sec ${className}`}>
      <Tag>{title}</Tag>
      {sub && <p>{sub}</p>}
      {children}
    </div>
  );
}

/** A segmented control. `options` is [{ id, label, count }]. */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} disabled={o.disabled}>
          {o.label}
          {o.count != null && <span className="ct">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * A figure that counts to its new value. Plain numbers and percentages tween;
 * anything composed by hand ("11 of 12", "1:21") is printed as given.
 */
export function Num({ value }) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : null;
  const m = text ? /^(-?\d+(?:\.\d+)?)(%?)$/.exec(text) : null;
  const shown = useCount(m ? Number(m[1]) : NaN);
  if (!m) return value ?? null;
  const decimals = (m[1].split('.')[1] ?? '').length;
  return `${Number(shown).toFixed(decimals)}${m[2]}`;
}

export function Fig({ value, label, size, className = '' }) {
  return (
    <div className={`fig${size === 'lg' ? ' fig-lg' : ''} ${className}`}>
      <b><Num value={value} /></b>
      <span>{label}</span>
    </div>
  );
}

export function Meter({ value, max = 1, level }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className="meter" data-level={level}><i style={{ width: `${pct}%` }} /></div>;
}

/* -------------------------------------------------------------- overlays */

export function Tip({ label, children, side = 'top' }) {
  if (!label) return children;
  return (
    <RTip.Root>
      <RTip.Trigger asChild>{children}</RTip.Trigger>
      <RTip.Portal>
        <RTip.Content className="tip" side={side} sideOffset={6}>{label}</RTip.Content>
      </RTip.Portal>
    </RTip.Root>
  );
}
export const TipProvider = ({ children }) => <RTip.Provider delayDuration={300} skipDelayDuration={200}>{children}</RTip.Provider>;

/**
 * A dialog, or with `sheet` a panel docked to the right edge. `locked` stops
 * escape and outside-click from closing it while something is in flight.
 */
export function Dialog({ open, onOpenChange, title, description, wide, sheet, locked, footer, children }) {
  return (
    <RDialog.Root open={open} onOpenChange={(v) => { if (!locked) onOpenChange(v); }}>
      <RDialog.Portal>
        <RDialog.Overlay className="scrim" />
        <RDialog.Content className={sheet ? 'sheet' : `dlg${wide ? ' dlg-wide' : ''}`} aria-describedby={description ? undefined : undefined}>
          <div className="dlg-head">
            <div>
              <RDialog.Title className="dlg-title">{title}</RDialog.Title>
              {description
                ? <RDialog.Description className="dlg-desc">{description}</RDialog.Description>
                : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="sm" icon="close" aria-label="Close" disabled={locked} />
            </RDialog.Close>
          </div>
          {children != null && children !== false ? <div className="dlg-body grow">{children}</div> : <div style={{ height: 20 }} />}
          {footer && <div className="dlg-foot">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** A dropdown. `items` is [{ id, label, icon, danger, onSelect, disabled } | 'sep' | { heading }]. */
export function Menu({ trigger, items, align = 'end' }) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content className="menu" align={align} sideOffset={6}>
          {items.filter(Boolean).map((it, i) => {
            if (it === 'sep') return <RMenu.Separator key={`s${i}`} className="menu-sep" />;
            if (it.heading) return <RMenu.Label key={`h${i}`} className="menu-label">{it.heading}</RMenu.Label>;
            return (
              <RMenu.Item key={it.id ?? it.label} className={`menu-item${it.danger ? ' is-danger' : ''}`} disabled={it.disabled} onSelect={it.onSelect}>
                {it.icon && <Icon name={it.icon} />}
                {it.label}
              </RMenu.Item>
            );
          })}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}
