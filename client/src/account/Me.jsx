/**
 * /me - a student's own standing.
 *
 * It leads with where they are, said in one sentence on the forest panel, with
 * the ladder lit to the level their last session ended at and the few figures
 * that matter beside it. Under it, their path: every session as a stop on one
 * line, each of which opens to the run of answers behind it. Then how often
 * they were right at each level, and their Google link. Last, the evidence:
 * every answer they gave, newest first, with their professor's note where
 * there is one, beside the same answers counted by topic and level.
 *
 * The payload is studentDashboard() in server/src/services/dashboard.js. It is
 * shaped by the token: there is no id to pass and no other student to ask for.
 * The evidence is GET /api/analytics/:id (its topicLevels) and
 * GET /api/analytics/:id/answers with their own id, which is the only id a
 * student is allowed; the answers come back with no key, rubric or machine
 * reading in them, and nothing here leaves a space for one.
 * Two of its states are empty and both are ordinary. An account with no roll
 * number cannot be matched to any session, and one with a roll number has
 * nothing to show until its first. Neither is a failure, so neither is red.
 *
 * Nothing here edits a result. The only things a student can do are ask the
 * server again, join a room, and link or unlink their own Google account.
 *
 * Since decision 7 (19 Nov 2026) only rooms joined while signed in on the
 * phone count here, and the server says so in `note`, shown with the brief.
 * No band is drawn: a band is a staff label, and `banded` is not sent to a
 * student.
 *
 * Me fetches. MeView draws, and is what the dev gallery renders with sample data.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LABEL } from '../lib/bloom.js';
import { reduced } from '../lib/motion.js';
import { HOME_FOR, ROLE_LABEL } from '../lib/routes.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import { Button, Chip, Empty, Icon, Level, Note, Panel, Section, Spark } from '../ui/index.jsx';
import { asPct, before, day, dayTime, highest, levelN, plural } from './insightData.js';
import {
  AnswerFilters, AnswerList, BigLadder, LevelRows, TopicGrid, TopicGridSkel, useAnswers,
} from './insightParts.jsx';

/* ------------------------------------------------------------------ pieces */

/*
 * How a level moves, as the engine moves it (decision 2, 19 Nov 2026): up at
 * 70% or more of the last five answers at the level, once there are at least
 * three; back down when most are wrong. Mastering a level is another bar, the
 * room's goal, 80% unless the professor set it higher.
 */
const MOVES = 'Your next questions move up a level when 70% or more of your last five answers at it are right, '
  + 'once you have at least three there. When most are wrong, they step back down.';
const MASTERY = 'Mastering a level is a separate bar: your room’s goal, 80% unless your professor set it higher.';

const JoinLink = () => (
  <Link className="btn btn-primary" to="/join"><Icon name="room" />Join a room</Link>
);

/** The page in the shape it is about to take. */
function Waiting() {
  return (
    <div className="stack stack-5" aria-busy="true">
      <div className="skel in-skel-panel" />
      <div className="skel" style={{ height: 248, borderRadius: 'var(--r-4)' }} />
      <div className="in-two">
        <div className="skel" style={{ height: 300, borderRadius: 'var(--r-4)' }} />
        <div className="skel" style={{ height: 300, borderRadius: 'var(--r-4)' }} />
      </div>
    </div>
  );
}

/**
 * The student's own Google link: its state, and the one thing to do about it.
 *
 * What linking is for, and that it is optional, are the server's two sentences
 * and are printed as they arrive, linked or not: the screen a student reads
 * before consenting and the page Google sends them back to cannot then say two
 * different things. A roster-imported link offers Confirm, because the id is
 * already there and what is missing is the student saying it is theirs.
 * Disconnecting an unconfirmed link is on the profile screen.
 */
