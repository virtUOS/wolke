import { useEffect, useRef, useState } from 'react'
import { localized, localizedInput, type Announcement, type AnnouncementInput, type Audience, type Role, type Severity } from '@/lib/api'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useAdminActions, useAdminAnnouncements } from '@/lib/admin-hooks'
import { useRoles } from '@/lib/hooks'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { List, ListItem } from '@/components/ui/list'

/** An announcement's lifecycle state, computed client-side (docs/01 §4.7): at
 *  most one row can be genuinely live — only the newest can be, since creating
 *  a new one always retires whatever was active (internal/service/announce.go). */
type AnnouncementStatus = 'active' | 'expired' | 'retired'

function announcementStatus(a: Announcement, isNewest: boolean): AnnouncementStatus {
  if (!isNewest) return 'retired'
  const now = Date.now()
  const started = !a.starts_at || new Date(a.starts_at).getTime() <= now
  const ended = !!a.ends_at && new Date(a.ends_at).getTime() <= now
  return started && !ended ? 'active' : 'expired'
}

function statusVariant(status: AnnouncementStatus): BadgeProps['variant'] {
  if (status === 'active') return 'success'
  return 'neutral'
}

const SEVERITIES: Severity[] = ['info', 'warning', 'critical']

// The audience picker is 'all' plus this deployment's roles (added client-side
// from /api/roles — docs/specs/configurable-roles.md §2.3).
const ALL: Audience = 'all'

// audienceName renders an audience: 'all' is a fixed string, a role shows its
// configured label, and a role this deployment no longer defines shows its bare
// slug (the list flags that separately, with a badge).
function audienceName(audience: Audience, roles: Role[], locale: string): string {
  if (audience === ALL) return t(locale).admin.audienceLabel(ALL)
  const role = roles.find((r) => r.slug === audience)
  return role ? localized(role.label, locale) : audience
}

// In the picker there is no room for a badge, so an unconfigured audience says
// why it is listed at all.
function audienceOptionLabel(audience: Audience, roles: Role[], locale: string): string {
  const name = audienceName(audience, roles, locale)
  const known = audience === ALL || roles.some((r) => r.slug === audience)
  return known ? name : `${name} — ${t(locale).admin.audienceUnknown}`
}

// audienceOptions is 'all' + the configured roles, plus the announcement's own
// audience when that is no longer one of them: an editor must be able to open,
// see and fix such a notice, not have the picker silently reassign it on save.
function audienceOptions(roles: Role[], current: Audience | undefined): Audience[] {
  const options: Audience[] = [ALL, ...roles.map((r) => r.slug)]
  return current && !options.includes(current) ? [...options, current] : options
}

export function AnnouncementsAdmin({ locale }: { locale: string }) {
  const s = t(locale)
  const list = useAdminAnnouncements()
  const roles = useRoles()
  const roleList = roles.data ?? []
  const actions = useAdminActions()
  // AdminList returns every retained (non-erased) announcement, newest first
  // (announce.AdminList, limit 100) — the full management view, not just the
  // current one. Creating a new one still retires the current into history
  // rather than destroying it (the server stamps its end time).
  const rows = list.data?.announcements ?? []
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const pendingDelete = rows.find((a) => a.id === confirmDeleteId) ?? null
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
        {/* Creating retires the current active notice into history, so the create
            action is always available (not gated on there being none). */}
        {/* Both entry points wait for /api/roles: an audience picker rendered
            without the configured roles could only offer "all". */}
        {!showForm && (
          <Button size="sm" disabled={!roles.isSuccess} onClick={() => { setEditing(null); setFormError(undefined); setShowForm(true) }}>{s.admin.newAnnouncement}</Button>
        )}
      </div>

      {showForm ? (
        <AnnouncementForm
          key={editing?.id ?? 'new'}
          locale={locale}
          roles={roleList}
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
      ) : rows.length > 0 ? (
        <List className="text-sm">
          {rows.map((a, i) => {
            const status = announcementStatus(a, i === 0)
            const window = windowText(a, s)
            return (
              <ListItem
                key={a.id}
                className={cn('flex-wrap', status === 'active' && 'bg-[color-mix(in_srgb,var(--primary)_6%,var(--bg))]')}
              >
                <Badge variant={statusVariant(status)}>{s.admin.announcementStatusLabel(status)}</Badge>
                <Badge variant={severityVariant(a.severity)}>{s.admin.severityLabel(a.severity)}</Badge>
                <span className="min-w-0 flex-1 truncate hyphenate-compound">{localized(a.title, locale)}</span>
                <span className="text-xs text-text-muted">
                  {audienceName(a.audience, roleList, locale)}
                  {window ? ` · ${window}` : ''}
                </span>
                {a.audience_unknown && <Badge variant="warning">{s.admin.audienceUnknown}</Badge>}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!roles.isSuccess}
                  onClick={() => { setEditing(a); setFormError(undefined); setShowForm(true) }}
                >
                  {s.common.edit}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(a.id)}>{s.common.delete}</Button>
              </ListItem>
            )
          })}
        </List>
      ) : (
        <p className="text-sm text-text-muted">{s.admin.noAnnouncements}</p>
      )}

      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title={s.admin.deleteAnnouncementTitle}
        description={s.admin.deleteAnnouncementDesc(pendingDelete ? localized(pendingDelete.title, locale) : '')}
        closeLabel={s.common.close}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>{s.common.cancel}</Button>
            <Button
              onClick={() =>
                confirmDeleteId &&
                actions.deleteAnnouncement.mutate(confirmDeleteId, { onSettled: () => setConfirmDeleteId(null) })
              }
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

// The validity window shown on a list row: whichever bounds the announcement
// actually has (either side can be open-ended).
function windowText(a: Announcement, s: ReturnType<typeof t>): string {
  const parts: string[] = []
  if (a.starts_at) parts.push(`${s.admin.from} ${isoToLocalInput(a.starts_at).replace('T', ' ')}`)
  if (a.ends_at) parts.push(`${s.admin.until} ${isoToLocalInput(a.ends_at).replace('T', ' ')}`)
  return parts.join(' · ')
}

function AnnouncementForm({
  locale,
  roles,
  initial,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  locale: string
  roles: Role[]
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
  const [audience, setAudience] = useState<Audience>(initial?.audience ?? ALL)
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
          <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
            {audienceOptions(roles, initial?.audience).map((a) => (
              <option key={a} value={a}>{audienceOptionLabel(a, roles, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={s.admin.fEndsAt}>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
        <Checkbox
          label={s.admin.dismissible}
          labelClassName="self-end"
          checked={dismissible}
          onChange={(e) => setDismissible(e.target.checked)}
        />
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
