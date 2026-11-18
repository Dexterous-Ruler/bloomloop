import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, teacherKey } from '../api.js';
import { useAccount, signOut, supabase } from '../auth.js';
import Icon from '../ui/Icon.jsx';
import Shell, { Avatar, Empty, Mark, NavPill } from '../ui/Shell.jsx';
import { HOME_FOR } from '../screens/SignIn.jsx';
import ContentView from './ContentView.jsx';
import BankView from './BankView.jsx';
import SessionView from './SessionView.jsx';
import LiveView from './LiveView.jsx';

const NAV = [
  { id: 'content', label: 'Material', why: null },
  { id: 'bank', label: 'Question bank', why: 'Upload or reuse a chapter first.' },
  { id: 'session', label: 'Room', why: 'Build a bank before opening a room.' },
  { id: 'live', label: 'Classroom', why: 'Open a room to watch the class.' },
];

/**
 * The four ids ?view= is allowed to name. A hand-typed or half-copied URL is
 * checked against this rather than trusted, so the console can never be asked
 * to render a step that does not exist.
 */
const STEPS = NAV.map((n) => n.id);

/**
 * The way back out, for the two roles that have somewhere to go back to. It is
 * an item on the console's own nav track rather than a second bar, so the trip
 * out and the trip back in are the same control in both directions.
 *
 * Absent on the shared-key path on purpose: a key is not an account, so there is
 * no dashboard behind it and a link to one would only ever bounce off /signin.
 * A student is absent too — they have no business in the console, and the route
 * that is theirs is reached from the room rather than from here.
 */
const DASHBOARD = {
  hod: { id: 'dashboard', label: 'Department' },
  professor: { id: 'dashboard', label: 'Overview' },
};

/**
 * The rest of the product, for the same two roles and for the same reason. They
 * ride with the dashboard entry rather than being listed separately, because
 * they are reachable on exactly the condition it is: an account. The key path
 * gets none of the three.
 *
 * "All rooms" and not "Rooms". The console's own third step is called Room and
 * would sit four items along the same track — one is the room being built, the
 * other is every room ever opened, and two labels a letter apart is a trap
 * whichever of the two you actually wanted.
 */
const ACCOUNT_NAV = [
  { id: 'rooms', label: 'All rooms' },
  { id: 'analytics', label: 'Analytics' },
];

/**
 * The console gate. Split screen: the product on the left in dark, one field on
 * the right. Two doors, because the demo path and the account path both have to
 * work — a build with no Supabase env vars still has to open with a key.
 */
function Unlock({ onUnlock }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="auth">
      <aside className="auth-aside">
        <div>
          <Mark className="lg on-d" />
          <h1>BloomLoop</h1>
          <p>
            Forty students, forty different papers. Every question aimed at the Bloom level that
            student has actually reached — and a live grid that shows you who moved.
          </p>
        </div>
        <div className="auth-foot">Teacher console · students never see this screen.</div>
      </aside>

      <main className="auth-main">
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (v) onUnlock(v);
          }}
        >
          <div className="eyebrow">Teacher console</div>
          <h1 style={{ marginTop: 14, fontSize: 34 }}>Unlock the console</h1>
          <p className="hint" style={{ marginTop: 10, fontSize: 13 }}>
            {supabase
              ? 'Signed-in professors can go straight to their account instead.'
              : 'The key is printed in the server window when BloomLoop starts.'}
          </p>

          <div className="field" style={{ marginTop: 26 }}>
            <label htmlFor="k">Teacher key</label>
            <input
              id="k"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              autoComplete="off"
              // No placeholder. An example value on this field is the real key
              // or it is useless, and the real key compiled into the bundle is
              // readable by every visitor in devtools - which is exactly what
              // happened: it shipped, and it unlocked the console for anyone
              // who opened the page and looked.
              style={{ fontFamily: 'var(--mono)', letterSpacing: '0.12em', fontWeight: 600 }}
            />
          </div>

          <button type="submit" className="btn pri lg block" disabled={!draft.trim()}>
            Unlock console
            <Icon name="forward" size={13} />
          </button>

          {supabase && (
            <a className="btn block" href="/signin" style={{ marginTop: 10 }}>
              <Icon name="user" size={13} />
              Sign in with your BloomLoop account
            </a>
          )}

          <div style={{ marginTop: 26, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
            <div className="said">
              <span>
                Students never need this key — they join a live room with a 6-character code and
                their roll number.{' '}
                <a href="/join" style={{ fontWeight: 700, textDecoration: 'underline' }}>
                  I&apos;m a student, take me to the room →
                </a>
              </span>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}

/**
 * The console while the address bar is being turned back into a screen.
 *
 * Shaped like what is coming — a page head, a row of counters, a working panel —
 * so nothing jumps when the real step swaps in. It says nothing, because the
 * word "loading" is a slower way of showing exactly this, and because a teacher
 * reloading mid-class does not need to be told the machine is busy.
 */
function Restoring() {
  return (
    <>
      <div className="phead">
        <div className="txt">
          <div className="skel" style={{ height: 28, width: 210, borderRadius: 9 }} />
          <div className="skel" style={{ height: 12, width: 320, borderRadius: 6, marginTop: 11 }} />
        </div>
      </div>
      <div className="grid auto" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel" style={{ height: 182, borderRadius: 'var(--r-card)' }} />
        ))}
      </div>
      <div className="skel" style={{ height: 320, borderRadius: 'var(--r-panel)' }} />
    </>
  );
}

