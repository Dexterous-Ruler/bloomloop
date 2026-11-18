/**
 * The front door of the console. One column: the mark, one sentence, one field.
 * Two ways in, because a build with no accounts configured still has to open
 * with the key the server prints when it starts.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { supabase } from '../lib/auth.js';
import { ThemeToggle } from '../shell/AppShell.jsx';
import { Button, Field, Loop } from '../ui/index.jsx';

export function GateFrame({ children, foot }) {
  return (
    <div className="gate">
      <div className="gate-top">
        <span className="brand"><Loop size={22} /><span>BloomLoop</span></span>
        <ThemeToggle />
      </div>
      <main className="gate-main">
        <div className="gate-card">{children}</div>
      </main>
      <div className="gate-foot">{foot}</div>
    </div>
  );
}

export default function Gate({ onUnlock }) {
  const [draft, setDraft] = useState('');
  const ready = draft.trim().length > 0;

  return (
    <GateFrame
      foot={<>Students do not need a key. <Link className="link" to="/join">Join a room with its code</Link></>}
    >
      <div className="gate-mark">
        <Loop size={56} stroke={7} className="loop-draw" />
        <div className="stack stack-2">
          <h1>Open the teacher console</h1>
          <p className="t-lead">
            Every student gets questions at the level they have reached. You see who moved.
          </p>
        </div>
      </div>

      <form
        className="stack"
        onSubmit={(e) => { e.preventDefault(); if (ready) onUnlock(draft.trim()); }}
      >
        <Field
          label="Teacher key"
          htmlFor="key"
          hint={supabase ? undefined : 'It is printed in the server window when BloomLoop starts.'}
        >
          {/* No placeholder: an example value here is either the real key or
              useless, and the real key in the bundle is readable by anyone. */}
          <input
            id="key"
            className="input input-lg input-code"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" block disabled={!ready}>Open the console</Button>
      </form>

      {supabase && (
        <>
          <div className="or">or</div>
          <Link className="btn btn-lg btn-block" to="/signin">Sign in with your account</Link>
        </>
      )}
    </GateFrame>
  );
}
