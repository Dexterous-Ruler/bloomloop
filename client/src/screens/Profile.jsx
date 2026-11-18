/**
 * Who am I, and what am I connected to.
 *
 * Two things live here that were previously homeless. The account itself - name,
 * role, department, reporting line, and the BL code that identifies a person
 * across the whole product - had no screen at all; you could only see your own
 * code by reading it off an invite. And "Connect Google Classroom" was buried on
 * the live classroom grid, which is the one screen a teacher opens with thirty
 * students already waiting. Neither belongs there.
 *
 * The permissions block is read straight from the server's own `canSee` object
 * rather than restated here. A second, hand-written description of what a role
 * may do is a promise the UI cannot keep: the server decides, and if the two
 * ever disagree the screen is the one that is lying.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, teacherKey } from '../api.js';
import { useAccount, signOut, supabase } from '../auth.js';
import Icon from '../ui/Icon.jsx';
import Shell, { Avatar, Card, PageHead } from '../ui/Shell.jsx';

const ROLE_LABEL = { hod: 'Head of Department', professor: 'Professor', student: 'Student' };

const ROLE_BLURB = {
  hod: 'You can read everything in your department and invite professors. You cannot edit another teacher’s material — reading across the department and writing into it are deliberately different powers.',
  professor: 'You build question banks, run rooms, and invite students. You see your own classes only.',
  student: 'Read-only by design: you take sessions and see your own results, and nothing you do here can change a mark.',
};

/** Human wording for the server's canSee flags. Labels only - it decides. */
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
  // The server sends null for "this verb does not apply to you" - a student has
  // nobody to invite. String(null) put the word "null" on screen.
  if (v == null) return 'Not for this role';
  return VALUE_LABEL[v] ?? String(v);
};

function Field({ label, value, mono, children }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div
        style={{
          marginTop: 6,
          font: `${mono ? '700 14px/1.4 var(--mono)' : '600 15px/1.4 var(--sans)'}`,
          color: value || children ? 'var(--ink)' : 'var(--ink-5)',
          overflowWrap: 'anywhere',
        }}
      >
        {children ?? value ?? '—'}
      </div>
    </div>
  );
}

/** Copy-to-clipboard that reports back, because a silent copy is indistinguishable from a dead button. */
function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="btn xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          // Clipboard is permission-gated and blocked outright on some in-app
          // browsers. The code is on screen either way, so this is not an error
          // worth shouting about.
        }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={11} />
      {done ? 'Copied' : label}
    </button>
  );
}

/**
 * One row in the connected-accounts card: the Google tile, a title, a line of
 * state, and whatever flags and buttons the caller hangs on the right.
 *
 * Extracted rather than written twice. The tile and the inset are the same
 * object in both rows, and two copies of a 40px grid drift apart the moment one
 * of them is touched.
 */
function ConnectionRow({ title, hint, children }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: 16, borderRadius: 'var(--r-card)', background: 'var(--inset)',
      }}
    >
      <span
        style={{
          width: 40, height: 40, borderRadius: 14, flex: 'none', display: 'grid',
          placeItems: 'center', background: 'var(--surface)', color: 'var(--ink-2)',
          boxShadow: 'var(--sh-card)',
        }}
      >
        <Icon name="google" size={18} />
      </span>
      <div className="grow" style={{ minWidth: 180 }}>
        <div style={{ font: '700 14px/1.3 var(--sans)' }}>{title}</div>
        <div className="hint" style={{ marginTop: 3 }}>{hint}</div>
      </div>
      {children}
    </div>
  );
}

