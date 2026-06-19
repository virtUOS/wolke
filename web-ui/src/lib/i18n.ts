// UI chrome strings as {de, en} (CLAUDE.md: ship de, keep en wired). Data strings
// (service names, category labels, announcement bodies) are localized separately
// via `localized()` in api.ts — this catalog is only the app's own chrome.
//
// `de` is the source of truth; `en` is typed `Strings` so a missing/renamed key
// is a compile error. Parameterized strings are functions. Components resolve the
// active locale (from branding.default_locale) once via `t(locale)`.

export type Lang = 'de' | 'en'

export function pickLang(locale: string | undefined): Lang {
  return locale === 'en' ? 'en' : 'de'
}

const de = {
  common: {
    cancel: 'Abbrechen',
    save: 'Speichern',
    loading: 'Lädt…',
    edit: 'Bearbeiten',
    delete: 'Löschen',
    close: 'Schließen',
    skipToContent: 'Zum Inhalt springen',
  },
  topbar: {
    mainNav: 'Hauptnavigation',
    favorites: 'Favoriten',
    services: 'Dienste',
    toLight: 'Helles Design aktivieren',
    toDark: 'Dunkles Design aktivieren',
    openAccount: 'Konto-Menü öffnen',
    account: 'Konto',
    administration: 'Administration',
    logout: 'Abmelden',
  },
  greeting: {
    salutation: (): string => {
      const h = new Date().getHours()
      if (h < 11) return 'Guten Morgen'
      if (h < 18) return 'Guten Tag'
      return 'Guten Abend'
    },
    today: () => formatToday('de-DE'),
    favCount: (n: number) => `${n} ${n === 1 ? 'Favorit' : 'Favoriten'}`,
    maintenanceCount: (n: number) => `${n} ${n === 1 ? 'Dienst' : 'Dienste'} in Wartung`,
  },
  dash: {
    favorites: 'Favoriten',
    searchPlaceholder: 'Dienste durchsuchen…',
    searchLabel: 'Dienste suchen',
    all: 'Alle',
    inMaintenance: 'In Wartung',
    allServices: 'Alle Dienste',
    categoriesCount: (n: number) => `${n} Kategorien`,
    filterCategories: 'Kategorien filtern',
    favEmpty: 'Noch keine Favoriten — markiere Dienste mit dem Stern.',
    searchEmpty: (q: string) => `Keine Dienste für „${q}" gefunden.`,
    resultCount: (n: number) => `${n} ${n === 1 ? 'Dienst' : 'Dienste'}`,
  },
  tile: {
    open: (name: string, docsOnly: boolean) => (docsOnly ? `${name} – Dokumentation öffnen` : `${name} öffnen`),
    // Status + new-tab suffixes folded into the link's accessible name so a
    // screen-reader user hears what a sighted user sees (the badge) and is warned
    // about the new tab. Empty when there's no status.
    status: (tag: string | undefined): string => (tag === 'wartung' ? ' (in Wartung)' : tag === 'beta' ? ' (Beta)' : ''),
    newTab: ' (öffnet in neuem Tab)',
    addFav: (name: string) => `${name} zu Favoriten hinzufügen`,
    removeFav: (name: string) => `${name} aus Favoriten entfernen`,
    beta: 'Beta',
    maintenance: 'Wartung',
    docs: 'Dokumentation', // the docs-only status badge
    docsLink: 'Doku', // the link to external documentation (short)
  },
  catalog: {
    empty: 'Keine Dienste gefunden.',
  },
  announce: {
    region: 'Ankündigungen',
    dismiss: 'Ankündigung schließen',
  },
  admin: {
    back: 'Zurück zum Dashboard',
    title: 'Administration',
    sections: 'Admin-Bereiche',
    tabServices: 'Dienste',
    tabCategories: 'Kategorien',
    tabRoles: 'Rollen',
    tabAnnouncements: 'Ankündigungen',
    tabAudit: 'Audit',
    servicesHeading: 'Dienste',
    newService: 'Neuer Dienst',
    serviceForm: (editing: boolean): string => (editing ? 'Dienst bearbeiten' : 'Neuen Dienst anlegen'),
    announcementForm: (editing: boolean): string => (editing ? 'Ankündigung bearbeiten' : 'Neue Ankündigung'),
    errorSummary: 'Bitte korrigieren:',
    inactive: 'inaktiv',
    noServices: 'Keine Dienste.',
    deleteServiceTitle: 'Dienst löschen?',
    deleteServiceDesc: (name: string) => `„${name}" wird deaktiviert und verschwindet aus dem Katalog.`,
    fName: 'Name',
    fDescDe: 'Beschreibung (Deutsch)',
    fDescEn: 'Beschreibung (English)',
    fServiceUrl: 'Service-URL (leer = nur Dokumentation)',
    fDocUrl: 'Dokumentations-URL',
    fCategories: 'Kategorien',
    fStatus: 'Status-Label',
    statusNone: 'Keins',
    statusBeta: 'Beta',
    statusWartung: 'Wartung',
    fIcon: 'Icon',
    preview: 'Vorschau',
    previewName: 'Dienstname',
    create: 'Anlegen',
    errNameMissing: 'Name fehlt.',
    errDescMissing: 'Beschreibung (de) fehlt.',
    errUrlRequired: 'Service- oder Dokumentations-URL erforderlich.',
    errServiceUrl: 'Service-URL muss mit http(s):// beginnen.',
    errDocUrl: 'Dokumentations-URL muss mit http(s):// beginnen.',
    errCategory: 'Mindestens eine Kategorie wählen.',
    saveFailed: 'Speichern fehlgeschlagen.',
    categoriesHeading: 'Kategorien',
    slug: 'Slug',
    labelDe: 'Label (de)',
    labelEn: 'Label (en)',
    createCategory: 'Kategorie anlegen',
    slugPlaceholder: 'z. B. forschung',
    slugError: 'Slug: nur Kleinbuchstaben, Ziffern und Bindestriche (z. B. „forschung").',
    failed: 'Fehlgeschlagen.',
    announcementsHeading: 'Ankündigungen',
    newAnnouncement: 'Neue Ankündigung',
    noAnnouncements: 'Keine Ankündigungen.',
    until: 'bis',
    fTitleDe: 'Titel (de)',
    fTextDe: 'Text (de)',
    fSeverity: 'Schweregrad',
    fAudience: 'Zielgruppe',
    fEndsAt: 'Endet am (optional)',
    dismissible: 'Schließbar',
    publish: 'Veröffentlichen',
    rolesHeading: 'Rollen-Standardansicht',
    moveUp: 'Nach oben',
    moveDown: 'Nach unten',
    remove: 'Entfernen',
    noRoleDefaults: 'Keine Standarddienste für diese Rolle.',
    add: 'Hinzufügen',
    chooseService: 'Dienst wählen…',
    saved: 'Gespeichert.',
    auditHeading: 'Audit-Log',
    noEntries: 'Keine Einträge.',
  },
}

