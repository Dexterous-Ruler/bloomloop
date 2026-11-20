/**
 * Class questions (Phase 5): one approved question of the room put to every
 * phone. Round 1 is voted on, paused so the class can talk it over, voted on
 * again, and closed with or without its key shown on the phones. Staff only.
 *
 * Every figure is the server's (GET /api/session/:code/class-questions and
 * `teacher:class-question`, docs/API.md "Phase 5"). While a round is open the
 * server sends only how many have voted, never what, and this screen shows no
 * more than that. Counts only: no roll number or name is in any body, and none
 * is drawn here. A confidence tap is only ever counted, never put beside an
 * answer or a student.
 *
 *   <ClassQuestions code canControl info pushed onPushed onOpenProjector />
 *     info      the room's row from the room list (status, contentId, settings.mode,
 *               questionIds: null or the room's set)
 *     pushed    the latest teacher:class-question body (Live's feed keeps it)
 *     onPushed  called with the body after this screen's own writes
 *   <ClassQuestionsView ... />    the same, drawn from a read (the gallery uses it)
 *   <RoomConfidence code />       the room's confidence taps, by tap and by right and wrong
 *   <TapBars counts choices />    one set of those counts (the student card uses it)
 *
 * With canControl false (a head of department reading) every control is gone
 * and a line says why; the server answers every write from them with a 403.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import Figure from '../learn/Figure.jsx';
import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { KIND_LABEL, labelOf } from '../lib/kinds.js';
import { Button, Chip, Empty, Icon, Level, Note, Num, Panel, Switch } from '../ui/index.jsx';

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A share as a whole percent, rounded down as the server rounds it. */
const pctDown = (share) => (num(share) === null ? '—' : `${Math.floor(Math.round(share * 10000) / 100)}%`);
const CLOCK = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const clock = (iso) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? CLOCK.format(t) : '';
};
const short = (text, n = 90) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const KINDS = ['mcq', 'truefalse', 'poll', 'multi'];
const TAPS = [{ id: 'sure', label: 'Sure' }, { id: 'think_so', label: 'Think so' }, { id: 'guessing', label: 'Guessing' }];
const NO_TAP = { id: 'none', label: 'No tap' };
const EMPTY_CELL = { answers: 0, correct: 0, wrong: 0, ungraded: 0 };
const tapRows = (choices) => [...(list(choices).length ? choices : TAPS), NO_TAP];

// A push may land after a newer reply: a body never moves a class question back.
const RANK = { open: 0, paused: 1, revote: 2, closed: 3 };

const isPoll = (cq) => cq?.question?.kind === 'poll';
const roundOf = (cq, n) => list(cq?.rounds).find((r) => r?.round === n) ?? null;
const closedRounds = (cq) => list(cq?.rounds).filter((r) => r && !r.open && r.distribution);

/** The room's list with one class question body put in its place. */
export function withBody(data, body) {
  if (!data || !body?.id) return data;
  const items = list(data.classQuestions);
  const at = items.findIndex((c) => c.id === body.id);
  if (at >= 0 && (RANK[body.state] ?? 0) < (RANK[items[at].state] ?? 0)) return data;
  const next = at >= 0
    ? items.map((c, i) => (i === at ? body : c))
    : [...items, body].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return { ...data, classQuestions: next, running: next.find((c) => c.state !== 'closed')?.id ?? null };
}

/**
 * Why a class question cannot be put to this room now, or null. The same rule
 * and the same sentences as the server's (services/classQuestions.js); when the
 * server refuses anyway, its own sentence is shown.
 */
export function blockedReason(status, mode) {
  if (mode === 'teacher-led') {
    return 'This room is Teacher-led, so no phone answers in it and a class question would have nobody to vote. '
      + 'Ask it aloud and count the hands instead.';
  }
  if (status === 'closed') return 'That room is closed, so it cannot take a class question.';
  if (status === 'waiting') return 'That room has not started yet. Start it first, then ask the class.';
  if (status === 'paused') return 'That room is paused. Resume it first, then ask the class.';
  return null;
}

/* --------------------------------------------------------- the stages */

