/**
 * Attendance against the room's class (Phase 3). Staff only: none of it ever
 * reaches a phone or the projector.
 *
 * Reads GET /:code/attendance: every student on the roster with a status,
 * where `unmarked` (nobody has marked them) is its own state and never shown as
 * absent; the phones that joined with a roll number the roster does not hold;
 * and students removed from the roster since, with their marks. The last two
 * are kept apart from the roster and from its counts.
 *
 * "Joined" only ever means a phone typed that roll number, so the server's
 * caveat sits beside the joined count and is the description of every joined
 * marker in the list.
 *
 * Marks go to POST /:code/attendance, one student or several at once, or
 * "everyone who joined" (`fromJoins`), which the server refuses in a
 * Teacher-led room; here it is not offered there, with the reason. The reply
 * is the same read, so the screen takes it whole.
 *
 * The list is read again whenever the grid's "N / M present" (`summary`)
 * changes: a join, or a mark made on another screen.
 *
 * @param code        the room code
 * @param canControl  from the room list row; false: read only
 * @param mode        the room's settings.mode: devices | teacher-led | mixed
 * @param summary     the grid's `attendance`: { present, classSize, summary }
 * @param load        stands in for api.attendance (the dev gallery)
 * @param mark        stands in for api.markAttendance (the dev gallery)
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Icon, Note, Segmented } from '../ui/index.jsx';

const STATUS = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  unmarked: 'Unmarked',
};
// What a professor can set. Unmarked is where everyone starts, not a mark.
const MARKS = ['present', 'late', 'absent'];
const ORDER = ['present', 'late', 'absent', 'unmarked'];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** One line on how a student came by their mark. */
function howMarked(s, phones) {
  const by = s.source === 'joined' ? 'marked by the join' : s.source === 'teacher' ? 'marked by hand' : 'not marked yet';
  if (phones && s.joined) return `Joined · ${by}`;
  return by.charAt(0).toUpperCase() + by.slice(1);
}

/** A status in words, with a shape that does not lean on colour. */
export function StatusTag({ status }) {
  return (
    <span className="at-tag" data-status={status}>
      <i aria-hidden="true" />
      {STATUS[status] ?? status}
    </span>
  );
}

