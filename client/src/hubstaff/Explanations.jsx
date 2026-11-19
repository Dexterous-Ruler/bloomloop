/**
 * A chapter's explanations: what a student reads after answering each
 * question (docs/API.md, Phase 6, "Professor: the review queues").
 *
 *   GET    /api/hub/chapters/:id/explanations
 *   PUT    /api/hub/questions/:id/explanation          write or rewrite (approved as written)
 *   POST   /api/hub/questions/:id/explanation/approve  approve an AI draft
 *   DELETE /api/hub/questions/:id/explanation          remove it
 *   POST   /api/hub/explanations/generate { contentId, runId }, its run polled
 *
 * A tab inside the chapter's frame: content only. An AI draft is marked as
 * one and says it is not shown to students until approved. With no model the
 * press drafts nothing and the server's note says so, plainly. Every control
 * hides when `canEdit` is false (an HOD).
 */

import { useCallback, useId, useMemo, useState } from 'react';

import { staffHub } from '../hub/hubApi.js';
import RichText from '../hub/RichText.jsx';
import { Button, Icon, Segmented } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import {
  QMeta, QueueFailed, QueueLoading, RunLine, StaleRead, TextSlot, WhoLine,
  list, namesOf, pickFilter, plural, useQueue, useRun,
} from './QueueParts.jsx';

const MAX = 2000;

const RUN_WORDS = {
  running: 'Drafting explanations',
  done: 'Drafting finished',
  progress: (run) => (run.topicsTotal ? `${run.topicsDone ?? 0} of ${plural(run.topicsTotal, 'question')}` : ''),
};

const stateOf = (q) => q.explanation?.status ?? 'none';

/* ---------------------------------------------------------------- one row */

function Row({ q, canEdit, onWrite, onApprove, onRemove }) {
  const [mode, setMode] = useState('');
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState(null);
  const qid = useId();
  const e = q.explanation;

  const act = async (what, fn) => {
    setBusy(what);
    setSaid(null);
    try {
      // The row may leave the filter once the list is read again: the server's sentence is a toast.
      toast(await fn());
      setMode('');
    } catch (err) {
      setSaid({ tone: 'bad', text: err?.message || 'The server did not answer.' });
    }
    setBusy('');
  };

  return (
    <li className="hq-row" data-state={stateOf(q)}>
      <div className="hq-row-q">
        <QMeta q={q} />
        <p id={qid} className="hq-qtext">{q.text}</p>
      </div>

      {mode === 'write' ? (
        <TextSlot
          label={`Explanation for: ${q.text}`}
          initial={e?.text ?? ''}
          max={MAX}
          rows={5}
          hint="Why the right answer is right. Saved as written, and approved."
          saveLabel={e ? 'Save and approve' : 'Save'}
          onCancel={() => setMode('')}
          onSave={async (text) => {
            await onWrite(q.questionId, text);
            setMode('');
          }}
        />
      ) : e ? (
        <div className="hq-slot" data-status={e.status}>
          <WhoLine status={e.status} provenance={e.provenance} label={e.label} model={e.model} />
          <RichText className="hq-slot-text" html={e.textHtml} text={e.text} />
          {canEdit && mode === 'remove' && (
            <div className="hq-confirm" role="group" aria-label="Remove this explanation">
              <span>Remove this explanation? Students stop seeing it.</span>
              <span className="cluster cluster-1">
                <Button aria-describedby={qid} size="sm" variant="ghost" onClick={() => setMode('')} disabled={busy === 'remove'}>Keep it</Button>
                <Button aria-describedby={qid} size="sm" variant="danger" icon="trash" busy={busy === 'remove'} onClick={() => act('remove', () => onRemove(q.questionId))}>Remove</Button>
              </span>
            </div>
          )}
          {canEdit && mode !== 'remove' && (
            <div className="hq-actions">
              {e.status === 'draft' && (
                <Button aria-describedby={qid} size="sm" variant="primary" icon="check" busy={busy === 'approve'} onClick={() => act('approve', () => onApprove(q.questionId))}>Approve</Button>
              )}
              <Button aria-describedby={qid} size="sm" icon="edit" onClick={() => { setSaid(null); setMode('write'); }}>{e.status === 'draft' ? 'Edit' : 'Rewrite'}</Button>
              {e.status === 'draft'
                ? <Button aria-describedby={qid} size="sm" variant="ghost" icon="trash" busy={busy === 'remove'} onClick={() => act('remove', () => onRemove(q.questionId))}>Discard</Button>
                : <Button aria-describedby={qid} size="sm" variant="ghost" icon="trash" onClick={() => { setSaid(null); setMode('remove'); }}>Remove</Button>}
            </div>
          )}
        </div>
      ) : (
        <div className="hq-slot hq-slot-empty">
          <span>No explanation yet.</span>
          {canEdit && <Button aria-describedby={qid} size="sm" icon="plus" onClick={() => { setSaid(null); setMode('write'); }}>Write one</Button>}
        </div>
      )}

      {said && <p className={`hq-said hq-said-${said.tone}`} role={said.tone === 'bad' ? 'alert' : 'status'}>{said.text}</p>}
    </li>
  );
}

