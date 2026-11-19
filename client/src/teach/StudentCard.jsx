/**
 * One student's card in one room (Phase 3), in a sheet docked to the right:
 * their band and the sentence behind it, the level being served and why, their
 * accuracy at each level beside the class's, how sure they said they were (as
 * counts, never beside an answer), their last final answers, the planned next
 * set, and this room's teacher records about them. Staff only: never on a phone
 * or the projector.
 *
 * Phase 5, honest indicators: what the level served rests on (serving.basis)
 * beside it, every level change the ladder made with its reason
 * (serving.moves), mastery per level against the room's goal (mastery), and,
 * once a second language exists, which answers were in another language
 * (languages). A provisional band or level is never drawn as a firm one.
 *
 * Batch 8: an answer to a question the student had practised in the Learning
 * Hub first carries the server's `practisedNote`, shown under that answer as a
 * neutral note, never as a label on the student; and each answer's `answerKey`
 * (the key it was stored under, the phone's own id for it when it sent one) is
 * listed under "Answer references", folded away, for tracing a kept answer.
 *
 * Every figure and sentence is the server's (GET /api/session/:code/students/
 * :roll/card, docs/API.md). The next set is the selector's plan and is labelled
 * as one, never as a promise.
 *
 *   <StudentCard code roll onClose />        reads the card; roll null draws nothing
 *   <StudentCardView card error onClose />   the same, drawn from a body (the gallery uses it)
 */

import { useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL } from '../lib/bloom.js';
import { Dialog, Icon, Level, Note } from '../ui/index.jsx';
import { TapBars } from './ClassQuestions.jsx';

import '../styles/levels.css';

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (v) => (num(v) === null ? '—' : `${Math.round(v * 100)}%`);
const clock = (iso) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

const ATTENDANCE = { present: 'Present', late: 'Late', absent: 'Absent', unmarked: 'Not marked yet' };
const ROLE = { current: 'their level', review: 'review', stretch: 'stretch' };
const NO_BAND = 'Not enough answers yet';

/** The mark on an answer, as a glyph and a word. */
function markOf(a) {
  if (a.ungraded || typeof a.correct !== 'boolean') return { v: 'none', icon: 'dot', word: a.ungraded ? 'Poll' : 'No mark' };
  const s = num(a.score);
  if (s !== null && s > 0 && s < 1) return { v: a.correct ? 'yes' : 'no', icon: a.correct ? 'check' : 'close', word: `${a.correct ? 'Right' : 'Wrong'}, ${pct(s)}` };
  return { v: a.correct ? 'yes' : 'no', icon: a.correct ? 'check' : 'close', word: a.correct ? 'Right' : 'Wrong' };
}

