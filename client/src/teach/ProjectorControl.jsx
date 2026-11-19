/**
 * What the classroom wall shows, and the links that open it (Phase 3).
 *
 *   <ProjectorControl code canControl info askLevel />
 *
 * `info` is the room's row from the room list (mode, contentId, questionIds,
 * status). `askLevel`, when given, opens the question list on that level.
 *
 * The preview on the left is the reply's `shows` drawn by the wall's own
 * component: exactly what a projector is sent now, through the server's
 * whitelist, so nothing is guessed here. Every change is one PATCH, and its
 * reply replaces the whole view.
 *
 * A link's token comes back once, in the reply that makes it. It goes straight
 * into the new window's address (after the #, so it never reaches a server log)
 * and is dropped: it is never put in state, stored or logged. The window is
 * opened before the request is sent, while the click still counts as the
 * user's, or a pop-up blocker would stop it.
 *
 * A head of department reads the room but may not change it (`canControl`
 * false): they see the preview and the links, and no controls.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { Button, Chip, Icon, Level, Note, Segmented, Switch } from '../ui/index.jsx';
import { WallScreen } from './Wall.jsx';

const MODE_LABEL = { question: 'Question', diagram: 'Diagram', progress: 'Progress' };
const ROOM_MODE = { devices: 'Student devices', 'teacher-led': 'Teacher-led', mixed: 'Mixed' };
const POLL_MS = 8000;

/* -------------------------------------------------------------- helpers */

