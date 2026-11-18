/**
 * The student's side of a room, mounted at /join and /join/:code.
 *
 * This file is the session: the socket, who this phone says it is, the
 * question the server has pinned to them, the answer that is held until it is
 * marked, and what the browser reports about itself. What each moment looks
 * like lives in the files beside it.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

// The dyslexia-friendly face. Only @font-face rules: the files download only
// for a student whose professor turned the support on.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import { clearDraftsFor, setDraftScope } from '../lib/draft.js';
import { useEnter } from '../lib/motion.js';
import { connect, EV, stillTrying } from '../lib/socket.js';
import { Button, Dialog, Ladder, Mark, Note } from '../ui/index.jsx';
import Finish from './Finish.jsx';
import Join from './Join.jsx';
import LevelMove from './LevelMove.jsx';
import Question from './Question.jsx';
import { Climb, Conn, Dock, DockSlot, Hold } from './parts.jsx';

const STORE_KEY = 'bloomloop:student';

/**
 * The only thing this phone is allowed to keep.
 *
 * Code + roll number IS the whole credential - there are no accounts - and
 * re-sending it is enough for the server to hand back the level, the history
 * and the exact question this student was pinned to. So nothing else goes in
 * here: no results, no levels, no history, and above all no question. A student
 * who reinstalls their browser must lose nothing that matters, and that holds
 * only while nothing that matters was ever kept here.
 *
 * Every read and write is wrapped. localStorage throws outright in private
 * mode and with storage switched off, and a student on that phone still has to
 * be able to sit the whole session: credsRef then carries the identity for the
 * life of the tab, and only the silent rejoin after a reload is lost.
 */
/**
 * A fresh idempotency key for one attempt. Reused on every resend of that
 * attempt, so the server can tell the same answer arriving twice from a new
 * one. crypto.getRandomValues, not randomUUID: the room may be served over a
 * plain-http local address, where randomUUID does not exist.
 */
