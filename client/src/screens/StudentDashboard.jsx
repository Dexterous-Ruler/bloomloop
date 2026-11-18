import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api.js';
import { useAccount, signOut } from '../auth.js';
import { LEVELS, LABEL } from '../bloom.js';
import Icon from '../ui/Icon.jsx';
import Shell, { Avatar, Card, Empty, PageHead, Stat, TailBars } from '../ui/Shell.jsx';
import { HOME_FOR } from './SignIn.jsx';

/**
 * /me — the student's own history, and nothing else.
 *
 * Read-only is not a limitation of this screen, it is what it is for. A student
 * is read-only in the permissions table, so there is no verb here at all: no
 * edit, no export, no request-a-recount. The only button that exists asks the
 * server the same question again. Everything a student could want to change
 * about these numbers is changed by sitting another session.
 *
 * The payload is studentDashboard() in server/src/services/dashboard.js. It is
 * shaped by the token — there is no id to pass and no other student to ask for.
 *
 * Two of its states are empty ones, and both are ordinary: an account with no
 * roll number cannot be matched to any session at all, and an account with one
 * has nothing to show until they sit their first. Neither is a failure, so
 * neither gets a red box.
 */

const ZERO = { seen: 0, correct: 0, accuracy: null };

/** A 0..1 fraction as a percentage, or an em dash when there is no evidence. */
const percent = (fraction) =>
  fraction === null || fraction === undefined ? '—' : `${Math.round(fraction * 100)}%`;

/* A date a student recognises. `startedAt` is an ISO string off the session row,
   and a list of five raw timestamps is the fastest way to make five sessions
   look like one. Null is possible on a seeded room, so it is said out loud
   rather than printed as "Invalid Date". */
