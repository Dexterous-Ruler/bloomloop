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
 *
 * A Teacher-led room (`roomMode`) takes no phones, so its wall never shows the
 * code or the way in. A class question (`question.source: 'class'`) shows how
 * many have voted and, only when the server sends them, each closed round's
 * votes per option and confidence taps, and the key, the share right and the
 * changes once revealed; when a round's counts are missing it says why.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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

/**
 * A room code as two halves of three with a gap between them, for reading it
 * out ("K7Q 42M"). Only a gap, never a dot or a hyphen: the phone's code field
 * keeps six characters and strips nothing but spaces, and selecting and
 * copying the code gives the six characters, since the gap is a margin.
 */
export function SplitCode({ code, className }) {
  const c = String(code ?? '');
  return (
    <b className={className} aria-label={`Room code ${c.split('').join(' ')}`}>
      <span>{c.slice(0, 3)}</span>
      <span style={{ marginLeft: '0.45em' }}>{c.slice(3)}</span>
    </b>
  );
}

/**
 * Phase 7: on a laptop in laptop mode with the console at localhost, the
 * console opens the wall with the laptop's network address (?join=), since a
 * phone cannot reach localhost. Only a private network address is taken; and
 * `?laptop=1` alone means the laptop has none yet.
 */
const PRIVATE = /^(10\.\d+|172\.(1[6-9]|2\d|3[01])|192\.168|169\.254)\.\d+\.\d+$/;
function laptopJoin() {
  const q = new URLSearchParams(window.location.search);
  try {
    const u = new URL(q.get('join') ?? '');
    if (u.protocol === 'http:' && PRIVATE.test(u.hostname)) return { origin: u.origin, none: false };
  } catch { /* no address given */ }
  const h = window.location.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = h === 'localhost' || h === '::1' || /^127\./.test(h);
  return { origin: window.location.origin, none: q.get('laptop') === '1' && loopback };
}
const LAPTOP_JOIN = typeof window === 'undefined' ? { origin: '', none: false } : laptopJoin();

/** The address a phone needs, from this browser's own origin (or the laptop's, above). */
function joinFor(code) {
  const url = `${LAPTOP_JOIN.origin}/join/${code}`;
  const shown = url.replace(/^https?:\/\//, '');
  return { url, base: shown.slice(0, shown.length - code.length) };
}

/** The way in, set large: the address, the code and a QR. */
function JoinHero({ code, title, status }) {
  const [qr, setQr] = useState('');
  const { url, base } = joinFor(code);
  const local = LAPTOP_JOIN.none;

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
            <SplitCode code={code} className="wl-code" />
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
      {local && (
        <p className="wl-local" role="alert">
          Phones cannot reach this laptop yet: it has no network address, and {window.location.host} opens on this laptop
          only. Turn on the hotspot or join the travel router’s Wi-Fi, then open the projector again from the console.
        </p>
      )}
    </section>
  );
}

/**
 * A Teacher-led room's wall with nothing up: no phone joins it, so there is no
 * code or address to show, only the room.
 */
function IdleHero({ title, status }) {
  return (
    <section className="wl-hero wl-idle" aria-label="The room">
      <div className="wl-hero-title">
        <span className="wl-label">{status === 'waiting' ? 'Starting soon' : 'Today'}</span>
        <h1>{title || 'Live room'}</h1>
      </div>
      <p className="wl-idle-sub">Questions and diagrams appear here when your professor puts them up.</p>
    </section>
  );
}

