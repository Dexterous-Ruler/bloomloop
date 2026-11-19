/**
 * The marks register (Phase 4): the class tab "Marks register". Staff only:
 * nothing here reaches a phone, the projector or the wall.
 *
 * Reads GET /api/classes/:id/register for the rooms the shared ReportWindow
 * chooses: students in the server's order (the roster in roll-number order,
 * then removed students with evidence, then roll numbers not on the roster),
 * never sorted, ranked or numbered by any mark. One column per room, oldest
 * first, then the total.
 *
 * A cell is the room's attendance mark, whether a phone joined, and the
 * counted marks (obtained of possible, and the share) with every evidence type
 * under them, counted or not; a switch shows the same marks by who wrote the
 * question instead (`questionSources`). 0 of 0 (share null) is never a zero: it reads
 * "No answers" beside the attendance mark. A roll number off the roster has no
 * attendance mark (`attendance: null`). Every figure is the server's; this file
 * only words them. Teacher records are not part of the register and are not
 * shown here.
 *
 * The CSV and the printable page are the same request with `format`, fetched
 * with this browser's credentials (api.downloadCsv, api.openReport), so a file
 * always matches the screen that offered it.
 *
 *   <Register classId />        the tab: fetches, and draws RegisterView
 *   <RegisterView ... />        pure: the dev gallery draws every state from it
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Empty, Icon, Note, Panel, Segmented } from '../ui/index.jsx';
import ReportWindow, { NO_WINDOW, windowParams } from './ReportWindow.jsx';

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A mark as the server gives it (already cut to 3 decimals). */
const mark = (v) => (num(v) === null ? '0' : String(Number(v)));
/**
 * A share as a percentage, null staying null. The server cuts it to 4 decimals,
 * rounded down (0.5999); this moves the point two places on whole numbers, so
 * it can never print 59.99 as 60.
 */
const pct = (share) => (num(share) === null ? null : `${Math.round(share * 10000) / 100}%`);

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
/** "2026-11-19" (the day a room opened, in India's time) as "19 Nov", without a time-zone shift. */
const dayOf = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  return m ? DAY.format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : '';
};
const dateOf = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? DATE.format(d) : ''; };

const ATTENDANCE = { present: 'Present', late: 'Late', absent: 'Absent', unmarked: 'Unmarked' };
const ATT_ORDER = ['present', 'late', 'absent', 'unmarked'];
const ROOM_STATUS = { waiting: 'Waiting', open: 'Open', paused: 'Paused' };

// Short names for a crowded cell. The full name and what each means are in
// "How this register was made", from the server's own evidenceTypes. A
// re-vote after a class discussion (Phase 5) is never counted, by any formula.
const TYPE_ORDER = ['digital', 'humanReviewed', 'aiProvisional', 'revote'];
const NEVER = new Set(['revote']);
const TYPE_SHORT = { digital: 'Digital', humanReviewed: 'Reviewed', aiProvisional: 'Provisional', revote: 'Re-vote' };
const TYPE_LABEL = { digital: 'Digital answers', humanReviewed: 'Reviewed by a professor', aiProvisional: 'Provisional machine marks', revote: 'Re-votes after discussion' };
// Who wrote the question: the second split every figure carries. Labels are the
// server's (`questionSources`), shortened in a cell to what comes before
// " questions"; the fallback is used only when the reply carries none.
const SOURCE_ORDER = ['aiGenerated', 'professorWritten', 'offlineTemplate'];
const SOURCE_LABEL = { aiGenerated: 'AI-generated questions', professorWritten: 'Professor-written questions', offlineTemplate: 'Offline-template questions' };
const shortSource = (label) => String(label).replace(/\s+questions\b.*$/i, '');

// The server's definitions, by key, under a heading a professor reads.
const DEFINITION_TITLE = {
  cell: 'A cell',
  absent: 'No answers',
  order: 'Order',
  rooms: 'Rooms',
  rolls: 'Roll numbers',
  questionSources: 'Who wrote the question',
};

/* ------------------------------------------------------------------ pieces */

