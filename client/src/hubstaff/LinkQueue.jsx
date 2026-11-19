/**
 * /hubs/links: prerequisite links across the professor's chapters (an HOD's:
 * the department's), proposed ones first, each waiting for a decision. Links
 * by state with their counts, grouped by the chapter of the topic that needs
 * them, and "Suggest prerequisites" for chosen chapters.
 *
 * GET /api/hub/links (every state, so the counts are whole); a decision
 * updates the row from the reply. Links carry no canEdit of their own: a
 * professor's list holds only their own links, which they may decide; an
 * HOD's is the department's, read-only.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import { useViewer } from '../shell/viewer.js';
import { Button, Empty, Panel, Segmented } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import { LinkRow, useLinkActions } from './StaffLinks.jsx';
import { Name, Problem, ReadOnly, Skeleton, StaffPage, plural, useLoad } from './StaffParts.jsx';
import { SuggestDialog } from './StaffSuggest.jsx';

const STATES = ['proposed', 'confirmed', 'rejected'];
const WORD = { proposed: 'Proposed', confirmed: 'Confirmed', rejected: 'Rejected' };

export default function LinkQueue() {
  const { account } = useViewer();
  const load = useLoad(() => staffHub.links(), []);
  const [state, setState] = useState('proposed');
  const [suggesting, setSuggesting] = useState(false);
  const onChanged = (link, action, reply) => {
    const list = load.data?.links ?? [];
    const links = action === 'remove' ? list.filter((l) => l.id !== link.id) : list.map((l) => (l.id === link.id ? reply.link : l));
    load.set({ links, counts: countsOf(links) });
    // The row leaves this list, so say where it went.
    if (action === 'confirmed') toast('Confirmed. It now counts in the chains students see.');
    else if (action === 'rejected') toast('Rejected. It is kept, so it is not proposed again.');
  };
  const actions = useLinkActions(onChanged);
  return (
    <>
      <LinkQueueView
        data={load.data}
        error={load.error}
        loading={load.loading && !load.data}
        onRetry={load.reload}
        canEdit={account?.role === 'professor'}
        state={state}
        onState={setState}
        actions={actions}
        onSuggest={() => setSuggesting(true)}
      />
      {account?.role === 'professor' && (
        <SuggestDialog open={suggesting} onOpenChange={setSuggesting} onDone={() => load.reload()} />
      )}
    </>
  );
}

export const countsOf = (links) => Object.fromEntries(STATES.map((s) => [s, links.filter((l) => l.state === s).length]));

/** The page from data: GET /api/hub/links's { links, counts }. */
export function LinkQueueView({ data, error, loading, onRetry, canEdit, state = 'proposed', onState, actions, onSuggest }) {
  const trail = [{ label: 'Learning Hub', to: '/hubs' }, { label: 'Prerequisite links' }];
  const title = 'Prerequisite links';
  const sub = 'Which topic students need before another. Only confirmed links reach them; proposed ones are AI drafts until you decide.';
  const groups = useMemo(() => {
    const out = new Map();
    for (const l of data?.links ?? []) {
      if (l.state !== state) continue;
      const ch = l.topic.chapter ?? { id: '', title: '' };
      if (!out.has(ch.id)) out.set(ch.id, { chapter: ch, links: [] });
      out.get(ch.id).links.push(l);
    }
    return [...out.values()];
  }, [data, state]);

  if (error) {
    return (
      <StaffPage trail={trail} title={title}>
        <Problem error={error} onRetry={onRetry} />
      </StaffPage>
    );
  }
  if (loading || !data) {
    return (
      <StaffPage trail={trail} title={title} sub={sub}>
        <Skeleton rows={5} label="Loading the links" />
      </StaffPage>
    );
  }

  const counts = data.counts ?? countsOf(data.links ?? []);
  return (
    <StaffPage
      trail={trail}
      title={title}
      sub={sub}
      actions={canEdit ? <Button variant="primary" icon="idea" onClick={onSuggest}>Suggest prerequisites</Button> : null}
    >
      {!canEdit && <ReadOnly>Read-only. Only the professor who owns a chapter can decide its links.</ReadOnly>}

      <Panel className="hubs-brief" aria-label="Links waiting">
        <div className="hubs-brief-say">
          <span className="tag-mint">Links</span>
          <p className="hubs-lead">
            {counts.proposed
              ? `${plural(counts.proposed, 'proposed link')} ${counts.proposed === 1 ? 'waits' : 'wait'} for a decision.`
              : 'No proposed link is waiting.'}
          </p>
          <p className="hubs-brief-sub">
            A confirmed link puts one topic before another for every student on a class with those chapters. A rejected
            proposal is kept, so the AI does not propose it again.
          </p>
        </div>
        <div className="hubs-tiles">
          {STATES.map((s, i) => (
            <button
              key={s}
              type="button"
              className="ptile hubs-ptile-btn"
              aria-pressed={state === s}
              onClick={() => onState?.(s)}
              style={{ '--d': `${i * 0.6}s` }}
            >
              <span>{WORD[s]}</span>
              <b>{counts[s] ?? 0}</b>
              <small>{s === 'proposed' ? 'AI drafts, not used yet' : s === 'confirmed' ? 'in the chains students see' : 'kept, not proposed again'}</small>
            </button>
          ))}
        </div>
      </Panel>

      <section className="card" aria-labelledby="hubs-q-h">
        <div className="hubs-card-head">
          <div className="sec">
            <h2 id="hubs-q-h">{WORD[state]} links</h2>
            <p>Grouped by the chapter of the topic that needs them.</p>
          </div>
          <Segmented
            label="Which links"
            value={state}
            onChange={onState}
            options={STATES.map((s) => ({ id: s, label: WORD[s], count: counts[s] ?? 0 }))}
          />
        </div>
        {groups.length === 0 ? (
          <Empty icon="path" title={state === 'proposed' ? 'Nothing waiting' : `No ${state} links`}>
            {state === 'proposed'
              ? (canEdit
                ? 'Ask the AI to suggest prerequisites for some of your chapters, or add links by hand on a topic.'
                : 'No proposal waits for a decision in your department.')
              : null}
          </Empty>
        ) : groups.map((g) => (
          <div key={g.chapter.id} className="hubs-q-group">
            <h3 className="hubs-q-ch">
              <Link to={`/hubs/ch/${encodeURIComponent(g.chapter.id)}`}><Name html={g.chapter.titleHtml} text={g.chapter.title} /></Link>
              <span className="hubs-quiet">{plural(g.links.length, 'link')}</span>
            </h3>
            <ul className="hubs-links">
              {g.links.map((l) => <LinkRow key={l.id} link={l} show="pair" hereChapterId={g.chapter.id} canEdit={canEdit} actions={actions} />)}
            </ul>
          </div>
        ))}
      </section>
    </StaffPage>
  );
}
