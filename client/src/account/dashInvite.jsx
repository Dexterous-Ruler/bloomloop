/**
 * Inviting students: one at a time, several from a pasted list, or from a
 * Google Classroom roster. One dialog, three ways in.
 *
 * Every invite is the same POST. What differs is where the fields come from,
 * and the one that matters is the roll number: a live room identifies a student
 * by the number typed on their phone, so that number is the only thread between
 * an account and the answers it gave. A professor cannot add one afterwards
 * (only a head of department can), which is why each way in puts it first.
 *
 * The Classroom route also carries Google's own user id onto the invite, so a
 * mark posted back to Classroom lands on that exact Google account instead of
 * on whoever a name matcher guessed.
 *
 * `services` is the handful of calls this needs - { invite, classroomStatus,
 * classroomAuthUrl, classroomCourses, classroomCourseStudents } - passed in so
 * the dev gallery can stand in for the server.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button, Chip, Dialog, Empty, Field, Note, Segmented, Tick } from '../ui/index.jsx';
import { CodeBlock, dateOf, Facts, plural } from './dashParts.jsx';

const WAYS = [
  { id: 'one', label: 'One' },
  { id: 'many', label: 'Several' },
  { id: 'google', label: 'Google Classroom' },
];

/**
 * A roll number the professor may have meant, read off the school address.
 * '21cs047@college.edu' -> '21CS047'.
 *
 * Returns '' when the local part holds no run of digits: 'anita.rao@' would
 * otherwise become the roll number 'ANITARAO', a confident-looking value with
 * nothing behind it in the one field that decides whether an account ever sees
 * its own results. A blank that has to be noticed beats a wrong number that
 * will not be.
 */
function rollFromEmail(email) {
  const local = String(email ?? '').split('@')[0];
  const cleaned = local.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return /\d{2,}/.test(cleaned) ? cleaned : '';
}

/** One student per line: roll number, then a name and an email if there are any. */
function readLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const cells = line.split(/[\t,;]/).map((c) => c.trim());
      return { key: `line-${i}`, rollNo: (cells[0] ?? '').toUpperCase(), name: cells[1] ?? '', email: cells[2] ?? '' };
    });
}

/**
 * One POST per student, in order.
 *
 * Sequential, not parallel: the server draws a fresh code and retries on a
 * collision, and forty concurrent inserts turn a rare retry into a common one.
 * A failure is recorded against its own student and the run carries on - one
 * refused invite must not cost the rest their codes.
 */
async function issueAll(invite, queue, onStep) {
  const made = [];
  for (let i = 0; i < queue.length; i += 1) {
    const s = queue[i];
    onStep({ done: i, total: queue.length });
    try {
      // Only what is actually there: a blank string and an absent field mean
      // the same to the server, and there is no reason to write empty columns.
      const body = { role: 'student' };
      if (s.googleSub) body.googleSub = s.googleSub;
      if (s.rollNo) body.rollNo = s.rollNo;
      if (s.name) body.fullName = s.name;
      if (s.email) body.email = s.email;
      const res = await invite(body);
      made.push({ key: s.key, name: s.name, rollNo: s.rollNo, code: res.invite.code });
    } catch (err) {
      made.push({ key: s.key, name: s.name, rollNo: s.rollNo, error: err.message });
    }
  }
  return made;
}

/** Actions belong in the dialog's footer, whichever way in is showing. */
function Foot({ to, children }) {
  return to ? createPortal(children, to) : null;
}

/* ------------------------------------------------------------ what came back */

