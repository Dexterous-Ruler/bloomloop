/**
 * The student's side of a room, mounted at /join and /join/:code.
 *
 * This file is the session: the socket, who this phone says it is, the
 * question the server has pinned to them, the answer that is held until it is
 * marked, and what the browser reports about itself. What each moment looks
 * like lives in the files beside it.
 */

import { Fragment, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

// The dyslexia-friendly face. Only @font-face rules: the files download only
// for a student whose professor turned the support on.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import { clearDraftsFor, setDraftScope } from '../lib/draft.js';
import { useEnter } from '../lib/motion.js';
import { drop, dropConfirmed, keep, keepPack, listFor, readPack, scopeOf } from '../lib/outbox.js';
import { connect, EV, stillTrying, tryNow } from '../lib/socket.js';
import { Button, Dialog, Ladder, Mark, Note } from '../ui/index.jsx';
import ClassVote from './ClassVote.jsx';
import Join from './Join.jsx';
import Question from './Question.jsx';
import { Climb, Conn, Dock, DockSlot, Hold, Kept, Offline, saveState } from './parts.jsx';

// Shown once a set ends or a level moves, so not in /join's first download;
// the service worker precaches both with the phone (sw/plugin.js).
const Finish = lazy(() => import('./Finish.jsx'));
const LevelMove = lazy(() => import('./LevelMove.jsx'));
// Exam mode (E5, E7): its notice before the join, the rules in the room, the
// copy guard and, on a laptop, fullscreen, the shared screen and its pictures.
// Only an exam room loads it (learn/guard/Exam.jsx).
const examPart = (part) => lazy(() => import('./guard/Exam.jsx').then((m) => ({ default: m[part] })));
const Exam = examPart('default');
const ExamConsent = examPart('Consent');
const ExamTold = examPart('Told');
// An exam room's rules and notice, read before the join; null for any other
// room, or one that cannot be read (the join then says why).
const roomExam = (code) => fetch(`/api/session/${code}`, { cache: 'no-store', signal: AbortSignal.timeout?.(5000) })
  .then((r) => r.json()).then((b) => (b.exam?.on ? b.exam : null)).catch(() => null);

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

/**
 * The signed-in student's access token, when this browser holds one, so the
 * server can put this room's answers into their own history (decision 7, 19
 * Nov 2026). Read straight from where the account pages' sign-in keeps its
 * session - `sb-<project>-auth-token`, JSON with `access_token`, or under
 * `currentSession` in older versions - so /join never loads the account code.
 * Never kept, logged or shown: it rides in the join and nowhere else. The
 * server decides whether it links; '' sends nothing.
 */
function accountToken() {
  let ls;
  try { ls = window.localStorage; } catch { return ''; }
  try {
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      try {
        const v = JSON.parse(ls.getItem(k) ?? 'null');
        const t = v?.access_token ?? v?.currentSession?.access_token;
        if (typeof t === 'string' && t.trim()) return t.trim();
      } catch {
        /* not JSON: not a session */
      }
    }
  } catch {
    /* storage refused mid-read */
  }
  return '';
}

/**
 * What a join says: who, the sign-in when there is one, and (Phase 7) whether
 * this phone holds answers it has not sent: then the server serves nothing at
 * the join, the answers go first, and a closed room lets the phone in to send
 * them. Built per join, so a fresh sign-in counts on the next reconnect.
 * In Safe Exam Browser (batch 9), its own values for this page, from its
 * JavaScript API; the Browser Exam Key's only where it has one.
 */
const joinPayload = (creds, deliver = false) => {
  const token = accountToken();
  const seb = window.SafeExamBrowser?.security;
  return {
    ...creds, ...(token ? { token } : {}), ...(deliver ? { deliver: true } : {}),
    ...(seb?.configKey && { seb: { url: window.location.href.split('#')[0], configKeyHash: seb.configKey, browserExamKeyHash: seb.browserExamKey } }),
  };
};

/* The pictures of packed questions, kept while online so they still draw with
   the network down (the service worker serves /api/media/ from here). Only
   this site's own, and only where the browser has the Cache API at all: a
   page on plain http over a LAN has neither it nor a service worker. */
const MEDIA = 'bloomloop-media';
function keepImages(questions) {
  try {
    if (!window.caches) return;
    const here = window.location.origin;
    const urls = questions.map((q) => q.question.stimulus).filter((st) => st?.kind === 'image' && st.url)
      .map((st) => new URL(st.url, here)).filter((u) => u.origin === here).map((u) => u.href);
    if (urls.length) {
      window.caches.open(MEDIA).then((c) => Promise.all(urls.map((u) => c.match(u).then((hit) => hit || c.add(u)).catch(() => {})))).catch(() => {});
    }
  } catch {
    /* a picture is never worth a broken session */
  }
}

/* The outbox's rules for the server's replies (Phase 7). A save that failed is
   worth sending again, a few times, spaced out; a socket that lost its student
   rejoins first and tries once more. Everything else the server says about an
   answer is final. */
