/**
 * A roster from a CSV file (Phase 4): the dialog the Roster tab's "Import a
 * CSV" opens. Owner only; staff only.
 *
 * The file is read as text in this browser (or pasted) and sent whole to
 * POST /api/classes/:id/students/import. Nothing here parses it: the server
 * reads the columns, and this screen shows only what it answers. A dry run
 * comes first and writes nothing; "Add N students" then runs the real import.
 *
 * Privacy, as the server's rules ask:
 * - A roster keeps a roll number and a name only. Values in any other column
 *   are never previewed, stored or echoed here: the file's text is never put
 *   on screen, and of its other columns only the names the server lists in
 *   `ignoredColumns` are shown. The text lives in this dialog's state only
 *   until it closes.
 * - A refused row whose name holds a long number (`bad-name`: a phone number or
 *   a date of birth, by the server's check) is shown by line and roll number,
 *   without that name.
 * - A removed student is reported and never restored by the import. Each one
 *   can be put back here, one at a time (PATCH { active: true }); the dry run
 *   is then read again so every figure stays the server's.
 *
 * Errors are the server's sentences, shown as they come: 403 for an HOD (the
 * dry run too), 413 over 1 MB, 400 over 2,000 rows or without the two columns.
 *
 *   <RosterImport classId open onOpenChange onDone />
 *     onDone(reply) after a real import, and onDone() after a student is put
 *     back, so the roster reads again.
 *
 * The under-18 mark (decision 8): a file may carry an Under 18 column (or
 * under18, minor, below 18), read by the server as yes or no. The screen names
 * the column the server read (read.columns.under18), marks each row it would
 * add or added (`under18`), and shows the server's `under18` sentence (a
 * student already on the roster keeps their mark) and its `under18Note`.
 *   `send` and `restore` stand in for api.importRoster and api.updateStudent,
 *   and `start` opens on a given state ({ how, file, text, stage, reply,
 *   error }): the dev gallery.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Chip, Dialog, Icon, Note, Segmented } from '../ui/index.jsx';

const list = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DELIMITER = { comma: 'comma-separated', semicolon: 'semicolon-separated', tab: 'tab-separated' };
/** The server's reason, then a line of ours after it: a full stop between them, the reason's words untouched. */
const then = (reason, more) => (reason ? `${reason}${/[.!?]$/.test(reason) ? '' : '.'} ${more}` : more);

