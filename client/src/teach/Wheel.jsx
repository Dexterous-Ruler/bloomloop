/**
 * The wheel: who answers next, drawn by the server.
 *
 * The server draws (crypto randomness, every student on the wheel equally
 * likely) and stores the pick before it answers. This screen never picks: the
 * ring only walks to the roll number the server returned, so the spin is a
 * picture of a choice already made. Who is on the ring is the server's
 * `pool.onWheel`; a student who has had a turn this round sits on it dimmed.
 *
 * Each draw goes on the projector by itself as a roll number and a first name
 * (the server pushes it). What the pick was asked and how they responded stay
 * here: staff only, never on the wall or a phone.
 *
 * Two switches are this screen's own and never reach the server: think time
 * (ten seconds for everyone, with the question if one is chosen, before the
 * draw is asked for) and names (off: roll numbers only, for a laptop the class
 * can see). They are kept for this browser tab.
 *
 * Also exported for the other records screens: the privacy line, the clock and
 * the bank-question picker, so the four tools say these things one way.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { offlineNow, record, shownOf, useOutbox, useSynced } from '../lib/consoleOutbox.js';
import { gsap, reduced } from '../lib/motion.js';
import { Button, Icon, Level, Note, Segmented, Switch } from '../ui/index.jsx';

/* ------------------------------------------------------------- shared */

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
export const clock = (iso) => {
  const at = new Date(iso);
  return iso && !Number.isNaN(at.getTime()) ? CLOCK.format(at) : '';
};

export const byRoll = (a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true });

/** The read's own privacy sentence, as the server wrote it. */
export function Privacy({ text, children }) {
  if (!text && !children) return null;
  return (
    <p className="rc-privacy">
      <Icon name="eyeOff" size={14} />
      <span>{text}{children && <> {children}</>}</span>
    </p>
  );
}

/** A read that failed: the server's sentence and a way to try again. */
export function ReadFailed({ message, onRetry }) {
  return (
    <Note tone="bad" role="alert">
      {message || 'That could not be read.'}{' '}
      {onRetry && <button type="button" className="link rc-linkbtn" onClick={onRetry}>Try again</button>}
    </Note>
  );
}

/* ------------------------------------------------------------- this screen's own */

export const THINK_SECONDS = 10;
const PREFS_KEY = 'bloomloop.wheelScreen';
const PREFS = { think: false, names: true };

/**
 * Think time and names: kept in sessionStorage for this tab, so they survive
 * moving between the records tools. Never sent to the server.
 */
