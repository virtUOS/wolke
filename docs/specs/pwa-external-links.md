# Concept — external links from the installed PWA (issue #113)

Status: **DECIDED 2026-09-02 — no action for now** (issue #113 closed with the
findings). Revisit if installed-iOS users report the re-login pain in
production, or when the W3C manifest proposal ships (the real fix). The §3
device audit below remains the first step whenever this reopens.
· Owner: supervisor session · Written 2026-09-02

## 1. The problem

In the installed PWA, tapping a service or documentation link opens an
**in-app browser view** instead of the user's real browser. Users want the real
browser — ideally with their SSO session — or at least a choice (#113).

## 2. Platform reality (what the web can and cannot do, as of 2026)

There is **no standard way for a web app to force a link into the system
browser**. What happens to an out-of-scope link from a standalone PWA is decided
by the platform:

- **Android / Chrome**: out-of-scope links open in a **Custom Tab** layered over
  the PWA. Crucially, Custom Tabs **share the Chrome profile and its cookies**,
  so a Keycloak SSO session established in Chrome carries over — services should
  not re-prompt for login. The Custom Tab's own ⋮ menu offers "Open in Chrome".
- **iOS / Safari (added to Home Screen)**: outbound links open an **in-app
  browser overlay**, and the standalone web app runs in a **separate storage
  context from Safari** — cookies, localStorage, service worker are not shared.
  This is where "have to log in again" comes from, and it is a documented,
  long-standing platform limitation, not a wolke bug. Behavior details have
  shifted across iOS versions, which is why §3's audit measures rather than
  assumes.
- Manifest-level fixes (an "open externally" allowlist, an anchor attribute
  hint) are **W3C proposals under discussion, not shipped**.

Blind alleys, ruled out now: user-agent-sniffing link hacks (`window.open`
tricks vary by iOS point release and break silently); changing the manifest
`display` away from `standalone` (kills the installed-app experience #42 just
invested in); wrapper-app schemes (`x-safari-…`) that are undocumented and
rejection-prone.

## 3. Step 0 — device audit (15 minutes, real hardware, fill in this table)

For each device: install the PWA, log in, then tap (a) a service link,
(b) a documentation link. Record:

| Device / OS | Opens where? | SSO carried (service asks for login?) | Escape hatch to real browser visible? | Back to wolke how? |
|---|---|---|---|---|
| Android (Fold 7, Chrome) | | | | |
| Android (second device if available) | | | | |
| iPhone / iPad (Safari-installed) | | | | |

Also note on Android whether the Custom Tab's ⋮ menu shows "Open in Chrome",
and on iOS what the overlay's toolbar offers (Safari icon? share sheet?).

## 4. The option space (decide after the audit)

**A. Accept the platform behavior, polish the edges (recommended baseline).**
If the audit confirms Android carries SSO in the Custom Tab, Android needs
nothing — the in-app presentation is cosmetic and the escape hatch exists in
the platform chrome. Cost: zero code. Document the behavior in the README/FAQ.

**B. iOS mitigation — stop promoting the broken path.** If iOS shows the
isolated overlay (expected): suppress the **install hint** on iOS
(`PwaInstallHint` already has the platform plumbing), because promoting
installation promotes the login-again experience; Safari users who install
manually keep working as today. Cheap, reversible the day Apple fixes the
storage split.

**C. iOS mitigation — explicit "open in browser" affordance.** A secondary
action (long-press menu or a small icon shown only in
`display-mode: standalone` on iOS) that invokes `navigator.share(url)` — the
share sheet reliably offers "Open in Safari" and is the one sanctioned way a
web app can hand a URL to the system. Cost: a new tile affordance + i18n +
viewport states; adds UI noise for one platform's benefit. Only worth it if
the audit shows iOS pain AND analytics/user feedback say installed-iOS usage
is significant.

**D. Per-user setting ("always open in browser").** Not feasible — the
platform does not expose the capability a setting would toggle. Rejected.

## 5. Recommendation

A + B now (pending audit confirmation), C deferred until there is evidence of
meaningful installed-iOS usage, D never. Revisit when the W3C manifest
proposal ships — that is the real fix, and the issue should stay open pinned
to it if A+B feels insufficient.

## 6. After the decision

Implementation handoff (expected: **sonnet, new session** — B is a small
conditional in the install-hint logic plus docs; A is docs only). The audit
table above gets pasted into #113 as a comment either way, so the platform
facts are on the record.

Sources: [web.dev PWA OS integration](https://web.dev/learn/pwa/os-integration),
[netguru on the iOS standalone/Safari cookie split](https://www.netguru.com/blog/how-to-share-session-cookie-or-state-between-pwa-in-standalone-mode-and-safari-on-ios),
[W3C manifest discussion](https://lists.w3.org/Archives/Public/public-webapps-github/2025May/0274.html),
[MDN installable PWAs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
