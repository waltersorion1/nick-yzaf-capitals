# Day 3 report - 21 November 2026 (Africa/Lagos)

## Completed and files

Read the complete `Codex_Playbook.md` and `AGENTS.md`. Implemented Day 3 only, plus the explicitly requested dark/light theme support. The Day 1 placeholder screen is replaced with a working portal, not just backend endpoints.

- Changed `public/index.html`, `public/offline.html`, `public/sw.js`.
- Added `public/assets/api-v2.js`, `views-v2.js`, `portal-v2.js`, `pwa-v2.js`, `portal-v2.css`, `shell-v2.css`.
- Added pinned `@playwright/test` 1.65.1, `test:e2e`, updated lockfile and test-artifact ignores.
- Added `playwright.config.ts`, `tests/e2e/setup.ts`, `server.ts`, `portal.spec.ts`.
- Updated README and architecture notes; added this report.

The portal has sign-in/invitation acceptance, Overview, My holdings, Companies and company details. Cards/tables show actual authorized company/class records, exact share counts, class ownership and verification status. Company details show registered class denominators. Administrators have navigation and a real read-only register overview; editing forms remain Day 5. Shareholders see only their verified records. There are accessible labeled forms, error/retry and empty states, loading skeletons, keyboard focus styling, reduced-motion support and responsive navigation/scrollable tables. HTML output escapes private strings before insertion.

Dark/light mode follows system preference initially and can be changed in the top bar. The choice stays in page memory; no localStorage/sessionStorage/IndexedDB is used. The generic offline page also follows system theme. No trading, transfer, issuance, banking or payment controls were introduced.

## Database and valuation scope

No new migration or normal database change was needed. No real investor data or new seed was imported into the user's database. Browser tests create only clearly fictional fixtures in a disposable migrated test database. Existing Day 2 account/object permissions and exact ownership math remain the source of truth.

There is currently no published valuation API/model, so indicative portfolio value correctly shows **Not available**. No zero valuation, fake prices or chart series were invented. Published valuation history and Chart.js integration remain Day 4 work.

## Executed checks

Environment: Windows, Node 24.13.1, PostgreSQL 17.7 in Docker, Playwright 1.65.1 / Chromium 159.0.8154.6. Tests used isolated PostgreSQL on localhost:55434 and a separate test server on localhost:3103, leaving the user's localhost:5432 database and localhost:3000 app separate.

| Executed command/check | Result |
| --- | --- |
| Complete playbook/instruction/source reads, Git status, Docker status | Initial working tree clean; current API/schema/PWA reviewed |
| `npm install --save-dev --save-exact @playwright/test@1.65.1` | Installed and lockfile updated; no vulnerabilities |
| `npx playwright install chromium` | Chromium, headless shell and required helpers installed |
| `npm run db:migrate` on isolated empty normal/test databases | Existing two migrations applied; no Day 3 migration |
| `npm run build` | Passed |
| `npm test` | **39 tests passed**, 2 files, 10.64 seconds |
| `npm run test:e2e` final run | **18 tests passed**, desktop Chromium and Pixel 7 emulation, 23.4 seconds |
| Chromium CDP `Page.getInstallabilityErrors` in both projects | No installability errors reported; manifest/icons/service worker validated |
| Real worker-version change, registration.update, waiting-worker prompt and activation | Draft input survived until explicit update; activation reloaded; obsolete public cache removed |
| Real offline transition and offline reload | Account/holding DOM cleared; generic branded offline page shown; reconnect revalidated session |
| CacheStorage key/body, localStorage, sessionStorage and IndexedDB inspection | Only allowlisted public assets/generic offline page cached; fixture emails/company/password absent from cached bodies; other storage empty |
| Desktop/mobile screenshots inspected | Navigation, dark portal layout, mobile stacking and internal table scrolling reviewed |
| `npm audit` | Zero vulnerabilities |
| Prettier and `git diff --check` | Authored frontend/test code formatted; whitespace check passed |

The 18 E2E cases (9 each on desktop/mobile) cover real login, own holdings and foreign-ID rejection, company navigation and both theme toggles, administrator register navigation, empty/error/retry behavior, loading skeletons, offline/reconnect, public-only persistent storage, no-store headers, logout/session denial, manifest/icon dimensions, Chromium installability, accessible login failure and real controlled worker update activation. Browser fixtures use real PostgreSQL, sessions and APIs, not mocked account data; only the error-state request is deliberately intercepted.

The worker update test uses a localhost test-only wrapper to serve new worker bytes/cache versions. The normal server never mounts the test helper endpoint. A first run identified an overly broad locator matching the visible details container instead of its hidden content; installation help now has its own paragraph. Visual inspection found a false first-install update banner; updates are now offered only when an existing worker controls the page. Final checks pass with both fixes.

## PWA privacy and lifecycle

The public v2 allowlist contains local versioned ES modules/CSS, Bootstrap, icons and `/offline.html`. Root navigation and all API requests remain network-only/no-store; there is no private HTML or confidential offline portfolio. Offline, logout and pagehide clear in-memory user state, private DOM/title and form fields; render epochs and AbortController prevent late responses restoring stale data. A transient BroadcastChannel signals logout to other tabs without persistent storage. The logout broadcast path exists but multi-tab behavior was not separately automated in this day.

Installation is offered through `beforeinstallprompt` only when the browser provides it; visible browser/iOS instructions cover unsupported prompts. No native dialog is fabricated. A new worker waits for the user to choose Update and reload; forms are not silently disrupted. An accepting reload clears form fields. Theme choices reset to the system preference on a fresh page.

## Learning notes

- ES-module files divide transport/model, views and controller responsibilities without a frontend framework. They execute as ordinary browser JavaScript.
- Hash routes select screens, not permissions. Server-side session/user filters still enforce account isolation; company detail data comes only from authorized API results.
- BigInt formatting preserves whole shares above Number.MAX_SAFE_INTEGER. Server percentages remain decimal strings, and missing valuations remain missing.
- AbortController cancels obsolete fetches; an epoch counter rejects any late result from an old session/view. A service worker is a separate lifecycle: installation, waiting and user-authorized activation are tested independently of login.

## Manual device checklist and remaining limits

Automated Chromium installability checks passed; this does **not** establish actual OS installation or every supported browser. These checks remain unexecuted on physical devices:

- Android Chrome: install, launch standalone, verify maskable icon, sign-in, offline relaunch and update acceptance.
- Desktop Chrome/Edge: install through native browser UI, reopen standalone, verify session expiry/logout and application updates.
- iOS Safari: Share -> Add to Home Screen, launch icon/standalone layout, touch/keyboard behavior, offline fallback and session behavior. Native install prompts vary.
- Production HTTPS/reverse proxy, production secure-cookie behavior on a live origin, backup/restore and full Day 6 privacy/security audit remain later gates.

Tables scroll inside their panel on narrow devices; long register names do not widen the page. Dark/light theme controls were tested via browser state toggles; no real-device contrast/accessibility audit was performed. Data lists stop with an explicit error beyond the existing bounded API pagination window rather than reporting incomplete totals. No adjustment or admin editing forms were added. No deployment was performed. Next dependency is Day 4's published valuation/update/dividend data when requested.

Refresh localhost:3000 to see the new portal. Existing sessions are reused. If an older worker controls the tab, choose Update and reload when offered. No database reset or reseed is needed for this UI update.
