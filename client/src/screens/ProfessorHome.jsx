/**
 * The professor's own screen: what they have built, how their classes went, and
 * the students they are answerable for.
 *
 * It sits in front of the console rather than inside it. The console
 * (Material -> Question bank -> Room -> Classroom) is a job of work with a
 * beginning and an end; this is what a professor opens on a Monday to see where
 * the term actually is, and it is the only place they can hand a student an
 * account.
 *
 * Everything on it comes from one GET /api/dashboard. There is no id in that
 * call and there is never going to be one: the role picks the shape and the
 * token picks the rows, so this screen cannot be aimed at another professor by a
 * browser that would like to.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api.js';
import { useAccount, signOut } from '../auth.js';
import { LEVELS, LABEL } from '../bloom.js';
import Icon from '../ui/Icon.jsx';
import Shell, { Avatar, Card, Empty, NavPill, PageHead, Stat, TailBars } from '../ui/Shell.jsx';

/* Each filter carries its own predicate, so the count on the pill and the rows
   the pill reveals cannot drift apart. */
const ROSTER_FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'noroll', label: 'No roll number', match: (s) => !rollOf(s) },
  { id: 'off', label: 'Deactivated', match: (s) => !s.active },
];

/** The roll number, or '' — the server stores it nullable and sometimes blank. */
function rollOf(student) {
  return String(student?.rollNo ?? '').trim();
}

/** Accuracies arrive as 0..1, or null when nobody has answered anything yet. */
const share = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

/**
 * A roll number the professor may have meant, read off the school address.
 * '21cs047@college.edu' -> '21CS047'.
 *
 * Returns '' when the local part holds no run of digits, because
 * 'anita.rao@college.edu' would otherwise become the roll number 'ANITARAO' — a
 * confident-looking value with nothing behind it, filled into the one field that
 * decides whether an account ever sees its own results. A blank the professor
 * has to notice beats a wrong number they will not.
 */
function rollFromEmail(email) {
  const local = String(email ?? '').split('@')[0];
  const cleaned = local.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return /\d{2,}/.test(cleaned) ? cleaned : '';
}

function day(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/* A tail with no bars in it leaves the number floating over white space, which
   is precisely the unfinished look the stat card exists to prevent. A flat row
   of zeros is not decoration: it is the honest shape of a term that has not
   started yet, and it holds the card's height while the first session runs. */
const FLAT = Array.from({ length: 6 }, () => ({ label: '·', value: 0 }));
const tailOf = (bars) => <TailBars bars={bars.length > 0 ? bars : FLAT} />;

/** Shaped like what is coming — a head, six stats, a chart, the roster. */
function Skeleton() {
  return (
    <>
      <div className="phead">
        <div className="txt">
          <div className="skel" style={{ height: 28, width: 240, borderRadius: 9 }} />
          <div className="skel" style={{ height: 12, width: 360, borderRadius: 6, marginTop: 11 }} />
        </div>
      </div>
      <div className="grid auto" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skel" style={{ height: 190, borderRadius: 'var(--r-card)' }} />
        ))}
      </div>
      <div className="skel" style={{ height: 228, borderRadius: 'var(--r-card)', marginBottom: 16 }} />
      <div className="grid auto-lg" style={{ marginBottom: 16 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skel" style={{ height: 168, borderRadius: 'var(--r-card)' }} />
        ))}
      </div>
      <div className="skel" style={{ height: 340, borderRadius: 'var(--r-panel)' }} />
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * The panel's own empty state.
 *
 * <Empty> is built for the light canvas — its ink and its tinted icon tile both
 * disappear against --d-1 — so the dark surface gets the same three parts, an
 * icon, a sentence and something to press, in its own clothes.
 */
function DarkEmpty({ icon, title, children, action }) {
  return (
    <div className="d-empty">
      <b>
        <Icon
          name={icon}
          size={17}
          style={{ display: 'inline-block', marginRight: 8, verticalAlign: '-3px' }}
        />
        {title}
      </b>
      <span>{children}</span>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

/** One chapter, as it sits in the bank: what is in it and what it has run. */
function ChapterCard({ n, content }) {
  const cells = [
    ['Topics', content.topics],
    ['Questions', content.questions],
    ['Sessions', content.sessions],
  ];
  return (
    <Card className="outline">
      <div className="row" style={{ gap: 8 }}>
        <span className="flag neutral">{String(n).padStart(2, '0')}</span>
        {content.kind && <span className="flag info">{content.kind}</span>}
        <span className="grow" />
        <span className="muted nowrap" style={{ font: '600 11px/1 var(--sans)' }}>{day(content.createdAt)}</span>
      </div>

      <h3 style={{ marginTop: 13 }}>{content.title || 'Untitled chapter'}</h3>

      <div
        style={{
          marginTop: 15, display: 'grid', gap: 8,
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        }}
      >
        {cells.map(([k, v]) => (
          <div key={k} style={{ background: 'var(--inset)', borderRadius: 'var(--r-tile)', padding: '10px 12px' }}>
            <div className="num" style={{ font: '800 19px/1 var(--sans)', letterSpacing: '-0.02em' }}>{v ?? 0}</div>
            <div style={{ font: '600 10px/1.3 var(--sans)', color: 'var(--ink-5)', marginTop: 5 }}>{k}</div>
          </div>
        ))}
      </div>

      {/* A chapter with a bank and no session is the one thing on this card
          worth acting on, so it says so rather than leaving three numbers to be
          compared by eye. */}
      {content.questions > 0 && content.sessions === 0 && (
        <div className="hint" style={{ marginTop: 12 }}>
          Written but never run — this bank has not been in front of a class yet.
        </div>
      )}
    </Card>
  );
}

/** One row of the recent-sessions list. */
function SessionRow({ session, first }) {
  return (
    <div
      className="row"
      style={{
        gap: 12, padding: '13px 18px',
        borderTop: first ? 'none' : '1px solid var(--line-2)',
      }}
    >
      {/* Longhand rather than the `font` shorthand throughout this row: the
          shorthand resets font-variant-numeric, which is the whole reason these
          spans carry .mono and .num in the first place. */}
      <span className="mono nowrap" style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1 }}>
        {session.code}
      </span>
      <span className="grow" style={{ font: '600 13px/1.35 var(--sans)' }}>
        {session.title || 'Untitled session'}
      </span>
      <span className={`flag ${session.status === 'closed' ? 'neutral' : 'ok'}`}>
        {session.status === 'closed' ? 'closed' : 'open'}
      </span>
      <span className="num nowrap" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)' }}>
        {session.joined} joined
      </span>
      {session.banded > 0 && <span className="flag">{session.banded} in band</span>}
      <span
        className="mono nowrap"
        style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1, width: 42, textAlign: 'right' }}
      >
        {share(session.accuracy)}
      </span>
      <span className="muted nowrap" style={{ font: '600 11px/1 var(--sans)', width: 52, textAlign: 'right' }}>
        {day(session.startedAt)}
      </span>
    </div>
  );
}

