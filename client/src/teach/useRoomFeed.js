/**
 * The live roster of one room, and the state of the wire it arrives on.
 *
 * Three silences look the same on a roster that has stopped moving: the socket
 * has not opened yet, the socket is open and the class is thinking, and the
 * socket is gone. A teacher needs opposite reactions to the second and third,
 * so the wire is reported as one object whose parts cannot disagree:
 *
 *   live       connected right now
 *   everLive   has connected at least once
 *   downSince  when it dropped (ms), or null - only set after it was ever up
 *   rejoined   just came back after a drop (clears itself after a few seconds)
 *   stopped    the client has stopped retrying; retries are infinite, so this
 *              is the server refusing or hanging up, never the wifi
 *
 * Used by the live class screen and by the projector.
 */

import { useEffect, useRef, useState } from 'react';

import { api, socketCredentials } from '../lib/api.js';
import { connect, EV, stillTrying } from '../lib/socket.js';

export default function useRoomFeed(code) {
  const [rows, setRows] = useState([]);
  const [wire, setWire] = useState({ live: false, everLive: false, downSince: null, rejoined: false, stopped: false });
  const [wireError, setWireError] = useState('');
  const [error, setError] = useState('');
  const [downFor, setDownFor] = useState(0);
  // open | paused | closed, as the server last said. Pausing from the rooms
  // screen or another tab reaches this screen too.
  const [roomStatus, setRoomStatus] = useState('');
  const socketRef = useRef(null);

  useEffect(() => {
    if (!code) return undefined;
    const socket = connect();
    socketRef.current = socket;

    const onConnect = async () => {
      setWire((w) => ({ live: true, everLive: true, downSince: null, rejoined: w.downSince !== null, stopped: false }));
      setWireError('');
      // A socket carries no headers, so the watch request proves who it is in
      // the message itself.
      const creds = await socketCredentials();
      if (socket.connected) socket.emit(EV.teacherWatch, { code, ...creds });
    };
    const drop = () => setWire((w) => ({
      ...w,
      live: false,
      rejoined: false,
      stopped: !stillTrying(socket),
      downSince: w.everLive ? w.downSince ?? Date.now() : null,
    }));
    const onErr = (err) => { drop(); setWireError(err.message); };
    const onGrid = (p) => {
      if (!p || (p.code && p.code !== code)) return;
      setRows(Array.isArray(p.rows) ? p.rows : []);
    };
    const onRefused = (p) => setError(p?.reason || 'The server would not hand over this room.');
    const onStatus = (p) => {
      if (!p || (p.code && p.code !== code)) return;
      if (p.status) setRoomStatus(p.status);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', drop);
    socket.on('connect_error', onErr);
    socket.on(EV.grid, onGrid);
    socket.on(EV.rejected, onRefused);
    socket.on('teacher:status', onStatus);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', drop);
      socket.off('connect_error', onErr);
      socket.off(EV.grid, onGrid);
      socket.off(EV.rejected, onRefused);
      socket.off('teacher:status', onStatus);
      socket.close();
    };
  }, [code]);

  useEffect(() => {
    if (!wire.downSince) { setDownFor(0); return undefined; }
    const tick = () => setDownFor(Math.max(0, Math.round((Date.now() - wire.downSince) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [wire.downSince]);

  useEffect(() => {
    if (!wire.rejoined) return undefined;
    const timer = setTimeout(() => setWire((w) => ({ ...w, rejoined: false })), 6000);
    return () => clearTimeout(timer);
  }, [wire.rejoined]);

  // Read once over HTTP too, so a roster shows even if the socket is slow to
  // open. It never overwrites rows the socket has already delivered.
  useEffect(() => {
    if (!code) return undefined;
    let alive = true;
    api.getGrid(code).then(
      (res) => { if (alive && Array.isArray(res.rows)) setRows((prev) => (prev.length ? prev : res.rows)); },
      (err) => { if (alive) setError(`Could not load the roster: ${err.message}`); },
    );
    return () => { alive = false; };
  }, [code]);

  const retry = () => {
    // Cleared before the attempt: trying again is trying. A second failure
    // sets it straight back.
    setWire((w) => ({ ...w, stopped: false }));
    socketRef.current?.connect();
  };

  return { rows, wire, wireError, error, setError, downFor, retry, roomStatus, setRoomStatus };
}
