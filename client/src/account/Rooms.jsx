/**
 * Every room this viewer may see, and only the controls the server will honour.
 *
 * Two words carry the screen, so the copy says which is which wherever it can:
 *
 *   pause   every student stays connected and every profile stays intact, and
 *           answering resumes on the question each of them had reached
 *   close   final. The room cannot be reopened, by anyone.
 *
 * Nothing here decides who may act. Each row arrives carrying its own
 * `canControl`, computed by the same ownership rule the routes enforce, so an
 * HOD - who reads the department's rooms and may write to none - gets every
 * number and no controls. On the shared teacher key there is no account at all
 * and the list is the rooms nobody owns.
 *
 * Nothing is moved optimistically either. Every action re-reads the list, and
 * a refused one re-reads it too: a row flipped to "paused" here and refused on
 * the wire is a lie that survives until the next reload.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../lib/api.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import { Button, Chip, Dialog, Empty, Field, Icon, Menu, Note, Segmented, Tip } from '../ui/index.jsx';
import { plural, roomLink, RoomState, roomWhen, share, stampOf } from './dashParts.jsx';

/* Each filter carries its own test, so its count and the rows it shows cannot
   drift apart. */
const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'open', label: 'Live', match: (r) => r.status === 'open' },
  { id: 'paused', label: 'Paused', match: (r) => r.status === 'paused' },
  { id: 'closed', label: 'Closed', match: (r) => r.status === 'closed' },
];

function Skeleton() {
  return (
    <div className="stack stack-5" aria-busy="true">
      <div className="stack stack-2">
        <div className="skel" style={{ height: 32, width: 140 }} />
        <div className="skel" style={{ height: 16, width: 480, maxWidth: '100%' }} />
      </div>
      <div className="cluster between">
        <div className="skel" style={{ height: 36, width: 300, maxWidth: '100%' }} />
        <div className="skel" style={{ height: 36, width: 280, maxWidth: '100%' }} />
      </div>
      <div className="card dash-skelrows">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 20 }} />)}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- one room */

