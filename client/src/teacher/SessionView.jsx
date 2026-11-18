import { useEffect, useState } from 'react';

import { api } from '../api.js';
import Icon from '../ui/Icon.jsx';
import { Empty, LogoTile, PageHead } from '../ui/Shell.jsx';

/* T6. Two screens in one file. Before a room exists this is an ordinary console
   page sitting inside the Shell; the moment one is open the console hands the
   whole viewport over, because from that point the screen is being projected to
   the class and its only job is getting forty phones in. */
export default function SessionView({ content, activeCount, session, onSession, onLive, onBack }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [qr, setQr] = useState('');

  // Built from the browser's own origin so it shows the LAN address the phones
  // actually need, not "localhost" — the most common way a classroom demo fails.
  const joinUrl = session ? `${window.location.origin}/join/${session.code}` : '';

  // qrcode is imported only here, so the student bundle never carries it. It is
  // asked for no colours: every colour in this product comes out of styles.css,
  // and the encoder's own black-on-white is what a cheap camera reads fastest.
  useEffect(() => {
    if (!joinUrl) return undefined;
    let alive = true;
    import('qrcode')
      .then((m) => m.toDataURL(joinUrl, { margin: 0, width: 320, errorCorrectionLevel: 'M' }))
      .then((url) => alive && setQr(url))
      .catch(() => {});
    return () => { alive = false; };
  }, [joinUrl]);

  async function start() {
    setError('');
    setBusy(true);
    try { onSession(await api.createSession(content.contentId, content.title)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function copy(value, what) {
    navigator.clipboard?.writeText(value).then(
      () => { setCopied(what); setTimeout(() => setCopied(''), 1600); },
      () => setError('Could not copy — read it off the screen instead.'),
    );
  }

  if (!session) {
    return (
      <>
        <PageHead
          title="Open the room"
          sub="Nothing is live yet — students cannot join until a room is open."
          onBack={onBack}
        />

        {activeCount === 0 ? (
          <Empty
            icon="layers"
            title="No questions to run"
            action={
              <button type="button" className="btn pri" onClick={onBack}>
                <Icon name="back" size={13} />
                Back to the question bank
              </button>
            }
          >
            A room hands every phone its next question out of the bank behind it. Build one first and
            the room opens on exactly the questions you kept.
          </Empty>
        ) : (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', paddingBottom: 20 }}>
            <div className="panel" style={{ width: '100%', maxWidth: 560, padding: '24px 24px 26px' }}>
              <div className="eyebrow on-d">Ready to project</div>

              <div className="accent" style={{ marginTop: 14 }}>
                <div className="k">Material this room runs on</div>
                <h2 style={{ marginTop: 6 }}>{content?.title || 'The loaded chapter'}</h2>
                <div className="tiles" style={{ marginTop: 16 }}>
                  <div className="accent-tile">
                    <b>{activeCount}<Icon name="layers" size={11} /></b>
                    <span>Questions kept</span>
                  </div>
                  <div className="accent-tile">
                    <b>{content?.topics?.length ?? '—'}<Icon name="list" size={11} /></b>
                    <span>Topics in the chapter</span>
                  </div>
                  <div className="accent-tile">
                    <b>6<Icon name="chart" size={11} /></b>
                    <span>Bloom levels in play</span>
                  </div>
                </div>
              </div>

              <div className="panel-sub" style={{ marginTop: 18 }}>
                Opening mints a six-character code and puts it on the projector. Students join from any
                phone browser with the code and their roll number — no app, no account.
              </div>

              {error && (
                <div className="note dk" style={{ marginTop: 16 }}>
                  <Icon name="alert" size={15} />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="button"
                className="btn on-d solid lg block"
                style={{ marginTop: 18 }}
                onClick={start}
                disabled={busy || activeCount === 0}
              >
                {busy ? <span className="spin" /> : <Icon name="broadcast" size={14} />}
                {busy ? 'Opening the room…' : 'Open the room'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // After a mid-class reload the bank has not been fetched again, so the count
  // the server handed back with the session is the one that is still true.
  const bankCount = session.bankCount ?? activeCount;

  return (
    <div className="projector">
      <div className="pbar">
        <div className="row" style={{ gap: 12 }}>
          <LogoTile />
          <div>
            <h3>BloomLoop</h3>
            <div className="panel-sub" style={{ marginTop: 3 }}>
              {session.title || content?.title || 'Live room'}
              {bankCount ? ` · ${bankCount} questions in the bank` : ''}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <span className="flag ok">
            <i
              style={{
                width: 7, height: 7, display: 'block', borderRadius: 'var(--r-pill)',
                background: 'var(--ok)', animation: 'bl-pulse 1.4s ease-in-out infinite',
              }}
            />
            Room open
          </span>
          <button type="button" className="btn on-d solid" onClick={onLive}>
            Go to the classroom
            <Icon name="forward" size={13} />
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          gap: 'clamp(32px, 6vw, 72px)', padding: 'clamp(24px, 4vh, 44px) clamp(24px, 6vw, 56px)',
        }}
      >
        <div style={{ flex: 1, minWidth: 320 }}>
          {/* The eyebrows are pushed well past their console size on purpose: at
              thirty feet a 10px label is not a label, it is a smudge. */}
          <div className="eyebrow on-d" style={{ fontSize: 13, letterSpacing: '0.22em' }}>On any phone, go to</div>
          <div className="joinurl" style={{ marginTop: 14 }}>{joinUrl.replace(/^https?:\/\//, '')}</div>

          <div className="eyebrow on-d" style={{ marginTop: 40, fontSize: 13, letterSpacing: '0.22em' }}>Room code</div>
          <div className="codetiles" style={{ marginTop: 18 }}>
            {session.code.split('').map((ch, i) => <span key={`${ch}-${i}`}>{ch}</span>)}
          </div>

          <div className="row" style={{ gap: 10, marginTop: 32 }}>
            <button type="button" className="btn on-d" onClick={() => copy(session.code, 'code')}>
              <Icon name={copied === 'code' ? 'check' : 'copy'} size={13} />
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </button>
            <button type="button" className="btn on-d" onClick={() => copy(joinUrl, 'url')}>
              <Icon name={copied === 'url' ? 'check' : 'link'} size={13} />
              {copied === 'url' ? 'Copied' : 'Copy join link'}
            </button>
          </div>

          {error && (
            <div className="note dk" style={{ marginTop: 20, maxWidth: 460 }}>
              <Icon name="alert" size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {/* White card, not a bare image: the encoder is given no quiet zone, so
              the card's padding is what makes the code scannable at all. */}
          <div className="card" style={{ padding: 18 }}>
            {qr
              ? <img src={qr} alt={`QR code for ${joinUrl}`} width={240} height={240} style={{ display: 'block' }} />
              : <div className="skel" style={{ width: 240, height: 240 }} />}
          </div>
          <div className="panel-sub">Or point a phone camera at this</div>
        </div>
      </div>

      <div className="steps">
        <div><b>01</b><span>Open that address in your phone browser. Any browser — no app, no sign-in.</span></div>
        <div><b>02</b><span>Type the six-character room code, then your roll number.</span></div>
        <div><b>03</b><span>Answer whatever appears. Your questions are yours alone — they follow the level you are working at.</span></div>
      </div>
    </div>
  );
}
