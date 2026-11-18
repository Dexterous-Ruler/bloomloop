/**
 * Sign in. Heads of department, professors and students all come through this
 * one form: the server answers with the role, and the role picks where you land.
 *
 * The view is pure, so the gallery can draw its states with no account service
 * behind it. The container owns the form and the one request.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { signIn, supabase } from '../lib/auth.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { HOME_FOR } from '../lib/routes.js';
import { ThemeToggle } from '../shell/AppShell.jsx';
import { Button, Field, Icon, Mark, Note, Tip } from '../ui/index.jsx';

/** Today, the way the art half prints it: "WED 18 NOV 2026". */
function today() {
  const d = new Date();
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/,/g, '').toUpperCase();
}

/**
 * The two doors share a frame: the espresso half says what BloomLoop is, the
 * cream half holds the form. `art` is what sits between the mark and the strip.
 */
export function AuthFrame({ art, strip, foot, label, children }) {
  return (
    <div className="gate au-gate">
      <section className="gate-art on-panel au-art" aria-label="BloomLoop">
        <span className="brand">
          <Mark size={38} />
          <span className="brand-name"><b>BloomLoop</b><small>Questions at the level reached</small></span>
        </span>
        {art}
        <p className="au-strip" aria-label={`Today is ${today()}`}>
          <span>{today()}</span>
          {strip.map((s) => <span key={s}>{s}</span>)}
        </p>
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
 * The climb: six landings, one per level, each tread in its level colour with
 * its number and name beside it. Drawn once on arrival; nothing loops.
 */
function Staircase() {
  return (
    <div className="au-stairs" aria-hidden="true">
      {LEVELS.map((l, i) => (
        <div key={l} className="au-step" data-level={l} style={{ '--i': i }}>
          <span className="au-step-n">{String(i + 1).padStart(2, '0')}</span>
          <span className="au-step-name">{LABEL[l]}</span>
          <i />
        </div>
      ))}
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

export function SignInView({ configured, email, password, busy, error, onEmail, onPassword, onSubmit }) {
  const ready = configured && !busy && Boolean(email.trim()) && Boolean(password);
  const errId = error ? 'signin-error' : undefined;

  return (
    <AuthFrame
      label="Sign in"
      strip={['6 LEVELS', 'ONE FORM FOR EVERY ROLE']}
      art={
        <div className="au-art-body">
          <Staircase />
          <h1>Every student climbs at their <em>own</em> level.</h1>
          <p className="gate-art-extra">
            A few right and the next question steps up. A few wrong and it steps back down. Nobody is
            ranked against the class.
          </p>
        </div>
      }
      foot={<>Have an invite code? <Link className="link" to="/signup">Create your account</Link></>}
    >
      <form className="gate-card au-card" onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(); }}>
        <div className="au-title">
          <span className="eyebrow">Sign in</span>
          <h2>Welcome back</h2>
          <p className="au-lead">Heads of department, professors and students all use this form. Your invite set your role; the server reads it back.</p>
        </div>

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

        <div className="au-doors">
          <Link className="au-door" to="/join">
            <span className="au-door-ic"><Icon name="room" /></span>
            <span className="grow"><b>Sitting a test?</b><small>Join a room with its code. No account needed.</small></span>
            <Icon name="chevronRight" />
          </Link>
          <Link className="au-door" to="/">
            <span className="au-door-ic"><Icon name="key" /></span>
            <span className="grow"><b>Have a teacher key?</b><small>Open the console without an account.</small></span>
            <Icon name="chevronRight" />
          </Link>
        </div>
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
