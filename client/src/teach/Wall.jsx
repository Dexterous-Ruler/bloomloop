/**
 * The projector page, /wall#<token>: the room on the classroom wall.
 *
 * It is opened from the professor's console, often on a second machine with
 * nobody signed in, so it holds no credentials of any kind. It never imports
 * lib/api.js or lib/auth.js. The only thing it knows is the link's token,
 * read once from the hash, taken out of the address bar at once (so it is not
 * projected, and not left in the browser's history), and kept in memory for
 * as long as the link works. It is never stored and never logged.
 *
 * Its own socket sends one thing, `projector:watch { token }`, again on every
 * reconnect, and never a student:* or teacher:watch event. The server answers
 * with `projector:state` (the whole screen, every time), `projector:closed`
 * (the link or the room is done: stop) or `projector:refused` (the link does
 * not work).
 *
 * WallScreen draws one projector:state and nothing else. The console's
 * preview draws the reply's `shows` with the same component, so the professor
 * sees exactly what the wall gets.
 *
 * What a wall may carry is decided on the server (its whitelist), and this
 * screen draws only those fields: the question and its options, its key once
 * revealed, a diagram or passage, counts for the class, and the wheel's pick
 * as a roll number and first name. Never a score, a band, a student's level,
 * attendance, a note, the tally's hands or any other name.
 */

import { useEffect, useState } from 'react';

import '../styles/wall.css';

import { KIND_LABEL } from '../lib/kinds.js';
import { connect, stillTrying } from '../lib/socket.js';
import { Flow, Icon, Mark, Num } from '../ui/index.jsx';
// The wall's icons are not in the phone's set (ui/Icon.jsx).
import '../ui/staffIcons.js';

/* ------------------------------------------------------------- the screen */

const STATUS = {
  open: { label: 'Live', tone: 'live' },
  paused: { label: 'Paused', tone: 'paused', icon: 'pause' },
  waiting: { label: 'Waiting to start', tone: 'waiting', icon: 'clock' },
  closed: { label: 'Closed', tone: 'closed', icon: 'stop' },
};

function StatusTag({ status }) {
  const s = STATUS[status];
  if (!s) return null;
  return (
    <span className="wl-status" data-tone={s.tone}>
      {s.icon ? <Icon name={s.icon} /> : <i className="live-dot" aria-hidden="true" />}
      {s.label}
    </span>
  );
}

