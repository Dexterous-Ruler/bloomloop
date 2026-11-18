import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { connect, EV, stillTrying } from '../socket.js';
import Icon from '../ui/Icon.jsx';
import JoinCard from './JoinCard.jsx';
import QuestionCard from './QuestionCard.jsx';
import LevelChange from './LevelChange.jsx';
import DoneCard from './DoneCard.jsx';

const STORE_KEY = 'bloomloop:student';

// What the dot at the top of the phone is allowed to say. Only one of these four
// is an error: `offline` is the socket working on it, `lost` is the socket
// having stopped, and telling a student the second thing while the first is true
// teaches them to close the tab in the middle of a session that was fine.
const CONNECTION_WORD = {
  connecting: 'connecting',
  online: 'online',
  offline: 'reconnecting',
  lost: 'no connection',
};

/**
 * The only thing this phone is allowed to keep.
 *
 * Code + roll number IS the whole credential - there are no accounts - and
 * re-sending it is enough for the server to hand back the level, the history and
 * the exact question this student was pinned to. So nothing else goes in here:
 * no results, no levels, no history, and above all no question. A student who
 * reinstalls their browser must lose nothing that matters, and that is only true
 * for as long as nothing that matters was ever kept here.
 *
 * Every read and write is wrapped, the way api.js wraps the teacher key.
 * localStorage throws outright in private mode and on a phone with storage
 * switched off, and a student on that phone still has to be able to sit the
 * whole session - when it throws, credsRef carries the identity for the life of
 * the tab instead and only the silent rejoin after a reload is lost.
 */
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
      // Listed field by field on purpose. Whatever a caller hands over, only
      // these three can ever reach the disk - the rule is enforced in one place
      // rather than trusted to every call site that will ever exist.
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

   What this phone is allowed to say about itself, and why it is so little.

   The ask was "make it like the AWS exams, where nobody can cheat". From inside
   a browser tab that is not on offer, and building something that looks like it
   is would be the dishonest version of this feature. We cannot see the phone
   lying next to the laptop — which is how people actually cheat — or the person
   in the room, or a tool built to stay invisible to the page, and a student who
   opens devtools can delete every line below before the first question.

   So this reports only what the browser genuinely observed about ITSELF, the
   server files it as REPORTED (cheap to fake, meaningful in volume and pattern,
   never on its own), and no screen anywhere turns it into a verdict.

   Deliberately absent and not coming back: device fingerprinting, keystroke
   capture, reading the clipboard, camera or microphone, devtools detection.
   Some of those do not work, some are hostile, and none of them survive the
   second device — so all of them are cost with no security in return. */

// Under this, an absence is a notification banner, a rotation, an accidental
// press of the lock button. Reporting those would bury the pattern that matters
// under noise the student never chose to make, and every one of them lands on
// the teacher's screen as "left the page".
const AWAY_FLOOR_MS = 1200;

// A window can lose and regain focus inside one gesture — a tap on the address
// bar, a keyboard opening over the page. Let it settle before believing it.
const BLUR_SETTLE_MS = 400;

// The same kind again this soon says nothing the first one did not. This is the
// "flickering window must not emit fifty events" rule, per kind, so a genuinely
// different signal is never swallowed by an unrelated one's cooldown.
const COOLDOWN_MS = { blurred: 5000, 'fullscreen-exit': 5000, paste: 1500 };

// The whole page load's allowance.
//
// The server keeps the newest 200 events per profile and drops the oldest — and
// the oldest are where the OBSERVED events live, the answer that arrived faster
// than the question could be read, the second socket. Those are the only ones
// worth believing, so a phone with a flickering window must not be able to push
// them out of the profile. This stops long before that, and long after the
// point where more of the same says anything new.
const SIGNAL_BUDGET = 60;

/* The Fullscreen API across the two spellings still in the wild, never throwing.
   Safari on macOS is webkit-prefixed; Safari on iPhone has no element
   fullscreen at all, which is what `available` is for. A control that cannot
   work must not be offered — a student on an iPhone must never end up looking
   like they declined something they were never shown. */
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