function day(iso) {
  if (!iso) return 'no date recorded';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'no date recorded';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function dayTime(iso) {
  if (!iso) return 'no date recorded';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'no date recorded';
  return `${day(iso)} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * The chrome, shared by every state so the header does not jump between the
 * skeleton and the answer. Two nav destinations because a student only ever has
 * two — this history, and the room they are about to sit.
 */
function Frame({ account, rollNo, children }) {
  return (
    <Shell
      badge={rollNo ? <span className="barcount mono" title="Your roll number">{rollNo}</span> : null}
      nav={(
        // Links rather than NavPill's buttons. NavPill is built for a track whose
        // items switch a view in place, and every item here is a different
        // address — an anchor is the honest control for that, and it middle-clicks
        // and opens in a tab the way a student expects.
        //
        // The three a student has: this history, the same history read as a
        // profile, and the room. Same three in the same order as the track on
        // /analytics, so crossing between them does not reshuffle the nav.
        <nav className="navpill">
          <Link to="/me" aria-current="true">Your results</Link>
          <Link to="/analytics">Analytics</Link>
          <Link to="/join">Join a room</Link>
        </nav>
      )}
      right={(
        <>
          <span className="flag neutral" title="A student account reads its own history and writes nothing.">
            <Icon name="lock" size={11} />
            Read only
          </span>
          <Avatar name={account?.fullName || account?.email || 'Student'} href="/profile" />
          <button type="button" className="iconbtn" title="Sign out" onClick={() => signOut()}>
            <Icon name="logout" />
          </button>
        </>
      )}
    >
      {children}
    </Shell>
  );
}

/**
 * The six levels as one shape. This is the point of the screen: a student has
 * never been shown their own profile before, only a mark out of ten.
 *
 * Bar height is accuracy, not volume — how often they were right at that level,
 * so a level they met twice and a level they met twenty times are read the same
 * way. The count underneath carries the volume, and lime carries "you are here"
 * exactly as it does on the teacher's grid.
 */
function BloomProfile({ byLevel, workingLevel }) {
  const chart = useRef(null);
  const [tight, setTight] = useState(false);

  // Six full level names need about 74px of column each, and this is the one
  // chart in the product a student opens on a phone — at 375px the names
  // overlapped their neighbours and the whole shape stopped being readable.
  // Measured off the chart rather than off a breakpoint, because what decides it
  // is the width of the card, which the screen around it is free to change.
  useEffect(() => {
    const el = chart.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setTight(entry.contentRect.width / LEVELS.length < 74));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="bars" ref={chart}>
      {LEVELS.map((level) => {
        const cell = byLevel[level] ?? ZERO;
        const share = cell.accuracy === null ? 0 : Math.round(cell.accuracy * 100);
        const here = level === workingLevel;
        return (
          // .here rather than .bars .track.cur: the outline belongs around the
          // whole column, label and name included, because the sentence it is
          // making is "this level is you", not "this bar is you".
          <div key={level} className={here ? 'here' : ''} title={LABEL[level]}>
            <div className="lab">{cell.seen ? `${share}%` : '—'}</div>
            <div className="track" style={{ height: 132 }}>
              {/* A level answered and never got right is not the same as a level
                  never met, so 0% keeps a sliver rather than disappearing. */}
              <i
                className={`swatch ${level}`}
                style={{ height: cell.seen ? `${Math.max(share, 3)}%` : 0 }}
              />
            </div>
            <div className={`nm${here ? ' cur' : ''}`}>
              {tight ? LABEL[level].slice(0, 3) : LABEL[level]}
            </div>
            <div className="lab">
              {cell.seen
                ? `${cell.correct}${tight ? '/' : ' of '}${cell.seen}`
                : (tight ? '—' : 'not met yet')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The answers that produced one session, oldest first. Two encodings on purpose:
 * the block is the level the question was aimed at, the rule under it is right
 * or wrong. Colour alone would make the trail unreadable for the students most
 * likely to be looking at it.
 */
function Trail({ history }) {
  return (
    <div
      style={{
        background: 'var(--d-2)', borderRadius: 16, padding: '14px 16px',
        display: 'flex', flexDirection: 'column', minWidth: 0,
      }}
    >
      <div className="eyebrow on-d">Answer trail{history.length ? ` · ${history.length}` : ''}</div>

      {history.length === 0 ? (
        <div className="d-empty" style={{ marginTop: 12 }}>
          <b>No answers stored</b>
          <span>You joined this room but the session closed before anything was scored.</span>
        </div>
      ) : (
        <>
          {/* Centred in whatever height the accent card beside it happens to
              take: pinned to the top, fourteen marks sat in the corner of a
              quarter-empty box and read as a panel that had failed to fill. */}
          <div
            style={{
              flex: 1, display: 'flex', flexWrap: 'wrap', alignContent: 'center',
              gap: 5, marginTop: 14, minHeight: 40,
            }}
          >
            {history.map((h, i) => (
              <span
                key={`${h.questionId}-${i}`}
                title={`Question ${i + 1} · ${LABEL[h.bloom] ?? h.bloom} · ${h.correct ? 'right' : 'wrong'}${
                  h.score === undefined || h.score === null ? '' : ` · ${Math.round(h.score * 100)}% credit`
                }`}
                style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 15 }}
              >
                <i className={`swatch ${h.bloom}`} style={{ height: 28, opacity: h.correct ? 1 : 0.32 }} />
                <i
                  style={{
                    display: 'block', height: 3, borderRadius: 'var(--r-pill)',
                    background: h.correct ? 'var(--ok)' : 'var(--bad)',
                  }}
                />
              </span>
            ))}
          </div>
          <div className="panel-sub" style={{ paddingTop: 14 }}>
            One mark per question, in the order you answered them. The block is the level it was
            aimed at; the line under it is right or wrong.
          </div>
        </>
      )}
    </div>
  );
}

export default function StudentDashboard() {
  const { account } = useAccount();
  const [dash, setDash] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [picked, setPicked] = useState('');
  // Bumped by the one button on the screen. A student refreshes this page the
  // moment they walk out of a session, and a re-read is the only thing on it
  // that could possibly have a new answer.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    api.dashboard().then(
      (res) => { if (!alive) return; setDash(res); setError(''); setBusy(false); },
      (err) => { if (!alive) return; setError(err.message); setBusy(false); },
    );
    return () => { alive = false; };
  }, [nonce]);

  const sessions = dash?.sessions ?? [];

  // Newest first off the server, so the default selection is the session they
  // just walked out of — the one they opened this page to see.
  const sel = useMemo(
    () => (sessions.length ? (sessions.find((s) => s.code === picked) ?? sessions[0]) : null),
    [sessions, picked],
  );

  // bloom is an array in taxonomy order; keyed here so a level that never came
  // back cannot silently shift the chart by one column.
  const byLevel = useMemo(() => {
    const map = Object.fromEntries(LEVELS.map((l) => [l, ZERO]));
    for (const row of dash?.bloom ?? []) if (map[row.level]) map[row.level] = row;
    return map;
  }, [dash]);

  const rollNo = dash?.rollNo ?? '';
  const professor = dash?.professor ?? null;

  /* --- first read ------------------------------------------------------- */
  if (!dash && busy) {
    return (
      <Frame account={account} rollNo="">
        {/* Shaped like what is coming: a title, four stat cards, the profile,
            the sessions panel. The word "loading" tells a student nothing they
            cannot already see. */}
        <div className="phead">
          <div className="txt">
            <div className="skel" style={{ height: 28, width: 210, borderRadius: 10 }} />
            <div className="skel" style={{ height: 13, width: 290, marginTop: 10, borderRadius: 8 }} />
          </div>
        </div>
        <div className="grid auto" style={{ marginBottom: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skel" style={{ height: 190, borderRadius: 'var(--r-card)' }} />
          ))}
        </div>
        <div className="skel" style={{ height: 260, borderRadius: 'var(--r-card)', marginBottom: 16 }} />
        <div className="skel" style={{ height: 300, borderRadius: 'var(--r-panel)' }} />
      </Frame>
    );
  }

  /* --- the server could not be asked ------------------------------------ */
  if (!dash) {
    return (
      <Frame account={account} rollNo="">
        <PageHead title="Your results" sub="Nothing could be read just now." />
        <Card>
          <Empty
            icon="alert"
            title="Your history did not come back"
            action={(
              <button type="button" className="btn pri" onClick={() => setNonce((n) => n + 1)}>
                <Icon name="refresh" size={13} />
                Try again
              </button>
            )}
          >
            The server said “{error || 'nothing at all'}”. Nothing is lost — everything you have
            answered is stored against your roll number, not in this page.
          </Empty>
        </Card>
      </Frame>
    );
  }

  /* --- somebody else's dashboard ---------------------------------------- */
  // /api/dashboard answers in the shape of whoever is holding the token, so a
  // professor who types /me gets their own payload rendered by a screen that
  // does not know its fields. Say so rather than drawing an empty student.
  if (dash.role && dash.role !== 'student') {
    return (
      <Frame account={account} rollNo="">
        <PageHead title="Your results" sub="This screen shows one student's own history." />
        <Card>
          <Empty
            icon="shield"
            title={`You are signed in as a ${dash.role}`}
            action={(
              <Link className="btn pri" to={HOME_FOR[dash.role] ?? '/'}>
                Go to your own dashboard
                <Icon name="forward" size={13} />
              </Link>
            )}
          >
            The dashboard route is shaped by your account rather than by the address, so it answered
            with the {dash.role} view. That one has everything this page is missing.
          </Empty>
        </Card>
      </Frame>
    );
  }

  const counts = dash.counts ?? { sessions: 0, answered: 0, correct: 0, accuracy: null };
  const department = dash.department || '';

  /* --- no roll number on the account ------------------------------------ */
  // The join is on roll number because a live room has no accounts in it — the
  // number typed on the phone is the only thing tying a signed-in student to
  // the marks they earned. Without it there is nothing to look up, and saying
  // "no sessions" would be a lie about their attendance.
  if (dash.reason) {
    return (
      <Frame account={account} rollNo="">
        <PageHead
          title="Your results"
          sub={professor ? `${professor.fullName}${department ? ` · ${department}` : ''}` : department}
          aside={<span className="flag"><Icon name="key" size={11} />No roll number</span>}
          // The likeliest next event on this screen is the professor adding the
          // number while the student is still looking at it, so the way to see
          // that has to be here rather than only on the state after it.
          actions={(
            <button type="button" className="btn sm" onClick={() => setNonce((n) => n + 1)} disabled={busy}>
              {busy ? <span className="spin" /> : <Icon name="refresh" size={13} />}
              {busy ? 'Reading…' : 'Check again'}
            </button>
          )}
        />

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <span className="t">Why this is empty</span>
            <span className="panel-sub">A live room knows you by roll number, not by your account.</span>
          </div>

          <div className="accent">
            <div className="k">BloomLoop said</div>
            {/* The server's own sentence, verbatim. It is the one explanation
                that cannot drift out of step with the rule that produced it. */}
            <div className="said" style={{ marginTop: 10 }}>
              <span style={{ color: 'var(--on-d)', fontSize: 14.5 }}>{dash.reason}</span>
            </div>

            <div className="tiles" style={{ marginTop: 18 }}>
              <div className="accent-tile">
                <b>Not set<Icon name="key" size={11} /></b>
                <span>Your roll number</span>
              </div>
              <div className="accent-tile">
                <b>{professor?.fullName ?? 'Not linked'}</b>
                <span>{professor ? 'Can add it for you' : 'No professor on your account'}</span>
              </div>
              <div className="accent-tile">
                <b>{department || '—'}</b>
                <span>Department</span>
              </div>
            </div>
          </div>
        </div>

        <Card>
          <Empty
            icon="broadcast"
            title="Today's session still works"
            action={(
              <Link className="btn pri" to="/join">
                Join a room
                <Icon name="forward" size={13} />
              </Link>
            )}
          >
            The room asks for your roll number on the phone, so nothing stops you sitting the next
            session. It is only this history that needs the number on your account, so it can find
            you again afterwards.
          </Empty>
        </Card>
      </Frame>
    );
  }

  /* --- a roll number, but nothing sat yet -------------------------------- */
  if (sessions.length === 0) {
    return (
      <Frame account={account} rollNo={rollNo}>
        <PageHead
          title="Your results"
          sub={(
            <>
              Roll <span className="mono">{rollNo}</span>
              {professor ? ` · ${professor.fullName}` : ' · no professor linked'}
              {department ? ` · ${department}` : ''}
            </>
          )}
          actions={(
            <button type="button" className="btn sm" onClick={() => setNonce((n) => n + 1)} disabled={busy}>
              {busy ? <span className="spin" /> : <Icon name="refresh" size={13} />}
              {busy ? 'Reading…' : 'Refresh'}
            </button>
          )}
        />

        <Card style={{ marginBottom: 16 }}>
          <Empty
            icon="broadcast"
            title="Nothing here yet"
            action={(
              <Link className="btn pri" to="/join">
                Join a room
                <Icon name="forward" size={13} />
              </Link>
            )}
          >
            Your professor puts a six-character code on the board at the start of class. Type it with
            your roll number <b className="mono">{rollNo}</b> and everything you answer lands on this
            page by the time you are out of the room.
          </Empty>
        </Card>

        {/* Not decoration: these six words organise every screen behind this
            one, and a student who has never sat a session has never been told
            what the product is measuring. */}
        <div className="panel">
          <div className="panel-head">
            <span className="t">What lands here</span>
            <span className="panel-sub">One row per session, and your shape across the six levels.</span>
          </div>
          <div className="row" style={{ gap: 6, padding: '0 6px' }}>
            {LEVELS.map((level) => (
              <span key={level} className={`tag sm ${level}`}>{LABEL[level]}</span>
            ))}
          </div>
          <div className="said" style={{ marginTop: 16, padding: '0 6px' }}>
            <span style={{ color: 'var(--on-d-2)' }}>
              Every question you are asked is tagged to exactly one of these. Answer a few right and
              the next ones step up; miss a few and they step back down. That is the whole rule, and
              it runs per student — you are never compared to the rest of the class.
            </span>
          </div>
        </div>
      </Frame>
    );
  }

  /* --- the dashboard ----------------------------------------------------- */
  const workingLevel = dash.workingLevel;
  // Oldest first for anything read as a trend, and only the last eight: nine
  // hairlines in a 230px stat tail stop being a shape. Each bar keeps its true
  // ordinal rather than its position in the tail, so a student on their twelfth
  // session reads 5..12 instead of being told they have sat eight.
  const trend = sessions
    .map((s, i) => ({ ...s, ordinal: sessions.length - i }))
    .reverse()
    .slice(-8);
  const wrong = Math.max(0, counts.answered - counts.correct);
  const selHistory = Array.isArray(sel?.history) ? sel.history : [];

  return (
    <Frame account={account} rollNo={rollNo}>
      <PageHead
        title="Your results"
        sub={(
          <>
            Roll <span className="mono">{rollNo}</span>
            {professor ? ` · ${professor.fullName}` : ' · no professor linked'}
            {department ? ` · ${department}` : ''}
          </>
        )}
        aside={dash.banded ? <span className="flag"><Icon name="info" size={11} />Support band</span> : null}
        actions={(
          <button type="button" className="btn sm" onClick={() => setNonce((n) => n + 1)} disabled={busy}>
            {busy ? <span className="spin" /> : <Icon name="refresh" size={13} />}
            {busy ? 'Reading…' : 'Refresh'}
          </button>
        )}
      />

      {error && (
        <div className="note warn" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>That refresh did not come back ({error}), so this is the last answer the server gave.</span>
        </div>
      )}

      <div className="grid auto" style={{ marginBottom: 16 }}>
        <Stat
          label="Working level"
          icon="layers"
          value={
            workingLevel
              ? <span className={`tag lg ${workingLevel}`}>{LABEL[workingLevel] ?? workingLevel}</span>
              : '—'
          }
          delta={dash.banded
            ? 'support band — Remember and Understand only'
            : 'where your next set starts'}
          tail={(
            <TailBars
              bars={LEVELS.map((l) => ({
                label: LABEL[l].slice(0, 3),
                value: (byLevel[l] ?? ZERO).seen,
                on: l === workingLevel,
              }))}
            />
          )}
        />
        <Stat
          label="Overall accuracy"
          icon="activity"
          // The server's own figure: the mean of each session's accuracy, not of
          // every answer, so one long session cannot drown out three short ones.
          value={percent(counts.accuracy)}
          delta={`mean of your ${counts.sessions} session${counts.sessions === 1 ? '' : 's'}, oldest left`}
          tail={(
            <TailBars
              bars={trend.map((s) => ({
                label: String(s.ordinal),
                value: Math.round((s.accuracy ?? 0) * 100),
                on: s.code === sel?.code,
              }))}
            />
          )}
        />
        <Stat
          label="Sessions taken"
          icon="calendar"
          value={counts.sessions}
          delta={`most recent ${day(sessions[0]?.startedAt)}`}
          tail={(
            <TailBars
              bars={trend.map((s) => ({
                label: String(s.ordinal),
                value: s.answered ?? 0,
                on: s.code === sel?.code,
              }))}
            />
          )}
        />
        <Stat
          label="Questions answered"
          icon="checkCircle"
          value={counts.answered}
          delta={`${counts.correct} right, ${wrong} wrong — bars are where the right ones were`}
          tail={(
            <TailBars
              bars={LEVELS.map((l) => ({
                label: LABEL[l].slice(0, 3),
                value: (byLevel[l] ?? ZERO).correct,
                on: false,
              }))}
            />
          )}
        />
      </div>

      <Card className="pad-lg" style={{ marginBottom: 16 }}>
        <div className="cardhead">
          {/* .cardhead h2 is flex:1 with min-width:0, so on a phone the title
              shrinks to a one-word column instead of pushing the caption onto
              its own line. This is the width below which it must wrap. */}
          <h2 style={{ minWidth: 'min(100%, 270px)' }}>Your shape across the six levels</h2>
          <span className="sub">lime marks the level you are working at right now</span>
        </div>
        <BloomProfile byLevel={byLevel} workingLevel={workingLevel} />
        <div className="said" style={{ marginTop: 20 }}>
          <span>
            Each bar is how often you were right at that level, across every session you have sat —
            not how many questions you saw. A short bar next to a big count is a level worth another
            run at; a column with no bar at all is one you have not been asked about yet.
          </span>
        </div>
      </Card>

      <div className="panel">
        <div className="panel-head">
          <span className="t">Your sessions</span>
          <span className="panel-sub">
            {sessions.length} session{sessions.length === 1 ? '' : 's'} · newest first · pick one to
            see the answers behind it
          </span>
        </div>

        {sel && (
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 12, marginBottom: 14,
            }}
          >
            <div className="accent">
              <div className="k">Selected session</div>
              <div className="row" style={{ gap: 10, marginTop: 7 }}>
                <span style={{ font: '800 19px/1.25 var(--sans)', letterSpacing: '-0.02em' }}>
                  {sel.title || 'Untitled session'}
                </span>
                <span className="k mono">{sel.code}</span>
              </div>
              <div className="k" style={{ marginTop: 7 }}>
                {dayTime(sel.startedAt)}
                {sel.status ? ` · room ${sel.status === 'closed' ? 'closed' : 'still open'}` : ''}
              </div>

              <div className="tiles" style={{ marginTop: 18 }}>
                <div className="accent-tile">
                  <b>{percent(sel.accuracy)}<Icon name="activity" size={11} /></b>
                  <span>Your accuracy</span>
                </div>
                <div className="accent-tile">
                  <b>{LABEL[sel.workingLevel] ?? '—'}</b>
                  <span>Where you finished</span>
                </div>
                <div className="accent-tile">
                  <b>{sel.answered ?? 0}<Icon name="check" size={11} /></b>
                  <span>{sel.correct ?? 0} of them right</span>
                </div>
                <div className="accent-tile">
                  <b>
                    {sel.banded ? 'Support' : 'On track'}
                    <Icon name={sel.banded ? 'info' : 'checkCircle'} size={11} />
                  </b>
                  <span>Below-40% band</span>
                </div>
              </div>
            </div>

            <Trail history={selHistory} />
          </div>
        )}

        {sessions.map((s) => {
          const on = sel?.code === s.code;
          return (
            <button
              key={s.code}
              type="button"
              className="d-row"
              aria-selected={on}
              onClick={() => setPicked(s.code)}
              // A row that cannot fit its band flag drops it to a second line
              // rather than crushing the title into a two-word column, which is
              // what a phone did to every session a student was banded in.
              style={{ flexWrap: 'wrap' }}
            >
              {/* Soft on the selected row only: a solid level chip is drawn in
                  the ramp's own violet and the selected row is filled with
                  brand, so Apply and Analyse both vanished into it. */}
              <span className={`tag sm ${on ? 'soft ' : ''}${s.workingLevel}`}>
                {LABEL[s.workingLevel] ?? s.workingLevel}
              </span>
              {/* No nested spans in .t: `.d-row .t span` is a block rule and it
                  catches descendants, so a second span breaks the line in two. */}
              {/* min-width overrides `.d-row .t { min-width: 0 }`: without a
                  floor the title absorbs every squeeze and nothing ever wraps. */}
              <span className="t" style={{ minWidth: 120 }}>
                <b>{s.title || 'Untitled session'}</b>
                <span>{day(s.startedAt)} · {s.answered ?? 0} answered · {s.code}</span>
              </span>
              {s.banded && <span className="flag">support band</span>}
              <span className="nowrap" style={{ font: '700 13px/1 var(--mono)', marginLeft: 'auto' }}>
                {percent(s.accuracy)}
              </span>
            </button>
          );
        })}
      </div>

      {dash.banded && (
        <div className="said" style={{ marginTop: 16 }}>
          <span>
            You are inside the below-40% band, so your sets stay at Remember and Understand until it
            lifts. That is a shorter ladder for a while, not a lower mark — and only your professor
            sees it.
          </span>
        </div>
      )}

      <div className="said" style={{ marginTop: 16 }}>
        <span>
          Nothing on this page can be edited, by you or by anyone reading it. These levels are
          written by the sessions you sit, so the only way to move one is to sit another.
        </span>
      </div>
    </Frame>
  );
}
