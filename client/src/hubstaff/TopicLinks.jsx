/**
 * A topic's links tab: what it needs first and what needs it, in every state
 * (proposed, confirmed, rejected) with who proposed each and why; adding one
 * by hand (POST /api/hub/links: a loop is a 409 whose sentence names the
 * chain, shown as it is); confirming, rejecting and removing; the chain
 * students see (confirmed links only, nearest first); and "Suggest
 * prerequisites" for the topic's chapter.
 *
 * `view` is GET /api/hub/topics/:topicId as staff get it; after every write
 * the frame reads it again (onReload). `canEdit` is the chapter's.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import { Button, Panel, Segmented } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import { LinkRow, byDecision, useLinkActions } from './StaffLinks.jsx';
import { Name, Refusal, plural } from './StaffParts.jsx';
import { SuggestDialog } from './StaffSuggest.jsx';

const topicPath = (id) => `/hubs/t/${encodeURIComponent(id)}`;
const count = (list, state) => list.filter((l) => l.state === state).length;
const steps = (depth) => (depth <= 1 ? 'directly' : `${depth} links away`);

export default function TopicLinks({ view, canEdit, onReload, api = staffHub }) {
  const actions = useLinkActions(() => onReload?.(), api);
  const [suggesting, setSuggesting] = useState(false);
  if (!view) return null;
  const topic = view.topic;
  const before = [...(view.links?.prerequisites ?? [])].sort(byDecision);
  const after = [...(view.links?.dependants ?? [])].sort(byDecision);
  const all = [...before, ...after];
  const waiting = count(all, 'proposed');
  const retired = Boolean(topic.retiredAt || topic.retired);

  return (
    <div className="hubs-tlinks">
      <Panel className="hubs-brief" aria-label="This topic's prerequisites">
        <div className="hubs-brief-say">
          <span className="tag-mint">Prerequisites</span>
          <p className="hubs-lead">
            {view.prerequisites.length === 0
              ? 'Students see nothing needed before this topic.'
              : `Students see ${plural(view.prerequisites.length, 'topic')} needed before this one, nearest first.`}
          </p>
          <p className="hubs-brief-sub">{view.note}</p>
        </div>
        <div className="hubs-tiles">
          <div className="ptile">
            <span>Needed first</span>
            <b>{count(before, 'confirmed')}</b>
            <small>confirmed, directly</small>
          </div>
          <div className="ptile" style={{ '--d': '0.6s' }}>
            <span>Leads to</span>
            <b>{count(after, 'confirmed')}</b>
            <small>confirmed, directly</small>
          </div>
          <div className="ptile" style={{ '--d': '1.2s' }}>
            <span>Proposed</span>
            <b>{waiting}</b>
            <small>{waiting ? 'waiting for your decision' : 'nothing waiting'}</small>
          </div>
        </div>
      </Panel>

      <section className="card" aria-labelledby="hubs-before-h">
        <div className="hubs-card-head">
          <div className="sec">
            <h2 id="hubs-before-h">Needed before this topic</h2>
            <p>Direct links into <Name html={topic.nameHtml} text={topic.name} />, in every state.</p>
          </div>
        </div>
        {before.length === 0 ? (
          <p className="hubs-quiet hubs-pad">No link into this topic yet.</p>
        ) : (
          <ul className="hubs-links">
            {before.map((l) => <LinkRow key={l.id} link={l} show="prerequisite" hereChapterId={topic.chapter?.id} canEdit={canEdit} actions={actions} />)}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="hubs-after-h">
        <div className="hubs-card-head">
          <div className="sec">
            <h2 id="hubs-after-h">Topics that need this one</h2>
            <p>Direct links out of <Name html={topic.nameHtml} text={topic.name} />, in every state.</p>
          </div>
        </div>
        {after.length === 0 ? (
          <p className="hubs-quiet hubs-pad">No topic needs this one yet.</p>
        ) : (
          <ul className="hubs-links">
            {after.map((l) => <LinkRow key={l.id} link={l} show="topic" hereChapterId={topic.chapter?.id} canEdit={canEdit} actions={actions} />)}
          </ul>
        )}
      </section>

      {canEdit && !retired && (
        <AddLink topic={topic} onAdded={onReload} onSuggest={() => setSuggesting(true)} api={api} />
      )}
      {canEdit && retired && (
        <p className="hubs-quiet">This topic is retired: it is no longer on its chapter’s list, so no new link can join it.</p>
      )}

      <section className="card hubs-chain" aria-labelledby="hubs-chain-h">
        <div className="hubs-card-head">
          <div className="sec">
            <h2 id="hubs-chain-h">The chain students see</h2>
            <p>Confirmed links only, followed back and forward from this topic.</p>
          </div>
        </div>
        <div className="hubs-chain-cols">
          <ChainList title="Needed first, nearest first" items={view.prerequisites} empty="Nothing before it." />
          <ChainList title="Leads to" items={view.leadsTo} empty="Nothing after it." />
        </div>
      </section>

      {canEdit && (
        <SuggestDialog
          open={suggesting}
          onOpenChange={setSuggesting}
          preset={topic.chapter?.id ? [topic.chapter.id] : []}
          onDone={() => onReload?.()}
          api={api}
        />
      )}
    </div>
  );
}

function ChainList({ title, items = [], empty }) {
  return (
    <div className="hubs-chain-col">
      <h3 className="hubs-h3">{title}</h3>
      {items.length === 0 ? <p className="hubs-quiet">{empty}</p> : (
        <ol className="hubs-chain-list">
          {items.map((x) => (
            <li key={x.id} style={{ '--depth': Math.min(x.depth ?? 1, 6) - 1 }}>
              <Link to={topicPath(x.id)}><Name html={x.nameHtml} text={x.name} /></Link>
              <span className="hubs-quiet">{steps(x.depth ?? 1)}{x.chapter?.title ? ` · ${x.chapter.title}` : ''}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Add a link by hand: a topic needed before this one, or one that needs it.
 * The other topic can come from any of the professor's chapters.
 */
