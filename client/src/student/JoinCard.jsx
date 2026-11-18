import { useState } from 'react';

import Icon from '../ui/Icon.jsx';
import { Mark } from '../ui/Shell.jsx';

/* S1. Code and roll number. Nothing else.

   This is the first BloomLoop screen a student ever sees, and it is seen on a
   cheap phone in a room where forty people are typing the same code at once, so
   everything here is one column of thumb-sized targets. */
export default function JoinCard({
  initialCode,
  initialRoll,
  initialName,
  // True when the fields were filled in from what this phone last used rather
  // than by the person holding it. It is the only thing that earns the "not
  // you" control a place on the first screen of the product.
  remembered,
  busy,
  error,
  // Context for `error`, said in front of it. The server's own sentence is
  // never rewritten - a student is told exactly what the server said, and this
  // only says which attempt it was answering.
  lead,
  status,
  onJoin,
  onForget,
}) {
  const [code, setCode] = useState(initialCode || '');
  const [rollNo, setRollNo] = useState(initialRoll || '');
  const [name, setName] = useState(initialName || '');

  const ready = code.trim().length === 6 && rollNo.trim().length > 0;

  return (
    <form
      /* flex:1 so the reassurance line at the bottom is pinned to the bottom
         rather than floating under the button on a tall phone. */
      style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) {
          onJoin({ code: code.trim().toUpperCase(), rollNo: rollNo.trim().toUpperCase(), name: name.trim() });
        }
      }}
    >
      {/* The socket is up before anyone types, and on college wifi that is worth
          showing: a student who taps Join into a dead socket learns nothing. */}
      <div className="stu-bar">
        <span className="id">bloomloop</span>
        {status === 'online' ? (
          <span className="st"><i />ready</span>
        ) : (
          <span className="st down"><i />{status === 'connecting' ? 'connecting' : 'reconnecting'}</span>
        )}
      </div>

      <Mark className="lg on-d" />
      <h1 style={{ marginTop: 22, fontSize: 34 }}>BloomLoop</h1>
      <p className="hint" style={{ marginTop: 10, fontSize: 14.5 }}>
        You will get questions aimed at where you actually are. No account needed.
      </p>

      {error && (
        <div className="note dk" style={{ marginTop: 20 }}>
          <Icon name="alert" size={15} />
          <span>{lead ? `${lead} ` : ''}{error}</span>
        </div>
      )}

      {/* One wide monospace field rather than six boxes: a six-input code widget
          fights the Android keyboard, loses paste, and gives six small targets
          where the student only ever needs one. */}
      <div className="field" style={{ marginTop: 30 }}>
        <label htmlFor="code">Room code</label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s+/g, '').toUpperCase().slice(0, 6))}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck="false"
          autoComplete="off"
          maxLength={6}
          placeholder="ABC123"
          aria-label="Room code"
          autoFocus={!initialCode}
          /* textIndent cancels the trailing letter-space so the six characters
             sit optically centred instead of pushed left. */
          style={{ height: 64, fontSize: 27, textAlign: 'center', letterSpacing: '0.34em', textIndent: '0.34em' }}
        />
        <div className="hint">The six characters on your teacher&apos;s screen.</div>
      </div>

      <div className="field">
        <label htmlFor="roll">Roll number</label>
        <input
          id="roll"
          value={rollNo}
          onChange={(e) => setRollNo(e.target.value.replace(/\s+/g, ''))}
          /* Text, not numeric: roll numbers here look like ADT24SOCB0934, and a
             digits-only keypad makes them impossible to type. */
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck="false"
          autoComplete="off"
          maxLength={24}
          placeholder="ADT24SOCB0934"
          autoFocus={Boolean(initialCode) && !initialRoll}
        />
      </div>

      <div className="field">
        <label htmlFor="name">Name <span style={{ color: 'var(--on-d-6)' }}>— optional</span></label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="So your teacher sees a name"
        />
      </div>

      <button type="submit" className="btn lime" style={{ marginTop: 14 }} disabled={!ready || busy}>
        {busy ? <span className="spin" /> : null}
        {busy ? 'Joining…' : 'Join the room'}
      </button>

      {status !== 'online' && (
        <p className="hintline" style={{ textAlign: 'center' }}>Waiting for the connection…</p>
      )}

      {/* The way out of somebody else's identity, on the one screen where it is
          sitting in the boxes in front of you. A phone in a lecture hall is
          often the family's, and the person holding it now needs to be able to
          say the name in the box is not theirs without knowing what a browser
          store is. Clearing it costs nothing: the roll number it forgets is the
          only key to a profile the server is holding regardless. */}
      {remembered && (
        <p className="hintline" style={{ textAlign: 'center' }}>
          Filled in from the last time this phone joined a room.{' '}
          <button type="button" className="stu-quiet" onClick={onForget}>Not you? Start blank</button>
        </p>
      )}

      <div className="stu-said">
        <span>
          Your answers are visible to your teacher only. You are never ranked against anyone.
        </span>
      </div>
    </form>
  );
}
