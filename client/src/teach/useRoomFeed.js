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
 *
 * Phase 3: a class room's grid also carries `attendance`, a waiting room's
 * `waiting`, and a Mixed or Teacher-led room's `feed`; they are handed on as
 * `room` exactly as the server sent them, null when absent. `insights` is the
 * last `teacher:insights` push (the body of GET /:code/insights), null until
 * the first arrives. None of it is for a phone or the projector.
 */

import { useEffect, useRef, useState } from 'react';

import { api, socketCredentials } from '../lib/api.js';
import { connect, EV, stillTrying } from '../lib/socket.js';

const NO_ROOM = { attendance: null, waiting: null, feed: null };
const roomOf = (p) => ({ attendance: p.attendance ?? null, waiting: p.waiting ?? null, feed: p.feed ?? null });

export default function useRoomFeed(code) {
  const [rows, setRows] = useState([]);
  const [room, setRoom] = useState(NO_ROOM);
  const [insights, setInsights] = useState(null);
  // Phase 5: the latest `teacher:class-question` body (counts only), pushed
  // after every change of state and at most once a second after votes.
  const [classQuestion, setClassQuestion] = useState(null);
  // Batch 8: the latest `teacher:teaching-move` push (a suggestion written, or
  // not), for the screen that asked; it matches it to its own requestId.
  const [teachingMove, setTeachingMove] = useState(null);
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
      setRoom(roomOf(p));
    };
    const onInsights = (p) => {
      if (!p || (p.room?.code && p.room.code !== code)) return;
      setInsights(p);
    };
    const onClassQuestion = (p) => { if (p?.id) setClassQuestion(p); };
    const onTeachingMove = (p) => {
      if (!p?.requestId || (p.code && p.code !== code)) return;
      setTeachingMove(p);
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
    socket.on('teacher:insights', onInsights);
    socket.on(EV.teacherClassQuestion, onClassQuestion);
    socket.on(EV.teachingMove, onTeachingMove);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', drop);
      socket.off('connect_error', onErr);
      socket.off(EV.grid, onGrid);
      socket.off(EV.rejected, onRefused);
      socket.off('teacher:status', onStatus);
      socket.off('teacher:insights', onInsights);
      socket.off(EV.teacherClassQuestion, onClassQuestion);
      socket.off(EV.teachingMove, onTeachingMove);
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
      (res) => {
        if (!alive || !Array.isArray(res.rows)) return;
        setRows((prev) => (prev.length ? prev : res.rows));
        // The socket's first push replaces NO_ROOM with its own object, so
        // this only fills in when the HTTP read won the race.
        setRoom((r) => (r === NO_ROOM ? roomOf(res) : r));
      },
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

  return { rows, room, insights, setInsights, classQuestion, setClassQuestion, teachingMove, wire, wireError, error, setError, downFor, retry, roomStatus, setRoomStatus };
}
