/**
 * /hub/errors - the student's error log, from GET /api/hub/errors.
 *
 * One entry per question answered wrong, in practice or in class, newest
 * first: the question as it was shown (`rich` first), what the student
 * answered, what was right (`solution`), the approved explanation, the
 * topic's prerequisites nearest first, where it came from (`fromLabel`), its
 * status and the server's sentence on how it clears. An entry carrying
 * `keyHeld` (a room is asking that question now, say) shows that sentence in
 * place of what was right, and no explanation.
 *
 * Filters: status (open by default, cleared, all) and topic, both sent to
 * the server and kept in the address (?status=&topic=), so a topic screen can
 * link straight to its own entries.
 *
 * Errors fetches; ErrorsView draws and is what dev/hubmap.gallery.jsx renders.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { saidLines } from '../account/insightData.js';
import { useEnter } from '../lib/motion.js';
import { Button, Empty, Icon, Level, Segmented } from '../ui/index.jsx';
import { HubTrouble, topicHref } from './ClassMap.jsx';
import { hub } from './hubApi.js';
import HubPage from './HubPage.jsx';
import { langAttr } from './lang.js';
import RichText from './RichText.jsx';

const PAGE = 12;
const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const CHOICE = new Set(['mcq', 'multi', 'truefalse']);

const day = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '';
};

/* -------------------------------------------------- what was right, in words */

const nth = (list, i, what) => {
  const v = Array.isArray(list) ? list[Number(i)] : undefined;
  return v == null || v === '' ? `${what} ${Number(i) + 1}` : String(v);
};

/**
 * What was right, as lines a person can read, for every kind that is not a
 * choice between options. Positions are the question as it was shown, the
 * same space the server sends `solution` in. Mirrors saidLines() for the
 * response (account/insightData.js).
 */
export function solutionLines(question, solution) {
  if (solution === null || solution === undefined || solution === '') return [];
  const q = question ?? {};
  const list = Array.isArray(solution) ? solution : [];
  switch (q.kind) {
    case 'match':
      return list.map((pos, i) => `${nth(q.left, i, 'Term')} → ${nth(q.right, pos, 'Item')}`);
    case 'categorise':
      return list.map((g, pos) => `${nth(q.items, pos, 'Item')} → ${nth(q.groups, g, 'Group')}`);
    case 'cloze':
      return list.map((s, k) => `Gap ${k + 1}: ${s}`);
    case 'dropdown':
      return list.map((pos, k) => `Gap ${k + 1}: ${nth(q.gaps?.[k]?.options, pos, 'Option')}`);
    case 'numeric':
      return [`${solution}${q.unit ? ` ${q.unit}` : ''}`];
    case 'order':
    case 'rank':
      return list.map((s, k) => `${k + 1}. ${s}`);
    case 'hottext':
      return list.map((i) => nth(q.tokens, i, 'Word').replace(/[,.;:!?]+$/, ''));
    case 'table':
      return Object.entries(solution && typeof solution === 'object' ? solution : {}).map(([at, v]) => {
        const [r, c] = at.split(':');
        return `${q.rows?.[r]?.header ?? `Row ${Number(r) + 1}`}, ${nth(q.columns, c, 'Column')}: ${v}`;
      });
    case 'grid':
      return list.map((at) => {
        const [r, c] = String(at).split(':');
        return `${nth(q.rows, r, 'Row')} × ${nth(q.columns, c, 'Column')}`;
      });
    default:
      if (Array.isArray(solution)) return solution.map(String);
      return typeof solution === 'object' ? [JSON.stringify(solution)] : [String(solution)];
  }
}

/** A choice question's options, with what the student chose and what was right. */
function choiceRows(q, response, solution, held) {
  const tf = q.kind === 'truefalse';
  const texts = tf ? ['True', 'False'] : (q.options ?? []);
  const htmls = tf ? [] : (q.rich?.options ?? []);
  const asIdx = (v) => (tf ? (v === true ? 0 : v === false ? 1 : null) : Number.isInteger(v) ? v : null);
  const set = (v) => new Set((Array.isArray(v) ? v : [v]).map(asIdx).filter((i) => i !== null));
  const mine = set(response);
  const right = held || solution === null || solution === undefined ? new Set() : set(solution);
  return texts.map((text, i) => ({ i, text, html: htmls[i], mine: mine.has(i), right: right.has(i) }));
}

