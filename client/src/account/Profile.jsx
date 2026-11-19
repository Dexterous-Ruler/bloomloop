/**
 * Who you are here, and what you are connected to.
 *
 * The person is the heading: name, role, and under it one forest panel, the
 * ID card, with the BloomLoop ID that identifies them across the product and
 * the facts the account carries. Under that sit the Google connections, one
 * row each, every row saying the state it is really in. A browser that opened
 * the console with the shared teacher key has no person to show, so it gets
 * one note saying what a key is, and the Classroom row a key can still use.
 *
 * The access list is the server's own `canSee` answer with labels on it. It is
 * not restated here: if a hand-written list and the server ever disagreed, the
 * screen would be the one lying.
 *
 * The view is pure. The container does the asking, and every request settles
 * its row whether it succeeds or fails: a check that failed is an answer.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, teacherKey } from '../lib/api.js';
import { supabase } from '../lib/auth.js';
import { ROLE_LABEL } from '../lib/routes.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import { useLaptop } from '../teach/laptop.jsx';
import { Avatar, Button, Chip, Empty, Icon, Note, Panel, Section } from '../ui/index.jsx';

const ROLE_BLURB = {
  hod: 'You read everything in your department and invite professors. You cannot edit another teacher’s material.',
  professor: 'You build question banks, run rooms and invite students. You see your own classes only.',
  student: 'You sit sessions and see your own results. Nothing you do here can change a mark.',
};

/** Wording for the server's canSee flags. Labels only: the server decides. */
const CAN_SEE_LABEL = {
  team: 'People you can see',
  content: 'Question banks',
  sessions: 'Sessions',
  liveGrid: 'Live classroom grid',
  runSessions: 'Can open a room',
  takeSessions: 'Can sit a session',
  exports: 'CSV exports',
  invite: 'Can invite',
};

const VALUE_LABEL = {
  department: 'Everyone in your department',
  'own-students': 'Your own students',
  'read-department': 'Read across the department',
  'crud-own': 'Create, edit and delete your own',
  own: 'Your own',
  professor: 'Professors',
  student: 'Students',
  none: 'No',
  self: 'Your own',
};

const pretty = (v) => {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  // The server sends null for "this does not apply to you": a student has
  // nobody to invite.
  if (v == null) return 'Not for this role';
  return VALUE_LABEL[v] ?? String(v);
};

/** Quiet when the answer is a no, so the yeses are what the eye lands on. */
const isNo = (v) => v === false || v == null || v === 'none';

const NO_CREDENTIALS = 'This server has no Google credentials.';

/** Copies, and says so: a silent copy looks the same as a dead button. */
function CopyButton({ text, variant }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Button
      size="sm"
      variant={variant}
      icon={done ? 'check' : 'copy'}
      aria-label={done ? 'Copied' : 'Copy your BloomLoop ID'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          // The clipboard is permission-gated and blocked in some in-app
          // browsers. The code is on screen either way.
        }
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

/** One line of the ID card. An empty value says so instead of leaving a gap. */
function Fact({ label, mono, children }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono && children ? 'mono' : undefined}>{children || <span className="au-unset">Not set</span>}</dd>
    </div>
  );
}

/** One connection: what it is, the state it is in, and what can be done about it. */
function Connection({ title, state, tone, line, checking, actions, children }) {
  return (
    <div className="au-conn" aria-busy={checking || undefined}>
      <span className="au-conn-ic"><Icon name="google" size={18} /></span>
      <div className="au-conn-text">
        <div className="au-conn-top">
          <h3>{title}</h3>
          {checking
            ? <span className="skel au-skel-chip" />
            : <Chip tone={tone} icon={tone === 'ok' ? 'check' : undefined}>{state}</Chip>}
        </div>
        {checking
          ? <><span className="skel au-skel-line" /><span className="sr-only">Checking</span></>
          : <p>{line}</p>}
      </div>
      {actions ? <div className="au-conn-acts">{actions}</div> : <span />}
      {children && <div className="au-conn-foot">{children}</div>}
    </div>
  );
}

