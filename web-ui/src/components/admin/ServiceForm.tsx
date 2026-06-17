import { useMemo, useState } from 'react'
import { localized, type AdminService, type Category, type Service, type ServiceDraft, type ServiceTag } from '@/lib/api'
import { t } from '@/lib/i18n'
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
  const s = t(locale)
  const [name, setName] = useState(initial?.name ?? '')
  const [descDe, setDescDe] = useState(initial?.description.de ?? '')
  const [descEn, setDescEn] = useState(initial?.description.en ?? '')
  const [serviceUrl, setServiceUrl] = useState(initial?.service_url ?? '')
  const [docUrl, setDocUrl] = useState(initial?.doc_url ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? 'app-window')
  const [cats, setCats] = useState<Set<string>>(new Set(initial?.categories ?? []))
  const [tag, setTag] = useState<ServiceTag | ''>(initial?.tag ?? '')

  const preview: Service = useMemo(
    () => ({
      id: 'preview',
      name: name || s.admin.previewName,
      description: { de: descDe, en: descEn },
      service_url: serviceUrl || undefined,
      doc_url: docUrl || undefined,
      icon,
      categories: [...cats],
      doc_only: serviceUrl.trim() === '',
      tag: tag || undefined,
    }),
    [name, descDe, descEn, serviceUrl, docUrl, icon, cats, tag, s],
  )

  const errors: string[] = []
  if (name.trim() === '') errors.push(s.admin.errNameMissing)
  if (descDe.trim() === '') errors.push(s.admin.errDescMissing)
  if (serviceUrl === '' && docUrl === '') errors.push(s.admin.errUrlRequired)
  if (serviceUrl !== '' && !httpURL(serviceUrl)) errors.push(s.admin.errServiceUrl)
  if (docUrl !== '' && !httpURL(docUrl)) errors.push(s.admin.errDocUrl)
  if (cats.size === 0) errors.push(s.admin.errCategory)
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
      tag,
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <Field label={s.admin.fName}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={s.admin.fDescDe}>
          <Textarea value={descDe} onChange={(e) => setDescDe(e.target.value)} rows={2} />
        </Field>
        <Field label={s.admin.fDescEn}>
          <Textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} rows={2} />
        </Field>
        <Field label={s.admin.fServiceUrl}>
          <Input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label={s.admin.fDocUrl}>
          <Input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" />
        </Field>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">{s.admin.fCategories}</legend>
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
          <legend className="mb-1 text-sm font-medium">{s.admin.fStatus}</legend>
          <div className="flex flex-wrap gap-2">
            {(['', 'beta', 'wartung'] as const).map((value) => (
              <label key={value} className={cn('cursor-pointer rounded-md border px-2 py-1 text-sm', tag === value ? 'border-primary bg-primary text-white' : 'border-border text-text-muted')}>
                <input type="radio" name="tag" className="sr-only" value={value} checked={tag === value} onChange={() => setTag(value)} />
                {value === '' ? s.admin.statusNone : value === 'beta' ? s.admin.statusBeta : s.admin.statusWartung}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">{s.admin.fIcon}</legend>
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
          <p className="mb-2 text-sm font-medium text-text-muted">{s.admin.preview}</p>
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
            {initial ? s.common.save : s.admin.create}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {s.common.cancel}
          </Button>
        </div>
      </div>
    </form>
  )
}

