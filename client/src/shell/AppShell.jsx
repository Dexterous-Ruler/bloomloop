/**
 * The frame every signed-in screen sits in.
 *
 * An espresso rail down the left: the product, the way through it in named
 * groups, and at the foot the theme and who you are. The page beside it opens
 * with where you are (a crumb), what this is (the title) and what you can do
 * here (the actions). Below 1024px the rail folds into a bar and a drawer.
 *
 * It knows nothing about levels, rooms or roles. It is handed nav items and
 * slots, which is what lets a head of department, a professor and a student
 * use three different products in one frame.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as RDialog from '@radix-ui/react-dialog';

import { useEnter } from '../lib/motion.js';
import { useTheme } from '../lib/theme.js';
import { Avatar, Button, Icon, Mark, Menu } from '../ui/index.jsx';

export function Brand({ to = '/', tagline = 'Questions at the level reached' }) {
  return (
    <Link className="brand" to={to} aria-label="BloomLoop">
      <Mark size={38} />
      <span className="brand-name">
        <b>BloomLoop</b>
        {tagline && <small>{tagline}</small>}
      </span>
    </Link>
  );
}

// Re-exported so screens that import it from here keep working.
export { default as ThemeToggle } from './ThemeToggle.jsx';

/** The theme switch at the foot of the rail, showing both choices. */
function RailTheme() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className="rail-theme" onClick={toggle} aria-label={`Theme: ${theme}. Switch to ${theme === 'dark' ? 'light' : 'dark'}`}>
      <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
      {theme === 'dark' ? 'Dark' : 'Light'}
      <span className="seg-mini" aria-hidden="true">
        <i data-on={theme !== 'dark'}><Icon name="sun" size={13} /></i>
        <i data-on={theme === 'dark'}><Icon name="moon" size={13} /></i>
      </span>
    </button>
  );
}

const GROUP_LABEL = {
  prepare: 'Prepare',
  teach: 'Teach',
  overview: 'Overview',
  account: 'Account',
  learn: 'Learn',
};

/**
 * The rail's navigation. `items` is [{ id, label, icon, locked, why, group, badge, tone }].
 * A locked item stays pressable and answers with why it is locked: a dead
 * control whose only explanation is a hover title never explains itself on a
 * touch screen.
 */
function RailNav({ items, current, onNav, groups }) {
  const [why, setWhy] = useState(null);
  useEffect(() => {
    if (!why) return undefined;
    const t = setTimeout(() => setWhy(null), 4500);
    return () => clearTimeout(t);
  }, [why]);

  let lastGroup = null;
  return (
    <nav className="rail-nav" aria-label="Main">
      {items.map((it) => {
        const head = it.group !== lastGroup ? (groups?.[it.group] ?? GROUP_LABEL[it.group]) : null;
        lastGroup = it.group;
        return (
          <span key={it.id} style={{ display: 'contents' }}>
            {head && <span className="rail-head">{head}</span>}
            <button
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
              <Icon name={it.locked ? 'lock' : it.icon} size={17} />
              <span className="lab">{it.label}</span>
              {it.badge != null && it.badge !== '' && current !== it.id && (
                <span className="rail-badge" data-tone={it.tone}>{it.badge}</span>
              )}
            </button>
          </span>
        );
      })}
      {why && <div className="rail-why" role="status">{why}</div>}
    </nav>
  );
}

function Rail({ nav, current, onNav, groups, who, menu, tagline }) {
  return (
    <aside className="rail">
      <Brand tagline={tagline} />
      {nav?.length > 0 && <RailNav items={nav} current={current} onNav={onNav} groups={groups} />}
      <div className="rail-foot">
        <RailTheme />
        <Menu
          align="start"
          trigger={
            <button type="button" className="rail-me" aria-label="Account">
              {who ? <Avatar name={who.name} /> : <span className="avatar"><Icon name="user" size={15} /></span>}
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
 * @param crumb    a short line above the title: where this sits
 * @param title    what this page is; omit to let the page draw its own head
 * @param actions  buttons for the page head
 * @param status   chips for the state of the system (offline, not saved)
 * @param who      { name, sub } for the account menu, or null on the key path
 * @param menu     account-menu items
 * @param nav      rail items; omit for a screen with nowhere else to go
 * @param groups   labels for nav groups, beyond the defaults
 * @param width    'narrow' | 'wide' | undefined
 */
export default function AppShell({
  crumb, title, actions, status, who, menu = [], nav, groups, current, onNav, width, enterKey, tagline, children,
}) {
  const page = useRef(null);
  const [drawer, setDrawer] = useState(false);
  useEnter(page, enterKey ?? current);

  const navTo = (id) => { setDrawer(false); onNav?.(id); };
  const here = nav?.find((n) => n.id === current)?.label;

  return (
    <div className="app">
      <Rail nav={nav} current={current} onNav={navTo} groups={groups} who={who} menu={menu} tagline={tagline} />

      <div className="main">
        <header className="bar">
          <Brand tagline={null} />
          <span className="bar-where">{here ?? ''}</span>
          <RDialog.Root open={drawer} onOpenChange={setDrawer}>
            <RDialog.Trigger asChild>
              <Button variant="ghost" icon="menu" aria-label="Open the menu" />
            </RDialog.Trigger>
            <RDialog.Portal>
              <RDialog.Overlay className="scrim" />
              <RDialog.Content className="drawer" aria-describedby={undefined}>
                <RDialog.Title className="sr-only">Menu</RDialog.Title>
                <Rail nav={nav} current={current} onNav={navTo} groups={groups} who={who} menu={menu} tagline={tagline} />
              </RDialog.Content>
            </RDialog.Portal>
          </RDialog.Root>
        </header>

        <main className={`page${width ? ` page-${width}` : ''}`} ref={page}>
          {(title || crumb || actions) && (
            <div className="page-head">
              <div className="ttl">
                {crumb && <div className="crumb">{crumb}</div>}
                {title && <h1>{title}</h1>}
              </div>
              {(actions || status) && <div className="acts">{status}{actions}</div>}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
