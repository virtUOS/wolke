import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import type { Announcement } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const info: Announcement = {
  id: 'a1', title: { de: 'Hinweis' }, body: { de: 'Alles gut.' },
  severity: 'info', audience: 'all', dismissible: true,
}
const critical: Announcement = {
  id: 'a2', title: { de: 'Ausfall' }, body: { de: 'Stud.IP down.' },
  severity: 'critical', audience: 'all', dismissible: true,
}

describe('AnnouncementBanner', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<AnnouncementBanner announcements={[]} locale="de" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows title and body in an announced region', () => {
    render(<AnnouncementBanner announcements={[info]} locale="de" />)
    expect(screen.getByRole('region', { name: 'Ankündigungen' })).toBeInTheDocument()
    expect(screen.getByText('Hinweis')).toBeInTheDocument()
    expect(screen.getByText('Alles gut.')).toBeInTheDocument()
  })

  it('dismisses a dismissible announcement', async () => {
    const user = userEvent.setup()
    render(<AnnouncementBanner announcements={[info]} locale="de" />)
    await user.click(screen.getByRole('button', { name: 'Ankündigung schließen' }))
    expect(screen.queryByText('Hinweis')).not.toBeInTheDocument()
  })

  it('does not allow dismissing a critical announcement', () => {
    render(<AnnouncementBanner announcements={[critical]} locale="de" />)
    expect(screen.getByText('Ausfall')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ankündigung schließen' })).not.toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = render(<AnnouncementBanner announcements={[info, critical]} locale="de" />)
    await expectNoAxeViolations(container)
  })
})
