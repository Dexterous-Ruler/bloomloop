/**
 * A topic's prerequisites, nearest first, from GET /api/hub/topics/:id. The
 * topic screen (Topic.jsx) renders it under its own "Before this topic"
 * heading, inside its card, so this draws no card and no heading:
 *
 *   <Prereqs topic={reply.topic} prerequisites={reply.prerequisites} leadsTo={reply.leadsTo} note={reply.note} />
 *
 * Optional `states`: GET /api/hub/progress's `topics`, when the screen has
 * read them already. Without it, Prereqs reads them itself, so each topic in
 * the chain says where the student stands on it; a failed read leaves the
 * chain up and says why.
 *
 * The chain is drawn twice: as the layered map (MapGraph.jsx), its links from
 * each prerequisite's `via` (the topics one step nearer this one that need
 * it), and as a list in the server's order with the same facts in words. A
 * prerequisite with `onYourClasses: false` is from earlier material: its name
 * and chapter are shown, never a link (its topic answers 404 to a student).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { hub } from './hubApi.js';
import { MapGraph, StateMark } from './MapGraph.jsx';
import RichText from './RichText.jsx';

const topicHref = (id) => `/hub/t/${encodeURIComponent(id)}`;
const answersLine = (n) => (n ? `based on ${n} ${n === 1 ? 'answer' : 'answers'}` : 'No answers yet');

/** "A", "A and B", "A, B and C". */
const listed = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The links of the chain: each prerequisite to the topics in its `via`. */
export function chainLinks(topic, prerequisites) {
  const known = new Set([topic.id, ...prerequisites.map((p) => p.id)]);
  return prerequisites.flatMap((p) => {
    const via = (p.via ?? []).filter((v) => known.has(v) && v !== p.id);
    // `via` can name a retired topic the student is not sent: the chain still
    // runs through it, so the link is drawn to this topic instead.
    return (via.length ? via : [topic.id]).map((to) => ({ from: p.id, to }));
  });
}

/**
 * @param topic          { id, name, nameHtml, chapter }
 * @param prerequisites  [{ id, name, nameHtml, chapter, depth, via, onYourClasses }], nearest first
 * @param leadsTo        the same shape: what needs this topic, nearest first
 * @param note           the server's sentence on what prerequisites are
 * @param states         progress `topics` ([{ id, state }]), or null while they load
 * @param statesError    why they did not load, or ''
 */
