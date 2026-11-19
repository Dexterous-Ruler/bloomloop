/**
 * A topic's lessons, for its professor (docs/API.md, Phase 6, "Lessons (H11)"
 * and "Professor: the review queues").
 *
 *   GET  /api/hub/topics/:id/lessons            serving, drafts, history, basis, notes, writing
 *   POST /api/hub/topics/:id/lessons/generate   202, then /api/hub/lessons/run/:runId
 *   POST /api/hub/lessons/:id/approve|discard   { lesson, message, replaced? }
 *   GET  /api/hub/topics/:id/lesson?lang=       the approved lesson as a student reads it
 *
 * A tab inside the topic's frame: content only. "Make a lesson" is off while
 * one is being written. A draft is marked as one and its own label says
 * students do not see it until it is approved. Each retrieval question shows
 * who wrote it and where it stands, with a link to the question bank, where
 * questions are approved. Every control hides when `canEdit` is false.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import RichText from '../hub/RichText.jsx';
import { KIND_LABEL } from '../lib/kinds.js';
import { DraftTag, StatusTag } from '../teach/ItemStats.jsx';
import { Button, Chip, Dialog, Icon, Level, Note, Segmented } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import { Notes, QueueFailed, QueueLoading, RunLine, StaleRead, list, plural, useQueue, useRun } from './QueueParts.jsx';

const RUN_WORDS = {
  running: 'Writing the lesson',
  done: 'The lesson is written',
  progress: (run) => run.topic || '',
};

const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: <span lang="hi">हिन्दी</span> },
  { id: 'mr', label: <span lang="mr">मराठी</span> },
];
const langAttr = (tag) => (tag === 'hi' || tag === 'mr' ? tag : undefined);

const STATUS_CHIP = {
  approved: { tone: 'ok', text: 'Serving' },
  draft: { tone: 'warn', text: 'Draft' },
  superseded: { tone: null, text: 'Replaced' },
  discarded: { tone: null, text: 'Discarded' },
};

const day = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The console's question step for a chapter: the bank opens on its drafts when it has any. */
export const bankHref = (contentId) => `/?content=${encodeURIComponent(contentId)}&view=bank`;

/* ------------------------------------------------------------ the steps */

function Cite({ cite }) {
  return cite ? <span className="hq-cite"><Icon name="deck" size={13} />{cite}</span> : null;
}

/** A worked example, as both a professor and a student read it. */
function Example({ step, lang }) {
  return (
    <div className="hq-example">
      <p className="hq-step-k">
        Worked example
        {step.label && (step.label === 'AI draft' ? <DraftTag /> : <span className="hq-step-label">{step.label}</span>)}
      </p>
      <RichText className="hq-example-problem" html={step.problemHtml} text={step.problem} lang={lang} />
      {list(step.steps).length > 0 && (
        <ol className="hq-example-steps">
          {list(step.steps).map((s, i) => <li key={i}><RichText html={s.html} text={s.text} lang={lang} /></li>)}
        </ol>
      )}
      {(step.answerHtml || step.answer) && (
        <div className="hq-example-answer">
          <span className="hq-step-k">Answer</span>
          <RichText html={step.answerHtml} text={step.answer} lang={lang} />
        </div>
      )}
    </div>
  );
}

/** A retrieval question as staff read it: who wrote it, its status, and the bank. */
function StaffQuestion({ q, contentId, canEdit }) {
  if (q.missing) {
    return <li className="hq-lq" data-missing="true"><p className="hq-note">{q.note}</p></li>;
  }
  const prov = q.provenance ?? {};
  const waiting = q.status === 'draft';
  return (
    <li className="hq-lq" data-status={q.status}>
      <span className="hq-meta">
        <Level level={q.bloom} />
        <span>{KIND_LABEL[q.kind] ?? q.kind}</span>
        {prov.label && (prov.aiDraft
          ? <DraftTag title={prov.sentence || undefined}>{prov.label}</DraftTag>
          : <><i className="it-dot" aria-hidden="true" /><span className="it-prov" title={prov.sentence || undefined}>{prov.label}</span></>)}
        <StatusTag status={q.status} />
      </span>
      <p className="hq-lq-text">{q.text}</p>
      {q.note && <p className="hq-note">{q.note}</p>}
      {/* Only a question waiting for approval needs the bank: approving is done there. */}
      {canEdit && contentId && waiting && (
        <Link className="btn btn-sm btn-primary hq-lq-go" to={bankHref(contentId)}>
          <Icon name="bank" />Approve it in the bank
        </Link>
      )}
    </li>
  );
}

