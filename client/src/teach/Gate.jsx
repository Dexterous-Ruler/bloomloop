/**
 * The front door of the console. A forest half that says what this is, and on
 * the page one field and one button. Two ways in, because a build with no
 * accounts configured still has to open with the key the server prints when
 * it starts.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { supabase } from '../lib/auth.js';
import { ThemeToggle } from '../shell/AppShell.jsx';
import { Button, Field, Flow, Mark } from '../ui/index.jsx';

/**
 * The split frame: the art on forest, the form on the page. `art` replaces
 * the default sentence and ladder.
 */
function GateFrame({ children, foot, art }) {
  return (
    <div className="gate">
      <section className="gate-art on-panel" aria-label="BloomLoop">
        <Flow />
        <span className="brand">
          <Mark size={28} />
          <span className="brand-name">BloomLoop</span>
        </span>
        {art ?? (
          <>
            <div className="stack stack-3">
              <h1>Every student, at the level they have <em>reached</em>.</h1>
              <p className="gate-art-extra">
                Questions are picked for the level each student has reached and move with them as they answer. The
                teacher sees who moved, level by level.
              </p>
            </div>
            <div className="tc-gate-ladder" aria-hidden="true">
              {LEVELS.map((l) => (
                <div key={l} data-level={l}><i /><span>{LABEL[l]}</span></div>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="gate-side">
        <div className="gate-top"><ThemeToggle /></div>
        <main className="gate-main">
          <div className="gate-card">{children}</div>
        </main>
        <div className="gate-foot">{foot}</div>
      </div>
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
      <form
        className="tc-gate-form"
        onSubmit={(e) => { e.preventDefault(); if (ready) onUnlock(draft.trim()); }}
      >
        <div className="stack stack-2">
          <span className="eyebrow">Teacher console</span>
          <h2>Open the console</h2>
          <p className="t-lead">Read a chapter, write the questions, open a room. The key keeps it yours.</p>
        </div>

        <Field
          label="Teacher key"
          htmlFor="key"
          hint={supabase ? undefined : 'It is printed in the server window when BloomLoop starts.'}
        >
          {/* No placeholder: an example value here is either the real key or
              useless, and the real key in the bundle is readable by anyone. */}
          <input
            id="key"
            type="password"
            className="input input-lg input-code"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Button type="submit" variant="primary" size="xl" block disabled={!ready}>Open the console</Button>

        {supabase && (
          <>
            <div className="or">or</div>
            <Link className="btn btn-lg btn-block" to="/signin">Sign in with your account</Link>
          </>
        )}
      </form>
    </GateFrame>
  );
}