/**
 * The gradient card, carrying whichever student the professor is reading.
 *
 * The roll number is the whole story on this card. A live session identifies a
 * student by the number they type on their phone — there are no accounts in the
 * room — so that number is the only thread between this account and the answers
 * it gave, and a professor cannot add one afterwards (PATCH /auth/account is an
 * HOD's route). Saying that here is what makes the invite form below take the
 * field seriously.
 */
function StudentCard({ student }) {
  const roll = rollOf(student);
  return (
    <div className="accent" style={{ marginBottom: 14 }}>
      <div className="k">Selected student</div>
      <div className="row" style={{ gap: 10, marginTop: 6 }}>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>
          {student.fullName || 'Unnamed account'}
        </span>
        {/* .accent .k and .accent-tile b both set the `font` shorthand, which
            beats the .mono class on specificity and quietly puts the code back
            in the sans face. Stated inline so it actually lands. */}
        <span className="k" style={{ fontFamily: 'var(--mono)' }}>{student.code}</span>
        {!student.active && <span className="k">deactivated</span>}
      </div>

      <div className="tiles" style={{ marginTop: 16 }}>
        <div className="accent-tile">
          <b>
            <span style={{ fontFamily: 'var(--mono)' }}>{roll || 'Not set'}</span>
            <Icon name={roll ? 'check' : 'alert'} size={11} />
          </b>
          <span>Roll number</span>
        </div>
        <div className="accent-tile">
          <b>{roll ? 'Linked' : 'Not linked'}</b>
          <span>Their results screen</span>
        </div>
        <div className="accent-tile">
          <b>{student.active ? 'Active' : 'Off'}</b>
          <span>Account</span>
        </div>
      </div>

      <div className="said" style={{ marginTop: 16 }}>
        <span style={{ color: 'var(--on-d)' }}>
          {roll
            ? `Their phone types ${roll} to join a room, and everything that number has already `
              + 'answered in your sessions is on their results screen now.'
            : 'Nothing in the room knows this account exists — the grid keys on the number typed on '
              + 'the phone, and this one has none. Only a head of department can add it afterwards, '
              + 'so the dependable fix is to put the number on the invite before it goes out.'}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------- classroom roster import */

/**
 * Pull a class list out of Google Classroom and turn it into invites.
 *
 * The gap this closes is not typing. It is that a hand-typed roster gives grade
 * posting nothing to match on but names and email fragments, so a mark can land
 * on the wrong student and say nothing about it. A student invited from here
 * carries Google's own user id from the invite onto their account, and the grade
 * poster places them by identity instead of by resemblance.
 *
 * Every state below degrades to the same place: the manual invite form above,
 * which needs nothing from Google and is untouched by any of this. Google may be
 * unconfigured, unconsented, or simply unreachable from the college wifi, and
 * none of those may leave a professor with no way to invite a student.
 *
 * Self-contained on purpose — it owns its own status, roster and results, so the
 * dashboard around it neither knows nor waits for any of it.
 */
function ClassroomImport({ onClose }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState(false);
  const [courses, setCourses] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [loading, setLoading] = useState('');
  const [students, setStudents] = useState(null);
  // userId -> { on, rollNo }. Keyed by the Google id rather than by index, so
  // reloading a different course cannot carry a tick onto a different student.
  const [picks, setPicks] = useState({});
  const [progress, setProgress] = useState(null);
  const [batch, setBatch] = useState(null);
  const [copied, setCopied] = useState(false);
  const [filled, setFilled] = useState(null);

  useEffect(() => {
    let alive = true;
    api.classroomStatus().then(
      (res) => { if (alive) setStatus(res); },
      (err) => { if (alive) setError(err.message); },
    );
    return () => { alive = false; };
  }, []);

  /* The course list is the first thing a connected professor needs, so it is
     fetched rather than hidden behind a button that only ever has one answer. */
  useEffect(() => {
    if (!status?.connected || courses !== null) return undefined;
    let alive = true;
    setLoading('courses');
    api.classroomCourses().then(
      (res) => {
        if (!alive) return;
        const list = res.courses ?? [];
        setCourses(list);
        if (list.length) setCourseId(list[0].id);
        setLoading('');
      },
      (err) => { if (alive) { setError(err.message); setLoading(''); } },
    );
    return () => { alive = false; };
  }, [status?.connected, courses]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  /**
   * Ask the server for the consent URL, then send the browser to Google. The tab
   * is opened synchronously inside the click, before the await: opening it after
   * the request resolves is a popup, and every browser blocks it.
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

  async function loadRoster() {
    setError('');
    setFilled(null);
    setLoading('roster');
    try {
      const res = await api.classroomCourseStudents(courseId);
      const list = res.students ?? [];
      setStudents(list);
      // Nothing ticked to begin with. Forty students pre-selected is forty
      // invites one misplaced click away, and the professor has not yet read a
      // single row.
      setPicks(Object.fromEntries(list.map((s) => [s.userId, { on: false, rollNo: '' }])));
    } catch (err) {
      setError(`Could not read that course roster: ${err.message}`);
    } finally {
      setLoading('');
    }
  }

  const importable = useMemo(() => (students ?? []).filter((s) => !s.linked), [students]);
  const chosen = useMemo(
    () => importable.filter((s) => picks[s.userId]?.on),
    [importable, picks],
  );
  const allOn = importable.length > 0 && chosen.length === importable.length;

  const setPick = (userId, patch) =>
    setPicks((p) => ({ ...p, [userId]: { ...(p[userId] ?? { on: false, rollNo: '' }), ...patch } }));

  function toggleAll() {
    const on = !allOn;
    setPicks((p) => {
      const next = { ...p };
      for (const s of importable) next[s.userId] = { ...(next[s.userId] ?? { rollNo: '' }), on };
      return next;
    });
  }

  /**
   * Fill the visible roll-number fields from the email addresses.
   *
   * Deliberately a button and not something that happens on load. Guessing a
   * roll number is exactly the kind of quiet inference this whole screen exists
   * to replace, so the professor performs it, sees every value it produced, and
   * can correct any of them before a single invite is written.
   */
  function fillRolls() {
    let hit = 0;
    setPicks((p) => {
      const next = { ...p };
      for (const s of importable) {
        const guess = rollFromEmail(s.email);
        if (!guess) continue;
        hit += 1;
        next[s.userId] = { ...(next[s.userId] ?? { on: false }), rollNo: guess };
      }
      return next;
    });
    setFilled({ hit, of: importable.length });
  }

  /**
   * One POST per student, in order.
   *
   * Sequential rather than parallel: the server draws a fresh invite code and
   * retries on collision, and forty concurrent inserts turn a rare retry into a
   * common one for no gain a professor can perceive. A failure is recorded
   * against its own student and the run carries on — one rejected invite must
   * not cost the other thirty-nine their codes.
   */
  async function createInvites() {
    setError('');
    const queue = chosen;
    const made = [];
    setBatch([]);
    for (let i = 0; i < queue.length; i += 1) {
      const s = queue[i];
      setProgress({ done: i, total: queue.length });
      const rollNo = (picks[s.userId]?.rollNo ?? '').trim();
      try {
        const body = { role: 'student', googleSub: s.userId };
        if (rollNo) body.rollNo = rollNo;
        if (s.name) body.fullName = s.name;
        if (s.email) body.email = s.email;
        const res = await api.invite(body);
        made.push({ userId: s.userId, name: s.name, rollNo, code: res.invite.code });
      } catch (err) {
        made.push({ userId: s.userId, name: s.name, rollNo, error: err.message });
      }
      setBatch([...made]);
    }
    setProgress(null);
  }

  async function copyAll() {
    const lines = (batch ?? [])
      .filter((b) => b.code)
      .map((b) => [b.rollNo || '—', b.name || '—', b.code].join('\t'))
      .join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
    } catch {
      // Blocked on plain http and behind some policies. Every code is on screen
      // with user-select:all, so there is another way to get them and nothing
      // worth interrupting the professor about.
    }
  }

  function reset() {
    setBatch(null);
    setStudents(null);
    setPicks({});
    setFilled(null);
  }

  /* The one sentence that has to be true in every degraded state, said once. */
  const fallback = (
    <div className="said" style={{ marginTop: 14 }}>
      <span style={{ color: 'var(--on-d-2)' }}>
        Nothing here is required. Invite a student by hand with the form above — it needs nothing
        from Google, and a student invited that way is joined to their results by the roll number
        you type, exactly as before.
      </span>
    </div>
  );

  const issued = (batch ?? []).filter((b) => b.code);
  const refused = (batch ?? []).filter((b) => b.error);

  return (
    <div
      className="dk"
      style={{
        background: 'var(--d-2)', borderRadius: 'var(--r-card)',
        padding: '16px 18px', marginBottom: 14,
      }}
    >
      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <span className="eyebrow on-d grow">Import a roster · Google Classroom</span>
        <button type="button" className="d-tile" onClick={onClose} aria-label="Close the roster import">
          <Icon name="close" size={14} />
        </button>
      </div>

      {error && (
        <div className="note dk" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* --- checking ------------------------------------------------- */}
      {!status && !error && (
        <>
          <div className="skel" style={{ height: 46, borderRadius: 14 }} />
          <div className="skel" style={{ height: 46, borderRadius: 14, marginTop: 8, width: '60%' }} />
        </>
      )}

      {/* --- configured on the server, or not ------------------------- */}
      {status && !status.configured && (
        <>
          <div className="note on-d">
            <Icon name="info" size={15} />
            <span>{status.reason}</span>
          </div>
          {fallback}
        </>
      )}

      {status?.configured && !status.connected && (
        <>
          <div className="note on-d">
            <Icon name="info" size={15} />
            <span>{status.reason}</span>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button type="button" className="btn on-d solid" onClick={connect} disabled={linking}>
              {linking ? <span className="spin" /> : <Icon name="google" size={13} />}
              Connect Google Classroom
            </button>
          </div>
          {fallback}
        </>
      )}

      {/* --- connected: pick a course -------------------------------- */}
      {status?.connected && !students && !batch && (
        loading === 'courses' || courses === null ? (
          <div className="skel" style={{ height: 46, borderRadius: 14 }} />
        ) : courses.length === 0 ? (
          <DarkEmpty icon="deck" title="No courses on this Google account">
            The connected account teaches nothing BloomLoop can read. Connect the account that owns
            your courses, or invite your students by hand above.
          </DarkEmpty>
        ) : (
          <div className="row" style={{ gap: 10 }}>
            <label className="lab" htmlFor="import-course" style={{ margin: 0 }}>Course</label>
            <select
              id="import-course"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              style={{ flex: '1 1 200px', maxWidth: 340 }}
            >
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button
              type="button"
              className="btn on-d solid"
              onClick={loadRoster}
              disabled={!courseId || loading === 'roster'}
            >
              {loading === 'roster' ? <span className="spin" /> : <Icon name="users" size={13} />}
              Read the roster
            </button>
          </div>
        )
      )}

      {/* --- the roster, ticked and annotated ------------------------
             Held open while the invites are being written, because the progress
             on that button is the only thing saying the run is still going. The
             results replace it once the last one has landed. */}
      {students && (!batch || progress) && (
        students.length === 0 ? (
          <DarkEmpty
            icon="users"
            title="Nobody is enrolled in that course"
            action={
              <button type="button" className="btn on-d" onClick={reset}>
                Pick another course
              </button>
            }
          >
            Google returned no students for it. A course whose students have not accepted their
            invitations yet looks exactly like this.
          </DarkEmpty>
        ) : (
          <>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <span className="panel-sub grow">
                {students.length} on the Google roster
                {students.length !== importable.length
                  && ` · ${students.length - importable.length} already have an account`}
                {` · ${chosen.length} ticked`}
              </span>
              <button type="button" className="btn on-d sm" onClick={toggleAll} disabled={importable.length === 0}>
                {allOn ? 'Untick everyone' : 'Tick everyone'}
              </button>
              <button type="button" className="btn on-d sm" onClick={fillRolls} disabled={importable.length === 0}>
                <Icon name="key" size={12} />
                Fill roll numbers from email
              </button>
            </div>

            {filled && (
              <div className="note on-d" style={{ marginBottom: 12 }}>
                <Icon name="info" size={15} />
                <span>
                  Filled {filled.hit} of {filled.of} from the address before the @. Read them before
                  you send: this is a guess off an email address, and the roll number is what ties
                  the account to its results.
                </span>
              </div>
            )}

            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                ...(students.length > 7 ? { maxHeight: 396, overflowY: 'auto' } : null),
              }}
            >
              {students.map((s) => {
                const pick = picks[s.userId] ?? { on: false, rollNo: '' };
                return (
                  <div
                    key={s.userId}
                    className="d-row"
                    /* Inline so it beats .d-row:hover — a ticked row must not
                       look the same as one the pointer is merely resting on. */
                    style={pick.on ? { background: 'var(--brand)' } : undefined}
                  >
                    <input
                      type="checkbox"
                      id={`imp-${s.userId}`}
                      checked={pick.on}
                      disabled={s.linked}
                      onChange={(e) => setPick(s.userId, { on: e.target.checked })}
                      style={{
                        width: 16, height: 16, margin: 0, flex: 'none',
                        accentColor: 'var(--lime)', cursor: s.linked ? 'not-allowed' : 'pointer',
                      }}
                    />
                    <label className="t" htmlFor={`imp-${s.userId}`} style={{ cursor: s.linked ? 'default' : 'pointer' }}>
                      <b>{s.name || 'Unnamed student'}</b>
                      <span>{s.email || 'Google gave no address for them'}</span>
                    </label>
                    {s.linked ? (
                      <span className="flag neutral">already has an account</span>
                    ) : (
                      <input
                        aria-label={`Roll number for ${s.name || 'this student'}`}
                        placeholder="Roll number"
                        autoComplete="off"
                        spellCheck="false"
                        value={pick.rollNo}
                        onChange={(e) => setPick(s.userId, { rollNo: e.target.value.toUpperCase() })}
                        style={{ flex: 'none', width: 150, height: 34 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="hint" style={{ marginTop: 12 }}>
              A student ticked here gets an invite carrying their Google id, so when you post this
              class&apos;s marks to Classroom they are placed on that exact Google account instead of
              matched to a name on the roster. The roll number is still what joins them to the
              sessions they sit, and it is still yours to set.
            </div>

            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn on-d solid"
                onClick={createInvites}
                disabled={chosen.length === 0 || Boolean(progress)}
              >
                {progress
                  ? <><span className="spin" />Issuing {progress.done + 1} of {progress.total}…</>
                  : <><Icon name="key" size={13} />
                    Create {chosen.length || 'no'} invite{chosen.length === 1 ? '' : 's'}</>}
              </button>
              <button type="button" className="btn on-d" onClick={reset} disabled={Boolean(progress)}>
                Pick another course
              </button>
            </div>
          </>
        )
      )}

      {/* --- what came back ----------------------------------------- */}
      {batch && !progress && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <span className="eyebrow on-d grow">
              {issued.length} invite{issued.length === 1 ? '' : 's'} issued
              {refused.length > 0 && ` · ${refused.length} refused`}
            </span>
            <button type="button" className="btn on-d sm" onClick={copyAll} disabled={issued.length === 0}>
              <Icon name={copied ? 'check' : 'copy'} size={12} />
              {copied ? 'Copied' : 'Copy the list'}
            </button>
            <button type="button" className="btn on-d sm" onClick={reset} disabled={Boolean(progress)}>
              <Icon name="plus" size={12} />
              Import more
            </button>
          </div>

          {issued.length > 0 && (
            <div className="note on-d" style={{ marginBottom: 12 }}>
              <Icon name="info" size={15} />
              <span>
                These codes are shown once. Nothing in BloomLoop lists them again, so copy them
                before you leave this screen.
              </span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {issued.map((b) => (
              <div key={b.userId} className="d-row">
                <span className="t">
                  <b>{b.name || 'Unnamed student'}</b>
                  <span style={{ fontFamily: 'var(--mono)' }}>
                    {b.rollNo ? `roll ${b.rollNo}` : 'no roll number'}
                  </span>
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 14, fontWeight: 700, letterSpacing: '0.12em',
                    userSelect: 'all', color: 'var(--on-d)',
                  }}
                >
                  {b.code}
                </span>
              </div>
            ))}
          </div>

          {refused.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {refused.map((b) => (
                <div key={b.userId} className="note dk" style={{ marginTop: 8 }}>
                  <Icon name="alert" size={15} />
                  <span>{b.name || 'Unnamed student'}: {b.error}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ screen */

export default function ProfessorHome() {
  const navigate = useNavigate();
  const { account, loading: accountLoading } = useAccount();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reloading, setReloading] = useState(false);

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [pickedId, setPickedId] = useState('');

  const [inviting, setInviting] = useState(false);
  const [draft, setDraft] = useState({ rollNo: '', fullName: '', email: '' });
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null);
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);

  /* Whether the roster import is open. Everything else about it — status,
     courses, ticks, results — belongs to <ClassroomImport>, which owns its own
     state so this screen neither knows nor waits for any of it. */
  const [importing, setImporting] = useState(false);

  const panelRef = useRef(null);

  /* One read per signed-in account. It waits for the session to be restored:
     firing before then sends no bearer token, and the server would answer with
     the shared-key professor — a real payload describing somebody else's rows. */
  useEffect(() => {
    if (accountLoading) return undefined;
    let alive = true;
    api.dashboard().then(
      (res) => { if (alive) { setData(res); setError(''); } },
      (err) => { if (alive) setError(err.message); },
    );
    return () => { alive = false; };
  }, [accountLoading, account?.id]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function refresh() {
    setReloading(true);
    try {
      setData(await api.dashboard());
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setReloading(false);
    }
  }

  function openInvite() {
    setIssued(null);
    setInviteError('');
    setImporting(false);
    setInviting(true);
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* One thing at a time in this panel, which is the rule the invite form and the
     student card already follow: two forms open at once on a dark surface reads
     as one long form with a stray heading in the middle of it. */
  function openImport() {
    setIssued(null);
    setInviting(false);
    setImporting(true);
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function issue(event) {
    event.preventDefault();
    setIssuing(true);
    setInviteError('');
    const rollNo = draft.rollNo.trim();
    const fullName = draft.fullName.trim();
    const email = draft.email.trim();
    try {
      // Only what was actually typed: the server treats a blank string and an
      // absent field the same way, and sending '' for all three would write
      // three empty columns onto the invite row for no reason.
      const body = { role: 'student' };
      if (rollNo) body.rollNo = rollNo;
      if (fullName) body.fullName = fullName;
      if (email) body.email = email;

      const res = await api.invite(body);
      // Kept alongside the code: the response is { code, role, expiresAt } and
      // does not echo the roll number back, but the roll number is the whole
      // reason the professor filled this in and has to stay on screen with it.
      setIssued({ ...res.invite, rollNo, fullName });
      setInviting(false);
      setDraft({ rollNo: '', fullName: '', email: '' });
      // No reload: an invite creates nothing. The roster changes when the
      // student redeems the code, which will not be in the next second.
    } catch (err) {
      setInviteError(err.message);
    } finally {
      setIssuing(false);
    }
  }

  async function copy(code) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard access is blocked on plain http and behind some policies. The
      // code is on screen at 48px with user-select:all, so there is a way to get
      // it either way and nothing worth interrupting the professor about.
    }
  }

  const counts = data?.counts ?? {};
  const contents = useMemo(() => data?.contents ?? [], [data]);
  const sessions = useMemo(() => data?.recentSessions ?? [], [data]);
  const roster = useMemo(() => data?.roster ?? [], [data]);
  const bloom = useMemo(() => data?.bloom ?? [], [data]);

  /* Every repo hands sessions back newest first, so a bar row that should read
     left to right as time has to be turned around before it is drawn. */
  const timeline = useMemo(() => [...sessions].reverse(), [sessions]);

  const linked = roster.filter((s) => rollOf(s)).length;
  const seenTotal = bloom.reduce((n, b) => n + (b.seen ?? 0), 0);

  // Where the class's questions actually landed. Lime marks it, which is the one
  // job lime has, and it is the same claim the live grid makes with it.
  const peak = bloom.reduce((best, b, i) => (b.seen > (bloom[best]?.seen ?? -1) ? i : best), 0);

  // The thinnest level among those that have been served at all: an untouched
  // level is not a weakness, it is a gap in the bank, and saying otherwise would
  // send a professor to re-weight a level nobody has been asked about.
  const weakest = useMemo(() => {
    const served = bloom.filter((b) => b.seen > 0 && b.accuracy != null);
    if (served.length === 0) return null;
    return served.reduce((low, b) => (b.accuracy < low.accuracy ? b : low));
  }, [bloom]);

  const shownRoster = useMemo(() => {
    const match = (ROSTER_FILTERS.find((f) => f.id === filter) ?? ROSTER_FILTERS[0]).match;
    const q = query.trim().toLowerCase();
    return roster.filter(
      (s) => match(s)
        && (!q || `${s.fullName ?? ''} ${s.code ?? ''} ${rollOf(s)}`.toLowerCase().includes(q)),
    );
  }, [roster, filter, query]);

  /* Default to a student with no roll number: that is the one carrying an
     action, and a professor should not have to hunt down the broken link. */
  const picked = useMemo(() => {
    if (roster.length === 0) return null;
    return roster.find((s) => s.id === pickedId)
      ?? roster.find((s) => !rollOf(s))
      ?? roster[0];
  }, [roster, pickedId]);

  // The shared teacher key is not an account, and requireRole refuses it on
  // purpose — there is no reporting line to hang an invited student off.
  const canInvite = Boolean(account);

  const chrome = {
    badge: account?.code ? <span className="barcount mono">{account.code}</span> : null,
    nav: (
      <NavPill
        items={[
          { id: 'home', label: 'Overview' },
          { id: 'analytics', label: 'Analytics' },
          { id: 'rooms', label: 'Rooms' },
          { id: 'console', label: 'Teaching console' },
        ]}
        value="home"
        onChange={(id) => {
          if (id === 'analytics') navigate('/analytics');
          else if (id === 'rooms') navigate('/rooms');
          else if (id === 'console') navigate('/');
        }}
      />
    ),
    right: (
      <>
        {data?.department && <span className="flag neutral">{data.department}</span>}
        <button
          type="button"
          className="iconbtn"
          title="Read the dashboard again"
          onClick={refresh}
          disabled={reloading}
        >
          {reloading ? <span className="spin" /> : <Icon name="refresh" />}
        </button>
        {account && (
          <>
            <Avatar name={account.fullName || account.email || 'Professor'} href="/profile" />
            <button type="button" className="iconbtn" title="Sign out" onClick={() => signOut()}>
              <Icon name="logout" />
            </button>
          </>
        )}
      </>
    ),
  };

  if (!data) {
    return (
      <Shell {...chrome}>
        {error ? (
          <Card>
            <Empty
              icon="alert"
              title="The dashboard did not load"
              action={
                <button type="button" className="btn pri" onClick={refresh} disabled={reloading}>
                  {reloading ? <span className="spin" /> : <Icon name="refresh" size={13} />}
                  Try again
                </button>
              }
            >
              {error}
            </Empty>
          </Card>
        ) : (
          <Skeleton />
        )}
      </Shell>
    );
  }

  return (
    <Shell {...chrome}>
      <PageHead
        title="Your teaching"
        sub={
          `${counts.contents ?? 0} chapter${counts.contents === 1 ? '' : 's'} · `
          + `${counts.questions ?? 0} questions written · ${counts.sessions ?? 0} session`
          + `${counts.sessions === 1 ? '' : 's'} run · ${counts.students ?? 0} student`
          + `${counts.students === 1 ? '' : 's'} on your roster`
        }
        actions={
          <>
            <button type="button" className="btn" onClick={openInvite} disabled={!canInvite}>
              <Icon name="key" size={13} />
              Invite a student
            </button>
            {/* Not hidden when Classroom is unconfigured, and not disabled
                either: opening it is how a professor finds out why it cannot
                work and what to do instead. A greyed button with a tooltip says
                neither, and says nothing at all on a touch screen. */}
            <button type="button" className="btn" onClick={openImport} disabled={!canInvite}>
              <Icon name="google" size={13} />
              Import a roster
            </button>
            <button type="button" className="btn pri" onClick={() => navigate('/')}>
              Open the console
              <Icon name="forward" size={13} />
            </button>
          </>
        }
      />

      {error && (
        <div className="note bad" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>The numbers below are the last ones that loaded: {error}</span>
        </div>
      )}

      {/* The role decides the payload shape, so a mismatch means this screen is
          mounted on the wrong route rather than that the data is odd. */}
      {data.role && data.role !== 'professor' && (
        <div className="note warn" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>
            Your account signs in as {data.role}, so this is not your screen — nothing here is
            shaped for it.
          </span>
        </div>
      )}

      {!canInvite && (
        <div className="note info" style={{ marginBottom: 14 }}>
          <Icon name="info" size={15} />
          <span>
            This console is open on the shared teacher key, which is not an account. It can read
            the rows nobody owns, but it cannot issue an invite: an invited student has to report
            to somebody, and a key reports to nobody.
          </span>
        </div>
      )}

      {/* ---------------------------------------------------------- counters */}

      <div className="grid auto" style={{ marginBottom: 16 }}>
        <Stat
          label="Students"
          icon="users"
          value={counts.students ?? 0}
          delta={`${linked} of them linked to a roll number`}
          deltaTone={roster.length > 0 && linked < roster.length ? 'down' : ''}
          tail={tailOf(
            roster.length > 0
              ? [
                { label: 'ROLL', value: linked, on: true },
                { label: 'NONE', value: roster.length - linked },
              ]
              : [],
          )}
        />
        <Stat
          label="Chapters"
          icon="deck"
          value={counts.contents ?? 0}
          delta="topics ticked on each, numbered as below"
          tail={tailOf(contents.slice(0, 8).map((c, i) => ({
            label: String(i + 1), value: c.topics ?? 0, on: true,
          })))}
        />
        <Stat
          label="Questions written"
          icon="layers"
          value={counts.questions ?? 0}
          delta={`across ${contents.length} chapter${contents.length === 1 ? '' : 's'}`}
          tail={tailOf(contents.slice(0, 8).map((c, i) => ({
            label: String(i + 1), value: c.questions ?? 0, on: true,
          })))}
        />
        <Stat
          label="Sessions run"
          icon="broadcast"
          value={counts.sessions ?? 0}
          delta={`${counts.attendances ?? 0} seats filled across them`}
          tail={tailOf(timeline.map((s, i) => ({
            label: String(i + 1), value: s.joined ?? 0, on: i === timeline.length - 1,
          })))}
        />
        <Stat
          label="Class accuracy"
          icon="activity"
          // 40% is the product's own line — below it a student is in the support
          // band — so it is the only threshold allowed to tint anything here.
          tone={counts.accuracy != null && counts.accuracy < 0.4 ? 'bad' : 'ok'}
          value={share(counts.accuracy)}
          delta="the mean of each student's own accuracy"
          tail={tailOf(timeline
            .filter((s) => s.accuracy != null)
            .map((s, i, arr) => ({
              label: String(i + 1),
              value: Math.round(s.accuracy * 100),
              on: i === arr.length - 1,
            })))}
        />
        <Stat
          label="In the support band"
          icon="alert"
          tone="warn"
          value={counts.banded ?? 0}
          unit={`of ${counts.attendances ?? 0}`}
          delta="under 40% overall in the session they sat"
          tail={tailOf(timeline.map((s, i) => ({
            label: String(i + 1), value: s.banded ?? 0, on: (s.banded ?? 0) > 0,
          })))}
        />
      </div>

      {/* ------------------------------------------------------------- bloom */}

      <Card style={{ marginBottom: 16 }}>
        <div className="cardhead">
          <h2>Across the six levels</h2>
          <span className="sub">
            every question your students have been served, in every session you have run
          </span>
        </div>

        {seenTotal === 0 ? (
          <Empty
            icon="chart"
            title="Nothing to spread across the levels yet"
            action={
              <button type="button" className="btn pri" onClick={() => navigate('/')}>
                <Icon name="play" size={13} />
                Run a session
              </button>
            }
          >
            The taxonomy fills in from answers, not from banks. One session with one class puts
            six bars here.
          </Empty>
        ) : (
          <>
            {/* Share of questions served, not of accuracy: the width says where
                the class spent its time and the bars below say how it went. */}
            <div className="dist">
              {bloom.map((b) => b.seen > 0 && (
                <i key={b.level} className={`swatch ${b.level}`} style={{ flex: b.seen }} />
              ))}
            </div>

            <div className="bars" style={{ marginTop: 20 }}>
              {bloom.map((b, i) => (
                <div key={b.level}>
                  <div className="lab">{b.seen > 0 ? `${b.correct}/${b.seen}` : '—'}</div>
                  <div className={`track${i === peak ? ' cur' : ''}`}>
                    <i
                      className={`swatch ${b.level}`}
                      style={{ height: `${Math.round((b.accuracy ?? 0) * 100)}%` }}
                    />
                  </div>
                  <div className={`nm${i === peak ? ' cur' : ''}`}>{LABEL[b.level]}</div>
                </div>
              ))}
            </div>

            <div className="said" style={{ marginTop: 20 }}>
              <span>
                Lime marks {LABEL[LEVELS[peak]]} — where most of your class&apos;s questions landed.
                {weakest && weakest.level !== LEVELS[peak] && (
                  <> {LABEL[weakest.level]} is the thinnest at {share(weakest.accuracy)} of{' '}
                    {weakest.seen} served, which is the level to weight the next bank towards.</>
                )}
              </span>
            </div>
          </>
        )}
      </Card>

      {/* ---------------------------------------------------------- chapters */}

      <div className="cardhead">
        <h2>Your chapters</h2>
        <span className="sub">what you have loaded, what it holds, and what it has run</span>
      </div>

      {contents.length === 0 ? (
        <Card style={{ marginBottom: 16 }}>
          <Empty
            icon="deck"
            title="No material loaded yet"
            action={
              <button type="button" className="btn pri" onClick={() => navigate('/')}>
                <Icon name="upload" size={13} />
                Load a chapter
              </button>
            }
          >
            A deck or a pasted syllabus is all it takes. Everything else on this screen is written
            from what you already teach.
          </Empty>
        </Card>
      ) : (
        <div className="grid auto-lg" style={{ marginBottom: 16 }}>
          {contents.map((c, i) => <ChapterCard key={c.id} n={i + 1} content={c} />)}
        </div>
      )}

      {/* ---------------------------------------------------------- sessions */}

      {sessions.length === 0 ? (
        <Card style={{ marginBottom: 16 }}>
          <Empty
            icon="broadcast"
            title="No sessions run yet"
            action={
              <button
                type="button"
                className="btn pri"
                onClick={() => navigate('/')}
                disabled={contents.length === 0}
              >
                <Icon name="play" size={13} />
                Open a room
              </button>
            }
          >
            {contents.length === 0
              ? 'Load a chapter and write a bank first — a room needs questions to serve.'
              : 'Your banks are written. A room takes a code onto the projector and the class does the rest.'}
          </Empty>
        </Card>
      ) : (
        <Card className="flush" style={{ marginBottom: 16 }}>
          <div style={{ padding: '16px 18px 12px' }}>
            <div className="cardhead" style={{ marginBottom: 0 }}>
              <h2>Recent sessions</h2>
              <span className="sub">newest first · {sessions.length} shown</span>
            </div>
          </div>
          {sessions.map((s, i) => <SessionRow key={s.code} session={s} first={i === 0} />)}
        </Card>
      )}

      {/* ------------------------------------------------------------ roster */}

      {roster.length > 0 && (
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          {ROSTER_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="fpill"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <b>{roster.filter(f.match).length}</b>
            </button>
          ))}
          <label className="search right" style={{ width: 232 }}>
            <Icon name="search" size={13} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a name, code or roll number"
              aria-label="Find a student on your roster"
            />
          </label>
        </div>
      )}

      <div className="panel" ref={panelRef}>
        <div className="panel-head">
          <span className="t">Your students</span>
          {/* The reason sits in the subtitle rather than behind a form: a
              professor should know what the roll number is for before they are
              asked to type one. */}
          <span className="panel-sub">
            {roster.length} account{roster.length === 1 ? '' : 's'} report to you
            {roster.length > 0
              && ` · ${linked} carry a roll number, which is what joins an account to its results`}
          </span>
          <span className="grow" />
          {/* Rendered, not disabled: .btn.on-d sets its own colour at a higher
              specificity than .btn:disabled, so a disabled one on this panel
              looks exactly like a live one. The note above the fold says why it
              is missing on the shared-key path. */}
          {canInvite && (
            <>
              <button type="button" className="btn on-d" onClick={openImport}>
                <Icon name="google" size={13} />
                Import a roster
              </button>
              <button type="button" className="btn on-d solid" onClick={openInvite}>
                <Icon name="key" size={13} />
                Invite a student
              </button>
            </>
          )}
        </div>

        {/* --- the invite form ------------------------------------------- */}
        {inviting && (
          <form
            className="dk"
            onSubmit={issue}
            style={{
              background: 'var(--d-2)', borderRadius: 'var(--r-card)',
              padding: '16px 18px', marginBottom: 14,
            }}
          >
            <div className="row" style={{ gap: 10, marginBottom: 16 }}>
              <span className="eyebrow on-d grow">New invite · student</span>
              <button
                type="button"
                className="d-tile"
                onClick={() => setInviting(false)}
                aria-label="Close the invite form"
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            {/* The roll number is first and alone on its row because it is the
                only field on this form that changes what the account can do. */}
            <div className="field" style={{ marginBottom: 16 }}>
              <label htmlFor="invite-roll">Roll number</label>
              <input
                id="invite-roll"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck="false"
                placeholder="21CS047"
                value={draft.rollNo}
                onChange={(e) => setDraft((d) => ({ ...d, rollNo: e.target.value.toUpperCase() }))}
              />
              <div className="hint">
                The number this student types on their phone to join a room. It is the only thing
                that ties this account to the answers it gives, and every session that number has
                already sat lands on their results the moment they sign in.
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="invite-name">Who it is for</label>
                <input
                  id="invite-name"
                  autoComplete="off"
                  value={draft.fullName}
                  onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="invite-email">Email</label>
                <input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                />
              </div>
            </div>
            <div className="hint" style={{ marginTop: 9 }}>
              Both are optional, and both are only a label on the invite so you can tell two codes
              apart. The student types their own name and address when they redeem it, and those
              are the ones the account keeps.
            </div>

            {!draft.rollNo.trim() && (
              <div className="said" style={{ marginTop: 16 }}>
                <span style={{ color: 'var(--on-d-2)' }}>
                  With no roll number the invite still works and the account still reports to you —
                  but nothing joins it to what happens in the room, so their results screen stays
                  empty. Only a head of department can add the number afterwards.
                </span>
              </div>
            )}

            {inviteError && (
              <div className="note dk" style={{ marginTop: 16 }}>
                <Icon name="alert" size={15} />
                <span>{inviteError}</span>
              </div>
            )}

            <div className="row" style={{ gap: 8, marginTop: 18 }}>
              <button type="submit" className="btn on-d solid" disabled={issuing}>
                {issuing ? <><span className="spin" />Issuing…</> : <><Icon name="key" size={13} />Issue the invite</>}
              </button>
              {/* Not disabled while the POST is open. Closing the form does not
                  cancel it, and it should not: the invite either was written or
                  was not, and if it was the code has to appear either way. */}
              <button type="button" className="btn on-d" onClick={() => setInviting(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* --- the roster import ----------------------------------------- */}
        {importing && <ClassroomImport onClose={() => setImporting(false)} />}

        {/* --- the gradient card: the invite just issued, or the selected
                student. One thing at a time, because there is only ever one
                thing the professor is doing here. ------------------------- */}
        {issued ? (
          <div className="accent" style={{ marginBottom: 14 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="k">Invite issued · student</span>
              <span className="grow" />
              <button type="button" className="btn on-d sm" onClick={() => setIssued(null)}>
                Done
              </button>
            </div>

            <div
              style={{
                marginTop: 14, fontFamily: 'var(--mono)', fontSize: 'clamp(32px, 6.5vw, 48px)',
                fontWeight: 700, lineHeight: 1, letterSpacing: '0.16em', userSelect: 'all',
              }}
            >
              {issued.code}
            </div>

            <div className="row" style={{ gap: 8, marginTop: 18 }}>
              <button type="button" className="btn on-d solid sm" onClick={() => copy(issued.code)}>
                <Icon name={copied ? 'check' : 'copy'} size={12} />
                {copied ? 'Copied' : 'Copy the code'}
              </button>
              <button type="button" className="btn on-d sm" onClick={openInvite}>
                <Icon name="plus" size={12} />
                Issue another
              </button>
            </div>

            <div className="tiles" style={{ marginTop: 18 }}>
              <div className="accent-tile">
                <b>
                  <span style={{ fontFamily: 'var(--mono)' }}>{issued.rollNo || 'Not set'}</span>
                  <Icon name={issued.rollNo ? 'check' : 'alert'} size={11} />
                </b>
                <span>Roll number on this invite</span>
              </div>
              <div className="accent-tile">
                <b>{day(issued.expiresAt)}</b>
                <span>Lapses on</span>
              </div>
              <div className="accent-tile">
                <b>Single use</b>
                <span>One code, one account</span>
              </div>
            </div>

            <div className="said" style={{ marginTop: 18 }}>
              <span style={{ color: 'var(--on-d)' }}>
                {issued.rollNo
                  ? `Send this to ${issued.fullName || 'them'}. Redeeming it creates an account `
                    + `against roll number ${issued.rollNo}, and every session that number has `
                    + 'already sat in your rooms shows up on their results straight away.'
                  : 'This code carries no roll number, so the account it creates is joined to '
                    + 'nothing that happens in the room and their results screen opens empty. If '
                    + 'you know the number, issue a fresh code with it on — you cannot add it '
                    + 'later, only a head of department can.'}
              </span>
            </div>
          </div>
        ) : (
          !inviting && !importing && picked && <StudentCard student={picked} />
        )}

        {/* --- the roster ------------------------------------------------ */}
        {roster.length === 0 ? (
          <DarkEmpty
            icon="users"
            title="Nobody reports to you yet"
            action={canInvite && (
              <button type="button" className="btn on-d solid" onClick={openInvite}>
                <Icon name="key" size={13} />
                Invite your first student
              </button>
            )}
          >
            Students join a room with a code and a roll number and need no account for that. An
            account is what lets them read their own history back afterwards.
          </DarkEmpty>
        ) : shownRoster.length === 0 ? (
          <DarkEmpty
            icon="search"
            title="No student matches"
            action={(
              <button
                type="button"
                className="btn on-d"
                onClick={() => { setFilter('all'); setQuery(''); }}
              >
                Clear the filter
              </button>
            )}
          >
            Nothing on your roster answers to that. Clear the search, or put the filter back to
            Everyone.
          </DarkEmpty>
        ) : (
          <div
            style={{
              display: 'flex', flexDirection: 'column', gap: 2,
              // Long rosters scroll inside the panel rather than pushing the
              // whole page down past everything else on it.
              ...(shownRoster.length > 8 ? { maxHeight: 384, overflowY: 'auto' } : null),
            }}
          >
            {shownRoster.map((s) => {
              const roll = rollOf(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="d-row"
                  aria-selected={picked?.id === s.id}
                  onClick={() => { setPickedId(s.id); setIssued(null); setInviting(false); }}
                >
                  <Avatar name={s.fullName} size="sm" className="on-d" />
                  <span className="t">
                    <b>{s.fullName || 'Unnamed account'}</b>
                    {/* .d-row .t span carries a `font` shorthand, so the family
                        has to be stated inline to survive it. */}
                    <span style={{ fontFamily: 'var(--mono)' }}>
                      {s.code}{roll ? ` · roll ${roll}` : ' · no roll number'}
                    </span>
                  </span>
                  {!roll && <span className="flag">unlinked</span>}
                  {!s.active && <span className="flag neutral">off</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
