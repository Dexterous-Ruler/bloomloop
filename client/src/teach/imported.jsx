/**
 * Rooms run in laptop mode and imported later (Phase 7, decision O4).
 *
 * The server checks an imported file for its shape, not that it is unchanged
 * since the laptop saved it, so an imported room is never shown as one this
 * server ran: wherever one appears, its `importedFrom` ({ importedAt,
 * sourceCode, laptop: { run, startedAt }, note }) is said, in the server's
 * own `note`.
 *
 *   <ImportedTag from />          a quiet mark for a row; the note on hover and focus
 *   <ImportedNote from code />    the note in full, for a room's own screen
 *   <ImportedRoomsNote rooms window />   a report's imported rooms, named
 *   <LeaveOutImported value onChange />  "Leave out imported rooms" (imported=leave-out)
 *   useImportedRooms()            code -> importedFrom, from the room list, for
 *                                 screens whose own reply does not say
 *   laptopItems(items, from)      item statistics of an imported room: a question
 *                                 the laptop asked is not "deleted"
 *   useLaptopQuestionIds(contentId)  the same, across a chapter's imported rooms
 *   isKept(answer) / <KeptTag />  an answer kept and not counted (late, over the cap)
 */

import { useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import { Icon, Note, Tip } from '../ui/index.jsx';
import '../styles/imports.css';

const list = (v) => (Array.isArray(v) ? v : []);
const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dayOf = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? DAY.format(d) : ''; };
const SHORT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const SHORT_DAY = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? SHORT.format(d) : ''; };

/** What the item statistics say of a question the laptop asked. */
export const LAPTOP_QUESTION = 'Asked on the laptop, not in this chapter’s bank';

/** " on 19 Nov 2026, laptop run 3fa2c1d0, where it was room K7Q42M" */
function whence(from, code) {
  const day = dayOf(from.importedAt);
  const run = from.laptop?.run;
  const was = from.sourceCode && code && from.sourceCode !== code ? `, where it was room ${from.sourceCode}` : '';
  return `${day ? ` on ${day}` : ''}${run ? `, laptop run ${run}` : ''}${was}`;
}

/** "Imported on 19 Nov 2026, laptop run 3fa2c1d0." */
export function importedLine(from, code) {
  return from ? `Imported${whence(from, code)}.` : '';
}

/**
 * A row's mark: "Imported from a laptop". The note and where it came from on
 * hover and on keyboard focus. `plain` inside something that is itself
 * pressed (a listbox option, a label): no stop of its own, the note as a title.
 */
export function ImportedTag({ from, code, plain = false, long = false, className = '' }) {
  if (!from) return null;
  const said = `${importedLine(from, code)} ${from.note ?? ''}`.trim();
  // `long`: the date and the laptop's run on the mark itself (the rooms list).
  const extra = long ? [SHORT_DAY(from.importedAt), from.laptop?.run ? `run ${from.laptop.run}` : ''].filter(Boolean) : [];
  if (plain) {
    return (
      <span className={`im-tag ${className}`} title={said}>
        <Icon name="laptop" size={12} />
        Imported from a laptop
      </span>
    );
  }
  return (
    <Tip label={said}>
      <span className={`im-tag ${className}`} tabIndex={0} aria-label={`Imported from a laptop. ${said}`}>
        <Icon name="laptop" size={12} />
        Imported from a laptop
        {extra.map((x) => <span key={x} className="im-tag-x">{x}</span>)}
      </span>
    </Tip>
  );
}

/** The note in full, at the top of an imported room's own screen. */
export function ImportedNote({ from, code, className = '' }) {
  if (!from) return null;
  return (
    <Note icon="laptop" className={`im-note ${className}`}>
      <b>Imported from a laptop{whence(from, code)}.</b> {from.note}
    </Note>
  );
}

/**
 * A report's imported rooms, named, with the server's note: or, when the
 * report left them out, that it did. Nothing when neither.
 */
export function ImportedRoomsNote({ rooms, window: w, className = '' }) {
  const imported = list(rooms).filter((r) => r?.importedFrom);
  if (w?.imported === 'leave-out') {
    return (
      <Note icon="laptop" className={`im-note ${className}`}>
        Rooms imported from a laptop are left out of this report.
      </Note>
    );
  }
  if (!imported.length) return null;
  const codes = imported.map((r) => r.code);
  return (
    <Note icon="laptop" className={`im-note ${className}`}>
      <b>
        {codes.length === 1 ? `Room ${codes[0]} was` : `${codes.length} rooms (${codes.join(', ')}) were`} imported from a laptop.
      </b>{' '}
      {imported[0].importedFrom.note} “Leave out imported rooms” above reads the report without {codes.length === 1 ? 'it' : 'them'}.
    </Note>
  );
}

