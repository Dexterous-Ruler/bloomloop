/**
 * The room, on the projector. It has the whole window, because it is read from
 * the back of a hall and its one job is getting forty phones in: where to go,
 * the code, a QR for the phones that would rather scan.
 *
 * Along the bottom the room fills up: each student who joins drops a marble
 * into the tray, so the class can see itself arrive.
 */

import { useEffect, useState } from 'react';

import Marbles from '../fx/Marbles.jsx';
import { ThemeToggle } from '../shell/AppShell.jsx';
import { Button, Chip, Icon, Loop, Note, Num } from '../ui/index.jsx';
import useRoomFeed from './useRoomFeed.js';

export default function Projector({ session, content, activeCount, onLive }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const { rows } = useRoomFeed(session.code);

  // Built from the browser's own origin, so it shows the address the phones
  // actually need rather than "localhost".
  const joinUrl = `${window.location.origin}/join/${session.code}`;
  // After a mid-class reload the bank has not been fetched again, so the count
  // the server handed back with the room is the one that is still true.
  const bankCount = session.bankCount ?? activeCount;

  // The QR encoder is imported only here, so no phone ever downloads it.
  useEffect(() => {
    let alive = true;
    import('qrcode')
      .then((m) => m.toDataURL(joinUrl, { margin: 0, width: 360, errorCorrectionLevel: 'M' }))
      .then((url) => { if (alive) setQr(url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [joinUrl]);

  function copy(value, what) {
    navigator.clipboard?.writeText(value).then(
      () => { setCopied(what); setTimeout(() => setCopied(''), 1600); },
      () => setError('Could not copy. Read it off the screen instead.'),
    );
  }

  return (
    <div className="proj">
      <header className="proj-bar">
        <span className="brand"><Loop size={24} /><span>BloomLoop</span></span>
        <span className="muted clip">{session.title || content?.title || 'Live room'}{bankCount ? ` · ${bankCount} questions` : ''}</span>
        <span className="push cluster">
          <Chip tone="ok" dot>Room open</Chip>
          <ThemeToggle />
          <Button variant="primary" onClick={onLive}>Go to the class<Icon name="forward" /></Button>
        </span>
      </header>

      <main className="proj-main">
        <div className="proj-how">
          <div className="stack stack-2">
            <span className="proj-label">On any phone, go to</span>
            <span className="proj-url">{joinUrl.replace(/^https?:\/\//, '')}</span>
          </div>
          <div className="stack stack-3">
            <span className="proj-label">Room code</span>
            <div className="proj-code" aria-label={`Room code ${session.code.split('').join(' ')}`}>
              {session.code.split('').map((ch, i) => <span key={`${ch}-${i}`}>{ch}</span>)}
            </div>
          </div>
          <div className="cluster">
            <Button icon={copied === 'code' ? 'check' : 'copy'} onClick={() => copy(session.code, 'code')}>{copied === 'code' ? 'Copied' : 'Copy the code'}</Button>
            <Button icon={copied === 'url' ? 'check' : 'link'} onClick={() => copy(joinUrl, 'url')}>{copied === 'url' ? 'Copied' : 'Copy the link'}</Button>
          </div>
          {error && <Note tone="bad">{error}</Note>}
        </div>

        {/* A white card, not a bare image: the encoder is given no quiet zone,
            so the padding is what makes the code scannable at all. */}
        <div className="proj-qr">
          <div className="proj-qr-card">
            {qr ? <img src={qr} alt={`QR code for ${joinUrl}`} width={280} height={280} /> : <div className="skel" style={{ width: 280, height: 280 }} />}
          </div>
          <span className="proj-label">or scan this</span>
        </div>
      </main>

      <footer className="proj-foot">
        <div className="proj-count">
          <b><Num value={rows.length} /></b>
          <span>{rows.length === 1 ? 'student in the room' : 'students in the room'}</span>
        </div>
        <div className="proj-tray">
          <Marbles rows={rows} tray height={96} caption={false} />
        </div>
      </footer>
    </div>
  );
}
