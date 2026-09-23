// Global setup: put the database's user-side state back to "nobody has logged
// in yet" before the suite runs.
//
// Why this exists (issue #234). The mock IdP maps all six viewport projects
// onto ONE test user, and that user's server-side state — favorites, the prefs
// columns on `users`, announcement dismissals — survives every run. The suite
// assumes a *freshly created* user: role-default favorites seeded, prefs at
// their defaults, no dismissals, no announcements. Nothing established that.
// It held in CI only because the e2e job gets an ephemeral `postgres:17`
// service container, so the user simply did not exist yet at the first login —
// a property of the container, not of the suite. Locally the same database
// survives every run, every crash and every hand-written row.
//
// The failure that motivated this is worth naming, because it is not obvious
// and it is not rare: `users.favorites_seeded` is a flag set at first login,
// when the role defaults are copied into `favorites`. Delete the favorite rows
// (a crashed run mid-write, a hand `delete`, poking at the UI) and the flag
// stays true, so the next login does NOT re-seed. The shared user then has an
// empty Favoriten tab and every spec that reaches for a tile fails — 105 of
// them, at one viewport, none of them about favorites. That is the shape #232's
// verification round hit, and `truncate users cascade` is what cured it.
//
// Scope: user-side state only. The catalog (categories, services,
// service_categories, role_defaults) is hand-curated in dev/seed.sql and is
// what the specs assert against by name, so it is never touched — none of those
// tables carries a foreign key to `users`, so the cascade cannot reach them.
// `announcements` is truncated with the same call because its `created_by`
// makes it part of the cascade anyway, and because the suite's specs stub both
// announcement endpoints on the stated assumption that the environment has none.
//
// This fixes the STARTING state. It is not a replacement for helpers/lock.ts or
// the `betaOff()`-style repairs in the specs: those handle contention between
// workers *within* a run, which is a different problem and still theirs.

import { Client } from 'pg'

/** Same default as the binary under test gets in playwright.config.ts. */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://wolke:devpass@localhost:5432/wolke?sslmode=disable'

export default async function resetUserState(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    // One statement, so the cascade is atomic. CASCADE reaches sessions,
    // favorites, click_events, search_events, announcement_dismissals and
    // audit_log — everything keyed to a user — and stops there.
    await client.query('truncate table users, announcements cascade')
  } finally {
    await client.end()
  }
}
