/**
 * Drawing a student to answer out loud.
 *
 * The pick is one uniform draw from the operating system's random source, made
 * before the drum turns; the drum only shows it arriving. Everyone gets one
 * turn before anyone gets a second: a drawn student leaves the drum until it
 * is empty, and then it refills.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import Drum from '../fx/Drum.jsx';
import { Button, Dialog, Level } from '../ui/index.jsx';

/** A uniform integer in [0, n). Rejection sampling: a bare modulo favours low indices. */
function drawIndex(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

export default function Draw({ open, onOpenChange, rows, onOpen }) {
  const [done, setDone] = useState([]);           // roll numbers already drawn
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [pool, setPool] = useState([]);           // who is in the drum for this draw
  const [winner, setWinner] = useState(null);
  const [turning, setTurning] = useState(false);
  const drum = useRef(null);

  const anyOnline = rows.some((r) => r.online);
  const eligible = useMemo(() => {
    const base = onlineOnly && anyOnline ? rows.filter((r) => r.online) : rows;
    const fresh = base.filter((r) => !done.includes(r.rollNo));
    return fresh.length ? fresh : base;            // everyone has had a turn: refill
  }, [rows, onlineOnly, anyOnline, done]);

  // The drum holds the eligible students whenever it is at rest with nothing
  // drawn. While it turns, and while a result is showing, it must not change.
  const eligibleKey = eligible.map((r) => `${r.rollNo}:${r.workingLevel}`).join('|');
  useEffect(() => {
    if (open && !turning && !winner) setPool(eligible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eligibleKey, turning, winner]);

  const balls = useMemo(() => pool.map((r) => ({ id: r.rollNo, level: r.workingLevel })), [pool]);

  async function draw(from) {
    if (!from.length || turning) return;
    const picked = from[drawIndex(from.length)];   // the pick, made here and nowhere else
    setWinner(null);
    setPool(from);
    setTurning(true);
    // Let the drum take the new contents before it is asked to turn.
    await new Promise((r) => setTimeout(r, 60));
    await drum.current?.draw(picked.rollNo, picked.workingLevel);
    setTurning(false);
    setWinner(picked);
    setDone((d) => (d.includes(picked.rollNo) ? [picked.rollNo] : [...d, picked.rollNo]));
  }

  const again = () => { setWinner(null); draw(eligible); };
  const close = (v) => { if (!v) setWinner(null); onOpenChange(v); };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      locked={turning}
      wide
      title="Draw a student"
      description="One draw, every student equally likely. Nobody is drawn twice until everyone has had a turn."
    >
      {rows.length === 0 ? (
        <p className="muted">Nobody has joined the room yet, so there is nobody to draw.</p>
      ) : (
        <div className="draw">
          {open && <Drum ref={drum} balls={balls} size={320} />}

          <div className="draw-side">
            <div className="draw-result" aria-live="polite">
              {winner ? (
                <>
                  <span className="t-meta">Drawn</span>
                  <b className="mono">{winner.rollNo}</b>
                  {winner.name && <span className="t-lead">{winner.name}</span>}
                  <Level level={winner.workingLevel} size="lg" style={{ marginTop: 12 }} />
                </>
              ) : (
                <>
                  <span className="t-meta">{turning ? 'Drawing' : 'In the drum'}</span>
                  <b className="mono">{pool.length}</b>
                  <span className="t-lead">
                    {pool.length === 1 ? 'student' : 'students'}
                    {done.length > 0 && pool.length < rows.length ? `, ${done.length} already drawn` : ''}
                  </span>
                </>
              )}
            </div>

            {anyOnline && (
              <label className="check">
                <input type="checkbox" checked={onlineOnly} disabled={turning} onChange={(e) => { setWinner(null); setOnlineOnly(e.target.checked); }} />
                Only students connected right now
              </label>
            )}

            <div className="cluster" style={{ marginTop: 'auto' }}>
              {winner ? (
                <>
                  <Button variant="primary" size="lg" icon="refresh" onClick={again}>Draw another</Button>
                  <Button size="lg" onClick={() => { onOpen?.(winner.rollNo); setWinner(null); onOpenChange(false); }}>Open their record</Button>
                </>
              ) : (
                <Button variant="primary" size="lg" icon="draw" busy={turning} disabled={!pool.length} onClick={() => draw(eligible)}>
                  {turning ? 'Drawing' : 'Draw'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
