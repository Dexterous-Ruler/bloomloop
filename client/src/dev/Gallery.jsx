/**
 * Every account screen, drawn with sample data. Development only.
 *
 * The dashboards need a signed-in account and a database to show anything, and
 * a design cannot be judged from an empty state. Each screen keeps its drawing
 * in a pure view; a `*.gallery.jsx` file beside this one hands that view some
 * sample data, and this page lists them.
 *
 *   /__gallery            the list
 *   /__gallery/<id>       one screen, full page
 *
 * A gallery file default-exports an array of
 *   { id, title, role, render: () => element }
 * where `role` is who the screen should believe is signed in.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom';

import { PreviewAccount } from '../shell/viewer.js';

const modules = import.meta.glob('./*.gallery.jsx', { eager: true });
const ENTRIES = Object.values(modules).flatMap((m) => m.default ?? []);

const PEOPLE = {
  hod: { role: 'hod', fullName: 'Dr. Meera Kulkarni', email: 'hod@example.edu', code: 'BL-HOD001' },
  professor: { role: 'professor', fullName: 'Prof. Arjun Rao', email: 'prof@example.edu', code: 'BL-PRF014' },
  student: { role: 'student', fullName: 'Isha Deshmukh', email: 'student@example.edu', code: 'BL-STU203', rollNo: 'CSF042' },
};

export default function Gallery() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const id = pathname.replace(/^\/__gallery\/?/, '');
  const entry = ENTRIES.find((e) => e.id === id);

  if (!entry) {
    return (
      <div className="page page-narrow">
        <div className="page-head"><div><h1>Screens with sample data</h1><p className="t-lead lead">Development only. Nothing here talks to the server.</p></div></div>
        <ul className="rows card" style={{ padding: 8 }}>
          {ENTRIES.map((e) => (
            <li key={e.id}><Link className="rw" to={`/__gallery/${e.id}`}><span className="rw-main strong">{e.title}</span><span className="t-meta">{e.role ?? 'no account'}</span></Link></li>
          ))}
          {ENTRIES.length === 0 && <li className="rw muted">No gallery files yet.</li>}
        </ul>
      </div>
    );
  }

  return (
    <PreviewAccount.Provider value={entry.role ? PEOPLE[entry.role] : null}>
      {entry.render()}
      <select
        aria-label="Gallery screen"
        value={entry.id}
        onChange={(e) => navigate(`/__gallery/${e.target.value}`)}
        style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 200, font: '12px/1 var(--mono)', padding: 4, borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line-2)' }}
      >
        {ENTRIES.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
      </select>
    </PreviewAccount.Provider>
  );
}