type Strings = typeof de

const en: Strings = {
  common: {
    cancel: 'Cancel',
    save: 'Save',
    loading: 'Loading…',
    edit: 'Edit',
    delete: 'Delete',
    close: 'Close',
    skipToContent: 'Skip to content',
  },
  topbar: {
    mainNav: 'Main navigation',
    favorites: 'Favorites',
    services: 'Services',
    toLight: 'Switch to light theme',
    toDark: 'Switch to dark theme',
    openAccount: 'Open account menu',
    account: 'Account',
    administration: 'Administration',
    logout: 'Sign out',
  },
  greeting: {
    salutation: () => {
      const h = new Date().getHours()
      if (h < 12) return 'Good morning'
      if (h < 18) return 'Good afternoon'
      return 'Good evening'
    },
    today: () => formatToday('en-GB'),
    favCount: (n: number) => `${n} ${n === 1 ? 'favorite' : 'favorites'}`,
    maintenanceCount: (n: number) => `${n} ${n === 1 ? 'service' : 'services'} in maintenance`,
  },
  dash: {
    favorites: 'Favorites',
    searchPlaceholder: 'Search services…',
    searchLabel: 'Search services',
    all: 'All',
    inMaintenance: 'In maintenance',
    allServices: 'All services',
    categoriesCount: (n: number) => `${n} categories`,
    filterCategories: 'Filter by category',
    favEmpty: 'No favorites yet — mark services with the star.',
    searchEmpty: (q: string) => `No services found for “${q}”.`,
    resultCount: (n: number) => `${n} ${n === 1 ? 'service' : 'services'}`,
  },
  tile: {
    open: (name: string, docsOnly: boolean) => (docsOnly ? `${name} – open documentation` : `Open ${name}`),
    status: (tag: string | undefined) => (tag === 'wartung' ? ' (in maintenance)' : tag === 'beta' ? ' (Beta)' : ''),
    newTab: ' (opens in new tab)',
    addFav: (name: string) => `Add ${name} to favorites`,
    removeFav: (name: string) => `Remove ${name} from favorites`,
    beta: 'Beta',
    maintenance: 'Maintenance',
    docs: 'Documentation', // the docs-only status badge
    docsLink: 'docs', // the link to external documentation (short)
  },
  catalog: {
    empty: 'No services found.',
  },
  announce: {
    region: 'Announcements',
    dismiss: 'Dismiss announcement',
  },
  admin: {
    back: 'Back to dashboard',
    title: 'Administration',
    sections: 'Admin sections',
    tabServices: 'Services',
    tabCategories: 'Categories',
    tabRoles: 'Roles',
    tabAnnouncements: 'Announcements',
    tabAudit: 'Audit',
    servicesHeading: 'Services',
    newService: 'New service',
    serviceForm: (editing: boolean) => (editing ? 'Edit service' : 'Create a service'),
    announcementForm: (editing: boolean) => (editing ? 'Edit announcement' : 'New announcement'),
    errorSummary: 'Please fix:',
    inactive: 'inactive',
    noServices: 'No services.',
    deleteServiceTitle: 'Delete service?',
    deleteServiceDesc: (name: string) => `“${name}” will be deactivated and removed from the catalog.`,
    fName: 'Name',
    fDescDe: 'Description (German)',
    fDescEn: 'Description (English)',
    fServiceUrl: 'Service URL (empty = documentation only)',
    fDocUrl: 'Documentation URL',
    fCategories: 'Categories',
    fStatus: 'Status label',
    statusNone: 'None',
    statusBeta: 'Beta',
    statusWartung: 'Maintenance',
    fIcon: 'Icon',
    preview: 'Preview',
    previewName: 'Service name',
    create: 'Create',
    errNameMissing: 'Name is missing.',
    errDescMissing: 'Description (de) is missing.',
    errUrlRequired: 'A service or documentation URL is required.',
    errServiceUrl: 'Service URL must start with http(s)://.',
    errDocUrl: 'Documentation URL must start with http(s)://.',
    errCategory: 'Choose at least one category.',
    saveFailed: 'Saving failed.',
    categoriesHeading: 'Categories',
    slug: 'Slug',
    labelDe: 'Label (de)',
    labelEn: 'Label (en)',
    createCategory: 'Create category',
    slugPlaceholder: 'e.g. research',
    slugError: 'Slug: lowercase letters, digits and hyphens only (e.g. “research”).',
    failed: 'Failed.',
    announcementsHeading: 'Announcements',
    newAnnouncement: 'New announcement',
    noAnnouncements: 'No announcements.',
    until: 'until',
    fTitleDe: 'Title (de)',
    fTextDe: 'Text (de)',
    fSeverity: 'Severity',
    fAudience: 'Audience',
    fEndsAt: 'Ends at (optional)',
    dismissible: 'Dismissible',
    publish: 'Publish',
    rolesHeading: 'Role default view',
    moveUp: 'Move up',
    moveDown: 'Move down',
    remove: 'Remove',
    noRoleDefaults: 'No default services for this role.',
    add: 'Add',
    chooseService: 'Choose a service…',
    saved: 'Saved.',
    auditHeading: 'Audit log',
    noEntries: 'No entries.',
  },
}

function formatToday(bcp47: string): string {
  try {
    return new Date().toLocaleDateString(bcp47, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

const catalog: Record<Lang, Strings> = { de, en }

// t returns the chrome-string set for the active locale.
export function t(locale: string | undefined): Strings {
  return catalog[pickLang(locale)]
}