function GoogleLink({ link, busy, error, onConnect, onDisconnect }) {
  if (link == null) {
    return (
      <section className="card card-pad in-google" aria-busy="true" aria-label="Google account">
        <div className="skel" style={{ height: 18, width: 160 }} />
        <div className="skel" style={{ height: 40 }} />
        <div className="skel" style={{ height: 64 }} />
      </section>
    );
  }

  const unconfirmed = link.linked && link.source === 'roster';
  // The chip says the state; the line says only what the chip cannot.
  const state = link.linked
    ? unconfirmed
      ? 'Imported from a Classroom roster by your professor. Not confirmed by you.'
      : link.email ? `As ${link.email}.` : 'Confirmed by you.'
    : link.reason || '';

  return (
    <section className="card card-pad in-google" aria-label="Google account">
      <Section title="Google account" sub="Optional. Your sessions and marks work without it." />
      <div className="in-google-row">
        <span className="in-google-ic"><Icon name="google" size={18} /></span>
        <div className="grow">
          <div className="cluster">
            <h3>Google</h3>
            {link.linked
              ? <Chip tone={unconfirmed ? 'warn' : 'ok'} icon={unconfirmed ? undefined : 'check'}>{unconfirmed ? 'Not confirmed' : 'Connected'}</Chip>
              : <Chip>Not connected</Chip>}
          </div>
          {state && <p className="t-small muted wrap-any">{state}</p>}
        </div>
        {link.configured && (!link.linked || unconfirmed) ? (
          <Button size="sm" variant="primary" icon="link" busy={busy} onClick={onConnect}>{link.linked ? 'Confirm' : 'Connect'}</Button>
        ) : link.linked ? (
          <Button size="sm" busy={busy} onClick={onDisconnect}>Disconnect</Button>
        ) : null}
      </div>
      {error && <Note tone="bad" role="alert">{error}</Note>}
      {(link.purpose || link.optional) && (
        <p className="said">{link.purpose}{link.purpose && link.optional ? ' ' : ''}{link.optional}</p>
      )}
    </section>
  );
}

/**
 * The answers behind one session, oldest first, as a strip of blocks. Two
 * encodings on purpose: the colour is the level the question was aimed at, and
 * filled or hollow (with the rule underneath, green or red) is right or wrong.
 * Colour alone would make the trail unreadable for the students most likely
 * to be looking at it. Pointing at a block, or arrowing along the strip once
 * it has focus, reads that answer out underneath.
 */
