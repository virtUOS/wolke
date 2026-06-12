import {
  AppWindow,
  BookOpen,
  Calendar,
  Cloud,
  Database,
  FileText,
  Folder,
  Globe,
  GraduationCap,
  HardDrive,
  KeyRound,
  Laptop,
  LibraryBig,
  Mail,
  MessageSquare,
  Monitor,
  Network,
  NotebookPen,
  PenLine,
  Presentation,
  Server,
  Shield,
  Sparkles,
  Users,
  Video,
  Wifi,
  type LucideIcon,
} from 'lucide-react'

// Curated icon registry (kebab-case names, as stored on services). Keeping an
// explicit map — rather than importing all of lucide — keeps the bundle small
// and defines the set the backend icon allowlist mirrors (CLAUDE.md; expanded as
// the catalog needs). Unknown names fall back to a neutral app icon.
const registry: Record<string, LucideIcon> = {
  'app-window': AppWindow,
  'book-open': BookOpen,
  calendar: Calendar,
  cloud: Cloud,
  database: Database,
  'file-text': FileText,
  folder: Folder,
  globe: Globe,
  'graduation-cap': GraduationCap,
  'hard-drive': HardDrive,
  'key-round': KeyRound,
  laptop: Laptop,
  'library-big': LibraryBig,
  mail: Mail,
  'message-square': MessageSquare,
  monitor: Monitor,
  network: Network,
  'notebook-pen': NotebookPen,
  'pen-line': PenLine,
  presentation: Presentation,
  server: Server,
  shield: Shield,
  sparkles: Sparkles,
  users: Users,
  video: Video,
  wifi: Wifi,
}

export function iconByName(name: string): LucideIcon {
  return registry[name] ?? AppWindow
}

// iconNames is the allowlist of valid icon names (for validation/UI pickers).
export const iconNames = Object.keys(registry)