/** The code and address, small, in the bar, while something else is up. */
function JoinTag({ code }) {
  const { base } = joinFor(code);
  return (
    <span className="wl-jointag">
      <span className="wl-jointag-url">{base}</span>
      <SplitCode code={code} />
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

/* ------------------------------------------------- a class question */

// The taps a phone may send with a vote, and the votes sent with none.
const TAPS = [['sure', 'Sure'], ['think_so', 'Think so'], ['guessing', 'Guessing'], ['none', 'No tap']];

const CQ_STATE = {
  open: { label: 'Vote now', live: true },
  paused: { label: 'Talk it over with the people around you' },
  revote: { label: 'Vote again', live: true },
  closed: { label: 'Voting closed' },
};

// Of those who voted in both rounds. A poll's changes are kept and changed.
const CHANGES = [
  ['wrongToRight', 'wrong, then right'],
  ['rightToWrong', 'right, then wrong'],
  ['rightToRight', 'right both times'],
  ['wrongToSameWrong', 'the same wrong answer twice'],
  ['wrongToOtherWrong', 'a different wrong answer'],
  ['kept', 'kept their answer'],
  ['changed', 'changed their answer'],
];

/** How many have voted in the round on now, in words that fit where it stands. */
function votedCaption(q) {
  const one = q.voted === 1;
  if (q.state === 'open') return one ? 'has voted so far' : 'have voted so far';
  if (q.state === 'revote') return one ? 'has voted again so far' : 'have voted again so far';
  if (q.state === 'paused') return 'voted before the discussion';
  return q.round === 2 ? 'voted after the discussion' : 'voted';
}

/**
 * Why counts the wall could show are not on it, in plain words: counts are
 * off, a round is still open, or too few voted in it. The console's controls
 * say the same sentences.
 */
export function countsHeld(q) {
  const c = q?.counts ?? null;
  if (!c) return ['Vote counts are turned off for this question.'];
  const min = c.minVotes;
  const out = [];
  if (!c.before) {
    if (q.round === 1 && q.state === 'open') out.push('Vote counts appear once this vote closes.');
    else if (q.round === 1) out.push(`Vote counts appear only when ${min} or more have voted, so no one’s vote stands out. ${q.voted} voted.`);
    else out.push(`Fewer than ${min} voted before the discussion, so those counts stay off the wall.`);
  }
  if (q.round === 2 && !c.after) {
    if (q.state === 'revote') out.push('Counts for the second vote appear once it closes.');
    else out.push(`Fewer than ${min} voted after the discussion, so those counts stay off the wall.`);
  }
  const graded = q.kind !== 'poll';
  if (q.state === 'closed' && q.round === 2 && c.before && c.after && !c.changes && (q.revealed || !graded)) {
    out.push(`Who changed their answer is shown only when ${min} or more voted both times.`);
  }
  return out;
}

const pct = (share) => `${Math.round(share * 100)}%`;

function VoteBar({ votes, of, round }) {
  return (
    <span className="wl-vote" data-round={round}>
      <span className="sr-only">{round === '1' ? 'Before the discussion: ' : 'After the discussion: '}</span>
      <span className="wl-vote-track" aria-hidden="true"><i style={{ '--w': `${of > 0 ? (votes / of) * 100 : 0}%` }} /></span>
      <b>{votes}</b>
    </span>
  );
}

/** A round's figures beside each other: the share right (once revealed) and the taps. */
function RoundTable({ before, after }) {
  const cols = [before && ['1', 'Before', before], after && ['2', 'After', after]].filter(Boolean);
  const right = cols.some(([, , r]) => r.correct);
  const taps = cols.some(([, , r]) => r.confidence);
  return (
    <table className="wl-cq-tbl">
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">Count</span></th>
          {cols.map(([n, label]) => <th key={n} scope="col" data-round={n}><span><i aria-hidden="true" />{label}</span></th>)}
        </tr>
      </thead>
      <tbody>
        {right && (
          <tr className="wl-cq-rightrow">
            <th scope="row">Chose the right answer</th>
            {cols.map(([n, , r]) => (
              <td key={n}>
                {r.correct ? <><b>{pct(r.correct.share)}</b><small>{r.correct.students} of {r.voted}</small></> : '–'}
              </td>
            ))}
          </tr>
        )}
        {taps && (
          <tr className="wl-cq-sub">
            <th scope="colgroup" colSpan={cols.length + 1}>How sure they said they were</th>
          </tr>
        )}
        {taps && TAPS.map(([id, label]) => (
          <tr key={id}>
            <th scope="row">{label}</th>
            {cols.map(([n, , r]) => <td key={n}>{r.confidence?.[id] ?? '–'}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Shrinks a screen's type until it fits its frame, in steps of 6% down to 64%:
 * a passage and four long options, with counts under them, would otherwise run
 * under the foot of the wall. Sizes are in --u, so the fit holds at any
 * resolution; it is measured again when the content or the frame changes.
 */
function useFit(ref, key) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      let k = 1;
      el.style.setProperty('--fit', '1');
      const over = () => [...el.children].some((c) => Math.max(c.offsetHeight, c.scrollHeight) > el.clientHeight + 1);
      while (k > 0.66 && over()) {
        k -= 0.06;
        el.style.setProperty('--fit', k.toFixed(2));
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [ref, key]);
}

function ClassQuestion({ q }) {
  const box = useRef(null);
  useFit(box, JSON.stringify([q.text, q.options, q.stimulus, q.state, q.round, q.revealed, Boolean(q.counts?.before), Boolean(q.counts?.after), Boolean(q.counts?.changes), q.counts === null]));
  const options = q.options ?? [];
  const c = q.counts ?? null;
  const before = c?.before ?? null;
  const after = c?.after ?? null;
  const bars = Boolean(before || after);
  const correct = q.revealed && Array.isArray(q.correct) && q.correct.length ? q.correct : null;
  const st = CQ_STATE[q.state] ?? CQ_STATE.open;
  const held = countsHeld(q);
  const votes = (round, key) => round?.options?.find((o) => o.key === key)?.votes ?? 0;
  const longest = Math.max(0, ...options.map((o) => (o.label || '').length));
  const cols = !bars && options.length % 2 === 0 && longest <= 60 && !q.stimulus ? 2 : 1;
  const len = (q.text || '').length;
  const changes = c?.changes ? CHANGES.filter(([k]) => c.changes[k] != null) : [];

  return (
    <section className="wl-cq" ref={box} aria-label="A question for the whole class">
      <div className="wl-cq-main">
        <div className="wl-cq-head">
          <span className="wl-label">{q.round === 2 ? 'Question for the class · second vote' : 'Question for the class'}</span>
          <span className="wl-cq-state" data-live={st.live || undefined} data-state={q.state}>
            {st.live && <i className="live-dot" aria-hidden="true" />}{st.label}
          </span>
        </div>
        {q.stimulus && <Stimulus stimulus={q.stimulus} />}
        <h1 className="wl-q-text" data-size={len > 200 ? 's' : len > 100 ? 'm' : 'l'}>{q.text}</h1>
        {bars && (
          <div className="wl-legend" aria-hidden="true">
            {before && <span data-round="1"><i />Before the discussion</span>}
            {after && <span data-round="2"><i />After</span>}
          </div>
        )}
        {options.length > 0 && (
          <ol className="wl-opts" data-cols={cols} data-bars={bars || undefined} data-long={longest > 70 || undefined} data-many={options.length > 4 || undefined}>
            {options.map((o) => {
              const right = correct ? correct.includes(o.key) : null;
              return (
                <li key={o.key} data-right={right === null ? undefined : String(right)}>
                  <b className="wl-key">{o.key}</b>
                  <span className="wl-opt-label">{o.label}</span>
                  {right && <span className="wl-right"><Icon name="check" />Correct</span>}
                  {bars && (
                    <span className="wl-votes">
                      {before && <VoteBar votes={votes(before, o.key)} of={before.voted} round="1" />}
                      {after && <VoteBar votes={votes(after, o.key)} of={after.voted} round="2" />}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {changes.length > 0 && (
          <div className="wl-changes">
            <span className="wl-label">Of the {c.changes.both} who voted both times</span>
            <ol>
              {changes.map(([k, label]) => <li key={k}><b>{c.changes[k]}</b><span>{label}</span></li>)}
            </ol>
          </div>
        )}
      </div>

      <aside className="wl-cq-side" aria-label="Votes">
        <div className="wl-cq-voted" aria-live="polite">
          <b><Num value={q.voted ?? 0} /></b>
          <span>{votedCaption(q)}</span>
        </div>
        {bars && <RoundTable before={before} after={after} />}
        {held.length > 0 && (
          <div className="wl-cq-held">
            {held.map((s) => <p key={s}>{s}</p>)}
          </div>
        )}
      </aside>
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
  const { code, title, status, mode, roomMode, question, diagram, progress, pick } = state;
  // No phone joins a Teacher-led room: its wall never shows the way in.
  const led = roomMode === 'teacher-led';
  const body = mode === 'question' && question
    ? (question.source === 'class' ? <ClassQuestion q={question} /> : <Question q={question} />)
    : mode === 'diagram' && diagram?.stimulus ? <Diagram diagram={diagram} />
      : mode === 'progress' && progress ? <Progress p={progress} />
        : null;

  return (
    <div className="wl on-panel" data-mode={body ? mode : led ? 'idle' : 'join'}>
      <Flow />
      <header className="wl-bar">
        <span className="wl-brand"><Mark size={30} /><span>BloomLoop</span></span>
        {body && <span className="wl-title clip">{title}</span>}
        <StatusTag status={status} />
        {body && code && !led && <JoinTag code={code} />}
      </header>

      <main className="wl-main" data-pick={pick ? true : undefined}>
        <div className="wl-content">
          {body ?? (led ? <IdleHero title={title} status={status} /> : <JoinHero code={code} title={title} status={status} />)}
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
