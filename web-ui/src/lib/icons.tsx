import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
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

// LazyIconBoundary renders `fallback` instead of its children once anything
// below it throws — in practice a lazy chunk that failed to load (issue #150).
// Every redeploy invalidates the hashed chunk names a still-open client is
// holding, and Suspense only covers the *pending* import: a failed one throws
// during render, and with no boundary above it React unmounts the tree, so one
// missing icon blanks the whole dashboard. Caught here it costs a glyph.
// Recovering the stale shell itself is lib/pwa-update's job.
//
// A class is the only way to catch a render error in React; there is no hook
// equivalent. It never resets: the chunk is gone for this page load, and a retry
// loop would just throw again.
export class LazyIconBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// ServiceIcon renders any lucide icon by its kebab-case name: instantly from the
// curated set, or via the lazy full set otherwise (showing app-window until it
// loads, for an unknown name, and if the chunk never arrives).
export function ServiceIcon({ name, ...rest }: { name: string } & IconProps) {
  const Curated = curated[name]
  if (Curated) return <Curated {...rest} />
  // The same glyph for both states, so a slow load and a failed one look alike:
  // the tile keeps its layout either way.
  const fallback = <AppWindow {...rest} />
  return (
    <LazyIconBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <FullIcon name={name} {...rest} />
      </Suspense>
    </LazyIconBoundary>
  )
}
