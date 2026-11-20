/**
 * The review queue: written answers the machine marked against their rubric,
 * for a professor to confirm or change.
 *
 * A written answer (kind "open") is marked the moment it arrives, by matching
 * rubric words. That mark counts toward the student's level straight away and
 * the phone says it may change. This is where it does: a professor confirms it
 * (keeps the machine's mark) or changes it, and may leave a note that the
 * student reads word for word in their own answer history.
 *
 * Who may do what is the server's: reading needs a room the caller may read,
 * deciding needs one they may write. A head of department reads the
 * department and decides nothing, so their screen has no form - and the server
 * answers 403 anyway. On the shared teacher key there is no account, and the
 * queue is the rooms nobody owns.
 *
 * The queue pages by cursor, never by offset: deciding an answer takes it out
 * of the default view, and an offset would then skip the one after it.
 *
 * Everything that talks to the server arrives as `services`, so the dev
 * gallery draws this same screen, logic and all, from sample data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import Figure from '../learn/Figure.jsx';
import { api } from '../lib/api.js';
import { labelOf } from '../lib/kinds.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import { ImportedNote, ImportedTag } from '../teach/imported.jsx';
import {
  Avatar, Button, Chip, Dialog, Empty, Icon, Level, Note, Num, Panel, Segmented, Spark, Tip,
} from '../ui/index.jsx';
import { ago, dayParts, plural, stampOf, timeOf, useMedia } from './dashParts.jsx';

import '../styles/levels.css';

/* The server's own words for the three states, and what this screen calls them. */
const STATUS = [
  { id: 'provisional', label: 'Waiting' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'overridden', label: 'Changed' },
  { id: 'all', label: 'All' },
];
const STATUS_WORD = { provisional: 'Waiting', confirmed: 'Confirmed', overridden: 'Changed' };

const PAGE = 50;
/** One read for the brief: enough to count a real backlog without paging. */
const SUMMARY_LIMIT = 200;
/** The server's ceiling on a note, after trimming. */
const MAX_NOTE = 1000;
/** The rubric matcher's pass mark: a score alone counts as right from here. */
const PASS = 0.7;

/* ------------------------------------------------------------- formatting */

const pctOf = (s) => (s == null || !Number.isFinite(Number(s)) ? '—' : `${Math.round(Number(s) * 100)}%`);
const nameOf = (item) => item?.student?.name || 'Name not recorded';
// The server's label for the item (batch 9): "Short answer", "Long answer" or
// "Draw your answer"; worked out here only for an item that carries none.
const kindLabel = (item) => item?.kindLabel || labelOf({ kind: item?.kind, length: item?.length }) || item?.kind || '';
/** A drawing answer (batch 9, E4): the picture is `drawing` ({ mediaId, url }, or null), the words beside it `text`. */
const isDrawing = (item) => item?.kind === 'drawing';
/** A drawing has no machine mark: the server's sentence for a confirm (a 409). */
const DRAWING_MARK = 'A drawing has no machine mark to confirm: give it a mark of your own.';
const round3 = (n) => Math.round(n * 1000) / 1000;

/** A response as text. Written answers are text; anything else is shown as it came. */
function responseText(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) return r.join(', ');
  return JSON.stringify(r);
}

/** What the student wrote: a drawing's words, or the answer itself. */
const saidOf = (item) => (isDrawing(item) ? String(item.text ?? '') : responseText(item?.response));

/** Words as the server counts them: runs of non-space, a zero-width space or joiner a gap. */
const wordsIn = (text) => String(text ?? '').replace(/[​⁠﻿᠎]/g, ' ').trim().split(/\s+/).filter(Boolean).length;

