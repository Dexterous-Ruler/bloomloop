/**
 * A chapter's hints and option feedback: the tutor (docs/API.md, Phase 6,
 * "Professor: the review queues", and "The tutor (H13)").
 *
 *   GET    /api/hub/chapters/:id/hints
 *   PUT    /api/hub/questions/:id/hints/:step        write or rewrite step 1, 2 or 3 (approved as written)
 *   DELETE /api/hub/questions/:id/hints/:step
 *   PUT    /api/hub/questions/:id/feedback/:option   feedback on a wrong option (from 0)
 *   DELETE /api/hub/questions/:id/feedback/:option
 *   POST   /api/hub/questions/:id/hints/approve      { steps?, options? }, all AI drafts when neither
 *   POST   /api/hub/chapters/:id/hints/generate      202, then /api/hub/hints/run/:runId
 *
 * Each question has three step slots and, when its kind takes feedback, one
 * slot per wrong option. A 400 that refuses a hint for giving the answer away
 * is said under the box, as the server words it, with the text kept. A hint the
 * question has since made a leak carries the server's warning; feedback whose
 * option changed is listed apart (noLongerShown). Every control hides when
 * `canEdit` is false (an HOD).
 */

import { useCallback, useId, useMemo, useState } from 'react';

import { staffHub } from '../hub/hubApi.js';
import RichText from '../hub/RichText.jsx';
import { Button, Icon, Note, Segmented } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import {
  Notes, QMeta, QueueFailed, QueueLoading, RunLine, StaleRead, TextSlot, WhoLine,
  list, namesOf, pickFilter, plural, saysRun, useQueue, useRun,
} from './QueueParts.jsx';

const MAX = 600;
const STEPS = [1, 2, 3];
// The server's own labels for a slot with no hint in it yet (services/hubTutor.js, STEP_LABEL_STAFF).
const STEP_LABEL = {
  1: 'Hint 1: a nudge',
  2: 'Hint 2: a strategy',
  3: 'Hint 3: a worked step that stops short of the answer',
};

const RUN_WORDS = {
  running: 'Drafting hints and feedback',
  done: 'Drafting finished',
  progress: (run) => (run.topicsTotal ? `${run.topicsDone ?? 0} of ${plural(run.topicsTotal, 'question')}` : ''),
};

const draftsOf = (q) => (q.counts?.hints?.draft ?? 0) + (q.counts?.feedback?.draft ?? 0);
const leaksOf = (q) => list(q.hints).filter((h) => h.leak).length + list(q.options).filter((o) => o.feedback?.leak).length;
const needsLook = (q) => draftsOf(q) > 0 || leaksOf(q) > 0 || list(q.noLongerShown).length > 0;
const wrongOptions = (q) => list(q.options);
const withFeedback = (q) => wrongOptions(q).filter((o) => o.feedback).length;

