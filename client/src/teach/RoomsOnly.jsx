/**
 * One question's "Rooms only" switch in the question bank (Batch 8, the shared
 * bank; PUT /api/bank/question/:id/rooms-only). Rooms serve the question either
 * way; kept for rooms, the Learning Hub never offers it. A question without the
 * field is shared. After a press the server's own sentence replaces the hint.
 *
 * A 404 from the route is a server before Batch 8: the switch hides, here and
 * in every question opened after it.
 */

import { useState } from 'react';

import { api } from '../lib/api.js';
import { Chip } from '../ui/index.jsx';

import '../styles/material8.css';

let routeMissing = false;

/** The quiet mark on a question's row while it is kept for rooms. */
export function RoomsOnlyChip({ q }) {
  if (q?.roomsOnly !== true) return null;
  return <Chip className="chip-line" title="The Learning Hub never offers this question. Rooms serve it as usual.">Rooms only</Chip>;
}

/**
 * @param q          the question as the bank reads it
 * @param onChanged  read the bank again (the row's chip follows)
 */
export default function RoomsOnly({ q, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const [hidden, setHidden] = useState(routeMissing);
  // What the server said last wins over the bank read until the read catches up.
  const [on, setOn] = useState(null);
  if (hidden || !q?._id) return null;
  const checked = on ?? q.roomsOnly === true;

  const flip = async (next) => {
    setBusy(true);
    setSaid(null);
    try {
      const res = await api.setRoomsOnly(q._id, next);
      setOn(res?.roomsOnly ?? next);
      setSaid({ text: res?.message ?? '' });
      await onChanged?.();
    } catch (err) {
      if (err?.status === 404) { routeMissing = true; setHidden(true); return; }
      setSaid({ tone: 'bad', text: err?.message || 'The server did not answer.' });
    } finally {
      setBusy(false);
    }
  };

  const hintId = `m8-rooms-${q._id}`;
  return (
    <div className="m8-rooms">
      {/* The ui Switch's look, with the sentence under it as its description. */}
      <label className="m8-rooms-row">
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={checked ? 'true' : 'false'}
          aria-describedby={hintId}
          disabled={busy}
          onClick={() => flip(!checked)}
        />
        Rooms only
        {busy && <span className="spinner" aria-hidden="true" />}
      </label>
      <p id={hintId} data-said={said ? 'true' : undefined} data-tone={said?.tone} role="status">
        {said?.text || (checked
          ? 'Kept for rooms: the Learning Hub does not offer it in practice, lessons, self-tests, Get Ready or the error log.'
          : 'Shared: rooms and the Learning Hub both use it. Switch on to keep it for rooms only.')}
      </p>
    </div>
  );
}
