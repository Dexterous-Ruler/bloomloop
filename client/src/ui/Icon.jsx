/**
 * One icon set: lucide, 16px, stroke 1.5. Screens ask for an icon by what it
 * means in BloomLoop; this file and ui/staffIcons.js are the only places that
 * know which glyph that is.
 *
 * Only the icons the student phone draws are here, because this file is in
 * the first download at /join. The console's, the account screens' and the
 * wall's are added by ui/staffIcons.js, which loads with those screens and
 * before any of them renders.
 */

import {
  ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleDot,
  Clock, Eye, GripVertical, Info, KeyRound, LayoutGrid, List, LogOut, Menu, Minus, Moon, Pause,
  Play, Plus, RefreshCw, Send, Square, StickyNote, Sun, Target, Timer, Users, X,
} from 'lucide-react';

const SET = {
  forward: ArrowRight, chevron: ChevronDown, chevronRight: ChevronRight, close: X, menu: Menu,
  grip: GripVertical, sun: Sun, moon: Moon, logout: LogOut, key: KeyRound, book: BookOpen,
  users: Users, refresh: RefreshCw, plus: Plus, minus: Minus, play: Play, pause: Pause,
  stop: Square, check: Check, ok: CircleCheck, alert: CircleAlert, info: Info, clock: Clock,
  eye: Eye, timer: Timer, target: Target, send: Send, grid: LayoutGrid, list: List, dot: CircleDot,
  note: StickyNote,
};

/** Called once by ui/staffIcons.js. */
export function addIcons(more) {
  Object.assign(SET, more);
}


function GoogleMark({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      <path d="M21.6 12.2c0-.7-.06-1.35-.18-2H12v3.9h5.4a4.6 4.6 0 01-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.75-5.6-4.1H3.1v2.6A10 10 0 0012 22zM6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 000 9.2zM12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 003.1 7.4L6.4 10C7.2 7.65 9.4 5.9 12 5.9z" />
    </svg>
  );
}

export default function Icon({ name, size = 16, className, style }) {
  if (name === 'google') return <GoogleMark size={size} />;
  const Glyph = SET[name];
  if (!Glyph) {
    // A name nobody registered draws nothing; in development, say which.
    if (import.meta.env.DEV) console.warn(`Icon "${name}" is not in ui/Icon.jsx or ui/staffIcons.js.`);
    return null;
  }
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" className={className} style={{ flex: 'none', ...style }} />;
}
