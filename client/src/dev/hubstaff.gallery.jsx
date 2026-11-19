/**
 * The staff side of the Learning Hub, drawn from replies the server sends
 * (hub/samples/staff.js). Dev only. Each entry renders the screen's own view;
 * writes go to a stand-in that answers as the server does, so ordering units
 * by drag or keyboard, placing chapters, syncing topics and deciding links can
 * be tried here without a server.
 */

import { useState } from 'react';

import '../styles/hub.css';
import '../styles/hub-staff.css';
import * as S from '../hub/samples/staff.js';
import ChapterTopics from '../hubstaff/ChapterTopics.jsx';
import ClassStructure from '../hubstaff/ClassStructure.jsx';
import { LinkQueueView, countsOf } from '../hubstaff/LinkQueue.jsx';
import { StaffChapterView } from '../hubstaff/StaffChapter.jsx';
import { StaffClassView } from '../hubstaff/StaffClass.jsx';
import { StaffHomeView } from '../hubstaff/StaffHome.jsx';
import { useLinkActions } from '../hubstaff/StaffLinks.jsx';
import { Problem, StaffPage } from '../hubstaff/StaffParts.jsx';
import { PreviewView } from '../hubstaff/StaffPreview.jsx';
import { SuggestProgress, SuggestResult } from '../hubstaff/StaffSuggest.jsx';
import { StaffTopicView } from '../hubstaff/StaffTopic.jsx';
import TopicLinks from '../hubstaff/TopicLinks.jsx';

const clone = (v) => structuredClone(v);
const later = (value, ms = 350) => new Promise((resolve) => { setTimeout(() => resolve(value), ms); });
const refuse = (error, ms = 350) => new Promise((_, reject) => { setTimeout(() => reject(error), ms); });
const newHex = () => Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/* -------------------------------------------- a stand-in for the class writes -- */

function structureApi(get, set) {
  const answer = (hub, extra = {}) => { set(hub); return later({ ...extra, hub }); };
  const groupOf = (hub, unitId) => (unitId ? hub.units.find((u) => u.id === unitId).chapters : hub.otherChapters.chapters);
  const take = (hub, id) => {
    for (const g of [...hub.units.map((u) => u.chapters), hub.otherChapters.chapters]) {
      const i = g.findIndex((c) => c.id === id);
      if (i >= 0) return g.splice(i, 1)[0];
    }
    return null;
  };
  const renumber = (hub) => {
    hub.units.forEach((u, i) => { u.position = i + 1; u.chapters.forEach((c, j) => { c.position = j + 1; }); });
    hub.otherChapters.chapters.forEach((c, j) => { c.position = j + 1; });
  };
  return {
    orderUnits: (_, ids) => {
      const hub = clone(get());
      hub.units = ids.map((id) => hub.units.find((u) => u.id === id));
      renumber(hub);
      return answer(hub);
    },
    addUnit: (_, name) => {
      const hub = clone(get());
      const clean = String(name ?? '').trim();
      if (!clean) return refuse(Object.assign(new Error('A unit needs a name, such as "Unit 1: Sets and logic".'), { status: 400 }));
      if (hub.units.some((u) => u.name.toLowerCase() === clean.toLowerCase())) {
        return refuse(Object.assign(new Error(`There is already a unit called "${clean}" in this class.`), { status: 409 }));
      }
      const unit = { id: newHex(), name: clean, nameHtml: clean, position: hub.units.length + 1, chapters: [] };
      hub.units.push(unit);
      return answer(hub, { unit: { id: unit.id, name: unit.name, position: unit.position } });
    },
    renameUnit: (_, id, name) => {
      const hub = clone(get());
      const u = hub.units.find((x) => x.id === id);
      u.name = name; u.nameHtml = name;
      return answer(hub, { unit: { id, name, position: u.position } });
    },
    removeUnit: (_, id) => {
      const hub = clone(get());
      const i = hub.units.findIndex((u) => u.id === id);
      const [gone] = hub.units.splice(i, 1);
      hub.otherChapters.chapters.push(...gone.chapters);
      renumber(hub);
      const n = gone.chapters.length;
      return answer(hub, {
        removed: true,
        message: n
          ? `The unit was removed. Its ${n === 1 ? 'chapter is' : `${n} chapters are`} now under "Other chapters"; nothing else changed.`
          : 'The unit was removed; it held no chapters.',
      });
    },
    placeChapter: (_, contentId, { unitId, position }) => {
      const hub = clone(get());
      let ch = take(hub, contentId);
      const first = !ch;
      if (first) {
        const a = hub.available.find((x) => x.id === contentId);
        hub.available = hub.available.filter((x) => x.id !== contentId);
        ch = { ...a, slides: { note: '' }, topics: [], unsynced: [], unmatchedQuestions: 0 };
      }
      const g = groupOf(hub, unitId ?? null);
      g.splice(Math.min((position ?? g.length + 1) - 1, g.length), 0, ch);
      renumber(hub);
      return answer(hub, { placed: true, ...(first ? { topics: { added: ['Paths', 'Cycles', 'Trees'], retired: [] } } : {}) });
    },
    removeChapter: (_, contentId) => {
      const hub = clone(get());
      const ch = take(hub, contentId);
      hub.available.push({ id: ch.id, title: ch.title, titleHtml: ch.titleHtml, kind: ch.kind });
      renumber(hub);
      return answer(hub, { removed: true, message: 'The chapter was taken off this class\'s hub. The chapter itself, its questions and its topics are unchanged.' });
    },
  };
}

