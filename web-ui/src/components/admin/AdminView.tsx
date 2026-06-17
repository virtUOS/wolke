import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Category } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useCatalog } from '@/lib/hooks'
import { IconButton } from '@/components/ui/icon-button'
import { PillButton } from '@/components/ui/pill-button'
import { ServicesAdmin } from './ServicesAdmin'
import { CategoriesAdmin } from './CategoriesAdmin'
import { RoleDefaultsAdmin } from './RoleDefaultsAdmin'
import { AnnouncementsAdmin } from './AnnouncementsAdmin'
import { AuditLog } from './AuditLog'

type Section = 'services' | 'categories' | 'roles' | 'announcements' | 'audit'

export function AdminView({ locale, onExit }: { locale: string; onExit: () => void }) {
  const s = t(locale)
  const catalog = useCatalog()
  const categories: Category[] = catalog.data?.categories ?? []
  const [section, setSection] = useState<Section>('services')

  const tabs: { key: Section; label: string }[] = [
    { key: 'services', label: s.admin.tabServices },
    { key: 'categories', label: s.admin.tabCategories },
    { key: 'roles', label: s.admin.tabRoles },
    { key: 'announcements', label: s.admin.tabAnnouncements },
    { key: 'audit', label: s.admin.tabAudit },
  ]

  return (
    <div>
      <header style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <IconButton onClick={onExit} aria-label={s.admin.back}>
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
            {s.admin.title}
          </h1>
        </div>

        <nav aria-label={s.admin.sections} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {tabs.map((tab) => (
            <PillButton
              key={tab.key}
              active={section === tab.key}
              aria-current={section === tab.key ? 'page' : undefined}
              onClick={() => setSection(tab.key)}
            >
              {tab.label}
            </PillButton>
          ))}
        </nav>
      </header>

      {section === 'services' && <ServicesAdmin categories={categories} locale={locale} />}
      {section === 'categories' && <CategoriesAdmin categories={categories} locale={locale} />}
      {section === 'roles' && <RoleDefaultsAdmin locale={locale} />}
      {section === 'announcements' && <AnnouncementsAdmin locale={locale} />}
      {section === 'audit' && <AuditLog locale={locale} />}
    </div>
  )
}