function RoomRow({ room: r, busy, onPause, onResume, onAskClose, onAskDelete }) {
  const navigate = useNavigate();
  const working = busy?.code === r.code;
  const running = r.status === 'open' || r.status === 'paused';

  const items = [
    {
      id: 'class',
      label: r.status === 'closed' ? 'Open the final standing' : 'Open the class',
      icon: 'live',
      onSelect: () => navigate(roomLink(r.code, 'live')),
    },
  ];
  if (r.status === 'closed') {
    // Said where someone would look for a way to reopen it.
    items.push({ heading: 'Closed for good. A new room runs it again.' });
  } else {
    items.push({ id: 'projector', label: 'Put the code on the projector', icon: 'projector', onSelect: () => navigate(roomLink(r.code, 'session')) });
  }
  if (r.canControl) {
    if (r.status !== 'closed') {
      items.push('sep');
      if (r.status === 'open') items.push({ id: 'pause', label: 'Pause the room', icon: 'pause', onSelect: () => onPause(r) });
      if (r.status === 'paused') items.push({ id: 'resume', label: 'Resume where they stopped', icon: 'play', onSelect: () => onResume(r) });
      items.push({ id: 'close', label: 'Close the room', icon: 'stop', onSelect: () => onAskClose(r) });
    }
    items.push('sep', { id: 'delete', label: 'Delete the room', icon: 'trash', danger: true, onSelect: () => onAskDelete(r) });
  } else {
    // Reading a room is not writing to it, so the two links above stay.
    items.push('sep', { heading: 'Read only: another account runs it' });
  }

  const notes = [
    !r.canControl && 'Read only',
    r.banded > 0 && `${r.banded} in the support band`,
  ].filter(Boolean);

  return (
    <tr aria-busy={working || undefined}>
      <td className="c-code"><span className="mono strong">{r.code}</span></td>
      <td className="c-title">
        <span className="clip dash-block">{r.title || 'Untitled room'}</span>
        {notes.length > 0 && <span className="dash-sub">{notes.join(' · ')}</span>}
      </td>
      <td className="c-state">
        <RoomState status={r.status} />
        {/* A live number, so it sits with the state it is true of. */}
        {running && <span className="dash-sub">{r.online ?? 0} online</span>}
      </td>
      <td className="r c-fact" data-label="Joined">{r.joined ?? 0}</td>
      <td className="r c-fact" data-label="Answered">{Number(r.answered ?? 0).toLocaleString()}</td>
      <td className="r c-fact" data-label="Accuracy">
        {share(r.accuracy)}
        {r.withdrawn > 0 && (
          <span className="dash-sub" title="Early misses set aside by redemption. They are not in this average.">
            {r.withdrawn} set aside
          </span>
        )}
      </td>
      <td className="c-when" title={stampOf(r.status === 'closed' ? r.closedAt : r.status === 'paused' ? r.pausedAt : r.startedAt) || undefined}>
        {roomWhen(r)}
      </td>
      <td className="c-go">
        {r.status === 'open' && (
          <Link className="btn btn-primary btn-sm dash-tap" to={roomLink(r.code, 'live')}>
            <Icon name="live" />
            Open the class
          </Link>
        )}
        {r.status === 'paused' && r.canControl && (
          <Button size="sm" className="dash-tap" icon="play" busy={working && busy.action === 'resume'} disabled={working} onClick={() => onResume(r)}>
            Resume
          </Button>
        )}
      </td>
      <td className="c-more">
        <Menu
          items={items}
          trigger={
            <Button variant="ghost" size="sm" className="dash-tap" icon="more" busy={working && busy.action !== 'resume'} disabled={working} aria-label={`Actions for room ${r.code}`} />
          }
        />
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------- view */

/**
 * @param rooms        GET /api/session rows, newest first; null before the first read
 * @param locked       the read was refused for want of a key or an account
 * @param busy         the one action in flight, as { code, action }
 * @param onClose      (room) => Promise<boolean> - true when the server did it
 * @param onDelete     (room, typed) => Promise<boolean> - `typed` is what the person typed back
 */
export function RoomsView({
  loading, error, locked, rooms, reading, onReload,
  busy, actionError, notice, onDismiss,
  onPause, onResume, onClose, onDelete,
}) {
  const { account } = useViewer();
  const navigate = useNavigate();

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  // The destructive step in progress, as { kind: 'close' | 'delete', code }.
  // Held by code, so the dialog always describes the room as the server last
  // reported it - and lets go by itself if that room is no longer there.
  const [asking, setAsking] = useState(null);
  const [typed, setTyped] = useState('');

  const list = useMemo(() => rooms ?? [], [rooms]);
  const shown = useMemo(() => {
    const match = (FILTERS.find((f) => f.id === filter) ?? FILTERS[0]).match;
    const q = query.trim().toLowerCase();
    return list.filter((r) => match(r) && (!q || `${r.code ?? ''} ${r.title ?? ''}`.toLowerCase().includes(q)));
  }, [list, filter, query]);

  const target = asking ? list.find((r) => r.code === asking.code) ?? null : null;

  // A typed confirmation is about one room and must never carry to another.
  const ask = (kind, room) => {
    onDismiss?.();
    setTyped('');
    // Deferred a tick: the menu this came from is still closing, and a dialog
    // opened in the same breath fights it for focus.
    setTimeout(() => setAsking({ kind, code: room.code }), 0);
  };
  const stopAsking = () => { setAsking(null); setTyped(''); };

  const crumb = <span>Rooms</span>;

  if (loading) {
    return <AccountShell current="rooms" crumb={crumb}><Skeleton /></AccountShell>;
  }

  // A student's token is refused by the teacher guard, so the honest answer is
  // the screen that is theirs rather than the server's refusal painted red.
  if (account?.role === 'student') {
    return (
      <AccountShell current="rooms" crumb={crumb}>
        <Empty icon="shield" title="Rooms are the teacher's side of a class" action={<Link className="btn btn-primary dash-tap" to="/me">Go to your results</Link>}>
          You join a room with its code and your roll number, and what happened in it is on your own results screen.
          Pausing and closing belong to whoever opened it.
        </Empty>
      </AccountShell>
    );
  }

  if (error && list.length === 0) {
    return (
      <AccountShell current="rooms" crumb={crumb}>
        <Empty
          icon={locked ? 'lock' : 'alert'}
          title={locked ? 'Rooms need the teacher key or an account' : 'The rooms did not load'}
          action={locked
            ? <Link className="btn btn-primary dash-tap" to="/">Unlock the console</Link>
            : <Button variant="primary" className="dash-tap" icon="refresh" busy={reading} onClick={onReload}>Try again</Button>}
        >
          {error}
        </Empty>
      </AccountShell>
    );
  }

  if (list.length === 0) {
    return (
      <AccountShell current="rooms" crumb={crumb}>
        <div className="page-head"><div><h1>Rooms</h1></div></div>
        {notice && <Note style={{ marginBottom: 16 }} role="status">{notice}</Note>}
        <div className="card">
          <Empty icon="rooms" title="No rooms yet" action={<Link className="btn btn-primary dash-tap" to="/"><Icon name="play" />Open a new room</Link>}>
            A room puts a six-character code on the projector and the class does the rest. Once one has been opened it
            stays listed here, live, paused or closed, so losing the tab is not losing the room.
          </Empty>
        </div>
      </AccountShell>
    );
  }

  const running = list.filter((r) => r.status === 'open' || r.status === 'paused');
  const connected = running.reduce((n, r) => n + (r.online ?? 0), 0);
  const seats = running.reduce((n, r) => n + (r.joined ?? 0), 0);
  const readOnly = list.some((r) => !r.canControl);

  const closing = target && asking.kind === 'close' ? target : null;
  const deleting = target && asking.kind === 'delete' ? target : null;
  const armed = Boolean(deleting) && typed.trim().toUpperCase() === deleting.code;
  const inFlight = (action) => Boolean(target) && busy?.code === target.code && busy.action === action;
  const refused = actionError && (
    <Note tone="bad" role="alert">{actionError} Nothing was changed here: the list is what the server says.</Note>
  );

  return (
    <AccountShell current="rooms" crumb={crumb}>
      <div className="page-head">
        <div>
          <h1>Rooms</h1>
          <p className="t-lead lead">
            Pausing holds a class where it is: everyone stays connected and picks up on their own next question.
            Closing is final.
          </p>
        </div>
        <div className="acts dash-headacts">
          <Tip label="Read the rooms again">
            <Button variant="ghost" className="dash-tap" icon="refresh" busy={reading} aria-label="Read the rooms again" onClick={onReload} />
          </Tip>
          <Link className="btn dash-tap" to="/"><Icon name="plus" />Open a new room</Link>
        </div>
      </div>

      <div className="dash-tools">
        <div className="dash-segbox">
          <Segmented
            label="Rooms by state"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: list.filter(f.match).length }))}
          />
        </div>
        <label className="search">
          <Icon name="search" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a room by code or chapter" aria-label="Find a room by code or chapter" />
        </label>
      </div>

      <div className="stack stack-3 dash-notes">
        {error && <Note tone="bad">The rooms below are the last ones that loaded: {error}</Note>}
        {notice && <Note role="status">{notice}</Note>}
        {!asking && refused}
        {readOnly && (
          <Note>
            Rooms marked read only were opened by another account. You can open them and read every number. Pausing,
            closing and deleting belong to whoever runs the class.
          </Note>
        )}
      </div>

      <section className="card">
        <div className="card-head dash-wrap between">
          <h3 className="sr-only">Rooms</h3>
          <span className="t-meta">
            {shown.length === list.length ? `${plural(list.length, 'room')}, newest first` : `${shown.length} of ${list.length} shown`}
          </span>
          {running.length > 0 && <Chip dot>{connected} of {plural(seats, 'student')} connected now</Chip>}
        </div>

        {shown.length === 0 ? (
          <Empty
            icon="search"
            title="No room matches"
            action={<Button className="dash-tap" onClick={() => { setFilter('all'); setQuery(''); }}>Clear the filter</Button>}
          >
            Nothing you can see answers to that. The rooms themselves have not changed.
          </Empty>
        ) : (
          <table className="tbl dash-rooms">
            <thead>
              <tr>
                <th>Room</th>
                <th>Chapter</th>
                <th>State</th>
                <th className="r">Joined</th>
                <th className="r">Answered</th>
                <th className="r">Accuracy</th>
                <th>When</th>
                <th><span className="sr-only">Open</span></th>
                <th><span className="sr-only">More actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RoomRow
                  key={r.code}
                  room={r}
                  busy={busy}
                  onPause={onPause}
                  onResume={onResume}
                  onAskClose={(room) => ask('close', room)}
                  onAskDelete={(room) => ask('delete', room)}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Closing. One press from final, so the alternative is offered in the
          same breath. */}
      <Dialog
        open={Boolean(closing)}
        onOpenChange={(open) => { if (!open) stopAsking(); }}
        locked={inFlight('close')}
        title={closing ? `Close ${closing.code} for good?` : 'Close the room'}
        description={closing?.title || undefined}
        footer={closing && (
          <div className="dash-acts">
            <Button variant="ghost" autoFocus disabled={inFlight('close')} onClick={stopAsking}>Leave it running</Button>
            {closing.status === 'open' && (
              <Button icon="pause" disabled={inFlight('close')} onClick={() => { stopAsking(); onPause(closing); }}>Pause instead</Button>
            )}
            <Button variant="primary" icon="stop" busy={inFlight('close')} onClick={async () => { if (await onClose(closing)) stopAsking(); }}>
              Close for good
            </Button>
          </div>
        )}
      >
        <div className="stack">
          {refused}
          <p>
            Closing ends the room for everyone in it, and a closed room cannot be reopened, by you or by anyone.
            Everything the class recorded stays readable.
          </p>
          <p className="said">
            If you only need to stop for a few minutes, pause it. Every student stays connected and answering resumes
            on the question each of them had reached.
          </p>
        </div>
      </Dialog>

      {/* Deleting. Not one of the controls above: it destroys the class's
          marks, so it says exactly what goes and asks for the code back. */}
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => { if (!open) stopAsking(); }}
        locked={inFlight('delete')}
        title={deleting ? `Delete ${deleting.code}` : 'Delete the room'}
        description="It leaves your rooms for good. What was recorded in it is kept as a JSON archive."
        footer={deleting && (
          <div className="dash-acts">
            <Button variant="ghost" disabled={inFlight('delete')} onClick={stopAsking}>Keep the room</Button>
            <Button
              type="submit"
              form="dash-delete-room"
              variant={armed ? 'primary' : undefined}
              className={armed ? 'btn-danger' : ''}
              icon="trash"
              disabled={!armed}
              busy={inFlight('delete')}
            >
              Delete {deleting.code}
            </Button>
          </div>
        )}
      >
        {deleting && (
          <form
            id="dash-delete-room"
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!armed) return;
              // What was typed is sent, not the room's own code. Sending the
              // code from a variable would turn the server's catch into a formality.
              if (await onDelete(deleting, typed.trim().toUpperCase())) stopAsking();
            }}
          >
            {refused}
            <Note tone="bad">
              This removes the room, its {plural(deleting.joined, 'student profile')} and{' '}
              {plural(deleting.answered, 'answer')} from every screen and report the department has. Before
              anything is removed, all of it is saved as one JSON archive (under 1 MB) that you can download
              later. If the archive cannot be saved, nothing is deleted.
            </Note>
            <p className="hint">Closing the room instead keeps all of it on your screens and in reports.</p>
            <Field
              label={<>Type <span className="mono">{deleting.code}</span> to confirm</>}
              htmlFor="dash-delete-typed"
              hint="The server checks this too, so a slip here cannot delete a different room."
            >
              <input
                id="dash-delete-typed"
                className="input input-code"
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={inFlight('delete')}
                value={typed}
                onChange={(e) => setTyped(e.target.value.toUpperCase())}
              />
            </Field>
          </form>
        )}
      </Dialog>
    </AccountShell>
  );
}

