/**
 * Sign in. Heads of department, professors and students all come through this
 * one form: the server answers with the role, and the role picks where you land.
 *
 * The view is pure, so the gallery can draw its states with no account service
 * behind it. The container owns the form and the one request.
 *
 * There is no "Continue with Google" here, on purpose: lib/auth.js signs in
 * with email and password only, and keeps OAuth redirects out so no token ever
 * sits in the address bar. A Google button would be a control that does
 * nothing. Google appears on the profile, where an account links to it.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { signIn, supabase } from '../lib/auth.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { HOME_FOR } from '../lib/routes.js';
import ThemeToggle from '../shell/ThemeToggle.jsx';
import { Button, Field, Flow, Icon, Mark, Note, Tip } from '../ui/index.jsx';

/** What the product does, in the mono strip along the foot of the art half. */
const STRIP = ['Six Bloom levels', 'Picked per student', 'Nobody ranked'];

/**
 * The two doors share a frame: the forest half says what BloomLoop is, the
 * page half holds the form. `title` is the one strong line on the art.
 */
export function AuthFrame({ title, line, foot, label, children }) {
  return (
    <div className="gate au-gate">
      <section className="gate-art on-panel au-art" aria-label="BloomLoop">
        <Flow />
        <span className="brand">
          <Mark size={28} />
          <span className="brand-name">BloomLoop</span>
        </span>

        <div className="au-art-body">
          <h1>{title}</h1>
          {line && <p className="gate-art-extra">{line}</p>}
        </div>

        {/* The climb: six rungs, each in its level colour with its name. */}
        <div className="au-ladder gate-art-extra" aria-hidden="true">
          {LEVELS.map((l) => (
            <div key={l} data-level={l}><i /><span>{LABEL[l]}</span></div>
          ))}
        </div>

        <div className="au-strip">
          <b>How it works</b>
          {STRIP.map((s) => <span key={s}>{s}</span>)}
        </div>
      </section>

      <div className="gate-side">
        <div className="gate-top"><ThemeToggle /></div>
        <main className="gate-main" aria-label={label}>{children}</main>
        <div className="gate-foot au-foot">{foot}</div>
      </div>
    </div>
  );
}

/**
 * A password box with a reveal toggle. Shared with sign-up: without it people
 * check what they typed by pasting it into the email field.
 */
export function PasswordField({ id, label, hint, autoComplete, minLength, disabled, value, onChange, invalid, describedBy }) {
  const [reveal, setReveal] = useState(false);
  const action = reveal ? 'Hide password' : 'Show password';
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="au-pass">
        <input
          id={id}
          className="input input-lg"
          type={reveal ? 'text' : 'password'}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          disabled={disabled}
          value={value}
          onChange={onChange}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
        <Tip label={action}>
          <Button
            variant="ghost"
            size="sm"
            icon={reveal ? 'eyeOff' : 'eye'}
            className="au-reveal"
            aria-label={action}
            aria-pressed={reveal}
            disabled={disabled}
            onClick={() => setReveal((on) => !on)}
          />
        </Tip>
      </div>
    </Field>
  );
}

/** A way in that is not this form. */
function Door({ to, icon, title, line }) {
  return (
    <Link className="au-door" to={to}>
      <span className="au-door-ic"><Icon name={icon} /></span>
      <span className="au-door-text"><b>{title}</b><small>{line}</small></span>
      <Icon name="chevronRight" className="au-door-go" />
    </Link>
  );
}

export function SignInView({ configured, email, password, busy, error, onEmail, onPassword, onSubmit }) {
  const ready = configured && !busy && Boolean(email.trim()) && Boolean(password);
  const errId = error ? 'signin-error' : undefined;

  return (
    <AuthFrame
      label="Sign in"
      title={<>Every student climbs at their <em>own</em> level.</>}
      line="70% right over the last five answers at a level, and the next question steps up. Mostly wrong, and it steps back. Your class is read one student at a time."
      foot={<>Have an invite code? <Link className="link" to="/signup">Create your account</Link></>}
    >
      <form className="gate-card au-card" onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(); }}>
        <header className="au-title">
          <span className="eyebrow">Sign in</span>
          <h2>Welcome back</h2>
          <p>One form for heads of department, professors and students. Your role comes from your account.</p>
        </header>

        {!configured && (
          <Note icon="alert">
            Accounts are not set up on this build. The console still opens with a teacher key.{' '}
            <Link className="link" to="/">Use a teacher key</Link>
          </Note>
        )}

        <div className="stack">
          <Field label="Email" htmlFor="signin-email">
            <input
              id="signin-email"
              className="input input-lg"
              type="email"
              autoComplete="username"
              autoFocus
              required
              disabled={!configured}
              value={email}
              onChange={(e) => onEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={errId}
            />
          </Field>

          <PasswordField
            id="signin-password"
            label="Password"
            autoComplete="current-password"
            disabled={!configured}
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            invalid={Boolean(error)}
            describedBy={errId}
          />

          {/* Under the field it is about, in the server's words. */}
          {error && (
            <p className="au-error" id="signin-error" role="alert">
              <Icon name="alert" size={15} />{error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" block busy={busy} disabled={!ready}>
            Sign in<Icon name="forward" />
          </Button>
        </div>

        <div className="or">or</div>

        <nav className="au-doors" aria-label="Other ways in">
          <Door to="/join" icon="room" title="Sitting a test?" line="Join a room with its code. No account needed." />
          <Door to="/" icon="key" title="Have a teacher key?" line="Open the console without an account." />
        </nav>
      </form>
    </AuthFrame>
  );
}

export default function SignIn({ onSignedIn }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const account = await signIn(email, password);
      // The role comes back from the server, so the landing route is the
      // server's decision too: the browser only reads it off the answer.
      if (onSignedIn) onSignedIn(account);
      else navigate(HOME_FOR[account?.role] ?? '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign you in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignInView
      configured={Boolean(supabase)}
      email={email}
      password={password}
      busy={busy}
      error={error}
      onEmail={setEmail}
      onPassword={setPassword}
      onSubmit={submit}
    />
  );
}
