/**
 * The teacher console: four steps over one chapter.
 *
 *   content  read a deck or a syllabus, pick the topics
 *   bank     plan and write the questions, then curate them
 *   session  open a room and put its code on the projector
 *   live     watch the class
 *
 * This file owns what those steps share - the chapter, the bank, the room -
 * and the address bar, so a reload or a pasted link lands on the same step of
 * the same chapter in the same room. The steps themselves own their screens.
 */

import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { api, teacherKey } from '../lib/api.js';
import { signOut, useAccount } from '../lib/auth.js';
import { HOME_FOR, ROLE_LABEL } from '../lib/routes.js';
import AppShell from '../shell/AppShell.jsx';
import { Button, Chip, Empty, Note, Tip } from '../ui/index.jsx';
import Bank from './Bank.jsx';
import Gate from './Gate.jsx';
import Live from './Live.jsx';
import Material from './Material.jsx';
import Projector from './Projector.jsx';
import Room from './Room.jsx';

const STEPS = [
  { id: 'content', label: 'Material', icon: 'material', why: null },
  { id: 'bank', label: 'Questions', icon: 'bank', why: 'Read a chapter first. Questions are written from it.' },
  { id: 'session', label: 'Room', icon: 'room', why: 'Write a question bank before opening a room.' },
  { id: 'live', label: 'Class', icon: 'live', why: 'Open a room to watch the class.' },
];
const STEP_IDS = STEPS.map((s) => s.id);