function newAnswerId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `a${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Every key present, so nothing has to tell "off" from "older server". */
const NO_SUPPORTS = { readAloud: false, dyslexiaFont: false, largerText: false, highContrast: false, extraTime: false, noTimer: false };

const store = {
  read() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      // A half-written or hand-edited entry is not a credential.
      if (!v || typeof v !== 'object' || !v.code || !v.rollNo) return null;
      return {
        code: String(v.code).toUpperCase(),
        rollNo: String(v.rollNo).toUpperCase(),
        name: typeof v.name === 'string' ? v.name : '',
      };
    } catch {
      return null; // private mode, storage disabled, or unparseable
    }
  },
  write({ code, rollNo, name }) {
    try {
      // Listed field by field on purpose: whatever a caller hands over, only
      // these three can reach the disk. Enforced here, not trusted to callers.
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ code, rollNo, name: name ?? '' }));
    } catch {
      /* storage off; credsRef still carries this tab for the rest of the class */
    }
  },
  clear() {
    try { window.localStorage.removeItem(STORE_KEY); } catch { /* never readable anyway */ }
  },
};

/* ============================================================== signals ===

   What this phone may say about itself, and why it is so little.

   The ask was "make it like a proctored exam, where nobody can cheat". From
   inside a browser tab that is not on offer, and building something that looks
   like it would be the dishonest version of this feature. We cannot see the
   phone lying next to the laptop - which is how people actually cheat - or the
   person in the room, and a student who opens devtools can delete every line
   below before the first question.

   So this reports only what the browser observed about ITSELF, the server
   files it as REPORTED (cheap to fake, meaningful in volume and pattern, never
   on its own), and no screen anywhere turns it into a verdict.

   Deliberately absent and not coming back: device fingerprinting, keystroke
   capture, reading the clipboard, camera or microphone, devtools detection.
   Some do not work, some are hostile, and none survive the second device. */

// Under this, an absence is a notification banner, a rotation, a stray press of
// the lock button. Reporting those would bury the pattern that matters, and
// each one lands on the teacher's screen as "left the page".
const AWAY_FLOOR_MS = 1200;

// A window can lose and regain focus inside one gesture - a tap on the address
// bar, a keyboard opening. Let it settle before believing it.
const BLUR_SETTLE_MS = 400;

// The same kind again this soon says nothing new. Per kind, so a different
// signal is never swallowed by an unrelated one's cooldown.
const COOLDOWN_MS = { blurred: 5000, 'fullscreen-exit': 5000, paste: 1500 };

// The whole page load's allowance. The server keeps the newest 200 events per
// profile and drops the oldest - which is where the OBSERVED events live (the
// answer faster than the question could be read, the second socket). Those are
// the only ones worth believing, so a flickering window must not be able to
// push them out. This stops long before that.
const SIGNAL_BUDGET = 60;

/* The Fullscreen API across the two spellings still in the wild, never
   throwing. Safari on macOS is webkit-prefixed; Safari on iPhone has no element
   fullscreen at all, which is what `available` is for: a control that cannot
   work must not be offered, or a student on an iPhone ends up looking like they
   declined something they were never shown. */
const fs = {
  available() {
    try {
      const el = document.documentElement;
      const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled;
      return Boolean(enabled && (el.requestFullscreen || el.webkitRequestFullscreen));
    } catch {
      return false;
    }
  },
  current() {
    try { return document.fullscreenElement ?? document.webkitFullscreenElement ?? null; } catch { return null; }
  },
  enter() {
    try {
      const el = document.documentElement;
      const go = el.requestFullscreen ?? el.webkitRequestFullscreen;
      if (!go) return Promise.reject(new Error('no fullscreen here'));
      // The standard call returns a promise; the webkit one returns undefined.
      return Promise.resolve(go.call(el));
    } catch (err) {
      return Promise.reject(err);
    }
  },
  exit() {
    try {
      const go = document.exitFullscreen ?? document.webkitExitFullscreen;
      return go ? Promise.resolve(go.call(document)).catch(() => {}) : Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  },
};

export default function LearnApp() {
  const params = useParams();

  /* Read once, on the way in.
     A stored identity only counts as a resume when it is for the room this URL
     asks about. A student who follows a link to a DIFFERENT room is joining
     that room, and silently putting them back into the previous one would be
     the app lying about where they are. With no room in the URL there is
     nothing to disagree with, so the stored one stands. */
  const [boot] = useState(() => {
    const saved = store.read();
    const asked = String(params.code ?? '').trim().toUpperCase();
    return { saved, resume: saved && (!asked || asked === saved.code) ? saved : null };
  });

  const [status, setStatus] = useState('connecting');
  // 'resume' is a phase of its own and not a flag on 'join': the form must not
  // flash up for half a second before the app puts the student back in.
  const [phase, setPhase] = useState(boot.resume ? 'resume' : 'join');
  const [rejected, setRejected] = useState('');
  // The room code of a silent rejoin the server turned down, so the form can
  // explain why it is showing at all to a student who touched nothing.
  const [refusedResume, setRefusedResume] = useState('');
  const [joining, setJoining] = useState(false);
  // The two-tap way out, for the phone that is somebody else's.
  const [leaving, setLeaving] = useState(false);

  // What the join form opens with. In state and not read from storage at
  // render, because "not you" has to be able to empty it - and Join seeds its
  // own fields once, on mount, so `seed` remounts it.
  const [prefill, setPrefill] = useState(() => ({
    code: (params.code || boot.saved?.code || '').toUpperCase(),
    rollNo: boot.saved?.rollNo || '',
    name: boot.saved?.name || '',
    seed: 0,
  }));

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [item, setItem] = useState(null);
  const [picked, setPicked] = useState(null);
  const [result, setResult] = useState(null);
  // A wrong attempt the room lets the student try again: { triesLeft, detail }.
  // Not a result - nothing is marked, nothing is revealed, the options reopen.
  const [retry, setRetry] = useState(null);
  // Goes this question allows, as the server said when it served it.
  const [triesLeft, setTriesLeft] = useState(1);
  // The rendering supports the student's professor set. Only switches that
  // change how the same question is drawn; never a label on the student.
  const [supports, setSupports] = useState(NO_SUPPORTS);
  const [awaiting, setAwaiting] = useState(false);
  const [ending, setEnding] = useState('');
  // The teacher has stopped the room. Not an ending and not a disconnection:
  // the socket stays up, the profile stays put, and the question stays mounted
  // under the panel that says so.
  const [paused, setPaused] = useState(false);
  // The levels served so far, newest last: this student's own path, not a
  // fraction of a bank they will never fully see.
  const [trail, setTrail] = useState([]);

  // 'off' | 'on' | 'left'. 'left' is the calm notice after focus mode ended. A
  // state and not a toast, because a student who was mid-thought when the
  // phone dropped out of full screen should still find it there.
  const [focusMode, setFocusMode] = useState('off');
  // The browser said no. Said once, quietly, and the offer is withdrawn:
  // pressing a control that has already failed, to watch nothing happen, is how
  // a student concludes the app is broken.
  const [focusRefused, setFocusRefused] = useState(false);
  // Read once. Whether this browser can do element fullscreen is a fact about
  // the device, not the session.
  const [focusAvailable] = useState(() => fs.available());
  // Has the one sentence about what is recorded been read past yet? Never
  // written to storage: `store` holds credentials and nothing else, and being
  // told the same true thing again after a reload is the harmless direction to
  // be wrong in. Not telling somebody is the harmful one.
  const [told, setTold] = useState(false);

  const socketRef = useRef(null);
  // Seeded from storage, so the very first connect already has something to
  // rejoin with and the student never sees a form they do not need.
  const credsRef = useRef(boot.resume);
  const awaitingRef = useRef(false);
  const levelRef = useRef('understand');
  // Whether the question on screen has been scored yet. Read on resume, where
  // state from the render that submitted is not in scope.
  const resultRef = useRef(null);
  // The one submission made and not yet scored, as { questionId, response }. A
  // tap in the two seconds the wifi is down is still the student's answer, and
  // dropping it is the one thing this exists to stop. Never more than one: the
  // student cannot be on two questions at once, so a queue would only ever
  // hold stale taps.
  const pendingRef = useRef(null);
  // The id of the question on screen, so a re-serve of the same item can be
  // told apart from a new one.
  const shownIdRef = useRef('');
  // Has this phone ever been let into the room? It tells a refused credential
  // apart from a wobble mid-session.
  const acceptedRef = useRef(false);
  // Was the join now in flight made by the app and not by the student? Only
  // the app's own joins can produce a question worth calling a resume.
  const silentRef = useRef(Boolean(boot.resume));

  /* ---- signals. Refs, not state: none of it renders, and a re-render per tab
     switch would cost the student a frame for nothing. ---- */
  // Focus mode, as the fullscreenchange handler needs to read it: that handler
  // fires long after the render that set the state.
  const focusOnRef = useRef(false);
  // Did the student press our own "turn it off"? Both ways out are reported;
  // only the other one gets a notice, because telling somebody what they just
  // deliberately did is noise.
  const focusDeliberateRef = useRef(false);
  const hiddenAtRef = useRef(0);
  const hiddenSentRef = useRef(false);
  const hideTimerRef = useRef(0);
  const blurTimerRef = useRef(0);
  const budgetRef = useRef(SIGNAL_BUDGET);
  const lastSentRef = useRef({});
  const reloadSentRef = useRef(false);
  // The question a signal happened during, if there is one.
  const signalQidRef = useRef('');

  const requestNext = useCallback((force = false) => {
    if (awaitingRef.current && !force) return;
    const socket = socketRef.current;
    // Never emit into a socket that is down. socket.io buffers the packet and
    // flushes it the instant the next connection opens - ahead of the rejoin
    // sent from our own 'connect' handler - so the server would see
    // `student:next` on a socket it has no student on and answer with a
    // rejection, which throws the phone back to the join screen mid-session.
    // Nothing is lost by staying quiet: the rejoin re-serves the pinned
    // question anyway.
    if (!socket?.connected) return;
    awaitingRef.current = true;
    setAwaiting(true);
    socket.emit(EV.studentNext, {});
  }, []);

  useEffect(() => {
    const socket = connect();
    socketRef.current = socket;

    const onConnect = () => {
      setStatus('online');
      // A request in flight when the socket died is never coming back, so its
      // latch comes off here. Left on, `requestNext` would refuse to ask for
      // anything for the rest of the session.
      awaitingRef.current = false;
      setAwaiting(false);
      // The same roll number resumes the same profile, so a reconnect puts the
      // student back in without them touching the phone. A socket that comes
      // back and says nothing is one the server has forgotten: it is in no
      // room, has no student on it, and will be sent nothing.
      if (credsRef.current) {
        // A reconnect is a rejoin nobody asked for, so whatever comes back is
        // something this student was already looking at. Guarded on having been
        // in once already: a student who filled the form while the socket was
        // still opening is arriving, not returning.
        if (acceptedRef.current) silentRef.current = true;
        socket.emit(EV.studentJoin, credsRef.current);
      }
    };

    const onDown = () => {
      // Down is not the same as given up, and the phone must not say the
      // second while the first is true. `stillTrying` is false only when
      // socket.io has genuinely stopped - which, with infinite attempts, means
      // the server refused this socket and not that the wifi dropped it.
      const retrying = stillTrying(socket);
      setStatus((was) => {
        if (!retrying) return 'lost';
        // Never been up: this is still the first attempt, and calling it a
        // reconnection tells a story about a connection that never existed.
        return was === 'connecting' ? 'connecting' : 'offline';
      });
    };

    const onAccepted = (p = {}) => {
      acceptedRef.current = true;
      setJoining(false);
      setRejected('');
      setRefusedResume('');
      setEnding('');
      // A reconnect re-sends the join, and a room that was resumed while the
      // phone was off the network emits no `resumed` for it to hear. Being
      // accepted back in is the proof: the server follows this with either a
      // question or a fresh `paused`.
      setPaused(false);
      setSession(p.session || null);
      setSupports({ ...NO_SUPPORTS, ...(p.supports || {}) });
      // Drafts are kept per student per room from here on.
      setDraftScope(p.session?.code || credsRef.current?.code, credsRef.current?.rollNo || p.profile?.rollNo);
      if (p.profile) {
        setProfile(p.profile);
        levelRef.current = p.profile.workingLevel || levelRef.current;
      }
      setPhase('question');
    };

    const onRejected = (p = {}) => {
      setJoining(false);
      const tried = credsRef.current;
      // Stop the reconnect handler re-sending a credential the server already
      // refused, or a wrong code loops forever.
      credsRef.current = null;
      // Whatever was being held for this student is void along with them.
      pendingRef.current = null;
      // A refusal that arrives before this phone has ever been let in is a
      // refusal of the identity itself - a closed room, a deleted room, a roll
      // number the server will not take - and it will fail identically on every
      // future load. So the stored copy goes with it, or the phone spends the
      // rest of term silently retrying the same failure before the student can
      // type anything else. The very same event is also how the server reports
      // an answer that did not save; that is a mid-session wobble and not a bad
      // credential, and wiping a student's way back in over it would be the
      // opposite of the point.
      if (!acceptedRef.current) {
        store.clear();
        setRefusedResume(silentRef.current ? (tried?.code || '') : '');
      }
      setRejected(p.reason || 'The server would not accept that code.');
      setPhase('join');
    };

    const onQuestion = (p = {}) => {
      const id = p.question?._id ? String(p.question._id) : '';
      const held = pendingRef.current;
      // The server pins the question it last served and clears that pin the
      // moment it scores an answer for it. So being handed the SAME question
      // back is the server saying it never received the answer this phone is
      // holding - send it again. Sending it any earlier breaks it:
      // `student:answer` is refused until the server has bound this socket to
      // a student, and a question arriving is proof that it has.
      //
      // Any other question means the pin is gone: the answer did land and only
      // its result was lost, or the teacher discarded the item. Either way,
      // holding on to it would score a question the student has left.
      const resend = Boolean(held && id && held.questionId === id);
      if (resend) socket.emit(EV.studentAnswer, held);
      else pendingRef.current = null;

      // Answer locks itself on a result, on `busy` and on a held submission.
      // `busy` says the true thing for the one round trip a resend takes: this
      // answer is going in. Otherwise the latch comes off, because a question
      // arriving is the end of any wait for one.
      awaitingRef.current = resend;
      setAwaiting(resend);

      resultRef.current = null;
      setResult(null);
      setRetry(null);
      setTriesLeft(Math.max(1, Number(p.triesLeft) || 1));
      // Keep the submitted latch while a resend is in flight: the student
      // already chose this answer, and re-opening the options would invite
      // them to answer a question that is being scored as they look at it.
      setPicked(resend ? held.response : null);
      // A question being served is the room running, whatever this phone last
      // heard.
      setPaused(false);

      /* `resumed` is the server saying it re-served a question it had already
         pinned to this student. It is worth putting on screen only when the
         phone got back in BY ITSELF: somebody who has just typed their roll
         number knows they have only this second arrived, and being told they
         are back where they left off would be noise.

         The server flag is trustworthy on its own - it is set only when a pin
         was actually honoured - so silentRef is not a correction, only the
         extra condition: not "did we resume" but "is saying so useful to this
         person right now". A manual rejoin mid-question resumes truthfully and
         silently. */
      const backOn = Boolean(p.resumed) && silentRef.current;
      silentRef.current = false;

      setItem({
        question: p.question || null,
        reason: p.reason || '',
        index: Number(p.index) || 0,
        resumed: backOn,
      });
      // One entry per question served, so a question served twice - which is
      // what every reconnect mid-question is - must not add a second. Compared
      // by id and not by `resumed`, because the trail is about the item
      // changing and nothing else.
      if (p.question?.bloom && id !== shownIdRef.current) {
        setTrail((t) => [...t, p.question.bloom].slice(-9));
      }
      shownIdRef.current = id;
      setPhase('question');
    };

    const onResult = (p = {}) => {
      // The result is the server's acknowledgement of the submission, including
      // the one it replies to a resend with. Nothing is owed after this, so the
      // hold comes off and so does the wait a resend put on - nothing else is
      // coming to take it off, and left on it would refuse the next question.
      pendingRef.current = null;
      awaitingRef.current = false;
      setAwaiting(false);
      if (p.retry) {
        // Wrong, with a go left. Nothing is marked and nothing is revealed: the
        // options reopen with the student's own working still in them.
        setRetry({ triesLeft: Math.max(1, Number(p.triesLeft) || 1), detail: p.detail || '' });
        setTriesLeft(Math.max(1, Number(p.triesLeft) || 1));
        setPicked(null);
        if (p.profile) setProfile(p.profile);
        return;
      }
      setRetry(null);
      const previousLevel = levelRef.current;
      levelRef.current = p.workingLevel || previousLevel;
      if (p.profile) setProfile(p.profile);
      resultRef.current = p;
      setResult({ ...p, previousLevel });
    };

    const onExhausted = (p = {}) => {
      if (p.profile) setProfile(p.profile);
      pendingRef.current = null;
      setEnding('exhausted');
      setPhase('done');
    };
    const onClosed = () => { pendingRef.current = null; setEnding('closed'); setPhase('done'); };

    const onPaused = () => {
      // A room that stops mid-ask answers `paused` where a question would have
      // gone, so nothing is on its way and this phone is not waiting for it.
      // Saying otherwise strands the student: `requestNext` refuses to ask
      // while the latch is set, so the resume would find it still set, ask
      // nothing, and leave them on a spinner for the rest of the class.
      awaitingRef.current = false;
      setAwaiting(false);
      setPaused(true);
    };

    const onResumed = () => {
      setPaused(false);
      // An answer tapped just as the room stopped never reached the scorer: the
      // server replied `paused` in place of the result. `picked` is the latch
      // that stops a double tap scoring twice, and with no result behind it
      // that latch is stale: left set, it hands the student back a question
      // they can read and cannot answer. Their working out is untouched either
      // way, since it lives in Answer and that never unmounted.
      //
      // The held submission goes with it. The two are the same fact - "this
      // student has answered and is waiting" - and giving the answer back to
      // them while still holding a copy means a later reconnect would submit
      // the old tap over whatever they chose the second time.
      if (!resultRef.current) {
        pendingRef.current = null;
        setPicked(null);
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDown);
    socket.on('connect_error', onDown);
    socket.on(EV.accepted, onAccepted);
    socket.on(EV.rejected, onRejected);
    socket.on(EV.question, onQuestion);
    socket.on(EV.result, onResult);
    socket.on(EV.exhausted, onExhausted);
    socket.on(EV.closed, onClosed);
    socket.on(EV.paused, onPaused);
    socket.on(EV.resumed, onResumed);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDown);
      socket.off('connect_error', onDown);
      socket.off(EV.accepted, onAccepted);
      socket.off(EV.rejected, onRejected);
      socket.off(EV.question, onQuestion);
      socket.off(EV.result, onResult);
      socket.off(EV.exhausted, onExhausted);
      socket.off(EV.closed, onClosed);
      socket.off(EV.paused, onPaused);
      socket.off(EV.resumed, onResumed);
      socket.disconnect();
    };
  }, []);

  /* Both timers below stand down while the room is paused: a stopped room
     answers `paused` to every ask, so left running they would poll it every
     couple of seconds for as long as the teacher was talking. Standing down is
     also what carries the class on afterwards: `paused` going false re-runs
     them, so the phone that was waiting for a question asks again without the
     student touching it. */

  // Auto-advance, but never past the level-change screen: that one is the
  // point of the product and the student taps through it themselves.
  // `noTimer` turns it off: the next question comes when the student taps.
  // `extraTime` gives the result four times as long on screen.
  useEffect(() => {
    if (paused || !result || result.levelChanged || supports.noTimer) return undefined;
    const t = setTimeout(() => requestNext(false), supports.extraTime ? 10000 : 2500);
    return () => clearTimeout(t);
  }, [paused, result, requestNext, supports.noTimer, supports.extraTime]);

  // Safety net: if the accept lands but no item follows, ask for one and do
  // not leave a phone on a skeleton.
  useEffect(() => {
    if (paused || phase !== 'question' || item || awaiting) return undefined;
    const t = setTimeout(() => requestNext(false), 1500);
    return () => clearTimeout(t);
  }, [paused, phase, item, awaiting, requestNext]);

  /* ---------------------------------------------------------------- signals */

  /* The question actually on screen, for a signal's payload.
     Kept apart from shownIdRef, which belongs to the trail and holds its value
     after the room has ended: "this happened during question 7" has to mean
     the student was looking at question 7 when it happened. An empty string
     means no question, and the payload then leaves the field out entirely. */
  useEffect(() => {
    signalQidRef.current = phase === 'question' && item?.question?._id ? String(item.question._id) : '';
  }, [phase, item]);

  /**
   * Tell the server what the browser just observed about itself.
   *
   * Every way out of here is a no-op and never a throw, and that is the whole
   * contract: this is bolted to the side of a session, and the session is the
   * thing that matters. A student must be able to sit the entire class with
   * every call in here failing silently.
   *
   * @returns {boolean} whether it actually went, so a caller can retry.
   */
  const signal = useCallback((kind, meta = {}) => {
    try {
      // Before the server has bound a student to this socket there is nothing
      // for a signal to be about, and the server would drop it anyway.
      if (!acceptedRef.current) return false;
      const socket = socketRef.current;
      // Never into a socket that is down. socket.io buffers an emit and flushes
      // it on the next connect ahead of our own rejoin - onto a socket the
      // server has no student on, where it is dropped. Losing a signal to a
      // wifi drop is the right trade against a queue that grows for the length
      // of an outage and then lands as a burst that reads like a pattern.
      if (!socket?.connected) return false;
      if (budgetRef.current <= 0) return false;
      const at = Date.now();
      const cool = COOLDOWN_MS[kind] ?? 0;
      if (cool && at - (lastSentRef.current[kind] ?? 0) < cool) return false;
      lastSentRef.current[kind] = at;
      budgetRef.current -= 1;
      const questionId = signalQidRef.current;
      socket.emit(EV.studentSignal, { kind, ...meta, ...(questionId ? { questionId } : {}) });
      return true;
    } catch {
      return false;
    }
  }, []);

  /* What the browser can honestly say about itself, as it happens: the tab
     went away and came back, the window lost focus with the page still on
     screen, focus mode ended - and paste and reload below. Every one is
     something the browser volunteered, which is why the server files them as
     the weak class: a student who wants to suppress all five can, and the ones
     worth believing are the ones the server works out for itself. */
  useEffect(() => {
    const onVisibility = () => {
      try {
        if (document.visibilityState === 'hidden') {
          hiddenAtRef.current = Date.now();
          hiddenSentRef.current = false;
          window.clearTimeout(hideTimerRef.current);
          // Held for a moment and not sent on the spot: a page that is back
          // inside a second was never left. If the tab is frozen before this
          // fires - which a backgrounded phone will do - the return below
          // reports the absence instead, so nothing is lost by waiting.
          hideTimerRef.current = window.setTimeout(() => {
            hiddenSentRef.current = signal('hidden');
          }, AWAY_FLOOR_MS);
          return;
        }

        window.clearTimeout(hideTimerRef.current);
        const wentAt = hiddenAtRef.current;
        hiddenAtRef.current = 0;
        if (!wentAt) return;
        const awayMs = Date.now() - wentAt;
        // A flicker. Nothing is reported in either half, so the teacher's
        // count and the teacher's total stay about the same absences.
        if (awayMs < AWAY_FLOOR_MS) return;
        // The timer never got to run, so the absence is reported now, in the
        // two halves the server counts separately: `hidden` is how many times,
        // `returned` is how long.
        if (!hiddenSentRef.current) signal('hidden');
        hiddenSentRef.current = false;
        signal('returned', { awayMs });
      } catch {
        /* a signal is never worth a broken session */
      }
    };

    const onBlur = () => {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = window.setTimeout(() => {
        try {
          // Suppressed while the tab is hidden. Switching app fires blur AND
          // visibilitychange for one gesture, and reporting both would put two
          // events on the teacher's screen for one thing the student did. The
          // absence belongs to the visibility half; this half is only for a
          // window that lost focus with the page still on screen.
          if (document.visibilityState !== 'visible') return;
          // ...and only if it is still unfocused. Tapping the address bar and
          // coming straight back is not a signal about anything.
          if (typeof document.hasFocus === 'function' && document.hasFocus()) return;
          signal('blurred');
        } catch {
          /* ignore */
        }
      }, BLUR_SETTLE_MS);
    };

    // Focus coming back cancels a pending blur and reports nothing of its own.
    // There is no 'focused' on the server's allow-list and there should not
    // be: a student returning to the page is what we want, and recording it
    // would be logging attention and not absence.
    const onFocus = () => window.clearTimeout(blurTimerRef.current);

    const onFullscreen = () => {
      try {
        if (fs.current()) {
          focusOnRef.current = true;
          setFocusMode('on');
          return;
        }
        // Not our fullscreen: a video the student opened, or focus mode was
        // never on. Nothing to report and nothing to say.
        if (!focusOnRef.current) return;
        focusOnRef.current = false;
        const deliberate = focusDeliberateRef.current;
        focusDeliberateRef.current = false;
        // Reported either way, including through our own off switch. Reporting
        // only the quiet exits would make "press the off button first" a
        // bypass and the signal worthless - and the button says out loud what
        // it does, so nobody is caught by it.
        signal('fullscreen-exit');
        setFocusMode(deliberate ? 'off' : 'left');
      } catch {
        /* ignore */
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);

    return () => {
      window.clearTimeout(hideTimerRef.current);
      window.clearTimeout(blurTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
    };
  }, [signal]);

  /* A reload, once, on the way in.
     Read from the navigation timing entry and not from `beforeunload`, which
     fires on the way OUT, cannot tell a reload from a closed tab, and on a
     phone frequently does not fire at all. Retried while it has not landed,
     because the page can finish loading before the socket is up. A weak
     signal, filed with the rest of the weak ones; it is here because nothing
     else can report it. */
  useEffect(() => {
    if (reloadSentRef.current || phase !== 'question') return;
    try {
      const nav = performance.getEntriesByType?.('navigation')?.[0];
      if (nav?.type !== 'reload') { reloadSentRef.current = true; return; }
      if (signal('reload')) reloadSentRef.current = true;
    } catch {
      reloadSentRef.current = true;
    }
  }, [phase, status, signal]);

  /* A paste into an answer field.
     What is recorded is that a paste happened. Not what was pasted, not how
     long it was, not where it came from: the clipboard is never read. What a
     student has on their clipboard is their business, and knowing it would not
     make the signal any stronger than knowing it happened. */
  const onAnswerPaste = useCallback((e) => {
    try {
      const el = e?.target;
      const tag = el?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el?.isContentEditable) return;
      signal('paste');
    } catch {
      /* ignore */
    }
  }, [signal]);

  /* Focus mode. A deterrent and a nudge, and deliberately not a lock.
     No key blocking, no disabled right-click, no attempt to trap anybody: all
     three are bypassed in seconds, they break honest students on unusual
     hardware and assistive tech, and they make the product feel like it is
     fighting the person using it. What is left is the honest part - the screen
     is filled, leaving is a decision, and leaving is recorded. */
  const askFocus = useCallback(() => {
    fs.enter()
      .then(() => {
        focusOnRef.current = true;
        setFocusMode('on');
      })
      .catch(() => {
        // Refused, or unavailable on this device. It costs the student
        // nothing, and nothing about the refusal is reported: a browser that
        // will not go full screen is a fact about the phone, not the person.
        setFocusRefused(true);
        setFocusMode('off');
      });
  }, []);

  // The way out, in the open. Its existence is the proof that this is not a
  // lock; the exit it causes is reported like any other, which is why the
  // control says so before it is pressed.
  const dropFocus = useCallback(() => {
    focusDeliberateRef.current = true;
    fs.exit();
    // The flag belongs to this one exit. If no fullscreenchange arrives to
    // consume it - the browser was not really in fullscreen, or refused to
    // leave - it has to come off by itself, or the next exit the student did
    // not announce would be read as one they did and its notice swallowed.
    window.setTimeout(() => { focusDeliberateRef.current = false; }, 2000);
  }, []);

  /* Take focus mode down without reporting it.
     For the two cases where the exit is the app's doing: the room ending, and
     this phone being handed to somebody else. An exit recorded against a
     student who did not cause it is the false signal this feature is built to
     avoid, and on a shared phone it would be recorded against the wrong
     person. Clearing focusOnRef first is what does it: the change handler
     reads that ref and stands down. */
  const closeFocus = useCallback(() => {
    focusOnRef.current = false;
    focusDeliberateRef.current = false;
    setFocusMode('off');
    fs.exit();
  }, []);

  // The room ended. Focus mode has nothing left to hold, and the exit when the
  // student eventually presses escape would be a signal about a session that
  // was already over.
  useEffect(() => {
    if (phase === 'done' && focusOnRef.current) closeFocus();
  }, [phase, closeFocus]);

  const join = useCallback((creds) => {
    credsRef.current = creds;
    // The student typed this, so nothing that comes back is a surprise to them.
    silentRef.current = false;
    store.write(creds);
    setPrefill((p) => ({ ...p, code: creds.code, rollNo: creds.rollNo, name: creds.name || '' }));
    setRejected('');
    setRefusedResume('');
    setJoining(true);
    const s = socketRef.current;
    if (s?.connected) s.emit(EV.studentJoin, creds);
  }, []);

  /* Drop this phone's claim to be this student.
     Nothing of theirs goes with it: the answers, the levels and the pinned
     question are all held by the server under the roll number, and typing that
     roll number again brings every one of them back. What goes is only the
     shortcut that let this browser assert the identity without being asked. */
  const forget = useCallback(() => {
    store.clear();
    credsRef.current = null;
    silentRef.current = false;
    setPrefill((p) => ({
      code: (params.code || '').toUpperCase(),
      rollNo: '',
      name: '',
      seed: p.seed + 1,
    }));
  }, [params.code]);

  /* Leave the room outright - the shared-phone case. A family phone that opens
     itself straight back into somebody else's session has to have a way out,
     or the next person is trapped answering questions aimed at their sibling
     and counted against their sibling's profile. */
  const leave = useCallback(() => {
    // This student's unfinished answers go with them, and the next person on
    // this phone gets no supports until their own professor's are known.
    clearDraftsFor(credsRef.current?.code, credsRef.current?.rollNo);
    setDraftScope('', '');
    setSupports(NO_SUPPORTS);
    setRetry(null);
    forget();
    // Everything the signals half is holding belongs to the student who is
    // leaving, so all of it goes with them: focus mode they turned on, the
    // budget they spent, the cooldowns their taps set, and the fact that they
    // were told what is recorded. The next person on this phone is a different
    // student and has to be told the same sentence themselves.
    closeFocus();
    setFocusRefused(false);
    setTold(false);
    budgetRef.current = SIGNAL_BUDGET;
    lastSentRef.current = {};
    hiddenAtRef.current = 0;
    hiddenSentRef.current = false;
    acceptedRef.current = false;
    resultRef.current = null;
    awaitingRef.current = false;
    pendingRef.current = null;
    shownIdRef.current = '';
    setLeaving(false);
    setJoining(false);
    setAwaiting(false);
    setRejected('');
    setRefusedResume('');
    setSession(null);
    setProfile(null);
    setItem(null);
    setPicked(null);
    setResult(null);
    setTrail([]);
    setPaused(false);
    setEnding('');
    setPhase('join');
    // As far as the server is concerned this socket is still in the room: its
    // presence entry keeps the old roll number lit in the teacher's grid, and
    // the next student on this phone would be sharing a connection with
    // someone else's membership. Cycling it is what makes the server let go.
    socketRef.current?.disconnect().connect();
    // Said last, and it has to be. A disconnect we asked for clears
    // socket.io's `active`, so the shared handler reads it as the socket
    // having given up and would put "the connection stopped" in front of the
    // next student while their socket is opening normally behind it.
    setStatus('connecting');
  }, [forget, closeFocus]);

  // One submit for every kind: the response is a number, an array, a string or
  // a map depending on the interaction, and the server scores it per kind.
  const submit = (response) => {
    if (picked !== null || !item?.question) return;
    setPicked(response);
    // The sentence about what is recorded has now had a whole question in
    // front of it, which is as long as it is worth keeping on screen. It goes
    // when the student has clearly moved on, not on a timer that might beat
    // them to it.
    setTold(true);
    // One key per attempt, kept on the held copy so every resend of this
    // attempt carries the same key and can never count twice.
    const answer = { questionId: String(item.question._id), response, answerId: newAnswerId() };
    setRetry(null);
    // Held before it is sent, and held until a result comes back for it. The
    // tap that lands in the second the wifi drops is the one a student would
    // never forgive us for losing, and the one they are least likely to notice
    // going: the phone locks the options either way. Re-sending it later is
    // safe because the server's double-tap guard answers a submission it has
    // already scored with the score it recorded.
    pendingRef.current = answer;
    const socket = socketRef.current;
    // Only sent over a live socket. Left to socket.io's own buffer this would
    // be flushed ahead of the rejoin on the next connect and refused for
    // arriving before it - the rejoin is what re-serves the question this
    // answer belongs to, and that is where it gets sent instead.
    if (socket?.connected) socket.emit(EV.studentAnswer, answer);
  };

  // Only reachable from the `lost` panel, where socket.io has stopped of its
  // own accord and nothing will happen unless somebody asks for it.
  const retryConnection = () => {
    setStatus('connecting');
    socketRef.current?.connect();
  };

  /* ----------------------------------------------------------------- frame */

  const level = profile?.workingLevel || levelRef.current;
  const code = session?.code || credsRef.current?.code || '';
  const rollNo = credsRef.current?.rollNo || profile?.rollNo || '';

  const moved = phase === 'question' && Boolean(result?.levelChanged);
  const view = phase === 'question' ? (moved ? 'move' : 'question') : phase;

  const root = useRef(null);
  const page = useRef(null);
  const [dock, setDock] = useState(null);
  // One arrival per screen and per question. The page's blocks are keyed by it
  // too, so each arrival is new elements: a block carried over from the last
  // screen could be left half-faded by the entrance it interrupted.
  const arrival = `${view}:${view === 'question' ? item?.question?._id ?? '' : ''}`;
  useEnter(page, arrival);

  // The page ends above the dock however tall the dock is: a button alone, or
  // a verdict and the server's sentence over it.
  useEffect(() => {
    if (!dock) return undefined;
    const measure = () => root.current?.style.setProperty('--ln-dock', `${dock.offsetHeight}px`);
    const ro = new ResizeObserver(measure);
    ro.observe(dock);
    measure();
    return () => ro.disconnect();
  }, [dock]);

  if (phase === 'join') {
    return (
      <Join
        /* Remounted when "not you" empties the fields: Join seeds its own state
           from these once, so clearing them any other way would leave the
           cleared roll number sitting in the box. */
        key={prefill.seed}
        initialCode={prefill.code}
        initialRoll={prefill.rollNo}
        initialName={prefill.name}
        remembered={Boolean(prefill.rollNo)}
        onForget={forget}
        /* Said before the server's own sentence, never instead of it. A student
           who never touched this form has to be told the app tried on its own
           and was turned down, or the refusal reads as a complaint about
           something they just did. */
        lead={refusedResume ? `We tried to put you straight back into room ${refusedResume}.` : ''}
        busy={joining}
        /* A socket that has stopped retrying is the reason Join will not work,
           and the only connection state worth interrupting this screen for. */
        error={rejected || (status === 'lost' ? 'The connection to the server stopped. Reload this page to try again.' : '')}
        status={status}
        onJoin={join}
      />
    );
  }

  /* What the session is waiting on, if anything. Each of these covers the page
     and leaves it mounted: Answer holds a half-built answer in its own state,
     so swapping the question out would hand back a blank one afterwards. */
  let hold = null;
  if (phase !== 'done' && status === 'offline') {
    // A submission that has not been scored is the one thing a student would
    // be right to worry about here, so it is the one thing this answers.
    const inFlight = picked !== null && !result;
    hold = (
      <Hold title="Reconnecting">
        {inFlight
          ? 'Your answer is held on this phone and goes in the moment you are back. You do not have to tap it again. Everything before it is saved.'
          : 'Every answer you have given is saved. You will come back in on your own. There is nothing to tap.'}
      </Hold>
    );
  } else if (phase !== 'done' && status === 'lost') {
    // The socket has stopped trying, which with infinite attempts means the
    // server refused it. The one connection state that is a real error, so the
    // one that gets a button.
    hold = (
      <Hold
        icon="alert"
        title="The connection stopped"
        action={<Button variant="primary" size="lg" icon="refresh" onClick={retryConnection}>Try again</Button>}
      >
        Nothing you have done is lost: every answer is on the server, and so is the question you are on. Try again,
        and if it will not come back, tell your teacher the room dropped you.
      </Hold>
    );
  } else if (paused && phase === 'question') {
    hold = (
      <Hold icon="pause" title="Your teacher paused the room">
        Nothing is lost. Every answer is saved, and so is the question you are on. When the class starts again you
        carry on from here. There is nothing to tap and no reason to leave this page.
      </Hold>
    );
  }

  /* Focus mode, in one quiet line at the foot of the page, saying one thing at
     a time. Nothing here is an accusation, a warning or a fault, so nothing
     here gets red, an alert icon or a raised voice: leaving a page is not an
     error and must not be dressed as one. It sits on the two screens where a
     student is working and nowhere else. */
  const focusLine = (() => {
    if (focusMode === 'left') return null; // said in the notice at the top
    if (focusMode === 'on') {
      return (
        <p className="ln-focus">
          Focus mode is on.{' '}
          <button type="button" className="ln-quiet" onClick={dropFocus}>Turn it off</button>{' '}
          Turning it off is recorded, like leaving the page.
        </p>
      );
    }
    /* Said once and then left alone. A student whose phone refuses full screen
       has done nothing, so they are told that plainly and the control goes. */
    if (focusRefused) {
      return <p className="ln-focus">This browser would not go full screen. Nothing about your session changes.</p>;
    }
    // No fullscreen on this device at all - an iPhone, most likely. A control
    // that cannot work is not offered.
    if (!focusAvailable) return null;
    return (
      <p className="ln-focus">
        <button type="button" className="ln-quiet" onClick={askFocus}>Turn on focus mode</button>{' '}
        Fills the screen. Leave it whenever you like.
      </p>
    );
  })();

  const focusLeft = focusMode === 'left' && (
    <Note role="status">
      Focus mode ended, and your teacher can see that it did. It is not an accusation and nothing you answered has
      changed.
      <span className="cluster cluster-4 ln-note-acts">
        <button type="button" className="ln-quiet" onClick={askFocus}>Turn it back on</button>
        <button type="button" className="ln-quiet" onClick={() => setFocusMode('off')}>Hide this</button>
      </span>
    </Note>
  );

  return (
    <DockSlot.Provider value={dock}>
      <div
        className="learn"
        ref={root}
        data-view={view}
        data-dyslexia={supports.dyslexiaFont ? 'true' : undefined}
        data-large={supports.largerText ? 'true' : undefined}
        data-contrast={supports.highContrast ? 'true' : undefined}
      >
        <header className="ln-bar">
          <div className="ln-bar-in">
            <Mark size={30} />
            <span className="ln-room">
              <span className="sr-only">Room </span><b>{code}</b>
            </span>
            <span className="ln-who"><span className="sr-only">Roll number </span>{rollNo}</span>
            <span className="push"><Conn status={status} /></span>
            {/* While picking up, and at the end, the way out is the page's own
                button, so the identity is only a label. Everywhere else this
                is the control: the line saying who the server thinks you are
                is where somebody who is not that person will look. */}
            {(view === 'question' || view === 'move') && (
              <Button variant="ghost" size="sm" onClick={() => setLeaving(true)}>Not me</Button>
            )}
          </div>
        </header>

        {/* Where this student is working, across the top of every question. */}
        {view === 'question' && <Climb level={level} />}

        <main
          className="ln-page"
          ref={page}
          data-view={view}
          inert={hold ? '' : undefined}
          /* One listener here and not one per field: paste bubbles, so this
             catches every kind that has a box to type in. It catches nothing on
             the join screen, where a pasted roll number is somebody being
             sensible. */
          onPaste={view === 'question' ? onAnswerPaste : undefined}
        >
          <Fragment key={arrival}>
            {/* The silent rejoin, while it is happening. Usually gone inside a
                second, which is why it says what it is doing: an unexplained
                wait on a page opened expecting a form is how a student concludes
                the session broke and starts tapping things. */}
            {view === 'resume' && (
              <>
                <div className="ln-seek" aria-hidden="true">
                  <Ladder size={56} />
                </div>
                <div className="ln-card">
                  <span className="eyebrow">Picking you back up</span>
                  <h1 className="ln-text">You are already in room <span className="mono">{code}</span>.</h1>
                  <p className="t-lead">
                    You are in as <span className="mono">{rollNo}</span>. Your level, your answers and the question you
                    were on are held by the server, not by this phone, so closing the tab changed nothing. This is the
                    session you left, not a new one.
                  </p>
                </div>
                {/* Acts at once, unlike the one in the bar: there is nothing on
                    this screen to lose, and making somebody confirm that they
                    are not the person named above is a gate with nothing behind
                    it. */}
                <Dock>
                  <Button size="xl" block icon="logout" onClick={leave}>Not me, join as someone else</Button>
                </Dock>
              </>
            )}

            {view === 'done' && <Finish profile={profile} ending={ending} onLeave={leave} />}

            {view === 'move' && (
              <>
                {focusLeft}
                <LevelMove result={result} busy={awaiting} onNext={() => requestNext(true)} />
                {focusLine}
              </>
            )}

            {view === 'question' && (
              <>
                {(!told || focusLeft || (item?.resumed && !result)) && (
                  <div className="ln-notes">
                    {/* Told once, plainly, at the start: information and not a
                        warning, in the block the product uses for everything
                        else it tells a student. It is here at all because
                        surveillance a student has not been told about is the
                        indefensible version of this feature. */}
                    {!told && (
                      <Note icon="eye" role="status">
                        This session records when the page loses focus. Your teacher can see it.
                      </Note>
                    )}
                    {focusLeft}
                    {/* Said once, about the question it is about, and gone when
                        that question is answered. A student who dropped
                        mid-question and came back to the same wording needs
                        telling it IS the same question, or being asked twice
                        reads as the app having lost count of them. */}
                    {item?.resumed && !result && (
                      <Note icon="refresh" role="status">
                        This is the question you were already on. You are not being asked it twice, and everything you
                        answered before it still counts.
                      </Note>
                    )}
                  </div>
                )}
                <Question
                  item={item}
                  result={result}
                  awaiting={awaiting}
                  sent={picked}
                  level={level}
                  trail={trail}
                  auto={Boolean(result) && !paused && !supports.noTimer}
                  retry={retry}
                  triesLeft={triesLeft}
                  readAloud={supports.readAloud}
                  foot={focusLine}
                  onSubmit={submit}
                  onNext={requestNext}
                />
              </>
            )}
          </Fragment>
        </main>

        {hold}

        {/* The one action. Whichever screen has it renders into this. */}
        <footer className="ln-dock" ref={setDock} inert={hold ? '' : undefined} />

        {/* Leaving takes two taps, and the second says what leaving does. A
            dialog over the page, so a student who got here with a stray thumb
            and backs out still has the sentence they were half way through. */}
        <Dialog
          open={leaving}
          onOpenChange={setLeaving}
          title={`Leave room ${code}?`}
          description={`Everything ${rollNo} has answered is on the server, not on this phone, so nothing is thrown away. Joining again with the same roll number carries on from here. Leave if this phone is going to somebody else.`}
        >
          <div className="stack stack-2">
            <Button variant="primary" size="lg" block onClick={() => setLeaving(false)}>Stay in the room</Button>
            <Button size="lg" block onClick={leave}>Leave and forget me on this phone</Button>
          </div>
        </Dialog>
      </div>
    </DockSlot.Provider>
  );
}
