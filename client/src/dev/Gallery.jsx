/**
 * Every account screen, drawn with sample data. Development only.
 *
 * The dashboards need a signed-in account and a database to show anything, and
 * a design cannot be judged from an empty state. Each screen keeps its drawing
 * in a pure view; a `*.gallery.jsx` file beside this one hands that view some
 * sample data, and this page lists them, grouped by the file they came from.
 *
 *   /__gallery            the list
 *   /__gallery/<id>       one screen, full page
 *
 * A gallery file default-exports an array of
 *   { id, title, role, render: () => element, note? }
 * where `role` is who the screen should believe is signed in and `note` is an
 * optional line on what the entry shows.
 */

import { Fragment } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ROLE_LABEL } from '../lib/routes.js';
import ThemeToggle from '../shell/ThemeToggle.jsx';
import { PreviewAccount } from '../shell/viewer.js';
import { Chip, Mark } from '../ui/index.jsx';

const modules = import.meta.glob('./*.gallery.jsx', { eager: true });

/** The file an entry came from decides the group it is listed under. */
const AREAS = {
  learn: { title: 'Student phone', line: 'What a student sees on their phone in a live room. No account.' },
  dash: { title: 'Dashboards', line: 'Where a head of department and a professor run things.' },
  insight: { title: 'Insight', line: 'A student’s own results, and analytics for all three roles.' },
  review: { title: 'Review', line: 'Written answers a professor confirms or changes.' },
  bank: { title: 'Question bank', line: 'Drafts waiting for approval, and the approved bank.' },
  author: { title: 'Authoring', line: 'Editing and writing questions: the new kinds, passages and images.' },
  items: { title: 'Item statistics', line: 'How each question did with this class, and the wrong-key flag.' },
  room: { title: 'Room set-up', line: 'The question set a room serves, and why a room cannot open yet.' },
  classes: { title: 'Classes', line: 'Rosters, removed students and a class across its rooms.' },
  attend: { title: 'Lobby and attendance', line: 'The waiting room, attendance against the class, and the two halves of a Mixed room.' },
  records: { title: 'Teacher records', line: 'The wheel, the raised-hands tally, observations and activities. Staff only.' },
  coach: { title: 'Live insights', line: 'Bands, the three cards, KPI tiles and one student’s card. Staff only.' },
  wall: { title: 'Projector', line: 'What the wall shows, its controls and its links.' },
  outcomes: { title: 'Course outcomes', line: 'A class’s outcomes, what maps to them and what reaches none. Staff only.' },
  attain: { title: 'Attainment', line: 'Outcome and Bloom attainment, one student’s evidence, and the formula behind it. Staff only.' },
  register: { title: 'Marks register and roster import', line: 'Marks by room in roll order, and a roster from a CSV file. Staff only.' },
  miscon: { title: 'Misconceptions', line: 'Which wrong options students chose, linked to the misunderstanding behind them. Counts only. Staff only.' },
  ask: { title: 'Class questions and confidence', line: 'Put one question to the class, pause to discuss, re-vote. Counts only, no names. Staff only.' },
  auth: { title: 'Auth', line: 'Sign in, sign up and the profile.' },
};

const fileOf = (path) => /\.\/(.+)\.gallery\.jsx$/.exec(path)?.[1] ?? path;
const ORDER = Object.keys(AREAS);
const GROUPS = Object.entries(modules)
  .map(([path, m]) => ({ id: fileOf(path), entries: m.default ?? [] }))
  .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
const ENTRIES = GROUPS.flatMap((g) => g.entries);

/* One line on each entry from the files that do not carry their own `note`. */
const NOTES = {
  'phone-join': 'The code, roll number and name, before the room opens to them.',
  'phone-question': 'One question, picked for the level reached.',
  'phone-retry': 'A wrong first try, with one more go allowed.',
  'phone-order': 'A question answered by putting items in order.',
  'phone-correct': 'The verdict after a right answer.',
  'phone-wrong': 'The verdict after a wrong answer.',
  'phone-up': 'Moving up a level after a run of right answers.',
  'phone-down': 'Re-aiming one level down.',
  'phone-paused': 'What the phone shows while the teacher has paused the room.',
  'phone-done': 'The end of the set.',
  'dash-department': 'A department with professors, pending invites and rooms.',
  'dash-department-empty': 'A department before any professor is invited.',
  'dash-overview': 'A professor’s classes, rooms and invites.',
  'dash-overview-empty': 'A professor with nothing yet, Classroom switched off.',
  'dash-rooms': 'Every room a professor has run.',
  'dash-rooms-empty': 'No rooms yet.',
  'dash-rooms-hod': 'Rooms across the department, read only.',
  'dash-rooms-key': 'Rooms opened with the shared teacher key.',
};

