/**
 * The first screen a student sees, on a cheap phone, in a room where forty
 * people are typing the same code at once: the mark, one line, three fields in
 * one column, one button.
 */

import { useState } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import ThemeToggle from '../shell/ThemeToggle.jsx';
import { Button, Field, Flow, Mark, Note } from '../ui/index.jsx';
import { Conn } from './parts.jsx';

export default function Join({
  initialCode,
  initialRoll,
  initialName,
  // The fields were filled from what this phone last used, not by the person
  // holding it. The only thing that earns "not you" a place on this screen.
  remembered,
  busy,
  error,
  // Said in front of `error`: which attempt the server was answering. The
  // server's own sentence is never rewritten.
  lead,
  status,
  onJoin,
  onForget,
  // Shown in place of the form (batch 9: an exam room's rules, before the join).
  panel,
}) {
  const [code, setCode] = useState(initialCode || '');
  const [rollNo, setRollNo] = useState(initialRoll || '');
  const [name, setName] = useState(initialName || '');

  const ready = code.trim().length === 6 && rollNo.trim().length > 0;

  return (
    <div className="gate ln-gate">
      {/* What this is, in one line, and the climb it is about. */}
      <section className="gate-art on-panel" aria-label="BloomLoop">
        <Flow />
        <span className="brand">
          <Mark size={28} />
          <span className="brand-name">BloomLoop</span>
        </span>
        <h1>Answer at <em>your</em> level.</h1>
        <p className="gate-art-extra">
          Every question is picked for the level you have reached, and moves with you as you answer. No account, no
          ranking against anyone.
        </p>
        <div aria-hidden="true">
          <div className="ln-art-ladder">
            {LEVELS.map((l) => (
              <div key={l} data-level={l}><i /><span>{LABEL[l]}</span></div>
            ))}
          </div>
        </div>
      </section>

      <div className="gate-side">
        <div className="gate-top">
          {/* The socket is up before anyone types. On college wifi that is worth
              showing: a tap on Join into a dead socket teaches nothing. */}
          <Conn status={status} idle />
          <ThemeToggle />
        </div>

        <main className="gate-main">
          {panel || <form
            className="gate-card"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && !busy) {
                onJoin({ code: code.trim().toUpperCase(), rollNo: rollNo.trim().toUpperCase(), name: name.trim() });
              }
            }}
          >
            <div className="stack stack-2">
              <span className="eyebrow"><span className="live-dot" />Join a room</span>
              <h2>Type the code on the board</h2>
            </div>

            {error && <Note tone="bad">{lead ? `${lead} ` : ''}{error}</Note>}

            <div className="stack">
              {/* One wide field, not six boxes: a six-input code widget fights
                  the Android keyboard, loses paste, and gives six small targets
                  where one is needed. */}
              <Field label="Room code" htmlFor="ln-code" hint="Six characters, on your teacher's screen.">
                <input
                  id="ln-code"
                  className="input ln-code"
                  value={code}
                  // Letters and digits only, so a code read aloud as "ABC 123" or pasted
                  // with a gap or a dash still lands as its six characters.
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, 6))}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck="false"
                  autoComplete="off"
                  // Room for a pasted separator; the handler keeps six.
                  maxLength={9}
                  placeholder="······"
                  autoFocus={!initialCode}
                />
              </Field>

              <Field label="Roll number" htmlFor="ln-roll">
                <input
                  id="ln-roll"
                  className="input input-lg mono"
                  value={rollNo}
                  onChange={(e) => setRollNo(e.target.value.replace(/\s+/g, ''))}
                  /* Text, not numeric: roll numbers here look like
                     ADT24SOCB0934, and a digits-only keypad cannot type them. */
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck="false"
                  autoComplete="off"
                  maxLength={24}
                  placeholder="ADT24SOCB0934"
                  autoFocus={Boolean(initialCode) && !initialRoll}
                />
              </Field>

              <Field label="Name" optional htmlFor="ln-name">
                <input
                  id="ln-name"
                  className="input input-lg"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder="So your teacher sees a name"
                />
              </Field>

              <Button type="submit" variant="primary" size="xl" block busy={busy} disabled={!ready}>
                Join the room
              </Button>

              {status !== 'online' && status !== 'lost' && (
                <p className="hint" role="status">Waiting for the connection.</p>
              )}

              {/* The way out of somebody else's identity, on the screen where it
                  is sitting in the boxes. A phone in a lecture hall is often the
                  family's. Clearing costs nothing: the roll number it forgets is
                  the only key to a profile the server holds regardless. */}
              {remembered && (
                <p className="hint">
                  Filled in from the last time this phone joined.{' '}
                  <button type="button" className="ln-quiet" onClick={onForget}>Not you? Start blank</button>
                </p>
              )}
            </div>
          </form>}
        </main>

        <div className="gate-foot">Only your teacher sees your answers. You are never ranked against anyone.</div>
      </div>
    </div>
  );
}
