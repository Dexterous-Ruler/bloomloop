/**
 * The icons only staff screens and the wall draw. Imported by
 * shell/staffStyles.js (which loads with every console and account screen)
 * and by teach/Wall.jsx, so the student phone at /join never downloads them.
 */

import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, Award, Building2, Calendar, ChartColumn,
  ChevronLeft, ChevronUp, CircleHelp, CircleX, ClipboardCheck, Contrast, Copy, Dices, DoorOpen,
  Download, EllipsisVertical, EyeOff, FileText, Flag, FlaskConical, Gauge, GraduationCap, Hand,
  Hash, History, Hourglass, House, Layers, LayoutDashboard, Lightbulb, Link, ListChecks,
  ListFilter, Lock, LogIn, Mail, Map, Maximize, Megaphone, Merge, MessageSquare, Monitor,
  PanelLeft, Pencil, Presentation, QrCode, Radio, School, Search, Settings, Share2, Shield,
  Shuffle, SlidersHorizontal, Sparkles, Split, Trash2, TrendingDown, TrendingUp, Type, Undo2,
  Upload, User, UserPlus, Users, Volume2, Wifi, WifiOff, ZoomIn,
  Printer,
} from 'lucide-react';

import { addIcons } from './Icon.jsx';

addIcons({
  back: ArrowLeft, up: ArrowUp, down: ArrowDown, external: ArrowUpRight, more: EllipsisVertical,
  search: Search, filter: ListFilter, settings: Settings, lock: Lock, shield: Shield,
  material: FileText, deck: Presentation, bank: Layers, plan: SlidersHorizontal,
  write: FlaskConical, room: Radio, projector: Monitor, live: Users, qr: QrCode,
  fullscreen: Maximize, dashboard: LayoutDashboard, rooms: DoorOpen, analytics: ChartColumn,
  user: User, invite: UserPlus, school: GraduationCap, building: Building2, upload: Upload,
  download: Download, copy: Copy, link: Link, edit: Pencil, trash: Trash2, undo: Undo2,
  merge: Merge, split: Split, draw: Dices, checklist: ListChecks, activity: Activity,
  eyeOff: EyeOff, spark: Sparkles, volume: Volume2, flag: Flag, login: LogIn, wifi: Wifi,
  wifiOff: WifiOff, shuffle: Shuffle, history: History, home: House, help: CircleHelp,
  trendUp: TrendingUp, trendDown: TrendingDown, sidebar: PanelLeft, hand: Hand, award: Award,
  calendar: Calendar, mail: Mail, classroom: School, type: Type, zoom: ZoomIn, contrast: Contrast,
  hourglass: Hourglass, wrong: CircleX, chevronUp: ChevronUp, chevronLeft: ChevronLeft,
  gauge: Gauge, share: Share2, announce: Megaphone, path: Map, attendance: ClipboardCheck,
  idea: Lightbulb, ask: MessageSquare, hash: Hash,
  print: Printer,
});
