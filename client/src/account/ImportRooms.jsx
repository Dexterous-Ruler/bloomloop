/**
 * Rooms run in laptop mode, brought into the cloud (Phase 7, decision O4).
 *
 * Laptop mode saves each room as one .json file in a folder on the laptop.
 * Back online, the professor chooses one or more of those files here. Each is
 * read in this browser and sent on its own, one at a time:
 *
 *   POST /api/imports/rooms { archive, contentId?, classId? }
 *     201  imported: a closed room the professor owns; `message` and
 *          `import.summary.sentences` say what came across and what did not
 *     200  alreadyImported: that room came in before and nothing changed
 *          (the message adds a sentence when this file differs from it)
 *     400  the laptop's chapter (sent without one) or class (sent with a
 *          chapter) is not in this account: the professor chooses one and it is
 *          sent again. The reply has no `needs`; what was sent tells them apart
 *     4xx  refused, with the server's sentence; nothing was imported
 *
 * Opened from the rooms list. An HOD imports nothing (the server says 403) and
 * is not offered this.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api.js';
import { forgetImportedRooms } from '../teach/imported.jsx';
import { Button, Dialog, Field, Icon, Note } from '../ui/index.jsx';
import { dateOf, plural, roomLink, sizeOf } from './dashParts.jsx';

const list = (v) => (Array.isArray(v) ? v : []);

const STATE = {
  reading: { label: 'Reading the file', tone: '' },
  unreadable: { label: 'Not sent', tone: 'bad', icon: 'alert' },
  waiting: { label: 'Waiting to send', tone: '' },
  sending: { label: 'Sending', tone: '' },
  needs: { label: 'Needs your choice', tone: 'ask', icon: 'help' },
  imported: { label: 'Imported', tone: 'ok', icon: 'ok' },
  already: { label: 'Already imported', tone: '', icon: 'history' },
  refused: { label: 'Not imported', tone: 'bad', icon: 'alert' },
};

/** What the file says about its room, before anything is sent. */
function factsOf(archive) {
  const room = archive?.room ?? {};
  const counts = archive?.counts ?? {};
  return {
    code: typeof room.code === 'string' ? room.code : '',
    title: typeof room.title === 'string' ? room.title : '',
    startedAt: room.startedAt ?? null,
    running: room.status && room.status !== 'closed',
    students: Number.isFinite(counts.students) ? counts.students : null,
    answers: Number.isFinite(counts.answers) ? counts.answers : null,
    run: archive?.laptop?.run ?? null,
  };
}

function factLine(f) {
  return [
    f.startedAt ? `Opened ${dateOf(f.startedAt)}` : null,
    f.students !== null ? plural(f.students, 'student') : null,
    f.answers !== null ? plural(f.answers, 'answer') : null,
    f.run ? `laptop run ${f.run}` : null,
    f.running ? 'saved while still running' : null,
  ].filter(Boolean).join(' · ');
}

/* ---------------------------------------------------------------- one file */

function Chooser({ file, chapters, classes, onChoose, onSend }) {
  const wantsClass = file.needs === 'class';
  const source = wantsClass ? classes : chapters;
  const value = wantsClass ? file.classId : file.contentId;
  const id = `im-choose-${file.key}`;
  const options = list(source?.list);
  const chapterTitle = list(chapters?.list).find((c) => c.id === file.contentId)?.title;

  return (
    <div className="im-choose">
      <Field
        label={wantsClass ? 'The class this room took attendance for' : 'The chapter this room’s questions belong to'}
        htmlFor={id}
        hint={wantsClass && chapterTitle ? `Chapter: ${chapterTitle}.` : undefined}
      >
        <select
          id={id}
          className="select"
          value={value || ''}
          disabled={source?.status !== 'ready' || !options.length}
          onChange={(e) => onChoose(file.key, wantsClass ? { classId: e.target.value } : { contentId: e.target.value })}
        >
          <option value="">{source?.status === 'loading' ? 'Reading…' : wantsClass ? 'Choose a class' : 'Choose a chapter'}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
      </Field>
      {source?.status === 'error' && <Note tone="bad">{wantsClass ? 'Your classes' : 'Your chapters'} did not load: {source.error}</Note>}
      {source?.status === 'ready' && !options.length && (
        <Note>
          {wantsClass
            ? 'You have no class to import it into yet. Make the class on the Classes screen, then come back.'
            : 'You have no chapter to import it into yet. Read the chapter in the console first, then come back.'}
        </Note>
      )}
      <div className="im-choose-acts">
        <Button variant="primary" size="sm" icon="upload" disabled={!value} onClick={() => onSend(file.key)}>
          {wantsClass ? 'Import into this class' : 'Import into this chapter'}
        </Button>
      </div>
    </div>
  );
}

