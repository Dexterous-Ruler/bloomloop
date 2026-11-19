/**
 * Dev builds only, in place of RoleRoute for the hub's routes.
 *
 * The local hub server (scratchpad tools/hubserver.mjs) signs every /api call
 * in as a stand-in account chosen by a cookie, so there is no Supabase session
 * in the browser for RoleRoute to find. This asks the server who it is
 * (/api/auth/me) and hands that account to the screens; when nobody is signed
 * in (the memory server: 401 or 503), a sample account of `role`, so the
 * screens draw and show the server's own sentence.
 */

import { useEffect, useState } from 'react';

import { ROLE_LABEL } from '../lib/routes.js';
import { PreviewAccount } from '../shell/viewer.js';
import Waiting from '../shell/Waiting.jsx';

export default function DevViewer({ allow, role, children }) {
  const [account, setAccount] = useState(undefined);
  useEffect(() => {
    let on = true;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (on) setAccount(b?.account ?? null); })
      .catch(() => { if (on) setAccount(null); });
    return () => { on = false; };
  }, []);
  if (account === undefined) return <Waiting />;
  const who = account && allow.includes(account.role)
    ? account
    : { role, fullName: `Sample ${ROLE_LABEL[role].toLowerCase()}`, email: '' };
  return <PreviewAccount.Provider value={who}>{children}</PreviewAccount.Provider>;
}
