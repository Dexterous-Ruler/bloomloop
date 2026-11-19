/**
 * Step three, before a room exists: the room-to-be on a forest panel, the
 * rules it opens with as rows, and the waiting room it will fill.
 * Opening mints the code and hands the whole window to the projector.
 *
 * The room rules are set here because the server fixes them when the room is
 * minted: a room's standard does not move under the students in it. That
 * includes the question set. A room serves either the whole approved bank (at
 * least six questions, and any approved later join it) or a set picked here
 * (one question or more, fixed once the room opens).
 *
 * Why a room cannot open yet is said before the server has to refuse it: a
 * bank of drafts only, a whole bank under six, a Teacher-led room with no
 * class, or a cap or timer out of range. The server's own refusal is still
 * shown as it was given, in case something changed elsewhere meanwhile.
 *
 * Phase 3 adds how the room runs: a class (optional), the mode, whether levels
 * move, the start level, a cap on questions, a timer, and a waiting room. Only
 * what differs from the old behaviour is sent, so a room left on the defaults
 * is opened exactly as before. The reply then also carries `settings`,
 * `classId` and `status` ('waiting' with a waiting room); onSession gets it
 * as it comes.
 *
 * @param bank         the GET /api/bank/:id reply; questions carry `status`
 * @param activeCount  approved questions, the only ones a room serves
 * @param draftCount   questions waiting for approval
 * @param levels       approved questions per level, { remember: 9, ... }
 * @param onDrafts     () => go to the bank's drafts
 * @param initialSet   question ids to open on "a set I pick" (the dev gallery)
 * @param create       stands in for api.createSession (the dev gallery)
 * @param loadClasses  stands in for api.listClasses (the dev gallery)
 * @param initialRun   how the room runs to begin with (the dev gallery):
 *                     { classId, mode, lobby, adapt, startLevel, cap, timer }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { api } from '../lib/api.js';
import { reduced } from '../lib/motion.js';
import { Button, Chip, Empty, Icon, Level, Note, Panel, Section, Segmented, Switch } from '../ui/index.jsx';
import { LevelSpread } from '../ui/viz.jsx';

// The server's own lists (server/src/services/mastery.js MASTERY_GOALS and
// MAX_REATTEMPTS). It rejects anything else with a 400, so a drift here shows
// up as an error on this card, never as a room quietly run on other rules.
const GOALS = [
  { id: '0.8', label: '80%' },
  { id: '0.9', label: '90%' },
  { id: '1', label: '100%' },
];
const TRIES = [
  { id: '0', label: 'None' },
  { id: '1', label: 'One' },
  { id: '2', label: 'Two' },
];
const SET_MODES = [
  { id: 'whole', label: 'Whole bank' },
  { id: 'set', label: 'A set I pick' },
];

// The server's floor for a whole-bank room (MIN_BANK in server/src/routes/session.js).
// A picked set has none: one question is a room.
const WHOLE_MIN = 6;

// How a room runs (server/src/services/mastery.js ROOM_MODES,
// QUESTIONS_PER_STUDENT, TIME_PER_QUESTION). The server refuses anything else
// with a 400 naming the field, shown on this card as it comes.
const MODES = [
  {
    id: 'devices', label: 'Student devices', icon: 'wifi',
    line: 'Every student answers on a phone, and the room picks each one’s next question.',
  },
  {
    id: 'teacher-led', label: 'Teacher-led', icon: 'hand',
    line: 'No phones. You run the class from its roster: attendance, the wheel and your observations.',
  },
  {
    id: 'mixed', label: 'Mixed', icon: 'split',
    line: 'Phones answer as usual, and you record what you see beside them. The two are counted apart.',
  },
];
const CAP = { min: 1, max: 500 };
const TIMER = { min: 10, max: 600 };
const START_DEFAULT = 'understand';

/** '' is none. Otherwise a whole number in range, or the reason it is not one. */
function wholeIn(text, { min, max }, what) {
  const t = text.trim();
  if (t === '') return { value: null };
  if (!/^\d+$/.test(t) || Number(t) < min || Number(t) > max) {
    return { why: `${what} must be a whole number from ${min} to ${max}, or left empty for none.` };
  }
  return { value: Number(t) };
}

