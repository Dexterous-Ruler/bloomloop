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
import { useOutboxOwner } from '../lib/consoleOutbox.js';
import { LEVELS } from '../lib/bloom.js';
import { HOME_FOR, ROLE_LABEL } from '../lib/routes.js';
import AppShell from '../shell/AppShell.jsx';
import { Button, Chip, Empty, Icon, Note, Steps, Tip } from '../ui/index.jsx';
import Bank from './Bank.jsx';
import Gate from './Gate.jsx';
import Live from './Live.jsx';
import Material from './Material.jsx';
import Projector from './Projector.jsx';
import Room from './Room.jsx';
import { LaptopBanner, useLaptop } from './laptop.jsx';
import SyncStatus, { SyncBanner } from './SyncStatus.jsx';

const STEPS = [
  { id: 'content', label: 'Material', icon: 'material', why: null },
  { id: 'bank', label: 'Questions', icon: 'bank', why: 'Read a chapter first. Questions are written from it.' },
  { id: 'session', label: 'Room', icon: 'room', why: 'Write a question bank before opening a room.' },
  { id: 'live', label: 'Live class', icon: 'live', why: 'Open a room to watch the class.' },
];
const STEP_IDS = STEPS.map((s) => s.id);
const PREP = ['content', 'bank', 'session'];