/** The teacher's connection: the one that posts grades. */
function ClassroomRow({ classroom, busy, onConnect, onRetry }) {
  const title = 'Google Classroom';
  if (classroom === null) return <Connection title={title} checking />;
  if (classroom.failed) {
    return (
      <Connection
        title={title}
        state="Could not check"
        tone="bad"
        line={classroom.reason}
        actions={<Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button>}
      />
    );
  }
  if (classroom.connected) {
    return <Connection title={title} state="Connected" tone="ok" line="Session results can be posted to one of your courses as grades." />;
  }
  if (!classroom.configured) {
    return <Connection title={title} state="Not configured on this server" line={`${NO_CREDENTIALS} The CSV export needs nothing from Google.`} />;
  }
  return (
    <Connection
      title={title}
      state="Not connected"
      line="Connect to post session results to a course as grades."
      actions={<Button variant="primary" size="sm" icon="link" busy={busy} onClick={onConnect}>Connect</Button>}
    >
      {/* Google compares the redirect address against a registered list, so a
          tunnel or preview host fails after consent, on Google's own page. */}
      <p className="hint">
        Connect from the address this deployment is registered under. Google refuses a redirect it
        has not seen before, such as a temporary tunnel.
      </p>
    </Connection>
  );
}

/**
 * The student's own Google account. Not offered to teachers: theirs is the row
 * above, and only a student's link is consulted when marks are placed.
 */
function GoogleRow({ link, busy, onConnect, onDisconnect, onRetry }) {
  const title = 'Your Google account';
  if (link === null) return <Connection title={title} checking />;
  if (link.failed) {
    return (
      <Connection
        title={title}
        state="Could not check"
        tone="bad"
        line={link.reason}
        actions={<Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button>}
      />
    );
  }

  const roster = link.linked && link.source === 'roster';
  let state = 'Not configured on this server';
  let tone;
  let line = `${NO_CREDENTIALS} Linking is switched off.`;
  if (roster) {
    state = 'Not confirmed by you';
    tone = 'warn';
    line = 'Your professor imported this from a Classroom roster. Confirm that it is you.';
  } else if (link.linked) {
    state = 'Connected';
    tone = 'ok';
    line = link.email || 'Confirmed by you.';
  } else if (link.configured) {
    state = 'Not connected';
    line = 'No Google account is linked to this profile.';
  }

  return (
    <Connection
      title={title}
      state={state}
      tone={tone}
      line={line}
      actions={(link.configured || link.linked) && (
        <>
          {/* An unconfirmed roster row gets Confirm, not Connect: the id is
              already there, what is missing is the student saying it is theirs. */}
          {link.configured && (!link.linked || roster) && (
            <Button variant="primary" size="sm" icon="link" busy={busy === 'connect'} disabled={Boolean(busy)} onClick={onConnect}>
              {link.linked ? 'Confirm' : 'Connect'}
            </Button>
          )}
          {/* Always there while linked, even with no Google credentials on the
              server: taking a link back must not need Google's permission. */}
          {link.linked && (
            <Button variant="danger" size="sm" busy={busy === 'disconnect'} disabled={Boolean(busy)} onClick={onDisconnect}>
              Disconnect
            </Button>
          )}
        </>
      )}
    >
      {/* The server's two sentences, as they arrive: what the link is for, and
          that it is optional. Shown linked or not, because "what would I give
          up" only comes up once you have it. Never reworded here, so this
          screen and the page Google returns to cannot claim different things. */}
      {(link.purpose || link.optional) && (
        <p className="said">
          {link.purpose}
          {link.purpose && link.optional ? ' ' : ''}
          {link.optional}
        </p>
      )}
    </Connection>
  );
}

/** The page in the shape it is about to take: a face, a card, a list. */
function Skeleton() {
  return (
    <div className="stack stack-6" aria-busy="true">
      <div className="au-who">
        <span className="skel" style={{ width: 76, height: 76, borderRadius: '50%' }} />
        <div className="au-who-name">
          <div className="skel" style={{ height: 12, width: 64 }} />
          <div className="skel" style={{ height: 30, width: 260, maxWidth: '100%' }} />
          <div className="skel" style={{ height: 14, width: 180 }} />
        </div>
      </div>
      <div className="skel" style={{ height: 196, borderRadius: 'var(--r-5)' }} />
      <div className="skel" style={{ height: 120, borderRadius: 'var(--r-4)' }} />
    </div>
  );
}

/**
 * @param classroom  undefined: no row. null: still checking. Otherwise the
 *                   server's { configured, connected }, or { failed, reason }.
 * @param link       the same three-way, for the student's own Google account
 * @param linkBusy   '' | 'connect' | 'disconnect'
 */
