/**
 * A short confirmation at the foot of the screen: "Join link copied",
 * "4 drafts added. Review them before they reach a room."
 *
 * For a result that would otherwise go unseen: a copy, or an action whose
 * dialog closes as it finishes. A failure is never a toast: it stays beside
 * the control that failed, until it is dealt with.
 *
 * Staff screens only. AppShell mounts the one Toaster; the phone never loads
 * this file. The dock is always in the page, so a screen reader hears each
 * message (role="status", polite).
 *
 *   import { toast } from '../ui/toast.jsx';
 *   toast('Join link copied');
 */

import { useEffect, useState } from 'react';

import { Icon } from './index.jsx';

const listeners = new Set();

/** Show one short confirmation. A newer one replaces the one on screen. */
export function toast(text) {
  const said = String(text ?? '').trim();
  if (!said) return;
  listeners.forEach((fn) => fn(said));
}

// Long enough to read a dozen words, short enough not to sit on the screen.
const SHOWN_MS = 4000;

export function Toaster() {
  const [item, setItem] = useState(null);

  useEffect(() => {
    const on = (text) => setItem((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);

  useEffect(() => {
    if (!item) return undefined;
    const timer = setTimeout(() => setItem(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [item]);

  return (
    <div className="toast-dock" role="status" aria-live="polite">
      {item && (
        <div key={item.n} className="toast">
          <Icon name="check" size={14} />
          <span>{item.text}</span>
        </div>
      )}
    </div>
  );
}