function Trail({ session, id }) {
  const history = Array.isArray(session.history) ? session.history : [];
  const right = history.filter((h) => h.correct).length;
  const [at, setAt] = useState(null);
  const facts = [
    dayTime(session.startedAt) || 'No date recorded',
    session.status ? (session.status === 'closed' ? 'room closed' : 'room still open') : null,
    session.accuracy == null ? null : `${asPct(session.accuracy)} right`,
  ].filter(Boolean).join(' · ');

  const read = (i) => {
    const h = history[i];
    return `Question ${i + 1} · ${LABEL[h.bloom] ?? h.bloom} · ${h.correct ? 'right' : 'wrong'}${
      h.score == null ? '' : ` · ${Math.round(h.score * 100)}% credit`
    }`;
  };

  const onKey = (e) => {
    const i = at ?? -1;
    const go = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: history.length - 1 }[e.key];
    if (go === undefined) return;
    e.preventDefault();
    setAt(Math.max(0, Math.min(history.length - 1, go)));
  };

  return (
    <div className="in-trail" id={id}>
      <div className="in-trail-head">
        <h3 className="clip">{session.title || 'Untitled session'}</h3>
        <span className="t-meta">Room <span className="mono">{session.code}</span> · {facts}</span>
      </div>
      {history.length === 0 ? (
        <p className="hint">No answers stored. You joined this room, but it closed before anything was scored.</p>
      ) : (
        <>
          <div
            className="in-strip"
            tabIndex={0}
            role="img"
            aria-label={`${plural(history.length, 'answer')} in order: ${right} right, ${history.length - right} wrong. Arrow keys read each one.`}
            onKeyDown={onKey}
            onMouseLeave={() => setAt(null)}
            onBlur={() => setAt(null)}
          >
            {history.map((h, i) => (
              <i
                key={`${h.questionId}-${i}`}
                data-level={h.bloom}
                data-right={h.correct ? 'true' : 'false'}
                data-at={at === i ? 'true' : undefined}
                title={read(i)}
                style={{ '--d': `${Math.min(i, 30) * 18}ms` }}
                onMouseEnter={() => setAt(i)}
              />
            ))}
          </div>
          <p className="in-strip-read" aria-live="polite">
            {at == null
              ? <>{plural(history.length, 'answer')} · <b>{right} right</b> · {history.length - right} wrong</>
              : <b>{read(at)}</b>}
          </p>
          <p className="hint">
            One block per question, in the order you answered.
            {(session.answered ?? 0) > history.length ? ` The last ${history.length} are kept.` : ''}
            {' '}Colour is the level it was aimed at. Filled is right, hollow is wrong.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Every session as a stop on one line, oldest on the left, each marked with
 * the level it ended at. Pressing a stop opens its answers under the line.
 */
function Path({ sessions, open, onOpen }) {
  const track = useRef(null);
  // Newest is on the right, so start scrolled there: it is the one open.
  useLayoutEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [sessions.length]);

  return (
    <ol className="in-track" ref={track} aria-label="Your sessions, oldest first">
      {sessions.map((s, i) => {
        const on = open === s.code;
        return (
          <li key={s.code} data-level={s.workingLevel} style={{ '--d': `${i * 50}ms` }}>
            <button
              type="button"
              className="in-stop"
              aria-expanded={on}
              aria-controls={on ? `trail-${s.code}` : undefined}
              onClick={() => onOpen(on ? null : s.code)}
            >
              <span className="in-stop-date">{day(s.startedAt) || 'No date'}</span>
              <span className="in-stop-dot" aria-hidden="true">{levelN(s.workingLevel) || '—'}</span>
              <span className="in-stop-title clip" title={s.title || undefined}>{s.title || 'Untitled session'}</span>
              <span className="in-stop-meta">
                {/* Null when answers that were not this student's helped set the
                    room's level (the decision 7 fix): a dash, never a level. */}
                {s.workingLevel
                  ? <Level level={s.workingLevel} />
                  : <span className="t-meta">—<span className="sr-only"> no level shown for this room</span></span>}
              </span>
              <span className="in-stop-fig">{s.correct ?? 0}/{s.answered ?? 0} right</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Every answer they gave, newest first, beside the same answers counted by
 * topic and level. A square in the grid narrows the list to that topic at
 * that level; pressing it again lets go. On a narrow screen the grid comes
 * first, because it is how the list is narrowed.
 *
 * @param topics  null until GET /api/analytics/:id answers, then { data: topicLevels } or { error }
 * @param reads   how many times the page has been read; a new read asks for the answers again
 */
function Evidence({ topics, loadAnswers, reads, onRetry }) {
  const answers = useAnswers(loadAnswers, loadAnswers ? 'mine' : null, 10, reads);
  const report = topics?.data ?? null;
  // A square narrows the list, so it is pressable only while there is a list
  // to narrow: an empty one (rooms from before answers were kept) has none.
  const canPick = Boolean(loadAnswers) && !(answers.status === 'ready' && !answers.items.length && !answers.filtered);
  const list = useRef(null);
  const pick = (cell) => {
    answers.setFilters(cell);
    list.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  };

  return (
    <div className="in-two in-ev">
      {loadAnswers && (
        <section className="card card-pad in-ev-card" aria-label="Your answers" ref={list}>
          <div className="in-ev-head">
            <Section
              title="Your answers"
              sub="Every answer you have given, newest first. A written answer stays provisional until your professor has read it."
            />
            <AnswerFilters answers={answers} topics={(report?.topics ?? []).map((t) => t.topic)} />
          </div>
          <AnswerList
            answers={answers}
            view="student"
            label="Your answers, newest first"
            empty={report?.source === 'history' ? (
              <p>
                <b>None kept one by one yet.</b> Your rooms ran before each answer was stored, so they count in your
                levels but have no rows here. The next room you sit starts this list.
              </p>
            ) : (
              <p><b>No answers on record yet.</b> Each one you give in a room appears here, newest first, with your professor&rsquo;s note when they leave one.</p>
            )}
          />
        </section>
      )}

      <section className="card card-pad in-ev-card in-ev-side" aria-label="By topic">
        <Section
          title="By topic"
          sub={canPick && report?.topics?.length
            ? 'Right of asked, for each topic at each level. Press a square to list those answers.'
            : 'Right of asked, for each topic at each level.'}
        />
        {topics == null ? (
          <TopicGridSkel />
        ) : topics.error ? (
          <div className="in-ans-state" role="alert">
            <p><b>Your topics did not load.</b> {topics.error}</p>
            <Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button>
          </div>
        ) : report?.topics?.length ? (
          <TopicGrid
            report={report}
            picked={answers.filters}
            onPick={canPick ? pick : undefined}
            label="Your right answers of those asked, for each topic at each level"
          />
        ) : (
          <div className="in-ans-state">
            <p><b>No topic on record yet.</b> A topic is counted when one of your marked answers carries one.</p>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- the view */

function Results({ dash, google, evidence }) {
  const sessions = dash.sessions ?? [];
  const counts = dash.counts ?? { sessions: 0, answered: 0, correct: 0, accuracy: null };
  const level = dash.workingLevel;
  const last = sessions[0];
  const started = sessions.length > 0;
  // The server sends newest first; the path reads left to right in time.
  const oldest = [...sessions].reverse();
  const bloom = dash.bloom ?? [];

  // Newest first off the server, so the one open by default is the session
  // they just walked out of. undefined is "not chosen yet"; null is "closed".
  const [picked, setPicked] = useState(undefined);
  const open = picked === undefined ? last?.code : picked;
  const opened = sessions.find((s) => s.code === open);

  // Only with two sessions to compare, and only when the latest session's
  // trail is all of it: otherwise the tick would sit on an estimate.
  const earlier = sessions.length >= 2 ? before(bloom, last) : null;
  const top = highest(bloom);
  const accSeries = oldest.map((s) => s.accuracy).filter((v) => v != null);

  // No band, on purpose: labels are staff-only (the owner's decision (a), 19
  // Nov 2026), and the server no longer sends `banded` to a student.
  // `workingLevel` is null when answers that were not this student's helped
  // set the latest room's level (the decision 7 fix): no level is named then,
  // and the server's note under the ladder says why.
  const sentence = !started
    ? 'No session on your record yet. Your first room sets where you start.'
    : level
      ? `You are working at ${LABEL[level] ?? level}.`
      : 'No level to show for your latest room.';
  const ended = last
    ? level
      ? `Your last session${last.title ? `, ${last.title},` : ''} ended there with ${last.correct ?? 0} of ${plural(last.answered ?? 0, 'answer')} right.`
      : `Your last session${last.title ? `, ${last.title}` : ''}: ${last.correct ?? 0} of ${plural(last.answered ?? 0, 'answer')} right.`
    : '';

  return (
    <>
      <Panel className="in-brief" aria-label="Where you are">
        <div className="in-brief-main">
          <div className="cluster">
            <span className="tag-mint">Where you are</span>
            {last && <span className="in-brief-meta">Last session {day(last.startedAt) || 'undated'}</span>}
          </div>
          <p className="in-brief-line">{sentence}</p>
          {started ? (
            <div className="brief">
              <b>Last</b><span>{ended}</span>
            </div>
          ) : (
            <p className="in-brief-sub">
              Every question is tagged to one of six levels. {MOVES} It runs per student: you are never
              compared with the class.
            </p>
          )}
          <BigLadder level={level} />
          {/* Decision 7: why a room they sat may be missing. The server's sentence. */}
          {dash.note && <p className="in-brief-note"><Icon name="login" size={14} />{dash.note}</p>}
        </div>

        {started ? (
          <div className="in-tiles">
            <div className="ptile" style={{ '--d': '0s' }}>
              <span>Sessions</span>
              <b>{counts.sessions}</b>
              <small><span>{oldest[0] && day(oldest[0].startedAt) ? `since ${day(oldest[0].startedAt)}` : ''}</span></small>
            </div>
            <div className="ptile" style={{ '--d': '0.6s' }}>
              <span>Questions answered</span>
              <b>{counts.answered}</b>
              <Spark values={oldest.map((s) => s.answered ?? 0)} label="Answers in each session" />
              <small><span>{counts.correct} right</span></small>
            </div>
            <div className="ptile" style={{ '--d': '1.2s' }}>
              <span>Accuracy</span>
              <b>{asPct(counts.accuracy)}</b>
              <Spark values={accSeries} label="Accuracy in each session" />
              <small><span>latest {asPct(last?.accuracy)}</span><i>session mean</i></small>
            </div>
            <div className="ptile in-tile-level" style={{ '--d': '1.8s' }}>
              <span>Highest level reached</span>
              <b>{top ? LABEL[top] : '—'}</b>
              <small><span>{top ? `level ${levelN(top)} of 6` : ''}</span><i>asked at least once</i></small>
            </div>
          </div>
        ) : (
          <div className="in-first">
            <div className="brief">
              <b>Join</b><span>Sign in on your phone, then type the code on the board with your roll number <span className="mono">{dash.rollNo}</span>.</span>
              <b>Answer</b><span>Each question is picked for the level you have reached.</span>
              <b>Here</b><span>Your path and your six levels fill in from what you answer.</span>
            </div>
            <Link className="btn btn-accent" to="/join"><Icon name="room" />Join a room</Link>
          </div>
        )}
      </Panel>

      <section className="card in-path" aria-label="Your path">
        <div className="in-path-head">
          <Section
            title="Your path"
            sub={started ? 'Every session you have sat, oldest first. Pick one to see its answers.' : 'Every session you sit becomes a stop on this line.'}
          />
          {started && <span className="t-meta">{plural(sessions.length, 'session')}</span>}
        </div>

        {started ? (
          <>
            <Path sessions={oldest} open={open} onOpen={setPicked} />
            {opened && <Trail session={opened} id={`trail-${opened.code}`} />}
          </>
        ) : (
          <div className="in-path-empty">
            <ol className="in-track in-track-ghost" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <li key={i}><span className="in-stop"><span className="in-stop-date">&nbsp;</span><span className="in-stop-dot" /></span></li>)}
            </ol>
            <div className="in-path-empty-text">
              <h3>No sessions yet</h3>
              <p>
                Your professor puts a six-character code on the board at the start of class. Sign in on
                your phone, enter it with your roll number <span className="mono">{dash.rollNo}</span>,
                and what you answer shows up here.
              </p>
            </div>
          </div>
        )}
        <p className="in-path-foot hint">
          Nothing here can be edited, by you or anyone else. Sitting another session is the only thing
          that moves a level.
        </p>
      </section>

      <div className="in-two">
        <section className="card card-pad in-levels" aria-label="Your Bloom levels">
          <Section title="Your Bloom levels" sub="How often you were right at each level, across every session." />
          <LevelRows bloom={bloom} earlier={earlier} current={level} />
          <p className="hint">
            {started
              ? <>The figure beside each bar is right answers of those asked. Faded means fewer than three: too few to judge.{earlier ? <> The <span className="in-tick-key" aria-hidden="true" /> mark is where it stood before your latest session.</> : ''}</>
              : 'One bar per level. Each fills in as you answer questions at that level.'}
          </p>
          <p className="hint">{started ? `${MOVES} ${MASTERY}` : MASTERY}</p>
        </section>
        {google}
      </div>

      {started && evidence}
    </>
  );
}

/**
 * @param dash       the /api/dashboard answer, or null before the first one
 * @param busy       a read is in flight
 * @param error      why the last read failed, or ''
 * @param link       the /api/classroom/link answer, or null before it arrives
 * @param linkBusy   a connect or disconnect is in flight
 * @param linkError  why the last one failed, or ''
 * @param topics     null until their topic report answers, then { data } or { error }
 * @param loadAnswers  (params) => a page of their own answers, or null when there is no id to ask with
 * @param reads      how many times the page has been read
 */
export function MeView({
  dash, busy, error, onRefresh, link, linkBusy, linkError, onConnect, onDisconnect, topics = null, loadAnswers = null, reads = 0,
}) {
  const { account } = useViewer();
  const google = (
    <GoogleLink link={link} busy={linkBusy} error={linkError} onConnect={onConnect} onDisconnect={onDisconnect} />
  );
  const evidence = <Evidence topics={topics} loadAnswers={loadAnswers} reads={reads} onRetry={onRefresh} />;

  // The page head: who this is about, and what can be done from here.
  const name = account?.fullName || '';
  const roll = dash?.rollNo;
  const crumb = (name || roll) ? (
    <span>{name}{name && roll ? ' · ' : ''}{roll && <>Roll <span className="mono">{roll}</span></>}</span>
  ) : 'Your results';
  // With no roll number the server answers before it looks the professor up,
  // so in that state a missing one means "not looked up", not "none".
  const sub = !dash || dash.reason
    ? 'Where you are, how you got there, and every answer behind it.'
    : dash.professor
      ? `From the rooms ${dash.professor.fullName} has run${dash.department ? `, ${dash.department}` : ''}. Nothing here can be edited.`
      : 'No professor is linked to your account yet, so no room can be matched to you.';
  const actions = (again = 'Refresh') => (
    <>
      {onRefresh && <Button icon="refresh" busy={busy} onClick={onRefresh}>{again}</Button>}
      <JoinLink />
    </>
  );

  let head = { crumb, title: 'Your progress', sub, actions: actions() };
  let body;

  if (!dash && busy) {
    head = { crumb, title: 'Your progress', sub };
    body = <Waiting />;
  } else if (!dash) {
    // The server could not be asked.
    body = (
      <div className="card">
        <Empty
          icon="alert"
          title="Your results did not come back"
          action={<Button variant="primary" icon="refresh" busy={busy} onClick={onRefresh}>Try again</Button>}
        >
          The server said “{error || 'nothing at all'}”. Nothing is lost: your answers are stored
          against your roll number, not in this page.
        </Empty>
      </div>
    );
    head = { crumb, title: 'Your progress', sub };
  } else if (dash.role && dash.role !== 'student') {
    // /api/dashboard answers in the shape of whoever holds the token, so a
    // professor who types /me gets their own payload. Say so; do not draw an
    // empty student out of it.
    head = { crumb: 'Your results', title: 'Your progress' };
    body = (
      <div className="card">
        <Empty
          icon="shield"
          title={`You are signed in as a ${(ROLE_LABEL[dash.role] ?? dash.role).toLowerCase()}`}
          action={<Link className="btn btn-primary" to={HOME_FOR[dash.role] ?? '/'}>Go to your dashboard<Icon name="forward" /></Link>}
        >
          This screen shows one student’s own history. The server answers by account, not by
          address, so it sent your own view, and that one has what this page is missing.
        </Empty>
      </div>
    );
  } else if (dash.reason) {
    // No roll number on the account. A live room has no accounts in it: the
    // number typed on the phone is the only thing tying a signed-in student to
    // their marks. "No sessions" would be a lie about their attendance, so the
    // server's own sentence is printed, verbatim.
    head = { crumb, title: 'Your progress', sub, actions: actions('Check again') };
    body = (
      <>
        {error && (
          <Note tone="bad" role="alert">
            That check did not come back ({error}). This is the last answer the server gave.
          </Note>
        )}
        <Panel className="in-brief" aria-label="Where you are">
          <div className="in-brief-main">
            <div className="cluster"><span className="tag-mint">Where you are</span></div>
            <p className="in-brief-line">No roll number on your account yet.</p>
            <p className="in-brief-sub">{dash.reason}</p>
            <BigLadder level={null} />
            {dash.note && <p className="in-brief-note"><Icon name="login" size={14} />{dash.note}</p>}
          </div>
          <div className="in-first">
            <div className="brief">
              <b>Today</b><span>Today’s session still works. The room asks for your roll number on the phone, so you can sit it.</span>
              <b>Here</b><span>Only this history needs the number on your account, to find you again afterwards.</span>
              {dash.professor && <><b>Who</b><span>{dash.professor.fullName} can add it.</span></>}
            </div>
          </div>
        </Panel>
        <div className="in-two in-two-solo">{google}</div>
      </>
    );
  } else {
    body = (
      <>
        {error && (
          <Note tone="bad" role="alert">
            That refresh did not come back ({error}). This is the last answer the server gave.
          </Note>
        )}
        <Results dash={dash} google={google} evidence={evidence} />
      </>
    );
  }

  return (
    <AccountShell current="home" crumb={head.crumb} title={head.title} sub={head.sub} actions={head.actions}>
      {body}
    </AccountShell>
  );
}

/* ----------------------------------------------------------- the container */

export default function Me() {
  const { account } = useViewer();
  const [dash, setDash] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  // Bumped by Refresh. A student opens this page the moment they walk out of a
  // session, and a re-read is the only thing that could have a new answer.
  const [nonce, setNonce] = useState(0);

  // The student's own Google link. null is "not asked yet", which the row
  // shows as a skeleton; that is distinct from an answer of "not linked".
  const [link, setLink] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    let alive = true;
    setBusy(true);
    api.dashboard().then(
      (res) => { if (!alive) return; setDash(res); setError(''); setBusy(false); },
      (err) => { if (!alive) return; setError(err.message); setBusy(false); },
    );
    return () => { alive = false; };
  }, [nonce]);

  const isStudent = account?.role === 'student';
  const myId = isStudent ? account?.id ?? null : null;

  // Their topic report, from their own record: the one id a student may ask
  // about is theirs. A report already on screen stays through a re-read; a
  // failed re-read leaves it there, and the page's own note says the refresh
  // did not come back.
  const [topics, setTopics] = useState(null);
  useEffect(() => {
    if (!myId) return undefined;
    let alive = true;
    api.analyticsFor(myId).then(
      (res) => { if (alive) setTopics({ data: res?.topicLevels ?? null }); },
      (err) => { if (alive) setTopics((t) => (t?.data ? t : { error: err.message || 'The server did not answer.' })); },
    );
    return () => { alive = false; };
  }, [myId, nonce]);

  const loadAnswers = useCallback((params) => api.studentAnswers(myId, params), [myId]);

  // Resolved either way: a failed request is an answer and has to stop the
  // skeleton, or the row sits there implying the server is still thinking.
  const refreshLink = useCallback(() => {
    if (!isStudent) return;
    api.googleLink().then(setLink, (err) => setLink({ linked: false, configured: false, reason: err.message }));
  }, [isStudent]);

  useEffect(() => { refreshLink(); }, [refreshLink]);

  // Re-checked when the tab regains focus: consent happens in another tab, and
  // coming back to a row still saying "not connected" reads as a failure.
  useEffect(() => {
    window.addEventListener('focus', refreshLink);
    return () => window.removeEventListener('focus', refreshLink);
  }, [refreshLink]);

  /**
   * The tab is opened synchronously inside the click, before the await.
   * Opening it after the request resolves makes it a popup, and every browser
   * blocks that.
   */
  async function connectGoogle() {
    setLinkError('');
    setLinkBusy(true);
    // Not with "noopener": that makes open() return null, so the tab could
    // never be sent anywhere. The opener is cut by hand instead.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url } = await api.googleLinkUrl();
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      if (tab) tab.close();
      setLinkError(`Could not start the Google sign-in: ${err.message}`);
    } finally {
      setLinkBusy(false);
    }
  }

  /**
   * No confirmation step, on purpose: nothing is destroyed and linking again
   * takes one click, so a dialog would be ceremony over a decision that can be
   * undone in three seconds.
   */
  async function disconnectGoogle() {
    setLinkError('');
    setLinkBusy(true);
    try {
      setLink(await api.googleUnlink());
    } catch (err) {
      setLinkError(`Could not disconnect the Google account: ${err.message}`);
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <MeView
      dash={dash}
      busy={busy}
      error={error}
      onRefresh={() => setNonce((n) => n + 1)}
      link={link}
      linkBusy={linkBusy}
      linkError={linkError}
      onConnect={connectGoogle}
      onDisconnect={disconnectGoogle}
      topics={topics}
      loadAnswers={myId ? loadAnswers : null}
      reads={nonce}
    />
  );
}