/**
 * The room named in ?session= is not there to go back to.
 *
 * A teacher reaches this by reopening yesterday's link to a room that has since
 * been deleted, or by opening a link whose code was mistyped on the way. Before
 * this the console swallowed the failure: it left the teacher on Material with a
 * red line quoting a fetch, and never mentioned the one screen that knows every
 * room they have and which of them are still running. That screen is the whole
 * answer to "which room was I in", so here it is the primary button.
 */
function LostRoom({ lost, onRetry, onDismiss }) {
  return (
    <Empty
      icon="broadcast"
      title={lost.title}
      action={
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <a className="btn pri" href="/rooms">
            <Icon name="grid" size={13} />
            See all your rooms
          </a>
          {lost.retry && (
            <button type="button" className="btn" onClick={onRetry}>
              <Icon name="refresh" size={13} />
              Try {lost.code} again
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onDismiss}>
            Start somewhere else
          </button>
        </div>
      }
    >
      {lost.message} Every room you have ever opened is listed on the rooms screen — live, paused
      and closed — with its code, who joined it and what they answered.
    </Empty>
  );
}

export default function TeacherApp() {
  const navigate = useNavigate();
  const { account } = useAccount();
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [unlocked, setUnlocked] = useState(Boolean(teacherKey.get()));

  const [view, setView] = useState('content');
  const [content, setContent] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bank, setBank] = useState(null);
  const [session, setSession] = useState(null);
  const [closed, setClosed] = useState(false);

  /**
   * What the address bar said when this tab opened, read exactly once.
   *
   * Everything after this the console writes itself, and a restore that kept
   * re-reading the bar would be racing its own writer. Reading it here rather
   * than out of localStorage is the point of the whole mechanism: a copy of the
   * console's position in storage survives the room being paused, closed or
   * deleted from another machine, and the console would then confidently reopen
   * something that no longer exists. Ids in a URL are a question; the server
   * answers it fresh every time.
   */
  const [openedWith] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      code: (params.get('session') ?? '').trim().toUpperCase(),
      contentId: (params.get('content') ?? '').trim(),
      view: (params.get('view') ?? '').trim(),
    };
  });
  const [restoring, setRestoring] = useState(
    () => Boolean(openedWith.code || openedWith.contentId || openedWith.view),
  );
  // The room in ?session= could not be reopened, as { code, title, message, retry }.
  const [lost, setLost] = useState(null);
  // Something else in the URL could not be brought back — said plainly rather
  // than left as a step that is mysteriously empty.
  const [restoreNote, setRestoreNote] = useState('');

  // A signed-in professor has already proved who they are; the key gate would be
  // a second lock on the same door.
  const open = unlocked || Boolean(account);

  // Re-probed whenever a room is lost or found again. A restore that fails
  // because the server is down leaves "Server unreachable" in the top bar, and
  // that flag is read once and then never again — so the teacher who pressed Try
  // again, and got through, was still being told the server was gone.
  useEffect(() => {
    let alive = true;
    api.health().then(
      (res) => alive && (setHealth(res), setHealthError('')),
      (err) => alive && setHealthError(err.message),
    );
    return () => { alive = false; };
  }, [open, lost]);

  // Whatever content is loaded, pull the bank it already has. Reusing a chapter
  // is the demo's fallback path, and without this it looked bankless and pushed
  // the teacher into regenerating questions they had already paid for.
  useEffect(() => {
    const id = content?.contentId;
    if (!id || bank) return undefined;
    let alive = true;
    api.getBank(id).then(
      (res) => { if (alive && res.questions?.length) setBank(res); },
      () => {},
    );
    return () => { alive = false; };
  }, [content?.contentId, bank]);

  /**
   * The whole of the teacher's recovery: the URL, put back.
   *
   * ?session= reopens the room, ?content= reloads the chapter and its bank, and
   * ?view= decides which of the four steps they land on. Before this only the
   * room came back, so a teacher whose tab died mid-class was returned to step
   * one with the class already running: the chapter they had loaded and the step
   * they were on were simply gone, and the only way back was to walk the upload
   * flow again in front of forty students.
   *
   * All three reads go out together and none of them can take the others down.
   * The room is the one that matters most — a chapter that will not load is a
   * nuisance, a room that will not load is a class with nobody watching it.
   */
  useEffect(() => {
    if (!open || !restoring) return undefined;
    let alive = true;
    // Whatever the last attempt could not bring back, it is being tried again
    // now. Leaving the sentence up would let a retry that worked sit under a
    // complaint about the attempt before it.
    setRestoreNote('');

    (async () => {
      const [room, chapter, banked] = await Promise.all([
        openedWith.code ? api.getSession(openedWith.code).catch((err) => err) : null,
        openedWith.contentId ? api.getContent(openedWith.contentId).catch((err) => err) : null,
        // The bank is fetched here rather than left to the effect above, because
        // the landing step is decided from how many questions are actually in it
        // — deciding first and reading after lands a teacher with a full bank on
        // the "no questions to run" screen.
        openedWith.contentId ? api.getBank(openedWith.contentId).catch(() => null) : null,
      ]);
      if (!alive) return;

      let reopened = null;
      let gone = null;
      if (room instanceof Error) {
        // 404 is a room that was deleted or a code that was never one. Anything
        // else is the server not answering, which is a different sentence and
        // the only one of the two worth offering a retry for.
        const missing = room.status === 404;
        gone = {
          code: openedWith.code,
          retry: !missing,
          title: missing
            ? `Room ${openedWith.code} is not there any more`
            : `Room ${openedWith.code} could not be reopened`,
          message: missing
            ? 'It was deleted, or the code in this link was never a room. Deleting a room takes its results with it, so there is nothing left to reopen.'
            : `The server answered: ${room.message}.`,
        };
      } else if (room?.session) {
        reopened = {
          code: room.session.code,
          bankCount: room.bankCount,
          title: room.content?.title || room.session.title,
        };
        setSession(reopened);
        setClosed(room.session.status === 'closed');
      }

      const loaded = chapter && !(chapter instanceof Error) ? (chapter.content ?? chapter) : null;
      if (loaded) {
        // Set piece by piece rather than through handleContent: that one clears
        // the bank whenever the chapter changes, which is right when a teacher
        // swaps material and wrong here, where the bank is arriving in the same
        // breath as the chapter it belongs to.
        setContent({
          contentId: loaded._id,
          title: loaded.title,
          kind: loaded.kind,
          topics: loaded.topics ?? [],
        });
        setSelected(Array.isArray(loaded.topics) ? loaded.topics : []);
        if (banked?.questions?.length) setBank(banked);
      } else if (chapter instanceof Error) {
        setRestoreNote(
          `The chapter this link was opened on could not be loaded back: ${chapter.message}. `
          + 'Nothing has been lost — the material and its bank are on the server. Load it again from '
          + 'step one to go on editing them.',
        );
      }

      // Which steps are real, now that the answers are in. A step the URL names
      // but nothing supports is not worth a red banner — the console lands on
      // the furthest step it can honestly show and says nothing about it.
      const finished = Boolean(reopened) && room.session.status === 'closed';
      const reachable = {
        content: true,
        bank: Boolean(loaded),
        // A closed room has nothing to put on a projector: its code is dead and
        // every phone that read it off the wall would be turned away. The final
        // grid is what is left of it, so that is where such a link lands.
        session: finished ? false : Boolean(reopened) || (banked?.active ?? 0) > 0,
        live: Boolean(reopened),
      };
      const wanted = STEPS.includes(openedWith.view) ? openedWith.view : null;
      const fallback = reopened ? 'live' : loaded ? 'bank' : 'content';
      setView(wanted && reachable[wanted] ? wanted : fallback);

      setLost(gone);
      setRestoring(false);
    })();

    return () => { alive = false; };
  }, [open, restoring, openedWith]);

  /**
   * The console's position, written back into the address bar as it moves.
   *
   * A URL is the one piece of state a browser restores by itself. It survives
   * the tab being closed, it survives the machine falling over, and it can be
   * read down the phone or pasted into the second laptop wired to the projector
   * — none of which is true of anything held in this component or in storage.
   *
   * Only ids travel. What they name is read back from the server, so a link
   * carrying a room that has since been closed shows a closed room rather than
   * the room as this tab last remembered it.
   *
   * replace, not push: walking the four steps is not navigating, and a Back
   * button that stepped back through Material → bank → room mid-class would be
   * a trap laid in front of a class.
   */
  useEffect(() => {
    if (!open || restoring) return;
    const next = new URLSearchParams(window.location.search);
    const put = (k, v) => (v ? next.set(k, v) : next.delete(k));
    // A room that could not be reopened is not where the console is, so it does
    // not stay in the bar — a reload would only walk into the same dead end.
    put('session', lost ? '' : session?.code ?? '');
    put('content', content?.contentId ?? '');
    // Material is the first step and the default, so naming it would make a bare
    // "/" look like a URL that had lost something.
    put('view', view === 'content' ? '' : view);
    const search = next.toString();
    if (search === window.location.search.replace(/^\?/, '')) return;
    navigate({ search: search ? `?${search}` : '' }, { replace: true });
  }, [open, restoring, lost, view, session?.code, content?.contentId, navigate]);

  const handleContent = useCallback((next) => {
    setContent((prev) => {
      if (!prev || prev.contentId !== next.contentId) {
        setBank(null);
        setSelected(Array.isArray(next.topics) ? next.topics : []);
      }
      return next;
    });
  }, []);

  if (!open) {
    return <Unlock onUnlock={(v) => { teacherKey.set(v); setUnlocked(true); }} />;
  }

  const questions = bank?.questions ?? [];
  const activeCount = questions.filter((q) => q.status !== 'discarded').length;
  // Room stays reachable once one is open even with no content loaded: after a
  // mid-class reload the teacher's first need is the code back on the projector,
  // not the upload step.
  const enabled = {
    content: true,
    bank: Boolean(content),
    session: activeCount > 0 || Boolean(session),
    live: Boolean(session),
  };

  const usingTemplates = health?.gemini === 'fallback';
  const usingMemory = health?.store === 'memory';

  // Prepended rather than appended: it is the step before Material, not after
  // Classroom, and the console's four steps have to stay in their own order.
  const back = DASHBOARD[account?.role];
  const items = NAV.map((n) => ({ ...n, disabled: !enabled[n.id] }));
  if (back) items.unshift(back, ...ACCOUNT_NAV);

  // The projector screen takes over the whole frame — it is read from thirty
  // feet, so no chrome is allowed to compete with the room code.
  if (view === 'session' && session) {
    return (
      <SessionView
        content={content}
        activeCount={activeCount}
        session={session}
        onSession={(s) => { setSession(s); setClosed(false); }}
        onLive={() => setView('live')}
        onBack={() => setView('bank')}
      />
    );
  }

  return (
    <Shell
      badge={
        session ? (
          <span className="barcount mono" title="Live room code">{session.code}</span>
        ) : (
          content && <span className="barcount">{content.title}</span>
        )
      }
      nav={
        <NavPill
          items={items}
          value={view}
          onChange={(id) => {
            // Three of these leave the console and four move within it.
            if (id === 'dashboard') navigate(HOME_FOR[account?.role] ?? '/');
            else if (id === 'rooms') navigate('/rooms');
            else if (id === 'analytics') navigate('/analytics');
            else setView(id);
          }}
        />
      }
      right={
        <>
          {healthError && <span className="flag bad"><Icon name="alert" size={11} /> Server unreachable</span>}
          {usingTemplates && (
            <span className="flag" title="No Gemini key on the server, so items come from the offline template writer. Do not present these as live AI.">
              Offline templates
            </span>
          )}
          {usingMemory && (
            <span className="flag" title="No database connection: everything is in memory and is lost on restart.">
              Not persisted
            </span>
          )}
          {account ? (
            <>
              <span className="flag neutral" title={`${account.role} · ${account.code ?? ''}`}>
                {account.code ?? account.role}
              </span>
              <Avatar name={account.fullName || account.email || 'Teacher'} href="/profile" />
              <button type="button" className="iconbtn" title="Sign out" onClick={() => signOut()}>
                <Icon name="logout" />
              </button>
            </>
          ) : (
            <>
              {/* The key path has no avatar to click, but it still has a
                  profile worth reading - it is where "this is a shared key, not
                  an account" is said, and where Google Classroom is connected. */}
              <a className="iconbtn" href="/profile" title="Profile and connections">
                <Icon name="user" />
              </a>
              <button
                type="button"
                className="iconbtn"
                title="Lock the console"
                onClick={() => { teacherKey.set(''); setUnlocked(false); }}
              >
                <Icon name="lock" />
              </button>
            </>
          )}
        </>
      }
    >
      {healthError && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          <span>Server unreachable: {healthError}</span>
        </div>
      )}

      {restoreNote && (
        <div className="note warn" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          <span>{restoreNote}</span>
        </div>
      )}

      {/* A closed room still opens here on purpose — the rooms screen sends
          teachers to this exact URL to read a final grid. What it must never do
          is look live, so the room says out loud that it is finished and points
          at the screen that has the ones that are not. */}
      {closed && session && (
        <div className="note warn" style={{ marginBottom: 16 }}>
          <Icon name="lock" size={15} />
          <span>
            Room <b className="mono">{session.code}</b> is closed, so nothing new will arrive in the
            grid below — it is the final standing and it stays readable for as long as the room
            exists. A closed room cannot be reopened by anyone; the way back in front of a class is
            a new room over the same chapter.{' '}
            <a href="/rooms" style={{ fontWeight: 700, textDecoration: 'underline' }}>
              All your rooms →
            </a>
          </span>
        </div>
      )}

      {/* Three exclusive bodies. The console is either being put back together,
          or holding a link to a room that is gone, or showing a step. */}
      {restoring ? (
        <Restoring />
      ) : lost ? (
        <LostRoom
          lost={lost}
          // Retry re-runs the same restore against the same ids, because the
          // failure it offers on is the server not answering — which is usually
          // over by the time a human has read the sentence.
          onRetry={() => { setLost(null); setRestoring(true); }}
          onDismiss={() => setLost(null)}
        />
      ) : (
        <>
          {view === 'content' && (
            <ContentView
              content={content}
              selected={selected}
              onContent={handleContent}
              onSelected={setSelected}
              onNext={() => setView('bank')}
            />
          )}

          {view === 'bank' && (
            <BankView
              content={content}
              selected={selected}
              bank={bank}
              onBank={setBank}
              onNext={() => setView('session')}
            />
          )}

          {view === 'session' && !session && (
            <SessionView
              content={content}
              activeCount={activeCount}
              session={null}
              onSession={(s) => { setSession(s); setClosed(false); }}
              onLive={() => setView('live')}
              onBack={() => setView('bank')}
            />
          )}

          {view === 'live' && session && (
            <LiveView
              code={session.code}
              title={session.title || content?.title}
              closed={closed}
              onClosed={() => setClosed(true)}
              onProjector={() => setView('session')}
            />
          )}
        </>
      )}
    </Shell>
  );
}