/* --------------------------------------------------------------- container */

export default function Rooms() {
  const { account, loading: accountLoading } = useViewer();

  // null means "not read yet", which is what the skeleton waits on. An empty
  // array is a real answer and gets the empty state instead.
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [reading, setReading] = useState(false);

  // The one action in flight, as { code, action }. Scoped to a room, so two
  // rooms are never disabled by each other's work.
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setReading(true);
    try {
      const res = await api.listSessions();
      setRaw(Array.isArray(res?.rooms) ? res.rooms : []);
      setError('');
      setLocked(false);
    } catch (err) {
      // A failed background poll must not blank a list that is on screen and
      // was correct fifteen seconds ago.
      if (!silent) {
        setError(err.message || 'The rooms did not load.');
        setLocked(err.status === 401);
      }
    } finally {
      if (!silent) setReading(false);
    }
  }, []);

  /* Waits for the account to settle. Firing before then sends no bearer token
     and the server answers as the shared teacher key: a real payload listing
     somebody else's rooms. */
  useEffect(() => {
    if (accountLoading) return;
    load();
  }, [accountLoading, account?.id, load]);

  /* `online` is a live number: it comes from the socket layer's presence map
     and is wrong the moment a phone locks. So the list re-reads itself while
     anything is still running, and stops once every room is closed. */
  useEffect(() => {
    const running = (raw ?? []).some((r) => r.status === 'open' || r.status === 'paused');
    if (!running) return undefined;
    const timer = setInterval(() => {
      // Not while the tab is in the background, and never on top of an action
      // that is still open - the answer to that one is the reload it will do.
      if (document.hidden || busy) return;
      load({ silent: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [raw, busy, load]);

  // Newest first, stated rather than assumed. ISO strings sort as text, and a
  // room with no start date sorts to the bottom, which is where it belongs.
  const rooms = useMemo(
    () => (raw === null ? null : [...raw].sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))),
    [raw],
  );

  /**
   * Run one action against one room and then re-read the list - on success
   * and on failure both. The server is the only thing that knows what a room
   * is now. Resolves true when the action went through.
   */
  async function act(code, action, run) {
    setBusy({ code, action });
    setActionError('');
    setNotice('');
    let ok = true;
    try {
      await run();
    } catch (err) {
      ok = false;
      setActionError(err.message || 'The server refused that.');
    } finally {
      await load({ silent: true });
      setBusy(null);
    }
    return ok;
  }

  const pause = (room) => act(room.code, 'pause', () => api.pauseSession(room.code));
  const resume = (room) => act(room.code, 'resume', () => api.resumeSession(room.code));
  const close = (room) => act(room.code, 'close', () => api.closeSession(room.code));
  const destroy = (room, typed) => act(room.code, 'delete', async () => {
    const res = await api.deleteSession(room.code, typed);
    const kb = Math.max(1, Math.round((res?.archive?.bytes ?? 0) / 1024));
    const n = res?.deletedProfiles ?? 0;
    setNotice(`${room.code} is deleted. Its ${plural(n, 'student result')} ${n === 1 ? 'was' : 'were'} saved first as a ${kb} KB JSON archive.`);
  });

  return (
    <RoomsView
      loading={accountLoading || (rooms === null && !error)}
      error={error}
      locked={locked}
      rooms={rooms}
      reading={reading}
      onReload={() => load()}
      busy={busy}
      actionError={actionError}
      notice={notice}
      onDismiss={() => { setActionError(''); setNotice(''); }}
      onPause={pause}
      onResume={resume}
      onClose={close}
      onDelete={destroy}
    />
  );
}
