/**
 * Every room, and only the controls the server will actually honour.
 *
 * Until this screen a room could be opened and closed and nothing else. There
 * was no list of them anywhere: a teacher whose browser reloaded mid-class had
 * exactly one way back into a room that was still running, which was to remember
 * its six characters. And the only way to interrupt a class was to end it.
 *
 * Two words carry the whole screen, so the copy says which is which everywhere
 * it can:
 *
 *   pause   every student stays connected and every profile stays intact, and
 *           answering resumes on the exact question each of them had reached
 *   close   final. The room cannot be reopened, by anyone, ever.
 *
 * Nothing here decides who may act. Each row arrives carrying its own
 * `canControl`, computed by the same ownership rule the routes enforce — so an
 * HOD, who reads the whole department's rooms and may write to none of them,
 * gets every number and no buttons. Restating that rule in the browser would
 * only give the two copies somewhere to disagree, and the browser is the one
 * that would be lying.
 *
 * Nothing is ever moved optimistically either. Every action refetches, and a
 * refused one refetches too: a row flipped to "paused" here and refused on the
 * wire is a lie that survives until the next reload.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api.js';
import { useAccount, signOut } from '../auth.js';
import Icon from '../ui/Icon.jsx';
import Shell, { Avatar, Empty, NavPill, PageHead, Stat, TailBars } from '../ui/Shell.jsx';

/** Server accuracies are 0..1, and null means nobody has answered anything yet. */
const asPct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const STAMP = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const DAY_NUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });

function at(iso, fmt = STAMP) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
}

/** "started 20 min ago" is the thing a teacher actually reads off a room list. */
function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/* The three status colours the design system has, against the three states a
   room can be in. Paused is the bare .flag, which is already the warn chip. */
const STATUS = {
  open: { label: 'Live', flag: 'flag ok' },
  paused: { label: 'Paused', flag: 'flag' },
  closed: { label: 'Closed', flag: 'flag neutral' },
};

/* An unrecognised status is not silently folded into "closed": that would put
   the calmest word in the product on a room nobody understands. */
const statusOf = (room) =>
  STATUS[room?.status] ?? { label: room?.status || 'unknown', flag: 'flag neutral' };

/** Each pill carries its own predicate, so its count and the rows it reveals
 *  cannot drift apart. */
const FILTERS = [
  { id: 'all', label: 'All rooms', match: () => true },
  { id: 'open', label: 'Live', match: (r) => r.status === 'open' },
  { id: 'paused', label: 'Paused', match: (r) => r.status === 'paused' },
  { id: 'closed', label: 'Closed', match: (r) => r.status === 'closed' },
];

/* Where the nav item back to a role's own dashboard points, and what it is
   called there. The shared teacher key has no dashboard and so gets no item. */
const HOME = {
  hod: { href: '/admin', label: 'Department' },
  professor: { href: '/home', label: 'Overview' },
};

/* A tail with no bars in it leaves the number floating over white space, which
   is the unfinished look the stat card exists to prevent. A flat row is the
   honest shape of "no rooms in this state", and it holds the card's height. */
const FLAT = Array.from({ length: 6 }, () => ({ label: '·', value: 0 }));
const tailOf = (bars) => <TailBars bars={bars.length ? bars : FLAT} />;

/**
 * The panel's own empty state.
 *
 * <Empty> is built for the light canvas — its ink and its tinted icon tile both
 * disappear against --d-1 — so the dark surface gets the same three parts in its
 * own clothes.
 */
