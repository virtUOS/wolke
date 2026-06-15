import { useMemo, useState } from 'react'
import { localized, type AdminService, type Category, type Service, type ServiceDraft } from '@/lib/api'
import { iconByName, iconNames } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Beschreibung (Deutsch)">
          <Textarea value={descDe} onChange={(e) => setDescDe(e.target.value)} rows={2} />
        </Field>
        <Field label="Beschreibung (English)">
          <Textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} rows={2} />
        </Field>
        <Field label="Service-URL (leer = nur Dokumentation)">
          <Input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Dokumentations-URL">
          <Input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" />
        </Field>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Kategorien</legend>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <label key={c.slug} className={cn('cursor-pointer rounded-md border px-2 py-1 text-sm', cats.has(c.slug) ? 'border-primary bg-primary text-white' : 'border-border text-text-muted')}>
                <input type="checkbox" className="sr-only" checked={cats.has(c.slug)} onChange={() => toggleCat(c.slug)} />
                {localized(c.label, locale)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Icon</legend>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded-md border border-border p-2">
            {iconNames.map((n) => {
              const Ico = iconByName(n)
              return (
                <IconButton
                  key={n}
                  aria-label={n}
                  aria-pressed={icon === n}
                  title={n}
                  onClick={() => setIcon(n)}
                  className={cn(icon === n && 'bg-primary text-white hover:bg-primary hover:text-white')}
                >
                  <Ico className="h-5 w-5" aria-hidden="true" />
                </IconButton>
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
          <ul className="rounded-md border border-border p-3 text-sm text-text-muted">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
        {error && (
          <Alert variant="danger" role="alert">
            {error}
          </Alert>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={!valid || submitting}>
            {initial ? 'Speichern' : 'Anlegen'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      </div>
    </form>
  )
}