/** An attendance mark in words, with a shape that does not lean on colour (as on the room's attendance). */
function AttMark({ status }) {
  if (!status) return null;
  return (
    <span className="rg-att" data-att={status}>
      <i aria-hidden="true" />
      {ATTENDANCE[status] ?? status}
    </span>
  );
}

function Joined() {
  return (
    <span className="rg-joined" title="A phone joined with this roll number">
      <Icon name="wifi" size={12} />
      <span className="sr-only">joined on a phone</span>
    </span>
  );
}

/** Each evidence type with answers, counted or not, and polls as a number. */
function Split({ marks }) {
  const parts = TYPE_ORDER
    .filter((t) => (marks?.[t]?.answers ?? 0) > 0)
    .map((t) => {
      const m = marks[t];
      return (
        <span key={t} data-counted={m.counted === false ? 'false' : undefined}>
          {TYPE_SHORT[t]} {mark(m.obtained)}/{mark(m.possible)}{NEVER.has(t) ? ', never counted' : m.counted === false ? ', not counted' : ''}
        </span>
      );
    });
  const polls = marks?.ungraded?.answers ?? 0;
  if (polls > 0) parts.push(<span key="polls">{plural(polls, 'poll')}</span>);
  return parts.length ? <span className="rg-split">{parts}</span> : null;
}

/**
 * The counted marks again by who wrote the question (they add up to the
 * counted types), each with how many of its answers were of a type not counted.
 */
function Sources({ marks, labels }) {
  const qs = marks?.questionSources;
  if (!qs) return <span className="rg-split rg-split-none">Not split by source in this reply</span>;
  const parts = SOURCE_ORDER
    .filter((id) => (qs[id]?.answers ?? 0) > 0 || (qs[id]?.notCounted ?? 0) > 0)
    .map((id) => {
      const q = qs[id];
      const label = labels[id] ?? SOURCE_LABEL[id] ?? id;
      return (
        <span key={id} title={label}>
          {shortSource(label)} {mark(q.obtained)}/{mark(q.possible)}
          {q.notCounted ? <em> +{q.notCounted} not counted</em> : null}
        </span>
      );
    });
  return parts.length ? <span className="rg-split rg-split-src">{parts}</span> : null;
}

/** The split under a figure: by how it was marked, or by who wrote the question. */
function Detail({ marks, by, labels }) {
  return by === 'source' ? <Sources marks={marks} labels={labels} /> : <Split marks={marks} />;
}

/** The counted figure, or what stands in for it. 0 of 0 is never shown as a number. */
function Figure({ counted, answered, joined }) {
  const c = counted ?? {};
  if (!(c.possible > 0)) {
    const words = answered ? 'No counted answers' : joined ? 'Joined, no answers' : 'No answers';
    return <span className="rg-none">{words}</span>;
  }
  return (
    <span className="rg-fig">
      <b>{mark(c.obtained)}</b>
      <span> of {mark(c.possible)}</span>
      {pct(c.share) && <i>{pct(c.share)}</i>}
    </span>
  );
}

function Cell({ cell, by, labels }) {
  if (!cell) return <td className="rg-c" />;
  return (
    <td className="rg-c" data-none={cell.counted?.possible > 0 ? undefined : 'true'}>
      <span className="rg-cell">
        {(cell.attendance || cell.joined) && (
          <span className="rg-cell-top">
            <AttMark status={cell.attendance} />
            {cell.joined && <Joined />}
          </span>
        )}
        <Figure counted={cell.counted} answered={cell.answered} joined={cell.joined} />
        <Detail marks={cell.marks} by={by} labels={labels} />
      </span>
    </td>
  );
}

function Total({ total, answered, by, labels }) {
  const att = total?.attendance;
  const marks = ATT_ORDER.filter((k) => (att?.[k] ?? 0) > 0);
  return (
    <td className="rg-c rg-tot">
      <span className="rg-cell">
        <Figure counted={total?.counted} answered={answered} />
        {att && marks.length > 0 && (
          <span className="rg-attn">
            {marks.map((k) => <span key={k}>{att[k]} {ATTENDANCE[k].toLowerCase()}</span>)}
          </span>
        )}
        <Detail marks={total?.marks} by={by} labels={labels} />
      </span>
    </td>
  );
}

