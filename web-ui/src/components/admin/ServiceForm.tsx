import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { localized, type AdminService, type Category, type Service, type ServiceDraft, type ServiceTag } from '@/lib/api'
import { t } from '@/lib/i18n'
import { curatedIconNames } from '@/lib/icons'
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
  const headingRef = useRef<HTMLHeadingElement>(null)
  const errId = useId()
  // Move focus to the form heading when it opens, so a keyboard/SR user lands in
  // the form (which replaces the list) instead of being left on a removed button.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  const [name, setName] = useState(initial?.name ?? '')
  const [descDe, setDescDe] = useState(initial?.description.de ?? '')
  const [descEn, setDescEn] = useState(initial?.description.en ?? '')
  const [serviceUrl, setServiceUrl] = useState(initial?.service_url ?? '')
  const [docUrl, setDocUrl] = useState(initial?.doc_url ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? 'app-window')
  const [iconQuery, setIconQuery] = useState('')
  const [cats, setCats] = useState<Set<string>>(new Set(initial?.categories ?? []))
  const [tag, setTag] = useState<ServiceTag | ''>(initial?.tag ?? '')
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords ?? [])
  const [kwInput, setKwInput] = useState('')

  // The full lucide set loads as ONE lazy chunk only here (admin picker), so
  // searching every icon costs a single request, not one per glyph. Normal users
  // never load it. Until it's ready the picker shows a loading hint.
  const [iconSet, setIconSet] = useState<typeof import('@/lib/icon-set') | null>(null)
  useEffect(() => {
    let alive = true
    void import('@/lib/icon-set').then((m) => alive && setIconSet(m))
    return () => {
      alive = false
    }
  }, [])

  // Empty search shows a curated starter set (always including the current
  // selection); a query filters every icon name, capped for DOM performance
  // (not request count — all glyphs are already in the loaded chunk).
  const iconResults = useMemo(() => {
    const q = iconQuery.trim().toLowerCase()
    if (!q) return curatedIconNames.includes(icon) ? curatedIconNames : [icon, ...curatedIconNames]
    if (!iconSet) return []
    return iconSet.allIconNames.filter((n) => n.includes(q)).slice(0, 80)
  }, [iconQuery, icon, iconSet])

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
  if (descEn.trim() === '') errors.push(s.admin.errDescEnMissing)
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

  // Add the typed term(s) as keyword chips: a comma may separate several at once;
  // blanks and case-insensitive duplicates are dropped (the server normalizes too).
  const addKeywords = (raw: string) => {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length === 0) return
    setKeywords((prev) => {
      const next = [...prev]
      const seen = new Set(prev.map((k) => k.toLowerCase()))
      for (const p of parts) {
        if (!seen.has(p.toLowerCase())) {
          seen.add(p.toLowerCase())
          next.push(p)
        }
      }
      return next
    })
    setKwInput('')
  }

  const removeKeyword = (kw: string) => setKeywords((prev) => prev.filter((k) => k !== kw))

  const onKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addKeywords(kwInput)
    } else if (e.key === 'Backspace' && kwInput === '' && keywords.length > 0) {
      removeKeyword(keywords[keywords.length - 1])
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    // Flush a term left in the input (admin typed it but didn't press Enter).
    const pending = kwInput.trim()
    const finalKeywords =
      pending && !keywords.some((k) => k.toLowerCase() === pending.toLowerCase())
        ? [...keywords, pending]
        : keywords
    onSubmit({
      name: name.trim(),
      description: { de: descDe.trim(), en: descEn.trim() },
      service_url: serviceUrl.trim(),
      doc_url: docUrl.trim(),
      icon,
      categories: [...cats],
      tag,
      keywords: finalKeywords,
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-6 md:grid-cols-2">
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-semibold md:col-span-2 focus:outline-hidden"
      >
        {s.admin.serviceForm(!!initial)}
      </h3>
      <div className="space-y-4">
        <Field label={s.admin.fName} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={s.admin.fDescDe} required>
          <Textarea value={descDe} onChange={(e) => setDescDe(e.target.value)} rows={2} />
        </Field>
        <Field label={s.admin.fDescEn} required>
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
          <legend className="mb-1 text-sm font-medium">{s.admin.fKeywords}</legend>
          <p className="mb-1 text-xs text-text-muted">{s.admin.keywordsHint}</p>
          {keywords.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {keywords.map((kw) => (
                <li key={kw} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-sm">
                  <span>{kw}</span>
                  <button
                    type="button"
                    aria-label={s.admin.keywordRemove(kw)}
                    onClick={() => removeKeyword(kw)}
                    className="grid h-4 w-4 place-items-center rounded text-text-muted hover:text-text focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Input
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={onKeywordKeyDown}
            onBlur={() => addKeywords(kwInput)}
            placeholder={s.admin.keywordsPlaceholder}
            aria-label={s.admin.fKeywords}
          />
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
          <Input
            type="search"
            value={iconQuery}
            onChange={(e) => setIconQuery(e.target.value)}
            placeholder={s.admin.iconSearch}
            aria-label={s.admin.iconSearch}
            className="mb-2"
          />
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded-md border border-border p-2">
            {!iconSet ? (
              <p className="px-1 py-2 text-sm text-text-muted" aria-busy="true">{s.common.loading}</p>
            ) : (
              <>
                {iconResults.map((n) => {
                  const Ico = iconSet.iconComponent(n)
                  if (!Ico) return null
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
                {iconResults.length === 0 && (
                  <p className="px-1 py-2 text-sm text-text-muted">{s.admin.iconNoResults}</p>
                )}
              </>
            )}
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
          <div role="alert" id={errId} className="rounded-md border border-danger p-3 text-sm text-danger">
            <p className="font-medium">{s.admin.errorSummary}</p>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <Alert variant="danger" role="alert">
            {error}
          </Alert>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={!valid || submitting} aria-describedby={!valid ? errId : undefined}>
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

