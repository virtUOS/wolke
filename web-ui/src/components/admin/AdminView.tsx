import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Category } from '@/lib/api'
import { useCatalog } from '@/lib/hooks'
import { IconButton } from '@/components/ui/icon-button'
import { PillButton } from '@/components/ui/pill-button'
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
      <header style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <IconButton onClick={onExit} aria-label="Zurück zum Dashboard">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </IconButton>
          <h1
            style={{
              margin: 0,
              fontFamily: '"Newsreader", Georgia, serif',
              fontWeight: 500,
              fontSize: 32,
              letterSpacing: '-0.015em',
              lineHeight: 1.1,
              color: 'var(--text)',
            }}
          >
            Administration
          </h1>
        </div>

        <nav aria-label="Admin-Bereiche" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TABS.map((t) => (
            <PillButton
              key={t.key}
              active={section === t.key}
              aria-current={section === t.key ? 'page' : undefined}
              onClick={() => setSection(t.key)}
            >
              {t.label}
            </PillButton>
          ))}
        </nav>
      </header>

      {section === 'services' && <ServicesAdmin categories={categories} locale={locale} />}
      {section === 'categories' && <CategoriesAdmin categories={categories} locale={locale} />}
      {section === 'roles' && <RoleDefaultsAdmin />}
      {section === 'announcements' && <AnnouncementsAdmin />}
      {section === 'audit' && <AuditLog />}
    </div>
  )
}