const className = (c) => [c.courseName, c.section].filter(Boolean).join(' ');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byLevel = (qs) => LEVELS.reduce((a, l) => ({ ...a, [l]: qs.filter((q) => q.bloom === l).length }), {});
const topicsIn = (qs) => new Set(qs.map((q) => q.topic).filter(Boolean)).size;

/* ------------------------------------------------------------ the picker */

/**
 * The approved questions by level, each with a tick. A topic filter and a
 * search narrow the list; a level's "Tick all" ticks what is shown at it.
 * The count and the level spread at the top follow every tick.
 */
function SetPicker({ innerRef, approved, kindLabel, topicOrder, picked, onPicked }) {
  const [topic, setTopic] = useState('');
  const [query, setQuery] = useState('');

  const topics = useMemo(() => {
    const names = [...new Set(approved.map((q) => q.topic).filter(Boolean))];
    const at = (t) => { const i = topicOrder.indexOf(t); return i < 0 ? 999 : i; };
    return names
      .sort((a, b) => at(a) - at(b))
      .map((name) => ({ name, count: approved.filter((q) => q.topic === name).length }));
  }, [approved, topicOrder]);

  const q = query.trim().toLowerCase();
  const shown = approved.filter((x) => (!topic || x.topic === topic)
    && (!q || `${x.text ?? ''} ${x.topic ?? ''}`.toLowerCase().includes(q)));
  const groups = LEVELS
    .map((level) => ({ level, list: shown.filter((x) => x.bloom === level) }))
    .filter((g) => g.list.length > 0);
  const chosen = approved.filter((x) => picked.has(x._id));
  const n = chosen.length;

  const toggle = (id) => onPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const tickAll = (list, on) => onPicked((prev) => {
    const next = new Set(prev);
    for (const x of list) { if (on) next.add(x._id); else next.delete(x._id); }
    return next;
  });

  return (
    <div className="rs-pick" ref={innerRef} role="group" aria-label="The questions this room serves">
      <div className="rs-sum">
        <div className="rs-sum-top">
          <span className="rs-sum-n">
            <b>{n}</b>
            <span>chosen of {plural(approved.length, 'approved question')}</span>
          </span>
          <span className="sr-only" aria-live="polite">{plural(n, 'question')} in the set</span>
          <Button size="sm" variant="ghost" icon="close" disabled={n === 0} onClick={() => onPicked(new Set())}>Clear</Button>
        </div>
        <LevelSpread counts={byLevel(chosen)} />
      </div>

      <div className="rs-bar">
        <label className="search rs-search">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a question"
            aria-label="Find a question by its words or topic"
          />
        </label>
        {topics.length > 1 && (
          <select className="select input-sm rs-topic" aria-label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">All topics</option>
            {topics.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.count})</option>)}
          </select>
        )}
      </div>

      {groups.length === 0 ? (
        <Empty
          icon="search"
          title="No approved question matches"
          action={<Button size="sm" onClick={() => { setTopic(''); setQuery(''); }}>Clear the filter</Button>}
        >
          The set is unchanged. Only approved questions are listed here, because a room serves nothing else.
        </Empty>
      ) : groups.map((g) => {
        const on = g.list.filter((x) => picked.has(x._id)).length;
        const all = on === g.list.length;
        const k = g.list.length;
        return (
          <section key={g.level} className="rs-lv" aria-label={`${LABEL[g.level]} questions`}>
            <header className="rs-lv-h">
              <Level level={g.level} />
              <span className="rs-lv-n">
                {plural(k, 'question')}
                {on > 0 && <i>{on} chosen</i>}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="push"
                aria-label={`${all ? 'Untick' : 'Tick'} every ${LABEL[g.level]} question shown`}
                onClick={() => tickAll(g.list, !all)}
              >
                {k === 1 ? (all ? 'Untick' : 'Tick') : `${all ? 'Untick' : 'Tick'} all ${k}`}
              </Button>
            </header>
            <ul className="rs-qs">
              {g.list.map((x) => {
                const kind = kindLabel?.[x.kind];
                return (
                  <li key={x._id} className="rs-q" data-on={picked.has(x._id) ? 'true' : undefined}>
                    <label>
                      <input type="checkbox" checked={picked.has(x._id)} onChange={() => toggle(x._id)} />
                      <span className="rs-q-body">
                        {(x.topic || kind) && (
                          <span className="rs-q-meta">
                            {x.topic && <span className="rs-q-topic">{x.topic}</span>}
                            {x.topic && kind && <i className="dot" aria-hidden="true" />}
                            {kind && <span>{kind}</span>}
                          </span>
                        )}
                        <span className="rs-q-text">{x.text}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------ the quiet sides */

/** What happens once the room opens, for the mode and waiting room chosen. */
const HOW = {
  plain: [
    'Opening puts a six-character code on the projector, large enough to read from the back.',
    'Students type it on their phones with their roll number, and the projector counts them in.',
    'From the class view you watch each student climb, level by level.',
  ],
  lobby: [
    'Opening puts a six-character code on the projector, large enough to read from the back.',
    'Students type it with their roll number and wait. Nothing is served yet.',
    'You press Start when the class is in, and every waiting phone gets its first question at once.',
  ],
  'teacher-led': [
    'Opening mints a six-character code for the projector.',
    'No phone joins. A phone that tries is told the class is teacher-led and to follow the board.',
    'You run the class from its roster: attendance, the wheel and your observations.',
  ],
};

function WaitingRoom({ runMode = 'devices', lobby = false }) {
  const how = runMode === 'teacher-led' ? HOW['teacher-led'] : lobby ? HOW.lobby : HOW.plain;
  return (
    <aside className="card tc-wait" aria-label="Waiting room">
      <div className="tc-wait-head">
        <Section title="Waiting room" sub="Who has joined, once the room is open." />
        <Chip>Not open</Chip>
      </div>
      <div className="tc-wait-body">
        {/* Six places for a code that does not exist yet. */}
        <div className="tc-codeslots" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => <span key={i}>·</span>)}
        </div>
        <h3>No one is here yet</h3>
        <p>The code is minted when you open the room. Until then there is nothing to join.</p>
      </div>
      <ol className="tc-wait-how">
        {how.map((line, i) => <li key={line}><span className="mono">{`0${i + 1}`}</span>{line}</li>)}
      </ol>
    </aside>
  );
}

/* ------------------------------------------------ how the room runs */

/**
 * The class a room is opened for. Optional: a room with no class runs as
 * rooms always have. Only classes this account may change can carry a room
 * (the server answers 404 for any other), so a read-only one is not offered.
 * The list is read again when the window comes back into focus, so a class
 * set up in the other tab appears without a reload.
 */
function ClassChoice({ state, value, onChange, onRetry }) {
  const usable = state.list.filter((c) => c.canEdit !== false);
  let control;
  if (state.status === 'loading' && !state.list.length) {
    control = <span className="skel ro-class-skel" aria-label="Reading your classes" />;
  } else if (state.status === 'error' && !state.list.length) {
    control = (
      <span className="ro-class-none" role="alert">
        <span>{state.error}</span>
        <Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button>
      </span>
    );
  } else if (!usable.length) {
    control = (
      <span className="ro-class-none">
        <span>{state.list.length ? 'None of the classes you can see is yours to open a room for.' : 'You have no class yet.'}</span>
        <a className="btn btn-sm" href="/classes" target="_blank" rel="noopener noreferrer">
          <Icon name="external" />Set up a class
        </a>
      </span>
    );
  } else {
    control = (
      <select className="select ro-class" aria-label="Class" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No class</option>
        {usable.map((c) => (
          <option key={c.id} value={c.id}>
            {className(c)}{c.termLabel ? `, ${c.termLabel}` : ''} ({plural(c.size ?? 0, 'student')})
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="tc-rule">
      <div className="tc-rule-txt">
        <b>Class <span className="ro-opt">optional</span></b>
        <p>
          With a class, a phone that joins with a roll number on its roster marks that student present, the roster name
          shows beside the roll number, and you can take attendance. Without one the room runs as rooms always have.
        </p>
      </div>
      {control}
    </div>
  );
}

/** Student devices, Teacher-led or Mixed, each with what it means. Native radios, so arrows move between them. */
function ModeChoice({ value, onChange, needsClass }) {
  return (
    <div className="tc-rule ro-modes-rule">
      <div className="tc-rule-txt">
        <b id="ro-mode-h">How students answer</b>
        <p>Choose one. It cannot change once the room is open.</p>
      </div>
      <div className="ro-modes" role="radiogroup" aria-labelledby="ro-mode-h">
        {MODES.map((m) => (
          <label key={m.id} className="ro-mode" data-on={value === m.id ? 'true' : undefined}>
            <input type="radio" name="ro-mode" className="sr-only" value={m.id} checked={value === m.id} onChange={() => onChange(m.id)} />
            <span className="ro-mode-top">
              <Icon name={m.icon} />
              <b>{m.label}</b>
              {value === m.id && <Icon name="check" className="ro-mode-on" />}
            </span>
            <span className="ro-mode-line">{m.line}</span>
          </label>
        ))}
      </div>
      {needsClass && (
        <Note tone="warn" className="ro-modes-note" role="status">
          A Teacher-led room needs a class: no phone joins it, so attendance, the wheel and observations work from the
          class roster. Choose a class above, or open the room for Student devices or Mixed.
        </Note>
      )}
    </div>
  );
}

/** A whole number, or empty for none. The reason it is out of range sits under it. */
function NumberRule({ id, title, line, value, onChange, unit, placeholder, why }) {
  return (
    <div className="tc-rule">
      <div className="tc-rule-txt">
        <b><label htmlFor={id}>{title}</label></b>
        <p id={`${id}-line`}>{line}</p>
        {why && <p className="ro-bad" id={`${id}-why`} role="alert">{why}</p>}
      </div>
      <span className="ro-num" data-bad={why ? 'true' : undefined}>
        <input
          id={id}
          className="input input-sm"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          aria-invalid={why ? 'true' : undefined}
          aria-describedby={`${id}-line${why ? ` ${id}-why` : ''}`}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>{unit}</span>
      </span>
    </div>
  );
}

/** What the server checks when a room opens, said before it has to. */
function Serves() {
  return (
    <section className="card tc-rules" aria-label="What a room serves">
      <div className="tc-rules-head">
        <Section title="What a room serves" sub="The server checks these when a room opens, so they are said here first." />
      </div>
      <div className="tc-rule">
        <div className="tc-rule-txt">
          <b>Approved questions only</b>
          <p>A draft is never served, and neither is a question you rejected.</p>
        </div>
      </div>
      <div className="tc-rule">
        <div className="tc-rule-txt">
          <b>The whole bank: {WHOLE_MIN} or more</b>
          <p>Every approved question, at least {WHOLE_MIN} of them. Questions you approve after the room opens join it.</p>
        </div>
      </div>
      <div className="tc-rule">
        <div className="tc-rule-txt">
          <b>A set you pick: 1 or more</b>
          <p>Any of the approved questions, as few as one. The set is fixed once the room opens: questions approved later do not join it.</p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ room */

export default function Room({
  content, bank, activeCount = 0, draftCount = 0, levels, onSession, onBack, onDrafts,
  initialSet = null, create = api.createSession, loadClasses = api.listClasses, initialRun = {},
}) {
  const [busy, setBusy] = useState(false);
  // { message, status }: the server's sentence, shown as given.
  const [error, setError] = useState(null);
  const [goal, setGoal] = useState('0.8');
  const [tries, setTries] = useState('0');
  const [redeem, setRedeem] = useState('off');
  const [mode, setMode] = useState(initialSet ? 'set' : 'whole');
  // Held across a switch back to the whole bank, so a pick is not lost by it.
  const [picked, setPicked] = useState(() => new Set(initialSet ?? []));
  const [jump, setJump] = useState(false);
  const pickerRef = useRef(null);

  // How the room runs (Phase 3). Each starts at the old behaviour.
  const [classId, setClassId] = useState(initialRun.classId ?? '');
  const [runMode, setRunMode] = useState(initialRun.mode ?? 'devices');
  const [lobby, setLobby] = useState(initialRun.lobby ?? false);
  const [adapt, setAdapt] = useState(initialRun.adapt ?? true);
  const [startLevel, setStartLevel] = useState(initialRun.startLevel ?? START_DEFAULT);
  const [cap, setCap] = useState(initialRun.cap ?? '');
  const [timer, setTimer] = useState(initialRun.timer ?? '');
  const [classes, setClasses] = useState({ status: 'loading', list: [], error: '' });

  const readClasses = useCallback(() => {
    setClasses((c) => ({ ...c, status: 'loading' }));
    loadClasses()
      .then((r) => setClasses({ status: 'ready', list: r?.classes ?? [], error: '' }))
      .catch((err) => setClasses((c) => ({ ...c, status: 'error', error: err.message })));
  }, [loadClasses]);
  useEffect(() => {
    readClasses();
    window.addEventListener('focus', readClasses);
    return () => window.removeEventListener('focus', readClasses);
  }, [readClasses]);
  // A class that left the list (deleted, or no longer this account's) is not kept chosen.
  const cls = classes.list.find((c) => c.id === classId && c.canEdit !== false) ?? null;
  useEffect(() => {
    if (classId && classes.status === 'ready' && !cls) setClassId('');
  }, [classId, classes.status, cls]);

  const approved = useMemo(() => (bank?.questions ?? []).filter((q) => q.status === 'active'), [bank]);
  // Ids no longer approved drop out by themselves: the set is read off the bank.
  const chosen = useMemo(() => approved.filter((q) => picked.has(q._id)), [approved, picked]);

  // "Pick a set instead" brings the list into view and puts the keyboard in it.
  useEffect(() => {
    if (!jump) return;
    setJump(false);
    const el = pickerRef.current;
    el?.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    el?.querySelector('input')?.focus({ preventScroll: true });
  }, [jump]);

  function chooseMode(next) {
    setMode(next);
    setError(null);
  }

  const teacherLed = runMode === 'teacher-led';
  // No phone is served in a Teacher-led room, so its pace settings are not sent.
  const capped = teacherLed ? { value: null } : wholeIn(cap, CAP, 'Questions per student');
  const timed = teacherLed ? { value: null } : wholeIn(timer, TIMER, 'Time per question');
  const needsClass = teacherLed && !cls;
  const blocked = needsClass
    ? 'A Teacher-led room needs a class. Choose one, or open the room for Student devices or Mixed.'
    : capped.why || timed.why || '';

  async function start() {
    setError(null); setBusy(true);
    try {
      onSession(await create(content.contentId, content.title, {
        masteryGoal: Number(goal),
        reattempts: Number(tries),
        redemption: redeem === 'on',
        // Left out for the whole bank: that is what the server reads as "every
        // approved question, including any approved later".
        ...(mode === 'set' ? { questionIds: chosen.map((q) => q._id) } : {}),
        // Only what differs from the old behaviour, so a room on the defaults
        // is stored, run and archived exactly as before.
        ...(cls ? { classId: cls.id } : {}),
        ...(runMode !== 'devices' ? { mode: runMode } : {}),
        ...(lobby ? { lobby: true } : {}),
        ...(!teacherLed && !adapt ? { adapt: false } : {}),
        ...(!teacherLed && startLevel !== START_DEFAULT ? { startLevel } : {}),
        ...(capped.value != null ? { questionsPerStudent: capped.value } : {}),
        ...(timed.value != null ? { timePerQuestion: timed.value } : {}),
      }));
    }
    catch (err) { setError({ message: err.message, status: err.status }); }
    finally { setBusy(false); }
  }

  if (!content || (activeCount === 0 && draftCount === 0)) {
    return (
      <div className="card">
        <Empty icon="bank" title="No questions to run" action={<Button variant="primary" icon="back" onClick={onBack}>Back to the questions</Button>}>
          A room hands every phone its next question out of the bank behind it. Write one first, and the room opens on
          exactly the questions you kept.
        </Empty>
      </div>
    );
  }

  // Drafts only: nothing a room may serve yet.
  if (activeCount === 0) {
    return (
      <div className="tc-room">
        <div className="tc-room-main">
          <Panel className="tc-room-brief" aria-label="Why the room cannot open yet">
            <span className="tag-mint">Not ready to open</span>
            <h2>{content.title}</h2>
            <p>
              Approve at least {WHOLE_MIN} questions first, or pick a set from those you approve. A room serves approved
              questions only, and none of the questions written for this chapter is approved yet.
            </p>
            <div className="rs-tiles">
              <div className="ptile">
                <span>Approved</span>
                <b>0</b>
                <small>{WHOLE_MIN} <i>needed for the whole bank</i></small>
              </div>
              <div className="ptile" style={{ '--d': '0.6s' }}>
                <span>Drafts</span>
                <b>{draftCount}</b>
                <small><i>waiting for your approval</i></small>
              </div>
            </div>
            <div className="cluster">
              <Button variant="accent" size="lg" icon="checklist" onClick={onDrafts}>
                Review the {plural(draftCount, 'draft')}
              </Button>
            </div>
          </Panel>
          <Serves />
        </div>
        <WaitingRoom />
      </div>
    );
  }

  const isSet = mode === 'set';
  const n = chosen.length;
  // The whole bank under the server's floor: say so, and offer a set.
  const short = !isSet && activeCount < WHOLE_MIN;
  const roomQs = isSet ? chosen : approved;
  const counts = isSet ? byLevel(chosen) : (levels ?? byLevel(approved));
  const covered = LEVELS.filter((l) => (counts[l] ?? 0) > 0).length;
  const topicCount = approved.length ? topicsIn(roomQs) : (content.topics?.length ?? 0);
  const over = topicCount > 0 ? ` over ${plural(topicCount, 'topic')}` : '';
  const join = 'Students join from any phone browser with the code and their roll number. No app, no account.';

  let lead;
  if (short) {
    lead = `A room on the whole bank needs at least ${WHOLE_MIN} approved questions, and this chapter has ${activeCount}. `
      + `Approve ${WHOLE_MIN - activeCount} more, or pick a set from ${activeCount === 1 ? 'this one' : `these ${activeCount}`}: a set can be as small as one question.`;
  } else if (isSet && n === 0) {
    lead = 'Tick the questions this room serves in the list below. A set can be as small as one question.';
  } else if (isSet) {
    lead = `A set of ${n} of the ${plural(activeCount, 'approved question')}${over ? `,${over}` : ''}, at ${covered} of the six levels. ${join}`;
  } else {
    lead = `${plural(activeCount, 'approved question')}${over}, at ${covered} of the six levels. ${join}`;
  }

  let setLine;
  if (isSet) {
    setLine = `${n === 0 ? 'Nothing picked yet: tick the questions below.' : `A set of ${n}, picked below.`} `
      + 'It is fixed once the room opens: a question approved later does not join it (it would join a whole-bank room).';
  } else if (short) {
    setLine = `Whole bank: ${activeCount} approved. A whole-bank room needs at least ${WHOLE_MIN}, or pick a set instead.`;
  } else {
    setLine = `Whole bank: ${activeCount} approved${draftCount > 0 ? `, and ${plural(draftCount, 'draft')} waiting` : ''}. `
      + `${draftCount > 0 ? 'Any you approve' : 'Questions you approve'} after the room opens join it too.`;
  }

  const runs = {
    devices: 'Student devices: every student answers on a phone.',
    'teacher-led': 'Teacher-led: no phones; you work from the class roster.',
    mixed: 'Mixed: phones answer, and your own records sit beside them, counted apart.',
  }[runMode];
  let opens;
  if (lobby) opens = 'Into a waiting room. Nothing starts until you press Start.';
  else if (teacherLed) opens = 'Straight away.';
  else opens = 'Straight away: each phone gets its first question as it joins.';

  return (
    <div className="tc-room">
      <div className="tc-room-main">
        <Panel className="tc-room-brief" aria-label="The room to be">
          <span className="tag-mint">{short ? 'Not ready to open' : 'The room to be'}</span>
          <h2>{content.title}</h2>
          <p>{lead}</p>
          <LevelSpread counts={counts} />
          <div className="brief ro-brief">
            <b>Class</b>
            <span>
              {cls
                ? `${className(cls)}${cls.termLabel ? `, ${cls.termLabel}` : ''}: ${plural(cls.size ?? 0, 'student')} on the roster.`
                : 'None. No roster, so no attendance and no names beside roll numbers.'}
            </span>
            <b>Runs</b>
            <span>{runs}</span>
            <b>Opens</b>
            <span>{opens}</span>
          </div>
          {error && (
            <Note tone="bad" role="alert">
              {error.message}
              {error.status === 409 && onDrafts && (
                <>
                  {' '}
                  <button type="button" className="link rs-linkbtn" onClick={onDrafts}>Go to the question bank</button>
                </>
              )}
            </Note>
          )}
          <div className="cluster">
            {short ? (
              <>
                <Button variant="accent" size="lg" icon="checklist" onClick={() => { chooseMode('set'); setJump(true); }}>
                  Pick a set instead
                </Button>
                {draftCount > 0
                  ? <Button size="lg" onClick={onDrafts}>Review the {plural(draftCount, 'draft')}</Button>
                  : <Button size="lg" onClick={onBack}>Back to the questions</Button>}
              </>
            ) : (
              <>
                <Button
                  variant="accent"
                  size="lg"
                  icon="room"
                  busy={busy}
                  disabled={(isSet && n === 0) || Boolean(blocked)}
                  aria-describedby={blocked ? 'ro-blocked' : undefined}
                  onClick={start}
                >
                  {isSet && n > 0 ? `Open the room on ${plural(n, 'question')}` : 'Open the room'}
                </Button>
                <Button size="lg" onClick={onBack}>Back to the questions</Button>
              </>
            )}
          </div>
          {blocked && !short && <p className="ro-why" id="ro-blocked">{blocked}</p>}
        </Panel>

        <section className="card tc-rules" aria-label="Class and mode">
          <div className="tc-rules-head">
            <Section title="Class and mode" sub="Who the room is for, and how they answer. Fixed when the room opens." />
          </div>
          <ClassChoice state={classes} value={cls ? cls.id : ''} onChange={(id) => { setClassId(id); setError(null); }} onRetry={readClasses} />
          <ModeChoice value={runMode} onChange={(m) => { setRunMode(m); setError(null); }} needsClass={needsClass} />
          <div className="tc-rule">
            <div className="tc-rule-txt">
              <b>Waiting room</b>
              <p>
                {teacherLed
                  ? 'On: the room waits until you press Start in the live view. No phone joins a Teacher-led room either way.'
                  : 'On: phones join and wait, and nothing is served until you press Start in the live view. Off: questions start as each phone joins.'}
              </p>
            </div>
            <Switch label="Waiting room" checked={lobby} onChange={setLobby} />
          </div>
        </section>

        <section className="card tc-rules" aria-label="Room rules">
          <div className="tc-rules-head">
            <Section title="Room rules" sub="Fixed when the room opens, so the standard does not move under the students in it." />
          </div>
          <div className="tc-rule">
            <div className="tc-rule-txt">
              <b>Mastery goal</b>
              <p>The accuracy at a level you would sign off as mastered. Separate from moving up a level, which stays at 70%.</p>
            </div>
            <Segmented label="Mastery goal" options={GOALS} value={goal} onChange={setGoal} />
          </div>
          <div className="tc-rule">
            <div className="tc-rule-txt">
              <b>Extra goes at a wrong answer</b>
              <p>Nothing is revealed between goes. A true-or-false never gets one, and no question gets so many that only one option is left.</p>
            </div>
            <Segmented label="Extra goes at a wrong answer" options={TRIES} value={tries} onChange={setTries} />
          </div>
          <div className="tc-rule">
            <div className="tc-rule-txt">
              <b>Redemption</b>
              <p>A question right first time sets aside the oldest wrong answer at the same level. Nothing is deleted: you still see every answer.</p>
            </div>
            <Switch label="Redemption" checked={redeem === 'on'} onChange={(on) => setRedeem(on ? 'on' : 'off')} />
          </div>
          {teacherLed ? (
            <div className="tc-rule">
              <div className="tc-rule-txt">
                <b>Levels and pace</b>
                <p>No phone is served in a Teacher-led room, so moving levels, the start level, a cap on questions and a timer do not apply.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="tc-rule">
                <div className="tc-rule-txt">
                  <b>Levels move</b>
                  <p>
                    {adapt
                      ? 'On: each student moves up or down a level as they answer.'
                      : 'Off: everyone stays at the start level. Answers are still recorded and counted, and nobody moves up or down. A student below 40% accuracy is still served Remember and Understand only.'}
                  </p>
                </div>
                <Switch label="Levels move" checked={adapt} onChange={setAdapt} />
              </div>
              <div className="tc-rule">
                <div className="tc-rule-txt">
                  <b id="ro-start-h">Start level</b>
                  <p>Where every student starts.{adapt ? '' : ' With levels fixed, where every student stays.'}</p>
                </div>
                <div className="ro-levels" role="radiogroup" aria-labelledby="ro-start-h">
                  {LEVELS.map((l) => (
                    <label key={l} className="ro-level" data-on={startLevel === l ? 'true' : undefined}>
                      <input type="radio" name="ro-start" className="sr-only" value={l} checked={startLevel === l} onChange={() => setStartLevel(l)} />
                      <Level level={l} solid={startLevel === l} />
                    </label>
                  ))}
                </div>
              </div>
              <NumberRule
                id="ro-cap"
                title="Questions per student"
                line={`Each student is served this many, then told they have answered them all. ${CAP.min} to ${CAP.max}, or empty for no cap.`}
                value={cap}
                onChange={setCap}
                unit="questions"
                placeholder="No cap"
                why={capped.why}
              />
              <NumberRule
                id="ro-timer"
                title="Time per question"
                line={`The phone shows a timer and times each question itself. A late answer is still taken, and you see how long each took. ${TIMER.min} to ${TIMER.max} seconds, or empty for none.`}
                value={timer}
                onChange={setTimer}
                unit="seconds"
                placeholder="None"
                why={timed.why}
              />
            </>
          )}
          <div className="tc-rule">
            <div className="tc-rule-txt">
              <b>Question set</b>
              <p>{setLine}</p>
            </div>
            <Segmented label="Question set" options={SET_MODES} value={mode} onChange={chooseMode} />
          </div>
          {isSet && (
            <SetPicker
              innerRef={pickerRef}
              approved={approved}
              kindLabel={bank?.kinds?.label}
              topicOrder={content.topics ?? []}
              picked={picked}
              onPicked={setPicked}
            />
          )}
        </section>
      </div>

      <WaitingRoom runMode={runMode} lobby={lobby} />
    </div>
  );
}