function ClassHarness({ start, tab: tab0 = 'structure' }) {
  const [hub, setHub] = useState(() => clone(start));
  const [tab, setTab] = useState(tab0);
  const holder = { current: hub };
  const api = structureApi(() => holder.current, (h) => { holder.current = h; });
  return (
    <StaffClassView classId={hub.class.id} hub={hub} tab={tab} onTab={setTab} onPreview={() => {}}>
      {tab === 'structure'
        ? <ClassStructure classId={hub.class.id} hub={hub} onHub={setHub} api={api} />
        : <p className="hubs-quiet">This tab is drawn by its own builder (ClassProgress, ClassStates).</p>}
    </StaffClassView>
  );
}

/* --------------------------------------------------------- chapter and topic -- */

const chapterApi = { syncTopics: () => later(clone(S.SYNC_RESULT), 600) };

function ChapterHarness({ start }) {
  const [chapter, setChapter] = useState(() => clone(start));
  const [tab, setTab] = useState('topics');
  return (
    <StaffChapterView contentId={chapter.id} chapter={chapter} tab={tab} onTab={setTab} onChapter={setChapter}>
      {tab === 'topics'
        ? <ChapterTopics contentId={chapter.id} chapter={chapter} onChapter={setChapter} api={chapterApi} />
        : <p className="hubs-quiet">This tab is drawn by the review-queue builder.</p>}
    </StaffChapterView>
  );
}

const linkApi = {
  ownChapters: () => later(clone(S.CONTENTS)),
  chapter: (id) => later(clone(id === S.CHAPTER_PASTED.chapter.id ? S.CHAPTER_PASTED : S.CHAPTER_PROFESSOR)),
  addLink: () => refuse(S.LOOP_409),
  setLink: (id, state) => later({ link: { ...S.LINKS.links.find((l) => l.id === id), state } }),
  removeLink: () => later({ removed: true, message: 'The link was removed. No chain uses it any more.' }),
  proposeLinks: () => later(clone(S.PROPOSE_LLM), 2600),
  linkRun: () => later(clone(S.RUN_RUNNING)),
};

function TopicHarness({ view, canEdit }) {
  const [tab, setTab] = useState('links');
  return (
    <StaffTopicView topicId={view.topic.id} view={view} canEdit={canEdit} tab={tab} onTab={setTab}>
      {tab === 'links'
        ? <TopicLinks view={view} canEdit={canEdit} onReload={() => {}} api={linkApi} />
        : <p className="hubs-quiet">This tab is drawn by the review-queue builder (Lessons).</p>}
    </StaffTopicView>
  );
}