/** The rest of the product, for the two roles that have an account behind them. */
const ACCOUNT_NAV = {
  hod: [{ id: 'dashboard', label: 'Department', icon: 'building' }],
  professor: [{ id: 'dashboard', label: 'Overview', icon: 'dashboard' }],
};
const SHARED_NAV = [
  { id: 'rooms', label: 'Rooms', icon: 'rooms' },
  { id: 'classes', label: 'Classes', icon: 'users' },
  { id: 'review', label: 'Review answers', icon: 'checklist' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
];

/** One line under each step's title: what the step is for, in the state it is in. */
const BANK_SUB = {
  first: 'Choose how many questions and how they spread over the six levels. Nothing is written until you start the run.',
  again: 'A second run over the same chapter. Replace the bank, or add to it.',
  writing: 'Each question is tagged to one level as it is written. A run takes a minute or two.',
  curating: 'Read, fix and trim what was written. A room serves approved questions and nothing else.',
  review: 'Written questions wait here as drafts. Approve the ones you would put in front of this class; only approved questions reach a room.',
};

/** The shape of the step about to come back: head, stepper, a panel and its side. */
function Restoring() {
  return (
    <div className="tc-restore" aria-busy="true" aria-label="Opening the chapter">
      <div className="tc-restore-way">
        <div className="skel" /><div className="skel" /><div className="skel" />
      </div>
      <div className="tc-restore-grid">
        <div className="skel" />
        <div className="tc-restore-side"><div className="skel" /><div className="skel" /><div className="skel" /></div>
      </div>
    </div>
  );
}

export default function TeachApp() {
  const navigate = useNavigate();
  const { account } = useAccount();
  // Records kept on this laptop are this account's (or the console key's), and
  // are sent from here whichever step is open.
  useOutboxOwner(account?.id ? `a:${account.id}` : 'key');
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [unlocked, setUnlocked] = useState(Boolean(teacherKey.get()));

  const [view, setView] = useState('content');
  const [content, setContent] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bank, setBank] = useState(null);
  const [session, setSession] = useState(null);
  const [closed, setClosed] = useState(false);
  // Which of its states the question step is in, so the head can say so.
  const [bankPhase, setBankPhase] = useState('');
  // A view the question step should open on, asked for by another step.
  const [bankFocus, setBankFocus] = useState('');
  // Why a locked step said no, shown beside the stepper for a moment.
  const [why, setWhy] = useState('');

  // What the address bar asked for when the page opened. Read once: after that
  // the console writes the address, it does not follow it.
  const [openedWith] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      code: (params.get('session') ?? '').trim().toUpperCase(),
      contentId: (params.get('content') ?? '').trim(),
      view: (params.get('view') ?? '').trim(),
      // A question to open in the bank (Batch 8, A3: a class's hardest list).
      question: (params.get('question') ?? '').trim(),
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
  // Phase 7: is this the professor's laptop in laptop mode? Asked once. On the
  // key path it is also the first staff call, so a key refused (401) or a
  // device shut out after too many wrong keys (429) lands here.
  const lap = useLaptop(open);

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
        // `settings` travels too, so a Teacher-led room reopened from a link
        // is still known to take no answers (no code on the projector).
        reopened = { code: room.session.code, bankCount: room.bankCount, title: room.content?.title || room.session.title, settings: room.session.settings };
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
        session: finished ? false : Boolean(reopened) || (banked?.active ?? 0) > 0 || (banked?.drafts ?? 0) > 0,
        live: Boolean(reopened),
      };
      const wanted = STEP_IDS.includes(openedWith.view) ? openedWith.view : null;
      const fallback = reopened ? 'live' : loaded ? 'bank' : 'content';
      const landing = wanted && reachable[wanted] ? wanted : fallback;
      setView(landing);
      if (landing === 'bank' && openedWith.question) setBankFocus(`edit:${openedWith.question}`);

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
    next.delete('question');
    const search = next.toString();
    if (search === window.location.search.replace(/^\?/, '')) return;
    navigate({ search: search ? `?${search}` : '' }, { replace: true });
  }, [open, restoring, lost, view, session?.code, content?.contentId, navigate]);

  // The question step says which state it is in while it is on screen.
  useEffect(() => { if (view !== 'bank') setBankPhase(''); }, [view]);


  // A locked step's reason stays long enough to read, then goes.
  useEffect(() => {
    if (!why) return undefined;
    const t = setTimeout(() => setWhy(''), 4500);
    return () => clearTimeout(t);
  }, [why]);

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
  const unlock = (v) => { teacherKey.set(v); setUnlocked(true); lap.retry(); };
  if (!open) return <Gate onUnlock={unlock} laptop={lap.laptop} />;
  if (!account && (lap.blocked || lap.refused)) {
    return <Gate onUnlock={unlock} laptop={lap.laptop || lap.blocked} refused={lap.error} blocked={lap.blocked} />;
  }

  // Approved questions are what a room serves; drafts wait for the teacher.
  const questions = bank?.questions ?? [];
  const approved = questions.filter((q) => q.status === 'active');
  const activeCount = approved.length;
  const draftCount = questions.filter((q) => q.status === 'draft').length;
  const levelCounts = LEVELS.reduce((a, l) => ({ ...a, [l]: approved.filter((q) => q.bloom === l).length }), {});
  const reachable = {
    content: true,
    bank: Boolean(content),
    // Reachable on drafts alone, so the room step can say what is missing.
    session: activeCount > 0 || draftCount > 0 || Boolean(session),
    live: Boolean(session),
  };

  const onSession = (s) => {
    setSession(s);
    setClosed(false);
    // A Teacher-led room has no phones to let in, so its code on the
    // projector would only invite people to a room that takes no answers:
    // it goes straight to the room's own tools.
    if (s?.settings?.mode === 'teacher-led') setView('live');
  };

  // The projector takes the whole window: it is read from the back of a hall,
  // and nothing is allowed to compete with the code.
  if (view === 'session' && session && !closed) {
    return (
      <Projector
        session={session}
        content={content}
        activeCount={activeCount}
        onLive={() => setView('live')}
        laptop={lap.data}
      />
    );
  }

  const role = account?.role;
  const roomOpen = Boolean(session) && !closed;
  const nav = [
    ...(ACCOUNT_NAV[role] ?? []).map((n) => ({ ...n, group: 'overview' })),
    ...(role ? SHARED_NAV.map((n) => ({ ...n, group: 'overview' })) : []),
    ...STEPS.map((s) => ({
      ...s,
      group: s.id === 'live' ? 'teach' : 'prepare',
      locked: !reachable[s.id],
      badge: s.id === 'bank' && draftCount > 0 ? `${draftCount} to review`
        : s.id === 'bank' && activeCount > 0 ? activeCount
        : s.id === 'live' && session ? (closed ? 'Closed' : 'Live') : undefined,
      tone: s.id === 'live' && session ? (closed ? 'quiet' : 'live') : undefined,
    })),
    // The shared key reviews the rooms nobody owns, so it gets the queue too.
    ...(role ? [] : [
      { id: 'classes', label: 'Classes', icon: 'users', group: 'teach' },
      { id: 'review', label: 'Review answers', icon: 'checklist', group: 'teach' },
    ]),
  // Phase 7: no hub on the laptop (it needs student accounts).
  ].filter((n) => !(lap.laptop && n.id === 'hub'));

  const go = (id) => {
    if (id === 'dashboard') navigate(HOME_FOR[role] ?? '/');
    else if (id === 'rooms') navigate('/rooms');
    else if (id === 'classes') navigate('/classes');
    else if (id === 'review') navigate('/review');
    else if (id === 'analytics') navigate('/analytics');
    else setView(id);
  };

  // F3: a part of the live room, straight from the palette. Live reads the
  // space and the records tab from the address (`?space=`, `?tab=`), so this
  // writes them there and opens Live; a reload keeps them.
  const openLive = (space, tab) => {
    const next = new URLSearchParams(window.location.search);
    next.set('space', space);
    if (tab) next.set('tab', tab); else next.delete('tab');
    navigate({ search: `?${next.toString()}` }, { replace: true });
    setView('live');
  };

  const commands = [
    roomOpen && session?.settings?.mode !== 'teacher-led' && { id: 'projector', label: `Open the projector for ${session.code}`, icon: 'projector', onSelect: () => setView('session') },
    session && view !== 'live' && { id: 'watch', label: `Watch room ${session.code}`, icon: 'live', onSelect: () => setView('live') },
    session && { id: 'live-wheel', label: 'Spin the wheel', icon: 'draw', onSelect: () => openLive('room', 'wheel') },
    // A room known to have no class has no attendance; Live falls back if the room turns out to have none.
    session && session.classId !== null && { id: 'live-attendance', label: 'Attendance', icon: 'attendance', onSelect: () => openLive('attendance') },
    session && { id: 'live-observe', label: 'Observations', icon: 'note', onSelect: () => openLive('room', 'observe') },
    session && { id: 'live-tally', label: 'Raised hands', icon: 'hand', onSelect: () => openLive('room', 'tally') },
    !account && { id: 'all-rooms', label: 'See all rooms', icon: 'rooms', onSelect: () => navigate('/rooms') },
  ].filter(Boolean);

  // The head: where this is, what it is called, and one line on what it is for.
  const chapter = session?.title || content?.title;
  const crumb = session
    ? <><span className="mono strong">{session.code}</span><span aria-hidden="true">·</span><span className="clip">{chapter}</span></>
    : content ? <span className="clip">{content.title}</span> : <span>Teacher console</span>;
  const phase = bankPhase || (draftCount > 0 ? 'review' : activeCount > 0 ? 'curating' : 'first');
  const head = {
    content: {
      title: 'Material',
      sub: content
        ? 'Tick the topics this class is asked about. Questions are written from those and nothing else.'
        : 'Start from a lesson deck or a syllabus. Questions are written only from what is in it.',
    },
    bank: { title: 'Questions', sub: BANK_SUB[phase] },
    session: {
      title: 'Room',
      sub: 'Set the rules the room runs on, then open it. Opening mints a six-character code and puts it on the projector.',
    },
  }[view];
  const showHead = Boolean(head) && !restoring && !lost;

  const ticked = content ? selected.filter((t) => content.topics?.includes(t)).length : 0;
  const steps = [
    {
      id: 'content',
      label: 'Material',
      sub: content ? `${ticked} of ${content.topics?.length ?? 0} topics` : 'Deck or text',
      done: Boolean(content),
    },
    {
      id: 'bank',
      label: 'Questions',
      sub: draftCount > 0
        ? `${activeCount} approved · ${draftCount} to review`
        : activeCount > 0 ? `${activeCount} approved` : content ? 'Not written' : '',
      done: activeCount > 0 && draftCount === 0,
      locked: !reachable.bank,
      why: STEPS[1].why,
    },
    {
      id: 'session',
      label: 'Room',
      sub: roomOpen ? session.code : 'Not open',
      done: roomOpen,
      locked: !reachable.session,
      why: STEPS[2].why,
    },
  ];

  return (
    <AppShell
      // The class step draws its own head, with the room's state and actions.
      crumb={view === 'live' ? undefined : crumb}
      title={showHead ? head.title : undefined}
      sub={showHead ? head.sub : undefined}
      banner={<><SyncBanner /><LaptopBanner data={lap.data} onReread={lap.retry} reading={lap.reading} /></>}
      status={
        <>
          <SyncStatus />
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
      commands={commands}
      current={view}
      onNav={go}
      width={view === 'live' ? 'wide' : undefined}
    >
      {showHead && PREP.includes(view) && (
        <div className="tc-way">
          <Steps
            label="Preparing this class"
            steps={steps}
            current={view}
            onStep={(id) => { setWhy(''); setView(id); }}
            onLocked={(st) => setWhy(st.why ?? `${st.label} is not ready yet.`)}
          />
          {why && <span className="tc-way-why" role="status"><Icon name="lock" size={13} />{why}</span>}
        </div>
      )}

      {(healthError || restoreNote || (closed && session)) && (
        <div className="stack stack-2">
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
        <div className="card tc-lost">
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
        </div>
      ) : (
        <>
          {view === 'content' && (
            <Material
              content={content}
              selected={selected}
              bank={bank}
              hasBank={activeCount + draftCount > 0}
              drafts={draftCount}
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
              onPhase={setBankPhase}
              focus={bankFocus}
              onFocused={() => setBankFocus('')}
              onBack={() => setView('content')}
              onNext={() => setView('session')}
            />
          )}
          {view === 'session' && (
            <Room
              content={content}
              bank={bank}
              activeCount={activeCount}
              draftCount={draftCount}
              levels={levelCounts}
              onDrafts={() => { setBankFocus('drafts'); setView('bank'); }}
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
              onOpenQuestion={content ? (id) => { setBankFocus(`edit:${id}`); setView('bank'); } : undefined}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
