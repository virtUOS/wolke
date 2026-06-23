import { useEffect, useRef, useState } from 'react'
import { localized, localizedInput, type Announcement, type AnnouncementInput, type Audience, type Severity } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useAdminActions, useAdminAnnouncements } from '@/lib/admin-hooks'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { List, ListItem } from '@/components/ui/list'

const SEVERITIES: Severity[] = ['info', 'warning', 'critical']
const AUDIENCES: Audience[] = ['all', 'student', 'teacher', 'staff']

export function AnnouncementsAdmin({ locale }: { locale: string }) {
  const s = t(locale)
  const list = useAdminAnnouncements()
  const actions = useAdminActions()
  // The announcement is a singleton: at most one exists, so manage "the" one.
  const current = list.data?.announcements?.[0] ?? null
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [formError, setFormError] = useState<string | undefined>()

  // Return focus to the heading when the form closes (else it's lost to <body>).
  const headingRef = useRef<HTMLHeadingElement>(null)
  const prevShow = useRef(showForm)
  useEffect(() => {
    if (prevShow.current && !showForm) headingRef.current?.focus()
    prevShow.current = showForm
  }, [showForm])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 ref={headingRef} tabIndex={-1} className="focus:outline-hidden" style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{s.admin.announcementsHeading}</h2>
        {/* Singleton: offer "create" only when none exists and the form is closed. */}
        {!current && !showForm && (
          <Button size="sm" onClick={() => { setEditing(null); setFormError(undefined); setShowForm(true) }}>{s.admin.newAnnouncement}</Button>
        )}
      </div>

      {showForm ? (
        <AnnouncementForm
          key={editing?.id ?? 'new'}
          locale={locale}
          initial={editing}
          error={formError}
          submitting={actions.createAnnouncement.isPending || actions.updateAnnouncement.isPending}
          onCancel={() => { setFormError(undefined); setShowForm(false) }}
          onSubmit={(input) => {
            setFormError(undefined)
            const onSuccess = () => setShowForm(false)
            const onError = (e: unknown) =>
              setFormError(e instanceof Error ? e.message : s.admin.saveFailed)
            if (editing) {
              actions.updateAnnouncement.mutate({ id: editing.id, input }, { onSuccess, onError })
            } else {
              actions.createAnnouncement.mutate(input, { onSuccess, onError })
            }
          }}
        />
      ) : current ? (
        <List className="text-sm">
          <ListItem>
            <Badge variant={severityVariant(current.severity)}>{s.admin.severityLabel(current.severity)}</Badge>
            <span className="min-w-0 flex-1 truncate">{localized(current.title, locale)}</span>
            <span className="text-xs text-text-muted">{s.admin.audienceLabel(current.audience)}{current.ends_at ? ` · ${s.admin.until} ${isoToLocalInput(current.ends_at).replace('T', ' ')}` : ''}</span>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(current); setFormError(undefined); setShowForm(true) }}>{s.common.edit}</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>{s.common.delete}</Button>
          </ListItem>
        </List>
      ) : (
        <p className="text-sm text-text-muted">{s.admin.noAnnouncements}</p>
      )}

      <Dialog
        open={confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(false)}
        title={s.admin.deleteAnnouncementTitle}
        description={s.admin.deleteAnnouncementDesc}
        closeLabel={s.common.close}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>{s.common.cancel}</Button>
            <Button
              onClick={() => current && actions.deleteAnnouncement.mutate(current.id, { onSettled: () => setConfirmDelete(false) })}
            >
              {s.common.delete}
            </Button>
          </>
        }
      />
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
  locale,
  initial,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  locale: string
  initial: Announcement | null
  onSubmit: (input: AnnouncementInput) => void
  onCancel: () => void
  submitting?: boolean
  error?: string
}) {
  const s = t(locale)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  const [titleDe, setTitleDe] = useState(initial?.title.de ?? '')
  const [titleEn, setTitleEn] = useState(initial?.title.en ?? '')
  const [bodyDe, setBodyDe] = useState(initial?.body.de ?? '')
  const [bodyEn, setBodyEn] = useState(initial?.body.en ?? '')
  const [severity, setSeverity] = useState<Severity>(initial?.severity ?? 'info')
  const [audience, setAudience] = useState<Audience>(initial?.audience ?? 'all')
  const [endsAt, setEndsAt] = useState(initial?.ends_at ? isoToLocalInput(initial.ends_at) : '') // datetime-local (local wall-clock)
  const [dismissible, setDismissible] = useState(initial?.dismissible ?? true)

  const valid = titleDe.trim() !== '' && titleEn.trim() !== '' && bodyDe.trim() !== '' && bodyEn.trim() !== ''

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onSubmit({
          // de is required; en is optional. An empty en field clears the
          // translation rather than persisting "" (CLAUDE.md i18n: ship de,
          // keep en wired). Any other locales already present are preserved.
          title: localizedInput(initial?.title, titleDe, titleEn),
          body: localizedInput(initial?.body, bodyDe, bodyEn),
          severity,
          audience,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          dismissible,
        })
      }}
      className="space-y-3 rounded-md border border-border p-4"
    >
      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold focus:outline-hidden">
        {s.admin.announcementForm(!!initial)}
      </h3>
      <Field label={s.admin.fTitleDe} required>
        <Input value={titleDe} onChange={(e) => setTitleDe(e.target.value)} />
      </Field>
      <Field label={s.admin.fTitleEn} required>
        <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
      </Field>
      <Field label={s.admin.fTextDe} required>
        <Textarea value={bodyDe} onChange={(e) => setBodyDe(e.target.value)} rows={2} />
      </Field>
      <Field label={s.admin.fTextEn} required>
        <Textarea value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} rows={2} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label={s.admin.fSeverity}>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((sev) => <option key={sev} value={sev}>{s.admin.severityLabel(sev)}</option>)}
          </Select>
        </Field>
        <Field label={s.admin.fAudience}>
          <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
            {AUDIENCES.map((a) => <option key={a} value={a}>{s.admin.audienceLabel(a)}</option>)}
          </Select>
        </Field>
        <Field label={s.admin.fEndsAt}>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={dismissible} onChange={(e) => setDismissible(e.target.checked)} />
          {s.admin.dismissible}
        </label>
      </div>
      {error && (
        <Alert variant="danger" role="alert">
          {error}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || submitting}>
          {initial ? s.common.save : s.admin.publish}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {s.common.cancel}
        </Button>
      </div>
    </form>
  )
}