function Issued({ batch, foot, again, onAgain, onDone }) {
  const [copied, setCopied] = useState('');
  const issued = batch.filter((b) => b.code);
  const refused = batch.filter((b) => b.error);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(''), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function copyAll() {
    const lines = issued.map((b) => [b.rollNo || '—', b.name || '—', b.code].join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      setCopied('Copied');
    } catch {
      // Blocked on plain http and behind some policies. Every code is on
      // screen and selectable, so there is another way to get them.
      setCopied('Copy blocked');
    }
  }

  return (
    <div className="stack">
      <div className="cluster between">
        <h4>
          {plural(issued.length, 'invite')} issued{refused.length > 0 && `, ${refused.length} refused`}
        </h4>
        <Button size="sm" className="dash-tap" icon={copied === 'Copied' ? 'check' : 'copy'} disabled={issued.length === 0} onClick={copyAll}>
          <span aria-live="polite">{copied || 'Copy the list'}</span>
        </Button>
      </div>

      {issued.length > 0 && (
        <>
          <Note>These codes are shown once. Nothing lists them again, so copy them before you close this.</Note>
          <ul className="rows dash-box">
            {issued.map((b) => (
              <li key={b.key} className="rw">
                <span className="rw-main">
                  <span className="strong clip dash-block">{b.name || 'Unnamed student'}</span>
                  <span className="t-meta mono">{b.rollNo ? `Roll ${b.rollNo}` : 'No roll number'}</span>
                </span>
                <span className="mono strong dash-all">{b.code}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {refused.map((b) => (
        <Note key={b.key} tone="bad">{b.name || b.rollNo || 'Unnamed student'}: {b.error}</Note>
      ))}

      <Foot to={foot}>
        <Button onClick={onAgain}>{again}</Button>
        <Button variant="primary" onClick={onDone}>Done</Button>
      </Foot>
    </div>
  );
}

/* ------------------------------------------------------------------- one */

function One({ services, foot, onBusy, onDone }) {
  const [draft, setDraft] = useState({ rollNo: '', fullName: '', email: '' });
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState('');

  async function issue(event) {
    event.preventDefault();
    setIssuing(true);
    onBusy(true);
    setError('');
    const rollNo = draft.rollNo.trim();
    const fullName = draft.fullName.trim();
    const email = draft.email.trim();
    try {
      const body = { role: 'student' };
      if (rollNo) body.rollNo = rollNo;
      if (fullName) body.fullName = fullName;
      if (email) body.email = email;
      const res = await services.invite(body);
      // Kept beside the code: the answer is { code, role, expiresAt } and does
      // not echo the roll number, which is the reason the form was filled in.
      setIssued({ ...res.invite, rollNo, fullName });
      setDraft({ rollNo: '', fullName: '', email: '' });
      // No reload of the roster: an invite creates nothing until it is redeemed.
    } catch (err) {
      setError(err.message || 'The invite was not created.');
    } finally {
      setIssuing(false);
      onBusy(false);
    }
  }

  if (issued) {
    return (
      <div className="stack">
        <CodeBlock code={issued.code} label={issued.fullName ? `Invite for ${issued.fullName}` : 'Student invite'} />
        <Facts
          items={[
            ['Roll number on this invite', issued.rollNo ? <span className="mono">{issued.rollNo}</span> : 'Not set'],
            ['Expires', dateOf(issued.expiresAt) || '—'],
            ['Use', 'Once, for one account'],
          ]}
        />
        <p className="said">
          {issued.rollNo
            ? `Send this to ${issued.fullName || 'them'}. Redeeming it creates an account against roll number ${issued.rollNo}, and every room that number has already sat shows up on their results straight away.`
            : 'This code carries no roll number, so the account it creates is joined to nothing that happens in a room and their results open empty. If you know the number, issue a fresh code with it on. You cannot add it later; only a head of department can.'}
        </p>
        <Foot to={foot}>
          <Button icon="plus" onClick={() => setIssued(null)}>Issue another</Button>
          <Button variant="primary" onClick={onDone}>Done</Button>
        </Foot>
      </div>
    );
  }

  return (
    <form id="dash-invite-one" className="stack" onSubmit={issue}>
      {/* First and alone on its row: the only field here that changes what the
          account can do. */}
      <Field
        label="Roll number"
        htmlFor="dash-one-roll"
        hint="What this student types on their phone to join a room. It is the only thing that ties the account to the answers it gives, and rooms that number has already sat appear the moment they sign in."
      >
        <input
          id="dash-one-roll"
          className="input input-code"
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="21CS047"
          disabled={issuing}
          value={draft.rollNo}
          onChange={(e) => setDraft((d) => ({ ...d, rollNo: e.target.value.toUpperCase() }))}
        />
      </Field>

      <div className="grid-2">
        <Field label="Who it is for" optional htmlFor="dash-one-name">
          <input id="dash-one-name" className="input" autoComplete="off" disabled={issuing} value={draft.fullName} onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))} />
        </Field>
        <Field label="Email" optional htmlFor="dash-one-email">
          <input id="dash-one-email" className="input" type="email" autoComplete="off" disabled={issuing} value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
        </Field>
      </div>
      <p className="hint">
        Both only label the invite so you can tell two codes apart. The student types their own name and address when
        they redeem it, and those are the ones the account keeps.
      </p>

      {!draft.rollNo.trim() && (
        <p className="said">
          Without a roll number the invite still works and the account still reports to you, but nothing joins it to
          what happens in a room, so their results stay empty. Only a head of department can add the number afterwards.
        </p>
      )}

      {error && <Note tone="bad" role="alert">{error}</Note>}

      <Foot to={foot}>
        <Button variant="ghost" disabled={issuing} onClick={onDone}>Cancel</Button>
        <Button type="submit" form="dash-invite-one" variant="primary" icon="key" busy={issuing}>Issue the invite</Button>
      </Foot>
    </form>
  );
}

/* --------------------------------------------------------------- several */

function Several({ services, foot, onBusy, onDone }) {
  const [text, setText] = useState('');
  const [progress, setProgress] = useState(null);
  const [batch, setBatch] = useState(null);

  const rows = useMemo(() => readLines(text), [text]);
  const blank = rows.filter((r) => !r.rollNo).length;
  const rolls = rows.map((r) => r.rollNo).filter(Boolean);
  const repeats = rolls.length - new Set(rolls).size;

  async function create() {
    onBusy(true);
    const made = await issueAll(services.invite, rows, setProgress);
    setBatch(made);
    setProgress(null);
    onBusy(false);
  }

  if (batch && !progress) {
    return <Issued batch={batch} foot={foot} again="Add more" onAgain={() => { setBatch(null); setText(''); }} onDone={onDone} />;
  }

  return (
    <div className="stack">
      <Field
        label="One student per line"
        htmlFor="dash-many-text"
        hint="Roll number first, then a name and an email if you have them, separated by commas or tabs. Rows pasted from a spreadsheet work as they are."
      >
        <textarea
          id="dash-many-text"
          className="textarea dash-paste"
          rows={6}
          spellCheck={false}
          placeholder={'21CS047, Anita Rao, anita@college.edu\n21CS048, Dev Malhotra\n21CS049'}
          disabled={Boolean(progress)}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>

      {/* Read back before anything is written, so a column in the wrong place
          is seen here and not on forty invites. */}
      {rows.length > 0 && (
        <>
          <div className="dash-box dash-scroll">
            <table className="tbl">
              <thead><tr><th>Roll number</th><th>Name</th><th>Email</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono">{r.rollNo || <span className="muted">none</span>}</td>
                    <td className="wrap-any">{r.name || <span className="muted">none</span>}</td>
                    <td className="wrap-any">{r.email || <span className="muted">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(blank > 0 || repeats > 0) && (
            <Note>
              {blank > 0 && `${plural(blank, 'line has', 'lines have')} no roll number, so ${blank === 1 ? 'that account' : 'those accounts'} will be joined to nothing in a room. `}
              {repeats > 0 && `${plural(repeats, 'roll number is', 'roll numbers are')} repeated: each line still gets its own code.`}
            </Note>
          )}
        </>
      )}

      <Foot to={foot}>
        <Button variant="ghost" disabled={Boolean(progress)} onClick={onDone}>Cancel</Button>
        <Button variant="primary" icon="key" busy={Boolean(progress)} disabled={rows.length === 0} onClick={create}>
          {progress ? `Issuing ${progress.done + 1} of ${progress.total}` : `Create ${plural(rows.length, 'invite')}`}
        </Button>
      </Foot>
    </div>
  );
}

/* ------------------------------------------------------- Google Classroom */

/**
 * Every state below falls back to the same place: the other two ways in, which
 * need nothing from Google. Google may be unconfigured, unconsented or simply
 * unreachable from the college wifi, and none of those may leave a professor
 * with no way to invite a student.
 */
function Classroom({ services, foot, onBusy, onDone }) {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState(false);
  const [courses, setCourses] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [loading, setLoading] = useState('');
  const [students, setStudents] = useState(null);
  // userId -> { on, rollNo }. Keyed by the Google id, not by position, so
  // loading a different course cannot carry a tick onto a different student.
  const [picks, setPicks] = useState({});
  const [progress, setProgress] = useState(null);
  const [batch, setBatch] = useState(null);
  const [filled, setFilled] = useState(null);

  useEffect(() => {
    let alive = true;
    services.classroomStatus().then(
      (res) => { if (alive) setStatus(res); },
      (err) => { if (alive) setError(err.message); },
    );
    return () => { alive = false; };
  }, [services]);

  /* Consent happens in another tab, so this one has to be told to look again. */
  async function recheck() {
    setChecking(true);
    setError('');
    try {
      setStatus(await services.classroomStatus());
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  /* The course list is the first thing a connected professor needs, so it is
     fetched, not hidden behind a button with only one answer. */
  useEffect(() => {
    if (!status?.connected || courses !== null) return undefined;
    let alive = true;
    setLoading('courses');
    services.classroomCourses().then(
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
  }, [status?.connected, courses, services]);

  /**
   * Ask the server for the consent URL, then send the browser to Google. The
   * tab is opened inside the click, before the await: opened after the request
   * resolves it is a popup, and every browser blocks it.
   */
  async function connect() {
    setError('');
    setLinking(true);
    // Not with "noopener": that makes open() return null, so the tab could
    // never be sent anywhere. The opener is cut by hand instead.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url } = await services.classroomAuthUrl();
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
      const res = await services.classroomCourseStudents(courseId);
      const list = res.students ?? [];
      setStudents(list);
      // Nothing ticked to begin with. Forty students pre-selected is forty
      // invites one misplaced press away, before a single row has been read.
      setPicks(Object.fromEntries(list.map((s) => [s.userId, { on: false, rollNo: '' }])));
    } catch (err) {
      setError(`Could not read that course roster: ${err.message}`);
    } finally {
      setLoading('');
    }
  }

  const importable = useMemo(() => (students ?? []).filter((s) => !s.linked), [students]);
  const chosen = useMemo(() => importable.filter((s) => picks[s.userId]?.on), [importable, picks]);
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
   * Fill the roll-number fields from the email addresses. A button, not
   * something that happens on load: guessing a roll number is the quiet
   * inference this import exists to replace, so the professor performs it, sees
   * every value it produced and can correct any before an invite is written.
   */
  function fillRolls() {
    let hit = 0;
    const next = { ...picks };
    for (const s of importable) {
      const guess = rollFromEmail(s.email);
      if (!guess) continue;
      hit += 1;
      next[s.userId] = { ...(next[s.userId] ?? { on: false }), rollNo: guess };
    }
    setPicks(next);
    setFilled({ hit, of: importable.length });
  }

  async function createInvites() {
    setError('');
    onBusy(true);
    const queue = chosen.map((s) => ({
      key: s.userId,
      googleSub: s.userId,
      rollNo: (picks[s.userId]?.rollNo ?? '').trim(),
      name: s.name,
      email: s.email,
    }));
    const made = await issueAll(services.invite, queue, setProgress);
    setBatch(made);
    setProgress(null);
    onBusy(false);
  }

  function reset() {
    setBatch(null);
    setStudents(null);
    setPicks({});
    setFilled(null);
  }

  /* The one sentence that has to be true in every degraded state, said once. */
  const fallback = (
    <p className="said">
      None of this is required. Inviting one student or several needs nothing from Google, and a student invited that
      way is joined to their results by the roll number you type.
    </p>
  );
  const close = (
    <Foot to={foot}>
      <Button variant="ghost" onClick={onDone}>Close</Button>
    </Foot>
  );

  if (batch && !progress) {
    return <Issued batch={batch} foot={foot} again="Import more" onAgain={reset} onDone={onDone} />;
  }

  return (
    <div className="stack">
      {error && <Note tone="bad" role="alert">{error}</Note>}

      {/* checking */}
      {!status && !error && (
        <div className="stack stack-2" aria-busy="true">
          <div className="skel" style={{ height: 44 }} />
          <div className="skel" style={{ height: 44, width: '60%' }} />
        </div>
      )}
      {!status && close}

      {/* configured on the server, or not */}
      {status && !status.configured && (
        <>
          <Note>{status.reason}</Note>
          {fallback}
          {close}
        </>
      )}

      {status?.configured && !status.connected && (
        <>
          <Note>{status.reason}</Note>
          <div className="cluster">
            <Button variant="primary" icon="google" busy={linking} onClick={connect}>Connect Google Classroom</Button>
            <Button variant="ghost" icon="refresh" busy={checking} onClick={recheck}>I have connected, check again</Button>
          </div>
          {fallback}
          {close}
        </>
      )}

      {/* connected: pick a course */}
      {status?.connected && !students && (
        loading === 'courses' || courses === null ? (
          <>
            {!error && <div className="skel" style={{ height: 40 }} aria-busy="true" />}
            {close}
          </>
        ) : courses.length === 0 ? (
          <>
            <Empty icon="school" title="No courses on this Google account">
              The connected account teaches nothing BloomLoop can read. Connect the account that owns your courses, or
              invite your students another way.
            </Empty>
            {close}
          </>
        ) : (
          <>
            <Field label="Course" htmlFor="dash-course" hint="The roster is read from Google when you ask for it. Nothing is ticked until you tick it.">
              <select id="dash-course" className="select" value={courseId} disabled={loading === 'roster'} onChange={(e) => setCourseId(e.target.value)}>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Foot to={foot}>
              <Button variant="ghost" onClick={onDone}>Cancel</Button>
              <Button variant="primary" icon="users" busy={loading === 'roster'} disabled={!courseId} onClick={loadRoster}>Read the roster</Button>
            </Foot>
          </>
        )
      )}

      {/* the roster, ticked and annotated. Held open while the invites are
          written: the count on the button is what says the run is still going. */}
      {students && (
        students.length === 0 ? (
          <>
            <Empty icon="users" title="Nobody is enrolled in that course" action={<Button onClick={reset}>Pick another course</Button>}>
              Google returned no students for it. A course whose students have not accepted their invitations yet
              looks exactly like this.
            </Empty>
            {close}
          </>
        ) : (
          <>
            <div className="cluster between">
              <span className="t-meta">
                {students.length} on the Google roster
                {students.length !== importable.length && ` · ${students.length - importable.length} already have an account`}
                {` · ${chosen.length} ticked`}
              </span>
              <span className="cluster">
                <Button size="sm" className="dash-tap" disabled={importable.length === 0 || Boolean(progress)} onClick={toggleAll}>
                  {allOn ? 'Untick everyone' : 'Tick everyone'}
                </Button>
                <Button size="sm" className="dash-tap" icon="key" disabled={importable.length === 0 || Boolean(progress)} onClick={fillRolls}>
                  Fill roll numbers from email
                </Button>
              </span>
            </div>

            {filled && (
              <Note>
                Filled {filled.hit} of {filled.of} from the address before the @. Read them before you send: this is a
                guess off an email address, and the roll number is what ties the account to its results.
              </Note>
            )}

            <ul className="dash-box dash-scroll dash-picks">
              {students.map((s) => {
                const pick = picks[s.userId] ?? { on: false, rollNo: '' };
                return (
                  <li key={s.userId} className="dash-pick" data-off={s.linked ? 'true' : undefined}>
                    <label>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={pick.on}
                        disabled={s.linked || Boolean(progress)}
                        onChange={(e) => setPick(s.userId, { on: e.target.checked })}
                      />
                      <Tick on={pick.on} />
                      <span className="dash-who-txt">
                        <span className="strong clip">{s.name || 'Unnamed student'}</span>
                        <span className="t-meta clip">{s.email || 'Google gave no address for them'}</span>
                      </span>
                    </label>
                    {s.linked ? (
                      <Chip tone="line">Already has an account</Chip>
                    ) : (
                      <input
                        className="input input-sm input-code"
                        aria-label={`Roll number for ${s.name || 'this student'}`}
                        placeholder="Roll number"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={Boolean(progress)}
                        value={pick.rollNo}
                        onChange={(e) => setPick(s.userId, { rollNo: e.target.value.toUpperCase() })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="hint">
              A student ticked here gets an invite carrying their Google id, so marks you post to Classroom land on that
              exact Google account instead of being matched to a name. The roll number is still what joins them to the
              rooms they sit, and it is still yours to set.
            </p>

            <Foot to={foot}>
              <Button variant="ghost" disabled={Boolean(progress)} onClick={reset}>Pick another course</Button>
              <Button variant="primary" icon="key" busy={Boolean(progress)} disabled={chosen.length === 0} onClick={createInvites}>
                {progress
                  ? `Issuing ${progress.done + 1} of ${progress.total}`
                  : chosen.length === 0 ? 'Tick who to invite' : `Create ${plural(chosen.length, 'invite')}`}
              </Button>
            </Foot>
          </>
        )
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- dialog */

export default function InviteStudents({ open, onOpenChange, services }) {
  const [way, setWay] = useState('one');
  const [busy, setBusy] = useState(false);
  const [foot, setFoot] = useState(null);

  const done = () => onOpenChange(false);
  const Way = way === 'many' ? Several : way === 'google' ? Classroom : One;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={busy}
      title="Invite students"
      description="Each invite is a single-use code. The student enters it when they sign up, and the account it creates reports to you."
      footer={<div ref={setFoot} className="dash-acts" />}
    >
      <div className="stack">
        <div className="dash-segbox">
          <Segmented
            label="How to invite"
            value={way}
            onChange={setWay}
            options={WAYS.map((w) => ({ ...w, disabled: busy && w.id !== way }))}
          />
        </div>
        {/* Keyed by the way in, so leaving one and coming back starts it clean. */}
        <Way key={way} services={services} foot={foot} onBusy={setBusy} onDone={done} />
      </div>
    </Dialog>
  );
}