/** Students who answered in each room: a column per room, from the cells. */
function RoomBars({ rooms, students }) {
  const counts = rooms.map((_, i) => students.filter((s) => s.rooms?.[i]?.answered).length);
  const most = Math.max(1, ...counts);
  const label = rooms.map((r, i) => `${r.code}: ${counts[i]}`).join(', ');
  const named = rooms.length <= 8;
  return (
    <div className="ptile rg-bars-tile">
      <span>Students who answered, room by room</span>
      <div className="rg-bars" role="img" aria-label={`Students who answered, oldest room first. ${label}`}>
        {rooms.map((r, i) => (
          <span key={r.code} className="rg-bar-col">
            <span className="rg-bar-track" style={{ '--h': `${Math.max(3, (counts[i] / most) * 100)}%` }}>
              <i data-zero={counts[i] ? undefined : 'true'} />
              <b>{counts[i]}</b>
            </span>
            {named && <small>{r.code}</small>}
          </span>
        ))}
      </div>
      {!named && <small className="rg-bars-ends"><i>{rooms[0].code}</i><i>{rooms[rooms.length - 1].code}</i></small>}
    </div>
  );
}

function formulaLine(formula) {
  if (!formula) return '';
  const v = num(formula.version);
  const version = v === null ? '' : `version ${v}`;
  if (formula.preset?.name) {
    const tail = formula.source === 'example' ? 'the example in use while no formula is saved for this class' : version;
    return `“${formula.preset.name}”, ${tail}`;
  }
  const saved = formula.savedAt ? `, saved ${dateOf(formula.savedAt)}` : '';
  return `This class’s own formula, ${version}${saved}`;
}

/* -------------------------------------------------------------- the brief */

function Brief({ data }) {
  const students = list(data.students);
  const rooms = list(data.rooms);
  const types = list(data.evidenceTypes);
  const evidence = data.formula?.config?.evidence ?? {};
  const labelOf = (id) => types.find((t) => t.id === id)?.label ?? TYPE_LABEL[id] ?? id;
  const counted = TYPE_ORDER.filter((t) => !NEVER.has(t) && evidence[t] === true).map(labelOf);
  const apart = TYPE_ORDER.filter((t) => !NEVER.has(t) && evidence[t] === false).map(labelOf);
  // Always named: no formula counts a re-vote after discussion.
  const never = TYPE_ORDER.filter((t) => NEVER.has(t)).map(labelOf);
  const onRoster = students.filter((s) => s.status === 'active').length;
  const removed = students.filter((s) => s.status === 'removed').length;
  const off = students.filter((s) => s.status === 'not-on-roster').length;
  const after = [
    removed ? `${plural(removed, 'removed student')} with evidence` : '',
    off ? `${plural(off, 'roll number')} not on the roster` : '',
  ].filter(Boolean);
  const answers = data.answers ?? {};

  return (
    <Panel className="rg-brief" aria-label="About this register">
      <div className="rg-say">
        <span className="tag-mint">Marks register · staff only</span>
        <p className="rg-lead">
          {plural(onRoster, 'student')} on the roster across {plural(rooms.length, 'room')}, in roll-number order.
        </p>
        {after.length > 0 && <p className="rg-sub">Listed after them, apart: {after.join(' and ')}.</p>}
        <div className="brief rg-brief-lines">
          {counted.length > 0 && <><b>Counted</b><span>{counted.join('; ')}</span></>}
          {apart.length > 0 && <><b>Shown</b><span>{apart.join('; ')}: in each cell, not counted</span></>}
          <b>Never counted</b><span>{never.join('; ')}: in each cell, whatever the formula</span>
          <b>Formula</b><span>{formulaLine(data.formula)}</span>
          {num(answers.rows) !== null && (
            <>
              <b>Answers</b>
              <span>
                {plural(answers.rows, 'answer')} stored in these rooms
                {num(answers.setAside) ? `; ${answers.setAside} set aside by the attempts rule` : ''}
              </span>
            </>
          )}
        </div>
      </div>
      {rooms.length > 0 && <RoomBars rooms={rooms} students={students} />}
    </Panel>
  );
}

