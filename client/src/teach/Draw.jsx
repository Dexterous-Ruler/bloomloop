/**
 * Drawing a student to answer out loud.
 *
 * The pick is one uniform draw from the operating system's random source, made
 * before the drum turns; the drum only shows it arriving. Everyone gets one
 * turn before anyone gets a second: a drawn student leaves the drum until it
 * is empty, and then it refills.
 *
 * The drum sits on a small forest stage of its own; beside it, who is next to
 * answer, set large enough to read across the room, and the picks so far.
 * The list of picks lives as long as this page does.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import Drum from '../fx/Drum.jsx';
import { Avatar, Button, Dialog, Level, Switch } from '../ui/index.jsx';

/** A uniform integer in [0, n). Rejection sampling: a bare modulo favours low indices. */
function drawIndex(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const nth = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export default function Draw({ open, onOpenChange, rows, onOpen }) {
  const [done, setDone] = useState([]);           // roll numbers already drawn
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [pool, setPool] = useState([]);           // who is in the drum for this draw
  const [winner, setWinner] = useState(null);
  const [turning, setTurning] = useState(false);
  const [picks, setPicks] = useState([]);         // every pick while this page is open, newest first
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
    setPicks((p) => [{ rollNo: picked.rollNo, name: picked.name, level: picked.workingLevel, at: Date.now() }, ...p]);
  }

  const again = () => { setWinner(null); draw(eligible); };
  const close = (v) => { if (!v) setWinner(null); onOpenChange(v); };
  const openRecord = (rollNo) => { onOpen?.(rollNo); setWinner(null); onOpenChange(false); };
  const timesDrawn = (rollNo) => picks.filter((p) => p.rollNo === rollNo).length;

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
        <div className="dr">
          <div className="dr-stage on-panel" data-turning={turning ? 'true' : undefined}>
            <span className="dr-rays" aria-hidden="true" />
            {open && <Drum ref={drum} balls={balls} size={300} />}
            <span className="dr-pool">
              <b className="mono">{pool.length}</b> in the drum
              {done.length > 0 && pool.length < rows.length ? `, ${done.length} already drawn` : ''}
            </span>
          </div>

          <div className="dr-side">
            <div className="dr-result" aria-live="polite" data-won={winner ? 'true' : undefined}>
              {winner ? (
                <>
                  <span className="eyebrow">Next to answer</span>
                  <b className="dr-roll mono">{winner.rollNo}</b>
                  <div className="dr-who">
                    <Avatar name={winner.name || winner.rollNo} size="lg" />
                    <div className="grow">
                      <b className="clip">{winner.name || winner.rollNo}</b>
                      <span>
                        {nth(picks.length)} pick this session
                        {timesDrawn(winner.rollNo) > 1 ? `, drawn ${timesDrawn(winner.rollNo)} times` : ''}
                      </span>
                    </div>
                    <Level level={winner.workingLevel} size="lg" />
                  </div>
                </>
              ) : (
                <>
                  <span className="eyebrow">{turning ? 'Drawing' : 'Ready to draw'}</span>
                  <b className="dr-roll dr-roll-wait mono">{turning ? '· · ·' : pool.length}</b>
                  <span className="dr-wait-sub">
                    {turning ? 'The pick is already made. The drum is showing it.' : `${pool.length === 1 ? 'student' : 'students'} in the drum, equally likely`}
                  </span>
                </>
              )}
            </div>

            {anyOnline && (
              <label className="dr-toggle">
                <Switch
                  checked={onlineOnly}
                  disabled={turning}
                  label="Only students connected right now"
                  onChange={(v) => { setWinner(null); setOnlineOnly(v); }}
                />
                <span>Only students connected right now</span>
              </label>
            )}

            <div className="cluster">
              {winner ? (
                <>
                  <Button variant="primary" size="lg" icon="refresh" onClick={again}>Draw another</Button>
                  <Button size="lg" onClick={() => openRecord(winner.rollNo)}>Open their record</Button>
                </>
              ) : (
                <Button variant="primary" size="lg" icon="draw" busy={turning} disabled={!pool.length} onClick={() => draw(eligible)}>
                  {turning ? 'Drawing' : 'Draw'}
                </Button>
              )}
            </div>

            <div className="dr-hist">
              <div className="dr-hist-h">
                <h3>Picks this session</h3>
                <span className="t-meta">{picks.length ? `${picks.length} so far` : 'none yet'}</span>
              </div>
              {picks.length ? (
                <ol>
                  {picks.map((p, i) => (
                    <li key={`${p.at}-${p.rollNo}`}>
                      <button type="button" disabled={turning} onClick={() => openRecord(p.rollNo)} aria-label={`Open the record of ${p.rollNo}`}>
                        <span className="dr-hist-n mono">{picks.length - i}</span>
                        <b className="mono">{p.rollNo}</b>
                        <span className="clip">{p.name || ''}</span>
                        <Level level={p.level} />
                        <time className="mono">{CLOCK.format(p.at)}</time>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="hint">Each pick is listed here, newest first, so the class can see it went round fairly.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
