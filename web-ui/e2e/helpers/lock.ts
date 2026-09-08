// A cross-process mutex for the few e2e flows that must write real server state.
//
// The mock IdP maps every viewport project onto ONE test user, and the six
// projects run in parallel workers. Most specs avoid the resulting races by
// fulfilling writes client-side (see account-menu.spec.ts). A flow whose whole
// point is that a server-side write changes what the server answers next — the
// visibility opt-in — cannot be stubbed, so it serializes across workers with
// this lock instead: an atomic `mkdir` in the OS temp dir, released on exit.
//
// Playwright offers no cross-project serialization short of `workers: 1`, and
// paying that for the whole suite over one spec is the wrong trade.

import { mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** A lock older than this is a crashed worker's leftover, not a live holder. */
const STALE_MS = 90_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `fn` while holding the named lock, waiting (polling) for other holders
 * to finish first. The lock is released even if `fn` throws.
 */
export async function withCrossWorkerLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const dir = path.join(tmpdir(), `wolke-e2e-${name}.lock`)
  for (;;) {
    try {
      mkdirSync(dir)
      break
    } catch {
      // Held by another worker. Reclaim it if the holder evidently died.
      try {
        if (Date.now() - statSync(dir).mtimeMs > STALE_MS) rmSync(dir, { recursive: true, force: true })
      } catch {
        // Vanished between the mkdir and the stat — loop and try again.
      }
      await sleep(250)
    }
  }
  try {
    return await fn()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
