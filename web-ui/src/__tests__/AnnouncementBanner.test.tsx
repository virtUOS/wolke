import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import { api, type Announcement } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const info: Announcement = {
  id: 'a1', title: { de: 'Hinweis' }, body: { de: 'Alles gut.' },
  severity: 'info', audience: 'all', dismissible: true,
}
const critical: Announcement = {
  id: 'a2', title: { de: 'Ausfall' }, body: { de: 'Stud.IP down.' },
  severity: 'critical', audience: 'all', dismissible: true,
}

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('AnnouncementBanner', () => {
  it('renders nothing when empty', () => {
    const { container } = render(withClient(<AnnouncementBanner announcements={[]} locale="de" />))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows title and body in an announced region', () => {
    render(withClient(<AnnouncementBanner announcements={[info]} locale="de" />))
    expect(screen.getByRole('region', { name: 'Ankündigungen' })).toBeInTheDocument()
    expect(screen.getByText('Hinweis')).toBeInTheDocument()
    expect(screen.getByText('Alles gut.')).toBeInTheDocument()
  })

  it('persists a dismissal via the API when closed', async () => {
    const spy = vi.spyOn(api, 'dismissAnnouncement').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(withClient(<AnnouncementBanner announcements={[info]} locale="de" />))
    await user.click(screen.getByRole('button', { name: 'Ankündigung schließen' }))
    expect(spy).toHaveBeenCalledWith('a1')
    spy.mockRestore()
  })

  it('does not allow dismissing a critical announcement', () => {
    render(withClient(<AnnouncementBanner announcements={[critical]} locale="de" />))
    expect(screen.getByText('Ausfall')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ankündigung schließen' })).not.toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = render(withClient(<AnnouncementBanner announcements={[info, critical]} locale="de" />))
    await expectNoAxeViolations(container)
  })
})
