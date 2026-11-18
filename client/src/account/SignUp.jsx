/**
 * Redeem an invite. Two steps, in the order the account is actually decided:
 * the code first, because it carries the role, the department and the
 * reporting line, then the three things that describe a person.
 *
 * The server checks the code and creates the account in one request, so the
 * browser cannot know what a code is worth before the second step is sent.
 * The first step therefore only checks the shape, and the second says so.
 */

import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { signUp, supabase } from '../lib/auth.js';
import { useEnter } from '../lib/motion.js';
import { HOME_FOR } from '../lib/routes.js';
import { GateFrame } from '../teach/Gate.jsx';
import { Button, Field, Loop, Note } from '../ui/index.jsx';
import { PasswordField } from './SignIn.jsx';

const MIN_PASSWORD = 8;
const CODE_LENGTH = 8;

const HEAD = {
  code: { title: 'Redeem your invite', lead: 'The code you were given decides your role.' },
  details: { title: 'Your details', lead: 'Your name, and how you will sign in.' },
};

export function SignUpView({
  configured, step, code, fullName, email, password, busy, error,
  onCode, onFullName, onEmail, onPassword, onContinue, onBack, onSubmit,
}) {
  const body = useRef(null);
  useEnter(body, step);

  const codeReady = configured && code.length === CODE_LENGTH;
  const ready = codeReady
    && !busy
    && Boolean(fullName.trim())
    && Boolean(email.trim())
    && password.length >= MIN_PASSWORD;

  return (
    <GateFrame
      foot={
        <div className="au-foot">
          <span>Already have an account? <Link className="link" to="/signin">Sign in</Link></span>
          <span>Sitting a test needs no account. <Link className="link" to="/join">Join a room</Link></span>
          <span>Have a teacher key? <Link className="link" to="/">Open the console</Link></span>
        </div>
      }
    >
      <div className="gate-mark">
        <Loop size={56} stroke={7} className="loop-draw" />
        <div className="stack stack-2">
          <div>
            <p className="eyebrow">Step {step === 'code' ? 1 : 2} of 2</p>
            <h1>{HEAD[step].title}</h1>
          </div>
          <p className="t-lead au-balance">{HEAD[step].lead}</p>
        </div>
      </div>

      {!configured && (
        <Note icon="alert">
          Accounts are not set up on this build, so an invite cannot be redeemed here.{' '}
          <Link className="link" to="/">Use a teacher key</Link>
        </Note>
      )}

      {step === 'code' ? (
        <form key="code" ref={body} className="stack" onSubmit={(e) => { e.preventDefault(); if (codeReady) onContinue(); }}>
          <div className="field">
            <div className="au-labelrow">
              <label className="label" htmlFor="signup-code">Invite code</label>
              <span className="t-meta mono num">{code.length}/{CODE_LENGTH}</span>
            </div>
            {/* No placeholder: an example here would read as a code that works. */}
            <input
              id="signup-code"
              className="input input-lg input-code au-code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={CODE_LENGTH}
              required
              autoFocus
              disabled={!configured}
              value={code}
              onChange={(e) => onCode(e.target.value.toUpperCase().trim())}
            />
            <div className="hint">
              {CODE_LENGTH} characters, single use. It lapses two weeks after it was issued; ask for a fresh one if yours has.
            </div>
          </div>

          <Button type="submit" variant="primary" size="lg" block disabled={!codeReady}>Continue</Button>

          <p className="said">
            A head of department invites professors, and a professor invites students. The code says
            which you are.
          </p>
        </form>
      ) : (
        <form key="details" ref={body} className="stack" onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(); }}>
          <div className="well stack stack-3">
            <div className="au-receipt">
              <div className="stack stack-1">
                <span className="t-meta">Invite code</span>
                <span className="au-receipt-code">{code}</span>
              </div>
              <Button size="sm" disabled={busy} onClick={onBack}>Change</Button>
            </div>
            <p className="t-small dim">
              Your role, your department and who you report to come from this code. It is checked
              when you create the account.
            </p>
          </div>

          <Field label="Full name" htmlFor="signup-name">
            <input
              id="signup-name"
              className="input input-lg"
              autoComplete="name"
              autoFocus
              required
              disabled={!configured}
              value={fullName}
              onChange={(e) => onFullName(e.target.value)}
            />
          </Field>

          <Field label="Email" htmlFor="signup-email">
            <input
              id="signup-email"
              className="input input-lg"
              type="email"
              autoComplete="email"
              required
              disabled={!configured}
              value={email}
              onChange={(e) => onEmail(e.target.value)}
            />
          </Field>

          <PasswordField
            id="signup-password"
            label="Password"
            hint={`At least ${MIN_PASSWORD} characters.`}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            disabled={!configured}
            value={password}
            onChange={(e) => onPassword(e.target.value)}
          />

          {/* Verbatim. The server writes these for whoever is holding the code:
              which invite, why it was refused, who to go back to. */}
          {error && <Note tone="bad" role="alert">{error}</Note>}

          <Button type="submit" variant="primary" size="lg" block busy={busy} disabled={!ready}>Create account</Button>
        </form>
      )}
    </GateFrame>
  );
}

export default function SignUp({ onSignedUp }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('code');
  const [inviteCode, setInviteCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const account = await signUp({ email, password, fullName, inviteCode });
      if (onSignedUp) onSignedUp(account);
      else navigate(HOME_FOR[account?.role] ?? '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignUpView
      configured={Boolean(supabase)}
      step={step}
      code={inviteCode}
      fullName={fullName}
      email={email}
      password={password}
      busy={busy}
      error={error}
      onCode={setInviteCode}
      onFullName={setFullName}
      onEmail={setEmail}
      onPassword={setPassword}
      onContinue={() => setStep('details')}
      onBack={() => { setError(''); setStep('code'); }}
      onSubmit={submit}
    />
  );
}
