import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { signUp, supabase } from '../auth.js';
import Icon from '../ui/Icon.jsx';
import { AuthSplit, HOME_FOR, LINK, PasswordField } from './SignIn.jsx';

const MIN_PASSWORD = 8;
const CODE_LENGTH = 8;

/* The whole hierarchy travels inside the code, so the aside states it plainly.
   Nothing on this form lets anyone choose their own place in it, and a form that
   asks for a name and an email while silently deciding a role is the kind of
   thing people only notice once it has gone wrong. */
const CHAIN = [
  { role: 'Head of department', does: 'Issues the invite a professor redeems' },
  { role: 'Professor', does: 'Issues the invite a student redeems' },
  { role: 'Student', does: 'Redeems, and only ever sees their own results' },
];

function Chain() {
  return (
    <div style={{ marginTop: 32 }}>
      <div className="eyebrow on-d">Who invites whom</div>
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {CHAIN.map((step, i) => (
          <div key={step.role} className="accent-tile">
            <b>
              {step.role}
              {i < CHAIN.length - 1 && <Icon name="chevron" size={12} />}
            </b>
            <span>{step.does}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SignUp({ onSignedUp }) {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const configured = Boolean(supabase);
  const ready = configured
    && !busy
    && Boolean(fullName.trim())
    && Boolean(email.trim())
    && password.length >= MIN_PASSWORD
    && inviteCode.trim().length === CODE_LENGTH;

  async function submit(event) {
    event.preventDefault();
    if (!ready) return;
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
    <AuthSplit
      blurb="One invite, one account. The code you were given already carries your role, your department and who you report to — none of that is yours to pick."
      foot="Single use, and it lapses two weeks after it was issued. If yours has, ask for a fresh one."
      aside={<Chain />}
    >
      <form className="auth-form" onSubmit={submit}>
        <div className="eyebrow">BloomLoop</div>
        <h1 style={{ marginTop: 14, fontSize: 34 }}>Redeem your invite</h1>
        <div className="hint" style={{ marginTop: 10, fontSize: 13 }}>
          The code decides who you are here. The three fields under it are just your name.
        </div>

        {!configured && (
          <div className="note warn" style={{ marginTop: 24 }}>
            <Icon name="alert" size={15} />
            <span>
              Accounts are not configured on this build, so invites cannot be redeemed here yet.{' '}
              <Link to="/" style={LINK}>Use a teacher key →</Link>
            </span>
          </div>
        )}

        {/* The code gets a block of its own because it is the only field here
            that the account actually hangs on — the other three describe a
            person, this one describes a position. */}
        <div className="card outline" style={{ marginTop: 26 }}>
          <div className="cardhead" style={{ marginBottom: 10 }}>
            <label className="lab grow" htmlFor="signup-code" style={{ marginBottom: 0 }}>
              Invite code
            </label>
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-5)' }}>
              {inviteCode.length}/{CODE_LENGTH}
            </span>
          </div>
          <input
            id="signup-code"
            className="mono"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck="false"
            maxLength={CODE_LENGTH}
            required
            autoFocus
            disabled={!configured}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase().trim())}
            style={{ height: 52, fontSize: 17, fontWeight: 700, letterSpacing: '0.2em' }}
          />
          <div className="hint">
            {CODE_LENGTH} characters, single use, and it expires two weeks after it was issued. Your
            head of department or your professor has it.
          </div>
        </div>

        <div className="field" style={{ marginTop: 20 }}>
          <label htmlFor="signup-name">Full name</label>
          <input
            id="signup-name"
            autoComplete="name"
            required
            disabled={!configured}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            disabled={!configured}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <PasswordField
          id="signup-password"
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          disabled={!configured}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {/* Verbatim. The server writes these to be read by whoever is holding
            the code — which invite, why it was refused, who to go back to — and
            paraphrasing them here would strip exactly that. */}
        {error && (
          <div className="note bad" role="alert" style={{ marginTop: 4 }}>
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="btn pri lg block" style={{ marginTop: 20 }} disabled={!ready}>
          {busy ? (
            <><span className="spin" /> Creating your account…</>
          ) : (
            <>Create account <Icon name="forward" size={13} /></>
          )}
        </button>

        <div className="hint" style={{ marginTop: 18, fontSize: 13 }}>
          Already have an account? <Link to="/signin" style={LINK}>Sign in →</Link>
        </div>

        <div style={{ marginTop: 26, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
          <div className="said">
            <span>
              Nothing here is needed to sit a test. Students join a live room with the 6-character
              code on the projector and their roll number.{' '}
              <Link to="/join" style={LINK}>Take me to the room →</Link>
            </span>
          </div>
        </div>
      </form>
    </AuthSplit>
  );
}