function DarkEmpty({ icon, title, children, action }) {
  return (
    <div className="d-empty">
      <b>
        <Icon name={icon} size={17} style={{ display: 'inline-block', marginRight: 8, verticalAlign: '-3px' }} />
        {title}
      </b>
      <span>{children}</span>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

/** Shaped like what is coming — a head, four stats, a filter row, one panel. */
function Skeleton() {
  return (
    <>
      <div className="phead">
        <div className="txt">
          <div className="skel" style={{ height: 28, width: 180, borderRadius: 9 }} />
          <div className="skel" style={{ height: 12, width: 330, borderRadius: 6, marginTop: 11 }} />
        </div>
      </div>
      <div className="grid auto" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel" style={{ height: 190, borderRadius: 'var(--r-card)' }} />
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        {[92, 76, 88, 84].map((w, i) => (
          <div key={i} className="skel" style={{ height: 34, width: w, borderRadius: 'var(--r-pill)' }} />
        ))}
      </div>
      <div className="skel" style={{ height: 420, borderRadius: 'var(--r-panel)' }} />
    </>
  );
}

/* ------------------------------------------------------------------ screen */

export default function Rooms() {
  const navigate = useNavigate();
  const { account, loading: accountLoading } = useAccount();

  // null means "not read yet", which is what the skeleton is waiting on. An
  // empty array is a real answer and gets the empty state instead.
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [pickedCode, setPickedCode] = useState('');

  // The one action in flight, as { code, action }. Scoped to a room rather than
  // global so two rooms are never disabled by each other's work.
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  // '' | 'close' | 'delete' — the destructive step the selected room is at.
  const [confirm, setConfirm] = useState('');
  const [typed, setTyped] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setReading(true);
    try {
      const res = await api.listSessions();
      setRaw(Array.isArray(res?.rooms) ? res.rooms : []);
      setError('');
    } catch (err) {
      // A failed background poll must not blank a list that is on screen and
      // was correct fifteen seconds ago.
      if (!silent) setError(err.message || 'The rooms did not load.');
    } finally {
      if (!silent) setReading(false);
    }
  }, []);

  /* Waits for the account to settle. Firing before then sends no bearer token
     and the server answers as the shared teacher key — a real payload listing
     somebody else's rooms. */
  useEffect(() => {
    if (accountLoading) return;
    load();
  }, [accountLoading, account?.id, load]);

  /* `online` is a live number: it comes from the socket layer's presence map and
     it is wrong the moment a student's phone locks. A room manager showing a
     stale count of who is connected is worse than one showing none, so the list
     re-reads itself while anything is still running — and stops entirely once
     every room is closed, when there is nothing left to go stale. */
  useEffect(() => {
    const running = (raw ?? []).some((r) => r.status === 'open' || r.status === 'paused');
    if (!running) return undefined;
    const timer = setInterval(() => {
      // Not while the tab is in the background, and never on top of an action
      // that is still open — the answer to that one is the reload it will do.
      if (document.hidden || busy) return;
      load({ silent: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [raw, busy, load]);

  // Newest first, stated rather than assumed. ISO strings sort lexicographically
  // and a room with no start date sorts to the bottom, which is where it belongs.
  const rooms = useMemo(
    () => [...(raw ?? [])].sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? ''))),
    [raw],
  );

  const live = useMemo(() => rooms.filter((r) => r.status === 'open'), [rooms]);
  const paused = useMemo(() => rooms.filter((r) => r.status === 'paused'), [rooms]);
  const closed = useMemo(() => rooms.filter((r) => r.status === 'closed'), [rooms]);
  const running = useMemo(() => rooms.filter((r) => r.status !== 'closed'), [rooms]);

  const connected = running.reduce((n, r) => n + (r.online ?? 0), 0);
  const seatsOpen = running.reduce((n, r) => n + (r.joined ?? 0), 0);
  const liveOnline = live.reduce((n, r) => n + (r.online ?? 0), 0);

  const shown = useMemo(() => {
    const match = (FILTERS.find((f) => f.id === filter) ?? FILTERS[0]).match;
    const q = query.trim().toLowerCase();
    return rooms.filter(
      (r) => match(r) && (!q || `${r.code ?? ''} ${r.title ?? ''}`.toLowerCase().includes(q)),
    );
  }, [rooms, filter, query]);

  /* The selected room is picked from every room, not from the filtered list.
     Narrowing the list is a display choice and it must not silently swap the
     room whose Delete button is on screen. A live one is the default, because
     that is the one carrying something to do. */
  const sel = useMemo(
    () => rooms.find((r) => r.code === pickedCode)
      ?? live[0] ?? paused[0] ?? rooms[0] ?? null,
    [rooms, pickedCode, live, paused],
  );

  // Changing rooms abandons whatever destructive step the last one was at. A
  // typed confirmation is about one room and must never carry to another.
  useEffect(() => {
    setConfirm('');
    setTyped('');
    setActionError('');
  }, [sel?.code]);

  /**
   * Run one action against one room and then re-read the list — on success and
   * on failure both. The server is the only thing that knows what a room is now.
   */
  async function act(code, action, run) {
    setBusy({ code, action });
    setActionError('');
    setNotice('');
    try {
      await run();
    } catch (err) {
      setActionError(err.message || 'The server refused that.');
    } finally {
      await load({ silent: true });
      setBusy(null);
    }
  }

  const inFlight = (action) => busy?.code === sel?.code && busy?.action === action;
  const roomBusy = Boolean(busy && busy.code === sel?.code);

  function pause(room) {
    return act(room.code, 'pause', () => api.pauseSession(room.code));
  }

  function resume(room) {
    return act(room.code, 'resume', () => api.resumeSession(room.code));
  }

  function closeRoom(room) {
    return act(room.code, 'close', async () => {
      await api.closeSession(room.code);
      setConfirm('');
    });
  }

  function destroy(room) {
    return act(room.code, 'delete', async () => {
      // The typed value is sent, not the room's own code. Sending the code from
      // a variable would turn the server's safety catch into a formality.
      const res = await api.deleteSession(room.code, typed.trim().toUpperCase());
      setConfirm('');
      setTyped('');
      // The selection has to let go of a room that no longer exists, or the
      // accent card holds a corpse until something else is clicked.
      setPickedCode('');
      setNotice(
        `${room.code} is gone, and so are the ${plural(res?.deletedProfiles ?? 0, 'student result')} recorded in it.`,
      );
    });
  }

  /* One bar per room, labelled with the day it opened — the same rule the
     department dashboard uses, so a tail here reads like a tail there. Oldest on
     the left, because a row of bars is read as time. */
  const barsOf = (list, pick) =>
    [...list].reverse().slice(-8).map((r, i) => ({
      label: at(r.startedAt, DAY_NUM) || String(i + 1),
      value: pick(r) ?? 0,
      on: r.code === sel?.code,
    }));

  /* --- chrome ------------------------------------------------------------ */

  const back = HOME[account?.role];
  const navItems = [
    ...(back ? [{ id: 'home', label: back.label }] : []),
    { id: 'analytics', label: 'Analytics' },
    { id: 'rooms', label: 'Rooms' },
    { id: 'console', label: 'Teaching console' },
  ];

  const bar = {
    badge: account?.code ? <span className="barcount mono">{account.code}</span> : null,
    nav: (
      <NavPill
        items={navItems}
        value="rooms"
        onChange={(id) => {
          if (id === 'analytics') navigate('/analytics');
          if (id === 'console') navigate('/');
          if (id === 'home' && back) navigate(back.href);
        }}
      />
    ),
    right: (
      <>
        <button
          type="button"
          className="iconbtn"
          title="Read the rooms again"
          onClick={() => load()}
          disabled={reading}
        >
          {reading ? <span className="spin" /> : <Icon name="refresh" />}
        </button>
        {account ? (
          <>
            <Avatar name={account.fullName || account.email || 'Teacher'} href="/profile" />
            <button type="button" className="iconbtn" title="Sign out" onClick={() => signOut()}>
              <Icon name="logout" />
            </button>
          </>
        ) : (
          <a className="iconbtn" href="/profile" title="Profile and connections">
            <Icon name="user" />
          </a>
        )}
      </>
    ),
  };

  /* --- the states before the list -------------------------------------- */

  if (accountLoading || (raw === null && !error)) {
    return <Shell {...bar}><Skeleton /></Shell>;
  }

  // A student's token is refused by requireTeacher, so the honest answer is the
  // screen that is theirs rather than the server's refusal painted red.
  if (account?.role === 'student') {
    return (
      <Shell {...bar}>
        <Empty
          icon="shield"
          title="Rooms are the teacher's side of a session"
          action={<a className="btn pri" href="/me">Go to your results<Icon name="forward" size={13} /></a>}
        >
          You join a room with its code and your roll number, and what happened in it is on your own
          results screen. Pausing and closing belong to whoever opened it.
        </Empty>
      </Shell>
    );
  }

  if (error && rooms.length === 0) {
    return (
      <Shell {...bar}>
        <PageHead title="Rooms" sub="The room list did not load." />
        <Empty
          icon="alert"
          title="Could not read your rooms"
          action={(
            <button type="button" className="btn pri" onClick={() => load()} disabled={reading}>
              {reading ? <span className="spin" /> : <Icon name="refresh" size={13} />}
              Try again
            </button>
          )}
        >
          {error}
        </Empty>
      </Shell>
    );
  }

  if (rooms.length === 0) {
    return (
      <Shell {...bar}>
        <PageHead
          title="Rooms"
          sub="nothing has been opened yet"
          actions={<a href="/" className="btn pri">Open a new room</a>}
        />
        <Empty
          icon="broadcast"
          title="No rooms yet"
          action={<a href="/" className="btn pri"><Icon name="play" size={13} />Open a new room</a>}
        >
          A room takes a six-character code onto the projector and the class does the rest. Once one
          has been opened it stays on this page — paused, live or closed — so losing the tab is no
          longer the same as losing the room.
        </Empty>
      </Shell>
    );
  }

  const st = sel ? statusOf(sel) : null;
  const armed = Boolean(sel) && typed.trim().toUpperCase() === sel.code;

  return (
    <Shell {...bar}>
      <PageHead
        title="Rooms"
        sub={
          `${plural(live.length, 'room')} live · ${paused.length} paused · ${closed.length} closed`
          + ` · ${plural(connected, 'student')} connected right now`
        }
        actions={<a href="/" className="btn pri">Open a new room</a>}
      />

      {error && (
        <div className="note bad" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>The rooms below are the last ones that loaded: {error}</span>
        </div>
      )}

      {/* ---------------------------------------------------------- counters */}

      <div className="grid auto" style={{ marginBottom: 16 }}>
        <Stat
          label="Live right now"
          icon="broadcast"
          tone={live.length ? 'ok' : 'flat'}
          value={live.length}
          delta={live.length
            ? `${plural(liveOnline, 'student')} connected to ${live.length === 1 ? 'it' : 'them'}`
            : 'nothing is serving questions'}
          tail={tailOf(barsOf(live, (r) => r.online))}
        />
        <Stat
          label="Students connected"
          icon="users"
          value={connected}
          delta={`of ${seatsOpen} who have joined a room that is still open`}
          tail={tailOf(barsOf(running, (r) => r.online))}
        />
        <Stat
          label="Paused"
          icon="clock"
          tone="warn"
          value={paused.length}
          // The whole reason pause exists, said on the card rather than left to
          // be discovered by pressing the button and hoping.
          delta="everyone still connected, resuming where they stopped"
          tail={tailOf(barsOf(paused, (r) => r.joined))}
        />
        <Stat
          label="Closed"
          icon="lock"
          tone="flat"
          value={closed.length}
          delta="final — a closed room cannot be reopened"
          tail={tailOf(barsOf(closed, (r) => r.joined))}
        />
      </div>

      {/* ------------------------------------------------------ narrowing --- */}

      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="fpill"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <b>{rooms.filter(f.match).length}</b>
          </button>
        ))}
        <label className="search right" style={{ width: 252 }}>
          <Icon name="search" size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a room by code or title"
            aria-label="Find a room by code or title"
          />
        </label>
      </div>

      {/* ------------------------------------------------- the working surface */}

      <div className="panel">
        <div className="panel-head">
          <span className="t">Your rooms</span>
          <span className="panel-sub">
            {shown.length === rooms.length
              ? `${plural(rooms.length, 'room')} · newest first`
              : `${shown.length} of ${rooms.length} shown`}
          </span>
        </div>

        {notice && (
          <div className="note info" style={{ marginBottom: 14 }}>
            <Icon name="info" size={15} />
            <span>{notice}</span>
          </div>
        )}

        {actionError && (
          <div className="note dk" role="alert" style={{ marginBottom: 14 }}>
            <Icon name="alert" size={15} />
            <span>{actionError} Nothing was changed here — the list below is what the server says.</span>
          </div>
        )}

        {/* --- the selected room, in full ------------------------------- */}
        {sel && (
          <div className="accent" style={{ marginBottom: 14 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="k">Selected room</span>
              <span className={st.flag}>{st.label}</span>
              <span className="grow" />
              {!sel.canControl && <span className="k">you can read this one, not act on it</span>}
            </div>

            <div
              style={{
                marginTop: 12, fontFamily: 'var(--mono)', fontSize: 'clamp(30px, 6vw, 44px)',
                fontWeight: 700, lineHeight: 1, letterSpacing: '0.16em', userSelect: 'all',
              }}
            >
              {sel.code}
            </div>
            <div style={{ marginTop: 12, font: '700 17px/1.35 var(--sans)', letterSpacing: '-0.01em' }}>
              {sel.title || 'Untitled room'}
            </div>

            <div className="tiles" style={{ marginTop: 18 }}>
              <div className="accent-tile">
                <b>{sel.online ?? 0}<Icon name="broadcast" size={11} /></b>
                <span>Connected right now</span>
              </div>
              <div className="accent-tile">
                <b>{sel.joined ?? 0}<Icon name="users" size={11} /></b>
                <span>Students joined</span>
              </div>
              <div className="accent-tile">
                <b>{sel.answered ?? 0}<Icon name="layers" size={11} /></b>
                <span>Answers recorded</span>
              </div>
              <div className="accent-tile">
                <b>{asPct(sel.accuracy)}<Icon name="activity" size={11} /></b>
                <span>Mean of each student&apos;s own</span>
              </div>
              {sel.banded > 0 && (
                <div className="accent-tile">
                  <b>{sel.banded}<Icon name="alert" size={11} /></b>
                  <span>In the support band</span>
                </div>
              )}
              <div className="accent-tile">
                <b>{at(sel.startedAt) || '—'}</b>
                <span>Opened{sel.startedAt ? ` · ${ago(sel.startedAt)}` : ''}</span>
              </div>
              {sel.status === 'paused' && (
                <div className="accent-tile">
                  <b>{at(sel.pausedAt) || '—'}</b>
                  <span>Paused{sel.pausedAt ? ` · ${ago(sel.pausedAt)}` : ''}</span>
                </div>
              )}
              {sel.status === 'closed' && (
                <div className="accent-tile">
                  <b>{at(sel.closedAt) || '—'}</b>
                  <span>Closed for good</span>
                </div>
              )}
            </div>

            {/* .btn.on-d sets its own colour at the same specificity as
                .btn:disabled and later in the stylesheet, so a disabled button on
                this card looks exactly like a live one. The row says it instead;
                the buttons still refuse the click. */}
            <div
              className="row"
              style={{ gap: 8, marginTop: 18, opacity: roomBusy ? 0.72 : 1 }}
            >
              {sel.canControl && sel.status === 'open' && (
                <button
                  type="button"
                  className="btn on-d solid"
                  disabled={roomBusy}
                  onClick={() => pause(sel)}
                >
                  {inFlight('pause') ? <span className="spin" /> : <Icon name="clock" size={13} />}
                  Pause the room
                </button>
              )}

              {sel.canControl && sel.status === 'paused' && (
                <button
                  type="button"
                  className="btn on-d solid"
                  disabled={roomBusy}
                  onClick={() => resume(sel)}
                >
                  {inFlight('resume') ? <span className="spin" /> : <Icon name="play" size={13} />}
                  Resume where they stopped
                </button>
              )}

              {/* Reading a room is not writing to it, so these two stay for an
                  HOD. The console reopens a room from its code alone. */}
              <a className="btn on-d" href={`/?session=${sel.code}`}>
                <Icon name="grid" size={13} />
                {sel.status === 'closed' ? 'Open the final grid' : 'Watch the grid'}
              </a>

              {sel.status !== 'closed' && (
                <a className="btn on-d" href={`/?session=${sel.code}&view=session`}>
                  <Icon name="external" size={13} />
                  Put it on the projector
                </a>
              )}

              {sel.canControl && sel.status !== 'closed' && confirm !== 'close' && (
                <button
                  type="button"
                  className="btn on-d"
                  disabled={roomBusy}
                  onClick={() => { setConfirm('close'); setTyped(''); }}
                >
                  <Icon name="stop" size={13} />
                  Close the room
                </button>
              )}

              {sel.canControl && confirm !== 'delete' && (
                <button
                  type="button"
                  className="btn on-d"
                  disabled={roomBusy}
                  onClick={() => { setConfirm('delete'); setTyped(''); }}
                >
                  <Icon name="trash" size={13} />
                  Delete
                </button>
              )}
            </div>

            {/* --- step two of closing. It is one click from being final, so
                    the alternative is offered in the same breath. --------- */}
            {confirm === 'close' && (
              // Deliberately not an .accent-tile. `.accent-tile span` carries a
              // `font` shorthand at 9.5px and beats `.said span` on source order
              // at equal specificity, which would set the one sentence a teacher
              // has to read before ending a class in the smallest type on the
              // screen. The lime rule is the separation this block needs.
              <div style={{ marginTop: 16 }}>
                <div className="said">
                  <span style={{ color: 'var(--on-d)' }}>
                    Closing {sel.code} ends it for everyone in the room and it cannot be reopened —
                    not by you, not by anyone. If you only need to stop the class for a few minutes,
                    pause it instead: every student stays connected and answering resumes on the exact
                    question each of them had reached.
                  </span>
                </div>
                <div className="row" style={{ gap: 8, marginTop: 14 }}>
                  <button
                    type="button"
                    className="btn on-d solid"
                    disabled={roomBusy}
                    onClick={() => closeRoom(sel)}
                  >
                    {inFlight('close') ? <span className="spin" /> : <Icon name="stop" size={13} />}
                    Yes, close {sel.code} for good
                  </button>
                  {sel.status === 'open' && (
                    <button
                      type="button"
                      className="btn on-d"
                      disabled={roomBusy}
                      onClick={() => { setConfirm(''); pause(sel); }}
                    >
                      <Icon name="clock" size={13} />
                      Pause it instead
                    </button>
                  )}
                  <button type="button" className="btn on-d" onClick={() => setConfirm('')}>
                    Leave it running
                  </button>
                </div>
              </div>
            )}

            {/* --- what the room's state actually means -------------------- */}
            {!sel.canControl ? (
              <div className="said" style={{ marginTop: 16 }}>
                <span style={{ color: 'var(--on-d)' }}>
                  This room was opened by another account, so there is nothing here to press. You can
                  read every number on it and open its grid; pausing, closing and deleting it belong
                  to whoever runs the class. The server decides that, not this screen — a button here
                  would only be refused on the wire.
                </span>
              </div>
            ) : sel.status === 'paused' ? (
              <div className="said" style={{ marginTop: 16 }}>
                <span style={{ color: 'var(--on-d)' }}>
                  Everyone who joined is still connected and every answer is still here. Nothing has
                  been thrown away and nothing has been marked. Resume and each student picks up on
                  the question they were on.
                </span>
              </div>
            ) : sel.status === 'closed' ? (
              <div className="said" style={{ marginTop: 16 }}>
                <span style={{ color: 'var(--on-d)' }}>
                  Closed{at(sel.closedAt) ? ` on ${at(sel.closedAt)}` : ''} and it stays closed — the
                  way back in front of a class is a new room over the same chapter. Everything the
                  class recorded stays readable here until the room is deleted.
                </span>
              </div>
            ) : (
              <div className="said" style={{ marginTop: 16 }}>
                <span style={{ color: 'var(--on-d)' }}>
                  Pausing holds the class exactly where it is: every student stays connected, nothing
                  is lost, and resuming puts each of them back on their own next question. Closing is
                  the other thing, and it is final.
                </span>
              </div>
            )}
          </div>
        )}

        {/* --- deleting. Its own block, on its own surface, because it is not
                one of the controls above — it destroys the class's marks. -- */}
        {sel && sel.canControl && confirm === 'delete' && (
          <div
            className="dk"
            style={{
              background: 'var(--d-2)', borderRadius: 'var(--r-card)',
              padding: '16px 18px', marginBottom: 14,
            }}
          >
            <div className="row" style={{ gap: 10, marginBottom: 14 }}>
              <span className="eyebrow on-d grow">Delete {sel.code} · cannot be undone</span>
              <button
                type="button"
                className="d-tile"
                onClick={() => { setConfirm(''); setTyped(''); }}
                aria-label="Cancel the delete"
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="note dk">
              <Icon name="alert" size={15} />
              <span>
                This deletes the room <b>and every result recorded in it</b> —{' '}
                {plural(sel.joined ?? 0, 'student profile')}, {plural(sel.answered ?? 0, 'answer')} and
                the Bloom levels those answers earned. None of it is recoverable, and it disappears
                from every report the department has. Closing the room keeps all of it.
              </span>
            </div>

            <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
              <label htmlFor="delete-confirm">Type {sel.code} to confirm</label>
              <input
                id="delete-confirm"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck="false"
                value={typed}
                onChange={(e) => setTyped(e.target.value.toUpperCase())}
              />
              <div className="hint">
                The server asks for this too — it refuses the delete unless ?confirm matches the room
                code exactly, so a slip here cannot destroy a different room.
              </div>
            </div>

            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              {/* Plain .btn until the code matches, and only then .btn.danger.
                  .btn.danger keeps its red ink through :disabled — it is later in
                  the stylesheet at equal specificity — so a permanently red
                  Delete button would look armed while it was refusing clicks. */}
              <button
                type="button"
                className={armed ? 'btn danger' : 'btn'}
                disabled={!armed || roomBusy}
                onClick={() => destroy(sel)}
              >
                {inFlight('delete') ? <span className="spin" /> : <Icon name="trash" size={13} />}
                Delete {sel.code} and its results
              </button>
              <button
                type="button"
                className="btn on-d"
                onClick={() => { setConfirm(''); setTyped(''); }}
              >
                Keep the room
              </button>
            </div>
          </div>
        )}

        {/* --- every room, newest first -------------------------------- */}
        {shown.length === 0 ? (
          <DarkEmpty
            icon="search"
            title="No room matches"
            action={(
              <button
                type="button"
                className="btn on-d"
                onClick={() => { setFilter('all'); setQuery(''); }}
              >
                Clear the filter
              </button>
            )}
          >
            Nothing you can see answers to that. Clear the search, or put the filter back to All
            rooms — the rooms themselves have not changed.
          </DarkEmpty>
        ) : (
          <div
            style={{
              display: 'flex', flexDirection: 'column', gap: 2,
              // A term's worth of rooms scrolls inside the panel rather than
              // pushing the page down past everything that is live.
              ...(shown.length > 8 ? { maxHeight: 420, overflowY: 'auto' } : null),
            }}
          >
            {shown.map((r) => {
              const rs = statusOf(r);
              const when = r.status === 'paused'
                ? `paused ${ago(r.pausedAt) || 'at an unrecorded time'}`
                : r.status === 'closed'
                  ? `closed ${ago(r.closedAt) || 'at an unrecorded time'}`
                  : `started ${ago(r.startedAt) || 'at an unrecorded time'}`;
              return (
                <button
                  key={r.code}
                  type="button"
                  className="d-row"
                  aria-selected={r.code === sel?.code}
                  onClick={() => setPickedCode(r.code)}
                >
                  <span className="t">
                    {/* <code>, not a <span>. `.d-row .t span` is the metadata
                        line's rule and it matches any span under .t, so a span
                        wrapped round the code inherited display:block and 10.5px
                        grey — the code and the separator each broke onto their
                        own line above the title. Nothing in the stylesheet
                        targets <code>, so it takes the row title's own 12.5px
                        white from .d-row .t b and only the family from .mono. */}
                    <b>
                      <code className="mono" style={{ letterSpacing: '0.08em' }}>{r.code}</code>
                      {' · '}
                      {r.title || 'Untitled room'}
                    </b>
                    <span>
                      {r.joined ?? 0} joined · {r.online ?? 0} online
                      {' · '}{plural(r.answered ?? 0, 'answer')} · {asPct(r.accuracy)} · {when}
                    </span>
                  </span>
                  {r.banded > 0 && <span className="flag nowrap">{r.banded} in band</span>}
                  {!r.canControl && <span className="flag neutral nowrap">read only</span>}
                  <span className={`${rs.flag} nowrap`}>{rs.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
