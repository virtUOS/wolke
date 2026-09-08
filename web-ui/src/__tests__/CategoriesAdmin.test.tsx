import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CategoriesAdmin } from '@/components/admin/CategoriesAdmin'
import { ApiError, api, type Category } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

// In catalog order (sort, then slug) — the order the section renders and the
// order the reorder write sends back.
const categories: Category[] = [
  { slug: 'learning', label: { de: 'Lernmanagement', en: 'Learning' }, sort: 10 },
  { slug: 'teaching', label: { de: 'Lehre', en: 'Teaching' }, sort: 20 },
  { slug: 'data', label: { de: 'Netz & Daten', en: 'Network & Data' }, sort: 30 },
]

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('CategoriesAdmin — edit, delete and reorder (issue #130)', () => {
  it('renders one row per category with its label, slug and actions', async () => {
    const { container } = render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText(/Lernmanagement/)).toBeInTheDocument()
    expect(within(rows[0]).getByText(/learning/)).toBeInTheDocument()
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'Löschen' })).toBeInTheDocument()
    }
    await expectNoAxeViolations(container, ['region'])
  })

  it('edits a label and the slug through PATCH, prefilled from the row', async () => {
    const update = vi.spyOn(api, 'updateCategory').mockResolvedValue({
      slug: 'lernen',
      label: { de: 'Lernen', en: 'Learning' },
      sort: 10,
    })
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    await userEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Bearbeiten' }))

    // The form arrives with the row's current values, not empty.
    const slug = screen.getByLabelText('Slug')
    expect(slug).toHaveValue('learning')
    expect(screen.getByLabelText('Label (de)')).toHaveValue('Lernmanagement')
    expect(screen.getByLabelText('Label (en)')).toHaveValue('Learning')

    await userEvent.clear(slug)
    await userEvent.type(slug, 'lernen')
    await userEvent.clear(screen.getByLabelText('Label (de)'))
    await userEvent.type(screen.getByLabelText('Label (de)'), 'Lernen')
    await userEvent.click(screen.getByRole('button', { name: 'Kategorie speichern' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('learning', { slug: 'lernen', label: { de: 'Lernen', en: 'Learning' } }),
    )
    // Back to the list once it saved.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Kategorie speichern' })).not.toBeInTheDocument())
  })

  it('keeps the frontend slug check as fast feedback, without owning the rule', async () => {
    const update = vi.spyOn(api, 'updateCategory')
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    await userEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Bearbeiten' }))
    const slug = screen.getByLabelText('Slug')
    await userEvent.clear(slug)
    await userEvent.type(slug, 'Foo Bar!!')

    expect(slug).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/nur Kleinbuchstaben/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kategorie speichern' })).toBeDisabled()
    expect(update).not.toHaveBeenCalled()
  })

  it('surfaces a server-side rejection (e.g. a duplicate slug) as an alert, keeping the form open', async () => {
    vi.spyOn(api, 'updateCategory').mockRejectedValue(new ApiError(400, 'slug: already exists ("teaching")'))
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    await userEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Bearbeiten' }))
    const slug = screen.getByLabelText('Slug')
    await userEvent.clear(slug)
    await userEvent.type(slug, 'teaching')
    await userEvent.click(screen.getByRole('button', { name: 'Kategorie speichern' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/already exists/)
    // The admin keeps their input to fix it.
    expect(screen.getByLabelText('Slug')).toHaveValue('teaching')
  })

  it('cancels an edit without writing', async () => {
    const update = vi.spyOn(api, 'updateCategory')
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    await userEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: 'Bearbeiten' }))
    await userEvent.clear(screen.getByLabelText('Label (de)'))
    await userEvent.type(screen.getByLabelText('Label (de)'), 'Etwas anderes')
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(update).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Kategorie speichern' })).not.toBeInTheDocument()
  })

  it('deletes only after the confirm dialog is accepted', async () => {
    const del = vi.spyOn(api, 'deleteCategory').mockResolvedValue(undefined)
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    await userEvent.click(within(screen.getAllByRole('listitem')[2]).getByRole('button', { name: 'Löschen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Kategorie entfernen?' })
    expect(dialog).toHaveTextContent(/Netz & Daten/)

    // Dismissing writes nothing.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
    expect(del).not.toHaveBeenCalled()

    await userEvent.click(within(screen.getAllByRole('listitem')[2]).getByRole('button', { name: 'Löschen' }))
    const again = await screen.findByRole('dialog', { name: 'Kategorie entfernen?' })
    await userEvent.click(within(again).getByRole('button', { name: 'Löschen' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('data'))
  })

  // The 409 the guarded delete returns carries the blocking count and names —
  // it has to be readable in the section, not swallowed or dumped raw.
  it('shows the "still in use" refusal as a readable alert and keeps the category', async () => {
    vi.spyOn(api, 'deleteCategory').mockRejectedValue(
      new ApiError(409, '2 services still use this category: Stud.IP, Webmail. Reassign them first.'),
    )
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    await userEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Löschen' }))
    const dialog = await screen.findByRole('dialog', { name: 'Kategorie entfernen?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('2 services still use this category: Stud.IP, Webmail. Reassign them first.')
    // The dialog is gone but the row is still there.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('reorders with ▲/▼, sending the whole list, and announces the move', async () => {
    const setOrder = vi.spyOn(api, 'setCategoryOrder').mockResolvedValue(undefined)
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    const rows = screen.getAllByRole('listitem')
    // The ends are pinned: nothing above the first, nothing below the last.
    expect(within(rows[0]).getByRole('button', { name: /Nach oben/ })).toBeDisabled()
    expect(within(rows[2]).getByRole('button', { name: /Nach unten/ })).toBeDisabled()

    await userEvent.click(within(rows[2]).getByRole('button', { name: /Nach oben/ }))
    await waitFor(() => expect(setOrder).toHaveBeenCalledWith(['learning', 'data', 'teaching']))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Netz & Daten an Position 2 von 3/))
  })

  it('reports a failed reorder instead of leaving the list silently wrong', async () => {
    vi.spyOn(api, 'setCategoryOrder').mockRejectedValue(new ApiError(400, 'slugs: must list exactly the existing categories'))
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    await userEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: /Nach unten/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/must list exactly the existing categories/)
  })

  it('still creates a category, with the same slug rule', async () => {
    const create = vi.spyOn(api, 'createCategory').mockResolvedValue({
      slug: 'forschung',
      label: { de: 'Forschung', en: 'Research' },
      sort: 40,
    })
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    await userEvent.type(screen.getByLabelText('Slug'), 'forschung')
    await userEvent.type(screen.getByLabelText('Label (de)'), 'Forschung')
    await userEvent.type(screen.getByLabelText('Label (en)'), 'Research')
    await userEvent.click(screen.getByRole('button', { name: 'Kategorie anlegen' }))

    // sort is max(sort)+10, past the current last row.
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('forschung', { de: 'Forschung', en: 'Research' }, 40),
    )
  })

  it('says so when there are no categories yet', () => {
    render(withClient(<CategoriesAdmin categories={[]} locale="de" />))
    expect(screen.getByText('Keine Kategorien.')).toBeInTheDocument()
  })
})