/** A size people read: "2 KB", "1.4 MB". */
function sizeOf(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return plural(bytes, 'byte');
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A spreadsheet's own file (.xlsx, .ods) is not text: say so before anything is sent. */
const looksLikeText = (file) => /\.(csv|txt)$/i.test(file.name) || /^text\/(csv|plain)$/.test(file.type) || file.type === 'application/csv';

/* ------------------------------------------------------------------ pieces */

function Row({ line, roll, name, children }) {
  return (
    <li className="ri-row">
      <span className="ri-line" title="Line in the file">{line ?? ''}</span>
      <span className="ri-roll">{roll || <i className="ri-missing">no roll number</i>}</span>
      <span className="ri-row-body">
        {name !== undefined && <span className="ri-name">{name || <i className="ri-missing">no name</i>}</span>}
        {children}
      </span>
    </li>
  );
}

function Group({ title, count, tone, sub, children }) {
  return (
    <section className="ri-group" data-tone={tone}>
      <h3>{title} <span className="ri-n">{count}</span></h3>
      {sub && <p className="ri-group-sub">{sub}</p>}
      <ul className="ri-rows">{children}</ul>
    </section>
  );
}

/**
 * What the server read: the delimiter, the columns it used, the rows. Never a
 * value. The under-18 column (decision 8) is named only when the server read one.
 */
function ReadLine({ read }) {
  if (!read) return null;
  const cols = read.columns ?? {};
  return (
    <p className="ri-read">
      Read as {DELIMITER[read.delimiter] ?? read.delimiter ?? 'a CSV'}.
      {cols.roll && <> Roll numbers from <b>“{cols.roll}”</b>{cols.name ? ',' : '.'}</>}
      {cols.name && <> names from <b>“{cols.name}”</b>{cols.under18 ? ',' : '.'}</>}
      {cols.under18 && <> the under-18 mark from <b>“{cols.under18}”</b>, as yes or no.</>}
      {Number.isFinite(read.rows) && ` ${plural(read.rows, 'row')} under the header`}
      {read.blankLines ? `, ${plural(read.blankLines, 'blank line')} skipped.` : Number.isFinite(read.rows) ? '.' : ''}
    </p>
  );
}

/** The under-18 mark beside a name. Staff only, like the roster. */
const Under18 = () => <Chip tone="line" icon="shield" className="cl-u18">Under 18</Chip>;

/**
 * The file's under-18 column, said where the import shows it: the server's
 * sentence about students already on the roster whose mark the file does not
 * change, and its note on what the mark does (a lawyer must confirm it).
 */
function Under18Lines({ reply }) {
  if (!reply?.under18 && !reply?.under18Note) return null;
  return (
    <div className="stack stack-2">
      {reply.under18 && <Note tone="warn" icon="shield">{reply.under18}</Note>}
      {reply.under18Note && <Note icon="shield">{reply.under18Note}</Note>}
    </div>
  );
}

/** Columns the server did not read, by name only, and its note. */
function Ignored({ reply }) {
  const cols = list(reply?.ignoredColumns);
  if (!cols.length && !reply?.note) return null;
  return (
    <div className="ri-ignored">
      <span className="ri-ignored-ic" aria-hidden="true"><Icon name="shield" size={14} /></span>
      <div>
        <span className="ri-ignored-head">Not read from the file</span>
        {cols.length > 0 && (
          <span className="ri-cols">{cols.map((c) => <Chip key={c} className="ri-col">{c}</Chip>)}</span>
        )}
        {reply.note && <p>{reply.note}</p>}
      </div>
    </div>
  );
}

/**
 * Every row the server did not add, sorted the way it sorted them: removed
 * students (each can be put back), already on the roster, twice in the file,
 * and the rest. Each shows the server's reason.
 */
function Refusals({ reply, canRestore, restoring, restored, onRestore }) {
  const refused = list(reply?.refused);
  const reasonAt = (line) => refused.find((r) => r.line === line)?.reason ?? '';
  const nameAt = (line) => {
    const r = refused.find((x) => x.line === line);
    return r && r.code !== 'bad-name' ? r.name : undefined;
  };
  const removed = list(reply?.removed);
  const onRoster = list(reply?.duplicates?.onRoster);
  const inFile = list(reply?.duplicates?.inFile);
  const sorted = new Set([...removed, ...onRoster, ...inFile].map((r) => r.line));
  const rest = refused.filter((r) => !sorted.has(r.line));

  return (
    <>
      {removed.length > 0 && (
        <Group
          title="Removed from this class"
          count={removed.length}
          tone="warn"
          sub="An import never puts a removed student back. If one belongs in this class again, put them back here: their earlier answers and marks are kept."
        >
          {removed.map((r) => {
            const s = r.student ?? {};
            const back = restored[s.id];
            return (
              <Row key={r.line} line={r.line} roll={r.rollNo} name={s.name ?? nameAt(r.line)}>
                <span className="ri-why">{back ? 'Back on the roster.' : reasonAt(r.line)}</span>
                {canRestore && s.id && !back && (
                  <Button
                    size="sm"
                    icon="undo"
                    className="ri-act"
                    busy={restoring === s.id}
                    disabled={restoring != null}
                    onClick={() => onRestore(s)}
                    aria-label={`Put ${r.rollNo} ${s.name ?? ''} back on the roster`}
                  >
                    Put back
                  </Button>
                )}
              </Row>
            );
          })}
        </Group>
      )}
      {onRoster.length > 0 && (
        <Group title="Already on the roster" count={onRoster.length}>
          {onRoster.map((r) => (
            <Row key={r.line} line={r.line} roll={r.rollNo} name={nameAt(r.line)}>
              <span className="ri-why">
                {r.onRoster?.name && r.onRoster.name !== nameAt(r.line)
                  ? then(reasonAt(r.line), `On the roster as ${r.onRoster.name}.`)
                  : reasonAt(r.line)}
              </span>
            </Row>
          ))}
        </Group>
      )}
      {inFile.length > 0 && (
        <Group title="Twice in this file" count={inFile.length}>
          {inFile.map((r) => (
            <Row key={r.line} line={r.line} roll={r.rollNo} name={nameAt(r.line)}>
              <span className="ri-why">
                {r.firstLine ? then(reasonAt(r.line), `First on line ${r.firstLine}.`) : reasonAt(r.line)}
              </span>
            </Row>
          ))}
        </Group>
      )}
      {rest.length > 0 && (
        <Group title="Could not be added" count={rest.length} tone="bad">
          {rest.map((r) => (
            <Row key={r.line} line={r.line} roll={r.roll} name={r.code === 'bad-name' ? undefined : r.name}>
              <span className="ri-why">{r.reason}</span>
            </Row>
          ))}
        </Group>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- the view */

/**
 * The dialog's body for one stage, drawn from what it is given.
 *
 * @param stage    'choose' | 'checked' | 'done'
 * @param how      'file' | 'paste'
 * @param file     { name, size } of the chosen file, or null
 * @param text     the pasted text (a file's text is never shown)
 * @param reply    the server's reply to the dry run ('checked') or the import ('done')
 * @param error    the server's sentence, or ''
 * @param busy     'read' | 'check' | 'import' | a student id being put back | null
 * @param restored { [studentId]: true } for students put back here
 */
export function ImportBody({
  stage, how, onHow, file, onFile, text, onText, reply, error, notice, busy, restored = {}, onRestore,
}) {
  const uid = useId();
  const [over, setOver] = useState(false);

  if (stage === 'choose') {
    return (
      <div className="ri">
        <Segmented
          label="Where the list comes from"
          value={how}
          onChange={onHow}
          options={[{ id: 'file', label: 'A CSV file' }, { id: 'paste', label: 'Paste the text' }]}
        />
        {how === 'file' ? (
          <label
            className="ri-drop"
            htmlFor={`${uid}-file`}
            data-over={over ? 'true' : undefined}
            data-chosen={file ? 'true' : undefined}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          >
            <input
              id={`${uid}-file`}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
            />
            <span className="ri-drop-ic" aria-hidden="true"><Icon name={file ? 'material' : 'upload'} size={18} /></span>
            {file ? (
              <span className="ri-drop-text">
                <b className="clip">{file.name}</b>
                <span>{sizeOf(file.size)} · read in this browser, not shown here. Choose another to replace it.</span>
              </span>
            ) : (
              <span className="ri-drop-text">
                <b>Choose a .csv file</b>
                <span>or drop it here. Save the class list from the spreadsheet as CSV first.</span>
              </span>
            )}
          </label>
        ) : (
          <div className="field">
            <label className="label" htmlFor={`${uid}-text`}>The class list, header line first</label>
            <textarea
              id={`${uid}-text`}
              className="textarea ri-paste"
              spellCheck={false}
              value={text}
              onChange={(e) => onText(e.target.value)}
              placeholder={'Roll No, Name\n21CS01, Asha Rao\n21CS02, Bilal Khan'}
            />
          </div>
        )}
        <div className="ri-needs">
          <span className="ac-label">What the file needs</span>
          <p>
            A first line naming a roll number column (Roll, Roll No, Roll Number) and a name column (Name, Student Name).
            Comma, semicolon or tab between columns; at most 2,000 rows and 1 MB.
          </p>
          <p>
            A roster keeps a roll number and a name only. Any other column is left unread and named back to you, never stored.
          </p>
          <p>
            One more column is read if the file has it: Under 18 (or Minor), yes or no, the mark that stops integrity
            signals for that student. An import never changes a student already on the roster.
          </p>
        </div>
        {error && <Note tone="bad" role="alert">{error}</Note>}
      </div>
    );
  }

  const added = stage === 'done' ? list(reply?.added) : list(reply?.wouldAdd);
  const refusedN = list(reply?.refused).length;
  const canRestore = typeof onRestore === 'function';

  return (
    <div className="ri ri-result" aria-busy={busy === 'check' || undefined}>
      {stage === 'done' && (
        <Note tone="ok" role="status">
          {added.length ? `${plural(added.length, 'student')} added to the roster.` : 'Nobody was added.'}
          {Number.isFinite(reply?.size) ? ` It holds ${plural(reply.size, 'student')} now.` : ''}
        </Note>
      )}
      <ReadLine read={reply?.read} />

      <dl className="ri-figs">
        <div>
          <dt>{stage === 'done' ? 'Added' : 'Would add'}</dt>
          <dd>{added.length}</dd>
        </div>
        <div>
          <dt>Not added</dt>
          <dd>{refusedN}</dd>
        </div>
        {stage === 'checked' && Number.isFinite(reply?.size) && (
          <div className="ri-fig-size">
            <dt>On the roster</dt>
            <dd>
              {reply.size}
              {Number.isFinite(reply?.sizeAfter) && <><Icon name="forward" size={14} />{reply.sizeAfter}</>}
            </dd>
          </div>
        )}
        {stage === 'done' && Number.isFinite(reply?.size) && (
          <div className="ri-fig-size">
            <dt>On the roster now</dt>
            <dd>{reply.size}</dd>
          </div>
        )}
      </dl>

      {notice && <Note tone="ok" role="status">{notice}</Note>}
      {error && <Note tone="bad" role="alert">{error}</Note>}

      <Ignored reply={reply} />
      <Under18Lines reply={reply} />

      {added.length > 0 && (
        <Group
          title={stage === 'done' ? 'Added' : 'Would add'}
          count={added.length}
          tone="ok"
          sub={reply?.read?.columns?.under18
            ? `${plural(added.filter((s) => s.under18).length, 'student')} of these ${stage === 'done' ? 'marked' : 'would be marked'} under 18, from the file.`
            : undefined}
        >
          {added.map((s) => (
            <Row key={`${s.line}:${s.rollNo}`} line={s.line} roll={s.rollNo} name={s.name}>
              {s.under18 && <Under18 />}
            </Row>
          ))}
        </Group>
      )}
      <Refusals reply={reply} canRestore={canRestore} restoring={busy && !['read', 'check', 'import'].includes(busy) ? busy : null} restored={restored} onRestore={onRestore} />
    </div>
  );
}

/* ---------------------------------------------------------- the container */

export default function RosterImport({
  classId, open, onOpenChange, onDone,
  send = api.importRoster, restore = api.updateStudent, start,
}) {
  const [how, setHow] = useState('file');
  const [file, setFile] = useState(null);      // { name, size }
  const [fileText, setFileText] = useState(''); // the file's text: sent, never shown
  const [text, setText] = useState('');
  const [stage, setStage] = useState('choose');
  const [reply, setReply] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);
  const [restored, setRestored] = useState({});
  const startRef = useRef(start);
  startRef.current = start;

  // Every opening starts clean; closing drops the text with everything else.
  useEffect(() => {
    const s = open ? startRef.current : null;
    setHow(s?.how ?? 'file');
    setFile(s?.file ?? null);
    setFileText(s?.fileText ?? '');
    setText(s?.text ?? '');
    setStage(s?.stage ?? 'choose');
    setReply(s?.reply ?? null);
    setError(s?.error ?? '');
    setNotice('');
    setBusy(null);
    setRestored({});
  }, [open]);

  const csv = how === 'file' ? fileText : text;

  async function pick(f) {
    setError('');
    if (!looksLikeText(f)) {
      setFile(null);
      setFileText('');
      setError('That is not a CSV file. In the spreadsheet, save the class list as CSV (comma-separated), then choose that file.');
      return;
    }
    setBusy('read');
    try {
      const t = await f.text();
      setFile({ name: f.name, size: f.size });
      setFileText(t);
    } catch {
      setFile(null);
      setFileText('');
      setError('This browser could not read that file. Choose it again, or paste its text instead.');
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy('check');
    setError('');
    try {
      const res = await send(classId, csv, true);
      setReply(res);
      setStage('checked');
    } catch (err) {
      setError(err.message || 'The server refused the file.');
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setBusy('import');
    setError('');
    setNotice('');
    try {
      const res = await send(classId, csv, false);
      setReply(res);
      setStage('done');
      setRestored({});
      onDone?.(res);
    } catch (err) {
      setError(err.message || 'The server refused the import.');
    } finally {
      setBusy(null);
    }
  }

  async function putBack(student) {
    setBusy(student.id);
    setError('');
    setNotice('');
    try {
      await restore(classId, student.id, { active: true });
      setRestored((r) => ({ ...r, [student.id]: true }));
      setNotice(`${student.rollNo} ${student.name} is back on the roster.`);
      onDone?.();
      // Before the import, read the dry run again: that row is now on the roster.
      if (stage === 'checked') {
        const res = await send(classId, csv, true);
        setReply(res);
      }
    } catch (err) {
      setError(err.message || 'That student could not be put back.');
    } finally {
      setBusy(null);
    }
  }

  const again = () => {
    setStage('choose');
    setReply(null);
    setError('');
    setNotice('');
    setRestored({});
  };

  const n = list(reply?.wouldAdd).length;
  const working = busy != null;
  const title = stage === 'done' ? 'Imported' : stage === 'checked' ? 'Before anything is added' : 'Import a class list';
  const description = stage === 'done'
    ? 'What the import did with every row of the file.'
    : stage === 'checked'
      ? reply?.message || 'Nothing has been added yet. This is what the import would do with every row.'
      : 'A CSV of roll numbers and names from a spreadsheet. You see what it would do before anything is added.';

  const footer = stage === 'choose' ? (
    <div className="ac-acts">
      <Button variant="ghost" disabled={working} onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button variant="primary" icon="checklist" busy={busy === 'check'} disabled={working || !csv.trim()} onClick={check}>
        Check the file
      </Button>
    </div>
  ) : stage === 'checked' ? (
    <div className="ac-acts">
      <Button variant="ghost" icon="back" disabled={working} onClick={again}>Choose another</Button>
      <Button variant="primary" icon="invite" busy={busy === 'import'} disabled={working || n === 0} onClick={run}>
        {n ? `Add ${plural(n, 'student')}` : 'Nothing to add'}
      </Button>
    </div>
  ) : (
    <div className="ac-acts">
      <Button disabled={working} onClick={() => { again(); setFile(null); setFileText(''); setText(''); }}>Import another</Button>
      <Button variant="primary" disabled={working} onClick={() => onOpenChange(false)}>Done</Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} locked={working} wide title={title} description={description} footer={footer}>
      <ImportBody
        stage={stage}
        how={how}
        onHow={(v) => { setHow(v); setError(''); }}
        file={file}
        onFile={pick}
        text={text}
        onText={setText}
        reply={reply}
        error={error}
        notice={notice}
        busy={busy}
        restored={restored}
        onRestore={putBack}
      />
    </Dialog>
  );
}
