/**
 * /me - a student's own standing.
 *
 * It leads with where they are: the loop lit to the level their last session
 * ended at. Then how often they were right at each level, then the sessions
 * themselves, each of which opens to the run of answers behind it.
 *
 * The payload is studentDashboard() in server/src/services/dashboard.js. It is
 * shaped by the token: there is no id to pass and no other student to ask for.
 * Two of its states are empty and both are ordinary. An account with no roll
 * number cannot be matched to any session, and one with a roll number has
 * nothing to show until its first. Neither is a failure, so neither is red.
 *
 * Nothing here edits a result. The only things a student can do are ask the
 * server again, join a room, and link or unlink their own Google account.
 *
 * Me fetches. MeView draws, and is what the dev gallery renders with sample data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LABEL } from '../lib/bloom.js';
import { HOME_FOR, ROLE_LABEL } from '../lib/routes.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import { Button, Chip, Empty, Fig, Icon, Level, Loop, Note } from '../ui/index.jsx';
import { asPct, day, dayTime, plural } from './insightData.js';
import { Levels } from './insightParts.jsx';

/* ------------------------------------------------------------------ pieces */

const JoinLink = () => (
  <Link className="btn btn-primary" to="/join"><Icon name="room" />Join a room</Link>
);

/** Who this page is about, on one line: roll number, professor, department. */
function Head({ dash, busy, onRefresh, again = 'Refresh' }) {
  const parts = dash ? [
    dash.rollNo ? <>Roll <span className="mono">{dash.rollNo}</span></> : null,
    // With no roll number the server answers before it looks the professor
    // up, so in that state a missing one means "not looked up", not "none".
    dash.professor ? dash.professor.fullName : dash.reason ? null : 'No professor linked',
    dash.department || null,
  ].filter(Boolean) : [];

  return (
    <div className="page-head in-head">
      <div className="grow">
        {parts.length > 0 && (
          <div className="eyebrow">
            {parts.map((part, i) => <span key={i}>{i > 0 && ' · '}{part}</span>)}
          </div>
        )}
        <h1>My results</h1>
      </div>
      <div className="acts">
        {onRefresh && <Button icon="refresh" busy={busy} onClick={onRefresh}>{again}</Button>}
        <JoinLink />
      </div>
    </div>
  );
}

