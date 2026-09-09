import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { localized, type Category, type Localized, type VisibilityEntry } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useAdminActions } from '@/lib/admin-hooks'
import { useMe, useTransientAnnouncement } from '@/lib/hooks'
import { ChoiceChip } from '@/components/ui/choice-chip'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'

// The managed category set (issue #130): rows with edit, delete and ▲/▼
// reordering, plus the create form.
//
// No drag & drop, deliberately — the admin role-defaults editor and the
// favourites *Anordnen* mode (#125) established buttons for exactly the same
// a11y reasons. Reordering writes the whole list through on every move (the
// server validates it as a permutation), so there is no draft order to
// reconcile and no per-row sort arithmetic.
//
// `categories` comes from the catalog query the parent owns; every write
// invalidates it (lib/admin-hooks).

// Slugs are kebab-case (lowercase alphanumerics, hyphen-separated). The rule
// itself lives in /internal/service — enforced for create *and* update — and
// this copy is only the fast feedback path (CLAUDE.md rule 3).
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface Draft {
  /** The slug the row is addressed by; '' while creating. */
  editing: string
  slug: string
  de: string
  en: string
  /** The visibility group restricting the category; '' = public
   *  (docs/specs/service-visibility.md §2.2). */
  visibility: string
}

const emptyDraft: Draft = { editing: '', slug: '', de: '', en: '', visibility: '' }