function useWheelPrefs() {
  const [prefs, setPrefs] = useState(() => {
    try { return { ...PREFS, ...JSON.parse(window.sessionStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return PREFS; }
  });
  useEffect(() => {
    try { window.sessionStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode: this visit only */ }
  }, [prefs]);
  const setPref = useCallback((key, value) => setPrefs((p) => ({ ...p, [key]: value })), []);
  return [prefs, setPref];
}

/**
 * The think-time countdown. `start` runs it; when it ends, or on `skip`,
 * `onDone` is called (the draw). `cancel` stops it with no draw. Counted from
 * the clock, so a slow tab still ends on time. Leaving the screen stops it.
 */
export function useThinkTime(onDone) {
  const [left, setLeft] = useState(null);
  const done = useRef(onDone);
  done.current = onDone;
  const timer = useRef(null);

  const cancel = useCallback(() => {
    clearInterval(timer.current);
    timer.current = null;
    setLeft(null);
  }, []);
  const skip = useCallback(() => {
    if (!timer.current) return;
    cancel();
    done.current?.();
  }, [cancel]);
  const start = useCallback(() => {
    if (timer.current) return;
    const ends = Date.now() + THINK_SECONDS * 1000;
    setLeft(THINK_SECONDS);
    timer.current = setInterval(() => {
      const s = Math.ceil((ends - Date.now()) / 1000);
      if (s <= 0) skip(); else setLeft(s);
    }, 200);
  }, [skip]);

  useEffect(() => () => clearInterval(timer.current), []);
  return { left, start, skip, cancel };
}

const short = (text, n = 96) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * One of the room's approved questions, grouped by level. `questions` is the
 * records screen's shared read ({ status, list, error, load }); it is asked for
 * the first time this picker is drawn.
 */
export function QuestionPicker({ id, questions, value, onChange, disabled, label = 'Question from the bank' }) {
  const { status, list, error, load } = questions ?? {};
  useEffect(() => { if (status === 'idle') load?.(); }, [status, load]);

  if (status === 'error') return <ReadFailed message={error} onRetry={load} />;
  const all = list ?? [];
  const groups = LEVELS.map((l) => [l, all.filter((q) => q.bloom === l)]).filter(([, qs]) => qs.length);
  const other = all.filter((q) => !LEVELS.includes(q.bloom));
  const known = !value || all.some((q) => q.questionId === value);

  return (
    <select
      id={id}
      className="select rc-qpick"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled || status !== 'ready'}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">
        {status === 'ready' ? (all.length ? 'Choose a question' : 'This room has no approved questions') : 'Reading the room’s questions…'}
      </option>
      {!known && <option value={value}>The question chosen earlier</option>}
      {groups.map(([l, qs]) => (
        <optgroup key={l} label={LABEL[l]}>
          {qs.map((q) => <option key={q.questionId} value={q.questionId}>{short(q.text)}</option>)}
        </optgroup>
      ))}
      {other.length > 0 && (
        <optgroup label="Other">
          {other.map((q) => <option key={q.questionId} value={q.questionId}>{short(q.text)}</option>)}
        </optgroup>
      )}
    </select>
  );
}

/* ------------------------------------------------------------- the ring */

/**
 * Who the ring shows: everyone on the wheel now, and (with no repeats on)
 * whoever has had a turn this round, dimmed. In roll order, as the server
 * keeps the pool.
 */
export function ringOf(wheel) {
  const on = wheel?.pool?.onWheel ?? [];
  const round = wheel?.round;
  const onSet = new Set(on.map((p) => p.rollNo));
  const had = round?.noRepeat
    ? (wheel?.picks ?? []).filter((p) => p.round === round.number && !onSet.has(p.rollNo))
    : [];
  const seen = new Set();
  const out = [];
  for (const p of [...on.map((x) => ({ ...x, off: false })), ...had.map((x) => ({ rollNo: x.rollNo, name: x.name, off: true }))]) {
    if (seen.has(p.rollNo)) continue;
    seen.add(p.rollNo);
    out.push(p);
  }
  return out.sort(byRoll);
}

const C = 120;
const polar = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];

/**
 * The ring of ticks, one per student, and in its middle who was drawn. With
 * `spin` ({ ring, pick }) it walks the lit tick round the students who were on
 * the wheel and stops on the server's pick, then calls `onLanded`. Under
 * reduced motion it stops there at once.
 *
 * With `think` ({ left, of }) the middle counts the seconds down and an arc
 * round the ticks empties with them. With `names` false it shows no name.
 */