function clock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`;
}

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const stimulusKey = (s) => `${s.kind}|${s.url ?? ''}|${s.text ?? ''}`;
const excerpt = (text, n) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

/* ------------------------------------------------------------ the parts */

function Watching({ n }) {
  if (n == null) return null;
  return n > 0
    ? <Chip tone="ok" dot className="chip-live">{n === 1 ? '1 projector watching' : `${n} projectors watching`}</Chip>
    : <Chip icon="projector">No projector is watching</Chip>;
}

function Links({ links, canWrite, busy, onRevoke }) {
  const sorted = [...links].sort((a, b) => (b.active - a.active) || String(b.createdAt).localeCompare(String(a.createdAt)));
  return (
    <section className="bm-links" aria-labelledby="bm-links-h">
      <div className="bm-links-head">
        <h3 id="bm-links-h">Projector links</h3>
        {links.length > 0 && <span className="t-meta mono">{links.length}</span>}
      </div>
      {links.length === 0 ? (
        <p className="bm-quiet">No link yet. Opening a projector window makes one.</p>
      ) : (
        <ul className="bm-linklist">
          {sorted.map((l) => {
            const state = l.revokedAt ? 'off' : l.active ? 'on' : 'ended';
            return (
              <li key={l.id} data-state={state}>
                <Icon name="link" />
                <div className="bm-link-main">
                  <b>Made {clock(l.createdAt)}</b>
                  <span>
                    {state === 'on' && `Works until ${clock(l.expiresAt)}`}
                    {state === 'ended' && `Ran out at ${clock(l.expiresAt)}`}
                    {state === 'off' && `Turned off at ${clock(l.revokedAt)}`}
                  </span>
                </div>
                {state === 'on' ? <Chip tone="ok" dot>Working</Chip> : <Chip>{state === 'off' ? 'Turned off' : 'Ended'}</Chip>}
                {canWrite && state === 'on' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    busy={busy === `revoke:${l.id}`}
                    disabled={Boolean(busy)}
                    onClick={() => onRevoke(l.id)}
                    aria-label={`Turn off the link made at ${clock(l.createdAt)}`}
                  >
                    Turn off
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One of the room's questions, in the list it is put up from. */
function Item({ q, up, canWrite, busy, onPut, diagram }) {
  const key = `${diagram ? 'd' : 'q'}:${q.id}`;
  return (
    <li className="bm-item" data-up={up || undefined}>
      {diagram && q.stimulus && (
        q.stimulus.kind === 'image'
          ? <img className="bm-thumb" src={q.stimulus.url} alt={q.stimulus.alt || ''} loading="lazy" />
          : <span className="bm-thumb bm-thumb-text" aria-hidden="true"><Icon name="book" /></span>
      )}
      <div className="bm-item-main">
        <span className="bm-item-meta">
          <Level level={q.bloom} />
          <span>{diagram ? (q.stimulus?.kind === 'image' ? 'Picture' : 'Passage') : KIND_LABEL[q.kind] ?? q.kind}</span>
          {!diagram && q.stimulus && (
            <span className="bm-has"><Icon name={q.stimulus.kind === 'image' ? 'zoom' : 'book'} size={13} /><span className="sr-only">Has a diagram or passage</span></span>
          )}
        </span>
        <span className="bm-item-text">
          {!diagram ? q.text
            : q.stimulus?.kind === 'passage' ? `“${excerpt(q.stimulus.text || '', 150)}”` : q.stimulus?.alt || q.text}
        </span>
      </div>
      {up
        ? <Chip tone="accent" icon="projector">Up</Chip>
        : canWrite && (
          <Button size="sm" busy={busy === key} disabled={Boolean(busy)} onClick={() => onPut(q.id)} aria-label={`Put up: ${excerpt(q.text, 60)}`}>
            Put up
          </Button>
        )}
    </li>
  );
}

function QuestionPicker({ questions, questionsError, tallies, screen, picker, onPicker, level, onLevel, canWrite, busy, onPatch, diagram }) {
  // On the diagram screen several questions often share one passage or
  // picture, and any of them puts up the same thing: each is listed once.
  const pool = useMemo(() => {
    const seen = new Set();
    const list = (questions ?? []).filter((q) => {
      if (!diagram) return true;
      if (!q.stimulus) return false;
      const k = stimulusKey(q.stimulus);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return list.sort((a, b) => LEVELS.indexOf(a.bloom) - LEVELS.indexOf(b.bloom));
  }, [questions, diagram]);
  const counts = useMemo(() => Object.fromEntries(LEVELS.map((l) => [l, pool.filter((q) => q.bloom === l).length])), [pool]);
  const shown = level === 'all' ? pool : pool.filter((q) => q.bloom === level);
  const upQ = diagram ? (questions ?? []).find((q) => same(q.id, screen.diagram?.questionId)) : null;
  const upId = diagram
    ? pool.find((q) => upQ?.stimulus && stimulusKey(q.stimulus) === stimulusKey(upQ.stimulus))?.id
    : screen.question?.source === 'bank' ? screen.question.id : null;
  const upTally = !diagram && screen.question?.source === 'tally' ? screen.question.id : null;
  const tab = diagram ? 'bank' : picker;

  return (
    <div className="bm-picker">
      <div className="bm-picker-head">
        {diagram
          ? <h4>Diagrams and passages in this room’s questions</h4>
          : (
            <Segmented
              label="Where the question comes from"
              value={picker}
              onChange={onPicker}
              options={[
                { id: 'bank', label: 'Room questions', count: questions ? pool.length : null },
                { id: 'tally', label: 'Asked aloud', count: tallies ? tallies.length : null },
              ]}
            />
          )}
        {tab === 'bank' && (
          <label className="bm-level">
            <select className="select input-sm" aria-label="Level" value={level} onChange={(e) => onLevel(e.target.value)}>
              <option value="all">All levels ({pool.length})</option>
              {LEVELS.map((l) => <option key={l} value={l} disabled={!counts[l]}>{LABEL[l]} ({counts[l]})</option>)}
            </select>
          </label>
        )}
      </div>

      {tab === 'bank' && (
        questionsError ? <Note tone="bad">{questionsError}</Note>
          : !questions ? <div className="bm-list-skel" aria-hidden="true"><i className="skel" /><i className="skel" /><i className="skel" /></div>
            : shown.length === 0 ? (
              <p className="bm-quiet">
                {pool.length === 0 && diagram
                  ? 'None of this room’s questions carries a diagram or a passage.'
                  : pool.length === 0 ? 'This room has no questions to put up.' : 'None of them is at this level.'}
              </p>
            ) : (
              <ul className="bm-list">
                {shown.map((q) => (
                  <Item
                    key={q.id}
                    q={q}
                    diagram={diagram}
                    up={same(q.id, upId)}
                    canWrite={canWrite}
                    busy={busy}
                    onPut={(id) => onPatch(diagram ? { mode: 'diagram', diagram: { questionId: id } } : { mode: 'question', question: { questionId: id } }, `${diagram ? 'd' : 'q'}:${id}`)}
                  />
                ))}
              </ul>
            )
      )}

      {tab === 'tally' && (
        !tallies ? <div className="bm-list-skel" aria-hidden="true"><i className="skel" /><i className="skel" /></div>
          : tallies.length === 0 ? (
            <p className="bm-quiet">No question has been asked aloud in this room yet. Ones you record with the tally appear here.</p>
          ) : (
            <ul className="bm-list">
              {tallies.map((t) => {
                const up = same(t.id, upTally);
                return (
                  <li key={t.id} className="bm-item" data-up={up || undefined}>
                    <div className="bm-item-main">
                      <span className="bm-item-meta">
                        <span className="mono">#{t.seq}</span>
                        <span>{t.questionId ? 'From the room’s questions' : 'Typed in'}</span>
                      </span>
                      <span className="bm-item-text">{t.text}</span>
                    </div>
                    {up
                      ? <Chip tone="accent" icon="projector">Up</Chip>
                      : canWrite && (
                        <Button
                          size="sm"
                          busy={busy === `t:${t.id}`}
                          disabled={Boolean(busy)}
                          onClick={() => onPatch({ mode: 'question', question: { tallyId: t.id } }, `t:${t.id}`)}
                          aria-label={`Put up: ${excerpt(t.text, 60)}`}
                        >
                          Put up
                        </Button>
                      )}
                  </li>
                );
              })}
            </ul>
          )
      )}
    </div>
  );
}

/** What is up now in the question screen, with its key and its way down. */
function NowQuestion({ shows, screen, tallies, roomMode, canWrite, busy, onPatch }) {
  const q = shows.question;
  if (!q) {
    return <p className="bm-quiet">Nothing is up. The wall shows the room code and how to join.</p>;
  }
  const tally = q.source === 'tally' ? (tallies ?? []).find((t) => same(t.id, screen.question?.id)) : null;
  // The server's own test: a bank question's key, or a tally's that came from
  // the bank (or one this screen cannot find), only in a Teacher-led room.
  const keyBlocked = roomMode !== 'teacher-led' && (q.source === 'bank' || !tally || Boolean(tally.questionId));
  const hasKey = q.source === 'tally' ? !tally || tally.correct != null : (q.options ?? []).length > 0 && q.kind !== 'poll';
  const revealed = screen.revealed;

  return (
    <div className="bm-now">
      <span className="bm-k">{q.source === 'tally' ? 'Asked aloud, on the wall' : 'On the wall'}</span>
      <p className="bm-now-text">{q.text}</p>
      {canWrite && (
        <div className="bm-now-acts">
          {hasKey && (
            <Button
              size="sm"
              variant={revealed ? undefined : 'ink'}
              icon={revealed ? 'eyeOff' : 'eye'}
              busy={busy === 'reveal'}
              disabled={Boolean(busy) || (keyBlocked && !revealed)}
              aria-describedby={keyBlocked && !revealed ? 'bm-keywhy' : undefined}
              onClick={() => onPatch({ revealed: !revealed }, 'reveal')}
            >
              {revealed ? 'Hide the key' : 'Reveal the key'}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon="close" busy={busy === 'qdown'} disabled={Boolean(busy)} onClick={() => onPatch({ question: null }, 'qdown')}>
            Take it down
          </Button>
        </div>
      )}
      {canWrite && hasKey && keyBlocked && !revealed && (
        <p className="bm-why" id="bm-keywhy">
          <Icon name="lock" size={13} />
          In a {ROOM_MODE[roomMode] ?? roomMode} room this key stays off the wall. The rule under the preview says why.
        </p>
      )}
      {!hasKey && <p className="bm-why"><Icon name="info" size={13} />{q.source === 'tally' ? 'This question was recorded with no correct option, so there is no key to show.' : 'This kind goes up as its question alone, with no key to show.'}</p>}
    </div>
  );
}

function NowDiagram({ shows, canWrite, busy, onPatch }) {
  const s = shows.diagram?.stimulus;
  if (!s) return <p className="bm-quiet">Nothing is up. The wall shows the room code and how to join.</p>;
  return (
    <div className="bm-now">
      <span className="bm-k">{s.kind === 'image' ? 'Diagram on the wall' : 'Passage on the wall'}</span>
      <p className="bm-now-text">{s.kind === 'image' ? (s.alt || 'A picture with no description') : `“${excerpt(s.text || '', 180)}”`}</p>
      {canWrite && (
        <div className="bm-now-acts">
          <Button size="sm" variant="ghost" icon="close" busy={busy === 'ddown'} disabled={Boolean(busy)} onClick={() => onPatch({ diagram: null }, 'ddown')}>
            Take it down
          </Button>
        </div>
      )}
    </div>
  );
}

function NowProgress({ shows }) {
  const p = shows.progress;
  if (!p) return null;
  return (
    <div className="bm-now">
      <span className="bm-k">On the wall</span>
      <p className="bm-now-text">
        {p.classSize != null ? `${p.present} of ${p.classSize} present` : `${p.present} ${p.present === 1 ? 'phone' : 'phones'} joined`}
        {' · '}
        {p.answered} {p.answered === 1 ? 'has' : 'have'} answered
      </p>
      <p className="bm-why">
        <Icon name="info" size={13} />
        {p.levels
          ? 'Answers at each level are up, for the class as a whole.'
          : `Answers at each level go up once ${p.minAnswered} students have answered.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- the view */