const SAVE_FAILED = ['That answer did not save. Tap Next question to carry on.', 'That vote did not save. Vote again.'];
const REJOIN_FIRST = ['Your row is gone - rejoin with your roll number.', 'Join a session before answering.', 'Join a session before voting.'];
// Refusals of the room itself: it is gone, so what it confirmed can go too.
const ROOM_GONE = ['That session has already been closed.', 'No session with that code - check the code on the board.'];
// A reply slower than this waits for the next connection rather than be
// matched, late, to the item sent after it.
const REPLY_MS = 12000;
// The phone's own sentences for an item the server will never take.
const NOT_TAKEN = {
  closed: 'The room closed before this reached your teacher.',
  moved: 'This question was taken off your list before your answer arrived, so it was not marked.',
  full: 'The room took no more answers from you, so this one was not marked.',
  stuck: 'This could not be sent. Tell your teacher if it matters.',
};

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
  // Why the set ended, when the server said: the room's cap per student.
  const [endReason, setEndReason] = useState('');
  // The teacher has stopped the room. Not an ending and not a disconnection:
  // the socket stays up, the profile stays put, and the question stays mounted
  // under the panel that says so.
  const [paused, setPaused] = useState(false);
  // A waiting room: the professor has not started the questions yet. The
  // server's own sentence, or '' once a question arrives.
  const [waiting, setWaiting] = useState('');
  // A Teacher-led room takes no answers on phones: { title, message }.
  const [led, setLed] = useState(null);
  // The levels served so far, newest last: this student's own path, not a
  // fraction of a bank they will never fully see.
  const [trail, setTrail] = useState([]);

  // Phase 5's confidence tap: the server's three choices, and this question's
  // tap (null for none). Sent with the answer; it changes no mark.
  const [taps, setTaps] = useState([]);
  const [sure, setSure] = useState(null);
  // Decision 7: whether this room's answers go into the signed-in student's
  // history, and the server's one sentence when a sign-in was sent and could
  // not link. The sentence is shown as it comes, until the student hides it.
  const [linked, setLinked] = useState(false);
  const [linkNote, setLinkNote] = useState('');
  const [linkHidden, setLinkHidden] = useState(false);

  /* A class question (Phase 5). `klass` is { q, end }: the class question as
     the server last sent it, and `class:closed` once it ends with its key
     revealed, until the student goes back. While it is set, the student's own
     screen is parked behind it, mounted and untouched. `votes` is this phone's
     own vote in force per round, for the class question it last saw. */
  const [klass, setKlass] = useState(null);
  const [votes, setVotes] = useState({ id: '', rounds: {} });
  // The server's sentence for a vote it kept and did not count.
  const [voteNote, setVoteNote] = useState('');
  // Closed without the key: the server's sentence, on the student's own screen.
  const [klassNote, setKlassNote] = useState('');

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
  // Exam mode (learn/guard/Exam.jsx): null when off, else { mode, changed }:
  // the room's `examMode` for this phone, and whether it came mid-room
  // (exam:mode). quietRef: `watched` false, a student marked under 18, who
  // sends no signal at all. examRef: { seen: the rules last shown and read
  // here, rejoined: Exam's, called on every accept before the outbox goes }.
  // An answer the room did not take before the whole screen was shared
  // (exam:screen-needed) waits as in a paused room (roomHoldRef), until the
  // share lets it go (Exam's onShared).
  // consent: an exam room's notice on the join screen, { creds, exam }.
  const [exam, setExam] = useState(null);
  const quietRef = useRef(false);
  const examRef = useRef({});
  const [consent, setConsent] = useState(null);

  const socketRef = useRef(null);
  // Seeded from storage, so the very first connect already has something to
  // rejoin with and the student never sees a form they do not need.
  const credsRef = useRef(boot.resume);
  const awaitingRef = useRef(false);
  const levelRef = useRef('understand');
  // Whether the question on screen has been scored yet. Read on resume, where
  // state from the render that submitted is not in scope.
  const resultRef = useRef(null);
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

  // The class question on screen, for handlers that outlive the render.
  const klassRef = useRef(null);
  useEffect(() => { klassRef.current = klass; }, [klass]);
  // Set by a join: the next class:question is the one sent with it, whose
  // `mine` is the server's word on this phone's vote. Every other one sends
  // `mine: null`, meaning "keep your own".
  const joinClassRef = useRef(false);
  // A class question on screen when the phone got back in. The join re-sends
  // it if it is still running; if it ended meanwhile nothing comes, and this
  // takes it down.
  const klassCheckRef = useRef(0);

  /* ---------------------------------------------------------------- outbox
     (Phase 7) Every answer and vote is written to this phone first and sent
     second, and is "sent" only when the server's reply to it has come back.
     A tap made while the wifi is down is still the student's answer, and so is
     one made just before a reload: both are on disk, under their answerId.

     Every reply to an answer names its answerId (server:result, server:kept,
     server:refused, server:exhausted), and settles that item wherever it is.
     Only where a reply names none (a vote's class:vote, a refusal, a question
     sent in place of a mark) is it matched by order: the server answers one
     socket's answers in the order they arrive, and only one item is ever out
     at a time. A resend of an answer the server already holds is answered
     from the stored row and never counted twice. */
  const [box, setBox] = useState([]);
  const boxRef = useRef([]);
  const scopeRef = useRef('');
  const loadingRef = useRef(Promise.resolve());
  // The item out now: { id, kind, questionId, timer }. Shown as "sending".
  const flightRef = useRef(null);
  const [flying, setFlying] = useState('');
  // Replies are ours to match only once the rejoin has been answered: the
  // join's own question (or pause, or wait) comes first.
  const readyRef = useRef(false);
  const afterJoinRef = useRef(false);
  const readyTimerRef = useRef(0);
  // Paused or waiting: the room takes no answers, so none are sent.
  const roomHoldRef = useRef(false);
  // Not again on this connection: timed out, or out of goes.
  const skipRef = useRef(new Set());
  const triesRef = useRef(new Map());
  const rejoinedRef = useRef(new Set());
  const restUntilRef = useRef(0);
  const seqRef = useRef(0);
  // Items that waited (offline, a reload, a lost reply) and have since been
  // settled: still shown, so the student sees them go through.
  const [recent, setRecent] = useState([]);

  /* The pack and the connection (Phase 7, "Next"). `pack` is the last one the
     server sent, as kept on disk: { issuedAt, expiresAt, timePerQuestion,
     note, questions: [{ question, reason }] }. `packNote` is the server's
     sentence when it sent none. `packOn` is the packed question on screen
     while offline. `deliver` is a closed room taking what this phone kept:
     { message, until }. `delivering`: an open room's rejoin, until the outbox
     has gone and the question on screen is asked for again. */
  const [pack, setPack] = useState(null);
  const [packNote, setPackNote] = useState('');
  const [packOn, setPackOn] = useState('');
  const [deliver, setDeliver] = useState(null);
  const [delivering, setDelivering] = useState(false);
  // This connection: { deliver: the join said so, joined, only: a closed room,
  // cap: questions per student, drained, question / result: one arrived,
  // trail: a server:question may follow the last server:kept }.
  const connRef = useRef({});

  function putPack(p) {
    setPack(p);
    setPackNote('');
  }

  function write(item) {
    boxRef.current = boxRef.current.filter((i) => i.answerId !== item.answerId).concat(item).sort((a, b) => a.seq - b.seq);
    setBox(boxRef.current);
    return keep(item);
  }

  // This room and roll number's outbox, read from disk. Anything written in
  // this tab before the read finished is kept over the disk's copy.
  function loadBox(code, rollNo) {
    const scope = scopeOf(code, rollNo);
    if (!code || !rollNo || scope === scopeRef.current) return loadingRef.current;
    scopeRef.current = scope;
    boxRef.current = [];
    setBox([]);
    putPack(null);
    readPack(scope).then((p) => { if (scopeRef.current === scope && p) setPack((was) => was || p); });
    loadingRef.current = listFor(scope).then((rows) => {
      if (scopeRef.current !== scope) return;
      const all = new Map(rows.map((r) => [r.answerId, r.status === 'queued' ? { ...r, waited: true } : r]));
      boxRef.current.forEach((i) => all.set(i.answerId, i));
      boxRef.current = [...all.values()].sort((a, b) => a.seq - b.seq);
      setBox(boxRef.current);
    });
    return loadingRef.current;
  }

  // Join, or rejoin: once the outbox is read from disk, so a phone holding
  // answers says so (`deliver`).
  function sendJoin(socket) {
    const c = credsRef.current;
    if (!c) return;
    loadBox(c.code, c.rollNo).then(() => {
      if (!socket.connected || credsRef.current !== c) return;
      const has = boxRef.current.some((i) => i.status === 'queued');
      connRef.current = { deliver: has };
      socket.emit(EV.studentJoin, joinPayload(c, has));
    });
  }

  // The pack, asked for whenever it may have changed. Never in a closed room.
  function askPack() {
    const conn = connRef.current;
    const socket = socketRef.current;
    if (conn.joined && !conn.only && socket?.connected) socket.emit(EV.studentPack, {});
  }

  // The outbox has gone (or what is left waits for another connection). Once
  // per connection: a closed room's confirmed items go from disk; an open
  // room asks for the question on screen again (unless one came meanwhile),
  // and for a fresh pack.
  function drained() {
    const conn = connRef.current;
    if (conn.drained || !conn.joined) return;
    conn.drained = true;
    setDelivering(false);
    if (conn.only) {
      dropConfirmed(scopeRef.current);
      return;
    }
    if (conn.deliver && !conn.question && !conn.result) requestNext(true);
    askPack();
  }

  function release() {
    const f = flightRef.current;
    if (!f) return null;
    window.clearTimeout(f.timer);
    flightRef.current = null;
    setFlying('');
    return f;
  }

  function settle(id, patch) {
    if (flightRef.current?.id === id) release();
    const was = boxRef.current.find((i) => i.answerId === id);
    if (was) {
      write({ ...was, ...patch });
      if (was.waited) setRecent((r) => (r.includes(id) ? r : [...r, id]));
    }
    window.setTimeout(pump, 0);
  }

  function pump() {
    if (flightRef.current || !readyRef.current || roomHoldRef.current || Date.now() < restUntilRef.current) return;
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const next = boxRef.current.find((i) => i.status === 'queued' && !skipRef.current.has(i.answerId));
    if (!next) {
      drained();
      return;
    }
    // A drawing's picture goes first, under its answer's own id (batch 9, E4),
    // and is given longer: it is the size of a photo.
    const up = Boolean(next.image);
    const timer = window.setTimeout(() => timedOut(next.answerId), up ? 3 * REPLY_MS : REPLY_MS);
    flightRef.current = { id: next.answerId, kind: up ? 'drawing' : next.kind, questionId: next.questionId ?? '', timer };
    setFlying(next.answerId);
    if (up) socket.emit(EV.studentDrawing, { questionId: next.questionId, image: next.image, answerId: next.answerId });
    else socket.emit(next.kind === 'vote' ? EV.studentVote : EV.studentAnswer, next.payload);
  }

  // No reply at all: left for the next connection. Twice, and it is kept and
  // shown as not sent, so one bad item can never hold up the rest for good.
  function timedOut(id) {
    if (flightRef.current?.id !== id) return;
    release();
    skipRef.current.add(id);
    const was = boxRef.current.find((i) => i.answerId === id);
    if (was) {
      const timeouts = (was.timeouts || 0) + 1;
      write({ ...was, waited: true, timeouts, ...(timeouts >= 2 ? { status: 'refused', note: NOT_TAKEN.stuck } : {}) });
    }
    pump();
  }

  // A save that failed: again after 1, 2 and 4 seconds (jittered), then left
  // for the next connection. A drawing not saved, after 8, 16 and 32: the
  // room takes only so many a minute.
  function again(id, base = 1000) {
    release();
    const n = (triesRef.current.get(id) || 0) + 1;
    triesRef.current.set(id, n);
    if (n > 3) {
      skipRef.current.add(id);
      pump();
      return;
    }
    const wait = base * 2 ** (n - 1) * (0.5 + Math.random());
    restUntilRef.current = Date.now() + wait;
    window.setTimeout(pump, wait + 20);
  }

  // The join has been answered: replies from here on are to what we send.
  function markReady() {
    window.clearTimeout(readyTimerRef.current);
    afterJoinRef.current = false;
    readyRef.current = true;
    loadingRef.current.then(pump);
  }

  // Into the outbox, on disk, and only then out.
  function enqueue(kind, payload, extra) {
    const c = credsRef.current;
    if (!c) return;
    seqRef.current = (seqRef.current + 1) % 1000;
    // A drawing's picture is kept beside its answer, on disk, until the room
    // has stored it (batch 9, E4); the answer then names it.
    const { image, ...rest } = typeof payload.response?.image === 'string' ? payload.response : {};
    const item = {
      answerId: payload.answerId,
      scope: scopeOf(c.code, c.rollNo),
      code: c.code,
      rollNo: c.rollNo,
      kind,
      seq: Date.now() * 1000 + seqRef.current,
      at: new Date().toISOString(),
      payload: image ? { ...payload, response: rest } : payload,
      ...(image ? { image } : {}),
      status: 'queued',
      note: '',
      timeouts: 0,
      waited: !socketRef.current?.connected,
      ...extra,
    };
    write(item).then(pump);
  }

  // The room is gone: what it confirmed goes from this phone, with its pack
  // and the pack's pictures. Unsent stays.
  function roomGone() {
    dropConfirmed(scopeRef.current);
    keepPack(scopeRef.current, null);
    putPack(null);
    window.caches?.delete(MEDIA).catch(() => {});
    boxRef.current = boxRef.current.filter((i) => i.status !== 'sent' && i.status !== 'marked');
    setBox(boxRef.current);
  }

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
    // Nor in a closed room this phone is only sending its answers to.
    if (!socket?.connected || connRef.current.only) return;
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
        sendJoin(socket);
      }
    };

    const onDown = () => {
      // Whatever was out has no reply coming: it waits, on disk, for the
      // rejoin, which is when the outbox goes again.
      const f = release();
      if (f) {
        const was = boxRef.current.find((i) => i.answerId === f.id);
        if (was) write({ ...was, waited: true });
      }
      readyRef.current = false;
      afterJoinRef.current = false;
      connRef.current = {};
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
      // The server follows this with a question, `paused` or `server:waiting`.
      setWaiting('');
      setLed(null);
      setSession(p.session || null);
      setSupports({ ...NO_SUPPORTS, ...(p.supports || {}) });
      setTaps(Array.isArray(p.confidence)
        ? p.confidence.filter((c) => c && typeof c.id === 'string' && typeof c.label === 'string')
        : []);
      setLinked(p.linked === true);
      setLinkNote(typeof p.linkNote === 'string' ? p.linkNote : '');
      // The room's exam mode for this phone (learn/guard/Exam.jsx); a screen
      // still shared is told again here, before the outbox goes.
      takeExam(p.examMode, false);
      setConsent(null);
      examRef.current.rejoined?.();
      // The outbox goes again once the join's own reply is in (the question,
      // a pause, a wait), and at the latest after three seconds. A join that
      // said it holds answers gets no question, so they go at once.
      const conn = connRef.current;
      const only = p.deliverOnly === true;
      Object.assign(conn, { joined: true, only, cap: Number(p.session?.settings?.questionsPerStudent) || 0 });
      release();
      readyRef.current = false;
      afterJoinRef.current = true;
      roomHoldRef.current = false;
      skipRef.current = new Set();
      triesRef.current = new Map();
      restUntilRef.current = 0;
      loadBox(credsRef.current?.code || p.session?.code, credsRef.current?.rollNo || p.profile?.rollNo);
      window.clearTimeout(readyTimerRef.current);
      readyTimerRef.current = window.setTimeout(markReady, 3000);
      setPackOn('');
      setDelivering(Boolean(conn.deliver) && !only);
      setDeliver(only ? { message: p.message || '', until: p.deliverUntil || '' } : null);
      if (conn.deliver || only) markReady();
      // The class question this phone was showing, if any, is re-sent after
      // this when it is still running. Given a few seconds, then taken down.
      joinClassRef.current = true;
      window.clearTimeout(klassCheckRef.current);
      const showing = klassRef.current;
      if (showing && !showing.end) {
        const stale = String(showing.q.id);
        klassCheckRef.current = window.setTimeout(() => {
          setKlass((k) => (k && !k.end && String(k.q.id) === stale ? null : k));
        }, 4000);
      }
      // Drafts are kept per student per room from here on.
      setDraftScope(p.session?.code || credsRef.current?.code, credsRef.current?.rollNo || p.profile?.rollNo);
      if (p.profile) {
        setProfile(p.profile);
        levelRef.current = p.profile.workingLevel || levelRef.current;
      }
      // A closed room, here only to take what this phone kept: no question,
      // no pack, and the end of the room on screen with the sending under it.
      if (only) {
        keepPack(scopeRef.current, null);
        putPack(null);
        setKlass(null);
        setEnding('closed');
        setPhase('done');
        return;
      }
      setPhase('question');
    };

    const onRejected = (p = {}) => {
      // A refusal of the item in flight, not of the student: the outbox keeps
      // it and the phone stays in the room.
      const f = flightRef.current;
      const reason = String(p.reason ?? '');
      if (f && SAVE_FAILED.includes(reason)) {
        again(f.id);
        return;
      }
      if (f && REJOIN_FIRST.includes(reason) && credsRef.current) {
        release();
        if (rejoinedRef.current.has(f.id)) {
          skipRef.current.add(f.id);
          pump();
          return;
        }
        rejoinedRef.current.add(f.id);
        readyRef.current = false;
        sendJoin(socket);
        return;
      }
      release();
      readyRef.current = false;
      // A closed room that will not take what this phone kept (no row of its
      // own there, a room brought in from a laptop, a room deleted). Nothing
      // goes: every unsent answer stays here, shown, for the teacher to see.
      const conn = connRef.current;
      // An ordinary join a closed room refused, with answers now waiting: again,
      // as a delivery.
      if (!f && !conn.deliver && !conn.joined && ROOM_GONE[0] === reason && boxRef.current.some((i) => i.status === 'queued')) {
        sendJoin(socket);
        return;
      }
      if (!f && conn.deliver && !conn.joined && reason !== 'Could not join - try again.') {
        boxRef.current.filter((i) => i.status === 'queued').forEach((i) => write({ ...i, status: 'refused', note: '' }));
        keepPack(scopeRef.current, null);
        putPack(null);
        credsRef.current = null;
        setKlass(null);
        setLed({ tag: 'Kept on this phone', title: 'Show these answers to your teacher', message: reason });
        setEnding('kept');
        setPhase('done');
        return;
      }
      if (ROOM_GONE.includes(reason)) roomGone();
      setJoining(false);
      const tried = credsRef.current;
      // Stop the reconnect handler re-sending a credential the server already
      // refused, or a wrong code loops forever.
      credsRef.current = null;
      setKlass(null);
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
      // Never a new question in a closed room.
      if (connRef.current.only) return;
      const id = p.question?._id ? String(p.question._id) : '';
      // The join's own question opens the outbox. One that follows a
      // server:kept is that answer's (the server moves the phone on after an
      // answer it kept with a class question). Any other question while an
      // answer is out is the server moving the phone on in place of marking
      // it: the question is not one this room asks any more. A reply that
      // names the answer later still settles it.
      const conn = connRef.current;
      conn.question = true;
      const f = flightRef.current;
      if (afterJoinRef.current) window.setTimeout(markReady, 0);
      else if (conn.trail) conn.trail = false;
      else if (f?.kind === 'answer') settle(f.id, { status: 'refused', note: NOT_TAKEN.moved });
      roomHoldRef.current = false;
      window.setTimeout(pump, 0);

      // The server pins the question it last served and clears that pin the
      // moment it scores an answer for it. So being handed the SAME question
      // back while the outbox holds an answer to it is the server saying it
      // never received that answer (case A): the question is shown as answered
      // and on its way, and the outbox sends it.
      //
      // Any other question means the pin is gone: the answer did land and only
      // its result was lost (case B), or the teacher discarded the item. The
      // outbox still sends it, and its reply is routed to it, never onto the
      // question now on screen.
      const held = id ? boxRef.current.find((i) => i.kind === 'answer' && i.questionId === id && i.status === 'queued') : null;

      // Answer locks itself on a result, on `busy` and on a held submission.
      // `busy` says the true thing while a held answer goes in. Otherwise the
      // latch comes off, because a question arriving is the end of any wait.
      awaitingRef.current = Boolean(held);
      setAwaiting(Boolean(held));

      resultRef.current = null;
      setResult(null);
      setRetry(null);
      setTriesLeft(Math.max(1, Number(p.triesLeft) || 1));
      // Keep the submitted latch while a resend is in flight: the student
      // already chose this answer, and re-opening the options would invite
      // them to answer a question that is being scored as they look at it.
      setPicked(held ? held.payload.response : null);
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

      setWaiting('');
      setItem({
        question: p.question || null,
        reason: p.reason || '',
        index: Number(p.index) || 0,
        resumed: backOn,
        // Seconds, when the room set a time per question. The phone times it
        // and nothing more: a late answer is still taken.
        timePerQuestion: Number(p.timePerQuestion) > 0 ? Number(p.timePerQuestion) : null,
      });
      // One entry per question served, so a question served twice - which is
      // what every reconnect mid-question is - must not add a second. Compared
      // by id and not by `resumed`, because the trail is about the item
      // changing and nothing else.
      if (p.question?.bloom && id !== shownIdRef.current) {
        setTrail((t) => [...t, p.question.bloom].slice(-9));
      }
      // A new question starts with no tap. The same one served again keeps it,
      // as it keeps everything else the student did on it.
      if (held) setSure(held.payload.confidence ?? null);
      else if (id !== shownIdRef.current) setSure(null);
      shownIdRef.current = id;
      setPhase('question');
    };

    const onResult = (p = {}) => {
      // Whose result: the answer it names (Phase 7); from a server that names
      // none, the answer in flight or (a reply the outbox gave up waiting for)
      // the held answer to the question on screen. A graded mark is "Marked";
      // one a professor may review, a poll, or a retry is "Sent". Marked after
      // the room closed, with the server's sentence saying it still counts.
      const conn = connRef.current;
      const f = flightRef.current?.kind === 'answer' ? flightRef.current : null;
      const named = p.answerId ? boxRef.current.find((i) => i.answerId === p.answerId) : null;
      const held = p.answerId || f ? null : boxRef.current.find((i) => i.kind === 'answer' && i.status === 'queued' && i.questionId === shownIdRef.current);
      const target = named ? { id: named.answerId, questionId: named.questionId }
        : p.answerId ? null : f ? { id: f.id, questionId: f.questionId } : held ? { id: held.answerId, questionId: held.questionId } : null;
      if (target) {
        settle(target.id, { status: p.retry || p.provisional || p.ungraded ? 'sent' : 'marked', note: p.late ? p.message || '' : '' });
      }
      // Case B: an earlier question's result, for the outbox and not for the
      // question on screen. In a closed room, never for the screen.
      const about = target?.questionId || String(p.questionId ?? '');
      if (conn.only || (about && about !== shownIdRef.current)) {
        if (p.profile) setProfile(p.profile);
        levelRef.current = p.workingLevel || levelRef.current;
        return;
      }
      // The result is the server's acknowledgement of the submission, including
      // the one it replies to a resend with. Nothing is owed after this, so the
      // wait a resend put on comes off - nothing else is coming to take it off,
      // and left on it would refuse the next question.
      awaitingRef.current = false;
      setAwaiting(false);
      conn.result = true;
      // A room with a number of questions per student resizes the pack after
      // each answer.
      if (conn.cap && conn.drained) askPack();
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
      // To an answer, the room's cap: that answer is not taken, ever. One that
      // follows a server:kept is that answer's (kept past the cap) and settles
      // nothing more.
      const conn = connRef.current;
      const f = flightRef.current;
      const refuse = (id) => settle(id, { status: 'refused', note: p.reason || NOT_TAKEN.full });
      if (afterJoinRef.current) window.setTimeout(markReady, 0);
      else if (p.answerId) refuse(p.answerId);
      else if (conn.trail) conn.trail = false;
      else if (f?.kind === 'answer') refuse(f.id);
      if (p.profile) setProfile(p.profile);
      // Set when the student reached the room's questions-per-student cap.
      setEndReason(p.reason || '');
      setEnding('exhausted');
      setPhase('done');
    };

    // The room has not started: answered in place of a question, again to any
    // `student:next` sent meanwhile. Nothing is owed, so no latch stays on.
    const onWaiting = (p = {}) => {
      joinClassRef.current = false;
      holdRoom();
      awaitingRef.current = false;
      setAwaiting(false);
      setWaiting(p.message || 'You are in. Your professor will start the questions soon. Keep this page open.');
    };

    // Sent in place of `session:accepted`, and nothing follows it.
    const onTeacherLed = (p = {}) => {
      setJoining(false);
      setRejected('');
      setKlass(null);
      setLed({ title: p.title || '', message: p.message || '' });
      setEnding('teacher-led');
      setPhase('done');
    };
    // Closing the room closes its class question too, unrevealed. An answer
    // this phone has not sent yet still goes (Phase 7): it rejoins the closed
    // room to send it, and the server says, answer by answer, what counts. An
    // answer in flight is answered all the same, by its answerId.
    const onClosed = () => {
      setKlass(null);
      // A vote never reaches a closed room: kept and shown, never sent again.
      boxRef.current.filter((i) => i.kind === 'vote' && i.status === 'queued')
        .forEach((i) => settle(i.answerId, { status: 'refused', note: NOT_TAKEN.closed }));
      if (connRef.current.only) return;
      if (boxRef.current.some((i) => i.status === 'queued')) {
        release();
        readyRef.current = false;
        sendJoin(socket);
        return;
      }
      roomGone();
      setEnding('closed');
      setPhase('done');
    };

    /* The pack (Phase 7): kept on disk for this room and roll number, with
       its pictures, or, empty, the server's sentence and nothing kept. */
    const onPack = (p = {}) => {
      const list = Array.isArray(p.questions) ? p.questions.filter((q) => q?.question?._id) : [];
      const next = list.length ? {
        issuedAt: p.issuedAt || '',
        expiresAt: p.expiresAt || '',
        timePerQuestion: Number(p.timePerQuestion) > 0 ? Number(p.timePerQuestion) : null,
        note: p.note || '',
        questions: list.map((q) => ({ question: q.question, reason: q.reason || '' })),
      } : null;
      keepPack(scopeRef.current, next);
      putPack(next);
      if (next) keepImages(next.questions);
      else setPackNote(p.note || '');
    };

    /* Final replies, each naming its answer. Kept: saved and not counted, with
       the server's sentence and never a mark; it goes from the outbox on disk
       and stays on screen for this visit. Refused: refused for good, kept on
       this phone and never sent again. A question that follows a kept answer
       is its own (`trail`). */
    const onFinal = (patch) => (p = {}) => {
      const f = flightRef.current;
      const id = p.answerId || (f?.kind === 'answer' ? f.id : '');
      if (!id) return;
      if (patch.counted === false && !connRef.current.only) connRef.current.trail = true;
      const mine = boxRef.current.find((i) => i.answerId === id)?.questionId === shownIdRef.current;
      if (mine) {
        awaitingRef.current = false;
        setAwaiting(false);
      }
      // Refused on the question still on screen in a room that runs (too long,
      // say: batch 9, E3): the answer stays in its box, to change and send again.
      const redo = mine && patch.status === 'refused' && !connRef.current.only && !resultRef.current;
      if (redo) setPicked(null);
      settle(id, { ...patch, note: p.message || '', ...(redo ? { again: true } : {}) });
      if (patch.counted === false) drop(id);
    };
    const onKept = onFinal({ status: 'sent', counted: false });
    const onRefused = onFinal({ status: 'refused' });

    /* A drawing's picture (batch 9, E4). Stored: the item names it and goes on
       as the answer { mediaId, text? }, its picture off this phone. Not saved
       this time: sent again later. Refused: for good, kept here with the
       server's sentence, as a refused answer is (on screen, the board opens
       again for a new drawing). */
    const drawnOf = (p) => {
      const f = flightRef.current;
      return boxRef.current.find((i) => i.image && i.answerId === (p.answerId || (f?.kind === 'drawing' ? f.id : '')));
    };
    const onStored = (p = {}) => {
      const was = drawnOf(p);
      if (!was || !p.mediaId) return;
      if (flightRef.current?.id === was.answerId) release();
      skipRef.current.delete(was.answerId);
      const { image: _, ...rest } = was;
      write({ ...rest, payload: { ...was.payload, response: { mediaId: String(p.mediaId), ...was.payload.response } } }).then(pump);
    };
    const onDrawAgain = (p = {}) => {
      const was = drawnOf(p);
      if (was && flightRef.current?.id === was.answerId) again(was.answerId, 8000);
    };
    const onDrawRefused = (p = {}) => {
      const was = drawnOf(p);
      if (was) onRefused({ ...p, answerId: was.answerId });
    };

    /* Exam mode (batch 9, learn/guard/Exam.jsx): at the join, or changed
       mid-room (exam:mode; null: turned off), when it is shown and read
       before answering goes on. */
    const takeExam = (m, changed) => {
      quietRef.current = m?.watched === false;
      setExam(m?.on ? { mode: m, changed } : null);
    };
    const onExamMode = (p = {}) => takeExam(p.examMode, true);

    // Paused or waiting, whether as the join's reply, a reply to an answer or
    // the room stopping: nothing is refused, and nothing goes until it runs.
    // A vote out when the room stops keeps waiting for its own reply: the
    // server answers it (class:vote) whatever the order, and its earlier vote
    // stays in force. An answer out is answered by the pause itself, so it
    // waits on this phone for the room to carry on.
    const holdRoom = () => {
      if (flightRef.current?.kind !== 'vote') release();
      roomHoldRef.current = true;
      if (afterJoinRef.current) markReady();
    };

    const onPaused = () => {
      // A room that stops mid-ask answers `paused` where a question would have
      // gone, so nothing is on its way and this phone is not waiting for it.
      // Saying otherwise strands the student: `requestNext` refuses to ask
      // while the latch is set, so the resume would find it still set, ask
      // nothing, and leave them on a spinner for the rest of the class.
      awaitingRef.current = false;
      setAwaiting(false);
      setPaused(true);
      // A paused room sends no class question with a join; the resume does.
      joinClassRef.current = false;
      holdRoom();
    };

    const onResumed = () => {
      setPaused(false);
      roomHoldRef.current = false;
      window.setTimeout(pump, 0);
      // An answer tapped just as the room stopped never reached the scorer: the
      // server replied `paused` in place of the result. `picked` is the latch
      // that stops a double tap scoring twice, and with no result behind it
      // that latch is stale: left set, it hands the student back a question
      // they can read and cannot answer. Their working out is untouched either
      // way, since it lives in Answer and that never unmounted.
      //
      // Unless the outbox still holds it: then it is the student's answer,
      // waiting, and it goes now that the room runs again.
      const held = boxRef.current.some((i) => i.kind === 'answer' && i.status === 'queued' && i.questionId === shownIdRef.current);
      if (!resultRef.current && !held) setPicked(null);
    };

    /* The class question, as it stands: at the start, the pause and the
       re-vote, after a join or reconnect, and on a resume. The student's own
       screen is parked behind it. */
    const onClassQuestion = (p = {}) => {
      const id = p.id ? String(p.id) : '';
      if (!id || !p.question) return;
      window.clearTimeout(klassCheckRef.current);
      const fromJoin = joinClassRef.current;
      joinClassRef.current = false;
      const round = Number(p.round) || 1;
      setKlassNote('');
      setVoteNote('');
      setKlass({ q: p, end: null });
      setVotes((v) => {
        const base = v.id === id ? v : { id, rounds: {} };
        // With a join, `mine` is the server's word on the vote in force,
        // including that there is none. Otherwise null means "keep your own".
        if (p.mine) {
          const was = base.rounds[round];
          const same = was && JSON.stringify(was.response) === JSON.stringify(p.mine.response ?? null)
            && (was.confidence ?? null) === (p.mine.confidence ?? null);
          if (same) return base;
          return { ...base, rounds: { ...base.rounds, [round]: { response: p.mine.response ?? null, confidence: p.mine.confidence ?? null, message: '' } } };
        }
        if (fromJoin && base.rounds[round]) {
          const rounds = { ...base.rounds };
          delete rounds[round];
          return { ...base, rounds };
        }
        return base;
      });
      // The question is out of every pack now; which of this phone's it was,
      // the server does not say.
      askPack();
    };

    // This phone's own vote, back: what it sent, never whether it was right.
    const onClassVote = (p = {}) => {
      // The vote in flight is confirmed either way. One the server kept and did
      // not count keeps its sentence.
      const f = flightRef.current;
      if (f?.kind === 'vote') settle(f.id, { status: 'sent', counted: p.counted !== false, note: p.counted === false ? (p.message || '') : '' });
      if (p.counted === false) {
        // Kept and not counted: the vote in force is unchanged.
        setVoteNote(p.message || '');
        return;
      }
      setVoteNote('');
      const id = p.id ? String(p.id) : '';
      const round = Number(p.round) || 0;
      setVotes((v) => (v.id === id && round
        ? { ...v, rounds: { ...v.rounds, [round]: { response: p.mine?.response ?? null, confidence: p.mine?.confidence ?? null, message: p.message || '' } } }
        : v));
    };

    /* It ended. With the key revealed, the answer is shown until the student
       goes back; without, straight back, with the server's sentence on their
       own screen. A `server:question` that follows replaces the parked one. */
    const onClassClosed = (p = {}) => {
      window.clearTimeout(klassCheckRef.current);
      setVoteNote('');
      const showing = klassRef.current;
      const ours = showing && (!p.id || String(showing.q.id) === String(p.id));
      if (p.revealed && ours) {
        setKlass({ ...showing, end: p });
        return;
      }
      setKlass(null);
      if (ours) setKlassNote(p.message || '');
      askPack();
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
    socket.on(EV.waiting, onWaiting);
    socket.on(EV.teacherLed, onTeacherLed);
    socket.on(EV.classQuestion, onClassQuestion);
    socket.on(EV.classVote, onClassVote);
    socket.on(EV.classClosed, onClassClosed);
    socket.on(EV.pack, onPack);
    socket.on(EV.kept, onKept);
    socket.on(EV.refused, onRefused);
    socket.on(EV.drawingStored, onStored);
    socket.on(EV.drawingRejected, onDrawAgain);
    socket.on(EV.drawingRefused, onDrawRefused);
    socket.on(EV.examMode, onExamMode);
    socket.on(EV.screenNeeded, holdRoom);

    // The wifi is back: try now, not at the end of the current wait.
    const onOnline = () => tryNow(socket);
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.clearTimeout(klassCheckRef.current);
      window.clearTimeout(readyTimerRef.current);
      release();
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
      socket.off(EV.waiting, onWaiting);
      socket.off(EV.teacherLed, onTeacherLed);
      socket.off(EV.classQuestion, onClassQuestion);
      socket.off(EV.classVote, onClassVote);
      socket.off(EV.classClosed, onClassClosed);
      socket.off(EV.pack, onPack);
      socket.off(EV.kept, onKept);
      socket.off(EV.refused, onRefused);
      socket.off(EV.drawingStored, onStored);
      socket.off(EV.drawingRejected, onDrawAgain);
      socket.off(EV.drawingRefused, onDrawRefused);
      socket.off(EV.examMode, onExamMode);
      socket.off(EV.screenNeeded, holdRoom);
      socket.disconnect();
    };
  }, []);

  // A class question is on screen, and the student's own screen is parked
  // behind it. Never over the join form, and never once the room is over.
  const parked = Boolean(klass) && phase !== 'join' && phase !== 'resume' && ending !== 'closed' && ending !== 'teacher-led';

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
  // Both also stand down behind a class question, and run again after it.
  useEffect(() => {
    if (paused || parked || !result || result.levelChanged || supports.noTimer) return undefined;
    const t = setTimeout(() => requestNext(false), supports.extraTime ? 10000 : 2500);
    return () => clearTimeout(t);
  }, [paused, parked, result, requestNext, supports.noTimer, supports.extraTime]);

  // Safety net: if the accept lands but no item follows, ask for one and do
  // not leave a phone on a skeleton.
  // Not while the room waits: the professor's start sends the question.
  // Nor while a rejoin's outbox is going: it asks once it has gone.
  useEffect(() => {
    if (paused || parked || waiting || delivering || phase !== 'question' || item || awaiting) return undefined;
    const t = setTimeout(() => requestNext(false), 1500);
    return () => clearTimeout(t);
  }, [paused, parked, waiting, delivering, phase, item, awaiting, requestNext]);

  /* ---------------------------------------------------------------- signals */

  /* The question actually on screen, for a signal's payload.
     Kept apart from shownIdRef, which belongs to the trail and holds its value
     after the room has ended: "this happened during question 7" has to mean
     the student was looking at question 7 when it happened. An empty string
     means no question, and the payload then leaves the field out entirely. */
  // A parked question is not on screen, so a signal during a class question
  // names none.
  useEffect(() => {
    signalQidRef.current = phase === 'question' && !parked && item?.question?._id ? String(item.question._id) : '';
  }, [phase, item, parked]);

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
      // Marked under 18 (decision 8): nothing is reported at all.
      if (quietRef.current) return false;
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

  // `read`: an exam room's rules, shown on the join screen and read (batch 9:
  // the server counts a join as having read them), or true for any other room.
  const join = useCallback((creds, read) => {
    if (!read) {
      setConsent(null);
      setRejected('');
      setRefusedResume('');
      setJoining(true);
      roomExam(creds.code).then((e) => (e ? (setJoining(false), setConsent({ creds, exam: e })) : join(creds, true)));
      return;
    }
    if (read !== true) examRef.current.seen = read;
    credsRef.current = creds;
    // The student typed this, so nothing that comes back is a surprise to them.
    silentRef.current = false;
    store.write(creds);
    setPrefill((p) => ({ ...p, code: creds.code, rollNo: creds.rollNo, name: creds.name || '' }));
    setRejected('');
    setRefusedResume('');
    setJoining(true);
    const s = socketRef.current;
    if (s?.connected) sendJoin(s);
    // Turned away mid-room (Safe Exam Browser asked for), the server hung up.
    else if (s && !s.active) s.connect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setExam(null);
    quietRef.current = false;
    examRef.current.seen = null;
    budgetRef.current = SIGNAL_BUDGET;
    lastSentRef.current = {};
    hiddenAtRef.current = 0;
    hiddenSentRef.current = false;
    acceptedRef.current = false;
    resultRef.current = null;
    awaitingRef.current = false;
    shownIdRef.current = '';
    // The outbox stays on disk under this student's roll number: nothing
    // unsent is ever thrown away, and it goes when they join again.
    release();
    readyRef.current = false;
    connRef.current = {};
    scopeRef.current = '';
    boxRef.current = [];
    setBox([]);
    setRecent([]);
    putPack(null);
    setPackOn('');
    setDeliver(null);
    setDelivering(false);
    setLeaving(false);
    setJoining(false);
    setAwaiting(false);
    setRejected('');
    setRefusedResume('');
    setWaiting('');
    setLed(null);
    setEndReason('');
    setSession(null);
    setProfile(null);
    setItem(null);
    setPicked(null);
    setResult(null);
    setTrail([]);
    setPaused(false);
    setEnding('');
    // The taps, the link and any class question were this student's.
    setTaps([]);
    setSure(null);
    setLinked(false);
    setLinkNote('');
    setLinkHidden(false);
    window.clearTimeout(klassCheckRef.current);
    joinClassRef.current = false;
    setKlass(null);
    setVotes({ id: '', rounds: {} });
    setVoteNote('');
    setKlassNote('');
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

  // What every answer carries besides itself: a fresh key, reused on every
  // resend; the phone's own time, for the record only (Phase 7); and the tap
  // when there is one, and only then.
  const stamp = () => ({ answerId: newAnswerId(), deviceAnsweredAt: new Date().toISOString(), ...(sure ? { confidence: sure } : {}) });

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
    setKlassNote('');
    setRecent([]);
    // One key per attempt, kept with the outbox's copy so every resend of this
    // attempt carries the same key and can never count twice.
    const answer = { questionId: String(item.question._id), response, ...stamp() };
    setRetry(null);
    // An answer refused here and changed since: this one takes its place, on
    // screen and on disk (drop's promise is what filters it out).
    boxRef.current = boxRef.current.filter((i) => !(i.again && i.questionId === answer.questionId && drop(i.answerId)));
    // On this phone before it is sent, and kept until a reply comes back for
    // it. The tap that lands in the second the wifi drops is the one a student
    // would never forgive us for losing. Re-sending it later is safe because
    // the server answers a submission it already holds with the score it
    // recorded. Only ever sent over a live socket, after the rejoin.
    enqueue('answer', answer, { questionId: answer.questionId, label: String(item.question.text ?? '').slice(0, 140), html: item.question.rich?.text });
  };

  /* A packed question, answered offline (Phase 7): one go, in the pack's
     order, never marked here. It goes as an ordinary answer, after the
     rejoin, and is marked then. */
  const submitPacked = (response) => {
    if (!onPacked || box.some((i) => i.kind === 'answer' && i.questionId === packOn)) return;
    setTold(true);
    enqueue('answer', { questionId: packOn, response, ...stamp() }, { questionId: packOn, label: String(onPacked.question.text ?? '').slice(0, 140), html: onPacked.question.rich?.text });
  };

  /* A vote in the class question's open round. A fresh key for every vote: a
     changed vote is a new vote, and the server keeps the one it replaces.
     Only over a live socket; the rejoin says which vote is in force. */
  const vote = (response, confidence) => {
    const q = klass?.q;
    if (!q?.voting || klass.end) return;
    setVoteNote('');
    const round = Number(q.round) || 1;
    const picks = Array.isArray(response) ? response : [typeof response === 'boolean' ? (response ? 0 : 1) : response];
    const letters = picks.map((i) => q.options?.[i]?.key).filter(Boolean).join(', ');
    enqueue('vote', {
      classQuestionId: String(q.id),
      round,
      response,
      ...(confidence ? { confidence } : {}),
      answerId: newAnswerId(),
    }, { classQuestionId: String(q.id), round, label: `Class question: your vote ${letters}` });
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

  // The browser's own word on the network, and a first connection that has
  // been trying for a while (a reload with the server out of reach): either
  // way this phone is working offline, and says so in one calm line.
  const [netOnline, setNetOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setNetOnline(true);
    const off = () => setNetOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (status !== 'connecting') return undefined;
    const t = setTimeout(() => setStalled(true), 4000);
    return () => clearTimeout(t);
  }, [status]);
  const offline = status !== 'online' && status !== 'lost' && (status === 'offline' || stalled || !netOnline);

  /* Offline with a pack (Phase 7, "Next"): once the question on screen is
     answered, the packed ones, in the order sent, one go each, skipping only
     those already answered, until the pack is used up or expires. Each answer
     waits in the outbox like any other and is marked after the rejoin. */
  const answered = new Set(box.filter((i) => i.kind === 'answer').map((i) => i.questionId));
  const packLive = pack && !(Date.parse(pack.expiresAt) <= Date.now()) ? pack.questions : [];
  const packLeft = packLive.filter((q) => !answered.has(String(q.question._id)));
  const onPacked = offline && packOn ? packLive.find((q) => String(q.question._id) === packOn) ?? null : null;
  const goPack = offline && packLeft.length ? () => { setSure(null); setPackOn(String(packLeft[0].question._id)); } : null;
  const goNext = (force) => (goPack ? goPack() : requestNext(force));
  const packView = Boolean(onPacked) && !parked && (phase === 'question' || phase === 'resume');

  const moved = phase === 'question' && !packView && Boolean(result?.levelChanged);
  const view = packView ? 'question' : phase === 'question' ? (moved ? 'move' : 'question') : phase;

  const root = useRef(null);
  const page = useRef(null);
  const [dock, setDock] = useState(null);
  // One arrival per screen and per question. The page's blocks are keyed by it
  // too, so each arrival is new elements: a block carried over from the last
  // screen could be left half-faded by the entrance it interrupted.
  const arrival = `${view}:${view === 'question' ? (packView ? packOn : item?.question?._id ?? '') : ''}`;
  useEnter(page, arrival);

  // The class question's own page, with its own arrival: each round and the
  // close come in as new, while the parked page keeps its place.
  const classPage = useRef(null);
  useEnter(classPage, parked ? `${klass.q.id}:${klass.q.round}:${klass.q.state}:${klass.end ? 'end' : ''}` : '');

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


  // A phone picking itself back up shows its outbox before the server answers:
  // after a reload with no network, that is all there is to show.
  useEffect(() => {
    if (boot.resume) loadBox(boot.resume.code, boot.resume.rollNo);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The phone's service worker (Phase 7): production builds only, and only
  // from here, so no staff screen ever has one. It keeps /join openable with
  // no network; it never holds an answer or anything from /api but the
  // pictures of packed questions. Plain http over a LAN is not a secure
  // context: there is no service worker there, and the offline line says not
  // to reload.
  const [noWorker] = useState(() => !window.isSecureContext || !('serviceWorker' in navigator));
  useEffect(() => {
    if (!import.meta.env.PROD || noWorker) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/join', updateViaCache: 'none' }).catch(() => {});
  }, [noWorker]);

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
        /* An exam room's rules, read before the join (batch 9). */
        panel={consent && !rejected && (
          <Suspense fallback={null}>
            <ExamConsent ask={consent} busy={joining} join={join} back={setConsent} />
          </Suspense>
        )}
      />
    );
  }

  /* What the session is waiting on, if anything. Each of these covers the page
     and leaves it mounted: Answer holds a half-built answer in its own state,
     so swapping the question out would hand back a blank one afterwards. */
  /* Offline is not one of them (Phase 7): the student keeps working, every
     answer goes into the outbox, and one line under the bar says so. */
  let hold = null;
  if (phase !== 'done' && status === 'lost') {
    // The socket has stopped trying, which with infinite attempts means the
    // server refused it. The one connection state that is a real error, so the
    // one that gets a button.
    hold = (
      <Hold
        icon="alert"
        title="The connection stopped"
        action={<Button variant="primary" size="lg" icon="refresh" onClick={retryConnection}>Try again</Button>}
      >
        Nothing you have done is lost: your answers are on the server or kept on this phone, and the server holds the
        question you are on. Try again, and if it will not come back, tell your teacher the room dropped you.
      </Hold>
    );
  } else if (waiting && phase === 'question' && !item?.question) {
    hold = (
      <Hold icon="clock" title="Waiting to start">
        {waiting}
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
  /* The outbox, as the student sees it. The question on screen carries its own
     answer's state under it; everything else on this phone is listed: what is
     waiting, what was refused, and what went through after waiting. */
  const shownId = packView ? packOn : item?.question?._id ? String(item.question._id) : '';
  const own = shownId ? box.filter((i) => i.kind === 'answer' && i.questionId === shownId).pop() : null;
  const ownState = own && saveState(own, flying, offline);
  // The answer on screen is given and nothing here will mark it: offline, or
  // kept or refused by the server. The way on is the pack, or the next
  // question.
  // Not past one refused to be changed and sent again: the room asks it still.
  const onward = own && !own.again && (packView || (!result && (offline || own.status === 'refused' || own.counted === false)))
    ? (offline ? goPack : () => requestNext(true)) : null;
  // Offline with nothing left to answer: the server's sentence about the
  // pack when it sent none, else the phone's own. On a packed question not yet
  // answered: the pack's own sentence.
  const offNote = offline && !goPack && (packView ? own : !item?.question || own || result)
    ? packNote || 'There is nothing more to answer until you reconnect. Your answers are saved on this phone.'
    : packView && !own ? pack.note : '';
  const others = box.filter((i) => i !== own && (i.status === 'queued' || recent.includes(i.answerId)));
  const unsent = box.filter((i) => i.status === 'queued' || i.status === 'refused' || recent.includes(i.answerId));
  const deliverBy = Date.parse(deliver?.until);
  const voteKept = klass && box.filter((i) => i.kind === 'vote' && i.status === 'queued'
    && i.classQuestionId === String(klass.q.id) && i.round === (Number(klass.q.round) || 1)).pop();

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
    <DockSlot.Provider value={parked ? null : dock}>
      <div
        className="learn"
        ref={root}
        data-view={parked ? 'class' : view}
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
          {offline && <Offline noWorker={noWorker} />}
        </header>

        {/* Where this student is working, across the top of every question. */}
        {/* Not over a class question: that one is not at this student's level
            and moves nothing on the climb. */}
        {view === 'question' && !parked && <Climb level={level} />}

        {/* Parked behind a class question: still mounted, so a half-built
            answer, the clock and the draft stay exactly where they were, but
            hidden, and its dock content goes nowhere (the slot above is null
            while parked). */}
        <main
          className="ln-page"
          ref={page}
          data-view={view}
          hidden={parked}
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
                    You are in as <span className="mono">{rollNo}</span>. Your level and the question you were on are
                    held by the server, and any answer not yet sent is kept on this phone, so closing the tab lost
                    nothing. This is the session you left, not a new one.
                  </p>
                </div>
                <Kept items={unsent} flying={flying} offline={offline} />
                {/* Acts at once, unlike the one in the bar: there is nothing on
                    this screen to lose, and making somebody confirm that they
                    are not the person named above is a gate with nothing behind
                    it. Offline with a pack, the questions kept here come
                    first. */}
                <Dock>
                  <div className="stack stack-2">
                    {goPack && <Button variant="primary" size="xl" block onClick={goPack}>Answer the questions kept on this phone</Button>}
                    <Button size="xl" block icon="logout" onClick={leave}>Not me, join as someone else</Button>
                  </div>
                </Dock>
              </>
            )}

            {/* A closed room taking what this phone kept (Phase 7): the
                server's sentence, until when an answer to a question given
                before the close still counts, and each answer as it goes. */}
            {view === 'done' && deliver && (
              <Note icon="send" role="status">
                {deliver.message}{' '}
                {!(deliverBy > 0) ? '' : deliverBy > Date.now()
                  ? `An answer to a question you were given before it closed counts if it reaches your teacher by ${new Date(deliverBy).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}; after that it is saved but does not count.`
                  : 'It is more than 10 minutes since it closed, so these answers are saved but do not count.'}
              </Note>
            )}
            {view === 'done' && deliver && <Kept items={unsent} flying={flying} offline={offline} />}
            {view === 'done' && <Suspense fallback={null}><Finish profile={profile} ending={ending} reason={endReason} led={led} linked={linked} onLeave={leave} /></Suspense>}
            {view === 'done' && !deliver && <Kept items={unsent} flying={flying} offline={offline} />}

            {view === 'move' && (
              <>
                {focusLeft}
                <Suspense fallback={null}><LevelMove result={result} busy={awaiting} onNext={() => goNext(true)} /></Suspense>
                {focusLine}
              </>
            )}

            {view === 'question' && (
              <>
                {(!told || focusLeft || (item?.resumed && !result && !packView) || (linkNote && !linkHidden) || klassNote || offNote) && (
                  <div className="ln-notes">
                    {/* A sign-in was sent and could not be linked: the server's
                        one sentence, which never says which check failed. */}
                    {linkNote && !linkHidden && (
                      <Note icon="info" role="status">
                        {linkNote}
                        <span className="cluster cluster-4 ln-note-acts">
                          <button type="button" className="ln-quiet" onClick={() => setLinkHidden(true)}>Hide this</button>
                        </span>
                      </Note>
                    )}
                    {/* The class question closed without its answer shown. */}
                    {klassNote && <Note icon="users" role="status">{klassNote}</Note>}
                    {/* Told once, plainly, at the start: information and not a
                        warning, in the block the product uses for everything
                        else it tells a student. It is here at all because
                        surveillance a student has not been told about is the
                        indefensible version of this feature. */}
                    {!told && (exam ? <Suspense fallback={null}><ExamTold mode={exam.mode} /></Suspense> : (
                      <Note icon="eye" role="status">
                        This session records when the page loses focus. Your teacher can see it.
                      </Note>
                    ))}
                    {focusLeft}
                    {/* Said once, about the question it is about, and gone when
                        that question is answered. A student who dropped
                        mid-question and came back to the same wording needs
                        telling it IS the same question, or being asked twice
                        reads as the app having lost count of them. */}
                    {item?.resumed && !result && !packView && (
                      <Note icon="refresh" role="status">
                        This is the question you were already on. You are not being asked it twice, and everything you
                        answered before it still counts.
                      </Note>
                    )}
                    {/* Offline (Phase 7): what the pack is for, or that there is
                        nothing more until the connection is back. */}
                    {offNote && <Note icon="info" role="status">{offNote}</Note>}
                  </div>
                )}
                <Kept items={others} flying={flying} offline={offline} />
                <Question
                  /* A packed question is drawn as a served one is: its own
                     reason sentence, its place in the pack for a number, the
                     room's time per question, and never a mark. */
                  item={packView ? {
                    question: onPacked.question,
                    reason: onPacked.reason,
                    index: 0,
                    tag: `Offline ${packLive.indexOf(onPacked) + 1}/${packLive.length}`,
                    timePerQuestion: pack.timePerQuestion,
                  } : item}
                  result={packView ? null : result}
                  awaiting={!packView && awaiting}
                  sent={packView ? own?.payload.response ?? null : picked}
                  level={level}
                  trail={trail}
                  auto={!packView && Boolean(result) && !paused && !supports.noTimer}
                  retry={packView ? null : retry}
                  triesLeft={packView ? 1 : triesLeft}
                  readAloud={supports.readAloud}
                  // A support for more time, or none, is not shown a clock.
                  timer={supports.noTimer || supports.extraTime ? null : packView ? pack.timePerQuestion : item?.timePerQuestion}
                  // The clock stops while the question is parked.
                  paused={paused || parked}
                  sure={taps.length ? { choices: taps, value: sure, onChange: setSure } : null}
                  save={own ? { state: ownState, note: own.note } : null}
                  onward={onward}
                  foot={focusLine}
                  onSubmit={packView ? submitPacked : submit}
                  onNext={goNext}
                />
              </>
            )}
          </Fragment>
        </main>

        {parked && (
          <main className="ln-page" ref={classPage} data-view="class" inert={hold ? '' : undefined}>
            {focusLeft}
            {/* The one screen that may use the dock while parked. */}
            <DockSlot.Provider value={dock}>
              <ClassVote
                // A new round is a new vote: the draft starts again.
                key={`${klass.q.id}:${klass.q.round}`}
                q={klass.q}
                end={klass.end}
                mine={votes.id === String(klass.q.id) ? votes.rounds[Number(klass.q.round) || 1] ?? null : null}
                first={votes.id === String(klass.q.id) && Number(klass.q.round) === 2 ? votes.rounds[1] ?? null : null}
                kept={voteKept ? { response: voteKept.payload.response, confidence: voteKept.payload.confidence ?? null, state: flying === voteKept.answerId ? 'sending' : 'queued', paused: paused && status === 'online' } : null}
                note={voteNote}
                choices={Array.isArray(klass.q.confidence) && klass.q.confidence.length ? klass.q.confidence : taps}
                foot={focusLine}
                onVote={vote}
                onBack={() => setKlass(null)}
              />
            </DockSlot.Provider>
          </main>
        )}

        {hold}

        {/* Exam mode, while the room is being answered. */}
        {exam && phase === 'question' && (
          <Suspense fallback={null}>
            <Exam
              exam={exam}
              seen={examRef}
              socket={socketRef}
              rollNo={rollNo}
              code={code}
              onSignal={signal}
              onShared={() => { roomHoldRef.current = false; pump(); }}
              down={status === 'lost'}
            />
          </Suspense>
        )}

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
