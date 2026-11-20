/**
 * Exam mode on the phone, as the server sets it (decisions E5 and E7, and
 * decision 8 for a student the class list marks under 18). Lazy: only an exam
 * room, or the join screen of one, loads this.
 *
 * LearnApp keeps the session and the outbox. This keeps what exam mode adds:
 *   - the notice: before the join (Consent, on the join screen; the server
 *     counts a join as having read it), and in the room when exam mode is
 *     turned on or asks for more while the phone is in it (exam:mode), then
 *     student:exam-consent and its ack. Until then the room records this
 *     phone's signals as any room does;
 *   - on a laptop, the whole screen shared (student:screen; only 'monitor'
 *     counts), told again after a rejoin before the outbox goes, and a small
 *     JPEG of it every `snapshotSeconds` (student:snapshot);
 *   - on a laptop, fullscreen before answering. Leaving it is reported by
 *     LearnApp's own focus-mode listener ('fullscreen-exit', which an exam room
 *     records as fullscreen_exit), so one leave is told once;
 *   - the copy guard and the watermark (Guard.jsx), for every student.
 *
 * Answering pauses while one of these is missing: the page is hidden under one
 * calm panel (guard.css, html[data-exam-pause]), with nothing unmounted, so
 * the question and a half-written answer come back as they were. A student
 * marked under 18 (`watched: false`) is asked for nothing that watches: the
 * server leaves fullscreen and sharing out of their rules, and nothing they do
 * is reported.
 */