/**
 * The console's projector controls, drawn from a projector body. Pure: the
 * default export below fetches and changes; the gallery feeds this directly.
 */
export function ProjectorConsole({
  body, roomMode = 'devices', canControl, questions, questionsError, tallies,
  picker = 'bank', onPicker, level = 'all', onLevel, busy = '', error = '', onClearError,
  onPatch, onOpen, onRevoke,
}) {
  const { shows, screen, links = [], rule, watching } = body;
  const closed = body.room?.status === 'closed';
  const canWrite = Boolean(canControl) && !closed;
  const pick = shows.pick;

  return (
    <section className="bm" aria-label="Projector">
      <div className="bm-grid">
        <div className="bm-view">
          <div className="bm-head">
            <div className="sec">
              <h2>On the wall now</h2>
              <p>The preview is exactly what every projector of this room is sent.</p>
            </div>
            <Watching n={watching} />
          </div>

          <figure className="bm-stage" aria-label="What the wall shows now">
            <div className="wl-frame bm-frame"><WallScreen state={shows} /></div>
          </figure>

        </div>

        <div className="bm-side card">
          <div className="bm-side-head">
            <div className="sec">
              <h3>Controls</h3>
              <p>{ROOM_MODE[roomMode] ?? 'Student devices'} room</p>
            </div>
            {canWrite && (
              <Button variant="primary" icon="projector" busy={busy === 'link'} disabled={Boolean(busy) && busy !== 'link'} onClick={onOpen}>
                Open a projector window
              </Button>
            )}
          </div>

          {!canControl && (
            <Note icon="eye">You can see what the wall shows. Only the professor who runs this room can change it.</Note>
          )}
          {canControl && closed && <Note>This room is closed. Its wall shows nothing more, and its links no longer work.</Note>}
          {error && (
            <Note tone="bad" role="alert">
              {error}
              {onClearError && <button type="button" className="bm-dismiss" onClick={onClearError}>Dismiss</button>}
            </Note>
          )}

          <div className="bm-block">
            <span className="bm-k" id="bm-screen-k">The wall shows</span>
            <Segmented
              label="What the wall shows"
              value={screen.mode}
              onChange={(m) => { if (m !== screen.mode) onPatch({ mode: m }, 'mode'); }}
              options={(body.modes ?? ['question', 'diagram', 'progress']).map((m) => ({ id: m, label: MODE_LABEL[m] ?? m, disabled: !canWrite || Boolean(busy) }))}
            />
          </div>

          <div className="bm-block">
            {screen.mode === 'question' && (
              <NowQuestion shows={shows} screen={screen} tallies={tallies} roomMode={roomMode} canWrite={canWrite} busy={busy} onPatch={onPatch} />
            )}
            {screen.mode === 'diagram' && <NowDiagram shows={shows} canWrite={canWrite} busy={busy} onPatch={onPatch} />}
            {screen.mode === 'progress' && <NowProgress shows={shows} />}
          </div>

          {canWrite && screen.mode !== 'progress' && (
            <div className="bm-block">
              <QuestionPicker
                questions={questions}
                questionsError={questionsError}
                tallies={tallies}
                screen={screen}
                picker={picker}
                onPicker={onPicker}
                level={level}
                onLevel={onLevel}
                canWrite={canWrite}
                busy={busy}
                onPatch={onPatch}
                diagram={screen.mode === 'diagram'}
              />
            </div>
          )}

          <div className="bm-block">
            <span className="bm-k">The wheel’s pick</span>
            {pick ? (
              <div className="bm-pickrow">
                <span className="bm-pick">
                  <b className="mono">{pick.rollNo}</b>
                  {pick.firstName && <span>{pick.firstName}</span>}
                </span>
                {canWrite && (
                  <Button size="sm" variant="ghost" icon="close" busy={busy === 'pick'} disabled={Boolean(busy)} onClick={() => onPatch({ pick: null }, 'pick')}>
                    Take it down
                  </Button>
                )}
              </div>
            ) : (
              <p className="bm-quiet">No pick is up. Each draw of the wheel goes up by itself.</p>
            )}
            <div className="bm-switch">
              <div>
                <span id="bm-names-l">First name with the roll number</span>
                <small>Off: the wall shows the roll number alone.</small>
              </div>
              <Switch
                checked={screen.showNames}
                label="First name with the roll number"
                disabled={!canWrite || Boolean(busy)}
                onChange={(v) => onPatch({ showNames: v }, 'names')}
              />
            </div>
          </div>
        </div>

        <div className="bm-meta">
          {rule && <p className="said bm-rule">{rule}</p>}
          <Links links={links} canWrite={canWrite} busy={busy} onRevoke={onRevoke} />
        </div>
      </div>
    </section>
  );
}

