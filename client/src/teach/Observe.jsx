/**
 * Observations: four private marks and a short note, per student, for the
 * room's day.
 *
 * Built to go down a roster of forty on a laptop: one row per student, the
 * four marks as toggles (press the lit one again to clear it), the keys 1 to 4
 * on a focused row and the arrow keys to move between rows. A mark lands at
 * once and is put right if the server refuses it.
 *
 * One mark per student per day: in a class room the day's mark is the class's,
 * so a mark set in another of its rooms today shows here, with that room's
 * code. Every set and clear is kept, and the day's log is one press away.
 *
 * Staff only. The counts are counted apart from everything else and are never
 * put beside accuracy.
 *
 * In a class room the room's attendance is read beside it (read only: marks
 * are made in Attendance), so each row says whether the student is here. An
 * absent student's row is dimmed and says so in its name for a screen reader.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Chip, Empty, Icon, Note, Segmented } from '../ui/index.jsx';
import { Privacy, ReadFailed, clock } from './Wheel.jsx';

const MAX_NOTE = 280;
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayLabel = (day) => {
  const at = new Date(`${day}T00:00:00Z`);
  return day && !Number.isNaN(at.getTime()) ? DAY.format(at) : day ?? '';
};

export const keyOf = (s) => (s.studentId ? `s:${s.studentId}` : `r:${s.rollNo}`);

/** The attendance read's four states, in its own words. */
const ATTENDED = { present: 'Present', late: 'Late', absent: 'Absent', unmarked: 'Unmarked' };

/**
 * Each student's mark from the attendance read, by roster id (any case) and
 * by roll number. Null when there is nothing to show: no read, or nobody
 * marked yet (a column of "Unmarked" says nothing a header line does not).
 */
function attendanceBy(attendance) {
  const all = [...(attendance?.students ?? []), ...(attendance?.removed ?? [])];
  if (!all.some((s) => s.status && s.status !== 'unmarked')) return null;
  const by = new Map();
  for (const s of all) {
    if (s.studentId) by.set(`s:${String(s.studentId).toLowerCase()}`, s.status);
    if (s.rollNo) by.set(`r:${s.rollNo}`, s.status);
  }
  return (student) => by.get(`s:${String(student.studentId ?? '').toLowerCase()}`) ?? by.get(`r:${student.rollNo}`) ?? null;
}

/* ------------------------------------------------------------- one row */