export function ProfileView({
  account, canSee, loading, usingKey, canSignIn,
  classroom, link, connecting, linkBusy, error,
  onConnectClassroom, onRetryClassroom, onConnectGoogle, onDisconnectGoogle, onRetryLink,
}) {
  const role = account?.role;
  const name = account?.fullName || account?.email || 'Account';
  const since = account?.createdAt
    ? new Date(account.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const hasConnections = classroom !== undefined || link !== undefined;

  let body;
  if (loading) {
    body = <Skeleton />;
  } else if (!account && !usingKey) {
    body = (
      <div className="card">
        <Empty
          icon="user"
          title="Nobody is signed in"
          action={canSignIn
            ? <Link className="btn btn-primary" to="/signin">Sign in</Link>
            : <Link className="btn" to="/">Open the console with a teacher key</Link>}
        >
          {canSignIn
            ? 'Sign in to see your account, your BloomLoop ID and your connections.'
            : 'Accounts are not set up on this build. The console opens with a teacher key.'}
        </Empty>
      </div>
    );
  } else {
    body = (
      <>
        {account ? (
          <header className="au-who">
            <span className="au-who-av"><Avatar name={name} size="xl" /></span>
            <div className="au-who-name">
              <span className="eyebrow">Profile</span>
              <div className="cluster cluster-3">
                <h1>{name}</h1>
                {account.active === false && <Chip tone="bad">Deactivated</Chip>}
              </div>
              <p className="au-who-role">
                {ROLE_LABEL[role] ?? role}{account.department ? ` · ${account.department}` : ''}
              </p>
              {ROLE_BLURB[role] && <p className="au-who-blurb">{ROLE_BLURB[role]}</p>}
            </div>
          </header>
        ) : (
          <header className="au-who">
            <span className="au-who-key"><Icon name="key" size={26} /></span>
            <div className="au-who-name">
              <span className="eyebrow">Profile</span>
              <h1>Shared teacher key</h1>
              <p className="au-who-role">A key, not an account.</p>
            </div>
          </header>
        )}

        {account && (
          <Panel className="au-idcard" aria-label="BloomLoop ID">
            <div className="au-id-main">
              <span className="tag-mint">BloomLoop ID</span>
              <span className="au-id-code">{account.code || '—'}</span>
              <p>The one code that names this account across BloomLoop.</p>
              {account.code && <CopyButton text={account.code} variant="accent" />}
            </div>
            <dl className="au-id-facts">
              <Fact label="Email">{account.email}</Fact>
              {role === 'student' && <Fact label="Roll number" mono>{account.rollNo}</Fact>}
              <Fact label="Department">{account.department}</Fact>
              <Fact label="Member since">{since}</Fact>
            </dl>
          </Panel>
        )}

        {/* The roll number joins an account to the marks earned under it, so
            an empty one is flagged here, not left to a blank results screen. */}
        {account && role === 'student' && !account.rollNo && (
          <Note tone="warn" icon="alert">
            This account has no roll number. A room knows you by the number you type on your phone,
            so your results cannot find the sessions you sat until your professor adds it.
          </Note>
        )}

        {usingKey && (
          <Note>
            This browser opens the console with the shared teacher key. A key is not a person: it has
            no name, no department and no students, and everyone who holds it shares one view.
            {canSignIn && <> <Link className="link" to="/signin">Sign in with an account</Link> to get your own.</>}
          </Note>
        )}

        {hasConnections && (
          <section className="au-sec" aria-label="Connections">
            <Section title="Connections" sub="Optional. Everything in BloomLoop works without them." />
            <div className="card au-conns">
              {classroom !== undefined && (
                <ClassroomRow classroom={classroom} busy={connecting} onConnect={onConnectClassroom} onRetry={onRetryClassroom} />
              )}
              {link !== undefined && (
                <GoogleRow link={link} busy={linkBusy} onConnect={onConnectGoogle} onDisconnect={onDisconnectGoogle} onRetry={onRetryLink} />
              )}
            </div>
            {error && <Note tone="bad" role="alert">{error}</Note>}
          </section>
        )}

        {account && canSee && (
          <section className="au-sec" aria-label="What this account can do">
            <Section title="What this account can do" sub="Answered by the server, not assumed by this page." />
            <dl className="card au-facts">
              {Object.entries(canSee)
                .filter(([k]) => CAN_SEE_LABEL[k])
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{CAN_SEE_LABEL[k]}</dt>
                    <dd data-v={isNo(v) ? 'no' : undefined}>{pretty(v)}</dd>
                  </div>
                ))}
            </dl>
          </section>
        )}
      </>
    );
  }

  return (
    <AccountShell current="profile" width="narrow">
      {body}
    </AccountShell>
  );
}