/** The shape of the console while its first read is out. */
export function ProjectorSkeleton() {
  return (
    <section className="bm" aria-label="Projector" aria-busy="true">
      <div className="bm-grid">
        <div className="bm-view">
          <div className="skel" style={{ width: 180, height: 18 }} />
          <div className="bm-stage skel" />
        </div>
        <div className="bm-side card">
          <div className="skel" style={{ width: '60%', height: 18 }} />
          <div className="skel" style={{ width: 240, height: 32 }} />
          <div className="skel" style={{ height: 120 }} />
          <div className="skel" style={{ height: 200 }} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ with data */

export default function ProjectorControl({ code, canControl, info, askLevel }) {
  const [body, setBody] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [questions, setQuestions] = useState(null);
  const [questionsError, setQuestionsError] = useState('');
  const [tallies, setTallies] = useState(null);
  const [picker, setPicker] = useState('bank');
  const [level, setLevel] = useState(askLevel || 'all');
  const seq = useRef(0); // the newest request wins, so a slow poll cannot undo a change
  const busyRef = useRef('');
  busyRef.current = busy;

  const roomMode = info?.settings?.mode ?? 'devices';
  const contentId = info?.contentId ?? null;
  const setKey = Array.isArray(info?.questionIds) ? info.questionIds.join(',') : '';

  const apply = useCallback((reply, n) => {
    if (n !== seq.current) return;
    // A reply that made or turned off a link carries it too; the body is the rest.
    const { link: _link, ...rest } = reply;
    setBody(rest);
    setLoadError('');
  }, []);

  const load = useCallback(() => {
    const n = ++seq.current;
    return api.projector(code).then((r) => apply(r, n)).catch((e) => { if (n === seq.current) setLoadError(e.message); });
  }, [code, apply]);

  const loadTallies = useCallback(() => {
    api.tallies(code).then((r) => setTallies(r.tallies ?? [])).catch(() => setTallies((t) => t ?? []));
  }, [code]);

  useEffect(() => {
    setBody(null);
    load();
    loadTallies();
  }, [load, loadTallies]);

  // Draws, joins and answers change the wall from elsewhere, and the socket
  // tells this screen nothing about projectors: read again while it is seen.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible' && !busyRef.current) load(); };
    const id = setInterval(tick, POLL_MS);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [load]);

  useEffect(() => {
    if (askLevel) {
      setLevel(askLevel);
      setPicker('bank');
    }
  }, [askLevel]);

  useEffect(() => {
    if (picker === 'tally') loadTallies();
  }, [picker, loadTallies]);

  // The room's questions: its set, or the approved bank when it serves the
  // whole bank. The item report lists only what has been answered, so the bank
  // is read when the room's chapter is known.
  useEffect(() => {
    if (!canControl) return undefined;
    let alive = true;
    setQuestions(null);
    setQuestionsError('');
    const wanted = setKey ? new Set(setKey.split(',').map((id) => id.toLowerCase())) : null;
    const read = contentId
      ? api.getBank(contentId).then((b) => (b.questions ?? [])
        .filter((q) => q.status === 'active' && (!wanted || wanted.has(String(q._id).toLowerCase())))
        .map((q) => ({ id: String(q._id), text: q.text ?? '', kind: q.kind, bloom: q.bloom, stimulus: q.stimulus ?? null })))
      : api.roomItems(code).then((r) => (r.items ?? [])
        .filter((i) => i.status === 'active')
        .map((i) => ({ id: String(i.questionId), text: i.text ?? '', kind: i.kind, bloom: i.bloom, stimulus: null })));
    read.then((qs) => { if (alive) setQuestions(qs); }).catch((e) => { if (alive) setQuestionsError(e.message); });
    return () => { alive = false; };
  }, [code, canControl, contentId, setKey]);

  async function patch(change, key) {
    setBusy(key);
    setError('');
    const n = ++seq.current;
    try {
      apply(await api.setProjector(code, change), n);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function openWall() {
    setError('');
    // Opened now, on the click, or a pop-up blocker stops it. It is cut off
    // from this window at once: the wall needs nothing from the console.
    const win = window.open('', '_blank');
    if (!win) {
      setError('The browser blocked the new window. Allow pop-ups for this site, then try again.');
      return;
    }
    try { win.opener = null; } catch { /* already cut off */ }
    setBusy('link');
    const n = ++seq.current;
    try {
      const { token, ...rest } = await api.createProjectorLink(code);
      win.location.replace(`${window.location.origin}/wall#${token}`);
      apply(rest, n);
      // The wall connects a moment later; read again so "watching" counts it.
      setTimeout(() => { if (!busyRef.current) load(); }, 2500);
    } catch (e) {
      win.close();
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function revoke(linkId) {
    setBusy(`revoke:${linkId}`);
    setError('');
    const n = ++seq.current;
    try {
      apply(await api.revokeProjectorLink(code, linkId), n);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  if (!body) {
    if (loadError) {
      return (
        <section className="bm" aria-label="Projector">
          <Note tone="bad">
            {loadError}
            <button type="button" className="bm-dismiss" onClick={load}>Try again</button>
          </Note>
        </section>
      );
    }
    return <ProjectorSkeleton />;
  }

  return (
    <ProjectorConsole
      body={body}
      roomMode={roomMode}
      canControl={canControl}
      questions={questions}
      questionsError={questionsError}
      tallies={tallies}
      picker={picker}
      onPicker={setPicker}
      level={level}
      onLevel={setLevel}
      busy={busy}
      error={error}
      onClearError={() => setError('')}
      onPatch={patch}
      onOpen={openWall}
      onRevoke={revoke}
    />
  );
}