/* ---------------------------------------------------------------- the view */

/**
 * @param data      the GET reply
 * @param run       useRun's state for "Draft with AI", or null
 * @param onDraft   start the run; onClearRun dismisses its line
 * @param onWrite(questionId, text) / onApprove(questionId) / onRemove(questionId)
 *                  each a promise; remove resolves with the server's sentence
 */
export function ExplanationsView({ data, run, onDraft, onClearRun, onWrite, onApprove, onRemove, error, filter, onFilter }) {
  const canEdit = data.canEdit === true;
  const questions = list(data.questions);
  const counts = data.counts ?? {};
  const options = [
    { id: 'draft', label: 'AI drafts to review', count: counts.draft ?? 0 },
    { id: 'none', label: 'No explanation', count: counts.none ?? 0 },
    { id: 'approved', label: 'Approved', count: counts.approved ?? 0 },
    { id: 'all', label: 'All', count: questions.length },
  ];
  const shown = pickFilter(options, filter);
  const rows = shown === 'all' ? questions : questions.filter((q) => stateOf(q) === shown);
  const names = useMemo(() => namesOf(questions), [questions]);

  return (
    <div className="hq">
      <div className="hq-bar">
        <Segmented label="Show" options={options} value={shown} onChange={onFilter} />
        {canEdit && (
          <Button variant="primary" icon="spark" busy={run?.phase === 'running'} onClick={onDraft}>
            Draft with AI
          </Button>
        )}
      </div>
      {data.note && <p className="hq-note">{data.note}</p>}
      <StaleRead error={error} />
      <RunLine state={run} words={RUN_WORDS} onClear={onClearRun} names={names} />

      {questions.length === 0 ? (
        <div className="card hq-empty">
          <Icon name="bank" size={18} />
          <p>No approved or draft questions in this chapter yet, so there is nothing to explain. Polls are left out: they have no right answer.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card hq-empty"><Icon name="check" size={18} /><p>Nothing here under “{options.find((o) => o.id === shown)?.label}”.</p></div>
      ) : (
        <ul className="card hq-list">
          {rows.map((q) => (
            <Row key={q.questionId} q={q} canEdit={canEdit} onWrite={onWrite} onApprove={onApprove} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the tab */

export default function Explanations({ contentId }) {
  const read = useCallback(() => staffHub.explanations(contentId), [contentId]);
  const q = useQueue(read);
  const run = useRun(staffHub.explanationRun);
  const [filter, setFilter] = useState('');

  const put = (questionId, explanation) => q.patch((d) => ({
    ...d,
    questions: list(d.questions).map((x) => (x.questionId === questionId ? { ...x, explanation } : x)),
  }));

  if (!q.data) {
    if (q.error) return <QueueFailed error={q.error} onRetry={() => q.reload()} busy={q.loading} what="The explanations" />;
    return <QueueLoading />;
  }

  return (
    <ExplanationsView
      data={q.data}
      error={q.error}
      filter={filter}
      onFilter={setFilter}
      run={run.state}
      onClearRun={run.clear}
      onDraft={() => run.start(
        (runId) => staffHub.draftExplanations({ contentId, runId }),
        { onDone: () => q.reload({ quiet: true }) },
      )}
      onWrite={async (questionId, text) => {
        const r = await staffHub.writeExplanation(questionId, text);
        put(questionId, r.explanation);
        q.reload({ quiet: true });
      }}
      onApprove={async (questionId) => {
        const r = await staffHub.approveExplanation(questionId);
        put(questionId, r.explanation);
        q.reload({ quiet: true });
      }}
      onRemove={async (questionId) => {
        const r = await staffHub.removeExplanation(questionId);
        put(questionId, null);
        q.reload({ quiet: true });
        return r.message;
      }}
    />
  );
}
