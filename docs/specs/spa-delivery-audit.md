# Audit — SPA delivery and update system (post-incident, 2026-09-10)

Status: **findings, not a plan** · Written 2026-09-10, the day of the incident
Related: #150/#151 (boundary + first recovery), #152/#154 (cache headers), #156/#157
(asset 404), #158/#160 (escape the old worker). Fixes for the open findings in §5 get their
own issues.

The pieces of this system — `internal/web/web.go`, `web-ui/vite.config.ts` (Workbox),
`web-ui/src/lib/pwa-update.ts`, `web-ui/src/lib/icons.tsx`, `web-ui/src/components/UpdateNotice.tsx`
— had only ever been reviewed one at a time. This audit reviewed them as one system, with a
reproducible harness, after a production blank page whose cause had stayed unproven through
three fixes. Two confident explanations were wrong during that incident; this document
separates what was measured from what was reasoned, and says so per finding.

## 1. The incident, and the one fact that explains it

On 2026-09-10 the dashboard blanked in production (Firefox, "content flashes, then stays
blank", reproducible on every reload). The console held one relevant line:

```
Uncaught TypeError: error loading dynamically imported module: https://…/assets/icon-set-Cdv2Vew-.js
```

The puzzle: #151 had added `LazyIconBoundary` around the lazy icon, the deployed image
demonstrably contained it, a by-hand reproduction showed the boundary keeps the page rendered
— and yet the error was *uncaught* and the page was blank.

**The client was not running the boundary.** It was executing the *previous* build's bundle,
served by its own (old) service worker from the precache. A controlled navigation never fetches
the server's shell, so what the server had deployed was irrelevant to that browser. The bundle
it ran had no boundary and no recovery, so the rejected lazy import unmounted the React root.

Evidence:

1. **The hash in the console line identifies the client's build.** Rebuilding the SPA at
   historical `main` commits (`npm ci && npm run build` in throwaway worktrees) reproduces the
   hashes CI shipped — the build is deterministic enough for this:

   | commit | merged (CEST) | `icon-set` chunk |
   |---|---|---|
   | 3e97435 (#147) | 09-09 17:55 | `icon-set-Cdv2Vew-.js` |
   | ea140e0 (#149) | 09-10 10:54 | `icon-set-Cdv2Vew-.js` |
   | ec62179 (#151, the boundary) | 09-10 12:36 | `icon-set-CMjLHNNC.js` |
   | 647be5a (#154) | 09-10 13:09 | `icon-set-CMjLHNNC.js` |
   | a19837c (#157) | 09-10 14:33 | `icon-set-CMjLHNNC.js` |
   | 862a566 (#160) | 09-10 15:01 | `icon-set-B4qTpdbj.js` |

   `Cdv2Vew-` — the hash in the 14:06 CEST report (#156) — is produced only by builds *before*
   #151. The earlier report (#150, 11:10 CEST) named `DeL2hHwx`, an older build still. In both
   cases the browser ran a bundle older than the server's, which is the stale-shell mechanism
   itself. Every build changes `icon-set`'s hash because that chunk imports the React runtime
   from the entry chunk, so any deploy invalidates it.

2. **"Uncaught" is the signature of a missing boundary, not of a special kind of failure.**
   React 19 reports an error that no boundary catches through `reportError`, which Firefox
   prints as `Uncaught TypeError: …`. The same failure inside a boundary is logged with
   `console.error` only, and the page stays rendered. Measured in both engines (§3).

3. **The #156/#158 explanation was wrong.** Both issues state that a module-load failure
   (a 404, or an HTML answer for a module request) "is not a render error, so the boundary
   cannot see it". It is a render error: a rejected `lazy()` import throws at the lazy element
   during render whatever the reason for the rejection, and Vite's preload helper dispatches
   `vite:preloadError` on any `import()` rejection. Measured: with the chunk answered as
   `text/html` 200 (the pre-#157 server behaviour) the boundary held *and* the recovery landed
   on the new build, in both engines. #157 is still correct — a 404 is the honest answer and a
   gone asset must never look like a page — but it did not decide the incident.

Why it was intermittent: `icon-set` is deliberately excluded from the precache
(`globIgnores`), so it is the one chunk a returning client must fetch from the network. If the
browser still holds it in the HTTP cache (`immutable`, one year), the stale build simply works
and the update notice appears normally. Measured.

Why reloading never helped: the reload is a controlled navigation, served by the same worker
from the same precache. The new worker installs and *waits* (prompt mode), and the only UI that
could apply it — `UpdateNotice` — was in the unmounted tree. Such a client recovers only by
closing every tab or PWA window of the origin (the waiting worker activates when the last
client goes away; measured in Chromium), or by a hard reload, or via devtools.

## 2. The browser difference that misled the investigation

**Firefox names the dependency chunk that failed; Chromium names the `import()` target.**

The lazy path is `lazy(() => import('@/lib/full-icon'))`; `full-icon-*.js` is tiny, *is*
precached, and statically imports `icon-set-*.js`, which is not. When `icon-set` cannot load:

| engine | message |
|---|---|
| Firefox | `TypeError: error loading dynamically imported module: …/assets/icon-set-<hash>.js` |
| Chromium | `TypeError: Failed to fetch dynamically imported module: …/assets/full-icon-<hash>.js` |

Only one place in the codebase imports `icon-set` *directly* — the admin icon picker in
`ServiceForm.tsx` — so a Firefox console line naming `icon-set` reads as if the admin form were
involved. It is not; the line is exactly the dashboard's lazy icon failing. Anyone reading a
Firefox console for this class of bug should expect the *innermost* failed URL, not the module
the code asked for. (The admin form's `import('@/lib/icon-set')` has no `.catch`, so for admins
it does add an `Uncaught (in promise)` line of its own; it cannot blank the page.)

Other paths that could make the error uncaught despite a boundary were enumerated and ruled
out: nothing imports `icon-set` statically from the entry chunk; the `<link rel=modulepreload>`
Vite injects for `icon-set` fails silently and is not awaited (only CSS preloads are), so the
preload phase never throws; there is exactly one `lazy()` in the tree and it sits inside the
boundary; effects and event handlers cannot unmount the root.

## 3. Methodology (reproducible; keep for the next incident)

CI cannot see any of this: every e2e run starts with no service worker and no caches, which is
precisely the state that cannot produce a stale shell. The harness below produces it in about a
minute per run. It lived in the session scratchpad; the recipe is what matters.

1. **A stand-in app, not the real one.** A minimal Vite + React 19 app that imports the real
   `web-ui/src/lib/pwa-update.ts` *verbatim* and copies the real `VitePWA` block from
   `vite.config.ts` (prompt mode, `injectRegister: null`, the same `globIgnores`,
   `navigateFallback` and denylist, `cleanupOutdatedCaches`). It renders a build id, whether
   the page is controlled, the guard's state, a lazy icon with the same `full-icon` →
   `icon-set` shape (with `icon-set` made large and importing from the entry chunk so its hash
   changes per build, as in production), and a minimal `UpdateNotice` wired exactly like the
   real one (`useRegisterSW` → `startUpdateChecks`, `provideStaleShellEscape`,
   `declineStaleShellEscape`, `applyUpdate`). Query flags select: boundary / no boundary /
   direct `import()` without catch, and whether the icon renders on load or on click (to keep
   it out of the HTTP cache). The real app needs the API and OIDC to render a tile; the
   stand-in needs nothing.
2. **Three builds with genuinely different hashes**, via `define: { __BUILD__ }` and separate
   `outDir`s (`dist-A`, `dist-B`, `dist-C`).
3. **A Node server mirroring `SPAHandler`'s rules**: shell `no-store`, `sw.js` `no-cache`,
   `assets/*` `public, max-age=31536000, immutable`, 404 for missing `assets/*` and any path
   with a file extension, the shell for extension-less routes. Which `dist-*` it serves is a
   file read per request, so a "deploy" is `echo B > current` while the browser profile
   persists. A `delay` file can slow one URL (used to make the new worker's install exceed the
   ten-second budget). A request log records what actually reached the server.
4. **Persistent browser profiles in both engines** (Playwright `launchPersistentContext`,
   Chromium and Firefox), so the service worker, precache and HTTP cache survive across
   "deploys". Playwright's Firefox had to be installed separately (`npx playwright install
   firefox`); the project's e2e suite only ships Chromium.
5. **Observe, don't infer**: console messages and `pageerror` events, main-frame navigation
   count (a loop shows up as a number), the DOM state (build id, controlled, guard, glyph),
   `getRegistration()` (active/waiting/installing), the precache contents via `caches.keys()`,
   and the server's request log.

Scenario recipe for the #158 shape: load A with the icon *not* rendered (so `icon-set-A` is
not in the HTTP cache), wait for the worker to activate, reload once (now controlled), switch
the server to B, reload (still served by vA), click to render the icon, watch.

## 4. Client states × a deploy

| state at deploy | what happens | recovers? | how verified |
|---|---|---|---|
| No worker (first visit, hard reload, unsupported) | shell is `no-store`, always fetched fresh | yes, trivially | reasoning + headers probed |
| vA controlling, `icon-set` in immutable HTTP cache | stale build keeps working; vB installs and waits; notice shows | yes — click Reload | measured, both engines |
| vA controlling, chunk not in HTTP cache (the #158 shape) | 404 → boundary shows glyph → escape applies waiting vB → reload lands on B, controlled, ~2 s | yes | measured, both engines |
| vA active, tab **uncontrolled** (first load after registering) | 404 → escape → skip-waiting → no `controllerchange` → 1.5 s fallback reload → B, controlled | yes | measured, both engines |
| new worker's install exceeds the 10 s budget | unregister → reload from network → B, uncontrolled, fresh registration | yes, at the cost of a second download | measured, both engines (entry chunk delayed 13 s) |
| vA controlling, vB waiting, then C deploys | Reload click can land on B, already gone; the recovery carried it on to C because the guard was still fresh | yes — once per tab | observed once, Chromium |
| guard spent, next deploy | glyph fallback, page rendered; vC installs → notice → click lands on C | yes, manual | measured, both engines |
| **pre-#151 bundle in an old precache** (the incident) | blank on every load and every plain reload; the notice cannot render | only by closing every tab/PWA window, a hard reload, or devtools | measured: blank + signature in Firefox; last-client-close activation in Chromium |
| offline, or the link drops, before a non-precached chunk arrives | recovery unregisters the worker and reloads into the browser's offline error page; next online load re-registers | degraded — the page *was* rendered with a glyph before the recovery destroyed it | measured, both engines |

Installed standalone windows share every row above in code; none was measured there (§6).

## 5. Findings, ranked by how easily a real user reaches them

1. **`navigateFallback` answers navigations under `/assets/*` and any file-like path with the
   shell.** Measured: in a controlled tab, `GET /assets/does-not-exist.js` and `/logo.png`
   return 200 from the service worker with the SPA shell. Module loads are unaffected —
   Workbox's `NavigationRoute` only matches `mode: 'navigate'` requests, so #157's contract for
   `import()` holds (the 404s reached the server through the worker in every run). But a
   bookmarked or shared asset URL bypasses the server's 404. **Fix:** add `/^\/assets\//` and
   a file-extension pattern to `navigateFallbackDenylist`, with an e2e assertion.
2. **The recovery cannot tell "chunk gone" from "network gone".** Measured offline in both
   engines. In the real app the reach is narrower than in the stand-in, since tiles need the
   catalog from the API first, so connectivity has to drop between the catalog response and the
   icon chunk — a mobile-network shape. **Fix:** gate the unregister branch on a cheap probe
   (`fetch('/sw.js', { cache: 'no-store' })` succeeding) or at least on `navigator.onLine`;
   without a route to the network, leave the worker alone and let the boundary's glyph stand.
3. **The guard is one-shot for the tab's lifetime and never resets after a successful
   landing.** In an installed PWA window that lifetime can be weeks. Nobody is stranded — the
   update notice still arrives and works (measured) — but a second stale event in the same
   window degrades to glyph fallbacks until the notice shows. **Fix:** a timestamp guard (one
   recovery per minute) or clearing the key once the new build has mounted; either keeps the
   loop protection.
4. **Stranded pre-#151 clients exist until they close all tabs.** Any client whose worker
   precached a build older than the #151 merge blanks on every load and has nothing to click.
   Nothing the server does can reach them. Worth a line in the ops notes: "close the app
   completely, then reopen" is the instruction, not "reload".
5. **`updateServiceWorker(true)` cannot leave a half-updated precache.** Workbox's install
   awaits every entry under `waitUntil`; any failure makes the worker redundant. The shared
   `workbox-precache-v2` cache does hold both builds' entries while vB waits (observed side by
   side), and A's entries are deleted at vB's activation. An uncontrolled tab still on A then
   fetches from the network, 404s, and takes the normal boundary-plus-escape path. Verified by
   code reading and the cache listing, not by a forced install failure.
6. **`no-store` on the shell does not disturb precaching or the update check.** Cache Storage
   ignores `Cache-Control`; the shell was precached and served in every run, and the worker's
   own update check bypasses the HTTP cache for `sw.js` anyway. Side effect worth knowing:
   `no-store` on the document disables back/forward cache in both engines.
7. **`GET /index.html?__WB_REVISION__=…` is a 301 to `/`** from `http.FileServer`, which
   canonicalises `index.html`. Probed against `SPAHandler` directly. Workbox copies redirected
   responses into cacheable ones and production precaching demonstrably works: a quirk, not a
   bug, but it explains why the precached shell entry carries `/`'s headers.
8. **The ten-second budget in the installed PWA** runs the same code as a tab.
   `awaitWaitingWorker` calls `registration.update()` itself, so the visibility-change poll is
   not on the critical path. Exceeding the budget is safe (table row 5).

## 6. What I could not verify

- **Installed standalone windows** on Android or iOS. Everything above ran in browser tabs. The
  last-client-close activation and sessionStorage persistence across an OS-killed PWA are spec
  behaviour I did not observe.
- **Firefox last-tab-close recovery.** Closing the only page closed Playwright's context, so
  only Chromium proved that the waiting worker activates on last-client close.
- **The exact server build at the moment of each console line.** The hash evidence proves which
  build the *client* ran; I inferred the server build from merge times, and the conclusion does
  not depend on it.
- **The real app end to end.** The stand-in reuses `pwa-update.ts` and the Workbox config but
  not `UpdateNotice`, `DashboardShell`, or the API. A two-build run of the real binary with a
  persistent profile would close that gap.

## 7. If it recurs

Get the **Network tab** before the console. The discriminating question is whether the entry
chunk (`/assets/index-<hash>.js`) came from the service worker or the network, and which hash
it has: rebuild `main` at the suspected commits and match the hash to find out which build the
*client* was actually running. Only then read the console — and read a Firefox module-loading
message as the innermost failed dependency, not as the module the code imported.
