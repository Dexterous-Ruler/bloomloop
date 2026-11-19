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
 * Also exported for the other records screens: the privacy line, the clock and
 * the bank-question picker, so the four tools say these things one way.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
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
 */
export function Ring({ people, spin, latest, left, onLanded }) {
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
      <div className="rc-ring-mid" key={spin ? 'spin' : latest?.id ?? 'none'}>
        {spin ? (
          <>
            <span className="eyebrow">Drawing</span>
            <b className="rc-ring-roll mono is-walking">{walking?.rollNo ?? '·  ·  ·'}</b>
            <span className="rc-ring-sub">&nbsp;</span>
          </>
        ) : latest ? (
          <>
            <span className="eyebrow">Drawn</span>
            <b className="rc-ring-roll mono">{latest.rollNo}</b>
            <span className="rc-ring-name clip">{latest.name || ' '}</span>
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
  pick, wheel, canControl, classRoom, busy, error, outcome, markAbsent, onMarkAbsent, onPick, questions, drawing,
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
          <h2 id={`rc-pick-${pick.id}`}><span className="mono">{pick.rollNo}</span>{pick.name && <span className="rc-pick-name"> {pick.name}</span>}</h2>
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

function PickLog({ picks, round, selectedId, onSelect }) {
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
                        <span className="clip">{p.name}</span>
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
}) {
  if (load?.status === 'error') return <ReadFailed message={load.error} onRetry={onRetry} />;
  if (!wheel) return <WheelSkeleton />;

  const { round, pool, picks = [] } = wheel;
  const people = ringOf(wheel);
  const thisRound = picks.filter((p) => p.round === round.number);
  const latest = thisRound.at(-1) ?? null;
  const selected = picks.find((p) => p.id === selectedId) ?? picks.at(-1) ?? null;
  const spinning = Boolean(spin);
  const blocked = closed || Boolean(busy) || spinning;

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
            <Ring people={people} spin={spin} latest={latest} left={pool.left} onLanded={onLanded} />
            <div className="rc-stage-side">
              {canControl && (
                <div className="rc-draw">
                  <Button variant="primary" size="lg" icon="draw" busy={busy === 'draw'} disabled={blocked || !pool.left} onClick={onDraw}>
                    {spinning ? 'Drawing' : 'Draw'}
                  </Button>
                  <p className="rc-proj">
                    <Icon name="projector" size={14} />
                    <span>Each draw goes on the projector by itself, as the roll number and first name. Nothing else about a pick is shown there.</span>
                  </p>
                </div>
              )}
              {error ? <Note tone="warn" role="alert">{error}</Note> : pool.empty && <Note tone="warn">{pool.empty}</Note>}
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
                  <li key={p.rollNo}><b className="mono">{p.rollNo}</b><span className="clip">{p.name}</span></li>
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
        />
      </div>

      {/* The pick being shown arriving joins the log when the ring lands on it. */}
      <PickLog picks={spinning ? picks.filter((p) => p.id !== spin.pick?.id) : picks} round={round} selectedId={selected?.id} onSelect={onSelect} />

      <p className="sr-only" aria-live="polite">{!spinning && latest ? `Drawn: ${latest.rollNo}${latest.name ? `, ${latest.name}` : ''}.` : ''}</p>
      <Privacy text={wheel.privacy} />
    </div>
  );
}

/* ------------------------------------------------------------- the screen */

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

  const read = useCallback(async () => {
    try {
      setWheel(await api.wheel(code));
      setLoad({ status: 'ready', error: '' });
    } catch (err) {
      setLoad({ status: 'error', error: err.message });
    }
  }, [code]);

  useEffect(() => { read(); }, [read, signal]);

  // A different pick in the editor starts with Absent marking attendance again.
  useEffect(() => { setMarkAbsent(true); }, [selectedId]);

  async function draw() {
    if (busy || spin || !wheel) return;
    const ring = ringOf(wheel);
    setBusy('draw');
    setError('');
    try {
      const { pick, ...rest } = await api.wheelDraw(code);
      setWheel(rest);
      if (pick) {
        setSelectedId(pick.id);
        setSpin({ ring, pick });
      }
    } catch (err) {
      // An empty wheel is a 409 with the reason: say it as it came.
      setError(err.message);
      read();
    } finally {
      setBusy('');
    }
  }

  async function act(kind, call) {
    setBusy(kind);
    setError('');
    try {
      setWheel(await call());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function pick(id, patch) {
    setBusy(`pick:${id}`);
    setPickError({});
    try {
      const reply = await api.wheelPick(code, id, patch);
      if (reply.pick) setWheel((w) => w && { ...w, picks: w.picks.map((p) => (p.id === id ? reply.pick : p)) });
      setOutcome((o) => ({ ...o, [id]: reply.attendance ?? null }));
      // Marked absent: they are no longer present, so the wheel may have changed.
      if (reply.attendance?.marked) read();
    } catch (err) {
      setPickError({ id, message: err.message });
    } finally {
      setBusy('');
    }
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
      onDraw={draw}
      onRound={() => act('round', () => api.wheelNewRound(code))}
      onSetting={(key, value) => act(key, () => api.wheelSettings(code, { [key]: value }))}
      onPick={pick}
      onRetry={read}
      outcome={outcome}
      pickError={pickError}
      markAbsent={markAbsent}
      onMarkAbsent={setMarkAbsent}
      questions={questions}
    />
  );
}
