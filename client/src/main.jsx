import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

// Self-hosted, so the page fetches nothing from a third-party host.
// Text and figures (OFL 1.1). Each file carries unicode-range, so a phone
// downloads only the scripts a page actually uses.
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/500.css';
import '@fontsource/noto-sans-devanagari/600.css';

// What every page needs. The console's and the account screens' own sheets
// come with those screens (shell/staffStyles.js).
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/shell.css';
import './styles/learn.css';
import './styles/fx.css';
import './lib/theme.js';
// Before the router starts, so a ?key= never reaches it or stays on screen.
import './lib/teacherKey.js';

import { TipProvider } from './ui/index.jsx';
import Waiting from './shell/Waiting.jsx';
// The one screen in the first download. Students open it on low-end phones on
// slow connections, so it must not wait behind a second round trip, and
// nothing else may ride along with it.
import LearnApp from './learn/LearnApp.jsx';

// Every other screen loads when it is opened, with the stylesheets only those
// screens use.
const staff = (load) =>
  React.lazy(() => Promise.all([load(), import('./shell/staffStyles.js')]).then(([screen]) => screen));

const TeachApp = staff(() => import('./teach/TeachApp.jsx'));
const SignIn = staff(() => import('./account/SignIn.jsx'));
const SignUp = staff(() => import('./account/SignUp.jsx'));
const Department = staff(() => import('./account/Department.jsx'));
const Overview = staff(() => import('./account/Overview.jsx'));
const Me = staff(() => import('./account/Me.jsx'));
const Profile = staff(() => import('./account/Profile.jsx'));
const Analytics = staff(() => import('./account/Analytics.jsx'));
const Rooms = staff(() => import('./account/Rooms.jsx'));
const Review = staff(() => import('./account/Review.jsx'));
const Classes = staff(() => import('./account/Classes.jsx'));
// The projector page. Not a staff screen: it holds no credentials and loads
// only its own stylesheet, so a classroom PC downloads nothing it cannot use.
const Wall = React.lazy(() => import('./teach/Wall.jsx'));
// Lazy as well: it reads the account, which means the Supabase client.
const RoleRoute = React.lazy(() => import('./shell/RoleRoute.jsx'));

// Screens with sample data, for looking at them without a database. Dev only:
// the import is behind the flag, so none of it reaches a production bundle.
const Gallery = import.meta.env.DEV ? staff(() => import('./dev/Gallery.jsx')) : null;

// One root per page, kept across hot reloads so the dev server does not stack them.
const host = document.getElementById('root');
const root = host.__root ?? (host.__root = createRoot(host));

root.render(
  <React.StrictMode>
    <TipProvider>
      <BrowserRouter>
        {/* The skeleton while a screen's code arrives: its shape, and no words. */}
        <React.Suspense fallback={<Waiting />}>
          <Routes>
            {/* Unguarded: the console opens on the shared key as well as on an account. */}
            <Route path="/" element={<TeachApp />} />
            <Route path="/join" element={<LearnApp />} />
            <Route path="/join/:code" element={<LearnApp />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/admin" element={<RoleRoute allow={['hod']}><Department /></RoleRoute>} />
            <Route path="/home" element={<RoleRoute allow={['professor']}><Overview /></RoleRoute>} />
            <Route path="/me" element={<RoleRoute allow={['student']}><Me /></RoleRoute>} />
            {/* Unguarded: the key path has a profile too. */}
            <Route path="/profile" element={<Profile />} />
            <Route path="/analytics" element={<RoleRoute allow={['hod', 'professor', 'student']}><Analytics /></RoleRoute>} />
            {/* Unguarded: the key path opens rooms, and this screen recovers one after a reload. */}
            <Route path="/rooms" element={<Rooms />} />
            {/* Unguarded: the shared key may review the rooms nobody owns. The
                screen itself makes a head of department read-only. */}
            <Route path="/review" element={<Review />} />
            {/* Unguarded like /rooms: the shared key may keep classes too. The
                screen follows the server's canEdit, so an HOD reads only. */}
            <Route path="/classes" element={<Classes />} />
            <Route path="/classes/:id" element={<Classes />} />
            {/* The token rides in the hash, so it never reaches a server log. */}
            <Route path="/wall" element={<Wall />} />
            {Gallery && <Route path="/__gallery/*" element={<React.Suspense fallback={null}><Gallery /></React.Suspense>} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </React.Suspense>
      </BrowserRouter>
    </TipProvider>
  </React.StrictMode>,
);
