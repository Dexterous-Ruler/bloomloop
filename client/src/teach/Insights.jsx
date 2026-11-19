/**
 * Live insights (Phase 3): the room's bands, the three insight cards, the KPI
 * tiles and their trend, and in a Mixed or Teacher-led room the teacher
 * records, counted apart. Staff only: none of this is ever drawn on a phone or
 * the projector.
 *
 * Every figure and sentence is the server's (GET /api/session/:code/insights,
 * docs/API.md "Phase 3: live insights, the student card and class analytics").
 * Band labels, reasons, card text, evidence, notes and privacy lines are shown
 * as they come; this file only lays them out. Students are listed in the three
 * orders the server sends, never numbered or ranked.
 *
 * Phase 5, honest indicators: each KPI's `sentence` sits under its tile, each
 * card's `basis.sentence` under its text, and each student carries `bandBasis`
 * and `levelBasis`. A provisional estimate is never drawn as a firm one: a
 * provisional band shows as no band, a provisional level lighter and named so.
 *
 *   <Insights code insights canControl sort onSort onAct onOpenStudent />
 *     insights   the last `teacher:insights` body, or null: then it is read once here
 *     canControl false (an HOD): read only, no act or dismiss
 *     sort       'band' | 'lowest' | 'roll'; when not given, its own choice, else the
 *                server's default order (`sort.default`, roll order since the Phase 5 follow-ups)
 *     onAct      (card.action) after an "acted" is recorded: { do: 'ask', level } |
 *                { do: 'sort', sort } | { do: 'wheel' }. A sort is also applied here.
 *     move       Batch 8: the "Suggest a move" card (teach/Moves.jsx), drawn under the
 *                three cards; not in a Teacher-led room, which has no graded answers
 *
 * Batch 8 (teach/LevelsOverTime.jsx): each level's accuracy minute by minute with
 * the room's goal (`series.points[].levels`, `series.threshold`), and under the
 * Needs support tile the same students in the class's previous room
 * (`kpis.support.previousRoom`). Each is left out when the reply has no such field.
 *   <InsightsView data ... onAction />  the same, drawn from a body (the gallery uses it)
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { record, useSynced } from '../lib/consoleOutbox.js';
import { Button, Icon, Level, Note, Num, Panel, Segmented, Spark } from '../ui/index.jsx';
import { LevelTrend, SupportThen } from './LevelsOverTime.jsx';

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (v) => (num(v) === null ? '—' : `${Math.round(v * 100)}%`);
const clock = (iso) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

// The server's own labels for the teacher records' ids (services/records.js
// OBSERVATION_KINDS, services/wheel.js PICK_STATUSES): the counts arrive by id.
const OBSERVED = [['understood', 'Understood'], ['participated', 'Participated'], ['revision', 'Needs revision'], ['support', 'Needs additional support']];
const PICKED = [['answered', 'Answered'], ['passed', 'Passed to partner'], ['help', 'Needs help'], ['skipped', 'Skipped'], ['absent', 'Absent'], ['pending', 'Pending']];

const CARD_ICON = { focus: 'target', support: 'hand', participation: 'users' };
const NO_BAND = 'Not enough answers yet';

/* ------------------------------------------------------------ the brief */