export function PrereqsView({ topic, prerequisites = [], leadsTo = [], note, states = null, statesError = '' }) {
  const [picked, setPicked] = useState(null);
  const rows = useRef({});
  const byId = useMemo(() => new Map((states ?? []).map((t) => [t.id, t.state])), [states]);
  const names = useMemo(
    () => new Map([[topic.id, topic.name], ...prerequisites.map((p) => [p.id, p.name])]),
    [topic, prerequisites],
  );

  // Farthest first, so the map's layers open on the roots.
  const ids = useMemo(
    () => [...[...prerequisites].sort((a, b) => b.depth - a.depth).map((p) => p.id), topic.id],
    [topic.id, prerequisites],
  );
  const links = useMemo(() => chainLinks(topic, prerequisites), [topic, prerequisites]);
  const nodes = useMemo(() => {
    const out = { [topic.id]: { name: topic.name, nameHtml: topic.nameHtml, state: byId.get(topic.id)?.state, label: byId.get(topic.id)?.label } };
    for (const p of prerequisites) {
      const s = byId.get(p.id);
      out[p.id] = p.onYourClasses === false
        ? { name: p.name, nameHtml: p.nameHtml, state: 'earlier', label: 'Earlier material' }
        : { name: p.name, nameHtml: p.nameHtml, state: s?.state, label: s?.label };
    }
    return out;
  }, [topic, prerequisites, byId]);

  const pick = (id) => {
    setPicked(id);
    rows.current[id]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };

  if (!prerequisites.length) {
    return (
      <div className="hub-pre">
        <p className="hub-pre-none">
          <StateMark state="none" />
          Nothing has to come before this topic: your professor has not confirmed a prerequisite for it.
        </p>
        <LeadsTo leadsTo={leadsTo} />
      </div>
    );
  }

  return (
    <div className="hub-pre">
      {note && <p className="hub-pre-note">{note}</p>}
      {statesError && <p className="hub-pre-err" role="alert">Where you stand on these did not load: {statesError}</p>}

      {prerequisites.length > 1 && (
        <div className="hub-pre-map">
          <MapGraph
            ids={ids}
            topics={nodes}
            links={links}
            targetId={topic.id}
            targetWord="This topic"
            picked={picked}
            onPick={pick}
            label={`The chain before ${topic.name}: ${prerequisites.length} topics, earliest first. Choose one to find it in the list.`}
          />
          <div className="hub-map-key" aria-hidden="true">
            <span><svg width="26" height="8" focusable="false"><path d="M1 4h24" className="k-met" /></svg>Earlier topic mastered</span>
            <span><svg width="26" height="8" focusable="false"><path d="M1 4h24" className="k-not" /></svg>Not yet</span>
          </div>
        </div>
      )}

      <ol className="hub-pre-list" aria-label={`Before ${topic.name}, nearest first`}>
        {prerequisites.map((p) => {
          const earlier = p.onYourClasses === false;
          const s = earlier ? null : byId.get(p.id);
          const via = (p.via ?? []).filter((v) => v !== topic.id).map((v) => names.get(v)).filter(Boolean);
          const need = p.depth <= 1 || !via.length ? 'Needed directly' : `Needed for ${listed(via)}`;
          return (
            <li
              key={p.id}
              ref={(el) => { rows.current[p.id] = el; }}
              className="hub-pre-row"
              data-on={picked === p.id ? 'true' : undefined}
              data-earlier={earlier ? 'true' : undefined}
            >
              <StateMark state={earlier ? 'earlier' : s?.state ?? 'none'} />
              <div className="hub-pre-body">
                <span className="hub-pre-name">
                  {earlier
                    ? <RichText as="span" html={p.nameHtml} text={p.name} />
                    : <Link to={topicHref(p.id)}><RichText as="span" html={p.nameHtml} text={p.name} /></Link>}
                  {earlier && <span className="hub-pre-tag">Earlier material</span>}
                </span>
                <span className="hub-pre-meta">
                  {p.chapter?.title && <RichText as="span" html={p.chapter.titleHtml} text={p.chapter.title} />}
                  <span>{need}</span>
                  {earlier
                    ? <span>On none of your classes</span>
                    : s && <><span className="hub-pre-state">{s.label}</span><span>{answersLine(s.answers)}</span></>}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <LeadsTo leadsTo={leadsTo} />
    </div>
  );
}

function LeadsTo({ leadsTo }) {
  if (!leadsTo?.length) return null;
  return (
    <p className="hub-pre-next">
      <span className="hub-pre-next-lead">Leads to</span>
      {leadsTo.map((t, i) => (
        <span key={t.id} className="hub-pre-next-item">
          {t.onYourClasses === false
            ? <><RichText as="span" html={t.nameHtml} text={t.name} /> <small>(not on your classes)</small></>
            : <Link to={topicHref(t.id)}><RichText as="span" html={t.nameHtml} text={t.name} /></Link>}
          {i < leadsTo.length - 1 && <span aria-hidden="true">,</span>}
        </span>
      ))}
    </p>
  );
}

/** As the topic screen renders it; reads the student's states when it is not handed them. */
export default function Prereqs({ topic, prerequisites = [], leadsTo = [], note, states }) {
  const [own, setOwn] = useState(null);
  const [error, setError] = useState('');
  const wanted = states === undefined && prerequisites.length > 0;

  useEffect(() => {
    if (!wanted) return undefined;
    let alive = true;
    hub.progress().then(
      (r) => { if (alive) { setOwn(r.topics ?? []); setError(''); } },
      (e) => { if (alive) setError(e.message || 'The server did not answer.'); },
    );
    return () => { alive = false; };
  }, [wanted, topic?.id]);

  if (!topic) return null;
  return (
    <PrereqsView
      topic={topic}
      prerequisites={prerequisites}
      leadsTo={leadsTo}
      note={note}
      states={states ?? own}
      statesError={states ? '' : error}
    />
  );
}