function QueueHarness({ start, canEdit }) {
  const [data, setData] = useState(() => clone(start));
  const [state, setState] = useState('proposed');
  const actions = useLinkActions((link, action, reply) => {
    setData((d) => {
      const links = action === 'remove' ? d.links.filter((l) => l.id !== link.id) : d.links.map((l) => (l.id === link.id ? { ...l, ...reply.link } : l));
      return { links, counts: countsOf(links) };
    });
  }, linkApi);
  return <LinkQueueView data={data} canEdit={canEdit} state={state} onState={setState} actions={actions} onSuggest={() => {}} />;
}

/* ------------------------------------------------------------------- entries -- */

/** GET /api/hub with a second, empty section beside the captured class. */
const hubWith = (hub, prof) => ({
  ...hub,
  classes: [...hub.classes, { ...S.CLASS_EMPTY.class, canEdit: prof, units: 0, chapters: 0 }],
});
const homeDetails = (prof) => ({
  [S.CLASS_PROFESSOR.class.id]: { view: prof ? S.CLASS_PROFESSOR : S.CLASS_HOD },
  [S.CLASS_EMPTY.class.id]: { view: S.CLASS_EMPTY },
});

function Boxed({ children }) {
  return <div className="card" style={{ padding: 22, maxWidth: 720 }}>{children}</div>;
}