import { Maximize, MonitorUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { EV } from '../../lib/socket.js';
import Icon, { addIcons } from '../../ui/Icon.jsx';
import { Button, Note } from '../../ui/index.jsx';
import Guard from './Guard.jsx';
import { askScreen, canShare, frameSource, jpegOf, stopScreen } from './screen.js';

addIcons({ screen: MonitorUp, fullscreen: Maximize });

// Sent only from here, so kept out of /join's first download (lib/socket.js
// EV has the two LearnApp listens for: exam:mode, exam:screen-needed).
const CONSENT = 'student:exam-consent'; // {}, ack { ok }
const SCREEN = 'student:screen'; // { state, surface? }, ack { ok, asked?, message? }
const SNAPSHOT = 'student:snapshot'; // { jpeg }, ack { ok, reason? }

/* --------------------------------------------------------------- the notice */

/** The server's notice as its sentences, without the one the heading says. */
const sentences = (text) => String(text ?? '').replace(/([.!?])\s+(?=[A-Z])/g, '$1\n').split('\n')
  .map((s) => s.trim()).filter((s) => s && s !== 'This room is an exam.');

function Rules({ notice }) {
  return (
    <ul className="ex-rules">
      {sentences(notice).map((s) => <li key={s}>{s}</li>)}
    </ul>
  );
}

/**
 * Has this phone already been shown rules at least as watchful as `mode`?
 * Fewer things watched (a student marked under 18, a longer gap between
 * pictures) need no second notice; anything more does.
 */
const covers = (seen, mode) => Boolean(seen) && (mode.watched === false || (seen.watched !== false
  && (!mode.fullscreen || seen.fullscreen)
  && (!mode.screenShare || seen.screenShare)
  && (!mode.snapshotSeconds || (seen.snapshotSeconds > 0 && seen.snapshotSeconds <= mode.snapshotSeconds))));

/**
 * The join screen's card in an exam room, in place of the form, before the
 * join is sent: what the room watches, in the server's words.
 *
 * @param ask   { creds, exam }: the join the student asked for, and the
 *              room's rules (GET /api/session/:code `exam`)
 * @param join  LearnApp's join(creds, rules read)
 * @param back  LearnApp's setConsent: null puts the form back
 */
export function Consent({ ask, busy, join, back }) {
  const { exam } = ask;
  const seb = exam.sebRequired && !window.SafeExamBrowser;
  return (
    <div className="gate-card ex-consent">
      <div className="stack stack-2">
        <span className="eyebrow"><Icon name="eye" size={14} />Before you join</span>
        <h2>This room is an exam</h2>
      </div>
      <Rules notice={exam.notice} />
      {seb && (
        <Note icon="key">
          It opens only in Safe Exam Browser, with the settings your professor gave you. Any other browser is turned away
          at the door.
        </Note>
      )}
      <div className="stack stack-2">
        <Button variant="primary" size="xl" block busy={busy} onClick={() => join(ask.creds, exam)}>Join the room</Button>
        <Button variant="ghost" size="lg" block disabled={busy} onClick={() => back(null)}>Back</Button>
      </div>
      <p className="hint">Joining tells the room you have read this.</p>
    </div>
  );
}

/** Told once in the room, in place of the ordinary line about what is recorded. */
export function Told({ mode }) {
  return (
    <Note icon="eye" role="status">
      <b>Exam mode is on.</b>{' '}
      {mode.watched === false
        ? 'Copying the question is turned off. Nothing about how you use this page is recorded.'
        : 'Leaving the page or trying to copy the question is noted for your professor, as a signal and not as proof.'}
    </Note>
  );
}

/* --------------------------------------------------------------- fullscreen */

const fsElement = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;

/** Fullscreen is asked of a laptop only: a phone browser cannot be held in it. */
function laptop() {
  try {
    const el = document.documentElement;
    return Boolean((document.fullscreenEnabled ?? document.webkitFullscreenEnabled)
      && (el.requestFullscreen || el.webkitRequestFullscreen)
      && window.matchMedia('(pointer: fine)').matches);
  } catch {
    return false;
  }
}

function goFullscreen() {
  try {
    const el = document.documentElement;
    return Promise.resolve((el.requestFullscreen ?? el.webkitRequestFullscreen).call(el));
  } catch (err) {
    return Promise.reject(err);
  }
}

/* --------------------------------------------------------------- the panel */

function Pause({ icon, title, lead, children, action }) {
  const head = useRef(null);
  // Where a keyboard user is put: the page under the panel is hidden.
  useEffect(() => { head.current?.focus({ preventScroll: true }); }, [title]);
  return (
    <div className="ln-hold ex-pause" role="status" aria-live="polite">
      <div className="ln-hold-in on-panel">
        <span className="ln-hold-ic"><Icon name={icon} size={30} /></span>
        <h2 ref={head} tabIndex={-1}>{title}</h2>
        {lead && <p>{lead}</p>}
        {children}
        {action}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- Exam */

/**
 * @param exam      { mode, changed }: the room's rules for this phone
 *                  (session:accepted's `examMode`, or exam:mode's), and
 *                  whether they arrived while the phone was in the room
 * @param seen      LearnApp's ref: `.seen`, the rules this phone last showed
 *                  and had read; `.rejoined`, filled in here, called on every
 *                  session:accepted before the outbox goes
 * @param socket    ref to the room's socket
 * @param onSignal  LearnApp's signal(kind, meta)
 * @param onShared  the outbox may go again: the whole screen is shared, or
 *                  is no longer asked for
 * @param down      the connection stopped: LearnApp's own panel is showing
 */
export default function Exam({ exam, seen, socket, rollNo, code, onSignal, onShared, down }) {
  const { mode } = exam;
  const watched = mode.watched !== false;
  const every = Number(mode.snapshotSeconds) || 0;
  const max = Number(mode.snapshotMaxBytes) || 80 * 1024;
  const sharedRef = useRef(onShared);
  sharedRef.current = onShared;

  /* The notice, read in the room. */
  const [acked, setAcked] = useState(null);
  const [sending, setSending] = useState(false);
  const needAck = acked !== exam && (exam.changed || !covers(seen.current.seen, mode));
  const carryOn = () => {
    const done = () => {
      seen.current.seen = mode;
      setAcked(exam);
      setSending(false);
    };
    const s = socket.current;
    if (!s?.connected) { done(); return; }
    setSending(true);
    s.timeout(6000).emit(CONSENT, {}, done);
  };

  /* Fullscreen, on a laptop. */
  const [isLaptop] = useState(laptop);
  const wantFs = Boolean(mode.fullscreen) && isLaptop;
  const [fsOn, setFsOn] = useState(() => Boolean(fsElement()));
  const [fsLeft, setFsLeft] = useState(false);
  const [fsRefused, setFsRefused] = useState(false);
  useEffect(() => {
    const change = () => {
      const on = Boolean(fsElement());
      setFsOn(on);
      if (on) setFsRefused(false);
      else setFsLeft(true);
    };
    document.addEventListener('fullscreenchange', change);
    document.addEventListener('webkitfullscreenchange', change);
    return () => {
      document.removeEventListener('fullscreenchange', change);
      document.removeEventListener('webkitfullscreenchange', change);
    };
  }, []);
  const askFullscreen = () => goFullscreen().catch(() => setFsRefused(true));

  /* The whole screen, on a laptop. `share.state`: none, asking, on, declined
     (the picker was closed), window (not the whole screen, with the server's
     sentence) or stopped (by the browser's own Stop button). */
  const wantShare = Boolean(mode.screenShare);
  const [share, setShare] = useState({ state: 'none' });
  const shareRef = useRef(null);
  // An answer the room did not take before sharing (exam:screen-needed): it
  // waits in the outbox, and the panel says so.
  const [needed, setNeeded] = useState(false);
  const retoldRef = useRef(0);

  const tellScreen = (body) => new Promise((resolve) => {
    const s = socket.current;
    if (!s?.connected) { resolve(null); return; }
    s.timeout(8000).emit(SCREEN, body, (err, res) => resolve(err ? null : res ?? null));
  });

  // The room's word on a share: not the whole screen ends it with the
  // server's sentence; no word (offline, no reply) keeps it, told again at
  // the rejoin. Kept, answering carries on and the outbox goes again.
  const settleShare = (got, res) => {
    if (shareRef.current !== got) return;
    if (res && res.ok === false) {
      shareRef.current = null;
      stopScreen(got);
      setShare({ state: 'window', message: res.message || 'That share was not taken. Share your whole screen to answer.' });
      return;
    }
    setShare((was) => (was.state === 'on' ? was : { state: 'on' }));
    setNeeded(false);
    sharedRef.current?.();
  };

  const startShare = async () => {
    setShare({ state: 'asking' });
    let got;
    try {
      got = await askScreen();
    } catch {
      // The picker was closed or the browser said no. The room notes only
      // that sharing did not start, once per join.
      tellScreen({ state: 'declined' });
      setShare({ state: 'declined' });
      return;
    }
    got.track.addEventListener('ended', () => {
      if (shareRef.current !== got) return;
      shareRef.current = null;
      tellScreen({ state: 'stopped' });
      setShare({ state: 'stopped' });
    });
    shareRef.current = got;
    settleShare(got, await tellScreen({ state: 'started', surface: got.surface }));
  };

  // After a rejoin the room has no share on record: told again at once, before
  // the outbox goes (LearnApp calls this from session:accepted).
  const retell = () => {
    const got = shareRef.current;
    if (!got || got.track.readyState !== 'live') return;
    tellScreen({ state: 'started', surface: got.surface }).then((res) => settleShare(got, res));
  };
  useEffect(() => {
    const at = seen.current;
    at.rejoined = retell;
    return () => { at.rejoined = null; };
  });

  useEffect(() => {
    const s = socket.current;
    const onNeeded = () => {
      const got = shareRef.current;
      // Shared here but not on record there (a rejoin raced it): told again,
      // once, and the answer goes after. Twice in a row, the share is asked for
      // again.
      if (got && got.track.readyState === 'live' && Date.now() - retoldRef.current > 5000) {
        retoldRef.current = Date.now();
        retell();
        return;
      }
      if (got) {
        shareRef.current = null;
        stopScreen(got);
        setShare({ state: 'none' });
      }
      setNeeded(true);
    };
    s?.on(EV.screenNeeded, onNeeded);
    return () => s?.off(EV.screenNeeded, onNeeded);
  }, [socket]);

  // Rules that no longer ask for the screen end the share, and let an answer
  // that waited for it go; so does leaving exam mode.
  const neededRef = useRef(false);
  neededRef.current = needed;
  useEffect(() => {
    if (wantShare) return;
    if (neededRef.current) {
      setNeeded(false);
      sharedRef.current?.();
    }
    if (!shareRef.current) return;
    stopScreen(shareRef.current);
    shareRef.current = null;
    setShare({ state: 'none' });
  }, [wantShare]);
  useEffect(() => () => {
    stopScreen(shareRef.current);
    if (neededRef.current) sharedRef.current?.();
  }, []);

  /* Screen pictures, while the whole screen is shared and the notice read. */
  const shooting = share.state === 'on' && every > 0 && !needAck;
  useEffect(() => {
    const got = shareRef.current;
    if (!shooting || !got) return undefined;
    const src = frameSource(got);
    let width = 960;
    let stopped = false;
    let timer = 0;
    const send = async (again) => {
      const s = socket.current;
      if (stopped || !s?.connected) return;
      const img = await src.frame().catch(() => null);
      const pic = img ? await jpegOf(img, width, max).catch(() => null) : null;
      try { img?.close?.(); } catch { /* a video element has none */ }
      if (!pic || stopped) return;
      width = pic.width;
      s.timeout(15000).emit(SNAPSHOT, { jpeg: pic.bytes }, (err, res) => {
        if (err || stopped || !res || res.ok) return;
        // Too big: smaller, and once more now. Not sharing on record: the
        // share is told again. Not asked (the room no longer wants pictures):
        // no more. 'full', 'too-soon' and the rest: carry on at the interval.
        if (res.reason === 'size') {
          width = Math.round(width * 0.7);
          if (!again) send(true);
        } else if (res.reason === 'not-sharing') {
          retell();
        } else if (res.reason === 'not-asked') {
          stopped = true;
          window.clearTimeout(timer);
        }
      });
    };
    const tick = () => {
      send(false);
      timer = window.setTimeout(tick, every * 1000);
    };
    timer = window.setTimeout(tick, 2500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      src.close();
    };
  }, [shooting, every, max, exam]); // eslint-disable-line react-hooks/exhaustive-deps

  /* What answering waits on, one thing at a time: the notice, the screen,
     then fullscreen (sharing first: its picker can take fullscreen away). */
  const pause = needAck ? 'consent' : wantShare && share.state !== 'on' ? 'share' : wantFs && !fsOn ? 'fs' : '';
  useEffect(() => {
    const html = document.documentElement;
    html.toggleAttribute('data-exam-pause', Boolean(pause));
    // The optional focus-mode line says nothing useful where fullscreen is a rule.
    html.toggleAttribute('data-exam-fs', wantFs);
    return () => {
      html.removeAttribute('data-exam-pause');
      html.removeAttribute('data-exam-fs');
    };
  }, [pause, wantFs]);

  let panel = null;
  if (pause === 'consent') {
    panel = (
      <Pause
        icon="eye"
        title={exam.changed ? 'The exam rules for this room have changed' : 'This room is an exam'}
        lead={exam.changed ? 'Your professor changed them while you were here. Read them, then carry on.' : ''}
        action={<Button variant="primary" size="lg" busy={sending} onClick={carryOn}>Carry on</Button>}
      >
        <Rules notice={mode.notice} />
      </Pause>
    );
  } else if (pause === 'share' && !canShare()) {
    panel = (
      <Pause
        icon="screen"
        title="Answering here needs a laptop"
        lead="This room is answered with the whole screen shared, and this browser cannot share its screen. Join the room from a laptop, or tell your teacher."
      />
    );
  } else if (pause === 'share') {
    const st = share.state;
    panel = (
      <Pause
        icon="screen"
        title={st === 'stopped' ? 'Sharing stopped' : 'Share your whole screen to answer'}
        lead={st === 'window' ? share.message
          : st === 'declined' ? 'Sharing did not start. That is the only thing noted; share when you are ready.'
            : st === 'stopped' ? 'Answering is paused until you share your whole screen again. Your professor can see that sharing stopped.'
              : 'In the box that opens, choose your entire screen. A window or a browser tab does not count.'}
        action={(
          <Button variant="primary" size="lg" icon="screen" busy={st === 'asking'} onClick={startShare}>
            {st === 'none' || st === 'asking' ? 'Share my screen' : 'Share again'}
          </Button>
        )}
      >
        {(needed || every > 0) && (
          <p className="ex-pause-more">
            {needed && 'Your answer is kept on this device and is sent as soon as you share. '}
            {every > 0 && `While you share, a small picture of your screen is sent every ${every} seconds.`}
          </p>
        )}
      </Pause>
    );
  } else if (pause === 'fs') {
    panel = (
      <Pause
        icon="fullscreen"
        title={fsLeft ? 'You left fullscreen' : 'Answer in fullscreen'}
        lead={fsRefused ? 'This browser would not go fullscreen. Try again, or tell your teacher.'
          : fsLeft ? 'Answering is paused until you go back. Your question and your answer are kept as they were; leaving is noted for your professor, as a signal and not as proof.'
            : 'This room is answered in fullscreen on a laptop. Leaving it pauses answering.'}
        action={(
          <Button variant="primary" size="lg" icon="fullscreen" onClick={askFullscreen}>
            {fsLeft ? 'Back to fullscreen' : 'Go fullscreen'}
          </Button>
        )}
      />
    );
  }

  return (
    <>
      {!down && panel}
      <Guard rollNo={rollNo} code={code} report={watched} onSignal={onSignal} />
    </>
  );
}