/** "3 min after it was served", from the two stamps the answer carries. */
function took(item) {
  const a = new Date(item?.servedAt ?? '').getTime();
  const b = new Date(item?.answeredAt ?? '').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '';
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s} s after it was served`;
  return `${plural(Math.round(s / 60), 'minute')} after it was served`;
}

/** Waiting answers by the day they were written, oldest day first. */
function perDay(items, days = 7) {
  const start = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const today = start(new Date());
  const out = Array(days).fill(0);
  for (const it of items) {
    const d = new Date(it.answeredAt ?? '');
    if (Number.isNaN(d.getTime())) continue;
    const back = Math.round((today - start(d)) / 86400000);
    if (back >= 0 && back < days) out[days - 1 - back] += 1;
  }
  return out;
}

/** What the form starts from for one answer: what is in force now. */
function draftFor(item) {
  const hasAuto = !isDrawing(item) && typeof item.autoCorrect === 'boolean' && item.autoScore != null;
  // The note in force is carried over. Sending a decision without it would
  // clear a note the student has already read.
  const note = item.reviewNote ?? '';
  if (item.reviewStatus === 'overridden') {
    const derived = item.score != null && (Number(item.score) >= PASS) === item.correct;
    return {
      mode: 'override',
      score: item.score == null ? '' : String(item.score),
      correct: derived ? 'auto' : item.correct ? 'right' : 'wrong',
      note,
    };
  }
  return { mode: hasAuto ? 'confirm' : 'override', score: '', correct: 'auto', note };
}

/**
 * The mark a draft would put in force, by the server's rule, or null when an
 * override has no mark yet. `error` is set when the score is not one.
 */
function outcomeOf(item, draft) {
  if (draft.mode === 'confirm') return { correct: item.autoCorrect, score: item.autoScore };
  const raw = String(draft.score ?? '').trim();
  const hasScore = raw !== '';
  const score = hasScore ? Number(raw) : null;
  if (hasScore && (!Number.isFinite(score) || score < 0 || score > 1)) return { error: 'A score is a number from 0 to 1.' };
  const hasCorrect = draft.correct !== 'auto';
  if (!hasScore && !hasCorrect) return null;
  if (hasScore && hasCorrect) return { score: round3(score), correct: draft.correct === 'right' };
  if (hasScore) return { score: round3(score), correct: score >= PASS };
  return { score: draft.correct === 'right' ? 1 : 0, correct: draft.correct === 'right' };
}

/** What a saved decision did, in one sentence. */
function savedLine(item, decision, changed) {
  const who = nameOf(item);
  if (!changed) return `Nothing changed for ${who}: that decision was already in force.`;
  const mark = `${pctOf(item.score)}, ${item.correct ? 'right' : 'wrong'}`;
  const head = decision === 'confirm' ? `${who}'s mark is confirmed at ${mark}.` : `${who}'s mark is now ${mark}.`;
  return item.reviewNote ? `${head} They will see your note.` : head;
}

/* ------------------------------------------------------------------ parts */

/** Right or wrong: a tick or a cross, always with the word. */
function Verdict({ correct }) {
  if (typeof correct !== 'boolean') return <span className="rv-verdict" data-v="none">No mark</span>;
  return (
    <span className="rv-verdict" data-v={correct ? 'right' : 'wrong'}>
      <Icon name={correct ? 'check' : 'wrong'} size={13} />
      {correct ? 'Right' : 'Wrong'}
    </span>
  );
}

function StatusChip({ status }) {
  if (status === 'provisional') return <Chip tone="warn" icon="hourglass">Waiting</Chip>;
  if (status === 'confirmed') return <Chip tone="line" icon="check">Confirmed</Chip>;
  if (status === 'overridden') return <Chip tone="accent" icon="edit">Changed</Chip>;
  return <Chip tone="line">{status || 'Unknown'}</Chip>;
}

function Skeleton() {
  return (
    <div className="rv-skel" aria-busy="true" aria-label="Reading the queue">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rv-skel-item card">
          <div className="stack stack-2 grow">
            <div className="skel" style={{ height: 14, width: '34%' }} />
            <div className="skel" style={{ height: 12, width: '88%' }} />
            <div className="skel" style={{ height: 12, width: '62%' }} />
            <div className="skel" style={{ height: 10, width: '48%', marginTop: 4 }} />
          </div>
          <div className="stack stack-2" style={{ alignItems: 'flex-end' }}>
            <div className="skel" style={{ height: 20, width: 48 }} />
            <div className="skel" style={{ height: 10, width: 64 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- the brief */

function Brief({ summary, rooms, readOnly, decided, onOpen }) {
  if (summary.loading) {
    return (
      <Panel className="rv-brief" aria-label="Waiting for you" aria-busy="true">
        <div className="rv-say">
          <span className="tag-mint">Waiting for you</span>
          <div className="stack stack-2">
            <div className="skel rv-skel-dark" style={{ height: 22, width: '80%' }} />
            <div className="skel rv-skel-dark" style={{ height: 22, width: '55%' }} />
          </div>
        </div>
        <div className="rv-tiles">
          {[0, 1, 2, 3].map((i) => <div key={i} className="ptile rv-ptile-skel" />)}
        </div>
      </Panel>
    );
  }

  const items = summary.items;
  const n = items.length;
  const roomsWaiting = new Set(items.map((i) => i.room?.code).filter(Boolean)).size;
  // Newest first, so the last is the oldest - but only when nothing was cut off.
  const oldest = n > 0 && !summary.hasMore ? items[n - 1] : null;
  const countText = summary.hasMore ? `${n}+` : String(n);
  const days = perDay(items);
  const kept = Object.values(decided).filter((d) => d === 'confirm').length;
  const changed = Object.values(decided).filter((d) => d === 'override').length;

  let lead;
  if (summary.error) {
    lead = <>The count of waiting answers did not load: {summary.error}</>;
  } else if (n === 0) {
    lead = readOnly ? <>Nothing is waiting in the department&apos;s rooms.</> : <>Nothing is waiting for you.</>;
  } else if (summary.hasMore) {
    lead = <>More than <em>{plural(SUMMARY_LIMIT, 'answer')}</em> are waiting, in at least {plural(roomsWaiting, 'room')}.</>;
  } else {
    lead = (
      <>
        <em>{plural(n, 'answer')}</em> {n === 1 ? 'is' : 'are'} waiting in {plural(roomsWaiting, 'room')}.
        {oldest && <> The oldest is {nameOf(oldest)}&apos;s, written {ago(oldest.answeredAt) || 'at an unrecorded time'}.</>}
      </>
    );
  }

  return (
    <Panel className="rv-brief" aria-label="Waiting for you">
      <div className="rv-say">
        <span className="tag-mint">Waiting for you</span>
        <p className="rv-lead">{lead}</p>
        <div className="brief">
          <b>How</b>
          <span>
            Each written answer is marked as it arrives, by matching rubric words. That mark counts toward the student&apos;s level now.
            A drawing has no machine mark: it counts once it is given one here.
          </span>
          <b>{readOnly ? 'You' : 'Yours'}</b>
          <span>
            {readOnly
              ? 'You can read every answer and every decision. Confirming or changing a mark is for the professor who runs the room.'
              : 'Confirm keeps that mark. Changing it moves their numbers by the difference. A note you add is shown to the student.'}
          </span>
        </div>
        {n > 0 && (
          <div className="rv-say-acts">
            <Button variant="accent" icon="forward" onClick={() => onOpen(oldest ?? items[0])}>
              {oldest ? 'Open the oldest' : 'Open the newest'}
            </Button>
          </div>
        )}
      </div>

      <div className="rv-tiles">
        <div className="ptile">
          <span>Waiting</span>
          <b><Num value={summary.error ? '—' : countText} /></b>
          {/* A flat line at nothing says nothing, so it is not drawn. */}
          {days.some(Boolean) && <Spark values={days} label={`Waiting answers by the day they were written, last ${days.length} days`} />}
          <small>{oldest ? ago(oldest.answeredAt) : '—'} <i>oldest</i></small>
        </div>
        <div className="ptile" style={{ '--d': '0.7s' }}>
          <span>Rooms</span>
          <b><Num value={summary.error ? '—' : roomsWaiting} /></b>
          <small>{rooms.length > 0 ? rooms.length : '—'} <i>{readOnly ? 'in the department' : 'you can read'}</i></small>
        </div>
        {readOnly ? (
          <div className="ptile rv-ptile-wide" style={{ '--d': '1.4s' }}>
            <span>Oldest waiting</span>
            <b>{oldest ? ago(oldest.answeredAt) || '—' : '—'}</b>
            <small>{oldest ? oldest.room?.code : 'Nothing'} <i>{oldest ? nameOf(oldest) : 'is waiting'}</i></small>
          </div>
        ) : (
          <>
            <div className="ptile" style={{ '--d': '1.4s' }}>
              <span>Reviewed here</span>
              <b><Num value={kept + changed} /></b>
              <small>since <i>this page opened</i></small>
            </div>
            <div className="ptile" style={{ '--d': '2.1s' }}>
              <span>Changed</span>
              <b><Num value={changed} /></b>
              <small>{kept} <i>kept as marked</i></small>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- one item */

function QueueItem({ item, active, open, showStatus, onPick }) {
  const said = saidOf(item);
  const reviewed = item.reviewStatus !== 'provisional';
  return (
    <div
      id={`rv-opt-${item.answerId}`}
      role="option"
      aria-selected={active}
      data-open={open || undefined}
      className="rv-item"
      onClick={() => onPick(item.answerId)}
    >
      <div className="rv-item-main">
        <div className="rv-item-t">
          <b className="clip">{nameOf(item)}</b>
          {item.student?.rollNo && <span className="rv-roll">{item.student.rollNo}</span>}
        </div>
        <p className="rv-item-said">
          {isDrawing(item) && item.drawing ? (said ? `A drawing, and “${said}”` : 'A drawing, with no words')
            : said ? `“${said}”` : isDrawing(item) ? 'No drawing was stored with this answer.' : 'No answer text was recorded.'}
        </p>
        {reviewed && item.reviewNote && <p className="rv-item-note">Note to the student: {item.reviewNote}</p>}
        <div className="rv-meta">
          <span className="rv-code">{item.room?.code}</span>
          {item.room?.title && <span className="clip rv-meta-room">{item.room.title}</span>}
          <ImportedTag plain from={item.room?.importedFrom} code={item.room?.code} />
          {item.topic && <span>{item.topic}</span>}
          <Level level={item.bloom} />
          <span>{kindLabel(item)}</span>
          <span>Attempt {item.attempt ?? 1}</span>
          <span title={stampOf(item.answeredAt) || undefined}>{timeOf(item.answeredAt)}</span>
        </div>
      </div>
      <div className="rv-item-mark">
        {showStatus && <StatusChip status={item.reviewStatus} />}
        <b className="rv-item-score">{pctOf(item.score)}</b>
        <Verdict correct={item.correct} />
        {item.reviewStatus === 'overridden'
          ? !isDrawing(item) && <small>was <span className="rv-was">{pctOf(item.autoScore)}</span></small>
          : item.reviewStatus === 'provisional' && (isDrawing(item)
            ? <small>waits for your mark</small>
            : item.autoDetail && <small>{item.autoDetail}</small>)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- stimulus */

function Stimulus({ stimulus, figure }) {
  const [broken, setBroken] = useState(false);
  // Batch 8: a figure is drawn by the server from the answer's snapshot, as the
  // student saw it (question.figure); the snapshot's stimulus holds only its spec.
  if (figure) {
    return (
      <>
        <Figure figure={figure} />
        {figure.ok === false && figure.reason && <p className="hint">{figure.reason}</p>}
      </>
    );
  }
  if (!stimulus || stimulus.kind === 'figure') return null;
  if (stimulus.kind === 'image') {
    return (
      <figure className="rv-stim">
        {broken
          ? <p>{stimulus.alt}</p>
          : <img src={stimulus.url} alt={stimulus.alt ?? ''} onError={() => setBroken(true)} />}
      </figure>
    );
  }
  return (
    <div className="rv-stim" tabIndex={0} role="region" aria-label="The passage this question is about">
      <p>{stimulus.text}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- drawing */

/**
 * A drawing answer's picture. An <img> sends no credentials, so the bytes are
 * fetched with this console's own (in a header, as every request here) and
 * shown from a blob url, revoked when the answer goes.
 */
function Drawing({ url, fetchBlob }) {
  const [got, setGot] = useState({ for: null, src: null, failed: '' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    let made = null;
    // The server's url (/api/media/<id>, no-store): never cached here either.
    fetchBlob(url).then(
      (src) => { if (live) { made = src; setGot({ for: url, src, failed: '' }); } else URL.revokeObjectURL(src); },
      (err) => { if (live) setGot({ for: url, src: null, failed: err?.message || 'The server did not answer.' }); },
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url, fetchBlob, round]);

  const now = got.for === url ? got : { src: null, failed: '' };
  return (
    <figure className="rv-drawing">
      {now.src
        ? <img src={now.src} alt="The student's drawing" />
        : now.failed
          ? (
            <p className="hint">
              The drawing did not load: {now.failed}{' '}
              <button type="button" className="link rv-linkbtn" onClick={() => { setGot({ for: null, src: null, failed: '' }); setRound((n) => n + 1); }}>Try again</button>
            </p>
          )
          : <div className="skel rv-drawing-skel" aria-label="Loading the drawing" />}
    </figure>
  );
}

/* --------------------------------------------------------- decision form */

function DecisionForm({ item, draft, onDraft, onSubmit, busy, said }) {
  const drawing = isDrawing(item);
  const hasAuto = !drawing && typeof item.autoCorrect === 'boolean' && item.autoScore != null;
  const rubricN = item.question?.rubric?.length ?? 0;
  const outcome = outcomeOf(item, draft);
  const note = draft.note ?? '';
  const noteLen = note.trim().length;
  const tooLong = noteLen > MAX_NOTE;
  const ready = Boolean(outcome) && !outcome.error && !tooLong;
  const scoreNum = String(draft.score ?? '').trim() === '' ? null : Number(draft.score);
  const points = rubricN > 0 && scoreNum != null
    ? Array.from({ length: rubricN + 1 }, (_, k) => k).find((k) => round3(k / rubricN) === round3(scoreNum))
    : undefined;

  function submit(e) {
    e?.preventDefault();
    if (!ready || busy) return;
    if (draft.mode === 'confirm') {
      onSubmit({ decision: 'confirm', note });
      return;
    }
    const body = { decision: 'override', note };
    if (String(draft.score ?? '').trim() !== '') body.score = round3(Number(draft.score));
    if (draft.correct !== 'auto') body.correct = draft.correct === 'right';
    onSubmit(body);
  }

  const fid = `rv-f-${item.answerId}`;

  return (
    <form
      className="rv-form"
      // The mark is checked here by the server's own rule, with its own words.
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e); }}
      aria-labelledby={`${fid}-h`}
    >
      <div className="rv-label" id={`${fid}-h`}>{drawing ? 'Your mark' : 'Your decision'}</div>

      {/* A drawing is marked only: confirming one is a 409 (batch 9). */}
      {drawing ? <p className="said">{DRAWING_MARK}</p> : (
        <Segmented
          label="Your decision"
          value={draft.mode}
          onChange={(mode) => onDraft({ mode })}
          options={[
            { id: 'confirm', label: 'Confirm the mark', disabled: !hasAuto },
            { id: 'override', label: 'Change the mark' },
          ]}
        />
      )}

      {draft.mode === 'confirm' && !drawing ? (
        <p className="said">
          Keeps the machine&apos;s mark, {pctOf(item.autoScore)} and {item.autoCorrect ? 'right' : 'wrong'}, as yours.
          {item.reviewStatus === 'provisional' && ' Their numbers do not move: it already counts.'}
        </p>
      ) : (
        <div className="rv-change">
          {!hasAuto && !drawing && <p className="hint">There is no machine mark to keep on this answer, so it can only be changed.</p>}
          {rubricN > 0 && (
            <div className="rv-row">
              <span className="rv-k" id={`${fid}-pts`}>Rubric points made</span>
              <Segmented
                label="Rubric points made"
                value={points}
                onChange={(k) => onDraft({ score: String(round3(Number(k) / rubricN)) })}
                options={Array.from({ length: rubricN + 1 }, (_, k) => ({ id: k, label: String(k) }))}
              />
              <span className="rv-k-of">of {rubricN}</span>
            </div>
          )}
          <div className="rv-row">
            <label className="rv-k" htmlFor={`${fid}-score`}>Score</label>
            <input
              id={`${fid}-score`}
              className="input input-sm rv-score"
              type="number"
              inputMode="decimal"
              min="0"
              max="1"
              step="any"
              placeholder="0 to 1"
              value={draft.score}
              onChange={(e) => onDraft({ score: e.target.value })}
              aria-describedby={`${fid}-rule`}
            />
            <span className="rv-k-of">of 1{scoreNum != null && Number.isFinite(scoreNum) && scoreNum >= 0 && scoreNum <= 1 ? ` = ${pctOf(scoreNum)}` : ''}</span>
          </div>
          <div className="rv-row">
            <span className="rv-k">Counts as</span>
            <Segmented
              label="Counts as right or wrong"
              value={draft.correct}
              onChange={(correct) => onDraft({ correct })}
              options={[
                { id: 'auto', label: 'From the score' },
                { id: 'right', label: 'Right' },
                { id: 'wrong', label: 'Wrong' },
              ]}
            />
          </div>
          <p className="hint" id={`${fid}-rule`}>
            A score alone counts as right from {PASS}. Right or wrong alone sets the score to 1 or 0. Both together are kept as given,
            so partial credit can still count as right.
          </p>
        </div>
      )}

      <div className="field">
        <div className="rv-note-h">
          <label className="label" htmlFor={`${fid}-note`}>Note to the student <span className="opt">optional</span></label>
          <span className="rv-shown"><Icon name="eye" size={13} />Shown to the student</span>
        </div>
        <textarea
          id={`${fid}-note`}
          className="textarea rv-note"
          rows={3}
          value={note}
          placeholder="What they did well, or what the answer missed"
          onChange={(e) => onDraft({ note: e.target.value })}
          aria-describedby={`${fid}-count`}
          aria-invalid={tooLong || undefined}
        />
        <div className="rv-count" id={`${fid}-count`} data-over={tooLong || undefined}>
          {tooLong ? `${noteLen - MAX_NOTE} characters over the ${MAX_NOTE} limit` : `${noteLen} / ${MAX_NOTE}`}
        </div>
      </div>

      {said && (
        said.ok
          ? <Note tone="ok" role="status">{said.text}</Note>
          : (
            <Note tone={said.status === 409 ? 'warn' : 'bad'} role="alert">
              {said.text}
              {noteLen > 0 && ' Your note is still here.'}
            </Note>
          )
      )}

      <div className="rv-send">
        <span className="rv-result" aria-live="polite">
          {outcome?.error
            ? <span className="rv-result-bad">{outcome.error}</span>
            : outcome
              ? <>Records <b>{pctOf(outcome.score)}</b>, <Verdict correct={outcome.correct} /></>
              : 'Set a score, or choose right or wrong.'}
        </span>
        <Button
          type="submit"
          variant={draft.mode === 'confirm' ? 'ink' : 'primary'}
          icon={draft.mode === 'confirm' ? 'check' : 'edit'}
          busy={busy}
          disabled={!ready}
        >
          {draft.mode === 'confirm' ? 'Confirm the mark' : drawing ? 'Save the mark' : 'Save the new mark'}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- the detail */

function Detail({ item, entry, onRetryLog, role, readOnly, draft, onDraft, onSubmit, busy, said, handed, inSheet, mediaBlobUrl }) {
  const rubric = item.question?.rubric ?? [];
  const drawing = isDrawing(item);
  const text = saidOf(item);
  const log = entry?.log ?? [];
  const byWhom = (r) => (r.reviewedBy == null
    ? 'with the teacher key'
    : role === 'hod' ? 'by the room’s professor' : role ? 'by you' : 'by an account');

  return (
    <>
      {handed && <div className="rv-d-sec rv-d-handed"><Note tone="ok" role="status">{handed}</Note></div>}

      <div className="rv-d-head">
        {!inSheet && (
          <div className="rv-d-who">
            <Avatar name={nameOf(item)} />
            <div className="grow">
              <h2 className="clip">{nameOf(item)}</h2>
              <span className="rv-roll">{item.student?.rollNo}</span>
            </div>
            <StatusChip status={item.reviewStatus} />
          </div>
        )}
        <div className="rv-meta">
          {/* In a sheet the room is already under the name, in its description. */}
          {inSheet ? <StatusChip status={item.reviewStatus} /> : (
            <>
              <span className="rv-code">{item.room?.code}</span>
              {item.room?.title && <span>{item.room.title}</span>}
            </>
          )}
          {item.room?.status === 'closed' && <span>Closed room</span>}
        </div>
        {/* Phase 7: its marks are as the laptop's file gave them. */}
        <ImportedNote from={item.room?.importedFrom} code={item.room?.code} />
        <div className="rv-meta">
          <Level level={item.bloom} />
          {item.topic && <span>{item.topic}</span>}
          <span>{kindLabel(item)}</span>
          {item.maxWords > 0 && <span>Up to {item.maxWords} words</span>}
          <span>Attempt {item.attempt ?? 1}</span>
        </div>
        <div className="rv-meta">
          <span>Answered {stampOf(item.answeredAt) || 'at an unrecorded time'}</span>
          {took(item) && <span>{took(item)}</span>}
        </div>
      </div>

      <section className="rv-d-sec" aria-label="The question">
        <div className="rv-label">Question</div>
        <Stimulus stimulus={item.question?.stimulus} figure={item.question?.figure} />
        <p className="rv-q">{item.question?.text || 'The question text was not stored with this answer.'}</p>
      </section>

      <section className="rv-d-sec" aria-label="The student's answer">
        <div className="rv-label">
          <span>Their answer</span>
          {/* A written answer's words against its limit (batch 9, E3), counted as the server counts them. */}
          {item.maxWords > 0 && <span className="rv-label-n">{wordsIn(text)} of {item.maxWords} words</span>}
        </div>
        {drawing && (item.drawing?.url
          ? <Drawing url={item.drawing.url} fetchBlob={mediaBlobUrl} />
          : <p className="hint">No drawing was stored with this answer.</p>)}
        {drawing && item.drawing && !text
          ? <p className="hint">No words with the drawing.</p>
          : (text || !drawing) && <p className="rv-answer">{text || 'No answer text was recorded.'}</p>}
        {/* Batch 8 (9c): the key the row was stored under, the phone's own id for it when it sent one. `answerId` stays the row id the review routes take. */}
        {item.answerKey && <p className="hint">Answer reference <span className="ev-key">{item.answerKey}</span></p>}
      </section>

      <section className="rv-d-sec" aria-label="Rubric">
        <div className="rv-label">
          <span>Rubric</span>
          <span className="rv-label-n">{plural(rubric.length, 'point')}</span>
        </div>
        {rubric.length > 0 ? (
          <>
            <p className="hint">{drawing ? 'Your guide to marking it: the machine matches none of these.' : 'The points a full answer makes.'}</p>
            <ol className="rv-rubric">{rubric.map((r, i) => <li key={i}>{r}</li>)}</ol>
          </>
        ) : <p className="hint">{drawing ? 'This question has no rubric: mark it on your own reading.' : 'No rubric was stored with this question.'}</p>}
        {item.question?.modelAnswer && (
          <div className="rv-model">
            <span className="rv-k">Model answer</span>
            <p>{item.question.modelAnswer}</p>
          </div>
        )}
      </section>

      <section className="rv-d-sec" aria-label="The mark so far">
        <div className="rv-label">The mark so far</div>
        <ol className="rv-trail">
          <li data-kind="machine">
            <span className="rv-trail-dot" aria-hidden="true" />
            {drawing ? (
              <div className="rv-trail-main">
                <b>Sent</b>
                <span className="rv-trail-mark">Not marked by the machine. It counts nowhere until it has your mark.</span>
              </div>
            ) : (
              <div className="rv-trail-main">
                <b>Machine reading</b>
                <span className="rv-trail-mark">
                  {pctOf(item.autoScore)} <Verdict correct={item.autoCorrect} />
                  {item.autoDetail && <span className="muted">· {item.autoDetail}</span>}
                </span>
              </div>
            )}
            <time className="rv-trail-t" dateTime={item.answeredAt}>{stampOf(item.answeredAt)}</time>
          </li>
          {log.map((r) => (
            <li key={r.id} data-kind={r.decision}>
              <span className="rv-trail-dot" aria-hidden="true" />
              <div className="rv-trail-main">
                <b>{r.decision === 'confirm' ? 'Confirmed' : drawing ? 'Marked' : 'Changed'} {byWhom(r)}</b>
                <span className="rv-trail-mark">{pctOf(r.score)} <Verdict correct={r.correct} /></span>
                {r.note && <span className="rv-trail-note">“{r.note}”</span>}
              </div>
              <time className="rv-trail-t" dateTime={r.reviewedAt}>{stampOf(r.reviewedAt)}</time>
            </li>
          ))}
        </ol>
        {entry?.loading && log.length === 0 && (
          <div className="skel" style={{ height: 12, width: '60%' }} aria-label="Reading the decisions" />
        )}
        {entry?.error && (
          <p className="hint">
            The decisions on this answer did not load: {entry.error}{' '}
            <button type="button" className="link rv-linkbtn" onClick={onRetryLog}>Try again</button>
          </p>
        )}
        {!entry?.loading && !entry?.error && log.length === 0 && (
          <p className="hint">{drawing ? 'No one has marked it yet.' : 'No one has confirmed or changed this mark yet.'}</p>
        )}
      </section>

      {readOnly ? (
        <div className="rv-form rv-form-ro">
          <Note icon="lock">
            Read only. A head of department can read every answer and decision in the department; confirming or changing a mark
            is for the professor who runs the room.
          </Note>
        </div>
      ) : (
        <DecisionForm item={item} draft={draft} onDraft={onDraft} onSubmit={onSubmit} busy={busy} said={said} />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- screen */

/**
 * @param services       { reviewQueue, reviewItem, review, listSessions } - `api`, or the gallery's sample
 * @param initialStatus  the status filter to open on
 * @param initialOpen    an answerId to open on
 */
export function ReviewScreen({ services, initialStatus = 'provisional', initialOpen = null }) {
  const { account, loading: accountLoading } = useViewer();
  const role = account?.role;
  const readOnly = role === 'hod';
  const narrow = useMedia('(max-width: 1180px)');

  const [status, setStatus] = useState(initialStatus);
  const [code, setCode] = useState('');
  // items null means "not read yet", which is what the skeleton waits on.
  const [queue, setQueue] = useState({ items: null, next: null, hasMore: false, error: '', locked: false });
  const [reading, setReading] = useState(false);
  const [more, setMore] = useState({ busy: false, error: '' });
  const [summary, setSummary] = useState({ loading: true, items: [], hasMore: false, error: '' });
  const [rooms, setRooms] = useState([]);

  const [activeId, setActiveId] = useState(initialOpen);
  const [openId, setOpenId] = useState(initialOpen);
  const [sheetOpen, setSheetOpen] = useState(Boolean(initialOpen));
  // answerId -> { item, log, loading, error }, from GET /api/review/:answerId.
  const [details, setDetails] = useState({});
  // answerId -> the form as typed. Kept per answer and dropped only on a
  // saved decision, so neither an error nor moving away costs a typed note.
  const [drafts, setDrafts] = useState({});
  const [sending, setSending] = useState('');
  const [said, setSaid] = useState({});
  // The last save, said on the answer that comes up after it.
  const [handed, setHanded] = useState(null);
  // answerId -> the decision saved on this visit, for the brief's tiles.
  const [decided, setDecided] = useState({});

  const ticket = useRef(0);
  const detailRef = useRef(null);
  const listRef = useRef(null);

  const loadQueue = useCallback(async ({ keep = false } = {}) => {
    const t = ++ticket.current;
    setReading(true);
    setMore({ busy: false, error: '' });
    if (!keep) setQueue((q) => ({ ...q, items: null, error: '' }));
    try {
      const res = await services.reviewQueue({ status, code, limit: PAGE });
      if (t !== ticket.current) return;
      setQueue({
        items: Array.isArray(res?.items) ? res.items : [],
        next: res?.next ?? null,
        hasMore: Boolean(res?.hasMore),
        error: '',
        locked: false,
      });
    } catch (err) {
      if (t !== ticket.current) return;
      setQueue((q) => ({ ...q, error: err.message || 'The queue did not load.', locked: err.status === 401 }));
    } finally {
      if (t === ticket.current) setReading(false);
    }
  }, [services, status, code]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await services.reviewQueue({ status: 'provisional', limit: SUMMARY_LIMIT });
      setSummary({ loading: false, items: Array.isArray(res?.items) ? res.items : [], hasMore: Boolean(res?.hasMore), error: '' });
    } catch (err) {
      setSummary((s) => ({ ...s, loading: false, error: err.message || 'The count did not load.' }));
    }
  }, [services]);

  /* Waits for the account to settle: fired before then, no bearer token goes
     and the server answers as the shared key - somebody else's queue. */
  useEffect(() => {
    if (accountLoading || role === 'student') return;
    loadQueue();
  }, [accountLoading, role, account?.id, loadQueue]);

  // Only names the rooms in the filter. If it fails, the filter still has
  // every room that has a waiting answer, so the failure is not shown.
  const loadRooms = useCallback(() => {
    services.listSessions().then(
      (res) => setRooms(Array.isArray(res?.rooms) ? res.rooms : []),
      () => {},
    );
  }, [services]);

  useEffect(() => {
    if (accountLoading || role === 'student') return;
    loadSummary();
    loadRooms();
  }, [accountLoading, role, account?.id, loadSummary, loadRooms]);

  const reloadAll = () => {
    loadQueue({ keep: true });
    loadSummary();
    loadRooms();
  };

  async function loadMore() {
    if (!queue.next || more.busy) return;
    const t = ticket.current;
    setMore({ busy: true, error: '' });
    try {
      const res = await services.reviewQueue({ status, code, limit: PAGE, before: queue.next });
      if (t !== ticket.current) return;
      setQueue((q) => {
        const seen = new Set((q.items ?? []).map((i) => i.answerId));
        const fresh = (res?.items ?? []).filter((i) => !seen.has(i.answerId));
        return { ...q, items: [...(q.items ?? []), ...fresh], next: res?.next ?? null, hasMore: Boolean(res?.hasMore) };
      });
      setMore({ busy: false, error: '' });
    } catch (err) {
      if (t === ticket.current) setMore({ busy: false, error: err.message || 'The next page did not load.' });
    }
  }

  /* The open answer and its whole log. The item is drawn from the list at
     once; the log follows. */
  const loadDetail = useCallback((id) => {
    let alive = true;
    setDetails((d) => ({ ...d, [id]: { ...d[id], loading: true, error: '' } }));
    services.reviewItem(id).then(
      (res) => { if (alive) setDetails((d) => ({ ...d, [id]: { item: res?.item, log: res?.log ?? [], loading: false, error: '' } })); },
      (err) => { if (alive) setDetails((d) => ({ ...d, [id]: { ...d[id], loading: false, error: err.message || 'The server did not answer.' } })); },
    );
    return () => { alive = false; };
  }, [services]);

  useEffect(() => (openId ? loadDetail(openId) : undefined), [openId, loadDetail]);

  const items = queue.items;

  /* Beside the list there is always an answer open, so the first one opens
     by itself. In a sheet nothing opens until it is asked for. */
  useEffect(() => {
    if (narrow || openId || !items?.length) return;
    setActiveId(items[0].answerId);
    setOpenId(items[0].answerId);
  }, [narrow, openId, items]);

  // The active row stays in view as the keys move it.
  useEffect(() => {
    if (activeId) document.getElementById(`rv-opt-${activeId}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const days = useMemo(() => {
    const out = [];
    for (const it of items ?? []) {
      const d = dayParts(it.answeredAt);
      let g = out.find((x) => x.key === d.key);
      if (!g) { g = { ...d, items: [] }; out.push(g); }
      g.items.push(it);
    }
    return out;
  }, [items]);

  // Every room the caller may read, with what waits in each.
  const roomOptions = useMemo(() => {
    const waiting = {};
    for (const it of summary.items) {
      const c = it.room?.code;
      if (c) waiting[c] = (waiting[c] ?? 0) + 1;
    }
    const byCode = new Map();
    for (const r of rooms) if (r?.code) byCode.set(r.code, { code: r.code, title: r.title || '' });
    for (const it of [...summary.items, ...(items ?? [])]) {
      if (it.room?.code && !byCode.has(it.room.code)) byCode.set(it.room.code, { code: it.room.code, title: it.room.title || '' });
    }
    return [...byCode.values()]
      .map((r) => ({ ...r, waiting: waiting[r.code] ?? 0 }))
      .sort((a, b) => b.waiting - a.waiting);
  }, [rooms, summary.items, items]);

  /* A new view starts empty in the same update, or the first answer of the
     old list would be opened before the new one arrives. */
  const changeView = (patch) => {
    if (patch.status !== undefined) setStatus(patch.status);
    if (patch.code !== undefined) setCode(patch.code);
    setQueue((q) => ({ ...q, items: null, next: null, hasMore: false, error: '' }));
    setActiveId(null);
    setOpenId(null);
    setSheetOpen(false);
    setHanded(null);
  };
  // Pressing the view already shown reads nothing, so it must clear nothing.
  const changeStatus = (s) => { if (s !== status) changeView({ status: s }); };
  const changeCode = (c) => { if (c !== code) changeView({ code: c }); };

  function open(id) {
    setActiveId(id);
    setOpenId(id);
    if (narrow) setSheetOpen(true);
  }

  function step(delta) {
    const list = items ?? [];
    if (!list.length) return;
    const i = list.findIndex((x) => x.answerId === activeId);
    const j = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + delta));
    const id = list[j].answerId;
    setActiveId(id);
    // Beside the list the open answer follows the keys; in a sheet, Enter opens it.
    if (!narrow) setOpenId(id);
  }

  function onListKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); step(-Infinity); }
    else if (e.key === 'End') { e.preventDefault(); step(Infinity); }
    else if ((e.key === 'Enter' || e.key === ' ') && activeId) {
      e.preventDefault();
      open(activeId);
      if (!narrow) detailRef.current?.focus();
    }
  }

  const openItem = openId
    ? details[openId]?.item ?? items?.find((x) => x.answerId === openId) ?? summary.items.find((x) => x.answerId === openId) ?? null
    : null;
  const draft = openItem ? drafts[openItem.answerId] ?? draftFor(openItem) : null;

  const setDraft = (patch) => {
    if (!openItem) return;
    const id = openItem.answerId;
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? draftFor(openItem)), ...patch } }));
    setSaid((s) => (s[id] ? { ...s, [id]: null } : s));
  };

  async function decide(item, body) {
    const id = item.answerId;
    setSending(id);
    setSaid((s) => ({ ...s, [id]: null }));
    let res;
    try {
      res = await services.review(id, body);
    } catch (err) {
      // The draft is untouched: a refused decision never costs the note.
      setSaid((s) => ({ ...s, [id]: { status: err.status ?? 0, text: err.message || 'The decision did not reach the server.' } }));
      setSending('');
      return;
    }
    const fresh = res?.item ?? item;
    setDetails((d) => ({ ...d, [id]: { item: fresh, log: res?.log ?? d[id]?.log ?? [], loading: false, error: '' } }));
    setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
    if (res?.changed) setDecided((m) => ({ ...m, [id]: body.decision }));
    setSummary((s) => ({ ...s, items: fresh.reviewStatus === 'provisional' ? s.items : s.items.filter((x) => x.answerId !== id) }));

    // In place, or out of the list when this view no longer holds it.
    const list = items ?? [];
    const i = list.findIndex((x) => x.answerId === id);
    const stays = status === 'all' || fresh.reviewStatus === status;
    setQueue((q) => ({ ...q, items: (q.items ?? []).flatMap((x) => (x.answerId !== id ? [x] : stays ? [fresh] : [])) }));

    const line = savedLine(fresh, body.decision, res?.changed);
    const after = i < 0 ? list[0] ?? null : list[i + 1] ?? (stays ? null : list[i - 1] ?? null);
    setSending('');
    if (after) {
      setHanded({ to: after.answerId, text: line });
      setActiveId(after.answerId);
      setOpenId(after.answerId);
      detailRef.current?.focus();
    } else if (stays) {
      setSaid((s) => ({ ...s, [id]: { ok: true, text: `${line} That was the last answer in this view.` } }));
    } else {
      setHanded({ to: null, text: `${line} That was the last answer in this view.` });
      setActiveId(null);
      setOpenId(null);
      setSheetOpen(false);
      listRef.current?.focus();
    }
  }

  /* ------------------------------------------------------------ rendering */

  const shell = (props, body) => <AccountShell current="review" title="Review answers" {...props}>{body}</AccountShell>;

  if (accountLoading) {
    return shell({ crumb: <span>Review</span> }, <Skeleton />);
  }

  // A student's token is refused here; theirs is the results screen.
  if (role === 'student') {
    return shell({ crumb: <span>Review</span> }, (
      <div className="card">
        <Empty icon="shield" title="Reviewing answers is the teacher's side" action={<Link className="btn btn-primary" to="/me">Go to your results</Link>}>
          A professor reads written answers here and may leave you a note. Any note on your answers is on your own results screen.
        </Empty>
      </div>
    ));
  }

  if (queue.locked) {
    return shell({ crumb: <span>Review</span> }, (
      <div className="card">
        <Empty icon="lock" title="Review needs the teacher key or an account" action={<Link className="btn btn-primary" to="/">Unlock the console</Link>}>
          {queue.error}
        </Empty>
      </div>
    ));
  }

  const waitingN = summary.items.length;
  const crumb = !summary.loading && !summary.error ? (
    <>
      <span className="rv-crumb-dot" data-on={waitingN > 0 || undefined} aria-hidden="true" />
      <span>{waitingN > 0 ? `${summary.hasMore ? `${waitingN}+` : waitingN} waiting` : 'Nothing waiting'}</span>
      {code && <><span aria-hidden="true">·</span><span className="mono">{code}</span></>}
    </>
  ) : <span>Review</span>;

  const sub = readOnly
    ? 'Written and drawn answers across the department and the marks in force. Read only: the professor who runs a room decides.'
    : 'Written answers the machine marked against their rubric, to confirm or change, and drawings, to mark.';

  const waitingInView = code ? summary.items.filter((x) => x.room?.code === code).length : waitingN;
  const actions = (
    <div className="rv-acts">
      <Segmented
        label="Answers by state"
        value={status}
        onChange={changeStatus}
        options={STATUS.map((s) => ({
          id: s.id,
          label: s.label,
          // Counted from the brief's read, so past its cap it is "at least".
          count: s.id === 'provisional' && !summary.loading && !summary.error ? (summary.hasMore ? `${waitingInView}+` : waitingInView) : undefined,
        }))}
      />
      <label className="rv-room">
        <span className="sr-only">Room</span>
        <select className="select input-sm" value={code} onChange={(e) => changeCode(e.target.value)}>
          <option value="">All rooms</option>
          {roomOptions.map((r) => (
            <option key={r.code} value={r.code}>
              {r.code}{r.title ? ` · ${r.title}` : ''}{r.waiting ? ` (${r.waiting} waiting)` : ''}
            </option>
          ))}
        </select>
      </label>
      <Tip label="Read the queue again">
        <Button
          variant="ghost"
          icon="refresh"
          busy={reading && items !== null}
          aria-label="Read the queue again"
          onClick={reloadAll}
        />
      </Tip>
    </div>
  );

  const brief = (
    <Brief summary={summary} rooms={rooms} readOnly={readOnly} decided={decided} onOpen={(it) => open(it.answerId)} />
  );

  const label = STATUS.find((s) => s.id === status)?.label ?? 'All';

  let listBody;
  if (items === null && queue.error) {
    listBody = (
      <div className="card">
        <Empty
          icon="alert"
          title="The queue did not load"
          action={(
            <span className="cluster" style={{ justifyContent: 'center' }}>
              <Button variant="primary" icon="refresh" busy={reading} onClick={reloadAll}>
                Try again
              </Button>
              {code && <Button onClick={() => changeCode('')}>Show all rooms</Button>}
            </span>
          )}
        >
          {queue.error}
        </Empty>
      </div>
    );
  } else if (items === null) {
    listBody = <Skeleton />;
  } else if (items.length === 0 && !queue.hasMore) {
    const plain = status === 'provisional' && !code;
    listBody = (
      <div className="card rv-empty">
        {plain ? (
          <Empty
            icon="checklist"
            title="No answers to review"
            action={<Button icon="history" onClick={() => changeStatus('all')}>See answers already reviewed</Button>}
          >
            Answers land here when a room serves a question that asks students to write in their own words or to draw. The
            machine marks each written one against its rubric as it arrives; {readOnly ? 'the professor' : 'you'} then confirm that
            mark or change it here. A drawing waits for a mark of {readOnly ? 'theirs' : 'yours'}.
          </Empty>
        ) : (
          <Empty
            icon="filter"
            title={`No ${status === 'all' ? '' : `${label.toLowerCase()} `}answers${code ? ` in ${code}` : ''}`}
            action={<Button onClick={() => { changeCode(''); changeStatus('all'); }}>Show every room and state</Button>}
          >
            {status === 'all'
              ? 'No written or drawn answer has been sent in this room.'
              : 'Nothing in this view. The answers themselves have not changed.'}
          </Empty>
        )}
      </div>
    );
  } else {
    listBody = (
      <>
        <div
          ref={listRef}
          className="rv-list"
          role="listbox"
          tabIndex={0}
          aria-label={`${label} answers, newest first`}
          aria-activedescendant={activeId && items.some((x) => x.answerId === activeId) ? `rv-opt-${activeId}` : undefined}
          aria-busy={reading || undefined}
          onKeyDown={onListKey}
          onFocus={() => { if (!activeId && items.length) setActiveId(items[0].answerId); }}
        >
          {days.map((d) => (
            <div key={d.key} role="group" aria-label={d.label} className="rv-day">
              <div className="rv-day-h" aria-hidden="true">{d.label}<span>{plural(d.items.length, 'answer')}</span></div>
              {d.items.map((it) => (
                <QueueItem
                  key={it.answerId}
                  item={it}
                  active={it.answerId === activeId}
                  open={it.answerId === openId}
                  showStatus={status === 'all'}
                  onPick={(id) => { open(id); listRef.current?.focus({ preventScroll: true }); }}
                />
              ))}
            </div>
          ))}
        </div>
        {(queue.hasMore || more.error) && (
          <div className="rv-more">
            {more.error && <Note tone="bad">{more.error}</Note>}
            {queue.hasMore && (
              <Button icon="down" busy={more.busy} onClick={loadMore}>
                {items.length === 0 ? 'Load the next answers' : 'Load more'}
              </Button>
            )}
          </div>
        )}
      </>
    );
  }

  const showDetail = !narrow && items !== null && (items.length > 0 || openItem || handed);
  const entry = openItem ? details[openItem.answerId] : null;
  const detailProps = openItem && {
    item: openItem,
    entry,
    onRetryLog: () => loadDetail(openItem.answerId),
    role,
    readOnly,
    draft,
    onDraft: setDraft,
    onSubmit: (body) => decide(openItem, body),
    busy: sending === openItem.answerId,
    said: said[openItem.answerId],
    handed: handed && handed.to === openItem.answerId ? handed.text : null,
    mediaBlobUrl: services.mediaBlobUrl ?? api.mediaBlobUrl,
  };

  return shell({ crumb, sub, actions }, (
    <>
      {brief}

      <div className={`rv-work${showDetail ? '' : ' is-solo'}`}>
        <section className="rv-queue" aria-label="Queue">
          {items !== null && items.length > 0 && (
            <div className="rv-queue-top">
              <span className="t-meta">
                {plural(items.length, 'answer')}{queue.hasMore ? ' so far' : ''}{code ? ` in ${code}` : ''}, newest first
              </span>
              <span className="rv-keys" aria-hidden="true">
                <span className="kbd">J</span><span className="kbd">K</span> to move
                <span className="kbd">Enter</span> to open
              </span>
            </div>
          )}
          {queue.error && items !== null && <Note tone="bad">The list below is the last one that loaded: {queue.error}</Note>}
          {handed && handed.to === null && <Note tone="ok" role="status">{handed.text}</Note>}
          {listBody}
        </section>

        {showDetail && (
          <aside
            ref={detailRef}
            className="card rv-detail"
            tabIndex={-1}
            aria-label={openItem ? `${nameOf(openItem)}'s answer` : 'The answer you open'}
            aria-busy={(openItem && entry?.loading) || undefined}
          >
            {openItem ? (
              <Detail key={openItem.answerId} {...detailProps} />
            ) : (
              <div className="rv-d-none">
                <span className="rv-d-none-ic" aria-hidden="true"><Icon name="ok" size={18} /></span>
                <b>That was the last one here</b>
                <p className="t-small muted">
                  {queue.hasMore ? 'Load more to see the next answers.' : 'Anything a class writes next will arrive in this queue.'}
                </p>
              </div>
            )}
          </aside>
        )}
      </div>

      {narrow && (
        <Dialog
          sheet
          open={sheetOpen && Boolean(openItem)}
          onOpenChange={(v) => { setSheetOpen(v); if (!v) listRef.current?.focus({ preventScroll: true }); }}
          locked={Boolean(sending)}
          title={openItem ? `${nameOf(openItem)}${openItem.student?.rollNo ? ` · ${openItem.student.rollNo}` : ''}` : 'Answer'}
          description={openItem ? `${openItem.room?.code ?? ''}${openItem.room?.title ? ` · ${openItem.room.title}` : ''}` : undefined}
        >
          {openItem && (
            <div className="rv-sheet" ref={detailRef} tabIndex={-1}>
              <Detail key={openItem.answerId} {...detailProps} inSheet />
            </div>
          )}
        </Dialog>
      )}
    </>
  ));
}

export default function Review() {
  return <ReviewScreen services={api} />;
}
