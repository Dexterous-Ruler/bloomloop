/**
 * Every room this viewer may see, and only the controls the server will honour.
 *
 * Two words carry the screen, so the copy says which is which wherever it can:
 *
 *   pause   every student stays connected and every profile stays intact, and
 *           answering resumes on the question each of them had reached
 *   close   final. The room cannot be reopened, by anyone.
 *
 * A third, delete, takes a room off every screen. What was recorded in it is
 * not destroyed: the server writes the whole room to one JSON archive (1 MB at
 * most) first, and deletes nothing if that write fails or would not fit. The
 * archives are listed under the rooms, each one downloadable.
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
import {
  dayParts, plural, Rate, roomLink, RoomState, roomWhen, sizeOf, stampOf,
} from './dashParts.jsx';

/* Each filter carries its own test, so its count and the rows it shows cannot
   drift apart. */
const FILTERS = [
  { id: 'open', label: 'Live', match: (r) => r.status === 'open' },
  { id: 'paused', label: 'Paused', match: (r) => r.status === 'paused' },
  { id: 'closed', label: 'Closed', match: (r) => r.status === 'closed' },
  { id: 'all', label: 'All', match: () => true },
];

/** The server's ceiling on one archive, for when the list has not said. */
const ONE_MB = 1024 * 1024;