/** A change since the start: points for a share, a plain count otherwise. */
function changeText(change, ratio) {
  const c = num(change);
  if (c === null) return '—';
  const n = ratio ? Math.round(c * 100) : c;
  if (n === 0) return 'No change';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}${ratio ? ' pts' : ''}`;
}

/** One KPI tile: the value now, its trend, its change since the start, and what each rests on. */
function Kpi({ k, values, ratio, now, start, delay, trend }) {
  const v = num(k?.value);
  return (
    <div className="co-kpi-wrap">
      <div className="ptile co-kpi" style={{ '--d': delay }}>
        <span>{k?.label}</span>
        <b><Num value={v === null ? '—' : ratio ? pct(v) : v} /></b>
        <Spark values={values} label={values.length > 1 ? trend : undefined} />
        {values.length < 2 && <i className="co-spark-wait" aria-hidden="true" />}
        <small>{changeText(k?.change, ratio)} <i>since the start</i></small>
        <span className="co-rest">{now}</span>
        <span className="co-rest">{start}</span>
      </div>
      {k?.sentence && <p className="co-kpi-basis">{k.sentence}</p>}
    </div>
  );
}

/** How the students stand across the bands: one quiet bar, every part named with its count. */
function BandStrip({ counts, bands }) {
  const total = num(counts?.students) ?? 0;
  if (!total) return null;
  const parts = [
    ...list(bands).map((b) => ({ id: b.id, label: b.label, n: num(counts[b.id]) ?? 0 })),
    { id: 'none', label: NO_BAND, n: num(counts.notEnough) ?? 0 },
  ];
  const said = parts.map((p) => `${p.label} ${p.n}`).join(', ');
  return (
    <div className="co-strip">
      <div className="co-strip-bar" role="img" aria-label={`Students by band: ${said}.`}>
        {parts.filter((p) => p.n > 0).map((p) => (
          <i key={p.id} data-band={p.id} style={{ flexGrow: p.n }} />
        ))}
      </div>
      <ul className="co-strip-key" aria-hidden="true">
        {parts.map((p) => (
          <li key={p.id} data-band={p.id}><i />{p.label}<b className="mono">{p.n}</b></li>
        ))}
      </ul>
    </div>
  );
}

function Brief({ data }) {
  const room = data.room ?? {};
  const counts = data.counts ?? {};
  const k = data.kpis ?? {};
  const min = num(data.thresholds?.minAnswers);
  const students = num(counts.students) ?? 0;
  const banded = students - (num(counts.notEnough) ?? 0);
  const support = num(counts['needs-support']) ?? 0;
  const supportLabel = list(data.bands).find((b) => b.id === 'needs-support')?.label;
  const points = list(data.series?.points);
  const line = (key) => points.map((p) => p[key]).filter((x) => num(x) !== null);
  const since = clock(data.series?.since);
  const teacherLed = Boolean(data.cardsNote);

  let lead;
  if (teacherLed) lead = data.cardsNote;
  else if (!students) lead = 'No phone has joined this room yet.';
  else if (!banded) lead = <>{plural(students, 'student')} joined. None has the <em>{min ?? ''} graded answers</em> a band needs yet.</>;
  else lead = <><em>{banded} of {students}</em> students have a band{support && supportLabel ? <>; <em>{support}</em> {support === 1 ? 'is' : 'are'} in {supportLabel}</> : ''}.</>;

  const startOf = (s, rest) => (s ? `Start ${rest(s)} at ${clock(s.at)}` : 'No start yet');
  const acc = k.accuracy ?? {};
  const sup = k.support ?? {};
  const par = k.participation ?? {};

  return (
    <Panel className="co-brief" aria-label="Insights for this room" data-led={teacherLed ? 'true' : undefined}>
      <div className="co-brief-main">
        <div className="cluster">
          <span className="tag-mint">Insights · staff only</span>
          <span className="co-meta">
            {room.status === 'open' && <i className="live-dot" aria-hidden="true" />}
            {room.status === 'closed' ? 'Room closed' : room.status === 'waiting' ? 'Waiting to start' : room.status === 'paused' ? 'Paused' : 'Live'}
            {since && !teacherLed ? ` · each minute since ${since}` : ''}
          </span>
        </div>
        <p className="co-lead">{lead}</p>
        {!teacherLed && <BandStrip counts={counts} bands={data.bands} />}
      </div>

      {!teacherLed && (
        <div className="co-tiles">
          <Kpi
            k={acc} ratio values={line('accuracy')} delay="0s"
            trend={`Class accuracy each minute since ${since}`}
            now={num(acc.value) === null ? 'No graded answer yet' : `${plural(acc.answers ?? 0, 'graded answer')} · ${plural(acc.students ?? 0, 'student')}`}
            start={startOf(acc.start, (s) => `${pct(s.value)}, ${plural(s.answers ?? 0, 'answer')}`)}
          />
          <Kpi
            k={sup} values={line('support')} delay="0.6s"
            trend={`Students in Needs support each minute since ${since}`}
            now={num(sup.value) === null ? `Nobody has ${min ?? ''} graded answers yet` : `of ${plural(sup.banded ?? 0, 'student')} with a band`}
            start={startOf(sup.start, (s) => `${s.value}, of ${plural(s.students ?? 0, 'student')}`)}
          />
          <Kpi
            k={par} ratio values={line('participation')} delay="1.2s"
            trend={`Participation each minute since ${since}`}
            now={num(par.value) === null ? 'Nobody present yet' : `${par.answered ?? 0} of ${par.present ?? 0} present have answered`}
            start={startOf(par.start, (s) => `${pct(s.value)}, ${s.present ?? 0} present`)}
          />
          <SupportThen p={sup.previousRoom} />
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------ the cards */

function CardRow({ card, canControl, onRun }) {
  const id = useId();
  const [form, setForm] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const last = card.lastAction;
  const action = card.action;

  async function run(kind) {
    setBusy(kind);
    setError('');
    try {
      await onRun(card, kind, kind === 'dismissed' ? note.trim() : undefined);
      if (kind === 'dismissed') { setForm(false); setNote(''); }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const actButton = canControl && action && (
    <Button size="sm" busy={busy === 'acted'} disabled={Boolean(busy)} onClick={() => run('acted')}>
      {action.label}
    </Button>
  );

  if (card.dismissed) {
    return (
      <li className="co-card" data-dismissed="true">
        <span className="co-card-ic" aria-hidden="true"><Icon name={CARD_ICON[card.kind] ?? 'idea'} size={16} /></span>
        <div className="co-card-body">
          <p className="co-card-k">{card.title}<span className="co-dis">Dismissed{last?.actedAt ? ` at ${clock(last.actedAt)}` : ''}</span></p>
          {last?.note && <p className="co-dis-note">{last.note}</p>}
          {open && (
            <div id={`${id}-text`} className="co-card-open">
              <p className="co-card-text">{card.text}</p>
              {card.basis?.sentence && <p className="co-basis">{card.basis.sentence}</p>}
              {card.evidence && <p className="co-evid">{card.evidence}</p>}
            </div>
          )}
          <div className="co-card-foot">
            <button type="button" className="co-link" aria-expanded={open} aria-controls={`${id}-text`} onClick={() => setOpen((v) => !v)}>
              <Icon name={open ? 'chevronUp' : 'chevron'} size={14} />{open ? 'Hide the card' : 'Show the card'}
            </button>
            {actButton && <span className="co-hint">Acting on it ends the dismissal.</span>}
          </div>
          {error && <p className="co-err" role="alert">{error}</p>}
        </div>
        {actButton && <div className="co-card-acts">{actButton}</div>}
      </li>
    );
  }

  return (
    <li className="co-card">
      <span className="co-card-ic" aria-hidden="true"><Icon name={CARD_ICON[card.kind] ?? 'idea'} size={16} /></span>
      <div className="co-card-body">
        <p className="co-card-k">{card.title}</p>
        <p className="co-card-text">{card.text}</p>
        {card.basis?.sentence && <p className="co-basis">{card.basis.sentence}</p>}
        {card.evidence && <p className="co-evid">{card.evidence}</p>}
        {last?.action === 'acted' && last.actedAt && <p className="co-last">Acted on at {clock(last.actedAt)}</p>}
        {form && (
          <form className="co-dismiss" onSubmit={(e) => { e.preventDefault(); run('dismissed'); }}>
            <label className="label" htmlFor={`${id}-note`}>Note <span className="opt">optional, staff only</span></label>
            <input
              id={`${id}-note`} className="input" maxLength={280} value={note} autoFocus
              onChange={(e) => setNote(e.target.value)} placeholder="Why it can wait"
            />
            <div className="cluster">
              <Button type="submit" size="sm" variant="ink" busy={busy === 'dismissed'}>Dismiss the card</Button>
              <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => { setForm(false); setNote(''); }}>Cancel</Button>
              <span className="co-count mono" aria-hidden="true">{note.length}/280</span>
            </div>
          </form>
        )}
        {error && <p className="co-err" role="alert">{error}</p>}
      </div>
      {canControl && !form && (
        <div className="co-card-acts">
          {actButton}
          <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setForm(true)}>Dismiss</Button>
        </div>
      )}
    </li>
  );
}

function Cards({ data, canControl, onRun }) {
  const cards = list(data.cards);
  return (
    <section className="card co-cards" aria-labelledby="co-cards-h">
      <div className="co-head">
        <div className="sec">
          <h2 id="co-cards-h">What the answers show</h2>
          <p>Read from this room’s answers. Each card says what it rests on.</p>
        </div>
        {!canControl && <span className="co-ro"><Icon name="eye" size={14} />Read only</span>}
      </div>
      <ul className="co-card-list">
        {cards.map((c) => <CardRow key={c.flagId} card={c} canControl={canControl} onRun={onRun} />)}
      </ul>
      {!canControl && (
        <p className="co-ro-line">You can read these cards. Only the professor who opened the room can act on them or dismiss them.</p>
      )}
    </section>
  );
}

/* --------------------------------------------------------- the students */

/** A band, or no band. A provisional band (too few graded answers) is never drawn as a firm one. */
function BandTag({ band, label, provisional }) {
  if (provisional) return <span className="co-band" data-band="none">{NO_BAND}</span>;
  return <span className="co-band" data-band={band ?? 'none'}>{label ?? NO_BAND}</span>;
}

/** A student's level, lighter and named "provisional" while too few answers are behind it. */
export function BasisLevel({ level, basis, size }) {
  if (!level) return null;
  const prov = Boolean(basis?.provisional);
  return (
    <span className="co-lvb" data-prov={prov ? 'true' : undefined}>
      <Level level={level} size={size} className={prov ? 'co-lv-prov' : ''} />
      {prov && <span className="co-prov">provisional</span>}
    </span>
  );
}

function Students({ data, sort, onSort, onOpenStudent, listRef }) {
  const keys = list(data.sort?.keys);
  const orders = data.sort?.orders ?? {};
  const fallback = orders[data.sort?.default] ? data.sort.default : orders.roll ? 'roll' : 'band';
  const cur = orders[sort] ? sort : fallback;
  const byRoll = new Map(list(data.students).map((s) => [s.rollNo, s]));
  const rows = list(orders[cur]).map((r) => byRoll.get(r)).filter(Boolean);
  const rule = keys.find((k) => k.id === cur)?.rule;
  const bands = list(data.bands);
  const counts = data.counts ?? {};
  const groupLabel = (b) => (b ? bands.find((x) => x.id === b)?.label ?? b : NO_BAND);
  const groupCount = (b) => num(b ? counts[b] : counts.notEnough) ?? 0;
  const min = num(data.thresholds?.minAnswers);

  const items = [];
  rows.forEach((s, i) => {
    if (cur === 'band' && (i === 0 || rows[i - 1].band !== s.band)) {
      items.push(
        <li key={`g-${s.band ?? 'none'}`} className="co-group" aria-hidden="true">
          <span>{groupLabel(s.band)}</span><b className="mono">{groupCount(s.band)}</b>
        </li>,
      );
    }
    const name = s.rosterName || s.name || s.rollNo;
    const bandSaid = s.bandBasis?.sentence ?? s.reason;
    const levelSaid = s.levelBasis?.sentence;
    items.push(
      <li key={s.rollNo}>
        <button
          type="button" className="co-st" onClick={() => onOpenStudent?.(s.rollNo)}
          aria-label={`${name}, ${s.rollNo}. ${bandSaid ?? ''}${levelSaid ? ` ${levelSaid}` : ''} Open their card.`}
        >
          <span className="co-st-top">
            <b className="co-st-name clip">{name}</b>
            <span className="co-roll mono">{s.rollNo}</span>
            {s.rosterName && s.name && s.name !== s.rosterName && <span className="co-typed clip">typed “{s.name}”</span>}
            <span className="co-st-tags">
              {s.answers > 0 && <BasisLevel level={s.workingLevel} basis={s.levelBasis} />}
              <BandTag band={s.band} label={s.bandLabel} provisional={s.bandBasis?.provisional} />
            </span>
          </span>
          <span className="co-st-reason">
            {bandSaid}
            {s.present === false && <span className="co-away"> Not marked present.</span>}
          </span>
          {levelSaid && levelSaid !== bandSaid && <span className="co-st-basis">{levelSaid}</span>}
          <Icon name="chevronRight" size={16} className="co-st-go" />
        </button>
      </li>,
    );
  });

  return (
    <section className="card co-students" aria-labelledby="co-st-h" ref={listRef} tabIndex={-1}>
      <div className="co-head co-head-wrap">
        <div className="sec">
          <h2 id="co-st-h">Students</h2>
          <p>{rows.length ? `${plural(rows.length, 'student')} who joined. Open one for their card.` : 'Everyone who joins on a phone is listed here.'}</p>
        </div>
        {rows.length > 1 && keys.length > 0 && (
          <Segmented label="Order the students" value={cur} onChange={onSort} options={keys.map((k) => ({ id: k.id, label: k.label }))} />
        )}
      </div>
      {rows.length > 1 && rule && <p className="co-rule">{rule}</p>}
      {rows.length ? (
        <ul className="co-st-list">{items}</ul>
      ) : (
        <div className="co-st-empty">
          <span className="co-st-empty-art" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} />)}</span>
          <p>No phone has joined yet. Each student appears here with their band and the sentence behind it.</p>
        </div>
      )}
      <details className="co-how">
        <summary><Icon name="info" size={14} />How bands are set</summary>
        <ul>
          {bands.map((b) => <li key={b.id}><b>{b.label}</b><span>{b.note}</span></li>)}
          {min !== null && <li><b>{NO_BAND}</b><span>Fewer than {min} graded answers: no band.</span></li>}
        </ul>
      </details>
    </section>
  );
}

/* --------------------------------------------------- teacher records */

function Breakdown({ parts, of }) {
  const shown = parts.filter(([key]) => (num(of?.[key]) ?? 0) > 0);
  if (!shown.length) return <span className="co-none">None yet</span>;
  return (
    <span className="co-parts">
      {shown.map(([key, label]) => <span key={key}>{label} <b className="mono">{of[key]}</b></span>)}
    </span>
  );
}

function TeacherRecords({ r }) {
  const hands = r.handsRaised ?? {};
  const wheel = r.wheel ?? {};
  const obs = r.observations ?? {};
  return (
    <section className="card co-rec" aria-labelledby="co-rec-h">
      <div className="co-head">
        <div className="sec">
          <h2 id="co-rec-h">{r.label}</h2>
          <p>{r.note}</p>
        </div>
      </div>
      <dl className="co-rec-list">
        <div>
          <dt>Hands raised</dt>
          <dd><b className="mono">{hands.hands ?? 0}</b><span>over {plural(hands.questions ?? 0, 'question')} asked aloud</span></dd>
        </div>
        <div>
          <dt>Answered aloud</dt>
          <dd><b className="mono">{r.answeredAloud ?? 0}</b><span>wheel {(r.answeredAloud ?? 0) === 1 ? 'pick' : 'picks'} marked Answered</span></dd>
        </div>
        <div>
          <dt>Wheel picks</dt>
          <dd><b className="mono">{wheel.picks ?? 0}</b><Breakdown parts={PICKED} of={wheel} /></dd>
        </div>
        <div>
          <dt>Observations today</dt>
          <dd><b className="mono">{obs.observed ?? 0}</b><Breakdown parts={OBSERVED} of={obs} /></dd>
        </div>
        <div>
          <dt>Activities</dt>
          <dd><b className="mono">{r.activities ?? 0}</b></dd>
        </div>
      </dl>
      {r.privacy && <p className="co-priv"><Icon name="eyeOff" size={14} />{r.privacy}</p>}
    </section>
  );
}

/* ------------------------------------------------------------ the view */

function Skeleton() {
  return (
    <div className="co" aria-busy="true" aria-label="Reading this room’s insights">
      <div className="co-skel-brief">
        <div className="co-skel-main"><span className="skel" /><span className="skel" /><span className="skel" /></div>
        <div className="co-skel-tiles">{[0, 1, 2].map((i) => <span key={i} className="skel" />)}</div>
      </div>
      <div className="card co-skel-rows">{[0, 1, 2].map((i) => <div key={i}><span className="skel" /><span className="skel" /></div>)}</div>
    </div>
  );
}

/**
 * The insights drawn from one body. `onAction(card, 'acted' | 'dismissed', note)`
 * records the action and returns a promise; a refusal's sentence is shown on the card.
 */
export function InsightsView({ data, error, onRetry, canControl = false, sort, onSort, onAction, onOpenStudent, move = null }) {
  // Roll order unless someone chooses otherwise: the server's own default.
  const [ownSort, setOwnSort] = useState(null);
  const listRef = useRef(null);
  const cur = sort ?? ownSort ?? data?.sort?.default ?? 'roll';
  const changeSort = (id) => { setOwnSort(id); onSort?.(id); };

  async function onRun(card, kind, note) {
    if (kind === 'acted' && card.action?.do === 'sort' && card.action.sort) {
      changeSort(card.action.sort);
      listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      listRef.current?.focus({ preventScroll: true });
    }
    await onAction?.(card, kind, note);
  }

  if (!data) {
    if (!error) return <Skeleton />;
    return (
      <Note tone="bad">
        Could not read this room’s insights: {error}
        {onRetry && <div style={{ marginTop: 8 }}><Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button></div>}
      </Note>
    );
  }

  const led = Boolean(data.cardsNote);
  return (
    <div className="co" data-led={led ? 'true' : undefined}>
      <Brief data={data} />
      {!led && <Cards data={data} canControl={canControl} onRun={onRun} />}
      {!led && move}
      {!led && <LevelTrend series={data.series} />}
      <div className="co-cols">
        {(!led || list(data.students).length > 0) && (
          <Students data={data} sort={cur} onSort={changeSort} onOpenStudent={onOpenStudent} listRef={listRef} />
        )}
        {data.teacherRecords && <TeacherRecords r={data.teacherRecords} />}
      </div>
      {error && <p className="co-stale">Could not read the insights again just now ({error}). These were read earlier.</p>}
      {data.privacy && <p className="co-privacy"><Icon name="eyeOff" size={14} />{data.privacy}</p>}
    </div>
  );
}

/**
 * Actions kept on this laptop, drawn on their cards until the server has them:
 * a dismissed card reads as dismissed, an acted one says when (`local`).
 */
function withKept(data, kept) {
  if (!data || !Object.keys(kept).length || !Array.isArray(data.cards)) return data;
  return {
    ...data,
    cards: data.cards.map((c) => {
      const k = kept[c.flagId];
      return k ? { ...c, dismissed: k.action === 'dismissed', lastAction: k } : c;
    }),
  };
}

/** The live insights for one room: the pushed body when there is one, else read here. */
export default function Insights({ code, insights, canControl = false, sort, onSort, onAct, onOpenStudent, move = null }) {
  const [own, setOwn] = useState(null);
  const [error, setError] = useState('');
  const [kept, setKept] = useState({});
  const req = useRef(0);

  const read = useCallback(() => {
    const id = ++req.current;
    setError('');
    api.insights(code).then(
      (d) => { if (req.current === id) setOwn(d); },
      (err) => { if (req.current === id) setError(err.message); },
    );
  }, [code]);

  // A pushed body is the newest: it replaces anything read here.
  useEffect(() => { setOwn(null); setError(''); }, [insights, code]);
  // With nothing pushed yet, read once.
  useEffect(() => { if (!insights) read(); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  // Actions kept on this laptop have reached the server: its cards are the truth again.
  useSynced(code, () => { setKept({}); read(); });

  // Through the console outbox, with basedOn the time of the card's last action.
  async function onAction(card, kind, note) {
    const out = await record('insight', { code, flagId: card.flagId, action: kind, note: note || undefined }, {
      label: `${card.title}: ${kind === 'dismissed' ? 'dismissed' : 'acted on'}`,
      shown: card.lastAction?.local ? undefined : card.lastAction?.actedAt ?? null,
    });
    if (out.ok || out.stale) {
      // The server pushes fresh insights to every teacher screen; reading once
      // here moves this one at once (after a stale refusal too: another action
      // on the card was recorded meanwhile).
      read();
    } else if (out.kept) {
      setKept((k) => ({ ...k, [card.flagId]: { action: kind, note: note ?? '', actedAt: new Date().toISOString(), local: true } }));
    }
    // Acting is the teacher's call: it goes ahead even if the record failed.
    if (kind === 'acted' && card.action) onAct?.(card.action);
    if (out.refused) throw Object.assign(new Error(out.error), { status: out.status });
  }

  return (
    <InsightsView
      data={withKept(own ?? insights, kept)}
      error={error}
      onRetry={read}
      canControl={canControl}
      sort={sort}
      onSort={onSort}
      onAction={onAction}
      onOpenStudent={onOpenStudent}
      move={move}
    />
  );
}