/** Vote, discuss, re-vote, closed: where this class question stands. */
function Stages({ cq }) {
  const s = cq?.state;
  const closed = s === 'closed';
  const steps = cq ? [
    { id: 'vote', label: 'Vote', now: s === 'open', done: s !== 'open' },
    { id: 'discuss', label: 'Discuss', now: s === 'paused', done: Boolean(cq.pausedAt) && s !== 'paused', skipped: closed && !cq.pausedAt },
    { id: 'revote', label: 'Re-vote', now: s === 'revote', done: closed && Boolean(cq.revoteAt), skipped: closed && !cq.revoteAt },
    { id: 'close', label: closed ? (cq.revealed ? 'Closed, key shown' : 'Closed, key not shown') : 'Close', done: closed },
  ] : [
    { id: 'vote', label: 'Vote' }, { id: 'discuss', label: 'Discuss' }, { id: 'revote', label: 'Re-vote' }, { id: 'close', label: 'Close' },
  ];
  const word = (st) => (st.now ? 'now' : st.done ? 'done' : st.skipped ? 'not run' : 'to come');
  return (
    <ol className="cq-stages" aria-label="Where it stands">
      {steps.map((st, i) => (
        <li key={st.id} data-state={st.now ? 'now' : st.done ? 'done' : st.skipped ? 'skipped' : 'todo'}>
          <i aria-hidden="true">{st.done ? <Icon name="check" size={11} /> : i + 1}</i>
          <span>{st.label}<span className="sr-only">, {word(st)}</span></span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------- the brief */

function VoteTile({ label, round, phones, live, delay }) {
  const voted = num(round?.voted) ?? 0;
  const joined = num(phones?.joined) ?? 0;
  const of = Math.max(joined, voted);
  return (
    <div className="ptile cq-tile" style={{ '--d': delay }}>
      <span>{label}</span>
      <b><Num value={voted} /></b>
      <span className="cq-meter" aria-hidden="true"><i style={{ width: `${of ? (voted / of) * 100 : 0}%` }} /></span>
      <small>
        of {plural(joined, 'phone')} joined
        {live && num(phones?.online) !== null && <i>{phones.online} online</i>}
      </small>
    </div>
  );
}

function RightTile({ label, right, delay }) {
  return (
    <div className="ptile cq-tile" style={{ '--d': delay }}>
      <span>{label}</span>
      <b>{right ? <Num value={pctDown(right.share)} /> : '—'}</b>
      <small>{right ? <>{right.students} of {right.of} right</> : 'Nobody voted'}</small>
    </div>
  );
}

/** The figures beside the brief: what the server lets this moment show. */
function Tiles({ cq }) {
  const r1 = roundOf(cq, 1);
  const r2 = roundOf(cq, 2);
  const poll = isPoll(cq);
  const tiles = [];
  if (cq.state === 'open') tiles.push(<VoteTile key="v1" label="Voted so far" round={r1} phones={cq.phones} live />);
  else if (cq.state === 'paused' || (cq.state === 'closed' && !r2)) {
    tiles.push(<VoteTile key="v1" label="Voted" round={r1} phones={cq.phones} />);
    if (!poll) tiles.push(<RightTile key="r1" label="Right" right={r1?.right} delay="0.4s" />);
  } else if (cq.state === 'revote') {
    tiles.push(<VoteTile key="v2" label="Re-vote so far" round={r2} phones={cq.phones} live />);
    tiles.push(poll ? <VoteTile key="v1" label="Voted before" round={r1} phones={cq.phones} delay="0.4s" /> : <RightTile key="r1" label="Right before" right={r1?.right} delay="0.4s" />);
  } else if (poll) {
    tiles.push(<VoteTile key="v1" label="Voted before" round={r1} phones={cq.phones} />);
    tiles.push(<VoteTile key="v2" label="Voted after" round={r2} phones={cq.phones} delay="0.4s" />);
  } else {
    tiles.push(<RightTile key="r1" label="Right before" right={r1?.right} />);
    tiles.push(<RightTile key="r2" label="Right after" right={r2?.right} delay="0.4s" />);
  }
  return <div className="cq-tiles">{tiles}</div>;
}

const STATE_TAG = { open: 'Round 1 open', paused: 'Paused to discuss', revote: 'Re-vote open', closed: 'Closed' };
const STATE_LINE = {
  open: 'Phones are voting. You see how many have voted, not what, until you pause.',
  paused: 'Voting is paused while the class talks it over. Open the re-vote when they are ready, or close it here.',
  revote: 'Phones are voting again. What they chose shows when you close the re-vote.',
};

/** Pause, re-vote and close, with the choice to show the key as it closes. */
function Actions({ cq, busy, error, onAct }) {
  const [reveal, setReveal] = useState(false);
  const poll = isPoll(cq);
  const working = Boolean(busy);
  const act = (action) => onAct(cq, action, action === 'close' && !poll ? reveal : false);
  const closeLabel = cq.state === 'revote' ? 'Close the re-vote' : 'Close now';
  return (
    <div className="cq-acts">
      <div className="cluster">
        {cq.state === 'open' && <Button variant="accent" icon="pause" busy={busy === 'pause'} disabled={working} onClick={() => act('pause')}>Pause to discuss</Button>}
        {cq.state === 'paused' && <Button variant="accent" icon="refresh" busy={busy === 'revote'} disabled={working} onClick={() => act('revote')}>Open the re-vote</Button>}
        <Button variant={cq.state === 'revote' ? 'accent' : undefined} icon="stop" busy={busy === 'close'} disabled={working} onClick={() => act('close')}>{closeLabel}</Button>
        {poll ? (
          <span className="cq-reveal is-off">A poll has no key to show.</span>
        ) : (
          <label className="cq-reveal">
            <Switch checked={reveal} onChange={setReveal} label="Show the key on phones as it closes" disabled={working} />
            <span aria-hidden="true">Show the key on phones as it closes</span>
          </label>
        )}
      </div>
      {error && <p className="cq-err" role="alert"><Icon name="alert" size={14} />{error}</p>}
    </div>
  );
}

function Brief({ cq, running, canControl, busy, error, onAct, onView }) {
  const voting = cq.state === 'open' || cq.state === 'revote';
  const elsewhere = running && running.id !== cq.id ? running : null;
  const q = cq.question ?? {};
  return (
    <Panel className="cq-brief" aria-label="The class question">
      <div className="cq-brief-main">
        <div className="cq-brief-top">
          <span className="tag-mint">
            {voting && <i className="live-dot" aria-hidden="true" />}
            Class question {cq.seq} · {STATE_TAG[cq.state] ?? cq.state}
          </span>
          {cq.startedAt && <span className="cq-when">Asked {clock(cq.startedAt)}{cq.closedAt ? `, closed ${clock(cq.closedAt)}` : ''}</span>}
        </div>
        <h2 className="cq-brief-q">{q.text || 'Question text not stored'}</h2>
        <p className="cq-brief-meta">
          {q.level && <Level level={q.level}>{q.levelLabel ?? LABEL[q.level]}</Level>}
          <span>{q.kindLabel ?? labelOf(q)}</span>
          {q.topic && <span className="clip">{q.topic}</span>}
          {q.sourceLabel && <span>{q.sourceLabel}</span>}
        </p>
        {num(cq.phones?.answeredAlone) > 0 && cq.answeredAloneNote && (
          <p className="cq-alone" role="note"><Icon name="info" size={14} /><span>{cq.answeredAloneNote}</span></p>
        )}
        <Stages cq={cq} />
        {cq.state !== 'closed' && <p className="cq-brief-line">{STATE_LINE[cq.state]}</p>}
        {cq.state === 'closed' && !cq.revoteAt && <p className="cq-brief-line">Closed after the first vote, without a re-vote.</p>}
        {canControl && cq.state !== 'closed' && <Actions key={cq.id} cq={cq} busy={busy} error={error} onAct={onAct} />}
        {elsewhere && (
          <p className="cq-brief-line">
            Class question {elsewhere.seq} is running now.{' '}
            <button type="button" className="cq-linkbtn" onClick={() => onView(null)}>Back to it</button>
          </p>
        )}
      </div>
      <Tiles cq={cq} />
    </Panel>
  );
}

/** Before anything is asked: what a class question does, on the panel. */
function EmptyBrief({ canControl }) {
  return (
    <Panel className="cq-brief cq-brief-empty" aria-label="Class questions">
      <div className="cq-brief-main">
        <span className="tag-mint">Class question · none yet</span>
        <h2 className="cq-brief-q">{canControl ? 'Put one question to the whole class' : 'No class question has been asked in this room'}</h2>
        <p className="cq-brief-line">
          Every phone votes on the same question. You pause so the class can talk it over, then everyone votes again and you see
          what moved. Counts only, never who chose what.
        </p>
        <Stages cq={null} />
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------- the answers */

/** The question's options with each closed round's votes beside them, the key marked. */
function Answers({ cq }) {
  const q = cq.question ?? {};
  const key = new Set(list(q.correct));
  const shown = closedRounds(cq);
  const both = shown.length > 1;
  const byRound = shown.map((r) => new Map(list(r.distribution?.options).map((o) => [o.key, num(o.votes) ?? 0])));
  const r1 = roundOf(cq, 1);
  const r2 = roundOf(cq, 2);
  const sub = cq.state === 'open'
    ? 'What the class chose shows here when you pause the vote, so the votes stay the class’s own.'
    : cq.state === 'paused'
      ? `The first vote, before discussion: ${plural(num(r1?.voted) ?? 0, 'vote')}.`
      : cq.state === 'revote'
        ? 'The first vote below. The re-vote’s counts show when you close it.'
        : both ? 'Before and after discussion, side by side.' : `The first vote: ${plural(num(r1?.voted) ?? 0, 'vote')}.`;
  const label = (i) => (both ? (i === 0 ? 'Before' : 'After') : 'Votes');

  return (
    <section className="card cq-ans" aria-labelledby={`cq-ans-${cq.id}`}>
      <header className="cq-card-h">
        <div className="sec">
          <h2 id={`cq-ans-${cq.id}`}>The answers</h2>
          <p>{sub}</p>
        </div>
        {both && (
          <span className="cq-legend" aria-hidden="true">
            <span><i data-round="1" />Before</span>
            <span><i data-round="2" />After</span>
          </span>
        )}
      </header>

      {q.stimulus?.kind === 'passage' && q.stimulus.text && (
        <details className="cq-stim"><summary>The passage</summary><p>{q.stimulus.text}</p></details>
      )}
      {q.stimulus?.kind === 'image' && q.stimulus.url && (
        <figure className="cq-stim cq-stim-img"><img src={q.stimulus.url} alt={q.stimulus.alt || ''} /></figure>
      )}
      {/* Batch 8: a figure the server drew, with its description and data. */}
      {q.stimulus?.kind === 'figure' && <Figure figure={q.stimulus} className="cq-fig" />}

      <ol className="cq-opts">
        {list(q.options).map((o) => {
          const isKey = key.has(o.key);
          return (
            <li key={o.key} className="cq-opt" data-key={isKey ? 'true' : undefined}>
              <span className="cq-letter mono" aria-hidden="true">{o.key}</span>
              <div className="cq-opt-main">
                <span className="cq-opt-t">
                  <span className="sr-only">{o.key}. </span>
                  {o.label}
                  {isKey && <span className="cq-keytag"><Icon name="check" size={11} />Key</span>}
                </span>
                {shown.map((r, i) => {
                  const votes = byRound[i].get(o.key) ?? 0;
                  const voted = num(r.voted) ?? 0;
                  return (
                    <span key={r.round} className="cq-bar-row">
                      <span className="cq-bar" data-round={r.round} aria-hidden="true">
                        <i style={{ width: `${voted ? Math.min(100, (votes / voted) * 100) : 0}%` }} />
                      </span>
                      <b className="mono">{votes}<span className="sr-only"> {votes === 1 ? 'vote' : 'votes'}{both ? `, ${label(i).toLowerCase()} discussion` : ''}</span></b>
                    </span>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>

      {(q.kind === 'multi' || shown.some((r) => num(r.distribution?.unreadable))) && shown.length > 0 && (
        <div className="cq-foot-lines">
          {q.kind === 'multi' && <p>A choose-all vote counts once on every option it ticked, so the options add up to more than the votes.</p>}
          {shown.map((r, i) => (num(r.distribution?.unreadable) ? (
            <p key={r.round}>{both ? `${label(i)}: ` : ''}{plural(r.distribution.unreadable, 'vote')} picked nothing on the list.</p>
          ) : null))}
        </div>
      )}
      {cq.state === 'revote' && r2 && <p className="cq-foot-lines"><span>{plural(num(r2.voted) ?? 0, 'phone')} of {num(cq.phones?.joined) ?? 0} joined {r2.voted === 1 ? 'has' : 'have'} voted again so far.</span></p>}
    </section>
  );
}

/* ---------------------------------------------- right, and how sure */

const sumOf = (counts, field) => Object.values(counts ?? {}).reduce((n, c) => n + (num(c?.[field]) ?? 0), 0);

/**
 * Confidence taps by right and wrong, one column group per set (before and
 * after a re-vote). Counts only.
 */
export function TapTable({ sets, choices, caption, pollLabel = 'Poll' }) {
  const rows = tapRows(choices);
  const polls = sets.some((s) => sumOf(s.counts, 'ungraded') > 0);
  const graded = sets.some((s) => sumOf(s.counts, 'correct') + sumOf(s.counts, 'wrong') > 0) || !polls;
  const cols = [...(graded ? [['correct', 'Right'], ['wrong', 'Wrong']] : []), ...(polls ? [['ungraded', pollLabel]] : [])];
  const many = sets.length > 1;
  return (
    <table className="cq-taps">
      <caption className="sr-only">{caption}</caption>
      <thead>
        {many && (
          <tr>
            <td />
            {sets.map((s, si) => <th key={s.id} scope="colgroup" colSpan={cols.length} data-g={si ? 'start' : undefined}>{s.label}</th>)}
          </tr>
        )}
        <tr>
          <th scope="col"><span className="sr-only">Tap</span></th>
          {sets.map((s, si) => cols.map(([f, l], ci) => <th key={`${s.id}-${f}`} scope="col" data-v={f} data-g={si && !ci ? 'start' : undefined}>{l}</th>))}
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <th scope="row">{t.label}</th>
            {sets.map((s, si) => cols.map(([f], ci) => {
              const n = num(s.counts?.[t.id]?.[f]) ?? 0;
              return <td key={`${s.id}-${f}`} className="mono" data-zero={n ? undefined : 'true'} data-v={f} data-g={si && !ci ? 'start' : undefined}>{n}</td>;
            }))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sure({ cq }) {
  const shown = closedRounds(cq);
  const both = shown.length > 1;
  const poll = isPoll(cq);
  const name = (r) => (both ? (r.round === 1 ? 'Before' : 'After') : 'First vote');
  return (
    <section className="card cq-sure" aria-labelledby={`cq-sure-${cq.id}`}>
      <header className="cq-card-h">
        <div className="sec">
          <h2 id={`cq-sure-${cq.id}`}>{poll ? 'How sure they were' : 'Right, and how sure'}</h2>
          <p>{poll ? 'A poll has no right answer, so only the taps are counted.' : 'Share right, rounded down, and the confidence taps beside it.'}</p>
        </div>
      </header>
      {!poll && (
        <dl className="cq-rights">
          {shown.map((r) => (
            <div key={r.round} className="cq-right">
              <dt>{name(r)}</dt>
              <dd>
                <b>{r.right ? pctDown(r.right.share) : '—'}</b>
                <span>{r.right ? `${r.right.students} of ${r.right.of} right` : 'Nobody voted'}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="cq-taps-wrap">
        <TapTable
          sets={shown.map((r) => ({ id: r.round, label: name(r), counts: r.confidence }))}
          choices={cq.confidenceChoices}
          caption={poll ? 'Votes at each confidence tap' : 'Votes right and wrong at each confidence tap'}
          pollLabel="Votes"
        />
      </div>
      <ul className="cq-facts">
        {shown.map((r) => {
          const changed = num(r.changedVotes) ?? 0;
          const late = num(r.notCounted) ?? 0;
          return (
            <li key={r.round}>
              {both && <b>{name(r)}: </b>}
              {plural(num(r.voted) ?? 0, 'vote')} counted
              {changed > 0 && `, ${plural(changed, 'earlier vote')} replaced`}
              {late > 0 && `, ${late} kept but not counted`}.
            </li>
          );
        })}
      </ul>
      {cq.confidenceNote && <p className="cq-note">{cq.confidenceNote}</p>}
    </section>
  );
}

/* --------------------------------------------------------- the changes */

const CHANGES = [
  { id: 'wrongToRight', from: 'wrong', to: 'right', label: 'Wrong to right' },
  { id: 'rightToWrong', from: 'right', to: 'wrong', label: 'Right to wrong' },
  { id: 'rightToRight', from: 'right', to: 'right', label: 'Right both times' },
  { id: 'wrongToSameWrong', from: 'wrong', to: 'wrong', label: 'Wrong both times, same answer' },
  { id: 'wrongToOtherWrong', from: 'wrong', to: 'other', label: 'Wrong both times, another answer' },
];
const POLL_CHANGES = [
  { id: 'kept', label: 'Kept their answer' },
  { id: 'changed', label: 'Changed their answer' },
];

function Changes({ cq }) {
  const ch = cq.changes;
  if (!ch) return null;
  const poll = isPoll(cq) || ('kept' in ch && !('wrongToRight' in ch));
  const both = num(ch.both) ?? 0;
  const onlyBefore = num(ch.onlyBefore) ?? 0;
  const onlyAfter = num(ch.onlyAfter) ?? 0;
  return (
    <section className="card cq-changes" aria-labelledby={`cq-ch-${cq.id}`}>
      <header className="cq-card-h">
        <div className="sec">
          <h2 id={`cq-ch-${cq.id}`}>What changed after discussion</h2>
          <p>Of the {plural(both, 'student')} who voted both times. Counts only.</p>
        </div>
      </header>
      <ul className={`cq-moves${poll ? ' is-poll' : ''}`}>
        {(poll ? POLL_CHANGES : CHANGES).map((c) => (
          <li key={c.id} className="cq-move">
            {!poll && (
              <span className="cq-move-g" aria-hidden="true">
                <i data-v={c.from} /><Icon name="forward" size={12} /><i data-v={c.to} />
              </span>
            )}
            <b><Num value={num(ch[c.id]) ?? 0} /></b>
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
      {(onlyBefore > 0 || onlyAfter > 0) && (
        <p className="cq-foot-lines"><span>{plural(onlyBefore, 'student')} voted only before discussion, {onlyAfter} only after. They are not in these counts.</span></p>
      )}
    </section>
  );
}

/* ------------------------------------------------------- the composer */

/** A bank question's options as the class would vote on them, its key marked. */
function bankOptions(q) {
  const kind = q?.kind ?? 'mcq';
  if (kind === 'truefalse') {
    return [{ key: 'A', label: 'True', right: q.answerBool === true }, { key: 'B', label: 'False', right: q.answerBool === false }];
  }
  const keys = kind === 'multi' ? list(q.answerIdxs).map(Number) : kind === 'poll' ? [] : [Number(q.answerIdx)];
  return list(q.options).map((label, i) => ({ key: LETTERS[i], label: String(label), right: keys.includes(i) }));
}

const idOf = (q) => String(q?._id ?? q?.id ?? '');

function Composer({ bank, kinds, setIds, asked, blocked, running, busy, error, onAsk }) {
  const [choice, setChoice] = useState('');
  const pickId = useId();
  useEffect(() => { if (bank?.status === 'idle') bank.load?.(); }, [bank]);

  const allowed = list(kinds).length ? kinds : KINDS;
  const inSet = Array.isArray(setIds) ? new Set(setIds.map((x) => String(x).toLowerCase())) : null;
  const eligible = list(bank?.list).filter((q) => (q.status ?? 'active') === 'active'
    && allowed.includes(q.kind ?? 'mcq')
    && (!inSet || inSet.has(idOf(q).toLowerCase())));
  const fresh = eligible.filter((q) => !asked.has(idOf(q).toLowerCase()));
  const chosen = eligible.find((q) => idOf(q) === choice) ?? null;
  const why = blocked || (running ? 'Another class question is still running in this room. Close it first.' : null);
  const kindsSaid = allowed.map((k) => (KIND_LABEL[k] ?? k).toLowerCase()).join(', ');
  const groups = LEVELS.map((l) => [l, eligible.filter((q) => q.bloom === l)]).filter(([, qs]) => qs.length);
  const other = eligible.filter((q) => !LEVELS.includes(q.bloom));

  async function submit(e) {
    e.preventDefault();
    if (!chosen || why || busy) return;
    if (await onAsk(idOf(chosen))) setChoice('');
  }

  const option = (q) => {
    const done = asked.has(idOf(q).toLowerCase());
    return (
      <option key={idOf(q)} value={idOf(q)} disabled={done}>
        {KIND_LABEL[q.kind ?? 'mcq'] ?? q.kind} · {short(q.text)}{done ? ' (asked already)' : ''}
      </option>
    );
  };

  let body;
  if (bank?.status === 'error') {
    body = (
      <Note tone="bad" role="alert">
        {bank.error || 'The room’s questions could not be read.'}{' '}
        <button type="button" className="cq-linkbtn" onClick={bank.load}>Try again</button>
      </Note>
    );
  } else if (bank?.status !== 'ready') {
    body = <div className="cq-comp-skel" aria-busy="true" aria-label="Reading the room’s questions"><span className="skel" /><span className="skel" /></div>;
  } else if (!eligible.length) {
    body = (
      <Empty icon="ask" title="No question here can go to the class">
        {`This room has no approved ${kindsSaid} question${inSet ? ' in its set' : ''}. Approve one in the bank, or ask aloud and count the hands.`}
      </Empty>
    );
  } else {
    body = (
      <form className="cq-comp-body" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor={pickId}>Question</label>
          <select id={pickId} className="select" value={choice} disabled={Boolean(why) || Boolean(busy)} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{fresh.length ? 'Choose a question' : 'Every question here has been asked'}</option>
            {groups.map(([l, qs]) => <optgroup key={l} label={LABEL[l]}>{qs.map(option)}</optgroup>)}
            {other.length > 0 && <optgroup label="Other">{other.map(option)}</optgroup>}
          </select>
          <div className="hint">
            {plural(eligible.length, 'question')} {inSet ? 'in the room’s set ' : ''}can go to the class
            {eligible.length - fresh.length > 0 ? `, ${eligible.length - fresh.length} asked already` : ''}.
          </div>
        </div>

        {chosen && (
          <div className="cq-preview">
            <p className="cq-preview-meta">
              <Level level={chosen.bloom} />
              <span>{KIND_LABEL[chosen.kind ?? 'mcq']}</span>
              {chosen.topic && <span className="clip">{chosen.topic}</span>}
              {chosen.provenance?.sourceLabel && <span>{chosen.provenance.sourceLabel}</span>}
            </p>
            <p className="cq-preview-q">{chosen.text}</p>
            <ol className="cq-preview-opts">
              {bankOptions(chosen).map((o) => (
                <li key={o.key} data-key={o.right ? 'true' : undefined}>
                  <span className="cq-letter mono" aria-hidden="true">{o.key}</span>
                  <span><span className="sr-only">{o.key}. </span>{o.label}</span>
                  {o.right && <span className="cq-keytag"><Icon name="check" size={11} />Key</span>}
                </li>
              ))}
            </ol>
            <p className="cq-hint">Once asked, it leaves this room’s questions for phones on their own: it is never served to one again here.</p>
          </div>
        )}

        {why && <p className="cq-why"><Icon name="info" size={14} />{why}</p>}
        {error && <Note tone="bad" role="alert">{error}</Note>}
        <div className="cluster">
          <Button type="submit" variant="primary" icon="send" busy={busy} disabled={!chosen || Boolean(why)}>Put to the class</Button>
        </div>
      </form>
    );
  }

  return (
    <section className="card cq-comp" aria-labelledby={`${pickId}-h`}>
      <header className="cq-card-h">
        <div className="sec">
          <h2 id={`${pickId}-h`}>Ask the class</h2>
          <p>An approved question of this room with options every phone can vote on: {kindsSaid}.</p>
        </div>
      </header>
      {body}
    </section>
  );
}

/* --------------------------------------------------- the ones asked */

function summary(cq) {
  const r1 = roundOf(cq, 1);
  const r2 = roundOf(cq, 2);
  if (cq.state === 'open') return `Voting now, ${num(r1?.voted) ?? 0} so far`;
  if (cq.state === 'revote') return `Re-vote now, ${num(r2?.voted) ?? 0} so far`;
  if (isPoll(cq)) return [r1 && `${plural(r1.voted ?? 0, 'vote')} before`, r2 && !r2.open && `${r2.voted ?? 0} after`].filter(Boolean).join(', ');
  const parts = [r1?.right && `${pctDown(r1.right.share)} right before`, r2?.right && `${pctDown(r2.right.share)} after`].filter(Boolean);
  return parts.length ? parts.join(', ') : `${plural(num(r1?.voted) ?? 0, 'vote')}`;
}

const STATE_CHIP = { open: 'Voting', paused: 'Paused', revote: 'Re-vote', closed: 'Closed' };

function Asked({ items, focusId, runningId, onView }) {
  if (!items.length) return null;
  const newest = [...items].reverse();
  return (
    <section className="card cq-asked" aria-labelledby="cq-asked-h">
      <header className="cq-card-h">
        <div className="sec">
          <h2 id="cq-asked-h">Asked in this room</h2>
          <p>{plural(items.length, 'class question')}, newest first. Choose one to read its counts.</p>
        </div>
      </header>
      <ul className="rows cq-asked-rows">
        {newest.map((c) => (
          <li key={c.id}>
            <button type="button" className="rw cq-asked-row" aria-current={c.id === focusId ? 'true' : undefined} onClick={() => onView(c.id === runningId ? null : c.id)}>
              <span className="grow">
                <span className="cq-asked-t clip">{c.question?.text || 'Question text not stored'}</span>
                <span className="t-meta">{summary(c)}</span>
              </span>
              <Chip className={`cq-asked-chip${c.state === 'closed' ? '' : ' chip-live'}`} dot={c.state !== 'closed'}>
                {STATE_CHIP[c.state] ?? c.state}{c.state === 'closed' && c.revealed ? ', key shown' : ''}
              </Chip>
              <time className="mono t-meta">{clock(c.startedAt)}</time>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------- the view */

function Skeleton() {
  return (
    <div className="cq cq-skel" aria-busy="true" aria-label="Reading the class questions">
      <span className="skel cq-skel-brief" />
      <div className="cq-grid"><span className="skel" /><span className="skel" /></div>
    </div>
  );
}

/** The class question screen from its read. Pure, for the gallery. */
export function ClassQuestionsView({
  data, load, bank, info, canControl, viewId, onView, busy = '', askError = '', actError, onAsk, onAct, onRetry, onOpenProjector,
}) {
  const asked = useMemo(() => new Set(list(data?.classQuestions).map((c) => String(c.questionId ?? '').toLowerCase())), [data]);
  if (!data) {
    if (load?.status === 'error') {
      return (
        <Note tone="bad" role="alert">
          {load.error || 'The class questions could not be read.'}{' '}
          {onRetry && <button type="button" className="cq-linkbtn" onClick={onRetry}>Try again</button>}
        </Note>
      );
    }
    return <Skeleton />;
  }

  const items = list(data.classQuestions);
  const running = items.find((c) => c.id === data.running) ?? items.find((c) => c.state !== 'closed') ?? null;
  const focus = items.find((c) => c.id === viewId) ?? running ?? items.at(-1) ?? null;
  const status = info?.status ?? data.room?.status;
  const blocked = blockedReason(status, info?.settings?.mode);
  const closedOnes = focus ? closedRounds(focus) : [];

  return (
    <div className={`cq${canControl ? '' : ' is-read'}`}>
      {!canControl && (
        <Note icon="eye" className="cq-readonly">
          Read only. You can see this room’s class questions and their counts; only the professor who runs the room can ask one or move it on.
        </Note>
      )}

      {focus
        ? <Brief cq={focus} running={running} canControl={canControl} busy={busy} error={actError?.id === focus.id ? actError.text : ''} onAct={onAct} onView={onView} />
        : <EmptyBrief canControl={canControl} />}

      {focus && (
        <div className={`cq-grid${closedOnes.length ? '' : ' is-one'}`}>
          <Answers cq={focus} />
          {closedOnes.length > 0 && <Sure cq={focus} />}
        </div>
      )}
      {focus && <Changes cq={focus} />}

      {(canControl || items.length > 0) && (
        <div className={`cq-grid cq-low${canControl && items.length ? '' : ' is-one'}`}>
          {canControl && (
            <Composer
              bank={bank}
              kinds={data.kinds}
              setIds={info?.questionIds}
              asked={asked}
              blocked={blocked}
              running={running}
              busy={busy === 'ask'}
              error={askError}
              onAsk={onAsk}
            />
          )}
          <Asked items={items} focusId={focus?.id} runningId={running?.id} onView={onView} />
        </div>
      )}

      <div className="cq-foot">
        <p className="cq-wall">
          <Icon name="projector" size={14} />
          <span>The wall shows a class question only when it is put there, from the projector controls, with its counts if they are switched on.</span>
          {onOpenProjector && <Button size="sm" variant="ghost" icon="forward" onClick={onOpenProjector}>Projector controls</Button>}
        </p>
        {data.note && <p className="cq-privacy"><Icon name="eyeOff" size={14} /><span>{data.note}</span></p>}
      </div>
    </div>
  );
}

/** The chapter's bank, read once on first need: the questions a class question may name. */
function useBank(contentId) {
  const [state, setState] = useState({ status: 'idle', list: null, error: '' });
  const load = useCallback(async () => {
    if (!contentId) { setState({ status: 'ready', list: [], error: '' }); return; }
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const bank = await api.getBank(contentId);
      setState({ status: 'ready', list: list(bank?.questions), error: '' });
    } catch (err) {
      setState({ status: 'error', list: null, error: err.message });
    }
  }, [contentId]);
  return useMemo(() => ({ ...state, load }), [state, load]);
}

export default function ClassQuestions({ code, canControl, info, pushed, onPushed, onOpenProjector }) {
  const [data, setData] = useState(null);
  const [load, setLoad] = useState({ status: 'loading', error: '' });
  const [viewId, setViewId] = useState(null);
  const [busy, setBusy] = useState('');
  const [askError, setAskError] = useState('');
  const [actError, setActError] = useState({ id: null, text: '' });
  const bank = useBank(info?.contentId);
  const status = info?.status;

  const read = useCallback(async () => {
    try {
      const body = await api.classQuestions(code);
      setData(body);
      setLoad({ status: 'ready', error: '' });
    } catch (err) {
      setLoad({ status: 'error', error: err.message });
    }
  }, [code]);

  // Read again when the room's status moves: closing the room closes its class question.
  useEffect(() => { read(); }, [read, status]);
  useEffect(() => { if (pushed?.id) setData((d) => withBody(d, pushed)); }, [pushed]);

  const put = (body) => {
    setData((d) => withBody(d, body));
    onPushed?.(body);
  };

  async function ask(questionId) {
    setBusy('ask');
    setAskError('');
    try {
      put(await api.askClass(code, questionId));
      setViewId(null);
      return true;
    } catch (err) {
      setAskError(err.message);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function act(cq, action, reveal) {
    setBusy(action);
    setActError({ id: null, text: '' });
    try {
      const body = action === 'pause' ? await api.pauseClassQuestion(code, cq.id)
        : action === 'revote' ? await api.revoteClassQuestion(code, cq.id)
          : await api.closeClassQuestion(code, cq.id, reveal === true);
      put(body);
    } catch (err) {
      setActError({ id: cq.id, text: err.message });
      // A 409 means it moved on elsewhere (another tab, the room closed): catch up.
      if (err.status === 409) read();
    } finally {
      setBusy('');
    }
  }

  return (
    <ClassQuestionsView
      data={data}
      load={load}
      bank={bank}
      info={info}
      canControl={Boolean(canControl)}
      viewId={viewId}
      onView={setViewId}
      busy={busy}
      askError={askError}
      actError={actError}
      onAsk={ask}
      onAct={act}
      onRetry={read}
      onOpenProjector={onOpenProjector}
    />
  );
}

/* ------------------------------------------------------- room confidence */

/**
 * One set of confidence counts as bars: for each tap, how many answers and how
 * many of them were right, wrong or a poll. Counts only, never a student.
 */
export function TapBars({ counts, choices, label = 'Answers at each confidence tap' }) {
  const rows = tapRows(choices).map((t) => ({ ...t, c: { ...EMPTY_CELL, ...(counts?.[t.id] ?? {}) } }));
  const most = Math.max(1, ...rows.map((r) => num(r.c.answers) ?? 0));
  const polls = rows.some((r) => r.c.ungraded > 0);
  return (
    <div className="cq-tbars-wrap">
      <ul className="cq-tbars" aria-label={label}>
        {rows.map((r) => {
          const words = [r.c.correct || r.c.wrong || !r.c.ungraded ? `${r.c.correct} right, ${r.c.wrong} wrong` : null, r.c.ungraded ? `${r.c.ungraded} poll` : null].filter(Boolean).join(', ');
          return (
            <li key={r.id} data-none={r.c.answers ? undefined : 'true'}>
              <span className="cq-tb-l">{r.label}</span>
              <span className="cq-tb-track" aria-hidden="true">
                <span style={{ width: `${(r.c.answers / most) * 100}%` }}>
                  {r.c.correct > 0 && <i data-v="right" style={{ flex: r.c.correct }} />}
                  {r.c.wrong > 0 && <i data-v="wrong" style={{ flex: r.c.wrong }} />}
                  {r.c.ungraded > 0 && <i data-v="poll" style={{ flex: r.c.ungraded }} />}
                </span>
              </span>
              <span className="cq-tb-n">
                <b className="mono">{r.c.answers}</b>
                <span>{r.c.answers ? words : 'none'}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="cq-tb-key" aria-hidden="true">
        <span><i data-v="right" />Right</span>
        <span><i data-v="wrong" />Wrong</span>
        {polls && <span><i data-v="poll" />Poll, no right answer</span>}
      </p>
    </div>
  );
}

function ConfQuestions({ questions, choices }) {
  const [open, setOpen] = useState(null);
  const base = useId();
  if (!questions.length) return null;
  return (
    <details className="cq-cq">
      <summary>By question <span className="t-meta">{plural(questions.length, 'question')}</span></summary>
      <ul className="cq-cq-list">
        {questions.map((q, i) => {
          const id = q.questionId ?? `q${i}`;
          const isOpen = open === id;
          const tapped = (num(q.answers) ?? 0) - (num(q.counts?.none?.answers) ?? 0);
          return (
            <li key={id} data-open={isOpen ? 'true' : undefined}>
              <button type="button" className="cq-cq-row" aria-expanded={isOpen} aria-controls={`${base}-${i}`} onClick={() => setOpen(isOpen ? null : id)}>
                <span className="grow">
                  <span className="cq-cq-t">{q.text || 'Question text not stored'}</span>
                  <span className="cq-cq-meta">
                    {q.level && <Level level={q.level} />}
                    <span>{labelOf(q)}</span>
                    <span>{plural(num(q.answers) ?? 0, 'answer')}, {tapped} with a tap</span>
                  </span>
                </span>
                <Icon name={isOpen ? 'chevronUp' : 'chevron'} size={14} />
              </button>
              {isOpen && <div id={`${base}-${i}`} className="cq-cq-open"><TapBars counts={q.counts} choices={choices} label={`Answers at each tap for: ${short(q.text, 60)}`} /></div>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The room's confidence counts, from GET …/confidence. Pure, for the gallery. */
export function RoomConfidenceView({ data, error, loading, onRetry }) {
  const hid = useId();
  const head = (sub) => (
    <header className="cq-card-h">
      <div className="sec">
        <h2 id={hid}>How sure students said they were</h2>
        <p>{sub}</p>
      </div>
      {onRetry && data && <Button size="sm" variant="ghost" icon="refresh" busy={loading} onClick={onRetry}>Read again</Button>}
    </header>
  );

  if (!data) {
    return (
      <section className="card cq-conf" aria-labelledby={hid}>
        {head('Over the final answers to students’ own questions in this room.')}
        {error ? (
          <div className="cq-pad">
            <Note tone="bad" role="alert">
              {error}{' '}
              {onRetry && <button type="button" className="cq-linkbtn" onClick={onRetry}>Try again</button>}
            </Note>
          </div>
        ) : (
          <div className="cq-comp-skel" aria-busy="true" aria-label="Counting the confidence taps"><span className="skel" /><span className="skel" /></div>
        )}
      </section>
    );
  }

  const answers = num(data.answers) ?? 0;
  const tapped = num(data.tapped) ?? 0;
  return (
    <section className="card cq-conf" aria-labelledby={hid}>
      {head(answers
        ? `${tapped} of ${plural(answers, 'final answer')} to students’ own questions carried a tap. Class questions count theirs on their own.`
        : 'Over the final answers to students’ own questions in this room.')}
      {answers === 0 ? (
        <Empty icon="gauge" title="No final answer yet">
          When phones answer their own questions, how sure they said they were is counted here beside whether they were right.
        </Empty>
      ) : (
        <div className="cq-conf-body">
          <TapBars counts={data.counts} choices={data.choices} label="Final answers in this room at each confidence tap" />
          {tapped === 0 && <p className="cq-hint">No answer carried a tap yet: a tap is optional on every answer.</p>}
          <ConfQuestions questions={list(data.questions)} choices={data.choices} />
        </div>
      )}
      {error && <p className="cq-hint cq-pad-x">Could not read the counts again just now ({error}). These were read earlier.</p>}
      {data.note && <p className="cq-note cq-pad-x">{data.note}</p>}
    </section>
  );
}

/** The room's confidence taps: GET /api/session/:code/confidence, read again on request. */
export function RoomConfidence({ code }) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const read = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await api.roomConfidence(code);
      setState({ data, error: '', loading: false });
    } catch (err) {
      setState((s) => ({ ...s, error: err.message, loading: false }));
    }
  }, [code]);
  useEffect(() => { read(); }, [read]);
  return <RoomConfidenceView data={state.data} error={state.error} loading={state.loading} onRetry={read} />;
}