export default [
  {
    id: 'hubs-home',
    title: 'Hub home, professor',
    role: 'professor',
    note: 'GET /api/hub with each class’s units and chapters, and the proposed links waiting.',
    render: () => <StaffHomeView role="professor" data={hubWith(S.HUB_PROFESSOR, true)} details={homeDetails(true)} proposed={S.LINKS.counts.proposed} />,
  },
  {
    id: 'hubs-home-hod',
    title: 'Hub home, HOD (read-only)',
    role: 'hod',
    render: () => <StaffHomeView role="hod" data={hubWith(S.HUB_HOD, false)} details={homeDetails(false)} proposed={S.LINKS_HOD.counts.proposed} />,
  },
  {
    id: 'hubs-home-loading',
    title: 'Hub home, loading and a class that did not load',
    role: 'professor',
    render: () => (
      <StaffHomeView
        role="professor"
        data={hubWith(S.HUB_PROFESSOR, true)}
        details={{ [S.CLASS_PROFESSOR.class.id]: { error: S.ERR_404 } }}
        proposed={undefined}
      />
    ),
  },
  {
    id: 'hubs-home-none',
    title: 'Hub home, no classes yet',
    role: 'professor',
    render: () => <StaffHomeView role="professor" data={{ role: 'professor', classes: [] }} details={{}} proposed={0} />,
  },
  {
    id: 'hubs-503',
    title: 'No accounts on this server (503)',
    role: 'professor',
    note: 'What every hub page shows on the memory server.',
    render: () => <StaffHomeView role="professor" error={S.ERR_503} />,
  },
  {
    id: 'hubs-401',
    title: 'Not signed in (401)',
    role: 'professor',
    render: () => <StaffPage trail={[{ label: 'Learning Hub' }]} title="Your classes’ hubs"><Problem error={S.ERR_401} /></StaffPage>,
  },
  {
    id: 'hubs-403',
    title: 'A student on a staff page (403)',
    role: 'student',
    render: () => <StaffPage trail={[{ label: 'Learning Hub' }]} title="Your classes’ hubs"><Problem error={S.ERR_403} /></StaffPage>,
  },
  {
    id: 'hubs-class',
    title: 'A class: structure (professor)',
    role: 'professor',
    note: 'Drag a unit by its grip, or focus the grip and press the arrow keys. Place, move and take off chapters from their menus. Writes answer from a stand-in.',
    render: () => <ClassHarness start={S.CLASS_PROFESSOR} />,
  },
  {
    id: 'hubs-class-hod',
    title: 'A class: structure (HOD, read-only)',
    role: 'hod',
    render: () => <ClassHarness start={S.CLASS_HOD} />,
  },
  {
    id: 'hubs-class-empty',
    title: 'A class with nothing placed',
    role: 'professor',
    render: () => <ClassHarness start={S.CLASS_EMPTY} />,
  },
  {
    id: 'hubs-class-loading',
    title: 'A class, loading',
    role: 'professor',
    render: () => <StaffClassView loading tab="structure" onTab={() => {}} />,
  },
  {
    id: 'hubs-preview',
    title: 'Preview as a student',
    role: 'professor',
    note: 'GET /api/hub/classes/:id?view=student, as the side sheet draws it.',
    render: () => <Boxed><PreviewView data={S.CLASS_PREVIEW} /></Boxed>,
  },
  {
    id: 'hubs-preview-empty',
    title: 'Preview as a student, nothing placed',
    role: 'professor',
    render: () => <Boxed><PreviewView data={S.CLASS_PREVIEW_EMPTY} /></Boxed>,
  },
  {
    id: 'hubs-chapter',
    title: 'A chapter: topics (professor)',
    role: 'professor',
    note: 'Unsynced topics with "Make topic records", a retired topic greyed, questions under no topic.',
    render: () => <ChapterHarness start={S.CHAPTER_UNSYNCED.chapter} />,
  },
  {
    id: 'hubs-chapter-hod',
    title: 'A chapter: topics (HOD, read-only)',
    role: 'hod',
    render: () => <ChapterHarness start={S.CHAPTER_HOD.chapter} />,
  },
  {
    id: 'hubs-topic',
    title: 'A topic: prerequisite links (professor)',
    role: 'professor',
    note: 'A confirmed and a proposed link in, one out. Adding one answers with the loop 409, as given.',
    render: () => <TopicHarness view={S.TOPIC_TREES} canEdit />,
  },
  {
    id: 'hubs-topic-hod',
    title: 'A topic: prerequisite links (HOD, read-only)',
    role: 'hod',
    render: () => <TopicHarness view={S.TOPIC_TREES} canEdit={false} />,
  },
  {
    id: 'hubs-topic-chain',
    title: 'A topic with a longer chain (Recursion)',
    role: 'professor',
    render: () => <TopicHarness view={S.TOPIC_PROFESSOR} canEdit />,
  },
  {
    id: 'hubs-topic-rejected',
    title: 'A topic with a rejected proposal (Base case)',
    role: 'professor',
    render: () => <TopicHarness view={S.TOPIC_BASE} canEdit />,
  },
  {
    id: 'hubs-topic-bare',
    title: 'A topic with no links yet',
    role: 'professor',
    render: () => <TopicHarness view={S.TOPIC_BARE} canEdit />,
  },
  {
    id: 'hubs-links',
    title: 'Proposed links (professor)',
    role: 'professor',
    render: () => <QueueHarness start={S.LINKS} canEdit />,
  },
  {
    id: 'hubs-links-hod',
    title: 'Proposed links (HOD, read-only)',
    role: 'hod',
    render: () => <QueueHarness start={S.LINKS_HOD} canEdit={false} />,
  },
  {
    id: 'hubs-links-none',
    title: 'Proposed links, none',
    role: 'professor',
    render: () => <QueueHarness start={S.LINKS_NONE} canEdit />,
  },
  {
    id: 'hubs-suggest',
    title: 'Suggest prerequisites: running, then the reply',
    role: 'professor',
    render: () => (
      <div className="stack" style={{ maxWidth: 720 }}>
        <Boxed><SuggestProgress run={S.RUN_RUNNING.run} /></Boxed>
        <Boxed><SuggestResult result={S.PROPOSE_LLM} /></Boxed>
        <Boxed><SuggestResult result={S.PROPOSE_OFFLINE} /></Boxed>
      </div>
    ),
  },
];
