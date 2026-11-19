/**
 * Classes and their rosters (Phase 3).
 *
 *   /classes       every class this viewer may read, newest first, and a new one
 *   /classes/:id   one class: its roster, the students removed from it, one
 *                  student's observations across days, and the class across its
 *                  last 4 or 8 rooms (?view=rooms)
 *
 * A roster holds a roll number and a name per student and nothing else. This
 * screen never asks for a phone number, an email, a date of birth or a photo,
 * and where someone has pasted one it is hidden, not shown back. Roll numbers
 * are sent as typed: the server stores them trimmed and upper case, and "03"
 * and "3" are two students, so nothing here tidies them first.
 *
 * Nothing here decides who may change a class. The class arrives with its own
 * `canEdit`, from the same ownership rule the routes enforce, so a head of
 * department gets every roster and figure and no controls. Every action
 * re-reads the class afterwards, and every refusal is the server's sentence.
 *
 * Reads and writes live in the two containers at the foot of the file. The
 * views above them draw only what they are handed, which is what lets
 * dev/classes.gallery.jsx draw every state from sample data.
 */

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import {
  Button, Chip, Dialog, Empty, Field, Icon, Level, Menu, Note, Panel, Segmented, Spark, Tip,
} from '../ui/index.jsx';
import Attainment from './Attainment.jsx';
import { dateOf, dayOf, plural, roomLink, stampOf, timeOf } from './dashParts.jsx';
import { BankLink, LevelChange } from './LevelChange.jsx';
import Outcomes from './Outcomes.jsx';
import Register from './Register.jsx';
import { ClassMisconceptions } from '../teach/Misconceptions.jsx';
import { ImportedTag, useImportedRooms } from '../teach/imported.jsx';
import RosterImport from './RosterImport.jsx';

/* Phase 4 views beside the roster: the class's course outcomes, its
   attainment report (with the formula behind it) and the marks register.
   Staff only, like the rest of this page. */
const VIEWS = ['roster', 'rooms', 'outcomes', 'attainment', 'register', 'misconceptions'];

/* ----------------------------------------------------------------- helpers */

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v) => (num(v) === null ? '—' : `${Math.round(v * 100)}%`);

/** A change in a share, in percentage points: "+28 points", "−3 points". */
function points(change) {
  if (num(change) === null) return '';
  const p = Math.round(change * 100);
  if (p === 0) return 'no change';
  return `${p > 0 ? '+' : '−'}${Math.abs(p)} ${Math.abs(p) === 1 ? 'point' : 'points'}`;
}

const MODE = { devices: 'Student devices', 'teacher-led': 'Teacher-led', mixed: 'Mixed' };
const STATUS = { waiting: 'Waiting', open: 'Live', paused: 'Paused', closed: 'Closed' };
const BANK_STATUS = { draft: 'Draft', discarded: 'Discarded', rejected: 'Rejected', deleted: 'No longer in the bank' };

/** "2026-11-19" is a calendar day, not a moment: read it as local midnight so no timezone moves it. */
function dayLabel(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  return m ? dateOf(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString()) : String(day ?? '');
}

/**
 * Contact details never go on screen, even when someone pasted them into a
 * name: an email address, a short date (a date of birth), or a run of six or
 * more digits (a phone number). Used on names only: a roll number may be all
 * digits.
 */
export function masked(text) {
  return String(text ?? '')
    .replace(/[^\s@,;]+@[^\s@,;]+/g, '[email hidden]')
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '[date hidden]')
    .replace(/\+?\d[\d\s().-]*\d/g, (m) => ((m.match(/\d/g) ?? []).length >= 6 ? '[number hidden]' : m));
}

/* The headings the server reads as the owner's under-18 mark (decision 8),
   compared as it compares them: any case, with . _ and - read as spaces. */
const UNDER_18_HEADS = new Set(['under 18', 'under18', 'minor', 'below 18']);
const headKey = (cell) => String(cell).toLowerCase().replace(/[._-]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Pasted lines as roster rows: the roll number, then the name. A line with a
 * tab is split on tabs (columns copied from a spreadsheet), any other on
 * commas. Blank lines are skipped. Cells are trimmed and otherwise sent as
 * typed. Columns after the name are never sent, and never shown: they are
 * only counted, so the preview can say they were left out.
 *
 * One exception, the owner's under-18 mark (decision 8): when the first line
 * is a heading that names an Under 18 column (or under18, minor, below 18),
 * that column's cell is sent with each row, as typed. The server reads it as
 * yes or no and refuses a row that says anything else, with a reason.
 *
 * @returns { rows: [{ line, roll, name, under18? }], heading, extra, under18Column }
 *   heading        the first line reads like a heading ("Roll number, Name")
 *   extra          how many lines had something after the name, the mark aside
 *   under18Column  the heading of the column read as the mark, or null
 */
export function readPaste(text) {
  const lines = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    lines.push({ line: i + 1, cells: (raw.includes('\t') ? raw.split('\t') : raw.split(',')).map((c) => c.trim()) });
  });
  const first = lines[0];
  const heading = Boolean(first) && /^roll/i.test(first.cells[0] ?? '') && /^(student'?s?\s+)?name/i.test(first.cells[1] ?? '');
  const markAt = heading ? first.cells.findIndex((c, k) => k >= 2 && UNDER_18_HEADS.has(headKey(c))) : -1;
  let extra = 0;
  const rows = lines.map(({ line, cells }) => {
    if (cells.some((c, k) => k >= 2 && k !== markAt && c)) extra += 1;
    return { line, roll: cells[0] ?? '', name: cells[1] ?? '', ...(markAt >= 0 ? { under18: cells[markAt] ?? '' } : {}) };
  });
  return { rows, heading, extra, under18Column: markAt >= 0 ? first.cells[markAt] : null };
}

/**
 * How a pasted mark will read, for the preview only: the server decides. The
 * cell itself is never shown back (a date of birth typed there stays unshown).
 */
function markOf(cell) {
  const w = String(cell ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(w)) return 'yes';
  if (['', 'no', 'n', 'false', '0'].includes(w)) return 'no';
  return 'unclear';
}

/** The under-18 mark beside a name. Staff only, like the roster it sits on. */
function Under18() {
  return <Chip tone="line" icon="shield" className="cl-u18">Under 18</Chip>;
}

/* --------------------------------------------------------------- skeletons */

