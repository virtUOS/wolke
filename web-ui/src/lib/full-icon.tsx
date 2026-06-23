import type { ComponentProps } from 'react'
import { AppWindow, type LucideIcon } from 'lucide-react'
import { iconComponent } from './icon-set'

// Lazy default export: renders any lucide icon from the full set (pulls the
// icon-set chunk). ServiceIcon code-splits this so it loads only for an icon
// outside the curated set; the component lives at module scope so it isn't
// (re)created during render.
export default function FullIcon({ name, ...rest }: { name: string } & Omit<ComponentProps<LucideIcon>, 'ref'>) {
  const Icon = iconComponent(name) ?? AppWindow
  return <Icon {...rest} />
}