function FileCard({ file, chapters, classes, onChoose, onSend, onRemove }) {
  const st = STATE[file.state] ?? STATE.waiting;
  const f = file.facts;
  const label = file.state === 'needs' ? (file.needs === 'class' ? 'Choose a class' : 'Choose a chapter') : st.label;
  const busy = file.state === 'sending' || file.state === 'reading';
  const canRetry = file.state === 'refused' && (!file.status || file.status >= 500);

  return (
    <li className="im-file" data-state={file.state} aria-busy={busy || undefined}>
      <div className="im-file-top">
        <div className="im-file-main">
          <span className="im-file-name">{file.name}{file.size ? ` · ${sizeOf(file.size)}` : ''}</span>
          {f && (f.code || f.title) && (
            <span className="im-file-t">
              {f.code && <span className="mono">{f.code}</span>}
              <span className="clip">{f.title || 'Untitled room'}</span>
            </span>
          )}
          {f && factLine(f) && <span className="im-file-facts">{factLine(f)}</span>}
        </div>
        <span className="im-state" data-tone={st.tone} role="status">
          {busy ? <span className="spinner" style={{ width: 10, height: 10 }} /> : st.icon && <Icon name={st.icon} size={13} />}
          {label}
        </span>
        {!busy && (
          <Button variant="ghost" size="sm" icon="close" aria-label={`Take ${file.name} off this list`} onClick={() => onRemove(file.key)} />
        )}
      </div>

      {file.message && <p className="im-file-msg" role={file.state === 'refused' || file.state === 'unreadable' ? 'alert' : undefined}>{file.message}</p>}
      {list(file.sentences).length > 0 && (
        <ul className="im-sentences">{file.sentences.map((s) => <li key={s}>{s}</li>)}</ul>
      )}
      {file.state === 'needs' && (
        <Chooser file={file} chapters={chapters} classes={classes} onChoose={onChoose} onSend={onSend} />
      )}
      {(file.state === 'imported' || canRetry) && (
        <div className="im-file-acts">
          {file.state === 'imported' && file.room?.code && (
            <Link className="btn btn-sm" to={roomLink(file.room.code, 'live')}><Icon name="live" />Open room {file.room.code}</Link>
          )}
          {canRetry && <Button size="sm" icon="refresh" onClick={() => onSend(file.key)}>Try again</Button>}
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- the view */

/**
 * @param files     [{ key, name, size, facts, state, needs, contentId, classId, message, sentences, room, status }]
 * @param chapters  { status: 'idle'|'loading'|'ready'|'error', list: [{ id, title }], error }
 * @param classes   the same, for the classes
 * @param past      { status, list: GET /api/imports/rooms `imports`, error }
 * @param onFiles   (FileList) => void
 */
export function ImportRoomsView({
  open, onOpenChange, files, chapters, classes, past, onFiles, onChoose, onSend, onRemove, onClearDone,
}) {
  const input = useRef(null);
  const [drag, setDrag] = useState(false);
  const sending = files.some((f) => f.state === 'sending' || f.state === 'reading');
  const done = files.filter((f) => ['imported', 'already', 'refused', 'unreadable'].includes(f.state)).length;
  const imports = list(past?.list);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      sheet
      title="Import rooms from a laptop"
      description="Each room laptop mode ran is a .json file in the folder the laptop printed. Each one you choose comes in as a closed room of yours."
      footer={(
        <div className="ac-acts">
          {done > 0 && <Button variant="ghost" disabled={sending} onClick={onClearDone}>Clear finished</Button>}
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      )}
    >
      <div className="im-sheet">
        <div
          className="im-pick"
          data-drag={drag || undefined}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files); }}
        >
          <span className="im-pick-ic" aria-hidden="true"><Icon name="fileUp" size={18} /></span>
          <span className="im-pick-say">
            <b>Choose room files</b>
            One or more, or drop them here. They are read in this browser and sent one at a time.
          </span>
          <input
            ref={input}
            id="im-files"
            type="file"
            accept=".json,application/json"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }}
          />
          <Button icon="upload" onClick={() => input.current?.click()}>Choose files</Button>
        </div>

        {files.length > 0 && (
          <ul className="im-files" aria-label="Room files">
            {files.map((f) => (
              <FileCard key={f.key} file={f} chapters={chapters} classes={classes} onChoose={onChoose} onSend={onSend} onRemove={onRemove} />
            ))}
          </ul>
        )}

        <p className="said">
          An imported room is never presented as one this server ran: every screen and report that shows it says it came
          from a laptop, and attainment reports can leave such rooms out. Importing the same file again changes nothing.
        </p>

        <section className="im-past" aria-labelledby="im-past-h">
          <h3 id="im-past-h">Imported before</h3>
          {past?.status === 'error' ? (
            <Note tone="bad">The imports did not load: {past.error}</Note>
          ) : past?.status !== 'ready' ? (
            <div className="stack stack-2" aria-busy="true">
              <div className="skel" style={{ height: 14, width: '70%' }} />
              <div className="skel" style={{ height: 14, width: '55%' }} />
            </div>
          ) : imports.length === 0 ? (
            <p className="t-small muted">Nothing imported yet.</p>
          ) : (
            <ul>
              {imports.slice(0, 8).map((im) => {
                const s = im.summary ?? {};
                return (
                  <li key={im.id}>
                    <span className="mono">{im.room?.code}</span>
                    <span>Imported {dateOf(im.importedAt)}</span>
                    {im.laptop?.run && <span>laptop run <span className="mono">{im.laptop.run}</span></span>}
                    {Number.isFinite(s.students) && <span>{plural(s.students, 'student')}, {plural(s.answers ?? 0, 'answer')}</span>}
                  </li>
                );
              })}
              {imports.length > 8 && <li>and {imports.length - 8} more</li>}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------- the container */

let seq = 0;

/** Read once, when first needed. */
function useChoices(read) {
  const [s, setS] = useState({ status: 'idle', list: [], error: '' });
  const load = useCallback(() => {
    setS((p) => (p.status === 'ready' || p.status === 'loading' ? p : { ...p, status: 'loading', error: '' }));
    read().then(
      (rows) => setS({ status: 'ready', list: rows, error: '' }),
      (err) => setS({ status: 'error', list: [], error: err.message }),
    );
  }, [read]);
  return [s, load];
}

const readChapters = async () => list((await api.listContents())?.contents)
  .map((c) => ({ id: String(c._id ?? c.id), title: c.title || 'Untitled chapter' }));
const readClasses = async () => list((await api.listClasses())?.classes)
  .filter((c) => c.canEdit !== false)
  .map((c) => ({
    id: String(c.id ?? c._id),
    title: [c.courseName, c.section, c.termLabel].filter(Boolean).join(' · ') || 'Untitled class',
  }));

export default function ImportRooms({ open, onOpenChange, onImported }) {
  const [files, setFiles] = useState([]);
  const [chapters, loadChapters] = useChoices(readChapters);
  const [classes, loadClasses] = useChoices(readClasses);
  const [past, setPast] = useState({ status: 'idle', list: [], error: '' });
  const sendingRef = useRef(null);
  // Moves when a send ends, so the next waiting file goes even when nothing else changed.
  const [ended, setEnded] = useState(0);

  const patch = (key, p) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...p } : f)));

  const loadPast = useCallback(() => {
    setPast((p) => ({ ...p, status: p.status === 'ready' ? 'ready' : 'loading', error: '' }));
    api.roomImports().then(
      (res) => setPast({ status: 'ready', list: list(res?.imports), error: '' }),
      (err) => setPast({ status: 'error', list: [], error: err.message }),
    );
  }, []);

  useEffect(() => { if (open) loadPast(); }, [open, loadPast]);

  // Each chosen file, read here. Nothing is sent from a file that is not JSON.
  const onFiles = (chosen) => {
    for (const file of Array.from(chosen)) {
      const key = `f${++seq}`;
      setFiles((fs) => [...fs, { key, name: file.name, size: file.size, state: 'reading' }]);
      file.text().then((raw) => {
        let archive;
        try { archive = JSON.parse(raw); } catch { archive = undefined; }
        if (!archive || typeof archive !== 'object' || Array.isArray(archive)) {
          patch(key, {
            state: 'unreadable',
            message: `${file.name} is not readable JSON, so it was not sent. Choose the .json file laptop mode saved for the room. Nothing was imported.`,
          });
          return;
        }
        patch(key, { state: 'waiting', archive, facts: factsOf(archive) });
      }, (err) => patch(key, { state: 'unreadable', message: `${file.name} could not be read here: ${err.message}. Nothing was imported.` }));
    }
  };

  const send = useCallback(async (file) => {
    sendingRef.current = file.key;
    patch(file.key, { state: 'sending', message: '' });
    try {
      const res = await api.importRoom({ archive: file.archive, contentId: file.contentId || undefined, classId: file.classId || undefined });
      if (res?.alreadyImported) {
        patch(file.key, { state: 'already', message: res.message || 'This room was imported before, so nothing was changed.', same: res.same });
      } else {
        patch(file.key, {
          state: 'imported',
          message: res?.message ?? '',
          sentences: list(res?.import?.summary?.sentences),
          room: res?.room ?? null,
          archive: null,
        });
        forgetImportedRooms();
        onImported?.(res);
      }
      loadPast();
    } catch (err) {
      // The reply carries `error` alone (docs/API.md, "Room imports"): the two
      // 400s that ask for a choice are told apart by what was sent. Sent
      // without a chapter, it is the chapter; with one, the class. A 400 about
      // the file itself comes first on the server and says "This file" or
      // "Choose the room file"; it asks for nothing.
      const aboutFile = /^(This file|Choose the room file)/i.test(String(err.message ?? '').trim());
      const needs = err.body?.needs ?? (err.status === 400 && !aboutFile ? (file.contentId ? 'class' : 'chapter') : null);
      if (needs === 'chapter' || needs === 'class') {
        patch(file.key, { state: 'needs', needs, message: err.message });
        loadChapters();
        if (needs === 'class') loadClasses();
      } else {
        patch(file.key, { state: 'refused', message: err.message || 'The server refused this file. Nothing was imported.', status: err.status ?? 0 });
      }
    } finally {
      sendingRef.current = null;
      setEnded((n) => n + 1);
    }
  }, [loadChapters, loadClasses, loadPast, onImported]);

  // One at a time: the next waiting file goes once nothing is in flight.
  useEffect(() => {
    if (sendingRef.current) return;
    const next = files.find((f) => f.state === 'waiting');
    if (next) send(next);
  }, [files, send, ended]);

  return (
    <ImportRoomsView
      open={open}
      onOpenChange={onOpenChange}
      files={files}
      chapters={chapters}
      classes={classes}
      past={past}
      onFiles={onFiles}
      onChoose={(key, p) => patch(key, p)}
      onSend={(key) => patch(key, { state: 'waiting' })}
      onRemove={(key) => setFiles((fs) => fs.filter((f) => f.key !== key))}
      onClearDone={() => setFiles((fs) => fs.filter((f) => !['imported', 'already', 'refused', 'unreadable'].includes(f.state)))}
    />
  );
}
