/**
 * A question the professor has put to the whole class (Phase 5). The student's
 * own question is parked behind this, untouched, and comes back when it closes.
 *
 * What a phone may know here is narrow on purpose: the question, its options by
 * letter (so the class can talk about "B"), whether a vote is being taken, and
 * this phone's own vote. Never a count, never a classmate, and never whether a
 * vote was right: the only right answer ever shown is the key, and only when
 * the professor closes the question and reveals it.
 */

import { useEffect, useState } from 'react';

import { KIND_LABEL } from '../lib/kinds.js';
import { Button, Icon, Note, Panel } from '../ui/index.jsx';
import { Provenance } from './Question.jsx';
import Stimulus from './Stimulus.jsx';
import { Dock, Sure } from './parts.jsx';

/* A vote is sent in the terms `student:answer` would use for the kind: an
   option's position, the positions ticked for `multi`, true or false. On screen
   every kind is the same lettered list, so these two translate between them. */

function toResponse(kind, pick) {
  if (kind === 'multi') return [...pick].sort((a, b) => a - b);
  if (kind === 'truefalse') return pick === 0;
  return pick;
}

function fromResponse(kind, response) {
  if (kind === 'multi') return Array.isArray(response) ? response.map(Number).filter(Number.isInteger) : [];
  if (kind === 'truefalse') return response === true ? 0 : response === false ? 1 : null;
  const n = Number(response);
  return response !== null && response !== '' && Number.isInteger(n) ? n : null;
}

/** The option positions a vote picked, whatever the kind. */
function picked(kind, response) {
  const p = fromResponse(kind, response);
  if (kind === 'multi') return p;
  return p === null ? [] : [p];
}

/** "B", or "A and C", for saying a vote back: the list beside it carries the labels. */
function said(options, positions) {
  const keys = positions.map((i) => options[i]?.key).filter(Boolean);
  return keys.length > 1 ? `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}` : keys.join('');
}

/**
 * @param q        the class question as the server last sent it (`class:question`)
 * @param end      `class:closed` when it closed with the key revealed, else null
 * @param mine     this phone's vote in force in q.round: { response, confidence }, or null
 * @param first    round 1's vote, shown during the re-vote; null otherwise
 * @param kept     the latest vote on this phone not yet confirmed, for this round:
 *                 { response, confidence, state: 'queued' | 'sending', paused }, or null;
 *                 `paused` when it is waiting for the room, not the network
 * @param note     the server's sentence about a vote it kept but did not count
 * @param choices  the confidence taps: [{ id, label }]
 * @param foot     what the session says under every screen (focus mode)
 */
