/**
 * The frame every signed-in screen sits in.
 *
 * A forest rail down the left: the product, the way through it in groups that
 * fold, and who you are at the foot. A glass bar across the top: the command
 * palette (Ctrl or Cmd + K, which goes anywhere the rail goes), the state of
 * the system, and the theme. The page under it opens with where you are, what
 * this is and what it is for, and what you can do here.
 *
 * It knows nothing about levels, rooms or roles. It is handed nav items and
 * slots, which is what lets a head of department, a professor and a student
 * use three different products in one frame.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as RDialog from '@radix-ui/react-dialog';

import { useEnter } from '../lib/motion.js';
import { useTheme } from '../lib/theme.js';
import { Avatar, Icon, Mark, Menu, Tip } from '../ui/index.jsx';
import { Toaster } from '../ui/toast.jsx';

// Re-exported so screens that import it from here keep working.
export { default as ThemeToggle } from './ThemeToggle.jsx';

export function Brand({ to = '/' }) {
  return (
    <Link className="brand" to={to} aria-label="BloomLoop home">
      <Mark size={28} />
      <span className="brand-name">BloomLoop</span>
    </Link>
  );
}

const GROUP_LABEL = {
  prepare: 'Prepare',
  teach: 'Teach',
  overview: 'Overview',
  account: 'Account',
  learn: 'Learn',
};

/** Items in their groups, in the order the groups first appear. */
function grouped(items, groups) {
  const out = [];
  for (const it of items) {
    const id = it.group ?? 'main';
    let g = out.find((x) => x.id === id);
    if (!g) {
      g = { id, label: groups?.[id] ?? GROUP_LABEL[id] ?? '', items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

/**
 * The rail's navigation. `items` is [{ id, label, icon, locked, why, group, badge, tone }].
 * A locked item stays pressable and answers with why it is locked: a dead
 * control whose only explanation is a hover title never explains itself on a
 * touch screen. Groups fold; the one holding the current page never does.
 */
function RailNav({ items, current, onNav, groups }) {
  const [why, setWhy] = useState(null);
  const [folded, setFolded] = useState({});
  useEffect(() => {
    if (!why) return undefined;
    const t = setTimeout(() => setWhy(null), 4500);
    return () => clearTimeout(t);
  }, [why]);

  return (
    <nav className="rail-scroll" aria-label="Main">
      {grouped(items, groups).map((g) => {
        const holdsCurrent = g.items.some((it) => it.id === current);
        const open = holdsCurrent || !folded[g.id];
        return (
          <div className="rail-group" key={g.id}>
            {g.label && (
              <button
                type="button"
                className="rail-head"
                aria-expanded={open}
                onClick={() => !holdsCurrent && setFolded((f) => ({ ...f, [g.id]: !f[g.id] }))}
              >
                <span>{g.label}</span>
                <Icon name="chevron" size={12} />
              </button>
            )}
            {open && (
              <div className="rail-items">
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className={`rail-item${it.locked ? ' is-locked' : ''}`}
                    aria-current={current === it.id ? 'page' : undefined}
                    aria-disabled={it.locked || undefined}
                    onClick={() => {
                      if (it.locked) { setWhy(it.why ?? `${it.label} is not ready yet.`); return; }
                      setWhy(null);
                      onNav(it.id);
                    }}
                  >
                    <Icon name={it.locked ? 'lock' : it.icon} size={15} />
                    <span className="lab">{it.label}</span>
                    {/* A badge points somewhere else; on its own page it has nothing to point at. */}
                    {it.badge != null && it.badge !== '' && current !== it.id && (
                      <span className="rail-badge" data-tone={it.tone}>{it.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {why && <div className="rail-why" role="status">{why}</div>}
    </nav>
  );
}

function Rail({ nav, current, onNav, groups, who, menu, onPalette }) {
  return (
    <aside className="rail">
      <div className="rail-top">
        <Brand />
        <button type="button" className="rail-k" onClick={onPalette} aria-label="Open the command palette">Ctrl K</button>
      </div>
      {nav?.length > 0 ? <RailNav items={nav} current={current} onNav={onNav} groups={groups} /> : <div className="rail-scroll" />}
      <div className="rail-foot">
        <Menu
          align="start"
          trigger={
            <button type="button" className="rail-me" aria-label="Account">
              {who ? <Avatar name={who.name} /> : <span className="avatar"><Icon name="key" size={14} /></span>}
              <span className="who">
                <b>{who?.name ?? 'Teacher console'}</b>
                <small>{who?.sub ?? 'Opened with the console key'}</small>
              </span>
              <Icon name="more" />
            </button>
          }
          items={[
            who && { heading: who.sub ? `${who.name} · ${who.sub}` : who.name },
            ...menu,
          ]}
        />
      </div>
    </aside>
  );
}

/**
 * Go anywhere the rail goes, by typing. Arrow keys move, Enter goes, Escape
 * closes. Locked places are listed with why, and pressing one says so.
 */
function Palette({ open, onOpenChange, nav, groups, onNav, extra = [] }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const [why, setWhy] = useState('');
  const list = useMemo(() => {
    const all = [
      ...(nav ?? []).map((n) => ({ ...n, groupLabel: groups?.[n.group] ?? GROUP_LABEL[n.group] ?? 'Go to' })),
      ...extra.map((c) => ({ ...c, groupLabel: c.groupLabel ?? 'Actions' })),
    ];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((n) => `${n.label} ${n.groupLabel}`.toLowerCase().includes(needle)) : all;
  }, [nav, groups, extra, q]);

  useEffect(() => { if (open) { setQ(''); setAt(0); setWhy(''); } }, [open]);
  useEffect(() => { setAt(0); }, [q]);

  const go = (item) => {
    if (!item) return;
    if (item.locked) { setWhy(item.why ?? `${item.label} is not ready yet.`); return; }
    onOpenChange(false);
    if (item.onSelect) item.onSelect(); else onNav?.(item.id);
  };

  let lastGroup = null;
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="scrim" />
        <RDialog.Content className="cmd" aria-describedby={undefined}>
          <RDialog.Title className="sr-only">Go to</RDialog.Title>
          <div className="cmd-in">
            <Icon name="search" />
            <input
              autoFocus
              value={q}
              placeholder="Go to a page or an action"
              aria-label="Go to a page or an action"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(a + 1, list.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
                if (e.key === 'Enter') { e.preventDefault(); go(list[at]); }
              }}
            />
            <span className="kbd">Esc</span>
          </div>
          <div className="cmd-list" role="listbox" aria-label="Places">
            {list.length === 0 && <div className="cmd-none">Nothing called that here.</div>}
            {list.map((it, i) => {
              const head = it.groupLabel !== lastGroup ? it.groupLabel : null;
              lastGroup = it.groupLabel;
              return (
                <div key={`${it.groupLabel}:${it.id}`}>
                  {head && <div className="cmd-group">{head}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === at}
                    className="cmd-item"
                    data-on={i === at}
                    onMouseEnter={() => setAt(i)}
                    onClick={() => go(it)}
                  >
                    <Icon name={it.locked ? 'lock' : it.icon ?? 'forward'} />
                    {it.label}
                    {it.locked && <small>Not ready</small>}
                  </button>
                </div>
              );
            })}
          </div>
          {why && <div className="cmd-none" role="status">{why}</div>}
          <div className="cmd-foot"><span>Arrow keys to move</span><span>Enter to go</span></div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function ThemeButton() {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Tip label={`Switch to ${next}`}>
      <button type="button" className="icon-btn" onClick={toggle} aria-label={`Switch to ${next} theme`}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
      </button>
    </Tip>
  );
}

/**
 * @param crumb    a short line above the title: where this sits
 * @param title    what this page is; omit to let the page draw its own head
 * @param sub      one line on what the page is for
 * @param actions  buttons for the page head
 * @param status   chips for the state of the system (offline, not saved), in the top bar
 * @param who      { name, sub } for the account menu, or null on the key path
 * @param menu     account-menu items
 * @param nav      rail items; omit for a screen with nowhere else to go
 * @param groups   labels for nav groups, beyond the defaults
 * @param commands extra command-palette actions: [{ id, label, icon, onSelect }]
 * @param width    'narrow' | 'wide' | undefined
 * @param banner   a strip above the page head, such as the console's "Working
 *                 offline" (teach/SyncStatus.jsx); it renders nothing when all is well
 */
export default function AppShell({
  crumb, title, sub, actions, status, who, menu = [], nav, groups, commands, current, onNav, width, enterKey, banner, children,
}) {
  const page = useRef(null);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  useEnter(page, enterKey ?? current);
  // A new page or step starts at its top, not wherever the last one was
  // scrolled to. The page scrolls inside the frame, so the frame resets it.
  useEffect(() => { page.current?.parentElement?.scrollTo?.({ top: 0 }); }, [enterKey, current]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navTo = (id) => { setDrawer(false); onNav?.(id); };

  return (
    <div className="app">
      <Rail nav={nav} current={current} onNav={navTo} groups={groups} who={who} menu={menu} onPalette={() => setPalette(true)} />

      <div className="main">
        <header className="top">
          <RDialog.Root open={drawer} onOpenChange={setDrawer}>
            <RDialog.Trigger asChild>
              <button type="button" className="icon-btn top-menu" aria-label="Open the menu"><Icon name="menu" size={16} /></button>
            </RDialog.Trigger>
            <RDialog.Portal>
              <RDialog.Overlay className="scrim" />
              <RDialog.Content className="drawer" aria-describedby={undefined}>
                <RDialog.Title className="sr-only">Menu</RDialog.Title>
                <Rail nav={nav} current={current} onNav={navTo} groups={groups} who={who} menu={menu} onPalette={() => { setDrawer(false); setPalette(true); }} />
              </RDialog.Content>
            </RDialog.Portal>
          </RDialog.Root>
          <Brand />
          <button type="button" className="top-search" onClick={() => setPalette(true)} aria-label="Go to a page or an action">
            <Icon name="search" size={14} />
            <span>Go to a page or an action</span>
            <span className="kbd">Ctrl K</span>
          </button>
          <div className="top-end">
            {status}
            <ThemeButton />
          </div>
        </header>

        <div className="scroll">
          <main className={`page${width ? ` page-${width}` : ''}`} ref={page}>
            {banner}
            {(title || crumb || actions) && (
              <div className="page-head">
                <div className="ttl">
                  {crumb && <div className="crumb">{crumb}</div>}
                  {title && <h1>{title}</h1>}
                  {sub && <p className="sub">{sub}</p>}
                </div>
                {actions && <div className="acts">{actions}</div>}
              </div>
            )}
            {children}
          </main>
        </div>
      </div>

      <Palette open={palette} onOpenChange={setPalette} nav={nav} groups={groups} onNav={navTo} extra={commands} />
      <Toaster />
    </div>
  );
}