/**
 * The option where a list of rooms is filtered. On a report it sends
 * imported=leave-out; on the rooms list it filters what is shown.
 */
export function LeaveOutImported({ value, onChange, count, className = '' }) {
  return (
    <label className={`im-leave ${className}`}>
      <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange?.(e.target.checked)} />
      <span>Leave out imported rooms{Number(count) > 0 ? <span className="im-leave-n"> {count}</span> : null}</span>
    </label>
  );
}

/* ---------------------------------------------------- which rooms are imported */

// The room list, read once a minute at most for every screen that asks.
const FRESH_MS = 60_000;
let roomsRead = null; // { at, promise }

/** Forget the room list read for useImportedRooms (after an import). */
export function forgetImportedRooms() { roomsRead = null; }

function readRooms() {
  if (!roomsRead || Date.now() - roomsRead.at > FRESH_MS) {
    const promise = api.listSessions().then((res) => list(res?.rooms ?? res));
    roomsRead = { at: Date.now(), promise };
    promise.catch(() => { if (roomsRead?.promise === promise) roomsRead = null; });
  }
  return roomsRead.promise;
}

/**
 * code -> importedFrom for every imported room this viewer may read, from the
 * room list (whose rows carry it). For a screen whose own reply names rooms
 * without saying which were imported. Empty until read, and on a failed read.
 */
export function useImportedRooms(enabled = true) {
  const [map, setMap] = useState(() => new Map());
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    readRooms().then(
      (rows) => { if (alive) setMap(new Map(rows.filter((r) => r.importedFrom).map((r) => [r.code, r.importedFrom]))); },
      () => {},
    );
    return () => { alive = false; };
  }, [enabled]);
  return map;
}

/* ----------------------------------------------------- questions from the laptop */

/**
 * The item report of a room: in an imported room, a question the server lists
 * as no longer in the bank (status 'deleted', approval 'discarded') is one the
 * laptop asked, never in this chapter's bank. It is marked 'laptop' instead,
 * and its provenance no longer says "not in use".
 */
export function laptopItems(items, importedFrom, ids = null) {
  if (!importedFrom && !ids?.size) return list(items);
  return list(items).map((i) => (i?.status === 'deleted' && (importedFrom || ids.has(String(i.questionId))) ? asLaptop(i) : i));
}

function asLaptop(item) {
  const prov = item.provenance;
  return {
    ...item,
    status: 'laptop',
    provenance: prov ? {
      ...prov,
      label: prov.sourceLabel || prov.label,
      sentence: `${String(prov.sentence ?? '').replace(/\s*Not in use:[^.]*\.\s*$/, '')} ${LAPTOP_QUESTION}.`.trim(),
    } : prov,
    levelCheck: null,
  };
}

/**
 * The questions a chapter's imported rooms asked on the laptop, as a Set of
 * question ids, for the chapter's item statistics (which do not say which room
 * a question was asked in). One read of the room list, then one item report
 * per imported room on the chapter; none when the chapter has none.
 */
export function useLaptopQuestionIds(contentId) {
  const [ids, setIds] = useState(() => new Set());
  useEffect(() => {
    setIds(new Set());
    if (!contentId) return undefined;
    let alive = true;
    readRooms()
      .then((rows) => {
        const mine = rows.filter((r) => r.importedFrom && String(r.contentId) === String(contentId));
        return Promise.all(mine.map((r) => api.roomItems(r.code).catch(() => null)));
      })
      .then((reports) => {
        if (!alive) return;
        const out = new Set();
        for (const rep of reports) for (const i of list(rep?.items)) if (i.status === 'deleted') out.add(String(i.questionId));
        setIds(out);
      }, () => {});
    return () => { alive = false; };
  }, [contentId]);
  return ids;
}

/* ------------------------------------------------------ kept, not counted */

/**
 * An answer the server stored and does not count: it arrived after the room
 * closed, after the student had answered every question the room asks, or for
 * a question already marked. It has no mark; its `detail` says why.
 */
export const isKept = (a) => a?.final === false && /kept, not counted\.?$/i.test(String(a?.detail ?? '').trim());

export function KeptTag({ detail, className = '' }) {
  return (
    <span className={`im-kept ${className}`} title={detail || undefined}>
      Kept, not counted
    </span>
  );
}
