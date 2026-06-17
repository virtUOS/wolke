import { useState } from 'react'
import type { Announcement, AnnouncementInput, Audience, Severity } from '@/lib/api'
import { useAdminActions, useAdminAnnouncements } from '@/lib/admin-hooks'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Ankündigungen</h2>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}>Neue Ankündigung</Button>
      </div>

      {showForm && (
        <AnnouncementForm
          key={editing?.id ?? 'new'}
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
            <span className="text-xs text-text-muted">{a.audience}{a.ends_at ? ` · bis ${isoToLocalInput(a.ends_at).replace('T', ' ')}` : ''}</span>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(a); setShowForm(true) }}>Bearbeiten</Button>
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

// A <input type="datetime-local"> works in local wall-clock, but the API stores
// UTC ISO. Convert UTC→local here so the value shown matches what the user set,
// and so an edit round-trips through new Date(value).toISOString() without
// shifting by the browser's UTC offset on every save.
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
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
  const [endsAt, setEndsAt] = useState(initial?.ends_at ? isoToLocalInput(initial.ends_at) : '') // datetime-local (local wall-clock)
  const [dismissible, setDismissible] = useState(initial?.dismissible ?? true)

  const valid = titleDe.trim() !== '' && bodyDe.trim() !== ''

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onSubmit({
          // Preserve any non-de locales (e.g. en) the announcement already has;
          // the form only edits de but must not delete the rest (CLAUDE.md i18n).
          title: { ...initial?.title, de: titleDe.trim() },
          body: { ...initial?.body, de: bodyDe.trim() },
          severity,
          audience,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          dismissible,
        })
      }}
      className="space-y-3 rounded-md border border-border p-4"
    >
      <Field label="Titel (de)">
        <Input value={titleDe} onChange={(e) => setTitleDe(e.target.value)} />
      </Field>
      <Field label="Text (de)">
        <Textarea value={bodyDe} onChange={(e) => setBodyDe(e.target.value)} rows={2} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="Schweregrad">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Zielgruppe">
          <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
            {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </Field>
        <Field label="Endet am (optional)">
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={dismissible} onChange={(e) => setDismissible(e.target.checked)} />
          Schließbar
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || submitting}>
          {initial ? 'Speichern' : 'Veröffentlichen'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}