/** The rest of the product, for the two roles that have an account behind them. */
const ACCOUNT_NAV = {
  hod: [{ id: 'dashboard', label: 'Department', icon: 'building' }],
  professor: [{ id: 'dashboard', label: 'Overview', icon: 'dashboard' }],
};
const SHARED_NAV = [
  { id: 'rooms', label: 'Rooms', icon: 'rooms' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
];

function Restoring() {
  return (
    <div className="stack stack-5" aria-busy="true">
      <div className="stack stack-2">
        <div className="skel" style={{ height: 32, width: 280 }} />
        <div className="skel" style={{ height: 16, width: 420, maxWidth: '100%' }} />
      </div>
      <div className="skel" style={{ height: 360, borderRadius: 'var(--r-3)' }} />
    </div>
  );
}

export default function TeachApp() {
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

  // What the address bar asked for when the page opened. Read once: after that
  // the console writes the address, it does not follow it.
  const [openedWith] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      code: (params.get('session') ?? '').trim().toUpperCase(),
      contentId: (params.get('content') ?? '').trim(),
      view: (params.get('view') ?? '').trim(),
    };
  });
  const [restoring, setRestoring] = useState(() => Boolean(openedWith.code || openedWith.contentId || openedWith.view));
  const [lost, setLost] = useState(null);
  const [restoreNote, setRestoreNote] = useState('');

  // A signed-in student is sent to their own page, stored key or not. The server
  // refuses their token on every teacher route anyway; this keeps them from
  // landing on a console that can only fail. Not open, so nothing below fetches.
  const student = account?.role === 'student';
  const open = !student && (unlocked || Boolean(account));

  useEffect(() => {
    let alive = true;
    api.health().then(
      (res) => { if (alive) { setHealth(res); setHealthError(''); } },
      (err) => { if (alive) setHealthError(err.message); },
    );
    return () => { alive = false; };
  }, [open, lost]);

  // A chapter picked from the library arrives without its bank.
  useEffect(() => {
    const id = content?.contentId;
    if (!id || bank) return undefined;
    let alive = true;
    api.getBank(id).then((res) => { if (alive && res.questions?.length) setBank(res); }, () => {});
    return () => { alive = false; };
  }, [content?.contentId, bank]);

  // Put the console back the way the link describes it.
  useEffect(() => {
    if (!open || !restoring) return undefined;
    let alive = true;
    setRestoreNote('');

    (async () => {
      const [room, chapter, banked] = await Promise.all([
        openedWith.code ? api.getSession(openedWith.code).catch((err) => err) : null,
        openedWith.contentId ? api.getContent(openedWith.contentId).catch((err) => err) : null,
        openedWith.contentId ? api.getBank(openedWith.contentId).catch(() => null) : null,
      ]);
      if (!alive) return;

      let reopened = null;
      let gone = null;
      if (room instanceof Error) {
        const missing = room.status === 404;
        gone = {
          code: openedWith.code,
          retry: !missing,
          title: missing ? `Room ${openedWith.code} is not there any more` : `Room ${openedWith.code} could not be reopened`,
          message: missing
            ? 'It was deleted, or the code in this link was never a room. Deleting a room takes its results with it, so there is nothing left to reopen.'
            : `The server answered: ${room.message}.`,
        };
      } else if (room?.session) {
        reopened = { code: room.session.code, bankCount: room.bankCount, title: room.content?.title || room.session.title };
        setSession(reopened);
        setClosed(room.session.status === 'closed');
      }

      const loaded = chapter && !(chapter instanceof Error) ? (chapter.content ?? chapter) : null;
      if (loaded) {
        setContent({ contentId: loaded._id, title: loaded.title, kind: loaded.kind, topics: loaded.topics ?? [] });
        setSelected(Array.isArray(loaded.topics) ? loaded.topics : []);
        if (banked?.questions?.length) setBank(banked);
      } else if (chapter instanceof Error) {
        setRestoreNote(
          `The chapter this link was opened on could not be loaded back: ${chapter.message}. `
          + 'Nothing has been lost. The material and its questions are on the server; load the chapter again from Material to go on editing them.',
        );
      }

      const finished = Boolean(reopened) && room.session.status === 'closed';
      const reachable = {
        content: true,
        bank: Boolean(loaded),
        session: finished ? false : Boolean(reopened) || (banked?.active ?? 0) > 0,
        live: Boolean(reopened),
      };
      const wanted = STEP_IDS.includes(openedWith.view) ? openedWith.view : null;
      const fallback = reopened ? 'live' : loaded ? 'bank' : 'content';
      setView(wanted && reachable[wanted] ? wanted : fallback);

      setLost(gone);
      setRestoring(false);
    })();

    return () => { alive = false; };
  }, [open, restoring, openedWith]);

  // Keep the address in step with the console.
  useEffect(() => {
    if (!open || restoring) return;
    const next = new URLSearchParams(window.location.search);
    const put = (k, v) => (v ? next.set(k, v) : next.delete(k));
    put('session', lost ? '' : session?.code ?? '');
    put('content', content?.contentId ?? '');
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

  if (student) return <Navigate to={HOME_FOR.student} replace />;
  if (!open) return <Gate onUnlock={(v) => { teacherKey.set(v); setUnlocked(true); }} />;

  const questions = bank?.questions ?? [];
  const activeCount = questions.filter((q) => q.status !== 'discarded').length;
  const reachable = {
    content: true,
    bank: Boolean(content),
    session: activeCount > 0 || Boolean(session),
    live: Boolean(session),
  };

  const onSession = (s) => { setSession(s); setClosed(false); };

  // The projector takes the whole window: it is read from the back of a hall,
  // and nothing is allowed to compete with the code.
  if (view === 'session' && session && !closed) {
    return (
      <Projector
        session={session}
        content={content}
        activeCount={activeCount}
        onLive={() => setView('live')}
      />
    );
  }

  const role = account?.role;
  const nav = [
    ...(ACCOUNT_NAV[role] ?? []).map((n) => ({ ...n, group: 'account' })),
    ...(role ? SHARED_NAV.map((n) => ({ ...n, group: 'account' })) : []),
    ...STEPS.map((s) => ({ ...s, group: 'console', locked: !reachable[s.id] })),
  ];

  const go = (id) => {
    if (id === 'dashboard') navigate(HOME_FOR[role] ?? '/');
    else if (id === 'rooms') navigate('/rooms');
    else if (id === 'analytics') navigate('/analytics');
    else setView(id);
  };

  return (
    <AppShell
      crumb={
        session
          ? <><span className="mono strong">{session.code}</span><span className="clip">{session.title || content?.title}</span></>
          : content && <span className="clip">{content.title}</span>
      }
      status={
        <>
          {healthError && <Chip tone="bad" icon="alert">Server unreachable</Chip>}
          {health?.gemini === 'fallback' && (
            <Tip label="No Gemini key on the server, so questions come from the offline template writer. Do not present these as model output.">
              <Chip>Offline templates</Chip>
            </Tip>
          )}
          {health?.store === 'memory' && (
            <Tip label="No database connection. Everything is held in memory and is lost when the server restarts.">
              <Chip>Not saved</Chip>
            </Tip>
          )}
        </>
      }
      who={account ? { name: account.fullName || account.email || 'Teacher', sub: ROLE_LABEL[role] ?? role } : null}
      menu={[
        { id: 'profile', label: 'Profile and connections', icon: 'user', onSelect: () => navigate('/profile') },
        !account && { id: 'rooms', label: 'All rooms', icon: 'rooms', onSelect: () => navigate('/rooms') },
        'sep',
        account
          ? { id: 'out', label: 'Sign out', icon: 'logout', onSelect: () => signOut() }
          : { id: 'lock', label: 'Lock the console', icon: 'lock', onSelect: () => { teacherKey.set(''); setUnlocked(false); } },
      ]}
      nav={nav}
      current={view}
      onNav={go}
      width={view === 'live' ? 'wide' : undefined}
    >
      {(healthError || restoreNote || (closed && session)) && (
        <div className="stack stack-2" style={{ marginBottom: 24 }}>
          {healthError && <Note tone="bad">Server unreachable: {healthError}</Note>}
          {restoreNote && <Note>{restoreNote}</Note>}
          {closed && session && (
            <Note icon="lock">
              Room <b className="mono">{session.code}</b> is closed. What is below is its final standing, and it stays
              readable for as long as the room exists. A closed room cannot be reopened; to teach again, open a new
              room over the same chapter. <a className="link" href="/rooms">All rooms</a>
            </Note>
          )}
        </div>
      )}

      {restoring ? (
        <Restoring />
      ) : lost ? (
        <Empty
          icon="room"
          title={lost.title}
          action={
            <div className="cluster" style={{ justifyContent: 'center' }}>
              <a className="btn btn-primary" href="/rooms">See all rooms</a>
              {lost.retry && <Button icon="refresh" onClick={() => { setLost(null); setRestoring(true); }}>Try {lost.code} again</Button>}
              <Button variant="ghost" onClick={() => setLost(null)}>Start somewhere else</Button>
            </div>
          }
        >
          {lost.message} Every room you have opened is on the rooms screen, with its code, who joined and what they answered.
        </Empty>
      ) : (
        <>
          {view === 'content' && (
            <Material
              content={content}
              selected={selected}
              hasBank={activeCount > 0}
              onContent={handleContent}
              onSelected={setSelected}
              onNext={() => setView('bank')}
            />
          )}
          {view === 'bank' && (
            <Bank
              content={content}
              selected={selected}
              bank={bank}
              onBank={setBank}
              onBack={() => setView('content')}
              onNext={() => setView('session')}
            />
          )}
          {view === 'session' && (
            <Room
              content={content}
              activeCount={activeCount}
              onSession={onSession}
              onBack={() => setView('bank')}
            />
          )}
          {view === 'live' && session && (
            <Live
              code={session.code}
              title={session.title || content?.title}
              closed={closed}
              onClosed={() => setClosed(true)}
              onProjector={() => setView('session')}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
