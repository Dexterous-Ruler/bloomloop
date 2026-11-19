/**
 * The Learning Hub's home, goals and language switch, drawn from real replies
 * of the local hub server (hub/samples/home.js). Dev only. Each entry renders
 * a pure view, so every state can be judged without a server.
 */

import '../styles/hub.css';
import '../styles/hub-home.css';
import { GoalsView } from '../hub/Goals.jsx';
import { HomeView } from '../hub/Home.jsx';
import { LanguageView } from '../hub/Language.jsx';
import {
  GOALS, GOALS_MORE, HOME, HOME_DEV, HOME_NEW, HOME_NO_CLASS, HOME_PARTS_DOWN, HOME_THIN, LANGUAGE, LANGUAGE_HI, REFUSED,
} from '../hub/samples/home.js';

const clone = (v) => structuredClone(v);
const never = () => new Promise(() => {});
const picker = { data: HOME, loading: false, error: '' };
const NO_GOALS = { goals: [], note: GOALS.note, max: GOALS.max };

/** Derived: asha's reply with every upcoming review due at once (more than the brief lists). */
function allDue() {
  const h = clone(HOME);
  h.reviews.due = [...h.reviews.due, ...h.reviews.upcoming.map((r) => ({ ...r, review: { ...r.review, due: true, when: 'now' } }))];
  h.reviews.upcoming = [];
  return h;
}

/** Derived: a goal title typed in Devanagari. */
function devanagari() {
  const g = clone(GOALS);
  g.goals[0].title = 'मध्य सत्र परीक्षा';
  g.goals[0].titleHtml = 'मध्य सत्र परीक्षा';
  return g;
}

export default [
  {
    id: 'hubhome-home', title: 'Learning Hub: home', role: 'student',
    note: 'Asha: one review due, every state, a goal, a refresher path, two units and Other chapters, a unit name with a formula.',
    render: () => <HomeView data={clone(HOME)} />,
  },
  {
    id: 'hubhome-due', title: 'Learning Hub: home, five reviews due', role: 'student',
    note: 'Derived from Asha’s reply: four due reviews listed, then All 5 reviews.',
    render: () => <HomeView data={allDue()} />,
  },
  {
    id: 'hubhome-thin', title: 'Learning Hub: home, little practice yet', role: 'student',
    note: 'Bilal: two answers on Base case, its review minutes away, no goals or paths.',
    render: () => <HomeView data={clone(HOME_THIN)} />,
  },
  {
    id: 'hubhome-new', title: 'Learning Hub: home, nothing answered', role: 'student',
    note: 'Cara: on the class, every topic not started, a quiet four weeks.',
    render: () => <HomeView data={clone(HOME_NEW)} />,
  },
  {
    id: 'hubhome-mastered', title: 'Learning Hub: home, mostly mastered', role: 'student',
    note: 'Dev: five topics mastered, reading the hub in Hindi.',
    render: () => <HomeView data={clone(HOME_DEV)} />,
  },
  {
    id: 'hubhome-noclass', title: 'Learning Hub: home, no class on the hub', role: 'student',
    note: 'Derived: the server’s `empty` sentence for an account no class holds yet.',
    render: () => <HomeView data={clone(HOME_NO_CLASS)} />,
  },
  {
    id: 'hubhome-parts', title: 'Learning Hub: home, goals and paths unreadable', role: 'student',
    note: 'Derived: two parts came with `unavailable`; the rest still shows.',
    render: () => <HomeView data={clone(HOME_PARTS_DOWN)} />,
  },
  {
    id: 'hubhome-loading', title: 'Learning Hub: home, loading', role: 'student',
    note: 'The shape of the page while the first read is out.',
    render: () => <HomeView data={null} loading />,
  },
  {
    id: 'hubhome-503', title: 'Learning Hub: home, no accounts on this server', role: 'student',
    note: 'The 503 every hub route answers on a server without accounts: calm, with the way back to rooms.',
    render: () => <HomeView data={null} error={REFUSED[503]} />,
  },
  {
    id: 'hubhome-401', title: 'Learning Hub: home, signed out', role: 'student',
    render: () => <HomeView data={null} error={REFUSED[401]} />,
  },
  {
    id: 'hubhome-403', title: 'Learning Hub: home, a staff account', role: 'professor',
    render: () => <HomeView data={null} error={REFUSED[403]} />,
  },
  {
    id: 'hubhome-error', title: 'Learning Hub: home, did not load', role: 'student',
    render: () => <HomeView data={null} error={REFUSED[500]} onRetry={() => {}} />,
  },
  {
    id: 'hubhome-goals', title: 'Learning Hub: goals', role: 'student',
    note: 'Asha’s goal: the next exam in the brief, then every topic it covers.',
    render: () => <GoalsView data={clone(GOALS)} picker={picker} onSave={never} onRemove={never} />,
  },
  {
    id: 'hubhome-goals-more', title: 'Learning Hub: goals, later and past', role: 'student',
    note: 'Derived: an untitled later goal with a topic no longer on the classes, and one whose date has passed.',
    render: () => <GoalsView data={clone(GOALS_MORE)} picker={picker} onSave={never} onRemove={never} />,
  },
  {
    id: 'hubhome-goals-new', title: 'Learning Hub: goals, the form', role: 'student',
    note: 'Adding a goal: title, exam date and the student’s own topics, from the home’s map.',
    render: () => <GoalsView data={clone(GOALS)} picker={picker} onSave={never} onRemove={never} open="new" />,
  },
  {
    id: 'hubhome-goals-hi', title: 'Learning Hub: goals, a Devanagari title', role: 'student',
    render: () => <GoalsView data={devanagari()} picker={picker} onSave={never} onRemove={never} />,
  },
  {
    id: 'hubhome-goals-none', title: 'Learning Hub: goals, none yet', role: 'student',
    render: () => <GoalsView data={clone(NO_GOALS)} picker={picker} onSave={never} onRemove={never} />,
  },
  {
    id: 'hubhome-goals-loading', title: 'Learning Hub: goals, loading', role: 'student',
    render: () => <GoalsView data={null} loading />,
  },
  {
    id: 'hubhome-goals-503', title: 'Learning Hub: goals, no accounts on this server', role: 'student',
    render: () => <GoalsView data={null} error={REFUSED[503]} />,
  },
  {
    id: 'hubhome-language', title: 'Learning Hub: the language switch', role: 'student',
    note: 'As it sits in every student page header: English chosen; Hindi chosen (Dev); a refused save, with its reason.',
    render: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 120, alignItems: 'flex-end', padding: 40 }}>
        <LanguageView {...LANGUAGE} onPick={() => {}} />
        <LanguageView {...LANGUAGE_HI} onPick={() => {}} />
        <LanguageView {...LANGUAGE} error="Choose English, Hindi or Marathi." onPick={() => {}} />
      </div>
    ),
  },
];