export default function Profile() {
  const { account, canSee, loading } = useAccount();
  const [classroom, setClassroom] = useState(null);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState(false);
  // The student's own Google link. `null` means "not asked yet", which is what
  // the shimmer below reads - distinct from a loaded answer of "not linked".
  const [link, setLink] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);

  const usingKey = !account && Boolean(teacherKey.get());

  // /api/classroom/status is teacher-gated, so a student's token is refused -
  // which left the card spinning on "Checking…" for ever and put the server's
  // "only a professor or an HOD" refusal on screen as a red error, on a screen
  // where the student had done nothing wrong. Do not make the call at all.
  const canUseClassroom = !account || account.role === 'hod' || account.role === 'professor';

  // The personal link is a student's affair. See the card below for why it is
  // not offered to a teacher, who already has the Classroom connection there.
  const isStudent = account?.role === 'student';

  const refreshClassroom = useCallback(() => {
    if (!canUseClassroom) return;
    api.classroomStatus().then(
      setClassroom,
      // Resolved either way. A failed check is an answer - leaving the state
      // null is what makes it look like the request never finished.
      (err) => setClassroom({ configured: false, connected: false, reason: err.message }),
    );
  }, [canUseClassroom]);

  /**
   * The student's own link.
   *
   * Only asked for when there is a row to put it in. The route itself is gated
   * on having an account rather than on a role - a teacher may call it and gets
   * an honest answer - but this screen does not render it for one, and a request
   * whose result nothing displays is a round trip on every teacher's profile
   * load buying nothing.
   *
   * Resolved either way, like the classroom check above: a failed request is an
   * answer and has to stop the shimmer, or the card sits there implying the
   * server is still thinking about it.
   */
  const refreshLink = useCallback(() => {
    if (!isStudent) return;
    api.googleLink().then(setLink, (err) => setLink({ linked: false, configured: false, reason: err.message }));
  }, [isStudent]);

  useEffect(() => { refreshClassroom(); }, [refreshClassroom]);
  useEffect(() => { refreshLink(); }, [refreshLink]);

  // Re-checked when the tab regains focus: consent happens in a different tab,
  // and coming back to a screen still saying "not connected" reads as a failure.
  useEffect(() => {
    const onFocus = () => { refreshClassroom(); refreshLink(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshClassroom, refreshLink]);

  /**
   * The tab is opened synchronously inside the click, before the await. Opening
   * it after the request resolves makes it a popup, and every browser blocks it.
   */
  async function connect() {
    setError('');
    setLinking(true);
    const tab = window.open('', '_blank', 'noopener');
    try {
      const { url } = await api.classroomAuthUrl();
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      if (tab) tab.close();
      setError(`Could not start the Google sign-in: ${err.message}`);
    } finally {
      setLinking(false);
    }
  }

  /** The student's own consent, opened the same way and for the same reason. */
  async function connectGoogle() {
    setError('');
    setLinkBusy(true);
    const tab = window.open('', '_blank', 'noopener');
    try {
      const { url } = await api.googleLinkUrl();
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      if (tab) tab.close();
      setError(`Could not start the Google sign-in: ${err.message}`);
    } finally {
      setLinkBusy(false);
    }
  }

  /**
   * Unlink, with no confirmation step on purpose: nothing is destroyed and
   * linking again takes one click, so a dialogue here would be ceremony asking
   * a student to think hard about a decision they can undo in three seconds.
   */
  async function disconnectGoogle() {
    setError('');
    setLinkBusy(true);
    try {
      setLink(await api.googleUnlink());
    } catch (err) {
      setError(`Could not disconnect the Google account: ${err.message}`);
    } finally {
      setLinkBusy(false);
    }
  }

  const role = account?.role;
  const name = account?.fullName || (usingKey ? 'Shared teacher key' : 'Not signed in');

  return (
    <Shell
      badge={account?.code && <span className="barcount mono">{account.code}</span>}
      right={
        <>
          <a className="btn sm ghost" href="/">
            <Icon name="back" size={13} />
            Console
          </a>
          {account && (
            <button type="button" className="btn sm" onClick={() => signOut()}>
              <Icon name="logout" size={13} />
              Sign out
            </button>
          )}
        </>
      }
    >
      <PageHead
        title="Your profile"
        sub={
          account
            ? `${ROLE_LABEL[role] ?? role}${account.department ? ` · ${account.department}` : ''}`
            : usingKey
              ? 'Signed in with the shared teacher key, not an account'
              : 'Nobody is signed in'
        }
      />

      {loading && (
        <div className="stack">
          <div className="skel" style={{ height: 132 }} />
          <div className="skel" style={{ height: 200 }} />
        </div>
      )}

      {!loading && (
        <div className="stack">
          {/* ---------------------------------------------------- identity --- */}
          <Card className="pad-lg">
            <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
              <Avatar name={name} size="lg" />
              <div className="grow">
                <h2 style={{ fontSize: 22 }}>{name}</h2>
                <div className="sub" style={{ font: '500 13px/1.5 var(--sans)', color: 'var(--ink-4)', marginTop: 4 }}>
                  {account?.email ?? (usingKey ? 'No email — the key is shared, not personal' : '')}
                </div>
              </div>
              {role && <span className="flag info">{ROLE_LABEL[role] ?? role}</span>}
              {account && !account.active && <span className="flag bad">Deactivated</span>}
            </div>

            {account ? (
              <>
                <div className="grid auto-sm" style={{ marginTop: 24 }}>
                  <Field label="BloomLoop ID" mono>
                    <span className="row" style={{ gap: 8 }}>
                      {account.code}
                      <CopyButton text={account.code} />
                    </span>
                  </Field>
                  <Field label="Role" value={ROLE_LABEL[role] ?? role} />
                  <Field label="Department" value={account.department} />
                  {role === 'student' && <Field label="Roll number" value={account.rollNo} mono />}
                  <Field
                    label="Member since"
                    value={account.createdAt ? new Date(account.createdAt).toLocaleDateString() : null}
                  />
                </div>

                {role && (
                  <div className="said" style={{ marginTop: 22 }}>
                    <span>{ROLE_BLURB[role]}</span>
                  </div>
                )}

                {/* The roll number is the join between an account and the marks
                    earned under it, so an empty one is worth flagging here
                    rather than leaving the results screen mysteriously blank. */}
                {role === 'student' && !account.rollNo && (
                  <div className="note warn" style={{ marginTop: 14 }}>
                    <Icon name="alert" size={15} />
                    <span>
                      Your account has no roll number. A live session identifies you by the number you
                      type on your phone, so until your professor adds it here your results screen
                      cannot find the sessions you sat.
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="note info" style={{ marginTop: 20 }}>
                <Icon name="info" size={15} />
                <span>
                  {usingKey
                    ? 'You are using the shared teacher key from v1. It is not a person: it has no name, no department and no students, and everyone who holds it shares one view. Sign in with a BloomLoop account to get your own.'
                    : 'Sign in to see your account.'}
                </span>
              </div>
            )}

            {!account && supabase && (
              <a className="btn pri" href="/signin" style={{ marginTop: 16 }}>
                <Icon name="user" size={13} />
                Sign in
              </a>
            )}
          </Card>

          {/* ------------------------------------------------- connections --- */}
          <Card className="pad-lg">
            <div className="cardhead">
              <h3>Connected accounts</h3>
              <span className="sub">Optional. Everything in BloomLoop works without them.</span>
            </div>

            <div className="stack tight">
              {/* The teacher's connection: the one that actually posts grades.
                  Hidden from students, who cannot use it and for whom it was
                  only ever a row saying so. */}
              {canUseClassroom && (
                <ConnectionRow title="Google Classroom" hint={classroom?.reason ?? 'Checking…'}>
                  {classroom?.connected && (
                    <span className="flag ok"><Icon name="check" size={11} /> Connected</span>
                  )}

                  {classroom?.configured && !classroom?.connected && (
                    <button type="button" className="btn pri" onClick={connect} disabled={linking}>
                      {linking ? <span className="spin" /> : <Icon name="link" size={13} />}
                      Connect
                    </button>
                  )}

                  {classroom && !classroom.configured && (
                    <span className="flag neutral">Not configured on this server</span>
                  )}
                </ConnectionRow>
              )}

              {/* The student's own. Deliberately not offered to teachers: their
                  Google connection is the row above, a second one on the same
                  card would read as a second thing to do, and only a student's
                  link is consulted when marks are placed. */}
              {isStudent && (link === null ? (
                <div className="skel" style={{ height: 72 }} />
              ) : (
                <ConnectionRow
                  title="Your Google account"
                  hint={
                    // State only. What the link is FOR is the server's sentence
                    // and lives in the note below, where it is on screen in BOTH
                    // states - a student deciding whether to disconnect needs to
                    // know what they would be giving up, and that is exactly the
                    // moment the old wording dropped it.
                    link.linked
                      ? link.source === 'roster'
                        ? 'Your professor imported this from a Classroom roster. You have not confirmed it is you.'
                        : `Connected${link.email ? ` as ${link.email}` : ''}.`
                      : link.reason || 'Not connected.'
                  }
                >
                  {link.linked && link.source === 'roster' && (
                    <span className="flag info">Not confirmed by you</span>
                  )}
                  {link.linked && link.source !== 'roster' && (
                    <span className="flag ok"><Icon name="check" size={11} /> Connected</span>
                  )}
                  {!link.linked && link.configured && <span className="flag neutral">Not connected</span>}
                  {!link.configured && !link.linked && (
                    <span className="flag neutral">Not configured on this server</span>
                  )}

                  {/* An unconfirmed roster row gets a Confirm rather than a
                      Connect: the id is already there, and what is missing is
                      the student saying it is theirs. */}
                  {link.configured && (!link.linked || link.source === 'roster') && (
                    <button type="button" className="btn pri" onClick={connectGoogle} disabled={linkBusy}>
                      {linkBusy ? <span className="spin" /> : <Icon name="link" size={13} />}
                      {link.linked ? 'Confirm' : 'Connect'}
                    </button>
                  )}

                  {/* Always available while linked, even on a server with no
                      Google credentials at all: withdrawing has to work without
                      asking Google's permission to do it. */}
                  {link.linked && (
                    <button type="button" className="btn danger sm" onClick={disconnectGoogle} disabled={linkBusy}>
                      {linkBusy ? <span className="spin" /> : <Icon name="close" size={13} />}
                      Disconnect
                    </button>
                  )}
                </ConnectionRow>
              ))}
            </div>

            {/* Both sentences are the server's, rendered as they arrive and
                never reworded here: what the link is for, and that it is not
                required. They live in one place on the server precisely so that
                this screen and the consent page a student lands on after Google
                cannot drift into claiming two different things. Shown whether or
                not the student is linked - "what am I giving up" is a question
                that only comes up once you already have it. */}
            {isStudent && (link?.purpose || link?.optional) && (
              <div className="note" style={{ marginTop: 14 }}>
                <Icon name="info" size={15} />
                <span>
                  {link.purpose}
                  {link.purpose && link.optional ? ' ' : ''}
                  {link.optional}
                </span>
              </div>
            )}

            {/* Google compares redirect_uri against a registered list character
                for character, so a tunnel or preview host fails AFTER consent,
                on Google's own error page. Cheaper to say so first. */}
            {canUseClassroom && classroom?.configured && !classroom?.connected && (
              <div className="note" style={{ marginTop: 14 }}>
                <Icon name="info" size={15} />
                <span>
                  Connect from the address the deployment is registered under. Google refuses a
                  redirect it has not seen before, and a temporary tunnel address is not one of them.
                </span>
              </div>
            )}

            {error && (
              <div className="note bad" style={{ marginTop: 14 }}>
                <Icon name="alert" size={15} />
                <span>{error}</span>
              </div>
            )}
          </Card>

          {/* ------------------------------------------------ permissions --- */}
          {canSee && (
            <Card className="pad-lg">
              <div className="cardhead">
                <h3>What this account can do</h3>
                <span className="sub">Read from the server, not restated here.</span>
              </div>
              <div className="grid auto-sm">
                {Object.entries(canSee)
                  .filter(([k]) => CAN_SEE_LABEL[k])
                  .map(([k, v]) => (
                    <Field key={k} label={CAN_SEE_LABEL[k]} value={pretty(v)} />
                  ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </Shell>
  );
}