/* -------------------------------------------------------------- the table */

function RoomHead({ room }) {
  return (
    <th scope="col" className="rg-room">
      <span className="rg-room-code">{room.code}</span>
      <span className="rg-room-meta">
        {dayOf(room.day)}
        {ROOM_STATUS[room.status] && <span className="rg-room-st">{ROOM_STATUS[room.status]}</span>}
      </span>
      {room.title && <span className="rg-room-title" title={room.title}>{room.title}</span>}
    </th>
  );
}

function Legend() {
  return (
    <ul className="rg-legend" aria-label="Key">
      {ATT_ORDER.map((k) => <li key={k}><AttMark status={k} /></li>)}
      <li><span className="rg-att"><span className="rg-joined" aria-hidden="true"><Icon name="wifi" size={12} /></span>Joined on a phone</span></li>
    </ul>
  );
}

function Table({ data, splitBy = 'marking' }) {
  const rooms = list(data.rooms);
  const students = list(data.students);
  const cls = data.class ?? {};
  const [by, setBy] = useState(splitBy);
  const labels = Object.fromEntries(list(data.questionSources).map((q) => [q.id, q.label]));
  return (
    <section className="card rg-card" aria-labelledby="rg-table-h">
      <div className="rg-card-head">
        <div className="sec">
          <h2 id="rg-table-h">Marks by room</h2>
          <p>Oldest room first. One question is one mark. Never ranked: the order is the roll number.</p>
        </div>
        <Legend />
      </div>
      {data.definitions?.absent && <p className="said rg-said">{data.definitions.absent}</p>}
      <div className="rg-by">
        <span aria-hidden="true">Under each mark</span>
        <Segmented
          label="Under each mark"
          value={by}
          onChange={setBy}
          options={[{ id: 'marking', label: 'How it was marked' }, { id: 'source', label: 'Who wrote the question' }]}
        />
      </div>
      <div className="rg-scroll" role="region" aria-labelledby="rg-table-h" tabIndex={0}>
        <table className="rg-t">
          <caption className="sr-only">
            Marks register{cls.courseName ? ` for ${[cls.courseName, cls.section].filter(Boolean).join(' ')}` : ''}: students in
            roll-number order by rooms, oldest first, then the total.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="rg-who">Student</th>
              {rooms.map((r) => <RoomHead key={r.code} room={r} />)}
              <th scope="col" className="rg-room rg-tot">
                <span className="rg-room-code">Total</span>
                <span className="rg-room-meta">{plural(rooms.length, 'room')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.studentId ?? `roll:${s.rollNo}`} data-status={s.status}>
                <th scope="row" className="rg-who">
                  <span className="rg-roll">{s.rollNo}</span>
                  <span className="rg-name" title={s.name || undefined}>{s.name || 'No name typed'}</span>
                  {s.status !== 'active' && (
                    <span className="rg-status">
                      {s.statusLabel ?? s.status}
                      {s.status === 'removed' && s.removedAt ? `, ${dateOf(s.removedAt)}` : ''}
                    </span>
                  )}
                </th>
                {rooms.map((r, i) => (
                  <Cell
                    key={r.code}
                    cell={s.rooms?.[i]?.code === r.code ? s.rooms[i] : list(s.rooms).find((c) => c.code === r.code)}
                    by={by}
                    labels={labels}
                  />
                ))}
                <Total total={s.total} answered={list(s.rooms).some((c) => c.answered)} by={by} labels={labels} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Roll numbers off the roster, each with the server's note when one comes. */
function OffRoster({ data }) {
  const rows = list(data.students).filter((s) => s.status === 'not-on-roster');
  if (!rows.length) return null;
  const notes = list(data.rollNotes);
  return (
    <section className="card rg-off" aria-labelledby="rg-off-h">
      <div className="sec">
        <h2 id="rg-off-h">Roll numbers not on the roster</h2>
        <p>Listed apart, with no attendance mark, and counted in no class figure.</p>
      </div>
      <ul className="rg-off-list">
        {rows.map((s) => {
          const note = s.note || notes.find((n) => n.rollNo === s.rollNo)?.note || '';
          return (
            <li key={s.rollNo}>
              <span className="rg-roll">{s.rollNo}</span>
              <span className="rg-off-body">
                <span className="rg-name">{s.name || 'No name typed'}</span>
                {note && <span className="rg-off-note">{note}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The register's own methodology, the evidence types, the definitions and the privacy line, as they come. */
function HowMade({ data }) {
  const evidence = data.formula?.config?.evidence ?? {};
  const types = list(data.evidenceTypes);
  const sources = list(data.questionSources);
  const defs = Object.entries(data.definitions ?? {}).filter(([, v]) => typeof v === 'string' && v);
  return (
    <section className="card rg-how" aria-labelledby="rg-how-h">
      <div className="rg-how-main">
        <div className="sec">
          <h2 id="rg-how-h">How this register was made</h2>
          {data.formula && <p>{formulaLine(data.formula)}</p>}
        </div>
        {data.methodology && <p className="rg-method">{data.methodology}</p>}
        {types.length > 0 && (
          <div className="rg-types">
            <span className="ac-label">Evidence types</span>
            <ul>
              {types.map((t) => (
                <li key={t.id}>
                  <span className="rg-type-head">
                    <b>{t.label}</b>
                    {NEVER.has(t.id) ? (
                      <span className="rg-count" data-counted="false">Never counted</span>
                    ) : t.id in evidence && (
                      <span className="rg-count" data-counted={evidence[t.id] ? 'true' : 'false'}>
                        {evidence[t.id] ? 'Counted' : 'Shown, not counted'}
                      </span>
                    )}
                  </span>
                  {t.description && <span>{t.description}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sources.length > 0 && (
          <div className="rg-types">
            <span className="ac-label">Who wrote the question</span>
            <ul>
              {sources.map((s) => (
                <li key={s.id}>
                  <span className="rg-type-head"><b>{s.label}</b></span>
                  {s.description && <span>{s.description}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {defs.length > 0 && (
        <dl className="rg-defs">
          {defs.map(([k, v]) => (
            <div key={k}>
              <dt>{DEFINITION_TITLE[k] ?? k.charAt(0).toUpperCase() + k.slice(1)}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.privacy && <p className="rg-privacy"><Icon name="shield" size={14} />{data.privacy}</p>}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="rg-sk" aria-busy="true" aria-label="Reading the marks register">
      <span className="skel rg-sk-brief" />
      <div className="card rg-sk-card">
        <span className="skel rg-sk-head" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="rg-sk-row">
            <span className="skel" />
            <span className="skel" />
            <span className="skel" />
            <span className="skel" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the view */

/**
 * The register, drawn from what it is given.
 *
 * @param data      GET /api/classes/:id/register, or null before the first read
 * @param error     { message, status } of the read that failed, or null
 * @param reading   a read is in flight (the last register stays, dimmed)
 * @param filter    the ReportWindow (an element), drawn at the top
 * @param narrowed  the window chooses dates or rooms
 * @param onClearWindow  back to every room
 * @param onRetry   read again
 * @param files     { busy: 'csv' | 'print' | null, saved, error }
 * @param onCsv     save the CSV of this window
 * @param onPrint   open the printable page of this window (call it straight from the click)
 * @param splitBy   gallery only: 'marking' (the default) or 'source', what each mark shows under it first
 */
export function RegisterView({
  data, error, reading = false, filter, narrowed = false, onClearWindow, onRetry,
  files = {}, onCsv, onPrint, splitBy,
}) {
  const rooms = list(data?.rooms);
  const fileBusy = files.busy ?? null;
  const canFile = Boolean(data) && !error;

  const bar = (
    <div className="rg-bar">
      {filter}
      <span className="rg-files">
        <Button size="sm" icon="download" busy={fileBusy === 'csv'} disabled={!canFile || fileBusy != null} onClick={onCsv}>
          CSV
        </Button>
        <Button size="sm" icon="print" busy={fileBusy === 'print'} disabled={!canFile || fileBusy != null} onClick={onPrint}>
          Printable page
        </Button>
      </span>
    </div>
  );
  const fileLine = (files.error || files.saved) && (
    files.error
      ? <Note tone="bad" role="alert">{files.error}</Note>
      : <p className="rg-saved" role="status"><Icon name="ok" size={14} />{files.saved}</p>
  );

  if (error) {
    return (
      <div className="rg">
        {bar}
        <section className="card rg-state">
          <Empty
            icon={error.status === 404 ? 'search' : error.status === 401 ? 'lock' : 'alert'}
            title={error.status === 404 ? 'Class not found' : 'The register did not load'}
            action={(
              <span className="cluster rg-state-acts">
                {error.status !== 404 && error.status !== 401 && <Button variant="primary" icon="refresh" busy={reading} onClick={onRetry}>Try again</Button>}
                {narrowed && error.status === 400 && <Button icon="undo" onClick={onClearWindow}>All rooms</Button>}
              </span>
            )}
          >
            <span role="alert">{error.message}</span>
          </Empty>
        </section>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rg">
        {bar}
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="rg" aria-busy={reading || undefined}>
      {bar}
      {fileLine}
      {rooms.length === 0 ? (
        <section className="card rg-state">
          <Empty
            icon={narrowed ? 'calendar' : 'rooms'}
            title={narrowed ? 'No rooms in these dates' : 'No room has been opened for this class yet'}
            action={narrowed ? <Button icon="undo" onClick={onClearWindow}>All rooms</Button> : null}
          >
            {narrowed
              ? 'No room opened for this class falls inside the dates or rooms chosen above, so there are no marks to list.'
              : 'Open a room for this class in the console. Each room becomes a column here, with every student in roll-number order.'}
          </Empty>
        </section>
      ) : (
        <div className="rg-body">
          <Brief data={data} />
          <Table data={data} splitBy={splitBy} />
          <OffRoster data={data} />
          <HowMade data={data} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- the container */

export default function Register({ classId }) {
  const [win, setWin] = useState(NO_WINDOW);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reading, setReading] = useState(false);
  const [files, setFiles] = useState({});
  const seq = useRef(0);

  const params = windowParams(win);
  const query = JSON.stringify(params);
  const path = `/classes/${encodeURIComponent(classId)}/register`;

  const read = useCallback(async () => {
    const mine = ++seq.current;
    setReading(true);
    try {
      const res = await api.register(classId, JSON.parse(query));
      if (mine !== seq.current) return;
      setData(res);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setData(null);
      setError({ message: err.message || 'The register did not load.', status: err.status });
    } finally {
      if (mine === seq.current) setReading(false);
    }
  }, [classId, query]);

  useEffect(() => { read(); }, [read]);
  // A file belongs to the window it was made from.
  useEffect(() => { setFiles({}); }, [query]);

  const onCsv = async () => {
    setFiles({ busy: 'csv' });
    try {
      const name = await api.downloadCsv(path, params);
      setFiles({ saved: `Saved ${name}.` });
    } catch (err) {
      setFiles({ error: err.message || 'The CSV did not download.' });
    }
  };
  // Straight from the click: openReport opens its tab before it awaits anything.
  const onPrint = () => {
    setFiles({ busy: 'print' });
    api.openReport(path, params).then(
      () => setFiles({ saved: 'The printable page opened in a new tab. Print it from there.' }),
      (err) => setFiles({ error: err.message || 'The printable page did not open.' }),
    );
  };

  const narrowed = Boolean(win.from || win.to || list(win.rooms).length);
  return (
    <RegisterView
      data={data}
      error={error}
      reading={reading}
      filter={<ReportWindow classId={classId} value={win} onChange={setWin} />}
      narrowed={narrowed}
      onClearWindow={() => setWin(NO_WINDOW)}
      onRetry={read}
      files={files}
      onCsv={onCsv}
      onPrint={onPrint}
    />
  );
}