/** The student's answer, short, for the folded entry. */
function answerBrief(entry) {
  const q = entry.question ?? {};
  if (CHOICE.has(q.kind)) {
    const picked = choiceRows(q, entry.response, null, true).filter((r) => r.mine);
    if (!picked.length) return null;
    return picked.map((r, k) => (
      <span key={r.i}>
        {k > 0 && <span aria-hidden="true"> · </span>}
        <RichText as="span" html={r.html} text={r.text} />
      </span>
    ));
  }
  const lines = saidLines({ response: entry.response, question: q, kind: q.kind });
  return lines.length ? lines.join(' · ') : null;
}

function Answers({ entry }) {
  const q = entry.question ?? {};
  const held = Boolean(entry.keyHeld);
  if (CHOICE.has(q.kind)) {
    const rows = choiceRows(q, entry.response, entry.solution, held);
    return (
      <ol className="hub-err-opts" aria-label="The options as you saw them" data-held={held ? 'true' : undefined}>
        {rows.map((r) => (
          <li key={r.i} className="hub-err-opt" data-mine={r.mine ? 'true' : undefined} data-right={r.right ? 'true' : undefined}>
            <span className="hub-err-key" aria-hidden="true">{q.kind === 'truefalse' ? '' : KEYS[r.i]}</span>
            <RichText as="span" className="hub-err-opt-text" html={r.html} text={r.text} />
            <span className="hub-err-tags">
              {/* Held: no option is marked right or wrong, so the picks say nothing about the key. */}
              {r.mine && (held
                ? <span className="hub-err-tag" data-kind="picked"><Icon name="dot" size={13} />Your answer</span>
                : <span className="hub-err-tag" data-kind={r.right ? 'right' : 'mine'}><Icon name={r.right ? 'ok' : 'wrong'} size={13} />Your answer</span>)}
              {r.right && !r.mine && <span className="hub-err-tag" data-kind="right"><Icon name="ok" size={13} />Right answer</span>}
              {r.right && r.mine && <span className="sr-only">, and right</span>}
            </span>
          </li>
        ))}
      </ol>
    );
  }
  const said = saidLines({ response: entry.response, question: q, kind: q.kind });
  const right = held ? [] : solutionLines(q, entry.solution);
  return (
    <div className="hub-err-pair">
      <div className="hub-err-side" data-kind="mine">
        <span className="hub-err-side-head"><Icon name="wrong" size={14} />Your answer</span>
        {said.length ? <ul>{said.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p>No answer was given.</p>}
      </div>
      {right.length > 0 && (
        <div className="hub-err-side" data-kind="right">
          <span className="hub-err-side-head"><Icon name="ok" size={14} />{q.kind === 'open' ? 'What a full answer covers' : 'Right answer'}</span>
          <ul>{right.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- one entry */

function Entry({ entry, open, onToggle }) {
  const id = useId();
  const q = entry.question ?? {};
  const brief = answerBrief(entry);
  const pre = [...(entry.prerequisites ?? [])].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  const ex = entry.explanation;
  return (
    <li className="card hub-err-item" data-status={entry.status}>
      <div className="hub-err-top">
        <span className="hub-err-status" data-status={entry.status}>
          <Icon name={entry.status === 'cleared' ? 'ok' : 'dot'} size={13} />
          {entry.status === 'cleared' ? 'Cleared' : 'Open'}
        </span>
        <span>{entry.fromLabel}</span>
        {entry.level && <Level level={entry.level}>{entry.levelLabel}</Level>}
        {entry.times > 1 && <span>{entry.times} times</span>}
        <span>{day(entry.lastAt)}</span>
      </div>
      {entry.topic && (
        <p className="hub-err-topic">
          <Link to={topicHref(entry.topic.id)}><RichText as="span" html={entry.topic.nameHtml} text={entry.topic.name} /></Link>
          {entry.topic.chapter?.title && <RichText as="span" className="hub-err-chapter" html={entry.topic.chapter.titleHtml} text={entry.topic.chapter.title} />}
        </p>
      )}
      <RichText className="hub-err-q" html={q.rich?.text} text={q.text} />
      {!open && brief && <p className="hub-err-brief"><span>You answered</span> {brief}</p>}
      {entry.sentence && <p className="said hub-err-said">{entry.sentence}</p>}

      <button type="button" className="hub-err-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        {open ? 'Show less' : entry.keyHeld ? 'Your answer' : 'Your answer, what was right and why'}
        <Icon name="chevron" size={14} />
      </button>

      <div id={id} className="hub-err-more" hidden={!open}>
        <Answers entry={entry} />
        {entry.provisional && (
          <p className="hub-err-prov"><Icon name="info" size={14} />A written answer, marked provisionally by the machine: your professor may still change the mark.</p>
        )}
        {entry.keyHeld ? (
          <p className="hub-err-held"><Icon name="clock" size={14} />{entry.keyHeld}</p>
        ) : ex ? (
          <div className="hub-err-why">
            <span className="eyebrow">Why</span>
            <RichText html={ex.textHtml} text={ex.text} lang={langAttr(ex.language?.language)} />
            {ex.label && <p className="t-meta">{ex.label}</p>}
          </div>
        ) : (
          <p className="hub-err-none">Your professor has not added an explanation to this question yet.</p>
        )}
        {pre.length > 0 && (
          <p className="hub-err-pre">
            <span>Builds on</span>
            {pre.map((p, i) => (
              <span key={p.id}>
                <RichText as="span" html={p.nameHtml} text={p.name} />
                {i < pre.length - 1 && <span aria-hidden="true">,</span>}
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- the view */

function Waiting() {
  return (
    <ol className="hub-err-list" aria-busy="true" aria-label="Loading your error log">
      {[0, 1, 2].map((i) => (
        <li key={i} className="card hub-err-item">
          <span className="skel" style={{ height: 12, width: 220 }} />
          <span className="skel" style={{ height: 16, width: `${80 - i * 12}%` }} />
          <span className="skel" style={{ height: 12, width: `${60 - i * 8}%` }} />
        </li>
      ))}
    </ol>
  );
}

const STATUS = [
  { id: 'open', label: 'Open' },
  { id: 'cleared', label: 'Cleared' },
  { id: 'all', label: 'All' },
];

/**
 * @param data      GET /api/hub/errors, or null before it arrives
 * @param status    'open' | 'cleared' | 'all'
 * @param topicId   the topic filter, or ''
 * @param topics    [{ id, name }] for the topic filter
 * @param onFilter  ({ status?, topicId? }) => void
 * @param error     the error the read threw, or null
 * @param busy      a read is in flight
 * @param onRetry   ask again
 */
export function ErrorsView({ data, status = 'open', topicId = '', topics = [], onFilter, error = null, busy = false, onRetry }) {
  const crumb = <Link to="/hub">Learning Hub</Link>;
  const root = useRef(null);
  const entries = data?.entries ?? [];
  const [shown, setShown] = useState(PAGE);
  const [opened, setOpened] = useState(() => new Set(entries[0] ? [entries[0].id] : []));
  useEnter(root, 'errors');

  // A new list starts at its first page, with its newest entry open.
  const listKey = `${status}|${topicId}|${entries.map((e) => e.id).join(',')}`;
  const [seen, setSeen] = useState(listKey);
  if (seen !== listKey) {
    setSeen(listKey);
    setShown(PAGE);
    setOpened(new Set(entries[0] ? [entries[0].id] : []));
  }

  const toggle = (eid) => setOpened((s) => {
    const n = new Set(s);
    if (n.has(eid)) n.delete(eid); else n.add(eid);
    return n;
  });

  if (!data && error) {
    return <HubPage crumb={crumb} title="Error log"><HubTrouble error={error} busy={busy} onRetry={onRetry} what="Your error log" /></HubPage>;
  }

  const counts = data?.counts ?? { open: 0, cleared: 0 };
  const total = counts.open + counts.cleared;
  const options = STATUS.map((o) => ({ ...o, count: o.id === 'all' ? total : counts[o.id] }));
  const topicName = topics.find((t) => t.id === topicId)?.name;
  const actions = <Link className="btn" to="/hub/review"><Icon name="clock" />Reviews</Link>;

  let list;
  if (!data) list = <Waiting />;
  else if (!entries.length && !total && !topicId) {
    list = (
      <div className="card">
        <Empty icon="ok" title="Nothing in your error log">
          A question you answer wrong, in practice or in class, comes here with what was right and why. It clears when you get
          another question on its topic right.
        </Empty>
      </div>
    );
  } else if (!entries.length) {
    const what = status === 'all' ? 'entries' : `${status} entries`;
    list = (
      <div className="card">
        <Empty
          icon="info"
          title={`No ${what}${topicName ? ` on ${topicName}` : ''}`}
          action={(
            <div className="cluster">
              {status === 'open' && counts.cleared > 0 && <Button onClick={() => onFilter({ status: 'cleared' })}>Show cleared</Button>}
              {topicId && <Button variant="ghost" onClick={() => onFilter({ topicId: '' })}>Every topic</Button>}
            </div>
          )}
        >
          {status === 'open' && !topicId ? 'Every entry has cleared.' : null}
        </Empty>
      </div>
    );
  } else {
    list = (
      <>
        <ol className="hub-err-list" aria-label="Your error log, newest first">
          {entries.slice(0, shown).map((e) => <Entry key={e.id} entry={e} open={opened.has(e.id)} onToggle={() => toggle(e.id)} />)}
        </ol>
        {entries.length > shown ? (
          <div className="hub-err-more-row">
            <Button variant="ghost" icon="chevron" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({entries.length - shown} older)
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <HubPage crumb={crumb} title="Error log" actions={actions}>
      <div className="hub-err" ref={root} aria-busy={busy ? 'true' : undefined} data-stale={busy && data ? 'true' : undefined}>
        <div className="hub-err-bar">
          <Segmented label="Which entries" options={options} value={status} onChange={(s) => onFilter({ status: s })} />
          {topics.length > 0 && (
            <label className="hub-err-topicpick">
              <span className="sr-only">Topic</span>
              <select className="select input-sm" value={topicId} onChange={(e) => onFilter({ topicId: e.target.value })}>
                <option value="">Every topic</option>
                {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {data?.rule && <p className="hub-err-rule"><Icon name="info" size={14} />{data.rule}</p>}
        {error && data && (
          <div className="hub-map-stateserr" role="alert">
            <p><b>That did not load.</b> {error.message}</p>
            <Button size="sm" icon="refresh" busy={busy} onClick={onRetry}>Try again</Button>
          </div>
        )}
        {list}
      </div>
    </HubPage>
  );
}

/* ----------------------------------------------------------- the container */

export default function Errors() {
  const [params, setParams] = useSearchParams();
  const status = ['open', 'cleared', 'all'].includes(params.get('status')) ? params.get('status') : 'open';
  const topicId = params.get('topic') ?? '';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const [nonce, setNonce] = useState(0);
  // Every topic seen in a reply, so the topic filter keeps its choices while it narrows.
  const [known, setKnown] = useState(() => new Map());

  useEffect(() => {
    let alive = true;
    setBusy(true);
    hub.errors({ status: status === 'all' ? undefined : status, topicId: topicId || undefined }).then(
      (r) => {
        if (!alive) return;
        setData(r);
        setError(null);
        setBusy(false);
        setKnown((m) => {
          const n = new Map(m);
          (r.entries ?? []).forEach((e) => { if (e.topic?.id && !n.has(e.topic.id)) n.set(e.topic.id, e.topic.name); });
          return n;
        });
      },
      (e) => { if (alive) { setError(e); setBusy(false); } },
    );
    return () => { alive = false; };
  }, [status, topicId, nonce]);

  // The filter offers every topic in the log, so under a narrower view the
  // whole log is read once for its topics.
  const narrow = status !== 'all' || Boolean(topicId);
  const readAll = useRef(false);
  useEffect(() => {
    if (!narrow || readAll.current) return;
    readAll.current = true;
    // No unmount guard: a late reply only fills the filter's choices.
    hub.errors({}).then((r) => setKnown((m) => {
      const n = new Map(m);
      (r.entries ?? []).forEach((e) => { if (e.topic?.id && !n.has(e.topic.id)) n.set(e.topic.id, e.topic.name); });
      return n;
    }), () => {});
  }, [narrow]);

  const topics = useMemo(() => [...known].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [known]);

  const onFilter = (next) => {
    const p = new URLSearchParams(params);
    if (next.status !== undefined) { if (next.status === 'open') p.delete('status'); else p.set('status', next.status); }
    if (next.topicId !== undefined) { if (next.topicId) p.set('topic', next.topicId); else p.delete('topic'); }
    setParams(p, { replace: true });
  };

  return (
    <ErrorsView
      data={data}
      status={status}
      topicId={topicId}
      topics={topics}
      onFilter={onFilter}
      error={error}
      busy={busy}
      onRetry={() => setNonce((n) => n + 1)}
    />
  );
}