function ListSkeleton() {
  return (
    <div className="card cl-skel" aria-busy="true">
      <div className="skel" style={{ height: 12, width: 120 }} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="cl-skel-row">
          <div className="skel" style={{ width: 52, height: 44, borderRadius: 10 }} />
          <div className="stack stack-2 grow">
            <div className="skel" style={{ height: 14, width: '38%' }} />
            <div className="skel" style={{ height: 11, width: '24%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RosterSkeleton() {
  return (
    <div className="card cl-skel" aria-busy="true">
      <div className="skel" style={{ height: 30, width: 260, maxWidth: '100%' }} />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="cl-skel-row">
          <div className="skel" style={{ height: 13, width: 64 }} />
          <div className="skel" style={{ height: 13, flex: 1, maxWidth: 240 }} />
          <div className="skel" style={{ height: 26, width: 110, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="stack stack-5" aria-busy="true">
      <div className="skel" style={{ height: 210, borderRadius: 16 }} />
      <div className="card cl-skel">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="cl-skel-row">
            <div className="skel" style={{ height: 13, width: 70 }} />
            <div className="skel" style={{ height: 13, flex: 1, maxWidth: 300 }} />
            <div className="skel" style={{ height: 6, width: 90 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- course, section, term */

const BLANK = { courseName: '', section: '', termLabel: '' };

/**
 * Create a class, or change one's course, section and term. A change sends
 * only the fields that differ, so an untouched field is never rewritten.
 * `onSubmit(body)` resolves when the server took it and throws its sentence
 * when it did not.
 */
function ClassDialog({ open, onOpenChange, mode, initial, onSubmit }) {
  const uid = useId();
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Read when the dialog opens, not on every render: the caller builds
  // `initial` afresh each time, and a reset while typing would lose the typing.
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!open) return;
    setDraft({ ...BLANK, ...(initialRef.current ?? {}) });
    setError('');
    setBusy(false);
  }, [open]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const creating = mode === 'create';

  async function submit(e) {
    e.preventDefault();
    let body;
    if (creating) {
      body = { courseName: draft.courseName, section: draft.section };
      if (draft.termLabel.trim()) body.termLabel = draft.termLabel;
    } else {
      body = {};
      for (const k of Object.keys(BLANK)) if (draft[k] !== (initial?.[k] ?? '')) body[k] = draft[k];
      if (!Object.keys(body).length) { onOpenChange(false); return; }
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(body);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || 'The server refused that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={busy}
      title={creating ? 'New class' : 'Course, section and term'}
      description={creating
        ? 'A class is its roster. Add the students next: a roll number and a name each.'
        : 'Rooms already opened for this class keep it. Only the words change.'}
      footer={(
        <div className="ac-acts">
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form={`${uid}-form`} variant="primary" busy={busy}>
            {creating ? 'Create the class' : 'Save'}
          </Button>
        </div>
      )}
    >
      <form id={`${uid}-form`} className="stack" onSubmit={submit}>
        {error && <Note tone="bad" role="alert">{error}</Note>}
        <Field label="Course" htmlFor={`${uid}-course`}>
          <input id={`${uid}-course`} className="input" required maxLength={120} autoFocus value={draft.courseName} onChange={set('courseName')} placeholder="Computer Networks" />
        </Field>
        <div className="cl-pair">
          <Field label="Section" htmlFor={`${uid}-section`}>
            <input id={`${uid}-section`} className="input" required maxLength={40} value={draft.section} onChange={set('section')} placeholder="CS-A" />
          </Field>
          <Field label="Term" optional htmlFor={`${uid}-term`}>
            <input id={`${uid}-term`} className="input" maxLength={40} value={draft.termLabel} onChange={set('termLabel')} placeholder="Odd term 2026" />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}

/* ================================================================ the list */

const FIRST_STEPS = [
  ['Create the class', 'Its course, section and term.'],
  ['Paste the roster', 'A roll number and a name for each student. Nothing else is kept.'],
  ['Open a room for it', 'Attendance, the wheel and observations then work from the roster, and the class page follows it across rooms.'],
];

/**
 * @param classes   GET /api/classes rows, newest first; null before the first read
 * @param canCreate whether this viewer may create one (a head of department may not)
 * @param onCreate  (body) => Promise; throws the server's sentence
 */
export function ClassListView({ loading, error, locked, student, classes, reading, onReload, canCreate, onCreate }) {
  const [creating, setCreating] = useState(false);
  const rows = classes ?? [];
  const head = { current: 'classes', crumb: <span>Classes</span>, title: 'Classes' };
  const sub = 'A class is its roster: a roll number and a name for each student. Attendance, the wheel and observations work from it.';

  if (loading) return <AccountShell {...head}><ListSkeleton /></AccountShell>;

  if (student) {
    return (
      <AccountShell {...head}>
        <div className="card">
          <Empty icon="shield" title="Classes are the teacher's side" action={<Link className="btn btn-primary" to="/me">Go to your results</Link>}>
            Your professor keeps the class list. You join a room with its code and your roll number.
          </Empty>
        </div>
      </AccountShell>
    );
  }

  if (error && rows.length === 0) {
    return (
      <AccountShell {...head}>
        <div className="card">
          <Empty
            icon={locked ? 'lock' : 'alert'}
            title={locked ? 'Classes need the teacher key or an account' : 'The classes did not load'}
            action={locked
              ? <Link className="btn btn-primary" to="/">Unlock the console</Link>
              : <Button variant="primary" icon="refresh" busy={reading} onClick={onReload}>Try again</Button>}
          >
            {error}
          </Empty>
        </div>
      </AccountShell>
    );
  }

  const actions = (
    <span className="ac-headacts">
      <Tip label="Read the classes again">
        <Button variant="ghost" icon="refresh" busy={reading} aria-label="Read the classes again" onClick={onReload} />
      </Tip>
      {canCreate && rows.length > 0 && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New class</Button>}
    </span>
  );
  const dialog = <ClassDialog open={creating} onOpenChange={setCreating} mode="create" onSubmit={onCreate} />;

  if (rows.length === 0) {
    return (
      <AccountShell {...head} sub={sub} actions={actions}>
        <Panel className="cl-first">
          <div className="cl-first-say">
            <span className="tag-mint">Classes</span>
            <p className="cl-lead">No classes yet.</p>
            <p className="cl-first-sub">
              A class is a list of roll numbers and names. Once it exists, a room can be opened for it, and attendance,
              the wheel and observations work from that list instead of from whoever happens to join.
            </p>
            {canCreate
              ? <span className="cluster"><Button variant="accent" icon="plus" onClick={() => setCreating(true)}>Create a class</Button></span>
              : <p className="cl-first-ro">Professors create classes. Once one in your department does, it is listed here for you to read.</p>}
          </div>
          <ol className="cl-first-steps">
            {FIRST_STEPS.map(([t, s], i) => (
              <li key={t}>
                <span className="cl-first-n">{i + 1}</span>
                <span className="grow"><b>{t}</b><span>{s}</span></span>
              </li>
            ))}
          </ol>
        </Panel>
        {dialog}
      </AccountShell>
    );
  }

  const readOnly = rows.some((c) => !c.canEdit);

  return (
    <AccountShell {...head} sub={sub} actions={actions}>
      {(error || readOnly) && (
        <div className="stack stack-3">
          {error && <Note tone="bad">The classes below are the last ones that loaded: {error}</Note>}
          {readOnly && <Note>Classes marked read only belong to another account. You can read every roster and figure; changes belong to whoever keeps the class.</Note>}
        </div>
      )}
      <section className="card ac-card" aria-labelledby="cl-list-h">
        <div className="cl-list-top">
          <h2 id="cl-list-h" className="sr-only">Classes</h2>
          <span className="t-meta">{plural(rows.length, 'class', 'classes')}, newest first</span>
        </div>
        <ul className="cl-classes">
          {rows.map((c) => (
            <li key={c.id}>
              <Link className="cl-class" to={`/classes/${encodeURIComponent(c.id)}`}>
                <span className="cl-class-size">
                  <b>{c.size ?? 0}</b>
                  <small>{c.size === 1 ? 'student' : 'students'}</small>
                </span>
                <span className="cl-class-main">
                  <span className="cl-class-t">{c.courseName}</span>
                  <span className="cl-class-sub">
                    <span className="cl-sec">{c.section}</span>
                    {c.termLabel && <span>{c.termLabel}</span>}
                    <span className="cl-quiet">Created {dateOf(c.createdAt) || 'at an unrecorded time'}</span>
                  </span>
                </span>
                {!c.canEdit && <span className="ac-set is-ro">Read only</span>}
                <Icon name="chevronRight" className="cl-class-go" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {dialog}
    </AccountShell>
  );
}

/* ============================================================ adding students */

function PasteResult({ reply, rows }) {
  const added = list(reply?.added);
  const refused = list(reply?.refused);
  const ignored = list(reply?.ignoredFields);
  const [showAdded, setShowAdded] = useState(false);
  return (
    <div className="stack" aria-live="polite">
      <div className="cl-result-figs">
        <div><b>{added.length}</b><span>added</span></div>
        <div data-tone={refused.length ? 'bad' : undefined}><b>{refused.length}</b><span>refused</span></div>
        <div><b>{reply?.size ?? '—'}</b><span>on the roster now</span></div>
      </div>

      {reply?.note && <Note icon="shield">{reply.note}</Note>}
      {reply?.under18Note && (
        <Note icon="shield">
          <b>{plural(added.filter((s) => s.under18).length, 'student')} added marked under 18.</b> {reply.under18Note}
        </Note>
      )}
      {ignored.length > 0 && (
        <div className="cl-ignored">
          <span className="t-meta">Fields dropped, not stored:</span>
          {ignored.map((f) => <span key={f} className="ac-set">{f}</span>)}
        </div>
      )}

      {refused.length > 0 && (
        <div className="stack stack-2">
          <h3 className="cl-sub-h">Refused, with the server's reason</h3>
          <ul className="cl-refused">
            {refused.map((r) => (
              <li key={r.index}>
                <span className="cl-refused-line">Line {rows?.[r.index]?.line ?? r.index + 1}</span>
                <span className="cl-refused-who">
                  <span className="mono">{r.roll || <i className="cl-missing">no roll number</i>}</span>
                  <span>{r.name ? masked(r.name) : <i className="cl-missing">no name</i>}</span>
                </span>
                <span className="cl-refused-why">{r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {added.length > 0 && (
        <div className="stack stack-2">
          <button type="button" className="cl-fold" aria-expanded={showAdded} onClick={() => setShowAdded((v) => !v)}>
            <Icon name="chevron" />
            {showAdded ? 'Hide' : 'Show'} the {plural(added.length, 'student')} added
          </button>
          {showAdded && (
            <ul className="cl-preview-list">
              {added.map((s) => (
                <li key={s.id}><span className="mono">{s.rollNo}</span><span className="cl-preview-who">{s.name}{s.under18 && <Under18 />}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Paste, check what will be sent, send, and read what the server did with
 * every line. `onSend(students)` resolves with the reply and throws the
 * server's sentence. `start` opens it on a given text or reply (the gallery).
 */
function PasteDialog({ open, onOpenChange, onSend, start }) {
  const uid = useId();
  const [text, setText] = useState('');
  const [skipFirst, setSkipFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState(null);
  const [sentRows, setSentRows] = useState(null);
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    if (!open) return;
    const from = startRef.current;
    setText(from?.text ?? '');
    setSkipFirst(true);
    setError('');
    setBusy(false);
    setReply(from?.reply ?? null);
    setSentRows(from?.reply ? readPaste(from?.text ?? '').rows : null);
  }, [open]);

  const read = useMemo(() => readPaste(text), [text]);
  const rows = read.heading && skipFirst ? read.rows.slice(1) : read.rows;

  async function send() {
    if (!rows.length) return;
    setBusy(true);
    setError('');
    try {
      const res = await onSend(rows.map((r) => ({ roll: r.roll, name: r.name, ...(r.under18 !== undefined ? { under18: r.under18 } : {}) })));
      setSentRows(rows);
      setReply(res);
    } catch (err) {
      setError(err.message || 'The server refused that.');
    } finally {
      setBusy(false);
    }
  }

  const again = () => { setReply(null); setSentRows(null); setText(''); setError(''); };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={busy}
      wide
      title={reply ? 'What the server did' : 'Add students'}
      description={reply
        ? 'Every line was added or refused. Nothing was half-added.'
        : 'One student per line: the roll number, then the name, with a comma or a tab between them.'}
      footer={reply ? (
        <div className="ac-acts">
          <Button onClick={again} icon="plus">Add more</Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      ) : (
        <div className="ac-acts">
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" icon="send" busy={busy} disabled={!rows.length} onClick={send}>
            {rows.length ? `Send ${plural(rows.length, 'line')}` : 'Send'}
          </Button>
        </div>
      )}
    >
      {reply ? <PasteResult reply={reply} rows={sentRows} /> : (
        <div className="cl-paste">
          <div className="stack stack-3">
            <Field
              label="Roll number, name"
              htmlFor={`${uid}-paste`}
              hint="Copy two columns from a spreadsheet, or type them. Only a roll number and a name are kept: no phone number, email or date of birth. To mark students under 18, start with a heading line that has an Under 18 column, yes or no."
            >
              <textarea
                id={`${uid}-paste`}
                className="textarea cl-paste-box"
                spellCheck={false}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'21CS01, Asha Rao\n21CS02, Bilal Khan'}
              />
            </Field>
            {read.heading && (
              <label className="check">
                <input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} />
                The first line is a heading: leave it out
              </label>
            )}
            {error && <Note tone="bad" role="alert">{error}</Note>}
          </div>

          <div className="cl-preview" aria-live="polite">
            <div className="cl-preview-head">
              <span className="ac-label">What will be sent</span>
              <span className="t-meta">{plural(rows.length, 'line')}</span>
            </div>
            {rows.length === 0 ? (
              <p className="cl-preview-empty">The lines you paste appear here as roll number and name, exactly as they will be sent.</p>
            ) : (
              <ul className="cl-preview-list">
                {rows.map((r) => {
                  const mark = r.under18 === undefined ? null : markOf(r.under18);
                  return (
                    <li key={r.line}>
                      <span className="cl-preview-n">{r.line}</span>
                      <span className="mono">{r.roll || <i className="cl-missing">no roll number</i>}</span>
                      <span className="cl-preview-who">
                        {r.name ? masked(r.name) : <i className="cl-missing">no name</i>}
                        {mark === 'yes' && <Under18 />}
                        {mark === 'unclear' && <i className="cl-missing">under 18 is not yes or no</i>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {read.under18Column && (
              <p className="cl-preview-note">
                The “{read.under18Column}” column is read as the under-18 mark, yes or no, and sent with each line.
              </p>
            )}
            {read.extra > 0 && (
              <p className="cl-preview-note">
                {plural(read.extra, 'line')} had more after the name. Only the roll number{read.under18Column ? ', the name and the under-18 mark are' : ' and the name are'} sent.
              </p>
            )}
            <p className="cl-preview-note">The server stores roll numbers upper case. 03 and 3 are two different students.</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ============================================================ observations */

function ObservationDay({ d }) {
  const cur = d.current;
  const hist = list(d.history);
  // What stands is the current mark, or for a cleared day the clear itself.
  const standing = cur ? cur.id : hist[hist.length - 1]?.id;
  const earlier = hist.filter((h) => h.id !== standing).reverse();
  return (
    <li className="cl-obs-day">
      <span className="cl-obs-date">{dayLabel(d.day)}</span>
      <div className="cl-obs-body">
        {cur ? (
          <>
            <span className="cluster">
              <Chip className="cl-obs-kind" data-kind={cur.kind}>{cur.label}</Chip>
              <span className="t-meta">
                {timeOf(cur.observedAt)}{cur.room ? ` · room ${cur.room}` : ''}
              </span>
            </span>
            {cur.note && <p className="cl-obs-note">{cur.note}</p>}
          </>
        ) : (
          <span className="t-meta">Cleared: no mark stands for this day.</span>
        )}
        {earlier.length > 0 && (
          <ul className="cl-obs-earlier" aria-label="Earlier that day">
            {earlier.map((h) => (
              <li key={h.id}>
                <span>{h.kind ? h.label : 'Cleared'}</span>
                {h.note && <span className="cl-obs-earlier-note">“{h.note}”</span>}
                <span className="t-meta">replaced, set at {timeOf(h.observedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * One student's observations across days, newest first. Staff only: the
 * privacy sentence comes with the data and is shown with it.
 *
 * @param obs  { student, data, loading, error } or null
 */
export function ObservationsSheet({ obs, onClose, onRetry }) {
  const s = obs?.student;
  const data = obs?.data;
  const kinds = list(data?.kinds);
  const days = list(data?.days);
  return (
    <Dialog
      sheet
      open={Boolean(s)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={s ? s.name : 'Observations'}
      description={s ? `${s.rollNo} · observations across days, newest first` : undefined}
    >
      {s && (
        <div className="stack">
          {s.active === false && <Note>Removed from the roster. What was recorded about them stays readable here.</Note>}
          {obs.loading && !data && (
            <div className="stack stack-3" aria-busy="true">
              <div className="skel" style={{ height: 52 }} />
              <div className="skel" style={{ height: 70 }} />
              <div className="skel" style={{ height: 70 }} />
            </div>
          )}
          {obs.error && (
            <Note tone="bad" role="alert">
              {obs.error}{' '}
              <button type="button" className="link ac-linkbtn" onClick={onRetry}>Try again</button>
            </Note>
          )}
          {data && (
            <>
              {data.privacy && <p className="said cl-privacy">{data.privacy}</p>}
              <div className="cl-obs-counts" role="list" aria-label="Days with each mark">
                {kinds.map((k) => (
                  <div key={k.id} role="listitem" data-zero={!data.counts?.[k.id] || undefined}>
                    <b>{data.counts?.[k.id] ?? 0}</b>
                    <span>{k.label}</span>
                  </div>
                ))}
              </div>
              <p className="t-meta">
                {data.counts?.days
                  ? `Marked on ${plural(data.counts.days, 'day')}. One mark a day stands; anything it replaced is kept beneath it.`
                  : 'One mark a day stands; anything it replaced is kept beneath it.'}
              </p>
              {days.length === 0 ? (
                <div className="cl-obs-empty">
                  <Icon name="note" size={18} />
                  <div className="stack stack-1">
                    <b>No observations yet</b>
                    <span className="t-small muted">Marks are made during a room opened for this class, under In the room.</span>
                  </div>
                </div>
              ) : (
                <ol className="cl-obs-days">
                  {days.map((d) => <ObservationDay key={d.day} d={d} />)}
                </ol>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

/* ================================================================ the roster */

function StudentRow({ s, canEdit, busy, editing, onEdit, onCancel, onSave, onRemove, onMark, onObs }) {
  const [draft, setDraft] = useState({ rollNo: s.rollNo, name: s.name });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const working = busy?.id === s.id;

  useEffect(() => {
    if (editing) { setDraft({ rollNo: s.rollNo, name: s.name }); setError(''); }
  }, [editing, s.rollNo, s.name]);

  async function save(e) {
    e.preventDefault();
    const patch = {};
    if (draft.rollNo !== s.rollNo) patch.rollNo = draft.rollNo;
    if (draft.name !== s.name) patch.name = draft.name;
    if (!Object.keys(patch).length) { onCancel(); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(s, patch);
      onCancel();
    } catch (err) {
      setError(err.message || 'The server refused that.');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <li className="cl-st is-editing">
        <form className="cl-st-form" onSubmit={save} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
          <input
            className="input input-sm input-code"
            aria-label={`Roll number for ${s.name}`}
            value={draft.rollNo}
            autoFocus
            maxLength={24}
            spellCheck={false}
            onChange={(e) => setDraft((d) => ({ ...d, rollNo: e.target.value }))}
          />
          <input
            className="input input-sm"
            aria-label={`Name for ${s.rollNo}`}
            value={draft.name}
            maxLength={80}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <span className="cl-st-formacts">
            <Button type="submit" size="sm" variant="primary" busy={saving}>Save</Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
          </span>
        </form>
        {error && <p className="cl-st-err" role="alert">{error}</p>}
      </li>
    );
  }

  return (
    <li className="cl-st" aria-busy={working || undefined}>
      <span className="cl-st-roll">{s.rollNo}</span>
      <span className="cl-st-who">
        <span className="cl-st-name clip" title={s.name}>{s.name}</span>
        {s.under18 && <Under18 />}
      </span>
      <span className="cl-st-when">Added {dayOf(s.addedAt) || '—'}</span>
      <span className="cl-st-acts">
        <Tip label="Observations across days">
          <Button size="sm" variant="ghost" icon="note" className="cl-obs-btn" onClick={() => onObs(s)} aria-label={`Observations for ${s.rollNo} ${s.name}`} />
        </Tip>
        {canEdit && (
          <Menu
            items={[
              { id: 'edit', label: 'Edit the name or roll number', icon: 'edit', onSelect: () => setTimeout(() => onEdit(s), 0) },
              onMark && {
                id: 'under18',
                label: s.under18 ? 'Remove the under-18 mark' : 'Mark as under 18',
                icon: 'shield',
                onSelect: () => onMark(s, !s.under18),
              },
              onMark && { heading: 'Under 18: no integrity signals are recorded or shown for them.' },
              'sep',
              { id: 'remove', label: 'Remove from the roster', icon: 'minus', onSelect: () => onRemove(s) },
              { heading: 'Nothing they did is deleted, and they can be put back.' },
            ]}
            trigger={<Button size="sm" variant="ghost" icon="more" busy={working} disabled={working} aria-label={`Change ${s.rollNo} ${s.name}`} />}
          />
        )}
      </span>
    </li>
  );
}

/**
 * The owner's under-18 mark, said once above the roster (decision 8): how many
 * are marked and what the mark does. The server's own note (a working default
 * a lawyer must confirm) comes with every reply that sets the mark, and is
 * shown in place of this screen's sentence whenever one has arrived.
 */
function Under18Say({ count, note, canEdit }) {
  return (
    <div className="cl-u18-say" role="note">
      <span className="cl-u18-ic" aria-hidden="true"><Icon name="shield" size={15} /></span>
      <div className="cl-u18-text">
        <p>
          <b>{count ? `${plural(count, 'student')} marked under 18.` : 'Nobody is marked under 18.'}</b>
          {!note && ' Integrity signals are not recorded or shown for a student marked under 18, in any room opened for this class.'}
          {' '}Only staff see the mark.
          {canEdit && ' Mark or unmark a student from their row’s menu.'}
        </p>
        {note && <p className="cl-u18-note">{note}</p>}
      </div>
    </div>
  );
}

function Roster({ data, canEdit, busy, onSave, onRemove, onRestore, onMark, under18Note, onObs, onPaste, onImport }) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const students = list(data?.students);
  const removed = list(data?.removed);
  const minors = [...students, ...removed].filter((s) => s.under18).length;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? students.filter((s) => `${s.rollNo} ${s.name}`.toLowerCase().includes(needle))
    : students;

  return (
    <>
      <section className="card ac-card cl-roster" aria-labelledby="cl-roster-h">
        <div className="ac-head">
          <div className="sec">
            <h2 id="cl-roster-h">Roster</h2>
            <p>A roll number and a name for each student, in roll-number order. A phone joining with a roll number on this list marks that student present.</p>
          </div>
          <div className="cl-head-acts">
            {students.length > 8 && (
              <label className="search cl-search">
                <Icon name="search" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by roll number or name" aria-label="Find a student by roll number or name" />
              </label>
            )}
            {/* With nobody on the roster, the empty state below carries it. */}
            {canEdit && students.length > 0 && onImport && <Button icon="upload" onClick={onImport}>Import a CSV</Button>}
            {canEdit && students.length > 0 && <Button variant="primary" icon="plus" onClick={onPaste}>Add students</Button>}
          </div>
        </div>

        {students.length === 0 ? (
          <div className="cl-roster-empty">
            <span className="cl-roster-empty-ic" aria-hidden="true"><Icon name="users" size={18} /></span>
            <div className="stack stack-1">
              <b>Nobody on the roster yet</b>
              <span className="t-small muted">
                {canEdit
                  ? 'Paste a roll number and a name per line. Until then, a room opened for this class has no one to mark present.'
                  : 'The professor who keeps this class has not added anyone yet.'}
              </span>
            </div>
            {canEdit && (
              <span className="cluster">
                {onImport && <Button icon="upload" onClick={onImport}>Import a CSV</Button>}
                <Button variant="primary" icon="plus" onClick={onPaste}>Add students</Button>
              </span>
            )}
          </div>
        ) : (
          <>
            {(minors > 0 || under18Note) && <Under18Say count={minors} note={under18Note} canEdit={canEdit} />}
            <div className="cl-roll-top" aria-hidden="true">
              <span>Roll number</span><span>Name</span>
            </div>
            {shown.length === 0 ? (
              <p className="cl-none">No student on the roster matches “{q.trim()}”.</p>
            ) : (
              <ul className="cl-roll" aria-label="Students on the roster">
                {shown.map((s) => (
                  <StudentRow
                    key={s.id}
                    s={s}
                    canEdit={canEdit}
                    busy={busy}
                    editing={editing === s.id}
                    onEdit={(st) => setEditing(st.id)}
                    onCancel={() => setEditing(null)}
                    onSave={onSave}
                    onRemove={onRemove}
                    onMark={onMark}
                    onObs={onObs}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {removed.length > 0 && (
        <section className="card ac-card cl-removed" aria-labelledby="cl-removed-h">
          <div className="ac-head">
            <div className="sec">
              <h2 id="cl-removed-h">Removed from the roster</h2>
              <p>Not enrolled: left out of the class size, and joining a room no longer marks them present. Their answers, attendance and records are kept.</p>
            </div>
            <span className="t-meta nowrap">{plural(removed.length, 'student')}</span>
          </div>
          <ul className="cl-roll is-removed" aria-label="Students removed from the roster">
            {removed.map((s) => (
              <li key={s.id} className="cl-st" aria-busy={busy?.id === s.id || undefined}>
                <span className="cl-st-roll">{s.rollNo}</span>
                <span className="cl-st-who">
                  <span className="cl-st-name clip" title={s.name}>{s.name}</span>
                  {s.under18 && <Under18 />}
                </span>
                <span className="cl-st-when">Removed {dayOf(s.removedAt) || '—'}</span>
                <span className="cl-st-acts">
                  <Tip label="Observations across days">
                    <Button size="sm" variant="ghost" icon="note" className="cl-obs-btn" onClick={() => onObs(s)} aria-label={`Observations for ${s.rollNo} ${s.name}`} />
                  </Tip>
                  {canEdit && (
                    <Button size="sm" icon="undo" busy={busy?.id === s.id} disabled={busy?.id === s.id} onClick={() => onRestore(s)} aria-label={`Put ${s.rollNo} ${s.name} back on the roster`}>
                      Put back
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/* ============================================================== across rooms */

/** The sentence the brief opens with, from the trend the server worked out. */
function leadOf(a) {
  const t = a?.trend?.accuracy;
  const rooms = list(a?.rooms);
  if (!rooms.length) return null;
  if (!t || !num(t.rooms)) return <>No graded answers in these rooms yet.</>;
  if (t.rooms === 1 || num(t.change) === null) return <>One room with answers so far: class accuracy <em>{pct(t.last)}</em>. A trend needs two.</>;
  const p = Math.round(t.change * 100);
  const verb = p > 0 ? 'rose' : p < 0 ? 'fell' : 'held';
  return p === 0
    ? <>Class accuracy held at <em>{pct(t.last)}</em> across {t.rooms} rooms with answers.</>
    : <>Class accuracy {verb} from <em>{pct(t.first)}</em> to <em>{pct(t.last)}</em> across {t.rooms} rooms with answers.</>;
}

const lastWith = (rooms, pick) => [...rooms].reverse().find((r) => num(pick(r)?.value) !== null) ?? null;

function Brief({ a, last, onLast, busy }) {
  const rooms = list(a?.rooms);
  const t = a?.trend ?? {};
  const accRoom = lastWith(rooms, (r) => r.accuracy);
  const partRoom = lastWith(rooms, (r) => r.participation);
  const newest = rooms[rooms.length - 1];
  const accSeries = rooms.map((r) => r.accuracy?.value).filter((v) => num(v) !== null);
  const partSeries = rooms.map((r) => r.participation?.value).filter((v) => num(v) !== null);
  const presentSeries = rooms.map((r) => (r.attendance ? (r.attendance.present ?? 0) + (r.attendance.late ?? 0) : null)).filter((v) => v !== null);
  const switcher = (
    <Segmented
      label="How many rooms"
      value={String(last)}
      onChange={(v) => onLast(Number(v))}
      options={[{ id: '4', label: 'Last 4 rooms' }, { id: '8', label: 'Last 8 rooms' }]}
    />
  );

  if (!rooms.length) {
    return (
      <Panel className="cl-brief is-empty">
        <div className="cl-brief-say">
          <div className="cl-brief-top"><span className="tag-mint">Across rooms</span>{switcher}</div>
          <p className="cl-lead">No room has been opened for this class yet.</p>
          <p className="cl-brief-sub">
            Open a room for it in the console. Attendance marks itself as phones join with roll numbers on the roster, and
            this page then follows the class from room to room.
          </p>
          <span className="cluster"><Link className="btn btn-accent" to="/"><Icon name="play" />Open a room</Link></span>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="cl-brief" aria-busy={busy || undefined}>
      <div className="cl-brief-say">
        <div className="cl-brief-top"><span className="tag-mint">Across rooms</span>{switcher}</div>
        <p className="cl-lead">{leadOf(a)}</p>
        <p className="cl-brief-sub">
          {plural(rooms.length, 'room')} opened for this class, oldest first below. Class accuracy is the mean of each
          student's own accuracy.
        </p>
      </div>
      <div className="cl-tiles">
        <div className="ptile">
          <span>Class accuracy</span>
          <b>{pct(t.accuracy?.last)}</b>
          <Spark values={accSeries} label="Class accuracy room by room" />
          <small>
            {accRoom ? `${plural(accRoom.accuracy.answers, 'answer')}, ${plural(accRoom.accuracy.students, 'student')}` : 'No graded answers yet'}
            {accRoom && <i>{accRoom.code}</i>}
          </small>
          {num(t.accuracy?.change) !== null && <small className="cl-tile-change">{points(t.accuracy.change)} since {list(a.rooms).find((r) => num(r.accuracy?.value) !== null)?.code ?? 'the first'}</small>}
        </div>
        <div className="ptile" style={{ '--d': '0.6s' }}>
          <span>Took part</span>
          <b>{pct(t.participation?.last)}</b>
          <Spark values={partSeries} label="Share of present students who answered, room by room" />
          <small>
            {partRoom
              ? `${partRoom.participation.answered} of ${partRoom.participation.present} present answered`
              : 'Nobody present has answered yet'}
            {partRoom && <i>{partRoom.code}</i>}
          </small>
          {num(t.participation?.change) !== null && <small className="cl-tile-change">{points(t.participation.change)} since {list(a.rooms).find((r) => num(r.participation?.value) !== null)?.code ?? 'the first'}</small>}
        </div>
        <div className="ptile" style={{ '--d': '1.2s' }}>
          <span>Present, newest room</span>
          <b className="cl-tile-sum">{newest?.attendance?.summary ?? '—'}</b>
          <Spark values={presentSeries} label="Students present, room by room" />
          <small>
            {newest?.attendance?.unmarked
              ? <>{newest.attendance.unmarked} not marked<i>{newest.code}</i></>
              : <>Everyone marked<i>{newest?.code}</i></>}
          </small>
        </div>
      </div>
    </Panel>
  );
}

function RoomsTable({ a }) {
  const rooms = list(a?.rooms);
  // Phase 7: the class report does not say which rooms came from a laptop; the room list does.
  const { preview } = useViewer();
  const imported = useImportedRooms(!preview && rooms.length > 0);
  if (!rooms.length) return null;
  return (
    <section className="card ac-card" aria-labelledby="cl-rooms-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="cl-rooms-h">Rooms, oldest first</h2>
          <p>{a?.definitions?.classSize ?? 'Attendance counts against the roster as it is now.'}</p>
        </div>
      </div>
      <div className="cl-rooms-top" aria-hidden="true">
        <span>Room</span><span>Class accuracy</span><span>Took part</span><span>Present</span>
      </div>
      <ol className="cl-rooms">
        {rooms.map((r) => {
          const acc = r.accuracy ?? {};
          const part = r.participation ?? {};
          const att = r.attendance ?? {};
          const teacherLed = r.mode === 'teacher-led';
          return (
            <li key={r.code} className="cl-room">
              <span className="cl-room-who">
                <span className="cl-room-code">{r.code}</span>
                <span className="cl-room-meta">
                  <span title={stampOf(r.startedAt) || undefined}>{dayOf(r.startedAt) || 'No date'}</span>
                  <span>{MODE[r.mode] ?? r.mode}</span>
                  {r.status !== 'closed' && <span className="cl-room-live" data-status={r.status}>{STATUS[r.status] ?? r.status}</span>}
                  <ImportedTag from={r.importedFrom ?? imported.get(r.code)} code={r.code} />
                </span>
              </span>
              <span className="cl-room-fig" data-label="Class accuracy">
                <span className="ac-rate">
                  <span className="ac-rate-bar" aria-hidden="true"><i style={{ width: `${num(acc.value) === null ? 0 : Math.max(2, Math.round(acc.value * 100))}%` }} /></span>
                  <span className="ac-rate-n">{pct(acc.value)}</span>
                </span>
                <small>
                  {/* The server's count sentence (Phase 5) when it sends one. */}
                  {num(acc.value) !== null
                    ? acc.sentence || `${plural(acc.answers, 'answer')}, ${plural(acc.students, 'student')}`
                    : teacherLed ? 'Teacher-led: no phone answers' : acc.sentence || 'No graded answers'}
                </small>
              </span>
              <span className="cl-room-fig" data-label="Took part">
                <b>{num(part.value) === null ? '—' : `${part.answered} of ${part.present}`}</b>
                <small>{num(part.value) === null ? (teacherLed ? 'Teacher-led' : 'Nobody present yet') : `present answered, ${pct(part.value)}`}</small>
              </span>
              <span className="cl-room-fig" data-label="Present">
                <b>{att.summary ?? '—'}</b>
                <small>
                  {[att.late ? `${att.late} late` : '', att.absent ? `${att.absent} absent` : '', att.unmarked ? `${att.unmarked} not marked` : '']
                    .filter(Boolean).join(', ') || 'Everyone marked'}
                </small>
              </span>
              <Link className="btn btn-ghost btn-sm btn-icon cl-room-go" to={roomLink(r.code, 'live')} aria-label={`Open room ${r.code} in the console`}>
                <Icon name="chevronRight" />
              </Link>
            </li>
          );
        })}
      </ol>
      {/* Decision 9 and Phase 3 question (b): a deleted room leaves this list,
          and what it recorded is kept in its archive. */}
      <p className="cl-rooms-foot">
        <Icon name="history" size={14} />
        <span>
          A deleted room leaves this list and these figures. Its answers, attendance and records stay in its archive,
          listed under Deleted rooms on <Link to="/rooms">Rooms</Link>.
        </span>
      </p>
    </section>
  );
}

/* ------------------------------------------------- the two charts (A2) */

/* Where a figure sits in a plot, in percent of its box: rooms spread across,
   0 to 100% up the side, with room above and below for the printed values. */
const xAt = (i, n) => (n === 1 ? 50 : 7 + (i * 86) / (n - 1));
const yAt = (v) => 10 + (1 - v) * 80;

/** One line through the rooms that have a figure, broken where a room has none. */
function linePath(values, n) {
  const runs = [];
  let run = [];
  values.forEach((v, i) => {
    if (v === null) { if (run.length) runs.push(run); run = []; return; }
    run.push(`${xAt(i, n).toFixed(2)},${yAt(v).toFixed(2)}`);
  });
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1).map((r) => `M${r.join(' L')}`).join(' ');
}

/**
 * Class accuracy and participation room by room, oldest first (the audit's
 * A2): two lines with each value printed on its point and each room's date
 * under the axis. Accuracy is solid with round points, took part dashed with
 * square points, so the two are told apart by more than colour. A room with
 * no figure (no graded answer yet, or Teacher-led) leaves a gap, never a nought.
 */
function RoomTrend({ rooms }) {
  const n = rooms.length;
  const acc = rooms.map((r) => num(r.accuracy?.value));
  const part = rooms.map((r) => num(r.participation?.value));
  const said = rooms.map((r, i) => {
    const p = r.participation ?? {};
    return `${r.code}, ${dayOf(r.startedAt) || 'no date'}: class accuracy ${pct(acc[i])}${r.accuracy?.sentence ? ` (${r.accuracy.sentence})` : ''}; `
      + `took part ${part[i] === null ? '—' : `${pct(part[i])}, ${p.answered} of ${p.present} present answered`}`;
  }).join('. ');
  const value = (kind, v, i, above) => (
    <Fragment key={`${kind}-${rooms[i].code}`}>
      <i className={`cl-pt is-${kind}`} style={{ left: `${xAt(i, n)}%`, top: `${yAt(v)}%` }} />
      <b className={`cl-pt-v is-${kind}`} data-at={above ? 'above' : 'below'} style={{ left: `${xAt(i, n)}%`, top: `${yAt(v)}%` }}>{pct(v)}</b>
    </Fragment>
  );
  return (
    <section className="card ac-card cl-chart" aria-labelledby="cl-trend-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="cl-trend-h">Accuracy and participation</h2>
          <p>Each room, oldest first, in percent. Took part is the share of present students who answered.</p>
        </div>
        <div className="cl-legend" aria-hidden="true">
          <span><i className="cl-key is-acc" />Class accuracy</span>
          <span><i className="cl-key is-part" />Took part</span>
        </div>
      </div>
      <div className="cl-trend" role="img" aria-label={said}>
        <div className="cl-trend-y" aria-hidden="true">
          {[1, 0.5, 0].map((v) => <span key={v} style={{ top: `${yAt(v)}%` }}>{Math.round(v * 100)}%</span>)}
        </div>
        <div className="cl-trend-plot" aria-hidden="true">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <line key={v} x1="0" x2="100" y1={yAt(v)} y2={yAt(v)} className="cl-trend-grid" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={linePath(part, n)} className="cl-trend-line is-part" vectorEffect="non-scaling-stroke" />
            <path d={linePath(acc, n)} className="cl-trend-line is-acc" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* The higher of the two figures prints above its point, the lower below, so they never sit on each other. */}
          {rooms.map((r, i) => (
            <Fragment key={r.code}>
              {part[i] !== null && value('part', part[i], i, acc[i] === null || part[i] > acc[i])}
              {acc[i] !== null && value('acc', acc[i], i, part[i] === null || acc[i] >= part[i])}
            </Fragment>
          ))}
        </div>
        <div className="cl-trend-x" aria-hidden="true">
          {rooms.map((r, i) => (
            <span key={r.code} style={{ left: `${xAt(i, n)}%` }}>
              <b>{dayOf(r.startedAt) || '—'}</b>
              <small>{r.code}</small>
            </span>
          ))}
        </div>
      </div>
      {acc.some((v) => v === null) && (
        <p className="t-meta cl-chart-foot">A room without a point had no graded answer: a Teacher-led room, or one not yet answered.</p>
      )}
    </section>
  );
}

/** A room's people against the roster, as the API counts them, each part with its words. */
function presenceOf(r) {
  const att = r.attendance;
  const p = r.participation ?? {};
  if (!att) return null;
  const parts = r.mode === 'teacher-led'
    ? [{ id: 'present', n: att.present ?? 0, word: 'present, Teacher-led (no phone answers)' }]
    : [
      { id: 'answered', n: p.answered ?? 0, word: 'answered' },
      { id: 'silent', n: p.notAnswered ?? 0, word: 'present without an answer' },
    ];
  parts.push({ id: 'absent', n: att.absent ?? 0, word: 'absent' }, { id: 'unmarked', n: att.unmarked ?? 0, word: 'not marked' });
  return { parts, size: att.classSize ?? parts.reduce((t, s) => t + s.n, 0) };
}

const PRESENCE_KEYS = [
  ['answered', 'Answered'], ['silent', 'Present, no answer'], ['present', 'Present, Teacher-led'],
  ['absent', 'Absent'], ['unmarked', 'Not marked'],
];

/**
 * Who answered, who was present without an answer, and who was absent, room
 * by room against the roster (A2): one stacked bar a room, each part also
 * said in words beneath it. Students not marked either way are shown as such.
 */
function RoomPresence({ rooms }) {
  const rows = rooms.map((r) => ({ r, pr: presenceOf(r) })).filter((x) => x.pr);
  if (!rows.length) return null;
  const widest = Math.max(1, ...rows.map((x) => x.pr.size));
  const used = new Set(rows.flatMap((x) => x.pr.parts.filter((s) => s.n > 0).map((s) => s.id)));
  return (
    <section className="card ac-card cl-chart" aria-labelledby="cl-pres-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="cl-pres-h">Attendance and participation</h2>
          <p>Students in each room against the roster, oldest first.</p>
        </div>
      </div>
      <div className="cl-legend cl-pres-legend" aria-hidden="true">
        {PRESENCE_KEYS.filter(([id]) => used.has(id)).map(([id, word]) => <span key={id}><i className="cl-seg-key" data-seg={id} />{word}</span>)}
      </div>
      <ol className="cl-pres">
        {rows.map(({ r, pr }) => {
          const shown = pr.parts.filter((s) => s.n > 0);
          return (
            <li key={r.code} className="cl-pres-row">
              <span className="cl-pres-who">
                <b>{r.code}</b>
                <small>{dayOf(r.startedAt) || 'No date'}</small>
              </span>
              <span className="cl-pres-bar" aria-hidden="true">
                <span className="cl-pres-fill" style={{ width: `${(pr.size / widest) * 100}%` }}>
                  {shown.map((s) => <i key={s.id} data-seg={s.id} style={{ flexGrow: s.n }}>{s.n}</i>)}
                </span>
              </span>
              <span className="cl-pres-words">
                {shown.length
                  ? `${shown.map((s) => `${s.n} ${s.word}`).join(' · ')}, of ${pr.size} on the roster`
                  : 'Nobody on the roster'}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** How the class spreads: students by accuracy in 10-point steps. Counts only, never names. */
function Spread({ h }) {
  const buckets = list(h?.buckets);
  const legend = list(h?.legend);
  const max = Math.max(1, ...buckets.map((b) => b.students ?? 0));
  const spans = { 'needs-support': 4, developing: 2, excelling: 4 };
  return (
    <section className="card ac-card" aria-labelledby="cl-spread-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="cl-spread-h">How the class spreads</h2>
          <p>Each student's accuracy over these rooms, pooled by roll number, in 10-point steps. Counts only.</p>
        </div>
      </div>
      <div className="cl-spread">
        {h?.students ? (
          <>
            <div
              className="cl-hist"
              role="img"
              aria-label={buckets.map((b) => `${b.from} to ${b.to}%: ${plural(b.students, 'student')}`).join('; ')}
            >
              {buckets.map((b, i) => (
                <span key={b.from} className="cl-hist-col">
                  <em>{b.students || ''}</em>
                  <i style={{ height: b.students ? `calc(${Math.max(0.03, b.students / max).toFixed(3)} * (100% - 16px))` : 0, '--d': `${i * 40}ms` }} data-zero={!b.students || undefined} />
                </span>
              ))}
            </div>
            <div className="cl-hist-x" aria-hidden="true">
              {[0, 20, 40, 60, 80, 100].map((v) => <span key={v} style={{ left: `${v}%` }}>{v}%</span>)}
            </div>
            <div className="cl-hist-bands">
              {legend.map((l) => (
                <span key={l.band} style={{ flex: spans[l.band] ?? 1 }}>
                  <b>{l.students}</b> {l.label}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="cl-none">No student has three graded answers in these rooms yet, so there is nothing to spread.</p>
        )}
        <p className="t-meta">
          {h?.sentence || (
            <>
              {plural(h?.students ?? 0, 'student')} over {plural(h?.answers ?? 0, 'graded answer')}.
              {h?.notEnough ? ` ${plural(h.notEnough, 'student')} with fewer than three answers ${h.notEnough === 1 ? 'is' : 'are'} left out.` : ''}
            </>
          )}
        </p>
      </div>
    </section>
  );
}

/** One bar: what it is, how well, and on how many answers, with the server's count sentence (Phase 5) beneath. */
function Bar({ name, mark, row }) {
  const answers = row?.answers ?? 0;
  const p = answers ? Math.round(((row?.correct ?? 0) / answers) * 100) : null;
  return (
    <li className="cl-bar" data-empty={answers ? undefined : 'true'}>
      <span className="cl-bar-name">{mark}{name}</span>
      <span className="cl-bar-fig">
        <b>{p === null ? '—' : `${p}%`}</b>
        <small>{answers ? `${row.correct} of ${answers} right` : 'no answers'}</small>
      </span>
      <span className="cl-bar-track" aria-hidden="true"><i style={{ width: `${p === null ? 0 : Math.max(p, 2)}%` }} /></span>
      {row?.sentence && <small className="cl-bar-basis">{row.sentence}</small>}
    </li>
  );
}

function Levels({ a, first = 'bands' }) {
  // Decision 6 (19 Nov): a class summary reads in the three level bands first,
  // with the six levels one press away. Both come back every time. Where the
  // next question is chosen, and in one student's detail, it stays six.
  const [reading, setReading] = useState(first);
  const levels = LEVELS.map((l) => list(a?.levels).find((r) => r.level === l) ?? { level: l, answers: 0, correct: 0 });
  const bands = list(a?.levelBands);
  return (
    <section className="card ac-card" aria-labelledby="cl-levels-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="cl-levels-h">Accuracy by level</h2>
          <p>
            {reading === 'levels'
              ? 'Each of the six levels on its own, so each figure rests on fewer answers. Three bands reads the same answers in pairs of levels.'
              : 'The same answers in three pairs of levels, so each figure rests on more answers. Six levels shows each one on its own.'}
          </p>
        </div>
        <Segmented
          label="Read by"
          value={reading}
          onChange={setReading}
          options={[{ id: 'bands', label: 'Three bands' }, { id: 'levels', label: 'Six levels' }]}
        />
      </div>
      <ul className="cl-bars">
        {reading === 'levels'
          ? levels.map((r) => (
            <Bar key={r.level} row={r} name={r.label ?? LABEL[r.level]} mark={<Level level={r.level}>{LEVELS.indexOf(r.level) + 1}</Level>} />
          ))
          : bands.map((b) => (
            <Bar
              key={b.id}
              row={b}
              name={b.label}
              mark={(
                <span className="cl-pairmark">
                  {list(b.levels).map((l) => <Level key={l} level={l}>{LEVELS.indexOf(l) + 1}</Level>)}
                </span>
              )}
            />
          ))}
      </ul>
    </section>
  );
}

function Hardest({ hd }) {
  const items = list(hd?.items);
  // One wrong-key sentence, said once, however many questions carry it.
  const flags = [];
  items.forEach((it) => list(it.flags).forEach((f) => { if (!flags.some((g) => g.id === f.id)) flags.push(f); }));
  return (
    <section className="card ac-card" aria-labelledby="cl-hard-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="cl-hard-h">Hardest questions</h2>
          <p>Flagged first, then the lowest share right. Only questions with at least {hd?.minAttempts ?? 5} answers in these rooms.</p>
        </div>
      </div>
      {flags.length > 0 && (
        <div className="ac-pad-x stack stack-2">
          {flags.map((f) => <Note key={f.id} tone="warn" icon="flag"><b>Flagged.</b> {f.message}</Note>)}
        </div>
      )}
      {items.length === 0 ? (
        <p className="cl-none">No question has {hd?.minAttempts ?? 5} answers in these rooms yet.</p>
      ) : (
        <ol className="cl-hard">
          {items.map((it) => {
            // Phase 5, honest indicators: who wrote it, whether its level is
            // uncertain, the count behind the figure, and a language gap when
            // a second language exists. Each is the server's own words.
            const uncertain = it.levelCheck?.uncertain === true;
            return (
              <li key={it.questionId} className="cl-q">
                <div className="cl-q-main">
                  <p className="cl-q-t">{it.text}</p>
                  <span className="cl-q-meta">
                    <Level level={it.bloom} />
                    {uncertain && <Chip tone="line" icon="help" className="cl-q-unsure">Level uncertain</Chip>}
                    {it.topic && <span>{it.topic}</span>}
                    {it.kind && <span>{KIND_LABEL[it.kind] ?? it.kind}</span>}
                    {it.provenance?.label && (
                      <span className="ac-set" title={it.provenance.sentence || undefined}>
                        {it.provenance.label}
                      </span>
                    )}
                    {it.status && it.status !== 'active' && <span className="ac-set">{BANK_STATUS[it.status] ?? it.status}</span>}
                    {list(it.flags).length > 0 && <Chip tone="warn" icon="flag">Flagged</Chip>}
                  </span>
                  {uncertain && it.levelCheck.sentence && <p className="cl-q-note">{it.levelCheck.sentence}</p>}
                  {it.languages?.warning?.text && <Note tone="warn" icon="alert">{it.languages.warning.text}</Note>}
                  {!it.languages?.warning && it.languages?.note && <p className="cl-q-note">{it.languages.note}</p>}
                  <BankLink item={it} />
                </div>
                <span className="cl-q-fig">
                  <b>{pct(it.proportionCorrect)}</b>
                  {it.basis?.sentence ? (
                    <>
                      <small>{it.correct} right</small>
                      <small className="cl-q-basis">{it.basis.sentence}</small>
                    </>
                  ) : (
                    <small>{it.correct} of {plural(it.attempts, 'answer')} right</small>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="t-meta cl-hard-foot">
        {plural(hd?.questions ?? 0, 'question')} answered over {plural(hd?.answers ?? 0, 'final graded answer')}
        {hd?.belowFloor ? `; ${hd.belowFloor} with fewer than ${hd?.minAttempts ?? 5} answers ${hd.belowFloor === 1 ? 'is' : 'are'} left out.` : '.'}
      </p>
    </section>
  );
}

/**
 * The class across its last 4 or 8 rooms, as GET /api/classes/:id/analytics
 * returns it. Every figure carries what it rests on. No student is named or
 * ranked here: the spread is counts, and the hardest list is questions.
 *
 * @param analytics  { data, loading, error, last }
 */
export function ClassAnalytics({ analytics, onLast, onRetry, firstReading }) {
  const a = analytics?.data;
  const last = analytics?.last ?? 4;
  if (!a && analytics?.loading) return <AnalyticsSkeleton />;
  if (!a) {
    return (
      <div className="card">
        <Empty icon="alert" title="The class across rooms did not load" action={<Button variant="primary" icon="refresh" onClick={onRetry}>Try again</Button>}>
          {analytics?.error || 'Nothing came back.'}
        </Empty>
      </div>
    );
  }
  const hasRooms = list(a.rooms).length > 0;
  return (
    <div className="stack stack-5">
      {analytics.error && <Note tone="bad">The figures below are the last ones that loaded: {analytics.error}</Note>}
      <Brief a={a} last={last} onLast={onLast} busy={analytics.loading} />
      {hasRooms && (
        <>
          <div className="cl-charts">
            <RoomTrend rooms={list(a.rooms)} />
            <RoomPresence rooms={list(a.rooms)} />
          </div>
          <RoomsTable a={a} />
          <div className="cl-pair-cards">
            <Spread h={a.histogram} />
            <Levels a={a} first={firstReading} />
          </div>
          <LevelChange c={a.comparison} bands={a.levelBands} first={firstReading} />
          <Hardest hd={a.hardest} />
        </>
      )}
      {a.privacy && <p className="cl-foot-privacy"><Icon name="shield" />{a.privacy}</p>}
    </div>
  );
}

/* ================================================================ one class */

/**
 * One class.
 *
 * @param data        GET /api/classes/:id: { class, students, removed }
 * @param classId     the class's id, for the Phase 4 views
 * @param view        'roster' | 'rooms' | 'outcomes' | 'attainment' | 'register'
 * @param busy        the one student action in flight, as { id, action }
 * @param notice      { message, student? }: what the last action did; with a
 *                    student, the removal it can undo
 * @param onSaveStudent (student, patch) => Promise; throws the server's sentence
 * @param onMarkUnder18 (student, under18) => sets or clears the owner's mark (decision 8)
 * @param under18Note  the server's sentence that comes with the mark, once a reply has carried it
 * @param onAddStudents (students) => Promise<reply>; throws the server's sentence
 * @param onEditClass   (patch) => Promise; throws the server's sentence
 * @param obs         { student, data, loading, error } or null
 * @param analytics   { data, loading, error, last }
 * @param startPaste  gallery only: open "Add students" on { text, reply }
 * @param firstReading gallery only: 'bands' (the default, decision 6) or 'levels' first
 */
export function ClassView({
  loading, error, notFound, locked, data, reading, onReload,
  classId, view = 'roster', onView, onImported,
  busy, notice, actionError, onDismiss,
  onSaveStudent, onRemove, onRestore, onMarkUnder18, under18Note, onAddStudents, onEditClass,
  obs, onOpenObs, onCloseObs, onRetryObs,
  analytics, onLast, onRetryAnalytics,
  startPaste, firstReading,
}) {
  const [pasting, setPasting] = useState(Boolean(startPaste));
  const [importing, setImporting] = useState(false);
  const [editingClass, setEditingClass] = useState(false);
  // The hub needs an account: the shared key (and laptop mode) has none.
  const { account: viewer } = useViewer();
  const c = data?.class;
  const canEdit = Boolean(c?.canEdit);
  const crumbOf = (tail) => (
    <>
      <Link to="/classes" className="cl-crumb">Classes</Link>
      {tail && <><span aria-hidden="true">/</span><span className="clip">{tail}</span></>}
    </>
  );

  if (loading) {
    return <AccountShell current="classes" crumb={crumbOf()} title="Class"><RosterSkeleton /></AccountShell>;
  }

  if (!c) {
    return (
      <AccountShell current="classes" crumb={crumbOf()} title={notFound ? 'Class not found' : 'Class'}>
        <div className="card">
          <Empty
            icon={locked ? 'lock' : notFound ? 'search' : 'alert'}
            title={locked ? 'Classes need the teacher key or an account' : notFound ? error : 'The class did not load'}
            action={locked
              ? <Link className="btn btn-primary" to="/">Unlock the console</Link>
              : notFound
                ? <Link className="btn btn-primary" to="/classes"><Icon name="back" />All classes</Link>
                : <Button variant="primary" icon="refresh" busy={reading} onClick={onReload}>Try again</Button>}
          >
            {notFound ? 'It may belong to an account you cannot read, or the link may be wrong.' : error}
          </Empty>
        </div>
      </AccountShell>
    );
  }

  const students = list(data.students);
  const sub = [c.section, c.termLabel, plural(c.size ?? students.length, 'student') + ' on the roster'].filter(Boolean).join(' · ');
  const actions = (
    <span className="ac-headacts">
      <Tip label="Read the class again">
        <Button variant="ghost" icon="refresh" busy={reading} aria-label="Read the class again" onClick={onReload} />
      </Tip>
      {canEdit && <Button icon="edit" onClick={() => setEditingClass(true)}>Course and term</Button>}
      {viewer && viewer.role !== 'student' && (
        <Link className="btn" to={`/hubs/c/${classId}`}><Icon name="path" />Learning Hub</Link>
      )}
    </span>
  );
  const roomsN = list(analytics?.data?.rooms).length;

  return (
    <AccountShell current="classes" crumb={crumbOf(c.section)} title={c.courseName} sub={sub} actions={actions}>
      <div className="cl-viewbar">
        <Segmented
          label="Class view"
          value={view}
          onChange={onView}
          options={[
            { id: 'roster', label: 'Roster', count: students.length },
            { id: 'rooms', label: 'Across rooms', count: analytics?.data ? roomsN : undefined },
            ...(classId ? [
              { id: 'outcomes', label: 'Outcomes' },
              { id: 'attainment', label: 'Attainment' },
              { id: 'register', label: 'Marks register' },
              { id: 'misconceptions', label: 'Misconceptions' },
            ] : []),
          ]}
        />
        {!canEdit && <span className="cl-ro"><Icon name="eye" />Read only: changes belong to the professor who keeps this class.</span>}
      </div>

      {error && <Note tone="bad">The class below is the last one that loaded: {error}</Note>}

      {view === 'rooms' ? (
        <ClassAnalytics analytics={analytics} onLast={onLast} onRetry={onRetryAnalytics} firstReading={firstReading} />
      ) : view === 'outcomes' && classId ? (
        <Outcomes classId={classId} />
      ) : view === 'attainment' && classId ? (
        <Attainment classId={classId} />
      ) : view === 'register' && classId ? (
        <Register classId={classId} />
      ) : view === 'misconceptions' && classId ? (
        <ClassMisconceptions classId={classId} />
      ) : (
        <>
          {(notice || actionError) && (
            <div className="stack stack-3">
              {notice && (
                <Note tone="ok" role="status">
                  {notice.message}
                  {notice.student && canEdit && (
                    <>
                      {' '}
                      <button type="button" className="link ac-linkbtn" onClick={() => onRestore(notice.student)}>
                        Put {notice.student.rollNo} back
                      </button>
                    </>
                  )}
                </Note>
              )}
              {actionError && <Note tone="bad" role="alert">{actionError}</Note>}
            </div>
          )}
          <Roster
            data={data}
            canEdit={canEdit}
            busy={busy}
            onSave={onSaveStudent}
            onRemove={(s) => { onDismiss?.(); onRemove(s); }}
            onRestore={(s) => { onDismiss?.(); onRestore(s); }}
            onMark={onMarkUnder18 ? (s, value) => { onDismiss?.(); onMarkUnder18(s, value); } : undefined}
            under18Note={under18Note}
            onObs={onOpenObs}
            onPaste={() => { onDismiss?.(); setPasting(true); }}
            onImport={classId ? () => { onDismiss?.(); setImporting(true); } : undefined}
          />
        </>
      )}

      <ObservationsSheet obs={obs} onClose={onCloseObs} onRetry={onRetryObs} />
      {canEdit && (
        <>
          <PasteDialog open={pasting} onOpenChange={setPasting} onSend={onAddStudents} start={startPaste} />
          {classId && <RosterImport classId={classId} open={importing} onOpenChange={setImporting} onDone={onImported} />}
          <ClassDialog
            open={editingClass}
            onOpenChange={setEditingClass}
            mode="edit"
            initial={{ courseName: c.courseName ?? '', section: c.section ?? '', termLabel: c.termLabel ?? '' }}
            onSubmit={onEditClass}
          />
        </>
      )}
    </AccountShell>
  );
}

/* =============================================================== containers */

function ClassList() {
  const navigate = useNavigate();
  const { account, loading: accountLoading } = useViewer();
  const student = account?.role === 'student';
  const [raw, setRaw] = useState(null);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    setReading(true);
    try {
      const res = await api.listClasses();
      setRaw(list(res?.classes));
      // The server says whether this viewer may create a class, by the rule
      // POST /api/classes enforces (a head of department may not).
      setCanCreate(res?.canCreate === true);
      setError('');
      setLocked(false);
    } catch (err) {
      setError(err.message || 'The classes did not load.');
      setLocked(err.status === 401);
    } finally {
      setReading(false);
    }
  }, []);

  // Waits for the account: a read sent before it settles carries no bearer
  // token and is answered for the shared key instead.
  useEffect(() => {
    if (accountLoading || student) return;
    load();
  }, [accountLoading, account?.id, student, load]);

  // Newest first, stated rather than assumed.
  const classes = useMemo(
    () => (raw === null ? null : [...raw].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))),
    [raw],
  );

  return (
    <ClassListView
      loading={accountLoading || (!student && classes === null && !error)}
      error={error}
      locked={locked}
      student={student}
      classes={classes}
      reading={reading}
      onReload={load}
      canCreate={canCreate}
      onCreate={async (body) => {
        const res = await api.createClass(body);
        navigate(`/classes/${encodeURIComponent(res.class.id)}`);
      }}
    />
  );
}

function ClassPage({ id }) {
  const { account, loading: accountLoading } = useViewer();
  const [params, setParams] = useSearchParams();
  const view = VIEWS.includes(params.get('view')) ? params.get('view') : 'roster';

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [locked, setLocked] = useState(false);
  const [reading, setReading] = useState(false);

  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState('');
  // The server's under-18 note, kept from the last reply that carried one
  // (setting the mark, a paste that marked someone). GET /api/classes/:id
  // does not carry it; if it ever does, that one is used.
  const [u18Note, setU18Note] = useState('');

  const [obs, setObs] = useState(null);
  const obsFor = useRef(null);

  const [analytics, setAnalytics] = useState({ last: 4, data: null, loading: false, error: '' });
  const analyticsReq = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setReading(true);
    try {
      const res = await api.getClass(id);
      setData(res);
      setError('');
      setNotFound(false);
      setLocked(false);
    } catch (err) {
      if (!silent) {
        setError(err.message || 'The class did not load.');
        setNotFound(err.status === 404);
        setLocked(err.status === 401);
        if (err.status === 404) setData(null);
      }
    } finally {
      if (!silent) setReading(false);
    }
  }, [id]);

  const loadAnalytics = useCallback(async (last) => {
    const req = ++analyticsReq.current;
    setAnalytics((a) => ({ ...a, last, loading: true, error: '' }));
    try {
      const res = await api.classAnalytics(id, last);
      if (req === analyticsReq.current) setAnalytics({ last, data: res, loading: false, error: '' });
    } catch (err) {
      if (req === analyticsReq.current) setAnalytics((a) => ({ ...a, loading: false, error: err.message || 'The figures did not load.' }));
    }
  }, [id]);

  useEffect(() => {
    if (accountLoading) return;
    setData(null);
    setNotice(null);
    setActionError('');
    load();
  }, [accountLoading, account?.id, load]);

  // The figures are read when the view is first opened, and again for 4 or 8.
  useEffect(() => {
    if (accountLoading || view !== 'rooms' || analytics.data || analytics.loading || analytics.error) return;
    loadAnalytics(analytics.last);
  }, [accountLoading, view, analytics, loadAnalytics]);

  /** One action on one student, then the class read again, done or refused. */
  async function act(student, action, run) {
    setBusy({ id: student.id, action });
    setActionError('');
    setNotice(null);
    try {
      await run();
    } catch (err) {
      setActionError(err.message || 'The server refused that.');
    } finally {
      await load({ silent: true });
      setBusy(null);
    }
  }

  const openObs = useCallback(async (student) => {
    obsFor.current = student.id;
    setObs({ student, data: null, loading: true, error: '' });
    try {
      const res = await api.studentObservations(id, student.id);
      if (obsFor.current === student.id) setObs({ student, data: res, loading: false, error: '' });
    } catch (err) {
      if (obsFor.current === student.id) setObs({ student, data: null, loading: false, error: err.message || 'The observations did not load.' });
    }
  }, [id]);

  return (
    <ClassView
      loading={accountLoading || (data === null && !error)}
      error={error}
      notFound={notFound}
      locked={locked}
      data={data}
      reading={reading}
      onReload={() => { load(); if (view === 'rooms') loadAnalytics(analytics.last); }}
      view={view}
      classId={id}
      onView={(v) => setParams(v === 'roster' ? {} : { view: v }, { replace: true })}
      onImported={(res) => {
        if (res?.under18Note && list(res.added).some((s) => s.under18)) setU18Note(res.under18Note);
        load({ silent: true });
      }}
      busy={busy}
      notice={notice}
      actionError={actionError}
      onDismiss={() => { setNotice(null); setActionError(''); }}
      onSaveStudent={async (student, patch) => {
        await api.updateStudent(id, student.id, patch);
        await load({ silent: true });
      }}
      onRemove={(student) => act(student, 'remove', async () => {
        const res = await api.removeStudent(id, student.id);
        setNotice({ message: res?.message || 'Removed from the roster.', student: res?.student ?? student });
      })}
      onRestore={(student) => act(student, 'restore', async () => {
        await api.updateStudent(id, student.id, { active: true });
        setNotice({ message: `${student.rollNo} ${student.name} is back on the roster.` });
      })}
      onMarkUnder18={(student, under18) => act(student, 'under18', async () => {
        const res = await api.updateStudent(id, student.id, { under18 });
        if (res?.under18Note) setU18Note(res.under18Note);
        setNotice({
          message: under18
            ? `${student.rollNo} ${student.name} is marked under 18.`
            : `${student.rollNo} ${student.name} is no longer marked under 18.`,
        });
      })}
      under18Note={data?.under18Note || u18Note}
      onAddStudents={async (students) => {
        const res = await api.addStudents(id, students);
        if (res?.under18Note) setU18Note(res.under18Note);
        await load({ silent: true });
        return res;
      }}
      onEditClass={async (patch) => {
        const res = await api.updateClass(id, patch);
        if (res?.class) setData(res);
      }}
      obs={obs}
      onOpenObs={openObs}
      onCloseObs={() => { obsFor.current = null; setObs(null); }}
      onRetryObs={() => obs?.student && openObs(obs.student)}
      analytics={analytics}
      onLast={(n) => loadAnalytics(n)}
      onRetryAnalytics={() => loadAnalytics(analytics.last)}
    />
  );
}

export default function Classes() {
  const { id } = useParams();
  return id ? <ClassPage key={id} id={id} /> : <ClassList />;
}