/**
 * Send a new tab to a Google consent page whose address has to be fetched
 * first. The tab is opened inside the click, before the await: opened after
 * the request resolves it is a popup, and every browser blocks it. If it was
 * blocked anyway, this tab goes to Google instead.
 */
async function openConsent(fetchUrl) {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const { url } = await fetchUrl();
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (err) {
    if (tab) tab.close();
    throw err;
  }
}

export default function Profile() {
  const { account, canSee, loading } = useViewer();
  // null is "not answered yet", which is what the skeleton reads. Every
  // request below replaces it, on success and on failure.
  const [classroom, setClassroom] = useState(null);
  const [link, setLink] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [linkBusy, setLinkBusy] = useState('');
  const [error, setError] = useState('');

  const role = account?.role;
  const usingKey = !loading && !account && Boolean(teacherKey.get());
  // Phase 7: a laptop in laptop mode has no accounts to sign in to.
  const lap = useLaptop(usingKey);

  // /api/classroom/status is teacher-gated, so a student's token is refused.
  // Do not make the call at all for one: it used to leave the row waiting for
  // ever and put a refusal on a screen where the student had done nothing wrong.
  const canUseClassroom = usingKey || role === 'hod' || role === 'professor';
  const isStudent = role === 'student';

  const refreshClassroom = useCallback(() => {
    if (!canUseClassroom) return;
    api.classroomStatus().then(
      setClassroom,
      (err) => setClassroom({ configured: false, connected: false, failed: true, reason: err.message }),
    );
  }, [canUseClassroom]);

  // Only asked for when there is a row to put it in.
  const refreshLink = useCallback(() => {
    if (!isStudent) return;
    api.googleLink().then(
      setLink,
      (err) => setLink({ linked: false, configured: false, failed: true, reason: err.message }),
    );
  }, [isStudent]);

  useEffect(() => { refreshClassroom(); }, [refreshClassroom]);
  useEffect(() => { refreshLink(); }, [refreshLink]);

  // Re-checked when the tab regains focus: consent happens in another tab, and
  // coming back to a row still saying "not connected" reads as a failure.
  useEffect(() => {
    const onFocus = () => { refreshClassroom(); refreshLink(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshClassroom, refreshLink]);

  async function connectClassroom() {
    setError('');
    setConnecting(true);
    try {
      await openConsent(api.classroomAuthUrl);
    } catch (err) {
      setError(`Could not start the Google sign-in: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  }

  async function connectGoogle() {
    setError('');
    setLinkBusy('connect');
    try {
      await openConsent(api.googleLinkUrl);
    } catch (err) {
      setError(`Could not start the Google sign-in: ${err.message}`);
    } finally {
      setLinkBusy('');
    }
  }

  // No confirmation step on purpose: nothing is destroyed, and linking again
  // takes one click.
  async function disconnectGoogle() {
    setError('');
    setLinkBusy('disconnect');
    try {
      setLink(await api.googleUnlink());
    } catch (err) {
      setError(`Could not disconnect the Google account: ${err.message}`);
    } finally {
      setLinkBusy('');
    }
  }

  return (
    <ProfileView
      account={account}
      canSee={canSee}
      loading={loading}
      usingKey={usingKey}
      canSignIn={Boolean(supabase) && !lap.laptop}
      classroom={canUseClassroom ? classroom : undefined}
      link={isStudent ? link : undefined}
      connecting={connecting}
      linkBusy={linkBusy}
      error={error}
      onConnectClassroom={connectClassroom}
      onRetryClassroom={() => { setClassroom(null); refreshClassroom(); }}
      onConnectGoogle={connectGoogle}
      onDisconnectGoogle={disconnectGoogle}
      onRetryLink={() => { setLink(null); refreshLink(); }}
    />
  );
}