/** A retrieval question as a student is shown it: words only, never a key. */
function StudentQuestion({ q, lang: lessonLang }) {
  // Each question comes in its own language: English, with a note, until its translation is approved.
  const lang = q.language ? langAttr(q.language.language) : lessonLang;
  const rich = q.rich ?? {};
  const options = list(q.options);
  return (
    <li className="hq-lq">
      <RichText className="hq-lq-text" html={rich.text} text={q.text} lang={lang} />
      {options.length > 0 && (
        <ol className="hq-lq-opts" type="A">
          {options.map((o, i) => <li key={i}><RichText as="span" html={list(rich.options)[i]} text={o} lang={lang} /></li>)}
        </ol>
      )}
      {q.provenance?.text && <p className="t-meta">{q.provenance.text}</p>}
      {q.language?.note && <p className="t-meta">{q.language.note}</p>}
      {q.closed?.note && <p className="hq-note">{q.closed.note}</p>}
    </li>
  );
}

/** Steps in order: slide text (cited), a worked example, retrieval questions. */
export function LessonSteps({ steps, who = 'staff', contentId, canEdit, lang }) {
  return (
    <ol className="hq-steps">
      {list(steps).map((s, i) => (
        <li key={s.index ?? i} className="hq-step" data-type={s.type}>
          <span className="hq-step-n mono" aria-hidden="true">{i + 1}</span>
          <div className="hq-step-body">
            {s.type === 'chunk' && (
              <>
                <RichText html={s.html} text={s.text} lang={lang} />
                <Cite cite={s.cite} />
              </>
            )}
            {s.type === 'example' && (<><Example step={s} lang={lang} /><Cite cite={s.cite} /></>)}
            {s.type === 'questions' && (
              <>
                <p className="hq-step-k">{plural(list(s.questions).length, 'question')} to answer</p>
                <ul className="hq-lqs">
                  {list(s.questions).map((q, n) => (who === 'staff'
                    ? <StaffQuestion key={q.id ?? n} q={q} contentId={contentId} canEdit={canEdit} />
                    : <StudentQuestion key={q._id ?? q.id ?? n} q={q} lang={lang} />))}
                </ul>
                <Cite cite={s.cite} />
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------ one lesson */

function LessonCard({ lesson, canEdit, open: openFirst, onApprove, onDiscard, tag }) {
  const panel = useId();
  const [open, setOpen] = useState(openFirst);
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState(null);
  const chip = STATUS_CHIP[lesson.status] ?? { tone: null, text: lesson.status };
  const draft = lesson.status === 'draft';
  const qs = lesson.questions ?? {};

  const act = async (name, fn) => {
    setBusy(name);
    setSaid(null);
    try {
      const r = await fn(lesson.id);
      // The card leaves the drafts once the list is read again: the server's sentence is a toast.
      toast(r?.message);
    } catch (err) {
      setSaid({ tone: 'bad', text: err?.message || 'The server did not answer.' });
    }
    setBusy('');
  };

  return (
    <article className="card hq-lesson" data-status={lesson.status} aria-label={`${tag ?? chip.text}, version ${lesson.version}`}>
      <header className="hq-lesson-head">
        <div className="hq-lesson-title">
          <h4>Version {lesson.version}</h4>
          <Chip tone={chip.tone ?? undefined} className={chip.tone ? '' : 'chip-line'}>{tag ?? chip.text}</Chip>
          <span className="t-meta">{lesson.sourceLabel}</span>
          {lesson.model && <span className="hq-model mono">{lesson.model}</span>}
        </div>
        <p className="t-meta hq-lesson-dates">
          {lesson.createdAt && <span>Made {day(lesson.createdAt)}</span>}
          {lesson.approvedAt && <span>approved {day(lesson.approvedAt)}</span>}
          {lesson.retiredAt && <span>retired {day(lesson.retiredAt)}</span>}
        </p>
      </header>

      <p className={`hq-lesson-status${draft ? ' hq-who-draft' : ''}`}>{lesson.statusLabel}</p>
      {lesson.basis?.note && <p className="hq-note">{lesson.basis.note}</p>}
      {list(lesson.warnings).map((w, i) => <Note key={i} tone="warn" role="note">{typeof w === 'string' ? w : w?.message}</Note>)}
      {qs.note && (
        <Note tone="warn" icon="bank" role="note">
          {qs.note}
          {canEdit && lesson.contentId && <> <Link className="link" to={bankHref(lesson.contentId)}>Open the bank</Link></>}
        </Note>
      )}

      <div className="hq-lesson-bar">
        <button type="button" className="hq-disclose" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'chevronUp' : 'chevron'} size={14} />
          {open ? 'Hide' : 'Show'} its {plural(list(lesson.steps).length, 'step')}
          {qs.listed > 0 && <span className="t-meta"> · {plural(qs.listed, 'question')}, {qs.approved ?? 0} approved</span>}
        </button>
        {canEdit && draft && (
          <span className="cluster cluster-1">
            <Button size="sm" variant="ghost" icon="trash" busy={busy === 'discard'} disabled={Boolean(busy)} onClick={() => act('discard', onDiscard)}>Discard</Button>
            <Button size="sm" variant="primary" icon="check" busy={busy === 'approve'} disabled={Boolean(busy)} onClick={() => act('approve', onApprove)}>Approve</Button>
          </span>
        )}
      </div>
      {said && <p className={`hq-said hq-said-${said.tone}`} role={said.tone === 'bad' ? 'alert' : 'status'}>{said.text}</p>}
      {open && <div id={panel}><LessonSteps steps={lesson.steps} contentId={lesson.contentId} canEdit={canEdit} /></div>}
    </article>
  );
}

/* ------------------------------------------------------------ preview */

/**
 * The approved lesson as a student on the class reads it, in English, Hindi
 * or Marathi (GET …/lesson?lang=). `read(lang)` returns the reply.
 */
export function Preview({ open, onOpenChange, read }) {
  const [lang, setLang] = useState('en');
  const [state, setState] = useState({ for: null, data: null, error: null });

  useEffect(() => {
    if (!open || !read) return undefined;
    let on = true;
    setState((s) => ({ ...s, for: lang, error: null, data: s.for === lang ? s.data : null }));
    read(lang).then(
      (data) => { if (on) setState({ for: lang, data, error: null }); },
      (error) => { if (on) setState({ for: lang, data: null, error }); },
    );
    return () => { on = false; };
  }, [open, read, lang]);

  const data = state.data;
  const lesson = data?.lesson ?? null;
  const tag = langAttr(lesson?.language?.language);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="As a student reads it" description={data?.preview}>
      <div className="hq-preview">
        <Segmented label="Language" options={LANGS} value={lang} onChange={setLang} />
        {state.error ? (
          <Note tone="bad" role="alert">{state.error.message}</Note>
        ) : !data ? (
          <div className="stack" aria-busy="true" aria-label="Loading">
            <div className="skel" style={{ height: 18, width: '40%' }} />
            <div className="skel" style={{ height: 80 }} />
            <div className="skel" style={{ height: 80 }} />
          </div>
        ) : !lesson ? (
          <p className="hq-note">{data.empty}</p>
        ) : (
          <>
            <p className="hq-preview-head">
              {lesson.label && <span>{lesson.label}</span>}
              {lesson.language?.note && <span className="t-meta">{lesson.language.note}</span>}
            </p>
            <LessonSteps steps={lesson.steps} who="student" lang={tag} />
          </>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ the view */

/**
 * @param data      the GET …/lessons reply
 * @param run       useRun's state for "Make a lesson", or null
 * @param onMake    start it; onClearRun dismisses its line
 * @param onApprove(lessonId) / onDiscard(lessonId)   promises of the reply
 * @param readPreview(lang)   the student view, for the preview
 * @param onRecheck re-read (while the server says a lesson is being written)
 */
export function LessonsView({ data, run, onMake, onClearRun, onApprove, onDiscard, readPreview, onRecheck, error, previewOpen = false }) {
  const canEdit = data.canEdit === true;
  const [preview, setPreview] = useState(previewOpen);
  const [showOld, setShowOld] = useState(false);
  const notes = data.notes ?? {};
  const drafts = list(data.drafts);
  const history = list(data.history);
  const running = run?.phase === 'running';
  const busyElsewhere = data.writing === true && !running;

  return (
    <div className="hq">
      <div className="hq-bar">
        <span className="cluster">
          {canEdit && (
            <Button variant="primary" icon="spark" busy={running} disabled={data.writing === true || Boolean(data.nothingToTeach)} onClick={onMake}>
              Make a lesson
            </Button>
          )}
          {data.topic?.retired && <Chip className="chip-line">Retired topic</Chip>}
        </span>
        <Button icon="eye" onClick={() => setPreview(true)} disabled={!data.serving}>Preview as a student</Button>
      </div>
      {/* The topic's basis says what a new lesson would be made from; each lesson carries its own. */}
      <Notes lead={[notes.model, !data.serving && !drafts.length ? data.basis?.note : '']} rest={{ approval: notes.approval, questions: notes.questions }} label="How a lesson reaches students" />
      {data.nothingToTeach && <Note tone="warn" role="note">{data.nothingToTeach}</Note>}
      <StaleRead error={error} />
      {busyElsewhere && (
        <div className="hq-run" data-phase="running">
          <div className="hq-run-body">
            <p className="hq-run-head" role="status"><span className="spinner" aria-hidden="true" /><b>A lesson for this topic is being written now.</b></p>
          </div>
          <Button size="sm" variant="ghost" icon="refresh" onClick={onRecheck}>Check again</Button>
        </div>
      )}
      <RunLine state={run} words={RUN_WORDS} onClear={onClearRun} />

      {drafts.length > 0 && (
        <section className="hq-lessons" aria-label="Drafts">
          <h3 className="hq-h">Waiting for your approval</h3>
          {drafts.map((l) => <LessonCard key={l.id} lesson={l} canEdit={canEdit} open onApprove={onApprove} onDiscard={onDiscard} />)}
        </section>
      )}

      <section className="hq-lessons" aria-label="Serving">
        <h3 className="hq-h">What students read now</h3>
        {data.serving ? (
          <LessonCard key={data.serving.id} lesson={data.serving} canEdit={canEdit} open={drafts.length === 0} />
        ) : (
          <div className="card hq-empty">
            <Icon name="book" size={18} />
            <p>No lesson is approved for this topic, so students see none yet.{canEdit && !data.nothingToTeach ? ' Make one, then approve it.' : ''}</p>
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="hq-lessons" aria-label="Earlier versions">
          <button type="button" className="hq-disclose" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)}>
            <Icon name={showOld ? 'chevronUp' : 'chevron'} size={14} />
            {plural(history.length, 'earlier version')}
          </button>
          {showOld && history.map((l) => <LessonCard key={l.id} lesson={l} canEdit={false} open={false} />)}
        </section>
      )}

      <Preview open={preview} onOpenChange={setPreview} read={readPreview} />
    </div>
  );
}

/* ------------------------------------------------------------ the tab */

export default function Lessons({ topicId }) {
  const read = useCallback(() => staffHub.lessons(topicId), [topicId]);
  const q = useQueue(read);
  const run = useRun(staffHub.lessonRun);
  const readPreview = useCallback((lang) => staffHub.previewLesson(topicId, lang), [topicId]);

  if (!q.data) {
    if (q.error) return <QueueFailed error={q.error} onRetry={() => q.reload()} busy={q.loading} what="The lessons" />;
    return <QueueLoading rows={2} />;
  }

  const after = (r) => { q.reload({ quiet: true }); return r; };
  return (
    <LessonsView
      data={q.data}
      error={q.error}
      run={run.state}
      onClearRun={run.clear}
      onMake={() => run.start(
        (runId) => staffHub.makeLesson(topicId, { runId }),
        { onDone: () => q.reload({ quiet: true }) },
      )}
      onApprove={(id) => staffHub.approveLesson(id).then(after)}
      onDiscard={(id) => staffHub.discardLesson(id).then(after)}
      readPreview={readPreview}
      onRecheck={() => q.reload({ quiet: true })}
    />
  );
}
