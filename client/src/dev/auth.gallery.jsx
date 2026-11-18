/**
 * Sign in, sign up and the profile, drawn with sample data. Development only.
 *
 * The people match the stand-ins in Gallery.jsx, so the shell's account menu
 * and the page under it name the same person.
 */

import { ProfileView } from '../account/Profile.jsx';
import { SignInView } from '../account/SignIn.jsx';
import { SignUpView } from '../account/SignUp.jsx';

const nothing = () => {};

const PROFESSOR = {
  role: 'professor', fullName: 'Prof. Arjun Rao', email: 'prof@example.edu', code: 'BL-PRF014',
  department: 'Computer Science', active: true, createdAt: '2026-06-22T09:30:00Z',
};
const STUDENT = {
  role: 'student', fullName: 'Isha Deshmukh', email: 'student@example.edu', code: 'BL-STU203',
  department: 'Computer Science', rollNo: 'CSF042', active: true, createdAt: '2026-08-04T11:10:00Z',
};

// What GET /api/auth/me answers for each role.
const CAN_SEE = {
  professor: {
    team: 'own-students', content: 'crud-own', sessions: 'own', liveGrid: 'own',
    runSessions: true, takeSessions: false, exports: 'own', invite: 'student',
  },
  student: {
    team: 'self', content: 'none', sessions: 'none', liveGrid: 'none',
    runSessions: false, takeSessions: true, exports: 'self', invite: null,
  },
};

// The two sentences GET /api/classroom/link sends, as the server words them.
const ABOUT_LINK = {
  purpose: 'Linking lets your professor place your session marks on your exact Google account when results '
    + 'are posted to Classroom, instead of matching your roll number to a name on the roster. '
    + 'BloomLoop asks Google only who you are - never for your coursework, your mail or your files - '
    + 'and keeps no access to your account afterwards.',
  optional: 'This is optional. A student who never links, or has no Google account at all, sits every session '
    + 'exactly as they do now and is graded exactly as they are now.',
};

const profile = (props) => (
  <ProfileView
    canSignIn
    connecting={false}
    linkBusy=""
    error=""
    onConnectClassroom={nothing}
    onRetryClassroom={nothing}
    onConnectGoogle={nothing}
    onDisconnectGoogle={nothing}
    onRetryLink={nothing}
    {...props}
  />
);

const signIn = (props) => (
  <SignInView configured email="" password="" busy={false} error="" onEmail={nothing} onPassword={nothing} onSubmit={nothing} {...props} />
);

const signUp = (props) => (
  <SignUpView
    configured
    step="details"
    code="SAMPLE01"
    fullName=""
    email=""
    password=""
    busy={false}
    error=""
    onCode={nothing}
    onFullName={nothing}
    onEmail={nothing}
    onPassword={nothing}
    onContinue={nothing}
    onBack={nothing}
    onSubmit={nothing}
    {...props}
  />
);

export default [
  {
    id: 'auth-profile-professor-connected',
    title: 'Profile · professor, Classroom connected',
    role: 'professor',
    render: () => profile({
      account: PROFESSOR,
      canSee: CAN_SEE.professor,
      classroom: { configured: true, connected: true, reason: 'Connected. Grades can be pushed to a course.' },
    }),
  },
  {
    id: 'auth-profile-professor-not-connected',
    title: 'Profile · professor, Classroom not connected',
    role: 'professor',
    render: () => profile({
      account: PROFESSOR,
      canSee: CAN_SEE.professor,
      classroom: { configured: true, connected: false, reason: '' },
    }),
  },
  {
    id: 'auth-profile-professor-checking',
    title: 'Profile · professor, Classroom still checking',
    role: 'professor',
    render: () => profile({ account: PROFESSOR, canSee: CAN_SEE.professor, classroom: null }),
  },
  {
    id: 'auth-profile-professor-failed',
    title: 'Profile · professor, check failed and consent refused',
    role: 'professor',
    render: () => profile({
      account: PROFESSOR,
      canSee: CAN_SEE.professor,
      classroom: { configured: false, connected: false, failed: true, reason: 'Failed to fetch' },
      error: 'Could not start the Google sign-in: Failed to fetch',
    }),
  },
  {
    id: 'auth-profile-student-linked',
    title: 'Profile · student, Google linked',
    role: 'student',
    render: () => profile({
      account: STUDENT,
      canSee: CAN_SEE.student,
      link: { linked: true, email: 'isha.deshmukh@example.com', source: 'student', configured: true, reason: '', ...ABOUT_LINK },
    }),
  },
  {
    id: 'auth-profile-student-not-linked',
    title: 'Profile · student, Google not linked',
    role: 'student',
    render: () => profile({
      account: STUDENT,
      canSee: CAN_SEE.student,
      link: { linked: false, email: null, source: null, configured: true, reason: '', ...ABOUT_LINK },
    }),
  },
  {
    id: 'auth-profile-student-roster',
    title: 'Profile · student, roster link unconfirmed, no roll number',
    role: 'student',
    render: () => profile({
      account: { ...STUDENT, rollNo: null },
      canSee: CAN_SEE.student,
      link: { linked: true, email: 'isha.deshmukh@example.com', source: 'roster', configured: true, reason: '', ...ABOUT_LINK },
    }),
  },
  {
    id: 'auth-profile-key',
    title: 'Profile · shared teacher key',
    render: () => profile({
      account: null,
      usingKey: true,
      classroom: { configured: false, connected: false, reason: '' },
    }),
  },
  {
    id: 'auth-profile-nobody',
    title: 'Profile · nobody signed in',
    render: () => profile({ account: null, usingKey: false }),
  },
  {
    id: 'auth-profile-loading',
    title: 'Profile · account still loading',
    render: () => profile({ account: null, loading: true }),
  },
  {
    id: 'auth-signup-details',
    title: 'Sign up · after a valid code',
    render: () => signUp({ fullName: 'Isha Deshmukh', email: 'student@example.edu' }),
  },
  {
    id: 'auth-signup-refused',
    title: 'Sign up · the server refused the code',
    render: () => signUp({
      fullName: 'Isha Deshmukh',
      email: 'student@example.edu',
      password: 'sample-only',
      error: 'That invite has already been used.',
    }),
  },
  {
    id: 'auth-signup-creating',
    title: 'Sign up · creating the account',
    render: () => signUp({ fullName: 'Isha Deshmukh', email: 'student@example.edu', password: 'sample-only', busy: true }),
  },
  {
    id: 'auth-signin-error',
    title: 'Sign in · wrong password',
    render: () => signIn({ email: 'prof@example.edu', password: 'sample-only', error: 'Invalid login credentials' }),
  },
  {
    id: 'auth-signin-unconfigured',
    title: 'Sign in · accounts not set up on this build',
    render: () => signIn({ configured: false }),
  },
];