function Sec({ title, aside, children }) {
  return (
    <section className="co-sc-sec">
      <div className="co-sc-h"><h3>{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

/** Accuracy at each level, theirs beside the class's in this room, with the answers behind each. */
const anyAnswer = (levels) => levels.some((l) => l.answers || l.class?.answers);

function Levels({ levels }) {
  if (!anyAnswer(levels)) return <p className="co-sc-quiet">No graded answer at any level in this room yet.</p>;
  return (
    <ul className="co-lvls">
      {levels.map((l) => {
        const mine = num(l.accuracy);
        const theirs = num(l.class?.accuracy);
        return (
          <li key={l.level} data-level={l.level} data-none={l.answers ? undefined : 'true'}>
            <Level level={l.level}>{l.label}</Level>
            <span className="co-lv-bars" aria-hidden="true">
              <i className="co-lv-me"><b style={{ width: `${(mine ?? 0) * 100}%` }} /></i>
              <i className="co-lv-cls"><b style={{ width: `${(theirs ?? 0) * 100}%` }} /></i>
            </span>
            <span className="co-lv-n">
              <span>{l.answers ? <><b className="mono">{pct(mine)}</b> {l.correct} of {l.answers}</> : 'Not answered'}</span>
              <span className="co-lv-class">Class {l.class?.answers ? <><b className="mono">{pct(theirs)}</b> {l.class.correct} of {l.class.answers}</> : '—'}</span>
              {l.withdrawn > 0 && <span className="co-lv-wd">{l.withdrawn} set aside</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function NextSet({ next, student, room }) {
  if (!next) {
    const why = !student.joined
      ? 'No phone joined this room, so nothing is planned.'
      : room.mode === 'teacher-led'
        ? 'A Teacher-led room serves nothing on phones, so nothing is planned.'
        : room.status === 'closed' ? 'The room is closed, so nothing more is planned.' : 'Nothing is planned.';
    return <p className="co-sc-quiet">{why}</p>;
  }
  return (
    <div className="co-next">
      {next.onScreen && (
        <p className="co-next-now">On their screen now: <Level level={next.onScreen.level}>{next.onScreen.label}</Level></p>
      )}
      {next.empty ? (
        <p className="co-sc-quiet">{next.empty}</p>
      ) : (
        <ol className="co-next-steps" aria-label={`Planned next: ${next.summary}`}>
          {list(next.levels).map((l) => (
            <li key={l.level}>
              <b className="mono">{l.count}</b>
              <Level level={l.level}>{l.label}</Level>
              <span>{ROLE[l.role] ?? l.role}</span>
            </li>
          ))}
        </ol>
      )}
      {next.note && <p className="co-next-note">{next.note}</p>}
    </div>
  );
}

function LastAnswers({ answers, languages }) {
  const items = list(answers?.items);
  if (!items.length) return <p className="co-sc-quiet">No final answer yet.</p>;
  const original = languages?.original ?? null;
  const nameOf = (code) => list(languages?.languages).find((l) => l.language === code)?.name ?? String(code).toUpperCase();
  return (
    <ol className="co-ans">
      {items.map((a) => {
        const m = markOf(a);
        return (
          <li key={a.answerId}>
            <span className="co-ans-mark" data-v={m.v} aria-hidden="true"><Icon name={m.icon} size={12} /></span>
            <div className="co-ans-main">
              <p className="co-ans-q">{a.question?.text || a.snapshot?.text || 'Question text not stored'}</p>
              <p className="co-ans-meta">
                <b data-v={m.v}>{m.word}</b>
                {a.level && <span className="co-ans-lv" data-level={a.level}><i />{LABEL[a.level] ?? a.level}</span>}
                {a.topic && <span className="clip">{a.topic}</span>}
                {a.review?.status === 'provisional' && <span>Not reviewed yet</span>}
                {original && a.language && a.language !== original && (
                  <span className="co-ans-lang" title={`Answered in ${nameOf(a.language)}, not the question’s own ${languages?.originalName ?? original}`}>{nameOf(a.language)}</span>
                )}
                {a.answeredAt && <time>{clock(a.answeredAt)}</time>}
              </p>
              {a.practisedInHub && a.practisedNote && <p className="ev-practised"><Icon name="path" size={12} />{a.practisedNote}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The key each answer was stored under, folded away: for tracing an answer a phone kept and sent later. */
function AnswerKeys({ answers }) {
  const items = list(answers?.items).filter((a) => a.answerKey);
  if (!items.length) return null;
  return (
    <details className="ev-refs">
      <summary><Icon name="chevron" size={14} />Answer references</summary>
      <p>The key each answer above was stored under: the phone’s own id for it when it sent one.</p>
      <ol>
        {items.map((a) => (
          <li key={a.answerId ?? a.answerKey}>
            <time className="mono">{clock(a.answeredAt)}</time>
            <span className="ev-key">{a.answerKey}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Their confidence taps in this room, counted by tap and by right and wrong.
 * Counts only: never a label on the student, never the tap beside an answer.
 */
function Confidence({ confidence }) {
  const counts = confidence.counts ?? {};
  const answers = Object.values(counts).reduce((n, c) => n + (num(c?.answers) ?? 0), 0);
  return (
    <div className="cq-sc">
      {answers ? (
        <TapBars counts={counts} choices={confidence.choices} label="Their final answers in this room at each confidence tap" />
      ) : <p className="co-sc-quiet">No final answer yet.</p>}
      {confidence.note && <p className="cq-sc-note">{confidence.note}</p>}
    </div>
  );
}

function Records({ records }) {
  const obs = records?.observation ?? {};
  const cur = obs.current;
  const history = list(obs.history);
  const picks = list(records?.picks);
  return (
    <div className="co-recs">
      <div className="co-rec-row">
        <span className="co-rec-k">Observation today</span>
        {cur ? (
          <div className="co-rec-v">
            <b>{cur.label}</b>
            {cur.note && <p className="co-rec-note">{cur.note}</p>}
            <span className="co-rec-meta">{[cur.room && `Room ${cur.room}`, clock(cur.observedAt)].filter(Boolean).join(' · ')}</span>
          </div>
        ) : <span className="co-sc-quiet">None</span>}
      </div>
      {history.length > 0 && (
        <details className="co-log">
          <summary>{plural(history.length, 'change')} today</summary>
          <ol>
            {history.map((e) => (
              <li key={e.id}>
                <b>{e.label ?? 'Cleared'}</b>
                {e.note && <span>{e.note}</span>}
                <span className="co-rec-meta">{[e.room && `Room ${e.room}`, clock(e.observedAt)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="co-rec-row">
        <span className="co-rec-k">Wheel picks</span>
        {picks.length ? (
          <ul className="co-picks">
            {picks.map((p) => (
              <li key={p.id}>
                <span>Round {p.round}</span>
                <span>{p.askLabel}</span>
                <b>{p.statusLabel}</b>
                {p.pickedAt && <time>{clock(p.pickedAt)}</time>}
              </li>
            ))}
          </ul>
        ) : <span className="co-sc-quiet">None in this room</span>}
      </div>
      {records?.privacy && <p className="co-priv"><Icon name="eyeOff" size={14} />{records.privacy}</p>}
    </div>
  );
}

/** The level served now, and what it rests on, beside it. Provisional is lighter and says so. */
function Serving({ serving }) {
  const basis = serving.basis;
  const prov = Boolean(basis?.provisional);
  return (
    <div className="co-serve">
      <div className="co-serve-now" data-prov={prov ? 'true' : undefined}>
        <span className="co-lvb">
          <Level level={serving.level} size="lg" className={prov ? 'co-lv-prov' : ''}>{serving.label}</Level>
          {prov && <span className="co-prov">provisional</span>}
        </span>
        {basis?.sentence && <p className="co-serve-basis">{basis.sentence}</p>}
      </div>
      {serving.reason && <p className="said">{serving.reason}</p>}
      <p className="co-serve-can">
        <span>Can be served now</span>
        {list(serving.eligible).map((l) => <Level key={l} level={l} />)}
      </p>
      {serving.adapt === false && <p className="co-sc-quiet">This room does not move levels.</p>}
    </div>
  );
}

const SHOWN_MOVES = 5;

/** Every move the ladder made in this room, newest first: when, from and to, and why. */
function Moves({ moves, adapt }) {
  const [all, setAll] = useState(false);
  const items = list(moves);
  if (!items.length) {
    return <p className="co-sc-quiet">{adapt === false ? 'This room does not move levels, so there are none.' : 'No level change in this room yet.'}</p>;
  }
  const shown = all ? items : items.slice(0, SHOWN_MOVES);
  return (
    <>
      <ol className="co-moves">
        {shown.map((m, i) => (
          <li key={`${m.at}-${i}`}>
            <time className="mono">{clock(m.at)}</time>
            <div className="co-move-main">
              <span className="co-move-path">
                {m.from === m.to ? (
                  <>
                    <span className="co-move-hold">Stayed at</span>
                    <Level level={m.to} />
                  </>
                ) : (
                  <>
                    <Level level={m.from} />
                    <Icon name="forward" size={13} className="co-move-arrow" />
                    <span className="sr-only">to</span>
                    <Level level={m.to} />
                  </>
                )}
              </span>
              {m.reason && <p className="co-move-why">{m.reason}</p>}
            </div>
          </li>
        ))}
      </ol>
      {items.length > SHOWN_MOVES && (
        <button type="button" className="co-sc-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          <Icon name={all ? 'chevronUp' : 'chevron'} size={14} />
          {all ? 'Show the latest only' : `Show ${plural(items.length - SHOWN_MOVES, 'earlier change')}`}
        </button>
      )}
    </>
  );
}

/** Per level answered at, whether it counts as mastered against this room's goal, and what that rests on. */
function Mastery({ mastery }) {
  const items = list(mastery);
  if (!items.length) return <p className="co-sc-quiet">No graded answer at any level in this room yet.</p>;
  return (
    <ul className="co-mast">
      {items.map((m) => {
        const state = m.mastered ? 'mastered' : m.provisional ? 'provisional' : 'not-yet';
        return (
          <li key={m.level} data-state={state}>
            <Level level={m.level} />
            <span className="co-mast-state">
              {m.mastered ? <><Icon name="check" size={12} />Mastered</> : m.provisional ? 'Provisional' : 'Not yet'}
            </span>
            <p className="co-mast-why">{m.sentence}</p>
          </li>
        );
      })}
    </ul>
  );
}

function Skeleton() {
  return (
    <div className="co-sc-skel" aria-busy="true" aria-label="Reading the student card">
      <span className="skel" /><span className="skel" /><span className="skel" /><span className="skel" />
    </div>
  );
}

/** The card drawn from one body, in an open sheet. */
export function StudentCardView({ card, error, roll, onClose }) {
  const s = card?.student;
  const room = card?.room ?? {};
  const band = card?.band ?? {};
  const serving = card?.serving;
  const title = s ? s.display : roll || 'Student';
  const facts = s ? [
    s.rollNo,
    s.attendance ? ATTENDANCE[s.attendance] ?? s.attendance : null,
    room.classId && !s.onRoster ? 'Not on the class roster' : null,
    !s.joined ? 'No phone joined' : null,
  ].filter(Boolean).join(' · ') : roll;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose?.(); }} sheet title={title} description={facts}>
      {!card ? (error ? <Note tone="bad">{error}</Note> : <Skeleton />) : (
        <div className="co-sc">
          <div className="co-sc-band" data-prov={band.provisional ? 'true' : undefined}>
            {/* Below the minimum there is no band: never drawn as a firm one. */}
            <span className="co-band" data-band={band.provisional ? 'none' : band.id ?? 'none'}>{band.provisional ? NO_BAND : band.label ?? NO_BAND}</span>
            <p>{band.reason}</p>
          </div>

          <Sec title="Being served">
            {serving ? <Serving serving={serving} /> : <p className="co-sc-quiet">No phone joined this room, so nothing is being served.</p>}
          </Sec>

          {serving && (
            <Sec title="Level changes" aside={<span className="co-sc-aside">Newest first</span>}>
              <Moves moves={serving.moves} adapt={serving.adapt} />
            </Sec>
          )}

          <Sec title="By level" aside={anyAnswer(list(card.levels)) && <span className="co-sc-key"><i className="co-k-me" />Them<i className="co-k-cls" />Class, this room</span>}>
            <Levels levels={list(card.levels)} />
          </Sec>

          {Array.isArray(card.mastery) && (
            <Sec title="Mastery" aside={<span className="co-sc-aside">Against this room’s goal</span>}>
              <Mastery mastery={card.mastery} />
            </Sec>
          )}

          {card.confidence && (
            <Sec title="How sure they said they were" aside={<span className="co-sc-aside">Counts only</span>}>
              <Confidence confidence={card.confidence} />
            </Sec>
          )}

          <Sec title="Planned next" aside={<span className="co-plan">A plan, not a promise</span>}>
            <NextSet next={card.nextSet} student={s} room={room} />
          </Sec>

          <Sec title="Last answers" aside={<span className="co-sc-aside">Final answers, newest first</span>}>
            {card.languages?.note && <p className="co-lang-note"><Icon name="info" size={14} /><span>{card.languages.note}</span></p>}
            <LastAnswers answers={card.lastAnswers} languages={card.languages} />
            <AnswerKeys answers={card.lastAnswers} />
          </Sec>

          <Sec title="Teacher records" aside={<span className="co-sc-aside">{card.records?.day}</span>}>
            <Records records={card.records} />
          </Sec>

          {card.privacy && <p className="co-privacy"><Icon name="eyeOff" size={14} />{card.privacy}</p>}
        </div>
      )}
    </Dialog>
  );
}

export default function StudentCard({ code, roll, onClose }) {
  const [state, setState] = useState({ for: null, card: null, error: '' });

  useEffect(() => {
    if (!code || !roll) return undefined;
    let live = true;
    setState({ for: roll, card: null, error: '' });
    api.studentCard(code, roll).then(
      (card) => { if (live) setState({ for: roll, card, error: '' }); },
      (err) => { if (live) setState({ for: roll, card: null, error: err.message }); },
    );
    return () => { live = false; };
  }, [code, roll]);

  if (!roll) return null;
  const mine = state.for === roll;
  return <StudentCardView card={mine ? state.card : null} error={mine ? state.error : ''} roll={roll} onClose={onClose} />;
}