/** The four states as one bar and a key. Unmarked is drawn apart, hatched, never as absent. */
function Spread({ counts }) {
  const total = ORDER.reduce((n, k) => n + (counts[k] ?? 0), 0);
  return (
    <div className="at-spread">
      <div className="at-bar" role="img" aria-label={ORDER.map((k) => `${STATUS[k]} ${counts[k] ?? 0}`).join(', ')}>
        {total > 0 && ORDER.map((k) => ((counts[k] ?? 0) > 0
          ? <i key={k} data-status={k} style={{ flex: counts[k] }} />
          : null))}
      </div>
      <ul className="at-key">
        {ORDER.map((k) => (
          <li key={k}>
            <StatusTag status={k} />
            <b>{counts[k] ?? 0}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="at" aria-busy="true" aria-label="Reading attendance">
      <div className="card at-side">
        <span className="skel at-sk-1" />
        <span className="skel at-sk-2" />
        <span className="skel at-sk-3" />
      </div>
      <div className="card at-main">
        {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="skel at-sk-row" />)}
      </div>
    </div>
  );
}

export default function Attendance({
  code, canControl = false, mode = 'devices', summary = null,
  load = api.attendance, mark = api.markAttendance,
}) {
  const [data, setData] = useState(null);
  // { message, status } of a read that failed. A 409 is a room with no class.
  const [error, setError] = useState(null);
  const [writeError, setWriteError] = useState('');
  // 'joins' | 'some:<status>' | a studentId: what is being written.
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [reading, setReading] = useState(false);
  const caveatId = useId();
  const last = useRef(null);

  const read = useCallback(async () => {
    setReading(true);
    try {
      const r = await load(code);
      last.current = r.summary;
      setData(r);
      setError(null);
    } catch (err) {
      setError({ message: err.message, status: err.status });
    } finally {
      setReading(false);
    }
  }, [code, load]);

  // The first read, then again when the grid's present count moves. Not when
  // it moved because of this screen's own mark: that reply is already here.
  const pushed = summary?.summary ?? null;
  useEffect(() => {
    if (pushed && last.current === pushed) return;
    read();
  }, [read, pushed]);

  const phones = mode !== 'teacher-led';
  const students = data?.students ?? [];
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => students.filter((s) => (filter === 'all' || s.status === filter)
    && (!q || `${s.rollNo} ${s.name}`.toLowerCase().includes(q))), [students, filter, q]);

  if (!data && error) {
    return (
      <section className="card at-none" aria-label="Attendance">
        <span className="at-none-ic"><Icon name="attendance" size={18} /></span>
        <div>
          <h3>{error.status === 409 ? 'No attendance in this room' : 'Attendance could not be read'}</h3>
          <p role="alert">{error.message}</p>
        </div>
        {error.status !== 409 && <Button size="sm" icon="refresh" busy={reading} onClick={read}>Try again</Button>}
      </section>
    );
  }
  if (!data) return <Skeleton />;

  const { counts } = data;
  const cls = data.class ?? {};
  const allOn = shown.length > 0 && shown.every((s) => picked.has(s.studentId));

  async function send(body, what, after) {
    setBusy(what); setWriteError(''); setDone('');
    try {
      const { changed, kept, ...rest } = await mark(code, body);
      last.current = rest.summary;
      setData(rest);
      if (after) setDone(after(changed ?? 0, kept ?? 0));
    } catch (err) {
      setWriteError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const markOne = (s, status) => {
    if (s.status === status) return;
    send({ marks: [{ studentId: s.studentId, status }] }, s.studentId, null);
  };
  const markPicked = (status) => {
    const ids = students.filter((s) => picked.has(s.studentId)).map((s) => s.studentId);
    if (!ids.length) return;
    send({ marks: ids.map((studentId) => ({ studentId, status })) }, `some:${status}`, (changed) => {
      setPicked(new Set());
      return `${plural(changed, 'student')} marked ${STATUS[status].toLowerCase()}.`;
    });
  };
  const markJoins = () => send({ fromJoins: true }, 'joins', (changed, kept) => (
    `${plural(changed, 'mark')} written from the joins.${kept ? ` ${plural(kept, 'mark')} made by hand ${kept === 1 ? 'was' : 'were'} kept.` : ''}`
  ));
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleShown = () => setPicked((prev) => {
    const next = new Set(prev);
    for (const s of shown) { if (allOn) next.delete(s.studentId); else next.add(s.studentId); }
    return next;
  });

  const filters = [
    { id: 'all', label: 'All', count: counts.classSize },
    ...ORDER.map((k) => ({ id: k, label: STATUS[k], count: counts[k] ?? 0 })),
  ];

  return (
    <div className="at">
      <aside className="card at-side" aria-label="Attendance summary">
        <div className="at-head">
          <span className="eyebrow">Attendance</span>
          <h2 className="at-class">
            {[cls.courseName, cls.section].filter(Boolean).join(' ')}
            {cls.termLabel && <span>{cls.termLabel}</span>}
          </h2>
        </div>

        <div className="at-sum">
          <b aria-live="polite">{data.summary}</b>
          <span>Students present, late included, of the {plural(counts.classSize, 'student')} on the roster.</span>
        </div>
        <Spread counts={counts} />

        {phones ? (
          <div className="at-joined">
            <span className="at-joined-n">
              <span className="at-ph" aria-hidden="true"><Icon name="wifi" size={13} /></span>
              <b>{counts.joined}</b> joined on a phone
            </span>
            <p className="at-caveat" id={caveatId}>{data.caveat}</p>
            {canControl && (
              <div className="at-joins">
                <Button block busy={busy === 'joins'} disabled={busy != null} icon="attendance" onClick={markJoins}>
                  Mark everyone who joined as present
                </Button>
                <p>
                  Everyone else on the roster is marked absent. Marks you made by hand are kept. A student who joins after
                  this stays absent until you change the mark.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="at-tl">
            No phone joins a Teacher-led room, so there are no joins to mark from. Every mark here is made by hand.
          </p>
        )}

        {!canControl && (
          <p className="at-ro"><Icon name="lock" size={14} />Read only. Only the professor who opened this room can mark attendance.</p>
        )}
        {canControl && data.room?.status === 'closed' && (
          <p className="at-ro"><Icon name="info" size={14} />This room is closed. Its attendance can still be corrected.</p>
        )}
        {done && <Note tone="ok" role="status">{done}</Note>}
        {writeError && <Note tone="bad" role="alert">{writeError}</Note>}
        {error && <Note tone="bad" role="alert">{error.message}</Note>}
      </aside>

      <section className="card at-main" aria-label="The roster">
        <div className="at-tools">
          <Segmented label="Show" options={filters} value={filter} onChange={setFilter} />
          <label className="search at-search">
            <Icon name="search" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a student" aria-label="Find a student by roll number or name" />
          </label>
          <Button variant="ghost" size="sm" icon="refresh" busy={reading} onClick={read} aria-label="Read attendance again" />
        </div>

        {canControl && (
          <div className="at-bulk" data-on={picked.size ? 'true' : undefined}>
            <label className="check">
              <input type="checkbox" checked={allOn} disabled={!shown.length} onChange={toggleShown} />
              {picked.size ? `${picked.size} selected` : 'Select all shown'}
            </label>
            {picked.size > 0 && (
              <span className="at-bulk-act" role="group" aria-label={`Mark the ${plural(picked.size, 'selected student')}`}>
                {MARKS.map((k) => (
                  <Button key={k} size="sm" disabled={busy != null} busy={busy === `some:${k}`} onClick={() => markPicked(k)}>{STATUS[k]}</Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
              </span>
            )}
          </div>
        )}

        {shown.length === 0 ? (
          <p className="at-empty">
            {students.length === 0
              ? 'Nobody is on this class’s roster yet.'
              : q ? 'No student shown here matches those words.' : `Nobody is ${STATUS[filter].toLowerCase()}.`}
          </p>
        ) : (
          <ul className="at-list">
            {shown.map((s) => (
              <li key={s.studentId} className="at-row" data-status={s.status} data-picked={picked.has(s.studentId) ? 'true' : undefined}>
                {canControl && (
                  <input
                    type="checkbox"
                    className="at-pick"
                    checked={picked.has(s.studentId)}
                    onChange={() => toggle(s.studentId)}
                    aria-label={`Select ${s.rollNo} ${s.name}`}
                    aria-describedby={phones && s.joined ? caveatId : undefined}
                  />
                )}
                <span className="at-who">
                  <span className="at-id">
                    <span className="mono at-roll">{s.rollNo}</span>
                    <span className="at-name">{s.name}</span>
                  </span>
                  <span className="at-how">
                    {phones && s.joined && <span className="at-ph" aria-hidden="true"><Icon name="wifi" size={12} /></span>}
                    {howMarked(s, phones)}
                  </span>
                </span>
                {canControl ? (
                  <span className="at-set" aria-busy={busy === s.studentId ? 'true' : undefined}>
                    {s.status === 'unmarked' && <StatusTag status="unmarked" />}
                    <Segmented
                      label={`Mark ${s.rollNo} ${s.name}`}
                      options={MARKS.map((k) => ({ id: k, label: STATUS[k], disabled: busy != null }))}
                      value={s.status}
                      onChange={(k) => markOne(s, k)}
                    />
                  </span>
                ) : (
                  <StatusTag status={s.status} />
                )}
              </li>
            ))}
          </ul>
        )}

        {data.notOnRoster?.length > 0 && (
          <section className="at-extra" aria-labelledby={`${caveatId}-nor`}>
            <h3 id={`${caveatId}-nor`}>Joined, not on the roster <span className="mono">{data.notOnRoster.length}</span></h3>
            <p>
              Phones let in with a roll number this class’s roster does not hold. They are not counted above. {data.caveat}
              {canControl && cls.id && (
                <>
                  {' '}
                  <a className="link" href={`/classes/${encodeURIComponent(cls.id)}`} target="_blank" rel="noopener noreferrer">Add them to the class</a>
                </>
              )}
            </p>
            <ul className="at-mini">
              {data.notOnRoster.map((p) => (
                <li key={p.rollNo}>
                  <span className="mono at-roll">{p.rollNo}</span>
                  <span className="at-name">{p.name || 'No name typed'}</span>
                  {p.removedFromRoster && <span className="at-how">Removed from the roster</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.removed?.length > 0 && (
          <section className="at-extra" aria-labelledby={`${caveatId}-rem`}>
            <h3 id={`${caveatId}-rem`}>Removed from the roster <span className="mono">{data.removed.length}</span></h3>
            <p>Removed since they were marked in this room. Shown with their mark, and not counted.</p>
            <ul className="at-mini">
              {data.removed.map((s) => (
                <li key={s.studentId}>
                  <span className="mono at-roll">{s.rollNo}</span>
                  <span className="at-name">{s.name}</span>
                  {s.removedAt && <span className="at-how">Removed {DATE.format(new Date(s.removedAt))}</span>}
                  <StatusTag status={s.status} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </div>
  );
}
