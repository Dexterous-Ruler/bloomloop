/**
 * Which rooms a class report reads: a date range and, optionally, some of the
 * class's rooms. Shared by the attainment report and the marks register, so
 * both say the same thing about what is counted.
 *
 *   value     { from, to, rooms }: dates as YYYY-MM-DD ('' for open), rooms
 *             as an array of codes ([] for every room in the dates)
 *   onChange  (value) => void
 *
 * The room list is the class's rooms this caller may read (GET /api/session,
 * filtered by `classId`), not the report's own `rooms`, which lists only the
 * rooms already inside the window. Deleted rooms are not in it: a deleted
 * room is never counted, and its answers stay in its archive.
 */

import { useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Chip, Dialog } from '../ui/index.jsx';

const list = (v) => (Array.isArray(v) ? v : []);
const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dayOf = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? DAY.format(d) : ''; };

export const NO_WINDOW = { from: '', to: '', rooms: [] };

/** The report query for a window: empty parts are left out by the api. */
export const windowParams = (w = NO_WINDOW) => ({ from: w.from || '', to: w.to || '', rooms: list(w.rooms).join(',') });

export default function ReportWindow({ classId, value = NO_WINDOW, onChange }) {
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState([]);

  useEffect(() => {
    let alive = true;
    api.listSessions().then(
      (res) => {
        if (!alive) return;
        const mine = list(res?.rooms ?? res).filter((r) => r.classId === classId);
        // Oldest first, as the reports count them.
        mine.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
        setRooms(mine);
      },
      (err) => { if (alive) setError(err.message); },
    );
    return () => { alive = false; };
  }, [classId]);

  const chosen = list(value.rooms);
  const set = (patch) => onChange?.({ ...NO_WINDOW, ...value, ...patch });
  const roomsLabel = chosen.length === 0 ? 'Every room in these dates' : chosen.length === 1 ? `Room ${chosen[0]}` : `${chosen.length} rooms`;
  const any = value.from || value.to || chosen.length > 0;

  return (
    <div className="rwin" role="group" aria-label="Rooms this report reads">
      <label className="rwin-f">
        <span>From</span>
        <input type="date" className="input input-sm" value={value.from || ''} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} />
      </label>
      <label className="rwin-f">
        <span>To</span>
        <input type="date" className="input input-sm" value={value.to || ''} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} />
      </label>
      <Button size="sm" icon="rooms" onClick={() => { setDraft(chosen); setPicking(true); }} disabled={!rooms?.length}>
        {roomsLabel}
      </Button>
      {any && <Button size="sm" variant="ghost" icon="undo" onClick={() => onChange?.(NO_WINDOW)}>All rooms</Button>}
      {error && <span className="rwin-err">The room list did not load: {error}</span>}

      <Dialog
        open={picking}
        onOpenChange={setPicking}
        title="Rooms in this report"
        description="Only rooms opened for this class are counted. A deleted room is never counted; its answers stay in its archive."
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDraft([])}>Every room</Button>
            <Button variant="primary" onClick={() => { set({ rooms: draft }); setPicking(false); }}>Use these</Button>
          </>
        )}
      >
        <ul className="rwin-list">
          {list(rooms).map((r) => {
            const on = draft.includes(r.code);
            return (
              <li key={r.code}>
                <label className="rwin-room">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setDraft((d) => (on ? d.filter((c) => c !== r.code) : [...d, r.code]))}
                  />
                  <span className="mono">{r.code}</span>
                  <span className="clip">{r.title || 'Untitled room'}</span>
                  <span className="t-meta">{dayOf(r.startedAt)}</span>
                  {r.status !== 'closed' && <Chip>{r.status === 'waiting' ? 'Waiting' : r.status === 'paused' ? 'Paused' : 'Open'}</Chip>}
                </label>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </div>
  );
}
