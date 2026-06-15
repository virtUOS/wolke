import { useState } from 'react'
import { localized, type Category } from '@/lib/api'
import { useAdminActions } from '@/lib/admin-hooks'

export function CategoriesAdmin({ categories, locale }: { categories: Category[]; locale: string }) {
  const actions = useAdminActions()
  const [slug, setSlug] = useState('')
  const [de, setDe] = useState('')
  const [en, setEn] = useState('')
  const [error, setError] = useState<string | undefined>()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    actions.createCategory.mutate(
      { slug: slug.trim(), label: { de: de.trim(), en: en.trim() }, sort: (categories.at(-1)?.sort ?? 0) + 10 },
      {
        onSuccess: () => {
          setSlug('')
          setDe('')
          setEn('')
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Fehlgeschlagen.'),
      },
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Kategorien</h2>
      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.slug} className="rounded-md border border-surface px-2 py-1 text-sm">
            {localized(c.label, locale)} <span className="text-text-muted">({c.slug})</span>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Slug</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="z. B. forschung" className={input} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Label (de)</span>
          <input value={de} onChange={(e) => setDe(e.target.value)} className={input} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Label (en)</span>
          <input value={en} onChange={(e) => setEn(e.target.value)} className={input} />
        </label>
        <button
          type="submit"
          disabled={slug.trim() === '' || de.trim() === ''}
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          Kategorie anlegen
        </button>
      </form>
      {error && <p role="alert" className="text-sm text-text-muted">{error}</p>}
    </div>
  )
}

const input = 'h-9 w-40 rounded-md border border-surface bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]'