export function Ring({ people, spin, latest, left, onLanded, think = null, names = true }) {
  const [hot, setHot] = useState(-1);
  const landed = useRef(onLanded);
  landed.current = onLanded;

  useEffect(() => {
    if (!spin) return undefined;
    const ring = spin.ring;
    const target = ring.findIndex((p) => p.rollNo === spin.pick?.rollNo);
    const live = ring.map((p, i) => (p.off ? -1 : i)).filter((i) => i >= 0);
    const finish = () => { setHot(target); landed.current?.(); };
    if (target < 0 || live.length < 2 || reduced()) { finish(); return undefined; }
    const laps = live.length > 12 ? 1 : 2;
    const state = { v: 0 };
    const tween = gsap.to(state, {
      v: live.length * laps + live.indexOf(target),
      duration: 1.5,
      ease: 'power3.out',
      onUpdate: () => setHot(live[Math.floor(state.v) % live.length]),
      onComplete: finish,
    });
    // A tab starved of frames would never land: a timer is not frame-bound.
    const guard = setTimeout(() => tween.progress(1), 2600);
    return () => { clearTimeout(guard); tween.kill(); };
  }, [spin]);

  const list = spin ? spin.ring : people;
  const n = list.length;
  const lit = spin ? hot : list.findIndex((p) => p.rollNo === latest?.rollNo);
  const walking = spin ? list[hot] : null;
  const thick = n > 60 ? 2 : 3;

  return (
    <div className="rc-ring" data-spinning={spin ? 'true' : undefined}>
      <svg viewBox="0 0 240 240" aria-hidden="true" focusable="false">
        <circle className="rc-ring-track" cx={C} cy={C} r={94} />
        {think && (
          <circle
            className="rc-ring-think"
            cx={C} cy={C} r={112}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - think.left / think.of}
            transform={`rotate(-90 ${C} ${C})`}
          />
        )}
        {list.map((p, i) => {
          const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
          const on = i === lit;
          const [x1, y1] = polar(on ? 82 : 88, a);
          const [x2, y2] = polar(on ? 106 : 100, a);
          return (
            <line
              key={p.rollNo}
              className="rc-tick"
              data-off={p.off && !on ? 'true' : undefined}
              data-on={on ? 'true' : undefined}
              x1={x1.toFixed(2)} y1={y1.toFixed(2)} x2={x2.toFixed(2)} y2={y2.toFixed(2)}
              strokeWidth={on ? 4 : thick}
            />
          );
        })}
      </svg>
      <div className="rc-ring-mid" key={think ? 'think' : spin ? 'spin' : latest?.id ?? 'none'}>
        {think ? (
          <>
            <span className="eyebrow">Think time</span>
            <b className="rc-ring-roll rc-ring-count mono">{think.left}</b>
            <span className="rc-ring-sub">{think.left === 1 ? 'second' : 'seconds'}</span>
          </>
        ) : spin ? (
          <>
            <span className="eyebrow">Drawing</span>
            <b className="rc-ring-roll mono is-walking">{walking?.rollNo ?? '·  ·  ·'}</b>
            <span className="rc-ring-sub">&nbsp;</span>
          </>
        ) : latest ? (
          <>
            <span className="eyebrow">Drawn</span>
            <b className="rc-ring-roll mono">{latest.rollNo}</b>
            <span className="rc-ring-name clip">{(names && latest.name) || ' '}</span>
          </>
        ) : (
          <>
            <span className="eyebrow">On the wheel</span>
            <b className="rc-ring-roll mono">{left}</b>
            <span className="rc-ring-sub">{left === 1 ? 'student' : 'students'}, equally likely</span>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- one pick */

function Responses({ pick, statuses, canControl, busy, onStatus }) {
  if (!canControl) {
    return <p className="rc-readval">{pick.status === 'pending' ? 'Not filled in yet' : pick.statusLabel}</p>;
  }
  return (
    <div className="rc-resp" role="group" aria-label="How they responded">
      {statuses.map((s) => (
        <button
          key={s.id}
          type="button"
          className="rc-choice"
          aria-pressed={pick.status === s.id}
          aria-disabled={busy || undefined}
          onClick={() => !busy && pick.status !== s.id && onStatus(s.id)}
        >
          {pick.status === s.id && <Icon name="check" size={13} />}
          {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * What one pick was asked and how they responded. Filled in as it happens or
 * after the class (allowed on a closed room). The draw itself (who, from how
 * many, when) is fixed: the server keeps no route that changes it.
 */
export function PickCard({
  pick, wheel, canControl, classRoom, busy, error, outcome, markAbsent, onMarkAbsent, onPick, questions, drawing, names = true,
}) {
  const asks = wheel?.asks ?? [];
  const statuses = wheel?.statuses ?? [];
  const working = busy === `pick:${pick?.id}`;

  if (drawing) {
    return (
      <section className="card rc-pick" aria-busy="true" aria-label="The pick">
        <div className="rc-card-h"><div className="sec"><h2>Drawing</h2><p>The pick is already made. The ring is showing it.</p></div></div>
        <div className="rc-pick-body"><span className="skel" style={{ height: 34, width: '70%' }} /><span className="skel" style={{ height: 34 }} /></div>
      </section>
    );
  }
  if (!pick) return null;

  const ask = asks.find((a) => a.id === pick.ask);
  const roundNote = wheel?.round && pick.round !== wheel.round.number ? `Round ${pick.round}. ` : '';

  return (
    <section className="card rc-pick" aria-labelledby={`rc-pick-${pick.id}`}>
      <header className="rc-card-h">
        <div className="sec">
          <h2 id={`rc-pick-${pick.id}`}><span className="mono">{pick.rollNo}</span>{names && pick.name && <span className="rc-pick-name"> {pick.name}</span>}</h2>
          <p>{roundNote}Drawn at {clock(pick.pickedAt)}, one of {pick.poolSize} on the wheel, each equally likely.</p>
        </div>
        {working && <span className="spinner" aria-label="Saving" />}
      </header>

      <div className="rc-pick-body">
        <div className="rc-pick-row">
          <span className="label" id={`rc-ask-${pick.id}`}>What was asked</span>
          {canControl ? (
            <Segmented
              label="What was asked"
              value={pick.ask}
              onChange={(id) => !working && id !== pick.ask && onPick(pick.id, { ask: id })}
              options={asks.map((a) => ({ id: a.id, label: a.label }))}
            />
          ) : (
            <p className="rc-readval">{pick.askLabel}</p>
          )}
          {ask?.hint && <p className="hint">{ask.hint}</p>}
          {pick.ask === 'bank' && (
            <div className="rc-pick-q">
              {canControl && (
                <QuestionPicker
                  id={`rc-q-${pick.id}`}
                  questions={questions}
                  value={pick.questionId}
                  disabled={working}
                  onChange={(questionId) => onPick(pick.id, { questionId })}
                />
              )}
              {pick.question ? (
                <p className="rc-qtext"><Level level={pick.question.bloom} />{pick.question.text}</p>
              ) : !canControl && <p className="hint">No question was named.</p>}
            </div>
          )}
        </div>

        <div className="rc-pick-row">
          <span className="label">How they responded</span>
          <Responses
            pick={pick}
            statuses={statuses}
            canControl={canControl}
            busy={working}
            onStatus={(status) => onPick(pick.id, status === 'absent' ? { status, markAttendance: classRoom ? markAbsent : undefined } : { status })}
          />
          {canControl && (classRoom ? (
            <label className="check rc-absent">
              <input type="checkbox" checked={markAbsent} disabled={working} onChange={(e) => onMarkAbsent(e.target.checked)} />
              <span>Absent also marks {pick.rollNo} absent in this room’s attendance.</span>
            </label>
          ) : (
            <p className="hint">This room has no class, so Absent marks no attendance.</p>
          ))}
          {outcome && (
            <p className="rc-outcome" role="status">
              <Icon name={outcome.marked ? 'attendance' : 'info'} size={14} />
              {outcome.marked ? 'Marked absent in attendance. Changing the response later leaves attendance as it is.' : outcome.reason}
            </p>
          )}
          {error && <Note tone="bad" role="alert">{error}</Note>}
        </div>
      </div>

      <p className="rc-pick-foot"><Icon name="eyeOff" size={14} />The response stays on this screen. It never goes on the projector.</p>
    </section>
  );
}

/* ------------------------------------------------------------- the log */

function PickLog({ picks, round, selectedId, onSelect, names = true }) {
  const rounds = useMemo(() => {
    const by = new Map();
    for (const p of picks) {
      if (!by.has(p.round)) by.set(p.round, []);
      by.get(p.round).push(p);
    }
    return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([n, ps]) => [n, ps.slice().reverse()]);
  }, [picks]);

  return (
    <section className="card rc-log" aria-labelledby="rc-log-h">
      <header className="rc-card-h">
        <div className="sec">
          <h2 id="rc-log-h">Picks</h2>
          <p>Every draw is kept. Choose one to fill it in.</p>
        </div>
      </header>
      {picks.length === 0 ? (
        <p className="rc-quiet">Nothing drawn yet. Each draw lands here, with what was asked and how they responded.</p>
      ) : (
        <div className="rc-log-body">
          {rounds.map(([n, ps]) => (
            <div key={n} className="rc-log-round">
              <h3 className="eyebrow">Round {n}{n === round?.number ? ', now' : ''}</h3>
              <ul className="rows">
                {ps.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="rw rc-log-row" aria-current={p.id === selectedId ? 'true' : undefined} onClick={() => onSelect(p.id)}>
                      <b className="mono">{p.rollNo}</b>
                      <span className="grow rc-log-who">
                        {names && <span className="clip">{p.name}</span>}
                        <span className="rc-log-meta" data-pending={p.status === 'pending' ? 'true' : undefined}>
                          {p.status === 'pending' ? 'Not filled in' : p.statusLabel}
                          {p.ask && <> · {p.askLabel}</>}
                        </span>
                      </span>
                      <time className="mono t-meta">{clock(p.pickedAt)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- the view */

function Setting({ label, hint, checked, disabled, busy, onChange, canControl }) {
  return (
    <div className="rc-set">
      <div className="grow">
        <b>{label}</b>
        <span>{hint}</span>
      </div>
      {canControl ? (
        busy ? <span className="spinner" aria-label="Saving" /> : <Switch checked={checked} disabled={disabled} label={label} onChange={onChange} />
      ) : (
        <span className="rc-readval">{checked ? 'On' : 'Off'}</span>
      )}
    </div>
  );
}

function WheelSkeleton() {
  return (
    <div className="rc-wheel" aria-busy="true" aria-label="Reading the wheel">
      <div className="stack stack-3">
        <section className="card rc-stage">
          <div className="rc-card-h"><span className="skel" style={{ height: 20, width: 140 }} /></div>
          <div className="rc-stage-body">
            <span className="skel rc-ring-skel" />
            <div className="stack stack-2 grow"><span className="skel" style={{ height: 42, width: 120 }} /><span className="skel" style={{ height: 52 }} /><span className="skel" style={{ height: 52 }} /></div>
          </div>
        </section>
      </div>
      <section className="card rc-log"><div className="rc-card-h"><span className="skel" style={{ height: 20, width: 80 }} /></div><div className="rc-log-body"><span className="skel" style={{ height: 40 }} /><span className="skel" style={{ height: 40 }} /></div></section>
    </div>
  );
}

/**
 * The wheel as drawn from its read. Pure: everything it shows comes in as
 * props, so the gallery can draw every state.
 */
export function WheelView({
  wheel, load, canControl, closed, classRoom,
  busy = '', error = '', spin = null, onLanded,
  selectedId, onSelect, onDraw, onRound, onSetting, onPick, onRetry,
  outcome = {}, pickError = {}, markAbsent = true, onMarkAbsent, questions,
  prefs = PREFS, onPref, think = null, thinkQ = null, onThinkQ, onSkip, onCancel,
  drawWaiting = false,
}) {
  const drawBtn = useRef(null);
  const refocus = useRef(false);
  const left = wheel?.pool?.left ?? 0;
  // Draw is disabled while it draws, Cancel and "Start new round" go away once
  // used: each time, Draw takes the focus back when it can be pressed again.
  useEffect(() => {
    if (!refocus.current || busy || spin || think) return;
    refocus.current = false;
    if (left > 0) drawBtn.current?.focus();
  }, [left, busy, spin, think]);
  const keep = (fn) => () => { refocus.current = true; fn?.(); };

  if (load?.status === 'error') return <ReadFailed message={load.error} onRetry={onRetry} />;
  if (!wheel) return <WheelSkeleton />;

  const { round, pool, picks = [] } = wheel;
  const people = ringOf(wheel);
  const thisRound = picks.filter((p) => p.round === round.number);
  const latest = thisRound.at(-1) ?? null;
  const selected = picks.find((p) => p.id === selectedId) ?? picks.at(-1) ?? null;
  const spinning = Boolean(spin);
  const thinking = Boolean(think);
  const blocked = closed || Boolean(busy) || spinning || thinking;
  const names = prefs.names !== false;
  const thinkQuestion = thinking && thinkQ ? (questions?.list ?? []).find((q) => q.questionId === thinkQ) : null;
  const emptyLine = error || pool.empty;
  // Everyone has had a turn: a new round is the fix, so it sits with the reason.
  const roundFixes = canControl && !closed && round.noRepeat && round.picks > 0 && pool.total > 0 && pool.left === 0;

  return (
    <div className="rc-wheel">
      <div className="stack stack-3 rc-wheel-main">
        <section className="card rc-stage" aria-labelledby="rc-round-h">
          <header className="rc-card-h">
            <div className="sec">
              <h2 id="rc-round-h">Round {round.number}</h2>
              <p>{pool.summary}</p>
            </div>
            {canControl && (
              <Button size="sm" icon="refresh" busy={busy === 'round'} disabled={blocked || !round.picks} onClick={onRound}>
                New round
              </Button>
            )}
          </header>

          <div className="rc-stage-body">
            <Ring people={people} spin={spin} latest={latest} left={pool.left} onLanded={onLanded} think={think} names={names} />
            <div className="rc-stage-side">
              {canControl && (
                <div className="rc-draw">
                  {thinking && (
                    <div className="rc-think">
                      <span className="eyebrow">Think time · everyone</span>
                      {thinkQuestion
                        ? <p className="rc-think-q"><Level level={thinkQuestion.bloom} />{thinkQuestion.text}</p>
                        : <p className="rc-think-line">Everyone thinks it through. The draw is asked for when the time is up.</p>}
                    </div>
                  )}
                  <div className="rc-draw-row">
                    {/* One button throughout, so the focus stays on it: Draw, then Skip to draw while the seconds run. */}
                    <Button
                      ref={drawBtn}
                      variant="primary"
                      size="lg"
                      icon={thinking ? 'forward' : 'draw'}
                      busy={busy === 'draw'}
                      disabled={thinking ? false : blocked || drawWaiting || !pool.left}
                      onClick={keep(thinking ? onSkip : onDraw)}
                    >
                      {thinking ? 'Skip to draw' : spinning ? 'Drawing' : 'Draw'}
                    </Button>
                    {thinking && <Button variant="ghost" onClick={keep(onCancel)}>Cancel</Button>}
                  </div>
                  {drawWaiting && (
                    <p className="rc-proj" role="status">
                      <Icon name="clock" size={14} />
                      <span>A draw is waiting to be sent. The server draws when this laptop reconnects, and the pick goes on the projector then.</span>
                    </p>
                  )}
                  <p className="rc-proj">
                    <Icon name="projector" size={14} />
                    <span>Each draw goes on the projector by itself, as the roll number and first name. Nothing else about a pick is shown there.</span>
                  </p>
                </div>
              )}
              {emptyLine && (
                <Note tone="warn" role={error ? 'alert' : undefined} className="rc-empty">
                  <p>{emptyLine}</p>
                  {roundFixes && (
                    <Button
                      size="sm"
                      icon="refresh"
                      busy={busy === 'round'}
                      disabled={Boolean(busy) || spinning}
                      onClick={keep(onRound)}
                    >
                      Start new round
                    </Button>
                  )}
                </Note>
              )}
              {closed && <Note>The room is closed, so the wheel no longer draws. Its picks can still be filled in.</Note>}
              <div className="rc-sets">
                <Setting
                  label="Present only"
                  hint={classRoom ? 'Students marked present or late. Unmarked students are left off.' : 'Phones that joined this room.'}
                  checked={round.presentOnly}
                  canControl={canControl}
                  busy={busy === 'presentOnly'}
                  disabled={blocked}
                  onChange={(v) => onSetting('presentOnly', v)}
                />
                <Setting
                  label="No repeats"
                  hint="Nobody is drawn twice until everyone on the wheel has had a turn this round."
                  checked={round.noRepeat}
                  canControl={canControl}
                  busy={busy === 'noRepeat'}
                  disabled={blocked}
                  onChange={(v) => onSetting('noRepeat', v)}
                />
                {/* These two are this screen's own: nothing is sent. */}
                <Setting
                  label="Names"
                  hint="Off shows roll numbers only on this screen, for a laptop the class can see."
                  checked={names}
                  canControl
                  onChange={(v) => onPref?.('names', v)}
                />
                {canControl && (
                  <Setting
                    label="Think time"
                    hint={`${THINK_SECONDS} seconds for everyone to think before each draw. On this screen only.`}
                    checked={Boolean(prefs.think)}
                    canControl
                    disabled={thinking || spinning}
                    onChange={(v) => onPref?.('think', v)}
                  />
                )}
                {canControl && prefs.think && (
                  <div className="rc-think-pick">
                    <label className="label" htmlFor="rc-think-q">Question to think about <span className="opt">optional</span></label>
                    <QuestionPicker id="rc-think-q" label="Question to think about" questions={questions} value={thinkQ} disabled={thinking || spinning} onChange={(id) => onThinkQ?.(id)} />
                    <span className="hint">Shown while everyone thinks, and saved as what the next pick was asked.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {pool.onWheel.length > 0 && (
            <details className="rc-onwheel">
              <summary>
                <Icon name="chevronRight" size={14} />
                Who is on the wheel <b className="mono">{pool.onWheel.length}</b>
              </summary>
              <ul>
                {pool.onWheel.map((p) => (
                  <li key={p.rollNo}><b className="mono">{p.rollNo}</b>{names && <span className="clip">{p.name}</span>}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <PickCard
          pick={selected}
          wheel={wheel}
          canControl={canControl}
          classRoom={classRoom}
          busy={busy}
          error={pickError.id === selected?.id ? pickError.message : ''}
          outcome={selected ? outcome[selected.id] : null}
          markAbsent={markAbsent}
          onMarkAbsent={onMarkAbsent}
          onPick={onPick}
          questions={questions}
          drawing={spinning && selected?.id === spin?.pick?.id}
          names={names}
        />
      </div>

      {/* The pick being shown arriving joins the log when the ring lands on it. */}
      <PickLog picks={spinning ? picks.filter((p) => p.id !== spin.pick?.id) : picks} round={round} selectedId={selected?.id} onSelect={onSelect} names={names} />

      <p className="sr-only" aria-live="polite">{!spinning && latest ? `Drawn: ${latest.rollNo}${names && latest.name ? `, ${latest.name}` : ''}.` : ''}</p>
      {/* The seconds are said twice, not every second: at the start and at five. */}
      <p className="sr-only" aria-live="polite">
        {thinking ? (think.left > 5 ? `Think time: ${think.of} seconds, then the draw.` : 'Five seconds left.') : ''}
      </p>
      <Privacy text={wheel.privacy} />
    </div>
  );
}

/* ------------------------------------------------------------- the screen */

// The server draws, so a draw is never kept for later the way a record is.
const OFFLINE_DRAW = 'The server makes each draw, so Draw needs the connection. Everything else you record meanwhile is kept on this device.';

/** A pick as filled in on this screen, before the server has it (`local`). */
function localPick(p, patch, wheel, questions) {
  const next = { ...p, local: true };
  if (patch.ask !== undefined) {
    next.ask = patch.ask;
    next.askLabel = wheel?.asks?.find((a) => a.id === patch.ask)?.label ?? patch.ask;
    if (patch.ask !== 'bank') { next.questionId = null; next.question = null; }
  }
  if (patch.questionId !== undefined) {
    const q = (questions?.list ?? []).find((x) => x.questionId === patch.questionId);
    next.questionId = patch.questionId;
    next.question = q ? { text: q.text, bloom: q.bloom, kind: q.kind } : null;
  }
  if (patch.status !== undefined) {
    next.status = patch.status;
    next.statusLabel = wheel?.statuses?.find((s) => s.id === patch.status)?.label ?? patch.status;
  }
  return next;
}

/** One line for the sync dialog: what changed on the pick. */
function pickLine(patch, wheel) {
  if (patch.status !== undefined) return wheel?.statuses?.find((s) => s.id === patch.status)?.label ?? patch.status;
  if (patch.ask !== undefined) return `asked: ${wheel?.asks?.find((a) => a.id === patch.ask)?.label ?? patch.ask}`;
  return 'question from the bank chosen';
}

export default function Wheel({ code, canControl, closed, classRoom, signal, questions }) {
  const [wheel, setWheel] = useState(null);
  const [load, setLoad] = useState({ status: 'loading', error: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [spin, setSpin] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [outcome, setOutcome] = useState({});
  const [pickError, setPickError] = useState({});
  const [markAbsent, setMarkAbsent] = useState(true);
  const [prefs, setPref] = useWheelPrefs();
  const [thinkQ, setThinkQ] = useState(null);
  // The draw is asked for only when the think time ends (or is skipped).
  const think = useThinkTime(() => draw(thinkQ));

  const read = useCallback(async () => {
    try {
      setWheel(await api.wheel(code));
      setLoad({ status: 'ready', error: '' });
    } catch (err) {
      setLoad({ status: 'error', error: err.message });
    }
  }, [code]);

  useEffect(() => { read(); }, [read, signal]);
  // Records kept on this laptop have reached the server: read the wheel again.
  useSynced(code, read);
  const { items } = useOutbox();
  const drawWaiting = items.some((i) => i.kind === 'draw' && i.code === String(code).toUpperCase() && i.status !== 'refused');

  // A different pick in the editor starts with Absent marking attendance again.
  useEffect(() => { setMarkAbsent(true); }, [selectedId]);

  /** `questionId`: the one everyone thought about, saved on the new pick. */
  async function draw(questionId = null) {
    if (busy || spin || !wheel || drawWaiting) return;
    if (offlineNow()) { setError(OFFLINE_DRAW); return; }
    const ring = ringOf(wheel);
    setBusy('draw');
    setError('');
    // A draw whose reply was lost goes again with its key, so it is drawn once.
    // If it lands later, the pick is shown without the spin.
    const late = (o) => {
      if (o.refused) { setError(o.error); return; }
      const { pick: made, ...rest } = o.reply;
      setWheel(rest);
      if (!made) return;
      setSelectedId(made.id);
      if (questionId) { setThinkQ(null); pick(made.id, { ask: 'bank', questionId }, made); }
    };
    const out = await record('draw', { code }, { label: 'A draw', onSettle: late });
    setBusy('');
    if (out.kept) return;
    if (out.refused) {
      // An empty wheel is a 409 with the reason: say it as it came.
      setError(out.error);
      read();
      return;
    }
    const { pick: made, ...rest } = out.reply;
    setWheel(rest);
    if (!made) return;
    setSelectedId(made.id);
    setSpin({ ring, pick: made });
    if (questionId) {
      setThinkQ(null);
      await pick(made.id, { ask: 'bank', questionId }, made);
    }
  }

  /** A new round or a setting, through the outbox. `local` draws a kept change. */
  async function act(busyKey, kind, settings, label, local) {
    setBusy(busyKey);
    setError('');
    const out = await record(kind, { code, settings }, { label });
    setBusy('');
    if (out.ok) setWheel(out.reply);
    else if (out.refused) setError(out.error);
    else if (local) setWheel((w) => w && local(w));
  }

  /** `known`: the pick when this screen has not drawn it yet (just drawn). */
  async function pick(id, patch, known = null) {
    const current = known ?? wheel?.picks?.find((p) => p.id === id) ?? null;
    // Absent also marks attendance, as a separate attendance record queued
    // right behind the pick's, with the attendance stale check: a pick's own
    // markAttendance has none, and a pick may be sent long after it was made.
    const absent = classRoom && patch.status === 'absent' && patch.markAttendance && current?.classStudentId;
    setBusy(`pick:${id}`);
    setPickError({});
    const out = await record('pick', { code, pickId: id, patch: absent ? { ...patch, markAttendance: false } : patch }, {
      label: `${current?.rollNo ?? 'A pick'}: ${pickLine(patch, wheel)}`,
      shown: current && !current.local ? shownOf.pick(current) : undefined,
    });
    if (out.refused) {
      setBusy('');
      setPickError({ id, message: out.error });
      // Stale: the reply holds the pick as it stands.
      if (out.stale && out.current?.id) setWheel((w) => w && { ...w, picks: w.picks.map((p) => (p.id === id ? out.current : p)) });
      return;
    }
    if (out.kept) setWheel((w) => w && { ...w, picks: w.picks.map((p) => (p.id === id ? localPick(p, patch, w, questions) : p)) });
    else if (out.reply.pick) setWheel((w) => w && { ...w, picks: w.picks.map((p) => (p.id === id ? out.reply.pick : p)) });
    if (!absent) {
      setBusy('');
      setOutcome((o) => ({ ...o, [id]: out.reply?.attendance ?? null }));
      return;
    }
    // The attendance's stamp is the last attendance read's (lib/consoleOutbox.js, noteAttendance).
    const att = await record('attendance', { code, marks: [{ studentId: current.classStudentId, status: 'absent' }] }, {
      label: `${current.rollNo}${current.name ? ` ${current.name}` : ''}: Absent, from the wheel`,
    });
    setBusy('');
    setOutcome((o) => ({
      ...o,
      [id]: att.ok ? { marked: true, status: 'absent' }
        : att.kept ? { marked: false, reason: 'Kept on this device. The attendance mark goes with it when the laptop reconnects.' }
        : { marked: false, reason: att.error },
    }));
    // Marked absent: they are no longer present, so the wheel may have changed.
    if (att.ok) read();
  }

  return (
    <WheelView
      wheel={wheel}
      load={load}
      canControl={canControl}
      closed={closed}
      classRoom={classRoom}
      busy={busy}
      error={error}
      spin={spin}
      onLanded={() => setSpin(null)}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onDraw={() => (prefs.think ? think.start() : draw())}
      prefs={prefs}
      onPref={setPref}
      think={think.left != null ? { left: think.left, of: THINK_SECONDS } : null}
      thinkQ={thinkQ}
      onThinkQ={setThinkQ}
      onSkip={think.skip}
      onCancel={think.cancel}
      onRound={() => act('round', 'round', undefined, 'New round')}
      onSetting={(key, value) => act(
        key,
        'wheel',
        { [key]: value },
        `${key === 'presentOnly' ? 'Present only' : 'No repeats'} ${value ? 'on' : 'off'}`,
        (w) => ({ ...w, round: { ...w.round, [key]: value } }),
      )}
      onPick={(id, patch) => pick(id, patch)}
      drawWaiting={drawWaiting}
      onRetry={read}
      outcome={outcome}
      pickError={pickError}
      markAbsent={markAbsent}
      onMarkAbsent={setMarkAbsent}
      questions={questions}
    />
  );
}
