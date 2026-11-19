/**
 * A chapter's topics tab: every topic record with its slides, its questions
 * and its links counted; retired ones greyed and kept last; the slides note;
 * topics on the chapter's list with no record yet ("Make topic records",
 * POST …/topics/sync); and questions that sit under no topic.
 *
 * `chapter` is GET /api/hub/chapters/:contentId's `chapter` (staff, with
 * canEdit); a sync replies with the fresh one (onChapter).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import { Button, Chip, Icon, Note, Panel } from '../ui/index.jsx';
import { Name, Refusal, plural } from './StaffParts.jsx';

const topicPath = (id) => `/hubs/t/${encodeURIComponent(id)}`;
const day = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
};

/** "3, 4, 7" or "3–5, 9" from slide numbers. */
export function slideList(nums = []) {
  const s = [...new Set(nums.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j += 1;
    out.push(j - i >= 2 ? `${s[i]}–${s[j]}` : j > i ? `${s[i]}, ${s[j]}` : `${s[i]}`);
    i = j;
  }
  return out.join(', ');
}

export default function ChapterTopics({ contentId, chapter, onChapter, api = staffHub, synced: syncedInit = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [synced, setSynced] = useState(syncedInit);

  if (!chapter) return null;
  const canEdit = Boolean(chapter.canEdit);
  const topics = chapter.topics ?? [];
  const live = topics.filter((x) => !x.retired);
  const retired = topics.filter((x) => x.retired);
  const questions = live.reduce((n, x) => n + (x.questions?.active ?? 0), 0);
  const drafts = live.reduce((n, x) => n + (x.questions?.draft ?? 0), 0);
  const linked = live.filter((x) => (x.links?.prerequisites ?? 0) > 0).length;
  const proposed = live.reduce((n, x) => n + (x.links?.proposed ?? 0), 0);

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await api.syncTopics(contentId ?? chapter.id);
      setSynced(reply);
      if (reply.chapter) onChapter?.(reply.chapter);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hubs-topics">
      <Panel className="hubs-brief" aria-label="This chapter's topics">
        <div className="hubs-brief-say">
          <span className="tag-mint">Topics</span>
          <p className="hubs-lead">
            {live.length === 0
              ? 'This chapter has no topic records yet.'
              : `${plural(live.length, 'topic')}, with ${plural(questions, 'approved question')} under them.`}
          </p>
          <p className="hubs-brief-sub">{chapter.slides?.note}</p>
        </div>
        <div className="hubs-tiles">
          <div className="ptile">
            <span>Topics</span>
            <b>{live.length}</b>
            <small>{retired.length ? `${retired.length} retired, kept for their questions` : 'none retired'}</small>
          </div>
          <div className="ptile" style={{ '--d': '0.6s' }}>
            <span>Approved questions</span>
            <b>{questions}</b>
            <small>{drafts ? `${plural(drafts, 'draft')} waiting in the bank` : 'no drafts waiting'}</small>
          </div>
          <div className="ptile" style={{ '--d': '1.2s' }}>
            <span>With a prerequisite</span>
            <b>{linked}</b>
            <small>{proposed ? `${plural(proposed, 'proposed link')} to decide` : `of ${plural(live.length, 'topic')}`}</small>
          </div>
        </div>
      </Panel>

      {chapter.unsynced?.length > 0 && (
        <Note tone="warn" className="hubs-sync">
          <p>
            <b>{plural(chapter.unsynced.length, 'topic')} on this chapter’s list {chapter.unsynced.length === 1 ? 'has' : 'have'} no record yet</b>, so
            students cannot reach {chapter.unsynced.length === 1 ? 'it' : 'them'}: {chapter.unsynced.join(', ')}.
          </p>
          {canEdit && (
            <div className="hubs-sync-act">
              <Button variant="primary" size="sm" icon="refresh" busy={busy} onClick={sync}>Make topic records</Button>
            </div>
          )}
          <Refusal error={error} onDismiss={() => setError(null)} />
        </Note>
      )}

      {synced && <SyncResult result={synced} onDismiss={() => setSynced(null)} />}

      {chapter.unmatchedQuestions > 0 && (
        <Note icon="info">
          {plural(chapter.unmatchedQuestions, 'question')} {chapter.unmatchedQuestions === 1 ? 'sits' : 'sit'} under a topic name this chapter’s list never held, so {chapter.unmatchedQuestions === 1 ? 'it belongs' : 'they belong'} to no topic here and practice cannot serve {chapter.unmatchedQuestions === 1 ? 'it' : 'them'}.
        </Note>
      )}

      <section className="card hubs-topic-table" aria-labelledby="hubs-topics-h">
        <div className="hubs-card-head">
          <div className="sec">
            <h2 id="hubs-topics-h">Topics, in the chapter’s order</h2>
            <p>Open a topic to set what students need first, or to see its lessons.</p>
          </div>
        </div>
        {topics.length === 0 ? (
          <p className="hubs-quiet hubs-pad">No topic records. {canEdit && chapter.unsynced?.length ? 'Make them from the chapter’s list above.' : ''}</p>
        ) : (
          <>
            <div className="hubs-trow hubs-trow-head" aria-hidden="true">
              <span>#</span><span>Topic</span><span>Slides</span><span>Questions</span><span>Links</span>
            </div>
            <ol className="hubs-tlist">
              {[...live, ...retired].map((x) => (
                <li key={x.id} className="hubs-trow" data-retired={x.retired || undefined}>
                  <span className="hubs-t-pos">{x.retired ? '' : x.position}</span>
                  <span className="hubs-t-name">
                    <Link to={topicPath(x.id)}><Name html={x.nameHtml} text={x.name} /></Link>
                    {x.retired && <Chip className="hubs-chip-sm">Retired{x.retiredAt ? ` ${day(x.retiredAt)}` : ''}</Chip>}
                  </span>
                  <span className="hubs-t-cell" data-label="Slides">{x.slides?.length ? slideList(x.slides) : <span className="hubs-dash">none</span>}</span>
                  <span className="hubs-t-cell" data-label="Questions">
                    {x.questions?.active ?? 0} approved
                    {(x.questions?.draft ?? 0) > 0 && <span className="hubs-t-sub">{plural(x.questions.draft, 'draft')}</span>}
                  </span>
                  <span className="hubs-t-cell" data-label="Links">
                    {x.links?.prerequisites ?? 0} before · {x.links?.dependants ?? 0} after
                    {(x.links?.proposed ?? 0) > 0 && <span className="hubs-t-sub">{x.links.proposed} proposed</span>}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

/** What a sync did, name by name. */
export function SyncResult({ result, onDismiss }) {
  const parts = [
    ['Made', result.added],
    ['Restored', result.restored],
    ['Retired', result.retired],
    ['Removed', result.removed],
    ['Skipped (name too long)', result.skipped],
  ].filter(([, list]) => list?.length);
  return (
    <Note tone="ok" className="hubs-synced">
      <div className="hubs-synced-head">
        <b className="grow">{parts.length ? 'Topic records updated.' : 'Topic records were already up to date.'}</b>
        {onDismiss && <button type="button" className="hubs-x" onClick={onDismiss} aria-label="Dismiss"><Icon name="close" size={13} /></button>}
      </div>
      {parts.length > 0 && (
        <dl className="hubs-synced-list">
          {parts.map(([label, list]) => (
            <div key={label}><dt>{label}</dt><dd>{list.join(', ')}</dd></div>
          ))}
        </dl>
      )}
      {result.retiredNote && <p className="hubs-quiet">{result.retiredNote}</p>}
    </Note>
  );
}
