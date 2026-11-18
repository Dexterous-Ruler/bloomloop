/**
 * Who is looking at an account screen.
 *
 * Normally that is whoever is signed in. The dev gallery renders the same
 * screens with sample data and no sign-in, so it supplies a stand-in through
 * this context - which is why account screens ask useViewer() for the role and
 * name they display, and not useAccount() directly.
 */

import { createContext, useContext } from 'react';

import { useAccount } from '../lib/auth.js';

export const PreviewAccount = createContext(null);

export function useViewer() {
  const preview = useContext(PreviewAccount);
  const real = useAccount();
  return preview ? { account: preview, loading: false, preview: true } : { ...real, preview: false };
}