/** The page in the shape it is about to take. */
function Waiting() {
  return (
    <div className="stack stack-5" aria-busy="true">
      <div className="stack stack-2">
        <div className="skel" style={{ height: 16, width: 260, maxWidth: '100%' }} />
        <div className="skel" style={{ height: 32, width: 180 }} />
      </div>
      <div className="skel" style={{ height: 288, borderRadius: 'var(--r-3)' }} />
      <div className="split">
        <div className="skel" style={{ height: 320, borderRadius: 'var(--r-3)' }} />
        <div className="skel" style={{ height: 120, borderRadius: 'var(--r-3)' }} />
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
  if (link == null) return <div className="skel" style={{ height: 56 }} />;

  const unconfirmed = link.linked && link.source === 'roster';
  const state = link.linked
    ? unconfirmed
      ? 'Imported from a Classroom roster by your professor. Not confirmed by you.'
      : `Connected${link.email ? ` as ${link.email}` : ''}.`
    : link.reason || 'Not connected.';

  return (
    <section className="stack stack-3" aria-label="Google account">
      <div className="me-google">
        <Icon name="google" className="muted" />
        <div className="grow">
          <h4>Google account</h4>
          <p className="t-small muted wrap-any">{state}</p>
        </div>
        {link.configured && (!link.linked || unconfirmed) ? (
          <Button size="sm" icon="link" busy={busy} onClick={onConnect}>{link.linked ? 'Confirm' : 'Connect'}</Button>
        ) : link.linked ? (
          <Button size="sm" busy={busy} onClick={onDisconnect}>Disconnect</Button>
        ) : null}
      </div>
      {error && <Note tone="bad" role="alert">{error}</Note>}
      {(link.purpose || link.optional) && (
        <p className="hint">{link.purpose}{link.purpose && link.optional ? ' ' : ''}{link.optional}</p>
      )}
    </section>
  );
}

/**
 * The answers behind one session, oldest first. Two encodings on purpose: the
 * colour is the level the question was aimed at, and filled or hollow (with
 * the rule underneath) is right or wrong. Colour alone would make the trail
 * unreadable for the students most likely to be looking at it.
 */
function Trail({ session, id }) {
  const history = Array.isArray(session.history) ? session.history : [];
  const right = history.filter((h) => h.correct).length;
  const facts = [
    dayTime(session.startedAt) || 'No date recorded',
    session.status ? (session.status === 'closed' ? 'room closed' : 'room still open') : null,
    session.accuracy == null ? null : `${asPct(session.accuracy)} right`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="me-trail" id={id}>
      <p className="t-meta">Room <span className="mono">{session.code}</span> · {facts}</p>
      {history.length === 0 ? (
        <p className="hint">No answers stored. You joined this room, but it closed before anything was scored.</p>
      ) : (
        <>
          <div
            className="me-marks"
            role="img"
            aria-label={`${plural(history.length, 'answer')} in order: ${right} right, ${history.length - right} wrong`}
          >
            {history.map((h, i) => (
              <i
                key={`${h.questionId}-${i}`}
                data-level={h.bloom}
                data-right={h.correct ? 'true' : 'false'}
                title={`Question ${i + 1} · ${LABEL[h.bloom] ?? h.bloom} · ${h.correct ? 'right' : 'wrong'}${
                  h.score == null ? '' : ` · ${Math.round(h.score * 100)}% credit`
                }`}
              />
            ))}
          </div>
          <p className="hint">
            One mark per question, in the order you answered.
            {(session.answered ?? 0) > history.length ? ` The last ${history.length} are kept.` : ''}
            {' '}Colour is the level it was aimed at. Filled is right, hollow is wrong.
          </p>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the view */

function Results({ dash, busy, error, onRefresh, google }) {
  const sessions = dash.sessions ?? [];
  const counts = dash.counts ?? { sessions: 0, answered: 0, correct: 0, accuracy: null };
  const level = dash.workingLevel;
  const last = sessions[0];
  const started = sessions.length > 0;

  // Newest first off the server, so the one open by default is the session
  // they just walked out of. undefined is "not chosen yet"; null is "closed".
  const [picked, setPicked] = useState(undefined);
  const open = picked === undefined ? last?.code : picked;

  const lastWhere = last ? [last.title, day(last.startedAt)].filter(Boolean).join(', ') : '';

  return (
    <>
      <Head dash={dash} busy={busy} onRefresh={onRefresh} />

      {error && (
        <Note tone="bad" className="in-gap" role="alert">
          That refresh did not come back ({error}). This is the last answer the server gave.
        </Note>
      )}

      <section className="card me-stand">
        <div className="me-now">
          <Loop
            className="loop-draw"
            level={level ?? 0}
            size={120}
            stroke={14}
            title={level ? `Working at ${LABEL[level] ?? level}` : 'No level yet'}
          />
          <div className="stack stack-2 grow">
            <div>
              <div className="eyebrow">Working at</div>
              <div className="t-display">{level ? (LABEL[level] ?? level) : 'No level yet'}</div>
            </div>
            {dash.banded && <div><Chip icon="info">Support band</Chip></div>}
            {started ? (
              <p className="said">
                Where your last session ended{lastWhere ? `: ${lastWhere}` : ''}.
                {dash.banded && (
                  <> You are in the support band: under 40% in that session, so questions stay at
                  Remember and Understand until it lifts. A shorter ladder for now, not a lower
                  mark, and only your professor sees it.</>
                )}
              </p>
            ) : (
              <p className="said">
                Your first session sets it. Every question is tagged to one of six levels. A few
                right and the next ones step up, a few wrong and they step back down. It runs per
                student: you are never compared with the class.
              </p>
            )}
          </div>
        </div>

        <div className="me-levels">
          <div className="cluster between baseline">
            <h3>Accuracy by level</h3>
            <span className="t-meta">right answers, of those asked</span>
          </div>
          <Levels bloom={dash.bloom} current={level} />
          <p className="hint">
            {started
              ? 'How full a bar is shows how often you were right at that level, across every session. The count under it is how much that rests on. No bar means you have not been asked at that level yet.'
              : 'One bar per level. Each fills in as you answer questions at that level.'}
          </p>
        </div>

        {started && (
          <div className="me-figs figs ruled">
            <Fig value={counts.sessions} label={counts.sessions === 1 ? 'session' : 'sessions'} />
            <Fig value={counts.answered} label="answered" />
            <Fig value={counts.correct} label="correct" />
            <Fig value={asPct(counts.accuracy)} label="accuracy, averaged per session" />
          </div>
        )}
      </section>

      <div className="split me-rest">
        <section className="card">
          <div className="card-head">
            <h3>Sessions</h3>
            {started && <span className="t-meta">{sessions.length}, newest first</span>}
          </div>

          {!started ? (
            <Empty icon="room" title="No sessions yet" action={<JoinLink />}>
              Your professor puts a six-character code on the board at the start of class. Enter it
              with your roll number {dash.rollNo} and what you answer shows up here when you leave
              the room.
            </Empty>
          ) : (
            <>
              <div className="in-rec-box me-sat">
                <div className="in-rec-head" aria-hidden="true">
                  <span>Date</span><span>Chapter</span><span className="r">Answered</span>
                  <span className="r">Correct</span><span>Ended at</span><span />
                </div>
                <ul className="in-rec">
                  {sessions.map((s) => {
                    const on = open === s.code;
                    return (
                      <li key={s.code}>
                        <button
                          type="button"
                          className="in-rec-row"
                          aria-expanded={on}
                          aria-controls={on ? `trail-${s.code}` : undefined}
                          onClick={() => setPicked(on ? null : s.code)}
                        >
                          <span className="in-rec-main">
                            <span className="strong clip" title={s.title || undefined}>{s.title || 'Untitled session'}</span>
                            {s.banded && <Chip>Support band</Chip>}
                          </span>
                          <span className="in-rec-cells">
                            <span className="in-rec-date">{day(s.startedAt) || 'No date'}</span>
                            <span className="in-rec-n">{s.answered ?? 0}<span className="in-rec-unit"> answered</span></span>
                            <span className="in-rec-n">{s.correct ?? 0}<span className="in-rec-unit"> correct</span></span>
                          </span>
                          <span className="in-rec-end"><Level level={s.workingLevel} /></span>
                          <Icon name="chevron" className="in-rec-more" />
                        </button>
                        {on && <Trail session={s} id={`trail-${s.code}`} />}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <p className="card-foot hint">
                Nothing here can be edited, by you or anyone else. Sitting another session is the
                only thing that moves a level.
              </p>
            </>
          )}
        </section>

        <aside className="stack">{google}</aside>
      </div>
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
 */
export function MeView({ dash, busy, error, onRefresh, link, linkBusy, linkError, onConnect, onDisconnect }) {
  const google = (
    <GoogleLink link={link} busy={linkBusy} error={linkError} onConnect={onConnect} onDisconnect={onDisconnect} />
  );
  let body;

  if (!dash && busy) {
    body = <Waiting />;
  } else if (!dash) {
    // The server could not be asked.
    body = (
      <>
        <Head />
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
      </>
    );
  } else if (dash.role && dash.role !== 'student') {
    // /api/dashboard answers in the shape of whoever holds the token, so a
    // professor who types /me gets their own payload. Say so; do not draw an
    // empty student out of it.
    body = (
      <>
        <div className="page-head in-head"><div className="grow"><h1>My results</h1></div></div>
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
      </>
    );
  } else if (dash.reason) {
    // No roll number on the account. A live room has no accounts in it: the
    // number typed on the phone is the only thing tying a signed-in student to
    // their marks. "No sessions" would be a lie about their attendance, so the
    // server's own sentence is printed, verbatim.
    body = (
      <>
        <Head dash={dash} busy={busy} onRefresh={onRefresh} again="Check again" />
        {error && (
          <Note tone="bad" className="in-gap" role="alert">
            That check did not come back ({error}). This is the last answer the server gave.
          </Note>
        )}
        <section className="card me-stand">
          <div className="me-now">
            <Loop level={0} size={120} stroke={14} title="No level yet" />
            <div className="stack stack-3 grow">
              <h2>No roll number on your account</h2>
              <p className="said">{dash.reason}</p>
              <p className="t-small dim">
                A live room knows you by roll number, not by your account.
                {dash.professor ? ` ${dash.professor.fullName} can add it.` : ''}
              </p>
            </div>
          </div>
        </section>
        <div className="split me-rest">
          <Note>
            <b>Today’s session still works.</b> The room asks for your roll number on the phone, so
            you can sit it. Only this history needs the number on your account, to find you again
            afterwards.
          </Note>
          <aside className="stack">{google}</aside>
        </div>
      </>
    );
  } else {
    body = <Results dash={dash} busy={busy} error={error} onRefresh={onRefresh} google={google} />;
  }

  return <AccountShell current="home" crumb="My results">{body}</AccountShell>;
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
    />
  );
}
