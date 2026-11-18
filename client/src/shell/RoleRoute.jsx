/**
 * A route only some roles may open. Not a security boundary - the server
 * decides what a token may read - only a way of sending someone who typed the
 * wrong address to the screen that is theirs.
 *
 * Its own module, loaded lazily by main.jsx: it needs the account, so it pulls
 * in the Supabase client, which a phone at /join must never download.
 */

import { Navigate } from 'react-router-dom';

import { useAccount } from '../lib/auth.js';
import { HOME_FOR } from '../lib/routes.js';
import Waiting from './Waiting.jsx';

export default function RoleRoute({ allow, children }) {
  const { account, loading } = useAccount();
  if (loading) return <Waiting />;
  if (!account) return <Navigate to="/signin" replace />;
  if (!allow.includes(account.role)) return <Navigate to={HOME_FOR[account.role] ?? '/'} replace />;
  return children;
}