/** The address a phone needs, from this browser's own origin. */
function joinFor(code) {
  const url = `${window.location.origin}/join/${code}`;
  const shown = url.replace(/^https?:\/\//, '');
  return { url, base: shown.slice(0, shown.length - code.length) };
}

/** The way in, set large: the address, the code and a QR. */
function JoinHero({ code, title, status }) {
  const [qr, setQr] = useState('');
  const { url, base } = joinFor(code);

  // The encoder is fetched only by a screen that shows a code.
  useEffect(() => {
    let alive = true;
    import('qrcode')
      .then((m) => m.toDataURL(url, { margin: 0, width: 360, errorCorrectionLevel: 'M' }))
      .then((data) => { if (alive) setQr(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [url]);

  return (
    <section className="wl-hero" aria-label="How to join">
      <div className="wl-hero-title">
        <span className="wl-label">{status === 'waiting' ? 'Join now, before it starts' : 'Join the room'}</span>
        <h1 className="clip">{title || 'Live room'}</h1>
      </div>
      <div className="wl-strip">
        <div className="wl-how">
          <div className="wl-step">
            <span className="wl-label">On any phone, go to</span>
            <span className="wl-url">{base}<em>{code}</em></span>
          </div>
          <div className="wl-step">
            <span className="wl-label">Room code</span>
            <b className="wl-code" aria-label={`Room code ${code.split('').join(' ')}`}>{code}</b>
          </div>
        </div>
        {/* White, padded card: the encoder is given no quiet zone. */}
        <div className="wl-qr">
          <div className="wl-qr-card">
            {qr ? <img src={qr} alt={`QR code for ${url}`} /> : <div className="wl-qr-wait" />}
          </div>
          <span className="wl-label">or scan this</span>
        </div>
      </div>
    </section>
  );
}

/** The code and address, small, in the bar, while something else is up. */
function JoinTag({ code }) {
  const { base } = joinFor(code);
  return (
    <span className="wl-jointag">
      <span className="wl-jointag-url">{base}</span>
      <b aria-label={`Room code ${code.split('').join(' ')}`}>{code}</b>
    </span>
  );
}

/** A picture or a passage, as the wall may show it. */
function Stimulus({ stimulus, big = false }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [stimulus?.url]);
  if (!stimulus) return null;
  if (stimulus.kind === 'image') {
    return (
      <figure className="wl-fig" data-big={big || undefined}>
        {broken
          ? <div className="wl-fig-broken"><Icon name="alert" /><span>The picture did not load.</span></div>
          : <img src={stimulus.url} alt={stimulus.alt || ''} onError={() => setBroken(true)} />}
        {stimulus.alt && <figcaption>{stimulus.alt}</figcaption>}
      </figure>
    );
  }
  if (stimulus.kind === 'passage') {
    const len = (stimulus.text || '').length;
    return (
      <blockquote className="wl-passage" data-big={big || undefined} data-size={len > 700 ? 's' : len > 360 ? 'm' : 'l'}>
        {stimulus.text}
      </blockquote>
    );
  }
  return null;
}

function Question({ q }) {
  const options = q.options ?? [];
  // A question asked aloud is always A to D; labels it was given no text for
  // are left out, unless none has any, when the letters stand alone.
  const labelled = options.filter((o) => o.label);
  const shown = q.source === 'tally' && labelled.length ? labelled : options;
  const bare = shown.length > 0 && shown.every((o) => !o.label);
  const correct = q.revealed && Array.isArray(q.correct) && q.correct.length ? q.correct : null;
  const longest = Math.max(0, ...shown.map((o) => o.label.length));
  const cols = bare ? 4 : shown.length % 2 === 0 && longest <= 90 && !q.stimulus ? 2 : 1;
  const len = (q.text || '').length;

  return (
    <section className="wl-q" data-stim={q.stimulus ? true : undefined} aria-label="Question">
      {q.stimulus && <Stimulus stimulus={q.stimulus} />}
      <div className="wl-q-main">
        <span className="wl-label">{KIND_LABEL[q.kind] ?? 'Question'}</span>
        <h1 className="wl-q-text" data-size={len > 220 ? 's' : len > 110 ? 'm' : 'l'}>{q.text}</h1>
        {shown.length > 0 && (
          <ol className="wl-opts" data-cols={cols} data-long={longest > 70 || undefined} data-bare={bare || undefined}>
            {shown.map((o) => {
              const right = correct ? correct.includes(o.key) : null;
              return (
                <li key={o.key} data-right={right === null ? undefined : String(right)}>
                  <b className="wl-key">{o.key}</b>
                  {o.label && <span className="wl-opt-label">{o.label}</span>}
                  {right && <span className="wl-right"><Icon name="check" />Correct</span>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function Diagram({ diagram }) {
  const s = diagram.stimulus;
  return (
    <section className="wl-diagram" aria-label={s.kind === 'image' ? 'Diagram' : 'Passage'}>
      <span className="wl-label">{s.kind === 'image' ? 'Look at this together' : 'Read this together'}</span>
      <Stimulus stimulus={s} big />
    </section>
  );
}

/** Counts for the class as a whole: never a person, a score or a band. */
function Progress({ p }) {
  const levels = p.levels;
  const most = levels ? Math.max(1, ...levels.map((l) => l.answers)) : 1;
  const RISE = [0.36, 0.48, 0.6, 0.72, 0.86, 1];
  return (
    <section className="wl-prog" aria-label="The class so far">
      <div className="wl-figs">
        <div className="wl-big">
          <b><Num value={p.present} /></b>
          {p.classSize != null
            ? <span>present, of <em>{p.classSize}</em> in the class</span>
            : <span>{p.present === 1 ? 'phone has joined' : 'phones have joined'}</span>}
        </div>
        <div className="wl-big">
          <b><Num value={p.answered} /></b>
          <span>{p.answered === 1 ? 'student has answered' : 'students have answered'}</span>
        </div>
      </div>

      {levels ? (
        <div className="wl-levels">
          <span className="wl-label">Answers at each level, for the whole class</span>
          <ol className="wl-bars">
            {levels.map((l, i) => (
              <li key={l.level} data-level={l.level} style={{ '--h': `${Math.max(1.5, (l.answers / most) * 86)}%`, '--i': i }}>
                <span className="wl-col"><i /><b className="wl-bar-n">{l.answers}</b></span>
                <span className="wl-bar-label">{l.label}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="wl-levels" data-held="true">
          <ol className="wl-bars" aria-hidden="true">
            {RISE.map((h, i) => (
              <li key={h} style={{ '--h': `${h * 100}%`, '--i': i }}><span className="wl-col"><i /></span></li>
            ))}
          </ol>
          <p className="wl-held">
            Answers at each level appear once {p.minAnswered} students have answered, so nobody’s own answers
            stand out. {p.answered} of {p.minAnswered} so far.
          </p>
        </div>
      )}
    </section>
  );
}

function Pick({ pick }) {
  return (
    <aside className="wl-pick" key={`${pick.rollNo}-${pick.firstName ?? ''}`} aria-live="polite" aria-label="Picked by the wheel">
      <span className="wl-label"><Icon name="draw" />Picked</span>
      <b className="wl-pick-roll">{pick.rollNo}</b>
      {pick.firstName && <span className="wl-pick-name">{pick.firstName}</span>}
    </aside>
  );
}

/**
 * One projector:state as the whole screen. Pure: it draws what it is given
 * and fetches nothing, so the console's preview is the wall.
 */
export function WallScreen({ state }) {
  if (!state) return null;
  const { code, title, status, mode, question, diagram, progress, pick } = state;
  const body = mode === 'question' && question ? <Question q={question} />
    : mode === 'diagram' && diagram?.stimulus ? <Diagram diagram={diagram} />
      : mode === 'progress' && progress ? <Progress p={progress} />
        : null;

  return (
    <div className="wl on-panel" data-mode={body ? mode : 'join'}>
      <Flow />
      <header className="wl-bar">
        <span className="wl-brand"><Mark size={30} /><span>BloomLoop</span></span>
        {body && <span className="wl-title clip">{title}</span>}
        <StatusTag status={status} />
        {body && code && <JoinTag code={code} />}
      </header>

      <main className="wl-main" data-pick={pick ? true : undefined}>
        <div className="wl-content">
          {body ?? <JoinHero code={code} title={title} status={status} />}
        </div>
        {pick && <Pick pick={pick} />}
      </main>

      <footer className="wl-foot">
        <span><Icon name="eyeOff" />This screen never shows anyone’s marks.</span>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------- the page itself */

/** The wall when it has no screen to draw: closed, refused, no link, or still connecting. */
export function WallNotice({ kind, reason }) {
  const head = {
    closed: { icon: 'stop', title: 'The projector has stopped' },
    refused: { icon: 'lock', title: 'This link does not open a room' },
    lost: { icon: 'wifiOff', title: 'The connection was lost' },
    nolink: { icon: 'projector', title: 'This is the projector page' },
  }[kind];

  return (
    <div className="wl on-panel" data-mode="notice">
      <Flow />
      <header className="wl-bar">
        <span className="wl-brand"><Mark size={30} /><span>BloomLoop</span></span>
      </header>
      <main className="wl-main">
        {kind === 'connecting' ? (
          <div className="wl-skel" aria-label="Connecting">
            <i style={{ width: '22%' }} />
            <i style={{ width: '58%', height: '9%' }} />
            <i style={{ width: '100%', height: '38%' }} />
          </div>
        ) : (
          <section className="wl-notice">
            <span className="wl-notice-ic"><Icon name={head.icon} /></span>
            <h1>{head.title}</h1>
            {kind === 'nolink'
              ? <p>It shows a room on the classroom wall. Open it from the projector controls in your room, which make a link for it.</p>
              : reason && <p>{reason}</p>}
            {kind === 'lost' && <p className="wl-notice-sub">Open a new projector window from the room’s projector controls.</p>}
          </section>
        )}
      </main>
    </div>
  );
}

// The token is read once, from the hash. Anything that is not the shape of a
// token is still sent, so the server's own sentence says why it fails.
const readToken = () => (window.location.hash || '').replace(/^#/, '').trim();

export default function Wall() {
  const [token, setToken] = useState(readToken);
  const [view, setView] = useState(() => (token ? { kind: 'connecting' } : { kind: 'nolink' }));
  const [link, setLink] = useState('on'); // on | retrying
  const [full, setFull] = useState(false);

  // Out of the address bar and out of history at once: the window may be
  // projected before it is made full screen.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    document.title = view.kind === 'state' && view.state?.code ? `Projector · ${view.state.code}` : 'Projector · BloomLoop';
  }, [view]);

  useEffect(() => {
    if (!token) return undefined;
    const socket = connect();
    let done = false;
    const stop = (next) => {
      if (done) return;
      done = true;
      setView(next);
      socket.disconnect();
      setToken(''); // the link is finished with: nothing keeps it now
    };

    // Every connection, the first and each reconnect, asks to watch again.
    socket.on('connect', () => {
      setLink('on');
      socket.emit('projector:watch', { token });
    });
    socket.on('disconnect', () => {
      if (done) return;
      if (stillTrying(socket)) setLink('retrying');
      else stop({ kind: 'lost' });
    });
    socket.on('connect_error', () => { if (!done && stillTrying(socket)) setLink('retrying'); });
    socket.on('projector:state', (state) => { if (!done) setView({ kind: 'state', state }); });
    socket.on('projector:closed', (p) => stop({ kind: 'closed', reason: p?.reason }));
    socket.on('projector:refused', (p) => stop({ kind: 'refused', reason: p?.reason }));

    return () => {
      done = true;
      socket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const goFull = () => document.documentElement.requestFullscreen?.().catch(() => {});

  return (
    <div className="wl-page wl-frame">
      {view.kind === 'state' ? <WallScreen state={view.state} /> : <WallNotice kind={view.kind} reason={view.reason} />}
      <div className="wl-chrome">
        {link === 'retrying' && view.kind === 'state' && (
          <span className="wl-retry" role="status"><Icon name="wifiOff" />Reconnecting</span>
        )}
        {!full && document.fullscreenEnabled && (
          <button type="button" className="wl-fullbtn" onClick={goFull}><Icon name="fullscreen" />Full screen</button>
        )}
      </div>
    </div>
  );
}