const PEOPLE = {
  hod: { role: 'hod', fullName: 'Dr. Meera Kulkarni', email: 'hod@example.edu', code: 'BL-HOD001' },
  professor: { role: 'professor', fullName: 'Prof. Arjun Rao', email: 'prof@example.edu', code: 'BL-PRF014' },
  student: { role: 'student', fullName: 'Isha Deshmukh', email: 'student@example.edu', code: 'BL-STU203', rollNo: 'CSF042' },
};

/** "Student phone: join" is listed under Student phone as "Join". */
function shortTitle(title, area) {
  const t = String(title ?? '');
  const cut = /^(.+?):\s+(.+)$/.exec(t);
  if (!cut) return t;
  return area && cut[1].toLowerCase() === area.toLowerCase()
    ? cut[2].charAt(0).toUpperCase() + cut[2].slice(1)
    : t;
}

function Index() {
  return (
    <div className="in-gal-wrap">
      <div className="in-gal">
        <header className="in-gal-head">
          <div className="cluster between">
            <span className="cluster">
              <Mark size={28} />
              <Chip tone="warn" dot>Development only</Chip>
            </span>
            <ThemeToggle />
          </div>
          <h1>Screens with sample data</h1>
          <p>
            Every screen that needs an account or a database, drawn from sample data so it can be judged.
            Nothing here talks to the server, and none of it is in a production build.
          </p>
        </header>

        {GROUPS.map((g) => {
          const area = AREAS[g.id] ?? { title: g.id, line: '' };
          return (
            <section key={g.id} className="in-gal-area" aria-labelledby={`gal-${g.id}`}>
              <header>
                <div className="sec">
                  <h2 id={`gal-${g.id}`}>{area.title}</h2>
                  {area.line && <p>{area.line}</p>}
                </div>
                <span className="t-meta">{g.entries.length} {g.entries.length === 1 ? 'screen' : 'screens'}</span>
              </header>
              <div className="in-gal-grid">
                {g.entries.map((e) => (
                  <Link key={e.id} className="card in-gal-link" to={`/__gallery/${e.id}`}>
                    <b>{shortTitle(e.title, area.title)}</b>
                    {(e.note || NOTES[e.id]) && <p>{e.note || NOTES[e.id]}</p>}
                    <span className="cluster">
                      <Chip>{e.role ? ROLE_LABEL[e.role] ?? e.role : 'No account'}</Chip>
                      <span className="t-meta mono">{e.id}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        {ENTRIES.length === 0 && <p className="muted">No gallery files yet.</p>}
      </div>
    </div>
  );
}

export default function Gallery() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const id = pathname.replace(/^\/__gallery\/?/, '');
  const entry = ENTRIES.find((e) => e.id === id);

  if (!entry) return <Index />;

  return (
    <PreviewAccount.Provider value={entry.role ? PEOPLE[entry.role] : null}>
      {/* Keyed, so moving between entries never carries one entry's state into the next. */}
      <Fragment key={entry.id}>{entry.render()}</Fragment>
      <select
        aria-label="Gallery screen"
        value={entry.id}
        onChange={(e) => navigate(e.target.value ? `/__gallery/${e.target.value}` : '/__gallery')}
        style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 200, font: '12px/1 var(--mono)', padding: 4, borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line-2)' }}
      >
        <option value="">All screens</option>
        {GROUPS.map((g) => (
          <optgroup key={g.id} label={AREAS[g.id]?.title ?? g.id}>
            {g.entries.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </optgroup>
        ))}
      </select>
    </PreviewAccount.Provider>
  );
}
