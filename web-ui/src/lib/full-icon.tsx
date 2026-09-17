import type { ComponentProps } from 'react'
import { AppWindow, type LucideIcon } from 'lucide-react'
import { iconComponent } from './icon-set'

// Lazy default export: renders any lucide icon from the full set (pulls the
// icon-set chunk). ServiceIcon code-splits this so it loads only for an icon
// outside the curated set; the component lives at module scope so it isn't
// (re)created during render.
export default function FullIcon({ name, ...rest }: { name: string } & Omit<ComponentProps<LucideIcon>, 'ref'>) {
  const Icon = iconComponent(name) ?? AppWindow
  // react-hooks/static-components sees a capitalised local bound during render
  // and assumes a component factory, whose fresh identity each render would
  // remount the subtree and drop its state. It is not one: iconComponent()
  // (icon-set.tsx) is `byKebab[name]`, a plain lookup into a map built once at
  // module load from lucide's own `icons` export. Every binding it returns is
  // an existing module-scope component, and the same `name` yields the exact
  // same reference on every render — so there is nothing to remount. The
  // fallback, AppWindow, is a module-scope import for the same reason.
  // eslint-disable-next-line react-hooks/static-components
  return <Icon {...rest} />
}