function Skeleton() {
  return (
    <div className="stack stack-5" aria-busy="true">
      <div className="ac-toolbar">
        <div className="skel" style={{ height: 32, width: 300, maxWidth: '100%' }} />
        <div className="skel" style={{ height: 36, width: 280, maxWidth: '100%' }} />
      </div>
      <div className="card ac-skel-list">
        <div className="skel" style={{ height: 12, width: 90 }} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="ac-skel-row">
            <div className="skel" style={{ height: 24, width: 64 }} />
            <div className="skel" style={{ height: 14, width: 64 }} />
            <div className="skel" style={{ height: 14, flex: 1, maxWidth: 280 }} />
            <div className="skel" style={{ height: 6, width: 90 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A room's settings, said quietly: the goal always, the rest only when on. */
function Settings({ settings }) {
  if (!settings) return null;
  const goal = Number(settings.masteryGoal);
  const tries = Number(settings.reattempts) || 0;
  return (
    <>
      {Number.isFinite(goal) && goal > 0 && <span className="ac-set" title="Mastery goal: the accuracy a level counts as mastered at">Goal {Math.round(goal * 100)}%</span>}
      {tries > 0 && <span className="ac-set" title="Tries a student gets at a question they missed">{plural(tries, 'retry', 'retries')}</span>}
      {settings.redemption && <span className="ac-set" title="Early misses can be set aside once a student shows they have it">Redemption</span>}
    </>
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
    items.push('sep', { id: 'delete', label: 'Delete the room (keeps a JSON archive)', icon: 'trash', danger: true, onSelect: () => onAskDelete(r) });
  } else {
    // Reading a room is not writing to it, so the two links above stay.
    items.push('sep', { heading: 'Read only: another account runs it' });
  }

  const when = r.status === 'closed' ? r.closedAt : r.status === 'paused' ? r.pausedAt : r.startedAt;

  return (
    <li className="ac-room" data-status={r.status} aria-busy={working || undefined}>
      <span className="ac-room-state"><RoomState status={r.status} /></span>
      <span className="ac-room-code">{r.code}</span>
      <span className="ac-room-main">
        <span className="ac-room-t clip" title={r.title || undefined}>{r.title || 'Untitled room'}</span>
        <span className="ac-room-sub">
          <span title={stampOf(when) || undefined}>{roomWhen(r)}</span>
          <Settings settings={r.settings} />
          {!r.canControl && <span className="ac-set is-ro">Read only</span>}
          {r.banded > 0 && <span className="ac-room-band">{r.banded} in the support band</span>}
        </span>
      </span>
      <span className="ac-room-people" data-label="Joined">
        <span><b>{r.joined ?? 0}</b> joined</span>
        {/* A live number, so it sits with the state it is true of. */}
        {running && <small>{r.online ?? 0} online</small>}
      </span>
      <span className="ac-room-acc" data-label="Accuracy">
        <Rate value={r.accuracy} />
        <small>
          {Number(r.answered ?? 0).toLocaleString()} answered
          {r.withdrawn > 0 && (
            <span title="Early misses set aside by redemption. They are not in this average."> · {r.withdrawn} set aside</span>
          )}
        </small>
      </span>
      <span className="ac-room-go">
        {r.status === 'open' && (
          <Link className="btn btn-primary btn-sm ac-tap" to={roomLink(r.code, 'live')}>
            <Icon name="live" />
            Open the class
          </Link>
        )}
        {r.status === 'paused' && r.canControl && (
          <Button size="sm" className="ac-tap" icon="play" busy={working && busy.action === 'resume'} disabled={working} onClick={() => onResume(r)}>
            Resume
          </Button>
        )}
      </span>
      <span className="ac-room-more">
        <Menu
          items={items}
          trigger={
            <Button variant="ghost" size="sm" className="ac-tap" icon="more" busy={working && busy.action !== 'resume'} disabled={working} aria-label={`Actions for room ${r.code}`} />
          }
        />
      </span>
    </li>
  );
}

/* ---------------------------------------------------------- deleted rooms */

/**
 * The rooms that were deleted, as the archives they were kept in: what, when,
 * how big against the ceiling, and the file itself.
 */
function DeletedRooms({ archives, onReload, onDownload }) {
  const [busyId, setBusyId] = useState('');
  const [failed, setFailed] = useState(null);
  const list = archives?.list ?? [];
  const limit = Number(archives?.limitBytes) > 0 ? Number(archives.limitBytes) : ONE_MB;

  async function download(a) {
    setBusyId(a._id);
    setFailed(null);
    try {
      await onDownload(a);
    } catch (err) {
      setFailed({ id: a._id, message: err.message || 'The download did not start.' });
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="card ac-card" aria-labelledby="ac-arch-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="ac-arch-h">Deleted rooms</h2>
          <p>
            Each was saved as one JSON archive before it left your rooms, so what the class recorded can still be read.
            An archive is never more than {sizeOf(limit)}.
          </p>
        </div>
        {list.length > 0 && <span className="t-meta nowrap">{plural(list.length, 'archive')}</span>}
      </div>

      {archives?.error && (
        <div className="ac-pad-x">
          <Note tone="bad">
            {list.length ? 'The list below is the last one that loaded: ' : 'The deleted rooms did not load: '}
            {archives.error}{' '}
            <button type="button" className="link ac-linkbtn" onClick={onReload}>Try again</button>
          </Note>
        </div>
      )}

      {archives?.loading && list.length === 0 ? (
        <div className="ac-archs" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="ac-skel-row">
              <div className="skel" style={{ width: 34, height: 34, borderRadius: 9 }} />
              <div className="stack stack-1 grow">
                <div className="skel" style={{ height: 13, width: '42%' }} />
                <div className="skel" style={{ height: 11, width: '30%' }} />
              </div>
              <div className="skel" style={{ height: 6, width: 110 }} />
            </div>
          ))}
        </div>
      ) : list.length === 0 && !archives?.error ? (
        <div className="ac-arch-empty">
          <span className="ac-arch-ic" aria-hidden="true"><Icon name="history" size={18} /></span>
          <div className="stack stack-1">
            <b>Nothing deleted yet</b>
            <p className="t-small muted">
              Deleting a room saves everything recorded in it here first, as a JSON file you can download. If that save
              cannot be made, the room is not deleted.
            </p>
          </div>
        </div>
      ) : list.length > 0 && (
        <ul className="ac-archs">
          {list.map((a) => {
            const pct = Math.min(100, Math.max(1, (Number(a.bytes) / limit) * 100));
            return (
              <li key={a._id} className="ac-arch">
                <span className="ac-arch-ic" aria-hidden="true"><Icon name="material" size={16} /></span>
                <span className="ac-arch-main">
                  <span className="ac-arch-t">
                    <span className="clip" title={a.title || undefined}>{a.title || 'Untitled room'}</span>
                    <span className="ac-arch-code">{a.code}</span>
                  </span>
                  <span className="t-meta">Archived {stampOf(a.archivedAt) || 'at an unrecorded time'}</span>
                  {failed?.id === a._id && <span className="ac-arch-err" role="alert">{failed.message}</span>}
                </span>
                <span className="ac-size" title={`${Number(a.bytes).toLocaleString()} bytes of the ${sizeOf(limit)} limit`}>
                  <span className="ac-size-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                  <span className="ac-size-n">{sizeOf(a.bytes)} <i>of {sizeOf(limit)}</i></span>
                </span>
                <Button
                  size="sm"
                  className="ac-tap"
                  icon="download"
                  busy={busyId === a._id}
                  disabled={Boolean(busyId)}
                  aria-label={`Download the archive of ${a.code}`}
                  onClick={() => download(a)}
                >
                  Download
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- view */

/**
 * @param rooms        GET /api/session rows, newest first; null before the first read
 * @param locked       the read was refused for want of a key or an account
 * @param busy         the one action in flight, as { code, action }
 * @param onClose      (room) => Promise<boolean> - true when the server did it
 * @param onDelete     (room, typed) => Promise<boolean> - `typed` is what the person typed back
 * @param archives     { loading, error, list, limitBytes } from GET /api/session/archives
 * @param onDownload   (archive) => Promise - saves that archive's .json file
 */
export function RoomsView({
  loading, error, locked, rooms, reading, onReload,
  busy, actionError, notice, onDismiss,
  onPause, onResume, onClose, onDelete,
  archives, onReloadArchives, onDownload,
}) {
  const { account } = useViewer();

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  // The destructive step in progress, as { kind: 'close' | 'delete', code }.
  // Held by code, so the dialog always describes the room as the server last
  // reported it - and lets go by itself if that room is no longer there.
  const [asking, setAsking] = useState(null);
  const [typed, setTyped] = useState('');

  const list = useMemo(() => rooms ?? [], [rooms]);
  const shown = useMemo(() => {
    const match = (FILTERS.find((f) => f.id === filter) ?? FILTERS[3]).match;
    const q = query.trim().toLowerCase();
    return list.filter((r) => match(r) && (!q || `${r.code ?? ''} ${r.title ?? ''}`.toLowerCase().includes(q)));
  }, [list, filter, query]);

  // The rows as days: the list is newest first, so the days are too.
  const days = useMemo(() => {
    const out = [];
    for (const r of shown) {
      const d = dayParts(r.startedAt);
      let g = out.find((x) => x.key === d.key);
      if (!g) { g = { ...d, rooms: [] }; out.push(g); }
      g.rooms.push(r);
    }
    return out;
  }, [shown]);

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

  const running = list.filter((r) => r.status === 'open' || r.status === 'paused');
  const liveN = list.filter((r) => r.status === 'open').length;
  const connected = running.reduce((n, r) => n + (r.online ?? 0), 0);
  const seats = running.reduce((n, r) => n + (r.joined ?? 0), 0);

  const crumb = running.length > 0 ? (
    <>
      {liveN > 0 && <span className="live-dot" aria-hidden="true" />}
      <span>{liveN > 0 ? `${liveN} live` : `${running.length} paused`}</span>
      <span aria-hidden="true">·</span>
      <span>{connected} of {plural(seats, 'student')} connected now</span>
    </>
  ) : <span>Rooms</span>;
  const sub = 'Pausing holds a class where it is: everyone stays connected and picks up on their own next question. Closing is final.';
  const actions = (
    <span className="ac-headacts">
      <Tip label="Read the rooms again">
        <Button variant="ghost" className="ac-tap" icon="refresh" busy={reading} aria-label="Read the rooms again" onClick={onReload} />
      </Tip>
      {/* With no rooms yet, the empty state below carries this. */}
      {list.length > 0 && <Link className="btn btn-primary ac-tap" to="/"><Icon name="plus" />Open a new room</Link>}
    </span>
  );
  const deleted = archives ? <DeletedRooms archives={archives} onReload={onReloadArchives} onDownload={onDownload} /> : null;

  if (loading) {
    return <AccountShell current="rooms" crumb={<span>Rooms</span>} title="Rooms"><Skeleton /></AccountShell>;
  }

  // A student's token is refused by the teacher guard, so the honest answer is
  // the screen that is theirs rather than the server's refusal painted red.
  if (account?.role === 'student') {
    return (
      <AccountShell current="rooms" crumb={<span>Rooms</span>}>
        <div className="card">
          <Empty icon="shield" title="Rooms are the teacher's side of a class" action={<Link className="btn btn-primary ac-tap" to="/me">Go to your results</Link>}>
            You join a room with its code and your roll number, and what happened in it is on your own results screen.
            Pausing and closing belong to whoever opened it.
          </Empty>
        </div>
      </AccountShell>
    );
  }

  if (error && list.length === 0) {
    return (
      <AccountShell current="rooms" crumb={<span>Rooms</span>} title="Rooms">
        <div className="card">
          <Empty
            icon={locked ? 'lock' : 'alert'}
            title={locked ? 'Rooms need the teacher key or an account' : 'The rooms did not load'}
            action={locked
              ? <Link className="btn btn-primary ac-tap" to="/">Unlock the console</Link>
              : <Button variant="primary" className="ac-tap" icon="refresh" busy={reading} onClick={onReload}>Try again</Button>}
          >
            {error}
          </Empty>
        </div>
      </AccountShell>
    );
  }

  if (list.length === 0) {
    return (
      <AccountShell current="rooms" crumb={crumb} title="Rooms" sub={sub} actions={actions}>
        {notice && <Note tone="ok" role="status">{notice}</Note>}
        <section className="card ac-card">
          <Empty icon="rooms" title="No rooms yet" action={<Link className="btn btn-primary ac-tap" to="/"><Icon name="play" />Open a new room</Link>}>
            A room puts a six-character code on the projector and the class does the rest. Once one has been opened it
            stays listed here, live, paused or closed, so losing the tab is not losing the room.
          </Empty>
        </section>
        {deleted}
      </AccountShell>
    );
  }

  const readOnly = list.some((r) => !r.canControl);
  const closing = target && asking.kind === 'close' ? target : null;
  const deleting = target && asking.kind === 'delete' ? target : null;
  const armed = Boolean(deleting) && typed.trim().toUpperCase() === deleting.code;
  const inFlight = (action) => Boolean(target) && busy?.code === target.code && busy.action === action;
  // The server's own sentence, and the reassurance only when it has not
  // already given it (a refused delete says "nothing was changed" itself).
  const refused = actionError && (
    <Note tone="bad" role="alert">
      {actionError}
      {!/nothing was (changed|removed|deleted)/i.test(actionError) && ' Nothing was changed here: the list is what the server says.'}
    </Note>
  );

  return (
    <AccountShell current="rooms" crumb={crumb} title="Rooms" sub={sub} actions={actions}>
      <div className="ac-toolbar">
        <div className="ac-segbox">
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

      {(error || notice || (!asking && actionError) || readOnly) && (
        <div className="stack stack-3">
          {error && <Note tone="bad">The rooms below are the last ones that loaded: {error}</Note>}
          {notice && <Note tone="ok" role="status">{notice}</Note>}
          {!asking && refused}
          {readOnly && (
            <Note>
              Rooms marked read only were opened by another account. You can open them and read every number. Pausing,
              closing and deleting belong to whoever runs the class.
            </Note>
          )}
        </div>
      )}

      <section className="card ac-card ac-roomlist" aria-label="Rooms">
        <div className="ac-roomlist-top">
          <span className="t-meta">
            {shown.length === list.length ? `${plural(list.length, 'room')}, newest first` : `${shown.length} of ${list.length} shown`}
          </span>
        </div>

        {shown.length === 0 ? (
          <Empty
            icon="search"
            title="No room matches"
            action={<Button className="ac-tap" onClick={() => { setFilter('all'); setQuery(''); }}>Clear the filter</Button>}
          >
            Nothing you can see answers to that. The rooms themselves have not changed.
          </Empty>
        ) : (
          days.map((d) => (
            <div key={d.key} className="ac-day">
              <h3 className="ac-day-h">
                <span>{d.label}</span>
                <span className="ac-day-n">{plural(d.rooms.length, 'room')}</span>
              </h3>
              <ul className="ac-rooms">
                {d.rooms.map((r) => (
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
              </ul>
            </div>
          ))
        )}
      </section>

      {deleted}

      {/* Closing. One press from final, so the alternative is offered in the
          same breath. */}
      <Dialog
        open={Boolean(closing)}
        onOpenChange={(open) => { if (!open) stopAsking(); }}
        locked={inFlight('close')}
        title={closing ? `Close ${closing.code} for good?` : 'Close the room'}
        description={closing?.title || undefined}
        footer={closing && (
          <div className="ac-acts">
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
          <p className="t-small">
            Closing ends the room for everyone in it, and a closed room cannot be reopened, by you or by anyone.
            Everything the class recorded stays readable.
          </p>
          <p className="said">
            If you only need to stop for a few minutes, pause it. Every student stays connected and answering resumes
            on the question each of them had reached.
          </p>
        </div>
      </Dialog>

      {/* Deleting. Not one of the controls above: it takes the room off every
          screen, so it says exactly what goes, where it is kept, and asks for
          the code back. */}
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => { if (!open) stopAsking(); }}
        locked={inFlight('delete')}
        title={deleting ? `Delete ${deleting.code}` : 'Delete the room'}
        description="It leaves your rooms for good. What was recorded in it is kept as a JSON archive."
        footer={deleting && (
          <div className="ac-acts">
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
            <ol className="ac-steps-del">
              <li>
                <Icon name="download" />
                <span>
                  <b>Kept first.</b> The room, its {plural(deleting.joined, 'student profile')} and{' '}
                  {plural(deleting.answered, 'answer')} are saved as one JSON archive, under 1 MB, listed under
                  Deleted rooms for you to download.
                </span>
              </li>
              <li>
                <Icon name="trash" />
                <span>
                  <b>Then removed</b> from every screen and report the department has. If the archive cannot be saved,
                  or would be over 1 MB, nothing is deleted.
                </span>
              </li>
            </ol>
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

  // The deleted rooms, as their archives. Read on their own: a slow or refused
  // archive list must not hold up the rooms that are running.
  const [archives, setArchives] = useState({ loading: true, list: [], limitBytes: null, error: '' });

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

  const loadArchives = useCallback(async () => {
    setArchives((a) => ({ ...a, loading: true, error: '' }));
    try {
      const res = await api.listRoomArchives();
      setArchives({
        loading: false,
        list: Array.isArray(res?.archives) ? res.archives : [],
        limitBytes: res?.limitBytes ?? null,
        error: '',
      });
    } catch (err) {
      // What loaded before stays on screen, with the reason beside it.
      setArchives((a) => ({ ...a, loading: false, error: err.message || 'The deleted rooms did not load.' }));
    }
  }, []);

  /* Waits for the account to settle. Firing before then sends no bearer token
     and the server answers as the shared teacher key: a real payload listing
     somebody else's rooms. */
  useEffect(() => {
    if (accountLoading) return;
    load();
    // A student's token is refused here, and their screen says so instead.
    if (account?.role !== 'student') loadArchives();
  }, [accountLoading, account?.id, account?.role, load, loadArchives]);

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
    let res;
    try {
      res = await api.deleteSession(room.code, typed);
    } catch (err) {
      // 413: the archive would be over the 1 MB ceiling, so the server kept
      // the room and deleted nothing. The server says so in its own words; if
      // something on the way swallowed them, this says it instead.
      if (err.status === 413 && !/not deleted/i.test(err.message ?? '')) {
        throw Object.assign(
          new Error(`${room.code} was not deleted: its archive would be over the 1 MB limit, so nothing was removed. Close the room instead to keep it on your screens.`),
          { status: 413 },
        );
      }
      throw err;
    }
    const n = res?.deletedProfiles ?? 0;
    setNotice(
      `${room.code} is deleted. Its ${plural(n, 'student result')} ${n === 1 ? 'was' : 'were'} saved first as a ${sizeOf(res?.archive?.bytes ?? 0)} JSON archive, listed under Deleted rooms.`,
    );
    loadArchives();
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
      archives={archives}
      onReloadArchives={loadArchives}
      onDownload={(archive) => api.downloadRoomArchive(archive._id)}
    />
  );
}
