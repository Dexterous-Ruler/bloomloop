import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { useAccount } from './auth.js';
import TeacherApp from './teacher/TeacherApp.jsx';
import StudentApp from './student/StudentApp.jsx';
import SignIn, { HOME_FOR } from './screens/SignIn.jsx';
import SignUp from './screens/SignUp.jsx';
import HodDashboard from './screens/HodDashboard.jsx';
import ProfessorHome from './screens/ProfessorHome.jsx';
import StudentDashboard from './screens/StudentDashboard.jsx';
import Profile from './screens/Profile.jsx';
import Analytics from './screens/Analytics.jsx';
import Rooms from './screens/Rooms.jsx';
import './styles.css';

/**
 * The page while the account is still being fetched.
 *
 * Shaped like the dashboards behind it — a title, a row of cards, a panel — so
 * the layout does not jump when the real screen swaps in. It says nothing,
 * because the word "loading" is a slower way of showing exactly this.
 */
function Waiting() {
  return (
    <div className="shell">
      <div className="frame">
        <div className="frame-body">
          <div className="phead">
            <div className="txt">
              <div className="skel" style={{ height: 28, width: 240, borderRadius: 9 }} />
              <div className="skel" style={{ height: 12, width: 340, borderRadius: 6, marginTop: 11 }} />
            </div>
          </div>
          <div className="grid auto" style={{ marginBottom: 16 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skel" style={{ height: 182, borderRadius: 'var(--r-card)' }} />
            ))}
          </div>
          <div className="skel" style={{ height: 252, borderRadius: 'var(--r-card)', marginBottom: 16 }} />
          <div className="skel" style={{ height: 300, borderRadius: 'var(--r-panel)' }} />
        </div>
      </div>
    </div>
  );
}

/**
 * A route only one kind of account may open.
 *
 * The server already enforces every one of these rules — ownership.js decides
 * what a token may read and GET /api/dashboard shapes itself from the role, so
 * nothing here is a security boundary and nothing here is trusted to be one.
 * This exists so that a professor who types /admin is moved to the screen that
 * is theirs instead of being shown a page whose only possible answer is 403.
 *
 * The redirect target is HOME_FOR, the same map sign-in routes on, so a role can
 * never be sent somewhere this wrapper would bounce it out of again.
 */
function RoleRoute({ allow, children }) {
  const { account, loading } = useAccount();

  if (loading) return <Waiting />;
  // Signed out — or a build with no accounts configured at all, where the answer
  // is the same and already known on the first render.
  if (!account) return <Navigate to="/signin" replace />;
  if (!allow.includes(account.role)) return <Navigate to={HOME_FOR[account.role] ?? '/'} replace />;

  return children;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* The console is deliberately unguarded: it opens on the shared teacher
            key as well as on an account, and a key has no role to check. */}
        <Route path="/" element={<TeacherApp />} />
        <Route path="/join" element={<StudentApp />} />
        <Route path="/join/:code" element={<StudentApp />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route
          path="/admin"
          element={<RoleRoute allow={['hod']}><HodDashboard /></RoleRoute>}
        />
        <Route
          path="/home"
          element={<RoleRoute allow={['professor']}><ProfessorHome /></RoleRoute>}
        />
        <Route
          path="/me"
          element={<RoleRoute allow={['student']}><StudentDashboard /></RoleRoute>}
        />
        {/* Unguarded on purpose, and the only signed-in screen that is. Every
            role has a profile, and so does the shared-key path - which has no
            role at all, and where "you are using a key, not an account" is
            exactly the thing the screen exists to explain. */}
        <Route path="/profile" element={<Profile />} />
        {/* The one screen all three roles open, and the only reason it takes a
            list rather than a single role. What each of them sees is decided by
            GET /api/analytics from the token - professors for an HOD, students
            for a professor, themselves for a student - so this list is about
            which doors exist, not about who reads what. */}
        <Route
          path="/analytics"
          element={<RoleRoute allow={['hod', 'professor', 'student']}><Analytics /></RoleRoute>}
        />
        {/* Unguarded, like /profile and for the same reason. GET /api/session
            accepts the shared teacher key, and canWrite() grants that key
            control of unowned rows - which is precisely what a key-path teacher
            creates. Guarding this sent them to /signin and took away the one
            screen that recovers a live room after a browser reload, which is
            the failure the screen was written to prevent. The server decides
            what each caller may act on via room.canControl; this route only
            decides who may look. */}
        <Route path="/rooms" element={<Rooms />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
