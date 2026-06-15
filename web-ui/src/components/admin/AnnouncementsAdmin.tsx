import { useState } from 'react'
import type { Announcement, AnnouncementInput, Audience, Severity } from '@/lib/api'
import { useAdminActions, useAdminAnnouncements } from '@/lib/admin-hooks'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { List, ListItem } from '@/components/ui/list'

const SEVERITIES: Severity[] = ['info', 'warning', 'critical']
const AUDIENCES: Audience[] = ['all', 'student', 'teacher', 'staff']

export function AnnouncementsAdmin() {
  const list = useAdminAnnouncements()
  const actions = useAdminActions()
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ankündigungen</h2>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Neue Ankündigung
        </button>
      </div>

      {showForm && (
        <AnnouncementForm
          initial={editing}
          submitting={actions.createAnnouncement.isPending || actions.updateAnnouncement.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={(input) => {
            const done = () => setShowForm(false)
            if (editing) {
              actions.updateAnnouncement.mutate({ id: editing.id, input }, { onSuccess: done })
            } else {
              actions.createAnnouncement.mutate(input, { onSuccess: done })
            }
          }}
        />
      )}

      <List className="text-sm">
        {(list.data?.announcements ?? []).map((a) => (
          <ListItem key={a.id}>
            <Badge variant={severityVariant(a.severity)}>{a.severity}</Badge>
            <span className="min-w-0 flex-1 truncate">{a.title.de}</span>
            <span className="text-xs text-text-muted">{a.audience}{a.ends_at ? ` · bis ${a.ends_at.slice(0, 16).replace('T', ' ')}` : ''}</span>
            <button onClick={() => { setEditing(a); setShowForm(true) }} className="text-primary hover:text-primary-hover">Bearbeiten</button>
          </ListItem>
        ))}
        {(list.data?.announcements ?? []).length === 0 && <ListItem className="text-text-muted">Keine Ankündigungen.</ListItem>}
      </List>
    </div>
  )
}

// Announcement severities map onto the feedback tokens (docs/03 §2): critical
// reads as danger, not brand red, so the brand colour keeps meaning "actionable".
function severityVariant(s: Severity): BadgeProps['variant'] {
  if (s === 'critical') return 'danger'
  if (s === 'warning') return 'warning'
  return 'info'
}

function AnnouncementForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial: Announcement | null
  onSubmit: (input: AnnouncementInput) => void
  onCancel: () => void
  submitting?: boolean
}) {
  const [titleDe, setTitleDe] = useState(initial?.title.de ?? '')
  const [bodyDe, setBodyDe] = useState(initial?.body.de ?? '')
  const [severity, setSeverity] = useState<Severity>(initial?.severity ?? 'info')
  const [audience, setAudience] = useState<Audience>(initial?.audience ?? 'all')
  const [endsAt, setEndsAt] = useState(initial?.ends_at?.slice(0, 16) ?? '') // datetime-local
  const [dismissible, setDismissible] = useState(initial?.dismissible ?? true)

  const valid = titleDe.trim() !== '' && bodyDe.trim() !== ''

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onSubmit({
          title: { de: titleDe.trim() },
          body: { de: bodyDe.trim() },
          severity,
          audience,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          dismissible,
        })
      }}
      className="space-y-3 rounded-md border border-surface p-4"
    >
      <Field label="Titel (de)">
        <Input value={titleDe} onChange={(e) => setTitleDe(e.target.value)} />
      </Field>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Text (de)</span>
        <textarea value={bodyDe} onChange={(e) => setBodyDe(e.target.value)} rows={2} className={input} />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Schweregrad</span>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Zielgruppe</span>
          <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
            {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Endet am (optional)</span>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={select} />
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={dismissible} onChange={(e) => setDismissible(e.target.checked)} />
          Schließbar
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={!valid || submitting} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">
          {initial ? 'Speichern' : 'Veröffentlichen'}
        </button>
        <button type="button" onClick={onCancel} className="h-9 rounded-md border border-surface px-4 text-sm hover:bg-surface">Abbrechen</button>
      </div>
    </form>
  )
}

const input = 'w-full rounded-md border border-surface bg-surface px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]'
const select = 'h-9 rounded-md border border-surface bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]'
