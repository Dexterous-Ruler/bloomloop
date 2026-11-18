import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { signIn, supabase } from '../auth.js';
import { LEVELS, LABEL, tagClass } from '../bloom.js';
import Icon from '../ui/Icon.jsx';
import { Mark } from '../ui/Shell.jsx';

/**
 * Where each role lands after signing in (V2-CONTRACT section 5), and the same
 * map the route guard in main.jsx bounces a wrong-role visitor towards. One
 * table for both, so a role can never be signed in to a screen the guard would
 * immediately move it out of.
 *
 * A professor lands on /home rather than on the console: the console is a job of
 * work, and what a professor opens on a Monday is the overview in front of it.
 * The console is still one click away from there.
 */
export const HOME_FOR = { hod: '/admin', professor: '/home', student: '/me' };

/** A link sitting inside a sentence. `a` already carries the brand colour. */
export const LINK = { fontWeight: 700, textDecoration: 'underline' };

/* The same split the teacher-key gate wears: the product on the dark left, one
   short form on the right. It lives here rather than in a file of its own
   because routing owns everything else in this folder, and the two auth screens
   are the only things that will ever wear it.

   No breakpoint work to do here — styles.css drops .auth-aside below 980px, so
   on a phone an invited student gets the form and nothing else. */
export function AuthSplit({ blurb, foot, aside, children }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <div>
          <Mark className="lg on-d" />
          <h1>BloomLoop</h1>
          <p>{blurb}</p>
          {aside}
        </div>
        <div className="auth-foot">{foot}</div>
      </aside>

      <main className="auth-main">{children}</main>
    </div>
  );
}

/**
 * A password box with a reveal toggle. Shared with sign-up: without it people
 * check what they typed by pasting it into the email field, which is worse for
 * everyone than a button that says what it does.
 */
export function PasswordField({ id, label, hint, autoComplete, minLength, disabled, value, onChange }) {
  const [reveal, setReveal] = useState(false);
  const action = reveal ? 'Hide password' : 'Show password';
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {/* The toggle sits on top of the input rather than beside it: a 46px box
          with a button next to it stops lining up with the fields above it. */}
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={reveal ? 'text' : 'password'}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          disabled={disabled}
          value={value}
          onChange={onChange}
          style={{ paddingRight: 46 }}
        />
        <button
          type="button"
          className="iconbtn"
          onClick={() => setReveal((on) => !on)}
          disabled={disabled}
          title={action}
          aria-label={action}
          style={{ position: 'absolute', top: 6, right: 6 }}
        >
          <Icon name={reveal ? 'eyeOff' : 'eye'} size={15} />
        </button>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/* The ramp, on the way in. Every screen behind this door is organised by these
   six words, so they are the first thing the product says about itself. */
function Ramp() {
  return (
    <div style={{ marginTop: 32 }}>
      <div className="eyebrow on-d">The six levels</div>
      <div className="row" style={{ gap: 6, marginTop: 12 }}>
        {LEVELS.map((level) => (
          <span key={level} className={`${tagClass(level)} sm`}>{LABEL[level]}</span>
        ))}
      </div>
    </div>
  );
}

export default function SignIn({ onSignedIn }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const configured = Boolean(supabase);
  const ready = configured && !busy && Boolean(email.trim()) && Boolean(password);

  async function submit(event) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const account = await signIn(email, password);
      // The role comes back from the server, so the landing route is the
      // server's decision too — the browser only reads it off the answer.
      if (onSignedIn) onSignedIn(account);
      else navigate(HOME_FOR[account?.role] ?? '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign you in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthSplit
      blurb="Sign in to your department account. What you can see is decided by your role, and your role was set when your invite was issued."
      foot="Your department, your students, your question banks."
      aside={<Ramp />}
    >
      <form className="auth-form" onSubmit={submit}>
        <div className="eyebrow">BloomLoop</div>
        <h1 style={{ marginTop: 14, fontSize: 34 }}>Sign in</h1>
        <div className="hint" style={{ marginTop: 10, fontSize: 13 }}>
          Heads of department, professors and students all come through this one form.
        </div>

        {!configured && (
          <div className="note warn" style={{ marginTop: 24 }}>
            <Icon name="alert" size={15} />
            <span>
              Accounts are not configured on this build. The console still opens with a teacher key.{' '}
              <Link to="/" style={LINK}>Use a teacher key →</Link>
            </span>
          </div>
        )}

        <div className="field" style={{ marginTop: 26 }}>
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            disabled={!configured}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <PasswordField
          id="signin-password"
          label="Password"
          autoComplete="current-password"
          disabled={!configured}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <div className="note bad" role="alert" style={{ marginTop: 4 }}>
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="btn pri lg block" style={{ marginTop: 20 }} disabled={!ready}>
          {busy ? (
            <><span className="spin" /> Signing in…</>
          ) : (
            <>Sign in <Icon name="forward" size={13} /></>
          )}
        </button>

        <div className="hint" style={{ marginTop: 18, fontSize: 13 }}>
          Been given an invite code? <Link to="/signup" style={LINK}>Create your account →</Link>
        </div>

        {/* Without this a student who typed the bare address lands on a form
            they have no credentials for and no way across. */}
        <div style={{ marginTop: 26, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
          <div className="said">
            <span>
              Joining a live session does not need an account — a 6-character room code and your
              roll number are enough.{' '}
              <Link to="/join" style={LINK}>Take me to the room →</Link>
            </span>
          </div>
        </div>
      </form>
    </AuthSplit>
  );
}