export function CategoriesAdmin({ categories, locale }: { categories: Category[]; locale: string }) {
  const s = t(locale)
  const actions = useAdminActions()
  const { announcement, announce } = useTransientAnnouncement()
  // The configured groups ride on /api/me; an admin gets every one of them.
  const me = useMe()
  const groups: VisibilityEntry[] = me.data?.visibility.entries ?? []
  const groupLabel = (slug: string) =>
    localized(groups.find((g) => g.slug === slug)?.label, locale) || slug
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  // The order shown, held locally so a move is visible immediately: the catalog
  // refetch that confirms it is a round trip away, and a second click has to
  // build on the first. null = "whatever the catalog says".
  const [order, setOrder] = useState<string[] | null>(null)

  const bySlug = new Map(categories.map((c) => [c.slug, c]))
  // A category created or deleted elsewhere since the last move must not vanish
  // from, or linger in, the list: the local order is filtered against the
  // catalog and anything new is appended (which is where a fresh category's
  // max(sort)+10 puts it anyway).
  const rows = order
    ? [...order.filter((slug) => bySlug.has(slug)), ...categories.filter((c) => !order.includes(c.slug)).map((c) => c.slug)]
        .map((slug) => bySlug.get(slug))
        .filter((c): c is Category => c !== undefined)
    : categories

  // Public, the configured groups, and — if the draft carries one the config
  // dropped — the stale slug, so it can be cleared (review finding 4).
  const visibilityChoices = ['', ...groups.map((g) => g.slug)]
  if (draft.visibility && !visibilityChoices.includes(draft.visibility)) {
    visibilityChoices.push(draft.visibility)
  }

  const label = (c: Category) => localized(c.label, locale)
  const isEditing = draft.editing !== ''
  const slugValid = SLUG_PATTERN.test(draft.slug.trim())
  const complete = slugValid && draft.de.trim() !== '' && draft.en.trim() !== ''
  // Next sort is past the current max (not the last row — a row's position and
  // its sort only agree right after a reorder).
  const nextSort = (categories.length ? Math.max(...categories.map((c) => c.sort)) : 0) + 10

  // Entering edit mode moves focus into the form; leaving it returns focus to
  // the row's edit button, so a keyboard user isn't dropped at <body>.
  const slugInput = useRef<HTMLInputElement>(null)
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  const prevEditing = useRef('')
  useEffect(() => {
    if (draft.editing !== '' && prevEditing.current === '') {
      slugInput.current?.focus()
    } else if (draft.editing === '' && prevEditing.current !== '') {
      editButtons.current.get(prevEditing.current)?.focus()
    }
    prevEditing.current = draft.editing
  }, [draft.editing])

  const failed = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback)

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = rows.map((c) => c.slug)
    ;[next[i], next[j]] = [next[j], next[i]]
    setError(undefined)
    setOrder(next)
    announce(s.admin.categoryMoved(label(rows[i]), j + 1, rows.length))
    actions.setCategoryOrder.mutate(next, {
      // Fall back to the catalog's order rather than showing an arrangement the
      // server rejected.
      onError: (e) => {
        setOrder(null)
        failed(e, s.admin.saveFailed)
      },
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    const next = {
      slug: draft.slug.trim(),
      label: { de: draft.de.trim(), en: draft.en.trim() } as Localized,
      visibility: draft.visibility,
    }
    const onError = (err: unknown) => failed(err, s.admin.failed)
    if (isEditing) {
      actions.updateCategory.mutate(
        { slug: draft.editing, next },
        { onSuccess: () => setDraft(emptyDraft), onError },
      )
    } else {
      actions.createCategory.mutate(
        { ...next, sort: nextSort },
        { onSuccess: () => setDraft(emptyDraft), onError },
      )
    }
  }

  const pendingDelete = confirmDelete === null ? undefined : bySlug.get(confirmDelete)
  const remove = () => {
    if (confirmDelete === null) return
    setError(undefined)
    actions.deleteCategory.mutate(confirmDelete, {
      // The guarded delete answers 409 with the blocking count and the first few
      // service names (issue #130 §2.3). That message is written to be read, so
      // it is shown as-is in the section rather than swallowed.
      onError: (e) => failed(e, s.admin.failed),
      onSettled: () => setConfirmDelete(null),
    })
  }

  return (
    <div className="space-y-4">
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{s.admin.categoriesHeading}</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{s.admin.noCategories}</p>
      ) : (
        <>
          <p className="text-xs text-text-muted">{s.admin.categoryArrangeHint}</p>
          <ol className="space-y-1">
            {rows.map((c, i) => (
              // flex-wrap with a floor on the text column: four controls plus a
              // long German compound do not fit 324px on one line, and the name
              // must not pay for the fixed-width buttons (CLAUDE.md,
              // "Responsive & viewport discipline") — the button group wraps to
              // its own line instead.
              <li
                key={c.slug}
                className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-md border border-surface px-2 py-1 text-sm"
              >
                <span className="min-w-24 flex-1 hyphenate-compound">
                  <span className="mr-1.5 text-text-muted">{i + 1}.</span>
                  <span className="font-medium">{label(c)}</span>{' '}
                  <span className="text-text-muted">({c.slug})</span>
                  {c.visibility && (
                    <>
                      {' '}
                      <span className="rounded-sm bg-surface px-1.5 py-0.5 text-xs text-text-muted">
                        {groupLabel(c.visibility)}
                      </span>
                    </>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <IconButton
                    size="sm"
                    aria-label={`${s.admin.moveUp} – ${label(c)}`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    aria-label={`${s.admin.moveDown} – ${label(c)}`}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                    className="disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <Button
                    ref={(el) => {
                      if (el) editButtons.current.set(c.slug, el)
                      else editButtons.current.delete(c.slug)
                    }}
                    variant="outline"
                    size="sm"
                    className="border-border"
                    onClick={() => {
                      setError(undefined)
                      setDraft({
                        editing: c.slug, slug: c.slug,
                        de: c.label.de ?? '', en: c.label.en ?? '',
                        visibility: c.visibility ?? '',
                      })
                    }}
                  >
                    {s.common.edit}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border hover:border-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,var(--bg))] hover:text-danger"
                    onClick={() => {
                      setError(undefined)
                      setConfirmDelete(c.slug)
                    }}
                  >
                    {s.common.delete}
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      {/* One form for both create and edit — the fields and the slug rule are
          identical, and only one of the two is ever on screen.

          The fields grow instead of sitting at a fixed w-40: edit mode arrives
          prefilled, and a real value ("Identitätsmanagement", or its slug) is
          longer than the create form's placeholder ever was, so a fixed box
          clipped its own content (caught by the viewport suite). min/max keep
          them from collapsing at 324px or sprawling at 1920px — one field per
          line on a phone, three across from the tablet width up.

          text-ellipsis on top of that: no field width can fit every label an
          admin might type, and an ellipsis is both what the overflow rule
          accepts and what should happen on screen — a soft "…" rather than a
          value sliced mid-letter. */}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 max-w-56 flex-1 text-sm">
          <span className="mb-1 block font-medium">{s.admin.slug}</span>
          <Input
            ref={slugInput}
            value={draft.slug}
            onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
            placeholder={s.admin.slugPlaceholder}
            className="w-full text-ellipsis"
            aria-required
            aria-invalid={draft.slug.trim() !== '' && !slugValid}
          />
        </label>
        <label className="min-w-48 max-w-56 flex-1 text-sm">
          <span className="mb-1 block font-medium">{s.admin.labelDe}</span>
          <Input
            value={draft.de}
            onChange={(e) => setDraft((d) => ({ ...d, de: e.target.value }))}
            className="w-full text-ellipsis"
            aria-required
          />
        </label>
        <label className="min-w-48 max-w-56 flex-1 text-sm">
          <span className="mb-1 block font-medium">{s.admin.labelEn}</span>
          <Input
            value={draft.en}
            onChange={(e) => setDraft((d) => ({ ...d, en: e.target.value }))}
            className="w-full text-ellipsis"
            aria-required
          />
        </label>
        {/* The choices are "public" plus every configured group — and, when the
            row being edited carries a group the config no longer defines, that
            slug too. Without it the stale value matches nothing, every save is
            rejected, and the category cannot be un-restricted at all (review
            finding 4). That is also why the whole fieldset renders for a stale
            slug even when the deployment configures no groups. */}
        {visibilityChoices.length > 1 && (
          <fieldset className="min-w-48 flex-1 text-sm">
            <legend className="mb-1 block font-medium">{s.admin.catVisibility}</legend>
            <div className="flex flex-wrap gap-2">
              {visibilityChoices.map((value) => (
                <ChoiceChip
                  key={value}
                  type="radio"
                  name="cat-visibility"
                  value={value}
                  active={draft.visibility === value}
                  checked={draft.visibility === value}
                  onChange={() => setDraft((d) => ({ ...d, visibility: value }))}
                  label={value === '' ? s.admin.visibilityPublic : groupLabel(value)}
                />
              ))}
            </div>
          </fieldset>
        )}
        <Button type="submit" size="sm" disabled={!complete}>
          {isEditing ? s.admin.saveCategory : s.admin.createCategory}
        </Button>
        {isEditing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border"
            onClick={() => {
              setError(undefined)
              setDraft(emptyDraft)
            }}
          >
            {s.common.cancel}
          </Button>
        )}
      </form>
      {visibilityChoices.length > 1 && <p className="text-xs text-text-muted">{s.admin.catVisibilityHint}</p>}
      {draft.slug.trim() !== '' && !slugValid && <p className="text-sm text-danger">{s.admin.slugError}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {/* Polite live region: one message per move, then quiet again — where the
          row landed is the only feedback a button reorder gives (issue #35's
          empty-at-rest rule). */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={s.admin.deleteCategoryTitle}
        description={s.admin.deleteCategoryDesc(pendingDelete ? label(pendingDelete) : '')}
        closeLabel={s.common.close}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {s.common.cancel}
            </Button>
            <Button onClick={remove}>{s.common.delete}</Button>
          </>
        }
      />
    </div>
  )
}
