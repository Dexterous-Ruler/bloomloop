/**
 * The room, on the projector. It has the whole window, because it is read from
 * the back of a hall and its one job is getting forty phones in: where to go,
 * the code, a QR for the phones that would rather scan.
 *
 * It is a forest stage in either theme: light text on a dark ground carries
 * further across a room, and a projector washes out pale backgrounds. The way
 * in is one frosted strip - the address, the code set huge and spaced so
 * nobody misreads a character, and the QR. Under it the room fills up: each
 * student who joins drops a marble into the tray, so the class can see itself
 * arrive. Nothing here says how anyone is doing; the marbles are one colour.
 *
 * Escape, or the button top right, goes back to the class.
 *
 * A Teacher-led room takes no phones, so this page shows it no code: the class
 * wall for such a room is the projector window (ProjectorControl, /wall).
 */

import { useEffect, useState } from 'react';

import Marbles from '../fx/Marbles.jsx';
import { api } from '../lib/api.js';
import { Button, Flow, Icon, Mark, Note, Num } from '../ui/index.jsx';
import useRoomFeed from './useRoomFeed.js';
import { SplitCode } from './Wall.jsx';

export default function Projector({ session, content, activeCount, onLive }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  // A room reopened from a link carries no settings: its mode is read once.
  // Until it is known nothing is drawn where the code goes, so a Teacher-led
  // room's code never flashes up; if the read fails the code is shown.
  const [mode, setMode] = useState(session.settings?.mode ?? null);
  const { rows } = useRoomFeed(session.code);

  // Built from the browser's own origin, so it shows the address the phones
  // actually need rather than "localhost".
  const joinUrl = `${window.location.origin}/join/${session.code}`;
  const shownUrl = joinUrl.replace(/^https?:\/\//, '');
  const base = shownUrl.slice(0, shownUrl.length - session.code.length);
  // After a mid-class reload the bank has not been fetched again, so the count
  // the server handed back with the room is the one that is still true. For a
  // room on a picked set it is the set's size, not the bank's.
  const bankCount = session.bankCount ?? activeCount;
  const chapter = session.title || content?.title || 'Live room';
  const led = mode === 'teacher-led';

  useEffect(() => {
    if (session.settings?.mode) { setMode(session.settings.mode); return undefined; }
    let alive = true;
    api.getSession(session.code)
      .then((r) => { if (alive) setMode(r.session?.settings?.mode ?? 'devices'); })
      .catch(() => { if (alive) setMode('devices'); });
    return () => { alive = false; };
  }, [session.code, session.settings?.mode]);

  // The QR encoder is imported only here, so no phone ever downloads it.
  useEffect(() => {
    let alive = true;
    import('qrcode')
      .then((m) => m.toDataURL(joinUrl, { margin: 0, width: 360, errorCorrectionLevel: 'M' }))
      .then((url) => { if (alive) setQr(url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [joinUrl]);

  // Escape is the way back for a teacher standing at the front with a clicker.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) onLive(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLive]);

  function copy(value, what) {
    navigator.clipboard?.writeText(value).then(
      () => { setCopied(what); setTimeout(() => setCopied(''), 1600); },
      () => setError('Could not copy. Read it off the screen instead.'),
    );
  }

  return (
    <div className="pj on-panel">
      <Flow />

      <header className="pj-bar">
        <span className="pj-brand"><Mark size={30} /><span>BloomLoop</span></span>
        <span className="pj-open"><i className="live-dot" />Room open</span>
        <span className="push">
          <Button variant="accent" onClick={onLive}>Go to the class<Icon name="forward" /></Button>
        </span>
      </header>

      <main className="pj-main">
        <div className="pj-title">
          <span className="pj-label">Today{bankCount ? ` · ${bankCount} question${bankCount === 1 ? '' : 's'}` : ''}</span>
          <h1 className="clip">{chapter}</h1>
        </div>

        {mode === null ? null : led ? (
          <section className="pj-strip" aria-label="No code to show">
            <div className="pj-how">
              <span className="pj-label">Teacher-led room</span>
              <p className="t-lead">No phone joins a Teacher-led room, so there is no code to show. Put questions and diagrams on the wall from the class’s Projector space.</p>
            </div>
          </section>
        ) : (
          <section className="pj-strip" aria-label="How to join">
            <div className="pj-how">
              <div className="pj-step">
                <span className="pj-label">On any phone, go to</span>
                <span className="pj-url">{base}<em>{session.code}</em></span>
              </div>
              <div className="pj-step">
                <span className="pj-label">Room code</span>
                <SplitCode code={session.code} className="pj-code" />
              </div>
              <div className="cluster">
                <Button icon={copied === 'code' ? 'check' : 'copy'} onClick={() => copy(session.code, 'code')}>{copied === 'code' ? 'Copied' : 'Copy the code'}</Button>
                <Button icon={copied === 'url' ? 'check' : 'link'} onClick={() => copy(joinUrl, 'url')}>{copied === 'url' ? 'Copied' : 'Copy the link'}</Button>
              </div>
              {error && <Note tone="bad">{error}</Note>}
            </div>

            {/* A white card, not a bare image: the encoder is given no quiet zone,
                so the padding is what makes the code scannable at all. */}
            <div className="pj-qr">
              <div className="pj-qr-card">
                {qr ? <img src={qr} alt={`QR code for ${joinUrl}`} width={260} height={260} /> : <div className="pj-qr-wait" />}
              </div>
              <span className="pj-label">or scan this</span>
            </div>
          </section>
        )}

        {mode !== null && !led && (
          <section className="pj-room" aria-label="Who has arrived">
            <div className="pj-count" aria-live="polite">
              <b><Num value={rows.length} /></b>
              <span>{rows.length === 1 ? 'student in the room' : 'students in the room'}</span>
              {/* Styled here: the code screen's sheet (live.css) is not this file's. */}
              <span className="pj-count-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '0.85em' }}>
                <Icon name="check" size={14} />Phone browsers, no installs
              </span>
            </div>
            <div className="pj-tray">
              <Marbles rows={rows} tray height={132} caption={false} />
            </div>
          </section>
        )}
      </main>

      <footer className="pj-foot">
        <span><Icon name="eyeOff" size={15} />Scores are never shown on this screen. It only shows who has arrived.</span>
        <span className="pj-esc"><span className="kbd">Esc</span>back to the class</span>
      </footer>
    </div>
  );
}