export default function ClassVote({ q, end = null, mine = null, first = null, kept = null, note = '', choices = [], foot = null, onVote, onBack }) {
  const kind = q?.question?.kind ?? 'mcq';
  const many = kind === 'multi';
  const options = Array.isArray(q?.options) ? q.options : [];
  const closed = Boolean(end);
  const voting = !closed && q?.voting === true;

  // The draft: what is tapped on screen now, which may differ from the vote in
  // force until it is sent. Starts from the vote in force (or one held on this
  // phone), so a reconnect puts the student's own choice back under their thumb.
  const [pick, setPick] = useState(() => {
    const start = mine ?? kept;
    return start ? fromResponse(kind, start.response) : many ? [] : null;
  });
  const [conf, setConf] = useState(() => (mine ?? kept)?.confidence ?? null);

  // A vote in force that arrives after this mounted: the echo of the one just
  // sent, or `mine` on a reconnect.
  useEffect(() => {
    if (!mine) return;
    setPick(fromResponse(kind, mine.response));
    setConf(mine.confidence ?? null);
  }, [mine, kind]);

  const inForce = mine ? picked(kind, mine.response) : [];
  const chosen = many ? pick : pick === null ? [] : [pick];
  const ready = many ? pick.length > 0 : pick !== null;
  // A vote on its way locks the choices for the moment it takes. One held on
  // this phone does not: the student can change it before it goes.
  const sending = kept?.state === 'sending';
  const draft = JSON.stringify(ready ? toResponse(kind, pick) : null);
  const waiting = Boolean(kept) && draft === JSON.stringify(kept.response) && (kept.confidence ?? null) === conf;
  // The draft is the vote already in force: nothing to send.
  const same = Boolean(mine) && ready
    && JSON.stringify(toResponse(kind, pick)) === JSON.stringify(toResponse(kind, fromResponse(kind, mine.response)))
    && (mine.confidence ?? null) === conf;

  const tapLabel = (id) => choices.find((c) => c.id === id)?.label ?? '';
  const voteLine = (vote) => {
    if (!vote) return '';
    const what = said(options, picked(kind, vote.response));
    const tap = tapLabel(vote.confidence);
    return tap ? `${what} · ${tap}` : what;
  };

  const key = closed && Array.isArray(end.correct) ? end.correct : [];
  const last = mine ?? first;
  const lastPicked = last ? picked(kind, last.response) : [];

  const toggle = (i) => {
    if (!voting || sending) return;
    if (many) setPick((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
    else setPick(i);
  };

  const stateOf = (i) => {
    if (closed) {
      if (key.includes(options[i]?.key)) return 'yes';
      return lastPicked.includes(i) ? 'pick' : undefined;
    }
    if (voting) return chosen.includes(i) ? 'pick' : undefined;
    return inForce.includes(i) ? 'pick' : undefined;
  };

  const tagOf = (i) => {
    const isKey = closed && key.includes(options[i]?.key);
    const isMine = closed ? lastPicked.includes(i) : inForce.includes(i);
    if (isKey && isMine) return 'The answer · your vote';
    if (isKey) return 'The answer';
    if (isMine) return 'Your vote';
    return '';
  };

  const state = closed ? 'closed' : q?.state;
  const tag = {
    open: 'Class question',
    paused: 'Class question · Paused',
    revote: 'Class question · Re-vote',
    closed: 'Class question · Closed',
  }[state] ?? 'Class question';
  const message = closed ? end.message : q?.message;

  return (
    <>
      {/* What matters now, in the server's words. */}
      <Panel className="ln-cq-brief">
        <span className="tag-mint">{tag}</span>
        {message && <p className="ln-cq-say">{message}</p>}
        {/* Paused: the class is talking it over, and this is what the student
            said. Nothing to tap until the professor opens the re-vote. */}
        {state === 'paused' && (
          <p className="ln-cq-mine">
            {mine ? <>Your vote: <b>{voteLine(mine)}</b></> : 'You did not vote in this round.'}
          </p>
        )}
        {state === 'revote' && first && (
          <p className="ln-cq-mine">Your first vote: <b>{voteLine(first)}</b></p>
        )}
      </Panel>

      <article className="ln-card" aria-label="The question put to the class">
        <Stimulus key={`stim:${q?.id}`} stimulus={q?.question?.stimulus} />
        <div className="ln-ask">
          <span className="ln-kind">
            {KIND_LABEL[kind] ?? kind}
            {q?.question?.topic ? <span>{` · ${q.question.topic}`}</span> : null}
          </span>
          <h1 className="ln-text wrap-any" data-long={String(q?.question?.text ?? '').length > 160 ? 'true' : undefined}>
            {q?.question?.text}
          </h1>
          <Provenance question={q?.question} />
        </div>

        {voting && <Sure choices={choices} value={conf} onChange={setConf} locked={sending} />}

        <div className="ln-opts" role="group" aria-label={many ? 'Options, choose all that apply' : 'Options'}>
          {options.map((o, i) => {
            const s = stateOf(i);
            const t = tagOf(i);
            return (
              <button
                key={o.key}
                type="button"
                className="ln-opt"
                data-state={s}
                aria-pressed={voting ? chosen.includes(i) : undefined}
                disabled={!voting || sending}
                onClick={() => toggle(i)}
              >
                {/* The letter stays, so the class can still say "C". */}
                <span className="ln-key" aria-hidden="true">{o.key}</span>
                <span className="ln-opt-t">
                  <span className="wrap-any"><span className="sr-only">{o.key}. </span>{o.label}</span>
                  {t && <span className="ln-tag">{t}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </article>

      <div className="ln-foot">
        {/* A vote the server kept and did not count. Its sentence, as given;
            the vote in force is unchanged. */}
        {note && <Note role="status">{note}</Note>}
        <p className="t-small muted">Put to the whole class. It does not change your level.</p>
        {foot}
      </div>

      {closed && (
        <Dock>
          <Button variant="primary" size="xl" block onClick={onBack}>
            Back to my questions <Icon name="forward" />
          </Button>
        </Dock>
      )}

      {voting && (
        <Dock>
          {/* On this phone and not yet confirmed: said as such, never as taken. */}
          {waiting ? (
            <div className="ln-cq-sent" role="status">
              <span className="ln-cq-tick">{sending ? <span className="spinner" aria-hidden="true" /> : <Icon name="clock" size={18} />}</span>
              <div className="grow">
                <b>Your vote: {voteLine(kept)}</b>
                <span className="t-small">
                  {sending
                    ? 'Saved on this phone, sending.'
                    : kept.paused ? 'Saved on this phone. It will be sent when the room carries on.' : 'Saved on this phone. It will be sent when you reconnect.'}
                </span>
              </div>
            </div>
          ) : /* What the server took, said back. Never right or wrong. */ mine && same && !sending ? (
            <div className="ln-cq-sent" role="status">
              <span className="ln-cq-tick"><Icon name="check" size={18} /></span>
              <div className="grow">
                <b>Your vote: {voteLine(mine)}</b>
                {mine.message && <span className="t-small">{mine.message}</span>}
              </div>
            </div>
          ) : (
            <Button
              variant="primary"
              size="xl"
              block
              busy={sending}
              disabled={!ready || sending}
              onClick={() => onVote(toResponse(kind, pick), conf)}
            >
              {sending ? 'Sending your vote' : !ready ? (many ? 'Choose all that apply' : 'Choose your answer') : mine ? 'Change my vote' : 'Send my vote'}
            </Button>
          )}
        </Dock>
      )}
    </>
  );
}
