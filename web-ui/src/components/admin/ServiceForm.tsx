import { useMemo, useState } from 'react'
import { localized, type AdminService, type Category, type Service, type ServiceDraft } from '@/lib/api'
import { iconByName, iconNames } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Tile } from '../Tile'

interface ServiceFormProps {
  categories: Category[]
  locale: string
  initial?: AdminService
  onSubmit: (draft: ServiceDraft) => void
  onCancel: () => void
  submitting?: boolean
  error?: string
}

const httpURL = (s: string) => /^https?:\/\/.+/.test(s)

// Admin create/edit form for a catalog service, with a live tile preview, an
// icon picker, multi-category selection, and URL validation (docs/03 §6). The
// server re-validates authoritatively; this gives immediate feedback.
export function ServiceForm({ categories, locale, initial, onSubmit, onCancel, submitting, error }: ServiceFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [descDe, setDescDe] = useState(initial?.description.de ?? '')
  const [descEn, setDescEn] = useState(initial?.description.en ?? '')
  const [serviceUrl, setServiceUrl] = useState(initial?.service_url ?? '')
  const [docUrl, setDocUrl] = useState(initial?.doc_url ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? 'app-window')
  const [cats, setCats] = useState<Set<string>>(new Set(initial?.categories ?? []))

  const preview: Service = useMemo(
    () => ({
      id: 'preview',
      name: name || 'Dienstname',
      description: { de: descDe, en: descEn },
      service_url: serviceUrl || undefined,
      doc_url: docUrl || undefined,
      icon,
      categories: [...cats],
      doc_only: serviceUrl.trim() === '',
    }),
    [name, descDe, descEn, serviceUrl, docUrl, icon, cats],
  )

  const errors: string[] = []
  if (name.trim() === '') errors.push('Name fehlt.')
  if (descDe.trim() === '') errors.push('Beschreibung (de) fehlt.')
  if (serviceUrl === '' && docUrl === '') errors.push('Service- oder Dokumentations-URL erforderlich.')
  if (serviceUrl !== '' && !httpURL(serviceUrl)) errors.push('Service-URL muss mit http(s):// beginnen.')
  if (docUrl !== '' && !httpURL(docUrl)) errors.push('Dokumentations-URL muss mit http(s):// beginnen.')
  if (cats.size === 0) errors.push('Mindestens eine Kategorie wählen.')
  const valid = errors.length === 0

  const toggleCat = (slug: string) =>
    setCats((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
      } else {
        next.add(slug)
      }
      return next
    })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    onSubmit({
      name: name.trim(),
      description: { de: descDe.trim(), en: descEn.trim() },
      service_url: serviceUrl.trim(),
      doc_url: docUrl.trim(),
      icon,
      categories: [...cats],
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Beschreibung (Deutsch)">
          <textarea value={descDe} onChange={(e) => setDescDe(e.target.value)} rows={2} className={inputCls} />
        </Field>
        <Field label="Beschreibung (English)">
          <textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} rows={2} className={inputCls} />
        </Field>
        <Field label="Service-URL (leer = nur Dokumentation)">
          <input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="https://…" className={inputCls} />
        </Field>
        <Field label="Dokumentations-URL">
          <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" className={inputCls} />
        </Field>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Kategorien</legend>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <label key={c.slug} className={cn('cursor-pointer rounded-md border px-2 py-1 text-sm', cats.has(c.slug) ? 'border-primary bg-primary text-white' : 'border-surface text-text-muted')}>
                <input type="checkbox" className="sr-only" checked={cats.has(c.slug)} onChange={() => toggleCat(c.slug)} />
                {localized(c.label, locale)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Icon</legend>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded-md border border-surface p-2">
            {iconNames.map((n) => {
              const Ico = iconByName(n)
              return (
                <button
                  key={n}
                  type="button"
                  aria-label={n}
                  aria-pressed={icon === n}
                  title={n}
                  onClick={() => setIcon(n)}
                  className={cn('rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]', icon === n ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface')}
                >
                  <Ico className="h-5 w-5" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </fieldset>
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-text-muted">Vorschau</p>
          <div className="max-w-sm">
            <Tile service={preview} categories={categories} locale={locale} />
          </div>
        </div>

        {!valid && (
          <ul className="rounded-md border border-surface p-3 text-sm text-text-muted">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="text-sm text-[var(--warning,#b45309)]">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!valid || submitting}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            {initial ? 'Speichern' : 'Anlegen'}
          </button>
          <button type="button" onClick={onCancel} className="h-9 rounded-md border border-surface px-4 text-sm hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
            Abbrechen
          </button>
        </div>
      </div>
    </form>
  )
}

const inputCls =
  'w-full rounded-md border border-surface bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  )
}
