import { lazy, Suspense, type ComponentProps } from 'react'
import {
  AppWindow, BookOpen, Calendar, Cloud, Database, FileText, Folder, Globe,
  GraduationCap, HardDrive, KeyRound, Laptop, LibraryBig, Mail, MessageSquare,
  Monitor, Network, NotebookPen, PenLine, Presentation, Server, Shield,
  Sparkles, Users, Video, Wifi, type LucideIcon,
} from 'lucide-react'

// Tile icon rendering. A curated set of common catalog icons is bundled
// statically, so a normal user renders the dashboard with NO extra requests and
// never downloads the full lucide library. Names are stored kebab-case, as
// lucide names them (CLAUDE.md: lucide-react for icons).
const curated: Record<string, LucideIcon> = {
  'app-window': AppWindow, 'book-open': BookOpen, calendar: Calendar, cloud: Cloud,
  database: Database, 'file-text': FileText, folder: Folder, globe: Globe,
  'graduation-cap': GraduationCap, 'hard-drive': HardDrive, 'key-round': KeyRound,
  laptop: Laptop, 'library-big': LibraryBig, mail: Mail, 'message-square': MessageSquare,
  monitor: Monitor, network: Network, 'notebook-pen': NotebookPen, 'pen-line': PenLine,
  presentation: Presentation, server: Server, shield: Shield, sparkles: Sparkles,
  users: Users, video: Video, wifi: Wifi,
}

// curatedIconNames seeds the picker's empty-search view, so admins start with a
// sensible set rather than a wall of 1700+ glyphs.
export const curatedIconNames: string[] = Object.keys(curated)

type IconProps = Omit<ComponentProps<LucideIcon>, 'ref'>

// For an icon outside the curated set, lazy-load the full set (one shared chunk,
// also used by the picker) — only users whose catalog actually uses an uncommon
// icon ever fetch it.
const FullIcon = lazy(() => import('@/lib/full-icon'))

// ServiceIcon renders any lucide icon by its kebab-case name: instantly from the
// curated set, or via the lazy full set otherwise (showing app-window until it
// loads, and for an unknown name).
export function ServiceIcon({ name, ...rest }: { name: string } & IconProps) {
  const Curated = curated[name]
  if (Curated) return <Curated {...rest} />
  return (
    <Suspense fallback={<AppWindow {...rest} />}>
      <FullIcon name={name} {...rest} />
    </Suspense>
  )
}
