/**
 * One icon set: lucide, 16px, stroke 1.5. Screens ask for an icon by what it
 * means in BloomLoop; this file is the only place that knows which glyph that is.
 */

import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Building2,
  ChartColumn, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Clock, Copy, Dices,
  DoorOpen, Download, EllipsisVertical, Eye, EyeOff, FileText, FlaskConical, GraduationCap,
  GripVertical, Info, KeyRound, Layers, LayoutDashboard, Link, ListChecks, ListFilter, Lock,
  LogOut, Maximize, Menu, Merge, Minus, Monitor, Moon, Pause, Pencil, Play, Plus, Presentation,
  QrCode, Radio, RefreshCw, Search, Settings, Shield, SlidersHorizontal, Split, Square, Sun,
  Trash2, Undo2, Upload, User, UserPlus, Users, X,
  Sparkles, Timer, Volume2, Target, Flag, LogIn, Wifi, WifiOff, Shuffle, History, Send, House, CircleHelp,
  TrendingUp, TrendingDown, LayoutGrid, List, PanelLeft, Hand, Award, Calendar, Mail, School, Type, ZoomIn,
  Contrast, Hourglass, CircleX, ChevronUp, ChevronLeft, Gauge, Share2, Megaphone, CircleDot, Map,
} from 'lucide-react';

const SET = {
  back: ArrowLeft, forward: ArrowRight, up: ArrowUp, down: ArrowDown, external: ArrowUpRight,
  chevron: ChevronDown, chevronRight: ChevronRight, close: X, menu: Menu, more: EllipsisVertical,
  search: Search, filter: ListFilter, settings: Settings, grip: GripVertical,
  sun: Sun, moon: Moon, logout: LogOut, lock: Lock, key: KeyRound, shield: Shield,

  material: FileText, deck: Presentation, bank: Layers, plan: SlidersHorizontal, write: FlaskConical,
  room: Radio, projector: Monitor, live: Users, qr: QrCode, fullscreen: Maximize,
  dashboard: LayoutDashboard, rooms: DoorOpen, analytics: ChartColumn, book: BookOpen,
  user: User, users: Users, invite: UserPlus, school: GraduationCap, building: Building2,

  upload: Upload, download: Download, copy: Copy, link: Link, edit: Pencil, trash: Trash2,
  refresh: RefreshCw, undo: Undo2, merge: Merge, split: Split, plus: Plus, minus: Minus,
  play: Play, pause: Pause, stop: Square, draw: Dices, checklist: ListChecks,

  check: Check, ok: CircleCheck, alert: CircleAlert, info: Info, clock: Clock, activity: Activity,
  eye: Eye, eyeOff: EyeOff,

  spark: Sparkles, timer: Timer, volume: Volume2, target: Target, flag: Flag, login: LogIn, wifi: Wifi,
  wifiOff: WifiOff, shuffle: Shuffle, history: History, send: Send, home: House, help: CircleHelp,
  trendUp: TrendingUp, trendDown: TrendingDown, grid: LayoutGrid, list: List, sidebar: PanelLeft, hand: Hand,
  award: Award, calendar: Calendar, mail: Mail, classroom: School, type: Type, zoom: ZoomIn, contrast: Contrast,
  hourglass: Hourglass, wrong: CircleX, chevronUp: ChevronUp, chevronLeft: ChevronLeft, gauge: Gauge,
  share: Share2, announce: Megaphone, dot: CircleDot, path: Map,
};

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
  if (!Glyph) return null;
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" className={className} style={{ flex: 'none', ...style }} />;
}