/** What "Approve drafts" could not approve, each with the server's reason. */
function Refused({ refused }) {
  if (!refused?.length) return null;
  return (
    <ul className="hq-refused-list" role="alert">
      {refused.map((r, i) => (
        <li key={i}>
          <Icon name="alert" size={15} />
          <span><b>{r.step != null ? STEP_LABEL[r.step] ?? `Hint ${r.step}` : `Feedback on “${r.option}”`}.</b> {r.why}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------ one slot */

/**
 * One hint or one option's feedback: written, an AI draft, or empty.
 * `onWrite(text)`, `onRemove()` and `onApprove()` resolve with the server's
 * reply: its `message` is a toast (the question may leave the filter once the
 * list is read again); a refusal stays under the slot.
 */
function Slot({ title, sub, piece, canEdit, what, onWrite, onRemove, onApprove }) {
  const [mode, setMode] = useState('');
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState(null);
  const tid = useId();

  const act = async (name, fn) => {
    setBusy(name);
    setSaid(null);
    try {
      const r = await fn();
      if (list(r?.approved).length || !list(r?.refused).length) toast(r?.message);
      setSaid(list(r?.refused).length ? { tone: 'bad', text: list(r.approved).length ? '' : r.message, refused: r.refused } : null);
      setMode('');
    } catch (err) {
      setSaid({ tone: 'bad', text: err?.message || 'The server did not answer.' });
    }
    setBusy('');
  };

  const draft = piece?.status === 'draft';
  return (
    <div className="hq-piece" data-status={piece ? piece.status : 'empty'} data-leak={piece?.leak ? 'true' : undefined}>
      <div className="hq-piece-head">
        <h5 id={tid}>{title}</h5>
        {sub}
      </div>

      {mode === 'write' ? (
        <TextSlot
          label={`${title}: ${what}`}
          initial={piece?.text ?? ''}
          max={MAX}
          rows={3}
          hint={what === 'hint' ? 'Helps without giving the answer away. Saved as written, and approved.' : 'What a student who chose this most likely confused. Saved as written, and approved.'}
          saveLabel={piece ? 'Save and approve' : 'Save'}
          onCancel={() => setMode('')}
          onSave={async (text) => {
            toast((await onWrite(text))?.message);
            setMode('');
          }}
        />
      ) : piece ? (
        <>
          <WhoLine status={piece.status} provenance={piece.provenance} label={piece.statusLabel} model={piece.model} />
          {piece.leak && <Note tone="warn" icon="alert" role="note">{piece.leak}</Note>}
          <RichText className="hq-slot-text" html={piece.textHtml} text={piece.text} />
          <p className="hq-piece-foot t-meta">
            {piece.cite && <span>{piece.cite}</span>}
            <span>Opened {piece.opened === 1 ? 'once' : `${piece.opened ?? 0} times`}</span>
          </p>
          {canEdit && mode === 'remove' && (
            <div className="hq-confirm" role="group" aria-label={`Remove ${title}`}>
              <span>Remove it? Students stop seeing it.</span>
              <span className="cluster cluster-1">
                <Button aria-describedby={tid} size="sm" variant="ghost" onClick={() => setMode('')} disabled={busy === 'remove'}>Keep it</Button>
                <Button aria-describedby={tid} size="sm" variant="danger" icon="trash" busy={busy === 'remove'} onClick={() => act('remove', onRemove)}>Remove</Button>
              </span>
            </div>
          )}
          {canEdit && mode !== 'remove' && (
            <div className="hq-actions">
              {draft && <Button aria-describedby={tid} size="sm" variant="primary" icon="check" busy={busy === 'approve'} onClick={() => act('approve', onApprove)}>Approve</Button>}
              <Button aria-describedby={tid} size="sm" icon="edit" onClick={() => { setSaid(null); setMode('write'); }}>{draft ? 'Edit' : 'Rewrite'}</Button>
              {draft
                ? <Button aria-describedby={tid} size="sm" variant="ghost" icon="trash" busy={busy === 'remove'} onClick={() => act('remove', onRemove)}>Discard</Button>
                : <Button aria-describedby={tid} size="sm" variant="ghost" icon="trash" onClick={() => { setSaid(null); setMode('remove'); }}>Remove</Button>}
            </div>
          )}
        </>
      ) : (
        <div className="hq-slot-empty hq-piece-empty">
          <span>Not written yet.</span>
          {canEdit && <Button aria-describedby={tid} size="sm" icon="plus" onClick={() => { setSaid(null); setMode('write'); }}>Write it</Button>}
        </div>
      )}

      {said?.text && <p className={`hq-said hq-said-${said.tone}`} role={said.tone === 'bad' ? 'alert' : 'status'}>{said.text}</p>}
      {said?.refused && <Refused refused={said.refused} />}
    </div>
  );
}

/* ------------------------------------------------------------ one question */

function Question({ q, canEdit, open, onToggle, act }) {
  const panel = useId();
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState(null);
  const drafts = draftsOf(q);
  const leaks = leaksOf(q);
  const opts = wrongOptions(q);
  const gone = list(q.noLongerShown);

  const approveAll = async () => {
    setApproving(true);
    setResult(null);
    try {
      const r = await act.approve(q.questionId, {});
      if (list(r.approved).length) toast(r.message);
      setResult(list(r.refused).length ? { tone: list(r.approved).length ? 'ok' : 'bad', text: list(r.approved).length ? '' : r.message, refused: r.refused } : null);
    } catch (err) {
      setResult({ tone: 'bad', text: err?.message || 'The server did not answer.' });
    }
    setApproving(false);
  };

  return (
    <li className="hq-row hq-q" data-open={open ? 'true' : undefined} data-look={needsLook(q) ? 'true' : undefined}>
      <button type="button" className="hq-q-main" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
        <span className="hq-row-q">
          <QMeta q={q} />
          <span className="hq-qtext">{q.text}</span>
          <span className="hq-tally">
            <span><b className="mono">{list(q.hints).length}</b> of 3 hints</span>
            {q.takesFeedback && <span>feedback on <b className="mono">{withFeedback(q)}</b> of {plural(opts.length, 'wrong option')}</span>}
            <span><b className="mono">{q.counts?.shownToStudents ?? 0}</b> shown to students</span>
            <span>opened <b className="mono">{q.counts?.opened ?? 0}</b> {q.counts?.opened === 1 ? 'time' : 'times'}</span>
            {drafts > 0 && <span className="hq-flag hq-flag-draft">{plural(drafts, 'AI draft')} to review</span>}
            {leaks > 0 && <span className="hq-flag hq-flag-warn"><Icon name="alert" size={13} />{leaks === 1 ? 'One is' : `${leaks} are`} not shown</span>}
            {gone.length > 0 && <span className="hq-flag hq-flag-warn">{plural(gone.length, 'feedback')} no longer shown</span>}
          </span>
        </span>
        <Icon name="chevron" className="hq-chev" />
      </button>

      {open && (
        <div id={panel} className="hq-q-open">
          {canEdit && drafts > 0 && (
            <div className="hq-q-bar">
              <Button size="sm" variant="primary" icon="check" busy={approving} onClick={approveAll}>Approve {drafts === 1 ? 'the AI draft' : `all ${drafts} AI drafts`}</Button>
              <span className="t-meta">Each is checked again for giving the answer away before it is approved.</span>
            </div>
          )}
          {result && (
            <div className="hq-q-result">
              {result.text && <p className={`hq-said hq-said-${result.tone}`} role={result.tone === 'bad' ? 'alert' : 'status'}>{result.text}</p>}
              <Refused refused={result.refused} />
            </div>
          )}

          <section className="hq-group" aria-label="Hints">
            <h4>Hints, in the order a student opens them</h4>
            <div className="hq-pieces">
              {STEPS.map((step) => {
                const hint = list(q.hints).find((h) => h.step === step) ?? null;
                return (
                  <Slot
                    key={step}
                    title={hint?.label ?? STEP_LABEL[step]}
                    piece={hint}
                    what="hint"
                    canEdit={canEdit}
                    onWrite={(text) => act.writeHint(q.questionId, step, text)}
                    onRemove={() => act.removeHint(q.questionId, step)}
                    onApprove={() => act.approve(q.questionId, { steps: [step] })}
                  />
                );
              })}
            </div>
          </section>

          <section className="hq-group" aria-label="Feedback on wrong options">
            <h4>Feedback on wrong options</h4>
            {!q.takesFeedback ? (
              <p className="hq-note">A question of this kind ({q.kindLabel}) takes no feedback on its options.</p>
            ) : opts.length === 0 ? (
              <p className="hq-note">This question has no wrong option to give feedback on.</p>
            ) : (
              <div className="hq-pieces">
                {opts.map((o) => (
                  <Slot
                    key={o.optionIdx}
                    title={o.option}
                    sub={<span className="t-meta">Option {o.optionIdx + 1}</span>}
                    piece={o.feedback}
                    what="feedback"
                    canEdit={canEdit}
                    onWrite={(text) => act.writeFeedback(q.questionId, o.optionIdx, text)}
                    onRemove={() => act.removeFeedback(q.questionId, o.optionIdx)}
                    onApprove={() => act.approve(q.questionId, { options: [o.optionIdx] })}
                  />
                ))}
              </div>
            )}
            {gone.length > 0 && (
              <div className="hq-gone">
                <h5>No longer shown</h5>
                <ul>
                  {gone.map((f) => (
                    <li key={f.id}>
                      <p className="hq-gone-opt">Written for “{f.option}”</p>
                      <RichText className="hq-slot-text" html={f.textHtml} text={f.text} />
                      {f.note && <p className="hq-note">{f.note}</p>}
                      {f.leak && <Note tone="warn" icon="alert" role="note">{f.leak}</Note>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------ the view */

/**
 * @param data  the GET reply
 * @param run   useRun's state for "Draft with AI", or null
 * @param act   { writeHint(qid, step, text), removeHint(qid, step), writeFeedback(qid, idx, text),
 *                removeFeedback(qid, idx), approve(qid, { steps?, options? }) }: each a promise of the reply
 * @param opened  question ids shown open (the gallery opens one)
 */
export function HintsView({ data, run, onDraft, onClearRun, act, error, filter, onFilter, opened: openedFrom = [] }) {
  const canEdit = data.canEdit === true;
  const questions = list(data.questions);
  const [opened, setOpened] = useState(() => new Set(openedFrom));
  const options = [
    { id: 'look', label: 'To review', count: questions.filter(needsLook).length },
    { id: 'missing', label: 'Missing hints', count: questions.filter((q) => list(q.missingSteps).length > 0).length },
    { id: 'all', label: 'All', count: questions.length },
  ];
  const shown = pickFilter(options, filter);
  const rows = shown === 'look' ? questions.filter(needsLook)
    : shown === 'missing' ? questions.filter((q) => list(q.missingSteps).length > 0) : questions;
  const names = useMemo(() => namesOf(questions), [questions]);
  const toggle = (id) => setOpened((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const c = data.counts ?? {};
  const notes = data.notes ?? {};

  return (
    <div className="hq">
      <div className="hq-bar">
        <Segmented label="Show" options={options} value={shown} onChange={onFilter} />
        {canEdit && <Button variant="primary" icon="spark" busy={run?.phase === 'running'} onClick={onDraft}>Draft with AI</Button>}
      </div>
      {questions.length > 0 && (
        <p className="hq-sum">
          <span><b className="mono">{c.withHints ?? 0}</b> of {plural(c.questions ?? questions.length, 'question')} show students a hint</span>
          <span><b className="mono">{c.hints?.approved ?? 0}</b> hints and <b className="mono">{c.feedback?.approved ?? 0}</b> feedback approved</span>
          {((c.hints?.draft ?? 0) + (c.feedback?.draft ?? 0)) > 0 && (
            <span><b className="mono">{(c.hints?.draft ?? 0) + (c.feedback?.draft ?? 0)}</b> AI drafts waiting</span>
          )}
        </p>
      )}
      <Notes lead={[notes.model].filter((s) => !saysRun(run, s))} rest={{ approval: notes.approval, answer: notes.answer, order: notes.order, modes: notes.modes }} label="How hints reach a student" />
      <StaleRead error={error} />
      <RunLine state={run} words={RUN_WORDS} onClear={onClearRun} names={names} />

      {questions.length === 0 ? (
        <div className="card hq-empty">
          <Icon name="bank" size={18} />
          <p>No questions in this chapter take hints yet. Polls are left out: they have no answer to hint at.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card hq-empty"><Icon name="check" size={18} /><p>Nothing here under “{options.find((o) => o.id === shown)?.label}”.</p></div>
      ) : (
        <ul className="card hq-list">
          {rows.map((q) => (
            <Question key={q.questionId} q={q} canEdit={canEdit} open={opened.has(q.questionId)} onToggle={() => toggle(q.questionId)} act={act} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ the tab */

export default function Hints({ contentId }) {
  const read = useCallback(() => staffHub.hints(contentId), [contentId]);
  const q = useQueue(read);
  const run = useRun(staffHub.hintRun);
  const [filter, setFilter] = useState('');

  if (!q.data) {
    if (q.error) return <QueueFailed error={q.error} onRetry={() => q.reload()} busy={q.loading} what="The hints" />;
    return <QueueLoading />;
  }

  // Every write answers with the question as it is now: redraw it, then re-read for the counts.
  const redraw = (r) => {
    if (r?.question) {
      q.patch((d) => ({ ...d, questions: list(d.questions).map((x) => (x.questionId === r.question.questionId ? r.question : x)) }));
    }
    q.reload({ quiet: true });
    return r;
  };

  const act = {
    writeHint: (qid, step, text) => staffHub.writeHint(qid, step, { text }).then(redraw),
    removeHint: (qid, step) => staffHub.removeHint(qid, step).then(redraw),
    writeFeedback: (qid, idx, text) => staffHub.writeFeedback(qid, idx, { text }).then(redraw),
    removeFeedback: (qid, idx) => staffHub.removeFeedback(qid, idx).then(redraw),
    approve: (qid, body) => staffHub.approveHints(qid, body).then(redraw),
  };

  return (
    <HintsView
      data={q.data}
      error={q.error}
      filter={filter}
      onFilter={setFilter}
      run={run.state}
      onClearRun={run.clear}
      onDraft={() => run.start(
        (runId) => staffHub.draftHints(contentId, { runId }),
        { onDone: () => q.reload({ quiet: true }) },
      )}
      act={act}
    />
  );
}
