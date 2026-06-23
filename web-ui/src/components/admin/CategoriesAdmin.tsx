import { useState } from 'react'
import { localized, type Category } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useAdminActions } from '@/lib/admin-hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CategoriesAdmin({ categories, locale }: { categories: Category[]; locale: string }) {
  const s = t(locale)
  const actions = useAdminActions()
  const [slug, setSlug] = useState('')
  const [de, setDe] = useState('')
  const [en, setEn] = useState('')
  const [error, setError] = useState<string | undefined>()

  // Slugs are kebab-case (lowercase alphanumerics, hyphen-separated); the server
  // re-validates, this gives immediate feedback.
  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())
  // Next sort is past the current max (not the last array element — the array
  // isn't guaranteed ordered by sort).
  const nextSort = (categories.length ? Math.max(...categories.map((c) => c.sort)) : 0) + 10

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    actions.createCategory.mutate(
      { slug: slug.trim(), label: { de: de.trim(), en: en.trim() }, sort: nextSort },
      {
        onSuccess: () => {
          setSlug('')
          setDe('')
          setEn('')
        },
        onError: (err) => setError(err instanceof Error ? err.message : s.admin.failed),
      },
    )
  }

  return (
    <div className="space-y-4">
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{s.admin.categoriesHeading}</h2>
      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.slug} className="rounded-md border border-surface px-2 py-1 text-sm">
            {localized(c.label, locale)} <span className="text-text-muted">({c.slug})</span>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{s.admin.slug}</span>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={s.admin.slugPlaceholder}
            className="w-40"
            aria-required
            aria-invalid={slug.trim() !== '' && !slugValid}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">{s.admin.labelDe}</span>
          <Input value={de} onChange={(e) => setDe(e.target.value)} className="w-40" aria-required />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">{s.admin.labelEn}</span>
          <Input value={en} onChange={(e) => setEn(e.target.value)} className="w-40" aria-required />
        </label>
        <Button type="submit" size="sm" disabled={!slugValid || de.trim() === '' || en.trim() === ''}>
          {s.admin.createCategory}
        </Button>
      </form>
      {slug.trim() !== '' && !slugValid && (
        <p className="text-sm text-danger">{s.admin.slugError}</p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
