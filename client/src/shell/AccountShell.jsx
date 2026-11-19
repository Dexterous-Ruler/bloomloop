/**
 * The frame for every screen outside the teacher console: the dashboards,
 * rooms, analytics, profile. It works out the dock and the account menu from
 * who is signed in, so those screens only say which item they are.
 *
 *   <AccountShell current="rooms" crumb="All rooms" width="wide"> ... </AccountShell>
 *
 * `current` is one of: 'home' | 'rooms' | 'classes' | 'hub' | 'review' | 'analytics' | 'profile' | 'console'.
 */

import { useNavigate } from 'react-router-dom';

import { teacherKey } from '../lib/api.js';
import { signOut } from '../lib/auth.js';
import { HOME_FOR, ROLE_LABEL } from '../lib/routes.js';
import { LaptopBanner, useLaptop } from '../teach/laptop.jsx';
import AppShell from './AppShell.jsx';
import { useViewer } from './viewer.js';

const HOME_ITEM = {
  hod: { id: 'home', label: 'Department', icon: 'building', group: 'overview' },
  professor: { id: 'home', label: 'Overview', icon: 'dashboard', group: 'overview' },
  student: { id: 'home', label: 'Your progress', icon: 'dashboard', group: 'learn' },
};

const PROFILE = { id: 'profile', label: 'Profile', icon: 'user', group: 'account' };

export function navFor(role, hasKey) {
  if (role === 'student') {
    return [
      HOME_ITEM.student,
      { id: 'hub', label: 'Learning Hub', icon: 'path', group: 'learn' },
      { id: 'analytics', label: 'Strengths and gaps', icon: 'analytics', group: 'learn' },
      { id: 'join', label: 'Join a room', icon: 'room', group: 'learn' },
      PROFILE,
    ];
  }
  if (role === 'hod' || role === 'professor') {
    return [
      HOME_ITEM[role],
      { id: 'rooms', label: 'Rooms', icon: 'rooms', group: 'overview' },
      { id: 'classes', label: 'Classes', icon: 'users', group: 'overview' },
      { id: 'hub', label: 'Learning Hub', icon: 'path', group: 'overview' },
      { id: 'review', label: 'Review answers', icon: 'checklist', group: 'overview' },
      { id: 'analytics', label: 'Analytics', icon: 'analytics', group: 'overview' },
      { id: 'console', label: 'Teacher console', icon: 'material', group: 'teach' },
      PROFILE,
    ];
  }
  // The shared-key path: no account, so only what a key can open.
  return hasKey
    ? [
      { id: 'console', label: 'Teacher console', icon: 'material', group: 'teach' },
      { id: 'rooms', label: 'Rooms', icon: 'rooms', group: 'teach' },
      { id: 'classes', label: 'Classes', icon: 'users', group: 'teach' },
      { id: 'review', label: 'Review answers', icon: 'checklist', group: 'teach' },
      PROFILE,
    ]
    : [];
}

export default function AccountShell({ current, crumb, title, sub, actions, status, width, children }) {
  const navigate = useNavigate();
  const { account, preview } = useViewer();
  const role = account?.role;
  const hasKey = Boolean(teacherKey.get());
  // Phase 7: on a professor's laptop in laptop mode there are no accounts and
  // no hub. Asked once per page, by staff only (the route is staff only).
  const lap = useLaptop(!preview && (account ? role !== 'student' : hasKey));

  const go = (id) => {
    if (id === 'home') navigate(HOME_FOR[role] ?? '/');
    else if (id === 'console') navigate('/');
    else if (id === 'join') navigate('/join');
    // One item, two places: a student's own hub, and staff's view of theirs.
    else if (id === 'hub') navigate(role === 'student' ? '/hub' : '/hubs');
    else navigate(`/${id}`);
  };

  return (
    <AppShell
      crumb={crumb}
      title={title}
      sub={sub}
      actions={actions}
      status={status}
      who={account ? { name: account.fullName || account.email || 'Account', sub: ROLE_LABEL[role] ?? role } : null}
      menu={[
        { id: 'profile', label: 'Profile and connections', icon: 'user', onSelect: () => navigate('/profile') },
        'sep',
        account
          ? { id: 'out', label: 'Sign out', icon: 'logout', onSelect: () => signOut().then(() => navigate('/signin')) }
          : hasKey
            ? { id: 'lock', label: 'Lock the console', icon: 'lock', onSelect: () => { teacherKey.set(''); navigate('/'); } }
            : !lap.laptop && { id: 'in', label: 'Sign in', icon: 'key', onSelect: () => navigate('/signin') },
      ]}
      nav={navFor(role, hasKey).filter((n) => !(lap.laptop && n.id === 'hub'))}
      current={current}
      onNav={go}
      width={width}
      enterKey={current}
      banner={lap.laptop ? <LaptopBanner data={lap.data} onReread={lap.retry} reading={lap.reading} /> : null}
    >
      {children}
    </AppShell>
  );
}
