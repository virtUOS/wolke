import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ServiceForm } from '@/components/admin/ServiceForm'
import type { Category } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const categories: Category[] = [{ slug: 'data', label: { de: 'Netz & Daten' }, sort: 10 }]

function setup() {
  const onSubmit = vi.fn()
  render(<ServiceForm categories={categories} locale="de" onSubmit={onSubmit} onCancel={() => {}} />)
  return { onSubmit, user: userEvent.setup() }
}

describe('ServiceForm', () => {
  it('blocks submit until valid and reports what is missing', async () => {
    setup()
    const submit = screen.getByRole('button', { name: 'Anlegen' })
    expect(submit).toBeDisabled()
    expect(screen.getByText(/Name fehlt/)).toBeInTheDocument()
    expect(screen.getByText(/Mindestens eine Kategorie/)).toBeInTheDocument()
  })

  it('reflects the name in the live tile preview', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText(/^Name/), 'MyShare')
    expect(screen.getByText('Vorschau')).toBeInTheDocument()
    // The preview tile shows the typed name as a launch link.
    expect(screen.getByRole('link', { name: /MyShare/ })).toBeInTheDocument()
  })

  it('submits a complete draft', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/^Name/), 'MyShare')
    await user.type(screen.getByLabelText(/^Beschreibung \(Deutsch\)/), 'Netzspeicher.')
    await user.type(screen.getByLabelText(/^Beschreibung \(English\)/), 'Network storage.')
    await user.type(screen.getByLabelText(/Service-URL/), 'https://myshare.example.edu')
    await user.click(screen.getByText('Netz & Daten'))
    await user.click(screen.getByRole('button', { name: 'Anlegen' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'MyShare',
      service_url: 'https://myshare.example.edu',
      categories: ['data'],
    })
  })

  it('collects keywords as chips and submits them', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/^Name/), 'BigBlueButton')
    await user.type(screen.getByLabelText(/^Beschreibung \(Deutsch\)/), 'Web-Konferenzen.')
    await user.type(screen.getByLabelText(/^Beschreibung \(English\)/), 'Web conferencing.')
    await user.type(screen.getByLabelText(/Service-URL/), 'https://bbb.example.edu')
    await user.click(screen.getByText('Netz & Daten'))
    // Enter commits a chip; a trailing typed term is flushed on submit.
    const kw = screen.getByLabelText(/Suchbegriffe/)
    await user.type(kw, 'videokonferenz{Enter}')
    await user.type(kw, 'video conference')
    await user.click(screen.getByRole('button', { name: 'Anlegen' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].keywords).toEqual(['videokonferenz', 'video conference'])
  })

  it('blocks an over-long keyword client-side', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText(/^Name/), 'X')
    await user.type(screen.getByLabelText(/^Beschreibung \(Deutsch\)/), 'Y')
    await user.type(screen.getByLabelText(/^Beschreibung \(English\)/), 'Z')
    await user.type(screen.getByLabelText(/Service-URL/), 'https://x.example.edu')
    await user.click(screen.getByText('Netz & Daten'))
    await user.type(screen.getByLabelText(/Suchbegriffe/), 'x'.repeat(51))
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeDisabled()
    expect(screen.getByText(/höchstens 50 Zeichen/)).toBeInTheDocument()
  })

  it('rejects a non-http URL', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText(/^Name/), 'X')
    await user.type(screen.getByLabelText(/^Beschreibung \(Deutsch\)/), 'Y')
    await user.click(screen.getByText('Netz & Daten'))
    await user.type(screen.getByLabelText(/Service-URL/), 'ftp://nope')
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeDisabled()
    expect(screen.getByText(/http\(s\):\/\//)).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = render(<ServiceForm categories={categories} locale="de" onSubmit={() => {}} onCancel={() => {}} />)
    await expectNoAxeViolations(container)
  })
})