function NotePanel({ student, kinds, code, canControl, state, onNote, onClose }) {
  const [text, setText] = useState(student.current?.note ?? '');
  const marked = Boolean(student.current?.kind);
  const saved = (student.current?.note ?? '') === text.trim();
  const id = `rc-note-${keyOf(student)}`;

  async function save(e) {
    e.preventDefault();
    if (!marked || saved) return;
    if (await onNote(student, text.trim())) onClose();
  }

  return (
    <div className="rc-ob-more">
      {canControl ? (
        <form className="rc-ob-noteform" onSubmit={save}>
          <label className="label" htmlFor={id}>Note</label>
          <textarea
            id={id}
            className="textarea rc-ob-text"
            rows={2}
            maxLength={MAX_NOTE}
            value={text}
            disabled={!marked || state?.busy}
            placeholder={marked ? 'What you saw today, in a line' : ''}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="rc-ob-noterow">
            <span className="t-meta">
              {marked ? <>A note goes with the mark. <span className="mono">{text.length} / {MAX_NOTE}</span></> : 'Set a mark first: a note goes with a mark.'}
            </span>
            <span className="cluster">
              <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
              <Button size="sm" variant="primary" type="submit" busy={state?.busy} disabled={!marked || saved}>Save note</Button>
            </span>
          </div>
        </form>
      ) : (
        student.current?.note && <p className="rc-ob-said">{student.current.note}</p>
      )}
      {state?.error && <Note tone="bad" role="alert">{state.error}</Note>}
      {student.history?.length > 0 && (
        <div className="rc-ob-log">
          <h4 className="eyebrow">Today’s log</h4>
          <ol>
            {student.history.map((h) => (
              <li key={h.id}>
                <time className="mono">{clock(h.observedAt)}</time>
                <span>
                  <b>{h.kind ? h.label ?? kinds.find((k) => k.id === h.kind)?.label : 'Cleared'}</b>
                  {h.note && <> · {h.note}</>}
                  {h.room && h.room !== code && <span className="t-meta"> · in room <span className="mono">{h.room}</span></span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Row({ student, index, kinds, code, canControl, state, open, onToggleOpen, onMark, onNote, onKeys, att }) {
  const cur = student.current;
  const inactive = student.active === false;
  const elsewhere = cur?.room && cur.room !== code;
  const name = student.name || student.rollNo;
  const here = att ? `, ${ATTENDED[att]?.toLowerCase() ?? att}` : '';

  return (
    <li
      className="rc-ob"
      data-row={index}
      data-open={open ? 'true' : undefined}
      data-inactive={inactive ? 'true' : undefined}
      data-absent={att === 'absent' ? 'true' : undefined}
    >
      <span className="rc-ob-roll mono">{student.rollNo}</span>
      <span className="rc-ob-who">
        <span className="clip">{student.name || <span className="muted">No name</span>}</span>
        {inactive && <Chip className="rc-mini chip-line">Removed</Chip>}
        {elsewhere && <span className="t-meta">set in <span className="mono">{cur.room}</span></span>}
        {cur?.note && !open && <span className="rc-ob-peek clip">{cur.note}</span>}
        {att && <span className="rc-ob-att" data-status={att}><i aria-hidden="true" />{ATTENDED[att] ?? att}</span>}
      </span>

      {canControl && !inactive ? (
        // Never disabled while a mark is saving: a disabled button drops the keyboard's focus.
        <div className="rc-marks" role="group" aria-label={`Mark for ${name}${here}`} onKeyDown={(e) => onKeys(e, student, index, state?.busy)}>
          {kinds.map((k, i) => (
            <button
              key={k.id}
              type="button"
              className="rc-mk"
              data-col={i}
              aria-pressed={cur?.kind === k.id}
              aria-disabled={state?.busy || undefined}
              title={`${k.label} (${i + 1})`}
              onClick={() => !state?.busy && onMark(student, cur?.kind === k.id ? null : k.id)}
            >
              {cur?.kind === k.id && <Icon name="check" size={12} />}
              {k.label}
            </button>
          ))}
        </div>
      ) : (
        <span className={`rc-ob-read${cur ? '' : ' is-none'}`}>{cur ? cur.label : 'Not marked'}</span>
      )}

      <button
        type="button"
        className="rc-ob-notebtn"
        aria-expanded={open}
        aria-label={`${cur?.note ? 'Note' : 'Add a note'} for ${name}${here}${student.history?.length ? `, and today’s log` : ''}`}
        onClick={onToggleOpen}
        disabled={!canControl && !cur?.note && !student.history?.length}
      >
        <Icon name="note" size={14} />
        <span>{cur?.note ? 'Note' : canControl && !inactive ? 'Add note' : 'Log'}</span>
      </button>

      {state?.error && !open && <p className="rc-ob-err" role="alert"><Icon name="alert" size={13} />{state.error}</p>}
      {open && (
        <NotePanel
          student={student}
          kinds={kinds}
          code={code}
          canControl={canControl && !inactive}
          state={state}
          onNote={onNote}
          onClose={onToggleOpen}
        />
      )}
    </li>
  );
}

/* ------------------------------------------------------------- the view */

function ObserveSkeleton() {
  return (
    <section className="card rc-obs" aria-busy="true" aria-label="Reading today’s observations">
      <div className="rc-card-h"><span className="skel" style={{ height: 20, width: 220 }} /></div>
      <div className="rc-ob-list">
        {Array.from({ length: 6 }, (_, i) => <span key={i} className="skel" style={{ height: 36, margin: '6px 0' }} />)}
      </div>
    </section>
  );
}

/** The roster with its marks, from the observations read. Pure, for the gallery. */
export function ObserveView({ data, load, code, canControl, rowState = {}, onMark, onNote, onRetry, initialOpen = null, attendance = null }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(initialOpen);
  const list = useRef(null);

  const kinds = data?.kinds ?? [];
  const students = data?.students ?? [];
  const counts = data?.counts ?? {};
  const attOf = useMemo(() => attendanceBy(attendance), [attendance]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      if (q && !String(s.rollNo).toLowerCase().includes(q) && !String(s.name ?? '').toLowerCase().includes(q)) return false;
      if (filter === 'none') return !s.current;
      if (filter !== 'all') return s.current?.kind === filter;
      return true;
    });
  }, [students, query, filter]);

  if (load?.status === 'error') return <ReadFailed message={load.error} onRetry={onRetry} />;
  if (!data) return <ObserveSkeleton />;

  // 1 to 4 set a mark on the focused row; up and down move to the same mark a row away.
  function onKeys(e, student, index, busy) {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= kinds.length) {
      e.preventDefault();
      if (busy) return;
      const k = kinds[n - 1].id;
      onMark(student, student.current?.kind === k ? null : k);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const col = e.target.closest('[data-col]')?.dataset.col ?? '0';
    const rows = [...(list.current?.querySelectorAll('.rc-ob') ?? [])];
    const at = rows.findIndex((r) => r.dataset.row === String(index));
    for (let i = at + (e.key === 'ArrowDown' ? 1 : -1); i >= 0 && i < rows.length; i += e.key === 'ArrowDown' ? 1 : -1) {
      const btn = rows[i].querySelector(`.rc-mk[data-col="${col}"]`);
      if (btn) { e.preventDefault(); btn.focus(); return; }
    }
  }

  const active = counts.students ?? students.filter((s) => s.active !== false).length;
  const options = [
    { id: 'all', label: 'Everyone', count: active },
    { id: 'none', label: 'Not marked', count: Math.max(0, active - (counts.observed ?? 0)) },
    ...kinds.map((k) => ({ id: k.id, label: k.label, count: counts[k.id] ?? 0 })),
  ];

  return (
    <div className="rc-obs-wrap">
      <section className="card rc-obs" aria-labelledby="rc-obs-h">
        <header className="rc-card-h rc-obs-h">
          <div className="sec">
            <h2 id="rc-obs-h">{dayLabel(data.day)}</h2>
            <p>
              {data.class ? `${data.class.courseName} ${data.class.section}` : 'The phones that joined this room'}.
              {' '}One mark per student for the day{data.class ? ', shared by every room of the class today' : ''}.
            </p>
            {attendance && (
              <p className="rc-ob-attline">
                <Icon name="attendance" size={14} />
                {attendance.error
                  ? <span>Attendance could not be read: {attendance.error}</span>
                  : <span>Attendance: {attendance.summary}.{attOf ? '' : ' Nobody is marked yet.'}</span>}
              </p>
            )}
          </div>
          <dl className="rc-ob-figs" aria-label="Counted for today">
            <div><dt>Observed</dt><dd><b className="mono">{counts.observed ?? 0}</b> of {active}</dd></div>
            {kinds.map((k) => <div key={k.id}><dt>{k.label}</dt><dd><b className="mono">{counts[k.id] ?? 0}</b></dd></div>)}
          </dl>
        </header>

        {students.length === 0 ? (
          <Empty icon="users" title="Nobody to observe yet">
            {data.class ? 'The class has nobody on its roster.' : 'No phone has joined this room, and it was opened for no class.'}
          </Empty>
        ) : (
          <>
            <div className="rc-ob-tools">
              <label className="search rc-ob-search">
                <Icon name="search" size={14} />
                <input type="search" placeholder="Roll number or name" aria-label="Find a student" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <Segmented label="Show" value={filter} onChange={setFilter} options={options} />
            </div>
            {canControl && (
              <p className="rc-keys">
                Press a mark again to clear it. On a focused row, <span className="kbd">1</span> to <span className="kbd">4</span> set a mark,
                {' '}<span className="kbd">↑</span> <span className="kbd">↓</span> move between students.
              </p>
            )}
            {shown.length === 0 ? (
              <p className="rc-quiet">Nobody matches. <button type="button" className="link rc-linkbtn" onClick={() => { setQuery(''); setFilter('all'); }}>Show everyone</button></p>
            ) : (
              <ul className="rc-ob-list" ref={list}>
                {shown.map((s, i) => (
                  <Row
                    key={keyOf(s)}
                    student={s}
                    index={i}
                    kinds={kinds}
                    code={code}
                    canControl={canControl}
                    state={rowState[keyOf(s)]}
                    open={open === keyOf(s)}
                    onToggleOpen={() => setOpen((o) => (o === keyOf(s) ? null : keyOf(s)))}
                    onMark={onMark}
                    onNote={onNote}
                    onKeys={onKeys}
                    att={attOf?.(s) ?? null}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <Privacy text={data.privacy}>A mark describes today, not the student.</Privacy>
    </div>
  );
}

/* ------------------------------------------------------------- the screen */

export default function Observe({ code, canControl, signal, classRoom }) {
  const [data, setData] = useState(null);
  const [load, setLoad] = useState({ status: 'loading', error: '' });
  const [rowState, setRowState] = useState({});
  const [attendance, setAttendance] = useState(null);
  const inflight = useRef(0);

  const read = useCallback(async () => {
    try {
      setData(await api.observations(code));
      setLoad({ status: 'ready', error: '' });
    } catch (err) {
      setLoad({ status: 'error', error: err.message });
    }
  }, [code]);

  // Attendance, read only and beside the roster. A room opened for no class
  // has none (the read is a 409), so it is not asked.
  const readAttendance = useCallback(async () => {
    if (!classRoom) return;
    try {
      setAttendance(await api.attendance(code));
    } catch (err) {
      setAttendance({ error: err.message });
    }
  }, [code, classRoom]);

  useEffect(() => { read(); }, [read, signal]);
  useEffect(() => { readAttendance(); }, [readAttendance, signal]);

  // The counts are the server's. Read them again once no mark is on its way,
  // so the read includes every one of them.
  const recount = useCallback(() => {
    if (inflight.current) return;
    api.observations(code).then((b) => setData((d) => (d ? { ...d, counts: b.counts } : d))).catch(() => {});
  }, [code]);

  const patchRow = (key, fn) => setData((d) => d && { ...d, students: d.students.map((x) => (keyOf(x) === key ? fn(x) : x)) });

  async function send(student, kind, note) {
    const key = keyOf(student);
    const before = student.current;
    const label = data?.kinds?.find((k) => k.id === kind)?.label ?? null;
    patchRow(key, (x) => ({ ...x, current: kind ? { ...(x.current ?? {}), kind, label, note: note ?? '' } : null }));
    setRowState((r) => ({ ...r, [key]: { busy: true, error: '' } }));
    inflight.current += 1;
    try {
      const body = {
        ...(student.studentId ? { studentId: student.studentId } : { rollNo: student.rollNo }),
        kind,
        ...(kind && note ? { note } : {}),
      };
      const reply = await api.observe(code, body);
      patchRow(key, (x) => ({ ...x, current: reply.current, history: reply.history ?? x.history }));
      setRowState((r) => ({ ...r, [key]: { busy: false, error: '' } }));
      return true;
    } catch (err) {
      patchRow(key, (x) => ({ ...x, current: before }));
      setRowState((r) => ({ ...r, [key]: { busy: false, error: err.message } }));
      return false;
    } finally {
      inflight.current -= 1;
      recount();
    }
  }

  return (
    <ObserveView
      data={data}
      load={load}
      code={code}
      canControl={canControl}
      rowState={rowState}
      // A new mark keeps the note already written; a clear carries none.
      onMark={(s, kind) => send(s, kind, kind ? s.current?.note ?? '' : undefined)}
      onNote={(s, note) => send(s, s.current?.kind, note)}
      onRetry={read}
      attendance={attendance}
    />
  );
}