function AddLink({ topic, onAdded, onSuggest, api }) {
  const [dir, setDir] = useState('before');
  const [chapters, setChapters] = useState(null);
  const [chapterId, setChapterId] = useState(topic.chapter?.id ?? '');
  const [topics, setTopics] = useState(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let on = true;
    api.ownChapters().then(
      (r) => { if (on) setChapters(r.contents ?? []); },
      () => { if (on) setChapters([]); },
    );
    return () => { on = false; };
  }, [api]);

  useEffect(() => {
    if (!chapterId) return undefined;
    let on = true;
    setTopics(null);
    setPick('');
    api.chapter(chapterId).then(
      (r) => { if (on) setTopics((r.chapter?.topics ?? []).filter((x) => !x.retired && x.id !== topic.id)); },
      (err) => { if (on) { setTopics([]); setError(err); } },
    );
    return () => { on = false; };
  }, [api, chapterId, topic.id]);

  const add = async (e) => {
    e.preventDefault();
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const body = dir === 'before' ? { prerequisiteId: pick, topicId: topic.id } : { prerequisiteId: topic.id, topicId: pick };
      const { link } = await api.addLink(body);
      toast(`Linked: "${link.prerequisite.name}" before "${link.topic.name}".`);
      setPick('');
      onAdded?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const list = chapters ?? [];
  const hasHere = list.some((c) => String(c._id ?? c.id) === topic.chapter?.id);
  return (
    <section className="card hubs-addlink" aria-labelledby="hubs-addlink-h">
      <div className="hubs-card-head">
        <div className="sec">
          <h2 id="hubs-addlink-h">Add a link</h2>
          <p>A link you add is confirmed at once. Or let the AI propose links across your chapters, for you to confirm.</p>
        </div>
        <Button icon="idea" onClick={onSuggest}>Suggest prerequisites</Button>
      </div>
      <form className="hubs-addlink-form" onSubmit={add}>
        <Segmented
          label="Which way the link goes"
          value={dir}
          onChange={setDir}
          options={[{ id: 'before', label: 'Needed before this topic' }, { id: 'after', label: 'Needs this topic' }]}
        />
        <div className="hubs-addlink-row">
          <div className="field">
            <label className="label" htmlFor="hubs-al-ch">Chapter</label>
            <select id="hubs-al-ch" className="select" value={chapterId} onChange={(e) => setChapterId(e.target.value)} disabled={!chapters}>
              {!hasHere && topic.chapter && <option value={topic.chapter.id}>{topic.chapter.title}</option>}
              {list.map((c) => <option key={String(c._id ?? c.id)} value={String(c._id ?? c.id)}>{c.title}</option>)}
            </select>
          </div>
          <div className="field grow">
            <label className="label" htmlFor="hubs-al-t">Topic</label>
            <select id="hubs-al-t" className="select" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!topics?.length}>
              <option value="">{!topics ? 'Loading the topics' : topics.length ? 'Choose a topic' : 'No other topic here'}</option>
              {(topics ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <Button type="submit" variant="primary" icon="link" busy={busy} disabled={!pick}>Add link</Button>
        </div>
        <Refusal error={error} onDismiss={() => setError(null)} />
      </form>
    </section>
  );
}