export default function StudentApp() {
  const params = useParams();

  /* Read once, on the way in.
     A stored identity only counts as a resume when it is for the room this URL
     is asking about. A student who follows a link to a DIFFERENT room is a
     student joining that room, and silently putting them back into the previous
     one would be the app lying about where they are. With no room in the URL
     there is nothing for it to disagree with, so the stored one stands. */
  const [boot] = useState(() => {
    const saved = store.read();
    const asked = String(params.code ?? '').trim().toUpperCase();
    return { saved, resume: saved && (!asked || asked === saved.code) ? saved : null };
  });

  const [status, setStatus] = useState('connecting');
  // 'resume' is a phase of its own rather than a flag on 'join': the join form
  // must not flash up for half a second before the app puts the student back in.
  const [phase, setPhase] = useState(boot.resume ? 'resume' : 'join');
  const [rejected, setRejected] = useState('');
  // The room code of a silent rejoin the server turned down, so the form can
  // explain why it is showing at all to a student who touched nothing.
  const [refusedResume, setRefusedResume] = useState('');
  const [joining, setJoining] = useState(false);
  // The two-tap way out, for the phone that is somebody else's.
  const [leaving, setLeaving] = useState(false);

  // What the join form opens with. Held in state rather than read from storage
  // at render time, because "not you" has to be able to empty it - and JoinCard
  // seeds its own fields from these once, on mount, so `seed` remounts it.
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
  const [awaiting, setAwaiting] = useState(false);
  const [ending, setEnding] = useState('');
  // The teacher has stopped the room. Not an ending and not a disconnection —
  // the socket stays up, the profile stays put, and the question on screen stays
  // mounted underneath the card that says so.
  const [paused, setPaused] = useState(false);
  // The levels served so far, newest last. The pip strip is this student's own
  // trajectory rather than a fraction of a bank they will never fully see.
  const [trail, setTrail] = useState([]);

  // 'off' | 'on' | 'left'. 'left' is the calm notice after focus mode ended,
  // and it is a state rather than a toast because a student who was mid-thought
  // when their phone dropped out of full screen should still find it there.
  const [focusMode, setFocusMode] = useState('off');
  // The browser said no. Said once, quietly, and the offer is then withdrawn: a
  // control that has already failed is not worth a second tap, and pressing it
  // again to watch nothing happen is how a student concludes the app is broken.
  const [focusRefused, setFocusRefused] = useState(false);
  // Read once. Whether this browser can do element fullscreen at all is a fact
  // about the device, not about the session, so it cannot change under us.
  const [focusAvailable] = useState(() => fs.available());
  // Has the one sentence about what is recorded been read past yet? Never
  // written to storage: `store` holds credentials and nothing else by design,
  // and being told the same true thing again after a reload is the harmless
  // direction to be wrong in. Not telling somebody is the harmful one.
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
  // The one submission that has been made and not yet scored, as
  // { questionId, response }. A tap that happens in the two seconds the wifi is
  // down is still the student's answer, and dropping it is the one thing this
  // phase exists to stop. Never more than one: the student cannot be on two
  // questions at once, so a queue would only ever hold stale taps.
  const pendingRef = useRef(null);
  // The id of the question actually on screen, so a re-serve of the same item
  // can be told apart from a new one.
  const shownIdRef = useRef('');
  // Has this phone ever been let into the room? It is what tells a refused
  // credential apart from a wobble that happened mid-session.
  const acceptedRef = useRef(false);
  // Was the join now in flight made by the app rather than by the student? Only
  // the app's own joins can produce a question worth calling a resume.
  const silentRef = useRef(Boolean(boot.resume));

  /* ---- signals. Refs, not state: none of it renders, and a re-render per tab
     switch would cost the student a frame for nothing. ---- */
  // Focus mode, as the fullscreenchange handler needs to read it — that handler
  // fires long after the render that set the state and cannot see it.
  const focusOnRef = useRef(false);
  // Did the student press our own "turn it off", or did focus mode end some
  // other way? Both are reported; only the second one gets a notice, because
  // telling somebody what they just deliberately did is noise.
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

  // The student surface is dark edge to edge. The column is capped for reading
  // width, so without this the page behind it stays the console's white margin -
  // which on a phone in a dim lecture hall is a white flash either side.
  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = 'var(--d-0)';
    return () => { document.body.style.background = previous; };
  }, []);

  const requestNext = useCallback((force = false) => {
    if (awaitingRef.current && !force) return;
    const socket = socketRef.current;
    // Never emit into a socket that is down. socket.io buffers the packet and
    // flushes it the instant the next connection opens - ahead of the rejoin
    // this component sends from its own 'connect' handler - so the server would
    // see `student:next` on a socket it has no student on and answer with a
    // rejection, which throws the phone back to the join screen mid-session.
    // Nothing is lost by staying quiet: the rejoin re-serves the pinned question
    // anyway, so there is nothing here left to ask for.
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
      // A request that was in flight when the socket died is never coming back,
      // so the latch it set has to come off here. Left on, `requestNext` would
      // refuse to ask for anything for the rest of the session.
      awaitingRef.current = false;
      setAwaiting(false);
      // TC-07: the same roll number resumes the same profile, so a reconnect
      // puts the student back in without them touching the phone. A socket that
      // comes back and says nothing is a socket the server has forgotten: it is
      // in no room, it has no student on it, and it will be sent nothing.
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
      // Down is not the same as given up, and the phone must not say the second
      // while the first is true. `stillTrying` is false only when socket.io has
      // genuinely stopped - which, with infinite attempts, means the server
      // refused this socket rather than the wifi dropping it.
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
      // refused, otherwise a wrong code loops forever.
      credsRef.current = null;
      // Whatever was being held for this student is void along with them.
      pendingRef.current = null;
      // A refusal that arrives before this phone has ever been let in is a
      // refusal of the identity itself - a closed room, a deleted room, a roll
      // number the server will not take - and it will fail identically on every
      // future load. So the stored copy goes with it, or the phone spends the
      // rest of term silently retrying the same failure before the student can
      // type anything else. The very same event is also how the server reports
      // an answer that did not save; that one is a mid-session wobble rather
      // than a bad credential, and wiping a student's way back in over it would
      // be the exact opposite of the point.
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
      // holding - send it again. Sending it any earlier than this is what breaks
      // it: `student:answer` is refused until the server has bound this socket
      // to a student, and a question arriving is proof that it has.
      //
      // Any other question means the pin is gone: the answer did land and only
      // its result was lost, or the teacher discarded the item. Either way,
      // holding on to it now would score a question the student has left.
      const resend = Boolean(held && id && held.questionId === id);
      if (resend) socket.emit(EV.studentAnswer, held);
      else pendingRef.current = null;

      // QuestionBody locks itself on a result or on `busy`, and knows nothing
      // about `picked`. So without this the student is handed their question
      // back with the options live over a submission that is already being
      // scored - every tap swallowed by the guard in `submit`, and no reason on
      // screen for why. `busy` says the true thing for the one round trip it
      // takes: this answer is going in. Otherwise the latch comes off, because a
      // question arriving is the end of any wait for one.
      awaitingRef.current = resend;
      setAwaiting(resend);

      resultRef.current = null;
      setResult(null);
      // Keep the submitted latch while a resend is in flight: the student
      // already chose this answer, and re-opening the options would invite them
      // to answer a question that is being scored as they look at it.
      setPicked(resend ? held.response : null);
      // A question being served is the room running, whatever this phone last
      // heard. Nothing else has to agree for that to be true.
      setPaused(false);

      /* `resumed` is the server saying it re-served a question it had already
         pinned to this student. It is worth putting on screen only when the
         phone got back in BY ITSELF: somebody who has just typed their roll
         number knows they have only this second arrived, and being told they are
         back where they left off would be noise.

         The server flag is now trustworthy on its own - dispatchNext() sets it
         only when it actually honoured a pin - so silentRef is no longer a
         correction, only the extra condition above: not "did we resume" but
         "is saying so useful to this person right now". It is still kept
         because a manual rejoin mid-question resumes truthfully and silently,
         and there is nothing to announce to someone who just typed their roll
         number. scripts/resume.mjs holds the server to its half. */
      const backOn = Boolean(p.resumed) && silentRef.current;
      silentRef.current = false;

      setItem({
        question: p.question || null,
        reason: p.reason || '',
        index: Number(p.index) || 0,
        resumed: backOn,
      });
      // One pip per question served, so a question served twice - which is what
      // every reconnect mid-question is - must not add a second pip. Compared by
      // id rather than by the payload's `resumed` flag, because the trail is
      // about the item changing and nothing else.
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
      // Saying otherwise strands the student: `requestNext` refuses to ask while
      // the latch is set, so the resume would find it still set, ask nothing, and
      // leave them on a spinner for the rest of the class.
      awaitingRef.current = false;
      setAwaiting(false);
      setPaused(true);
    };

    const onResumed = () => {
      setPaused(false);
      // An answer tapped just as the room stopped never reached the scorer - the
      // server replied `paused` in place of the result. `picked` is the latch
      // that stops a double tap scoring twice, and with no result behind it that
      // latch is stale: leaving it set hands the student back a question they can
      // read and cannot answer. Their working out is untouched either way, since
      // it lives in QuestionBody and that never unmounted.
      //
      // The held submission goes with it. The two are the same fact - "this
      // student has answered and is waiting" - and giving the answer back to
      // them while still holding a copy of it means a later reconnect would
      // submit the old tap over whatever they chose the second time.
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

  /* Both timers below stand down while the room is paused - a stopped room
     answers `paused` to every ask, so left running they would poll it every
     couple of seconds for as long as the teacher was talking. Standing down is
     also what carries the class on afterwards: `paused` going false re-runs
     them, so the phone that was waiting for a question asks for one again
     without the student touching it. */

  // Auto-advance, but never past the level-change screen: that one is the point
  // of the whole product and the student taps through it themselves.
  useEffect(() => {
    if (paused || !result || result.levelChanged) return undefined;
    const t = setTimeout(() => requestNext(false), 2500);
    return () => clearTimeout(t);
  }, [paused, result, requestNext]);

  // Safety net: if the accept lands but no item follows, ask for one rather
  // than leaving a phone on a spinner.
  useEffect(() => {
    if (paused || phase !== 'question' || item || awaiting) return undefined;
    const t = setTimeout(() => requestNext(false), 1500);
    return () => clearTimeout(t);
  }, [paused, phase, item, awaiting, requestNext]);

  /* ---------------------------------------------------------------- signals */

  /* The question actually on screen, for a signal's payload.
     Kept apart from shownIdRef, which belongs to the pip strip and holds its
     value after the room has ended: "this happened during question 7" has to
     mean the student was looking at question 7 when it happened, not that they
     were at some point. An empty string means no question, and the payload
     leaves the field out entirely rather than claiming one. */
  useEffect(() => {
    signalQidRef.current = phase === 'question' && item?.question?._id ? String(item.question._id) : '';
  }, [phase, item]);

  /**
   * Tell the server what the browser just observed about itself.
   *
   * Every way out of here is a no-op rather than a throw, and that is the whole
   * contract: this is bolted to the side of a session, and the session is the
   * thing that matters. A student must be able to sit the entire class with
   * every call in here failing silently and never know it happened.
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
      // it on the next connect ahead of this component's own rejoin — onto a
      // socket the server has no student on, where it is dropped. Losing a
      // signal to a wifi drop is the right trade against a queue that grows for
      // the length of an outage and then lands as a burst that reads like a
      // pattern to whoever opens the profile.
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

  /* What the browser can honestly say about itself, as it happens.
     Three things here — the tab went away and came back, the window lost focus
     with the page still on screen, focus mode ended — and paste and reload
     below. Every one of them is something the browser volunteered about itself,
     which is exactly why the server files them as the weak class: a student who
     wants to suppress all five can, and the ones worth believing are the ones
     the server works out for itself at the other end. */
  useEffect(() => {
    const onVisibility = () => {
      try {
        if (document.visibilityState === 'hidden') {
          hiddenAtRef.current = Date.now();
          hiddenSentRef.current = false;
          window.clearTimeout(hideTimerRef.current);
          // Held for a moment rather than sent on the spot: a page that is back
          // inside a second was never left. If the tab is frozen before this
          // fires — which a backgrounded phone will do — the return below
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
        // A flicker. Nothing is reported in either half, so the teacher's count
        // and the teacher's total stay about the same absences.
        if (awayMs < AWAY_FLOOR_MS) return;
        // The timer never got to run, so the absence is reported now instead —
        // in the two halves the server counts separately: `hidden` is how many
        // times, `returned` is how long.
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
          // visibilitychange for one single gesture, and reporting both would
          // put two events on the teacher's screen for one thing the student
          // did. The absence belongs to the visibility half; this half is only
          // for a window that lost focus with the page still on screen — a
          // second window over the top of it, or another app beside it.
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
    // There is no 'focused' on the server's allow-list and there should not be:
    // a student returning to the page is the thing we want them to do, and
    // recording it would be logging attention rather than absence.
    const onFocus = () => window.clearTimeout(blurTimerRef.current);

    const onFullscreen = () => {
      try {
        if (fs.current()) {
          focusOnRef.current = true;
          setFocusMode('on');
          return;
        }
        // Not our fullscreen: a video the student opened, or focus mode was
        // never on. Nothing to report and nothing to say about it.
        if (!focusOnRef.current) return;
        focusOnRef.current = false;
        const deliberate = focusDeliberateRef.current;
        focusDeliberateRef.current = false;
        // Reported either way, including when the student used our own off
        // switch. Reporting only the quiet exits would make "press the off
        // button first" a bypass and the signal worthless — and the button says
        // out loud what it does, so nobody is caught by it.
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
     Read from the navigation timing entry rather than from `beforeunload`,
     because that one fires on the way OUT, cannot tell a reload from a student
     closing the tab, and on a phone frequently does not fire at all. Retried
     while it has not landed, because the page can easily finish loading before
     the socket is up. It is a weak signal and the server files it with the rest
     of the weak ones; it is here because nothing else can report it. */
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
     long it was, not where it came from — the clipboard is never read. What a
     student has on their clipboard is their business, it is regularly something
     private that has nothing to do with this room, and knowing it would not
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
     There is no key blocking, no disabled right-click and no attempt to trap
     anybody in here: all three are bypassed in seconds by anyone who wants to,
     they break honest students on unusual hardware and assistive tech, and they
     make the product feel like it is fighting the person using it. What is left
     is the honest part — the screen is filled, leaving is a decision, and
     leaving is recorded. */
  const askFocus = useCallback(() => {
    fs.enter()
      .then(() => {
        focusOnRef.current = true;
        setFocusMode('on');
      })
      .catch(() => {
        // Refused, or unavailable on this device. It costs the student nothing:
        // a session without focus mode is the same session, and nothing about
        // the refusal is reported — a browser that will not go full screen is a
        // fact about the phone, not about the person holding it.
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
    // The flag belongs to this one exit and nothing else. If no fullscreenchange
    // arrives to consume it — the browser was not really in fullscreen, or it
    // refused to leave — it has to come off by itself, or the next exit the
    // student did not announce would be read as one they did and its notice
    // would be swallowed.
    window.setTimeout(() => { focusDeliberateRef.current = false; }, 2000);
  }, []);

  /* Take focus mode down without reporting it.
     For the two cases where the exit is the app's doing and not the student's:
     the room ending, and this phone being handed to somebody else. An exit
     recorded against a student who did not cause it is precisely the false
     signal this whole feature is built to avoid, and on a shared phone it would
     be recorded against the wrong person entirely. Clearing focusOnRef first is
     what does it: the change handler reads that ref and stands down. */
  const closeFocus = useCallback(() => {
    focusOnRef.current = false;
    focusDeliberateRef.current = false;
    setFocusMode('off');
    fs.exit();
  }, []);

  // The room ended. Focus mode has nothing left to hold, and the exit whenever
  // the student eventually presses escape would be a signal about a session
  // that was already over.
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
     itself straight back into somebody else's session has to have a way out of
     it, or the next person is trapped answering questions aimed at their
     sibling and counted against their sibling's profile. */
  const leave = useCallback(() => {
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
    // the next student on this phone would be sharing a connection with someone
    // else's membership. Cycling it is what makes the server let go - the
    // disconnect handler drops the presence entry and rebroadcasts the grid.
    socketRef.current?.disconnect().connect();
    // Said last, and it has to be. A disconnect we asked for clears socket.io's
    // `active`, so the shared handler reads it as the socket having given up and
    // would put "the connection stopped" in front of the next student while this
    // one's socket is opening perfectly normally behind it.
    setStatus('connecting');
  }, [forget, closeFocus]);

  // One submit for every kind: the response is a number, an array of numbers or
  // a string depending on the interaction, and the server scores it per kind.
  const submit = (response) => {
    if (picked !== null || !item?.question) return;
    setPicked(response);
    // The sentence about what is recorded has now had a whole question in front
    // of it, which is as long as it is worth keeping on screen. Said once, and
    // it goes when the student has clearly moved on rather than on a timer that
    // might beat them to it.
    setTold(true);
    const answer = { questionId: String(item.question._id), response };
    // Held before it is sent, and held until a result comes back for it. The tap
    // that lands in the second the wifi drops is the one a student would never
    // forgive us for losing, and it is also the one they are least likely to
    // notice going: the phone locks the options either way. Re-sending it later
    // is safe because the server's double-tap guard answers a submission it has
    // already scored with the score it recorded, rather than scoring it twice -
    // which makes dropping it, not repeating it, the wrong move.
    pendingRef.current = answer;
    const socket = socketRef.current;
    // Only sent over a live socket. Left to socket.io's own buffer this would be
    // flushed ahead of the rejoin on the next connect and refused for arriving
    // before it - the rejoin is what re-serves the question this answer belongs
    // to, and that is where it gets sent instead.
    if (socket?.connected) socket.emit(EV.studentAnswer, answer);
  };

  // Only ever reachable from the `lost` screen, where socket.io has stopped of
  // its own accord and nothing is going to happen unless somebody asks for it.
  const retryConnection = () => {
    setStatus('connecting');
    socketRef.current?.connect();
  };

  const level = profile?.workingLevel || levelRef.current;
  const code = session?.code || credsRef.current?.code || '';
  const rollNo = credsRef.current?.rollNo || profile?.rollNo || '';

  if (phase === 'join') {
    return (
      <div className="stu dk">
        <JoinCard
          /* Remounted when "not you" empties the fields: JoinCard seeds its own
             state from these once, so clearing them any other way would leave
             the cleared roll number sitting in the box. */
          key={prefill.seed}
          initialCode={prefill.code}
          initialRoll={prefill.rollNo}
          initialName={prefill.name}
          remembered={Boolean(prefill.rollNo)}
          onForget={forget}
          /* Said before the server's own sentence, never instead of it. A
             student who never touched this form has to be told the app tried on
             its own and was turned down, or the refusal reads as a complaint
             about something they just did. */
          lead={refusedResume ? `We tried to put you straight back into room ${refusedResume}.` : ''}
          busy={joining}
          /* A socket that has stopped retrying is the reason Join will not work,
             and it is the only connection state worth interrupting this screen
             for - every other one is the dot in the bar quietly telling the
             truth while socket.io gets on with it. */
          error={rejected || (status === 'lost' ? 'The connection to the server stopped. Reload this page to try again.' : '')}
          status={status}
          onJoin={join}
        />
      </div>
    );
  }

  const header = (
    <div className="stu-bar">
      {/* On the pickup screen the way out already has a button of its own below,
          so the identity there is just a label. Everywhere else it IS the
          control: the line saying who the server thinks you are is exactly where
          somebody who is not that person will go to say so. */}
      {phase === 'resume' ? (
        <span className="id">{code} · {rollNo}</span>
      ) : (
        <button type="button" className="who" onClick={() => setLeaving(true)}>
          <span className="id">{code} · {rollNo}</span>
          <span className="not">not me</span>
        </button>
      )}
      {status === 'online' ? (
        <span className="st"><i />online</span>
      ) : (
        <span className="st down"><i />{CONNECTION_WORD[status] || 'reconnecting'}</span>
      )}
    </div>
  );

  /* Leaving takes two taps, and the second one is a whole screen that says what
     leaving does. Built on the pause overlay for the same reason that one
     exists: the question underneath stays mounted, so a student who hits this
     with a stray thumb and backs out still has the sentence they were half way
     through typing. */
  const leaveAsk = leaving ? (
    <div className="stu-hold" role="dialog" aria-modal="true" aria-label={`Leave room ${code}`}>
      <div className="change">
        <h2>Leave room {code}?</h2>
        <div className="body">
          Everything {rollNo} has answered is on the server rather than on this phone, so none of it is
          thrown away — joining again with the same roll number carries on from exactly here. Leave if
          this phone is about to be handed to somebody else.
        </div>
        <div className="stu-acts">
          <button type="button" className="btn lime" onClick={() => setLeaving(false)}>
            Stay in the room
          </button>
          <button type="button" className="btn on-d lg block" onClick={leave}>
            Leave and forget me on this phone
          </button>
        </div>
      </div>
      <div className="stu-foot">Room {code} · {rollNo}</div>
    </div>
  ) : null;

  /* S6 — the phone dropped off the network. Reuses the level-change block for
     its layout: a screen that fills the phone and says one thing.
     A submission that has not been scored yet is the one thing a student would
     be right to worry about here, so it is the one thing this screen answers. */
  if (status === 'offline' && phase !== 'done') {
    const inFlight = picked !== null && !result;
    return (
      <div className="stu dk">
        {header}
        <div className="change">
          {/* It is spinning because something really is happening: socket.io is
              retrying on a backoff behind this screen. */}
          <div className="ring" />
          <h2>Reconnecting</h2>
          <div className="body">
            {inFlight
              ? 'Your answer is held on this phone and goes in the moment you are back — you do not have to tap it again. Everything before it is already saved.'
              : 'Every answer you have given is already saved. You will come back in on your own — there is nothing to tap.'}
          </div>
        </div>
        <div className="stu-foot">Room {code} · {rollNo}</div>
        {leaveAsk}
      </div>
    );
  }

  /* The socket has stopped trying, which with infinite attempts means the server
     refused it rather than the wifi dropping it. This is the one connection
     state that is a real error, so it is the one that gets a button. */
  if (status === 'lost' && phase !== 'done') {
    return (
      <div className="stu dk">
        {header}
        <div className="change">
          <h2>The connection stopped</h2>
          <div className="body">
            Nothing you have done is lost — every answer is on the server, and so is the question you are on.
            Try again, and if it will not come back, tell your teacher the room dropped you.
          </div>
        </div>
        <button type="button" className="btn lime" onClick={retryConnection}>Try again</button>
        <div className="stu-foot">Room {code} · {rollNo}</div>
        {leaveAsk}
      </div>
    );
  }

  /* The silent rejoin, while it is happening.
     This phone remembered a room code and a roll number and is spending them
     now, without the student typing anything. It is usually gone inside a
     second, which is exactly why it says what it is doing: an unexplained wait
     on a page that was opened expecting a form is how a student concludes the
     session broke and starts tapping things. */
  if (phase === 'resume') {
    return (
      <div className="stu dk">
        {header}
        <div className="change">
          {/* Shaped like the question on its way back, because that is what is on
              its way back. A spinner would only say "something is happening",
              which is the one thing the student can already see. */}
          <div className="pickup" aria-hidden="true">
            <span className="skel" style={{ width: '38%', height: 9 }} />
            <span className="skel" style={{ width: '100%', height: 21 }} />
            <span className="skel" style={{ width: '66%', height: 21 }} />
          </div>
          <h2>Picking you back up</h2>
          <div className="body">
            You are already in room {code} as {rollNo}. Your level, every answer you have given and the
            question you were on are held by the server rather than by this phone, so closing the tab
            changed nothing. This is the session you left, not a new one.
          </div>
        </div>
        <div className="stu-acts">
          {/* Acts immediately, unlike the one in the bar: there is nothing on
              this screen to lose and no half-typed answer at risk, and making
              somebody confirm that they are not the person named above them is a
              gate with nothing behind it. */}
          <button type="button" className="btn on-d lg block" onClick={leave}>
            Not me — join as someone else
          </button>
        </div>
        <div className="stu-foot">Room {code} · {rollNo}</div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="stu dk">
        {header}
        <DoneCard profile={profile} ending={ending} />
        {leaveAsk}
      </div>
    );
  }

  /* The teacher has stopped the room.
     An overlay rather than a swap. QuestionBody owns the student's half-built
     answer - the typed sentence, the pairs tapped so far, the order placed - in
     its own state, so rendering this instead of the question would throw all of
     it away on the way in and hand back a blank one on the way out. Underneath
     this card the question is still mounted and still holds everything they had
     done to it. */
  const hold = paused ? (
    <div className="stu-hold" role="status" aria-live="polite">
      <div className="change">
        <span className="held" aria-hidden="true"><i /><i /></span>
        <h2>Your teacher paused the room</h2>
        <div className="body">
          Nothing is lost. Every answer you have given is saved, and so is the question you are on —
          when the class starts again you carry on from exactly here. There is nothing to tap and no
          reason to leave this page.
        </div>
      </div>
      <div className="stu-foot">Room {code} · {rollNo}</div>
    </div>
  ) : null;

  /* Focus mode, in one slim row, saying one thing at a time.
     Quiet on purpose. Nothing in here is an accusation, a warning or a fault,
     so nothing in here gets red, a border, an alert icon or a raised voice —
     leaving a page is not an error and must not be dressed as one. It sits on
     the two screens where a student is actually working and nowhere else. */
  const focusRow = (() => {
    if (focusMode === 'left') {
      return (
        <div className="note on-d stu-left" role="status">
          <Icon name="info" size={15} />
          <div>
            <span>
              Focus mode ended, and your teacher can see that it did. It is not an accusation and nothing
              you have answered has changed — carry on, or turn it back on.
            </span>
            <div className="acts">
              <button type="button" className="stu-quiet" onClick={askFocus}>Turn it back on</button>
              <button type="button" className="stu-quiet" onClick={() => setFocusMode('off')}>Hide this</button>
            </div>
          </div>
        </div>
      );
    }
    if (focusMode === 'on') {
      return (
        <div className="stu-focus">
          <span className="lit"><i />Focus mode on</span>
          <button type="button" className="stu-quiet" onClick={dropFocus}>Turn it off</button>
          <span>Turning it off is recorded, the same as leaving the page.</span>
        </div>
      );
    }
    /* Said once and then left alone. A student whose phone refuses full screen
       has done nothing, so they are told that plainly and the control goes —
       offering it again would only invite them to press a button that has
       already proved it does nothing. */
    if (focusRefused) {
      return (
        <div className="stu-focus">
          <span>This browser would not go full screen. Nothing about your session changes.</span>
        </div>
      );
    }
    // No fullscreen on this device at all — an iPhone, most likely. Offering a
    // control that cannot work would leave a student pressing it and getting
    // nothing, so there is simply nothing here.
    if (!focusAvailable) return null;
    return (
      <div className="stu-focus">
        <button type="button" className="stu-quiet" onClick={askFocus}>Turn on focus mode</button>
        <span>Fills the screen. You can leave it whenever you like.</span>
      </div>
    );
  })();

  /* S4 — the level change gets the whole screen. */
  if (result?.levelChanged) {
    return (
      <div className="stu dk">
        {header}
        {focusRow}
        <LevelChange result={result} onNext={() => requestNext(true)} />
        {hold}
        {leaveAsk}
      </div>
    );
  }

  return (
    /* The paste listener sits here rather than on each field, because there are
       nine kinds of question below this and every one of them that has a box to
       type in would otherwise need its own copy of the same three lines. Paste
       bubbles, so one listener catches all of them — and it catches nothing on
       the join screen, which returned long before this and where a pasted roll
       number is somebody being sensible rather than a signal about anything. */
    <div className="stu dk" onPaste={onAnswerPaste}>
      {header}

      {/* Told once, plainly, at the start. One sentence, in the same neutral
          block the app uses for everything else it tells a student, because
          this is information and not a warning — a red banner here would set
          the tone for the whole session and the tone would be wrong.

          It is here at all because surveillance a student has not been told
          about is the version of this feature that is actually indefensible.
          Whatever else is arguable about integrity signals, doing it silently
          is not. */}
      {!told && (
        <div className="note on-d" role="status" style={{ marginTop: 16 }}>
          <Icon name="eye" size={15} />
          <span>This session records when the page loses focus, and your teacher can see it.</span>
        </div>
      )}
      {focusRow}

      {/* Said once, about the question it is about, and gone the moment that
          question is answered. A student who dropped mid-question and came back
          to the same wording needs telling that it IS the same question -
          without this, being asked something twice reads as the app having lost
          count of them, which is the exact fear this whole phase exists to
          remove. */}
      {item?.resumed && !result && (
        <div className="note on-d" role="status" style={{ marginTop: 16 }}>
          <Icon name="refresh" size={15} />
          <span>
            This is the question you were already on — you are not being asked it twice, and everything
            you answered before it still counts.
          </span>
        </div>
      )}
      <QuestionCard
        item={item}
        result={result}
        awaiting={awaiting}
        level={level}
        trail={trail}
        onSubmit={submit}
        onNext={requestNext}
      />
      {hold}
      {leaveAsk}
    </div>
  );
}
