import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Category } from '@/lib/api'
import { useCatalog } from '@/lib/hooks'
import { ServicesAdmin } from './ServicesAdmin'
import { CategoriesAdmin } from './CategoriesAdmin'
import { RoleDefaultsAdmin } from './RoleDefaultsAdmin'
import { AnnouncementsAdmin } from './AnnouncementsAdmin'
import { AuditLog } from './AuditLog'

type Section = 'services' | 'categories' | 'roles' | 'announcements' | 'audit'

const TABS: { key: Section; label: string }[] = [
  { key: 'services', label: 'Dienste' },
  { key: 'categories', label: 'Kategorien' },
  { key: 'roles', label: 'Rollen' },
  { key: 'announcements', label: 'Ankündigungen' },
  { key: 'audit', label: 'Audit' },
]

export function AdminView({ locale, onExit }: { locale: string; onExit: () => void }) {
  const catalog = useCatalog()
  const categories: Category[] = catalog.data?.categories ?? []
  const [section, setSection] = useState<Section>('services')

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <button onClick={onExit} aria-label="Zurück zum Dashboard" className="rounded-md p-2 text-text-muted hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <span aria-hidden="true" className="inline-block h-7 w-1.5 rounded bg-primary" />
          Administration
        </h1>
      </div>

      <nav aria-label="Admin-Bereiche" className="mb-6 flex flex-wrap gap-1 border-b border-surface">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSection(t.key)}
            aria-current={section === t.key ? 'page' : undefined}
            className={
              section === t.key
                ? '-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-text'
                : 'px-3 py-2 text-sm text-text-muted hover:text-text'
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {section === 'services' && <ServicesAdmin categories={categories} locale={locale} />}
      {section === 'categories' && <CategoriesAdmin categories={categories} locale={locale} />}
      {section === 'roles' && <RoleDefaultsAdmin />}
      {section === 'announcements' && <AnnouncementsAdmin />}
      {section === 'audit' && <AuditLog />}
    </div>
  )
}
