# NyCap v0.1 — 7-Day Codex Execution Playbook (v3 — PWA)
**Owner:** Nick-Yzaf Creations  |  **Build target:** 7 focused days  |  **Release:** Invite-only private pilot

## 0. Project contract — read before every day
**Purpose:** Existing, legally verified shareholders view their holdings across Nick-Yzaf Creations, Nick-Yzaf TV, and Oriwalt Games. Administrators maintain records and publish dated company updates, indicative valuations, and dividend history.

**Locked stack:** Frontend: Vanilla JavaScript (ES modules, lightweight MVC), custom CSS + Bootstrap 5, Chart.js. Backend: Node.js + Express + **TypeScript (simple, strict, readable)**. Database: **PostgreSQL + Prisma**. Validation: Zod. Tests: Vitest, Supertest, Playwright. Use a modular monolith and one deployable web app. **Delivery format: installable Progressive Web App (PWA)** with manifest, service worker, app icons and responsive standalone display.

**Developer learning rule:** Project owner already knows JavaScript/Node.js and MySQL, but is new to TypeScript, PostgreSQL and Prisma. Prefer straightforward types/interfaces, no clever generics or complex abstractions. Explain each unusual TypeScript construct in JavaScript terms, PostgreSQL behavior by comparison with MySQL, and every Prisma migration in plain language. Include exact commands and expected outcomes in handoffs. **TypeScript does not make runtime execution inherently faster**; use it for safety and maintainability.

**PWA contract:** Fully installable on supported browsers (Android/desktop and iOS via Add to Home Screen where supported), with a valid web manifest, 192px/512px maskable icons, a registered service worker, HTTPS, responsive standalone shell, offline fallback, connectivity status, and a tested update flow. Cache only versioned public/static assets and a generic offline page. Use network-only/no-store for authentication, API responses, shareholdings, financial records, user-specific HTML and documents; never persist investor data in Cache Storage, IndexedDB or localStorage. Offline viewing of confidential portfolios is deliberately **out of scope**. Explain that offline mode cannot display or modify private holdings and that browser installation prompts vary.

**Out of scope:** New investments, subscriptions, profit-sharing contracts, trading, transfers, share issuance, wallet, deposits, withdrawals, bank/mobile money/crypto payouts, public registration, live market data, auto-valuations, and outsider listings. Do not add them.

**Data rules:** Only verified legal shareholdings; class-aware ownership; immutable/auditable adjustments; dated valuations explicitly marked indicative, not trading prices; separate dividends declared from dividends paid; missing values stay missing. No fabricated real investor data. A shareholder may read only their own holdings.

**Security baseline:** Server-checked roles and object-level authorization, HttpOnly secure sessions, CSRF mitigation, password hashing, rate limiting, input validation, parameterized ORM access, secret management, HTTPS, and audit logs. Use integer or exact decimal database types for shares/money as appropriate; avoid floating-point financial computations.

**Operating rule:** Execute *one day at a time*. Each day's Codex report must state files changed, migrations, commands actually run, pass/fail test results, known risks, and next dependencies. Do not mark work tested unless executed.

## Day 1 — Scaffold, data model, and secure access
**Goal:** Establish a runnable app and the minimum secure backend foundation.
**Codex prompt:** “Implement Day 1 only. Scaffold an Express + TypeScript API and Vanilla JS frontend with a PWA-ready structure, manifest.webmanifest, 192px/512px icons and an offline fallback page; initialize PostgreSQL + Prisma with pinned compatible versions and a .env.example; add companies, share_classes, users, shareholders, shareholdings and audit_logs as initial models. Create migrations and seed *fictional* sample data only. Implement admin-created/invited users, login/logout, secure server-side sessions, password hashing, role middleware, Zod validation, and auth tests. Document Windows/VS Code setup, PostgreSQL service/database creation, Prisma generate/migrate/seed, and explain any new TypeScript/Prisma syntax in JS/MySQL terms. Stop after Day 1.”
**Deliverables:** Repo, README, .env.example, initial Prisma schema/migration, API auth routes, basic frontend shell, web manifest and icons, offline fallback, tests, docs/ARCHITECTURE.md.
**Gate:** App launches locally; manifest and icons resolve; migrations succeed from empty DB; unauthorized routes blocked; auth tests run and pass.

## Day 2 — Companies, shareholders, and share records
**Goal:** Build reliable administration of the three pilot companies and existing ownership.
**Codex prompt:** “Implement Day 2 only. Build admin CRUD for companies, share classes and shareholder profiles; add verified opening holdings, append-only adjustment events, and ownership percentages based on relevant share classes. Use Prisma transactions, constraints, safe error handling and audit metadata; protect every endpoint with server-side permissions. Explain Prisma relations/transactions using SQL or MySQL analogies. Add tests for negative shares, duplicates, unauthorized edits and ownership math.”
**Deliverables:** Company/shareholder/holding services and admin APIs, migrations, audit trail tests.
**Gate:** Totals reconcile with a small fictional example; corrections are traceable; no cross-account access.

## Day 3 — Shareholder portal (modern fintech)
**Goal:** Deliver the visible product quickly.
**Codex prompt:** “Implement Day 3 only. Build responsive dark fintech UI in Vanilla JS ES modules, custom CSS and Bootstrap 5. Palette: #0D1424, #18243A, #2369E8, #1CC49A, #F2F5FA. Pages: sign-in, overview, my holdings, company details. Add reusable navigation/cards/tables, accessible forms, skeleton/empty/error states and API integration. Show share counts, class and ownership percent; display indicative portfolio value only where published valuations exist, otherwise ‘Not available’. Add a narrowly scoped service worker that caches the static app shell and generic offline page only, registration lifecycle, connection indicator, install affordance when supported, and update-available reload flow. All private routes and API calls must be network-only and not stored in browser caches. Add Playwright mobile, installability, offline-shell and privacy smoke tests. Do not add trading controls.”
**Deliverables:** Responsive installable PWA portal views, manifest/service worker, API integration, smoke tests.
**Gate:** Fictional shareholder sees only their own holdings on desktop and mobile; installability checks pass; offline reveals only the generic shell and no cached shareholder data.

## Day 4 — Company updates, valuations, dividend records
**Goal:** Give shareholders useful, clearly labeled information.
**Codex prompt:** “Implement Day 4 only. Admin may publish company announcements and dated, class-specific indicative per-share valuation snapshots with methodology notes. Display history with Chart.js and explicit ‘not a live market quote’ labeling. Add dividend records distinguishing DECLARED and PAID, with amounts/dates/references; no payment execution. Enforce visibility rules and audit every admin change. Test missing valuation, dates, and declared-versus-paid totals.”
**Deliverables:** Reporting APIs and screens, Chart.js trends, dividend-history UI, tests.
**Gate:** No fake price ticks; no implied payable wallet balance; no missing-data value invented.

## Day 5 — Admin workspace and safe CSV migration
**Goal:** Prepare real records without silent corruption.
**Codex prompt:** “Implement Day 5 only. Finish compact admin UI for companies, shareholder holdings, valuations, announcements and dividends. Provide a documented CSV template for verified opening balances. Build a two-step preview/validate then commit import; check company/share-class mapping, duplicates, invalid quantities, missing IDs, and reconciliation totals; make commits transactional/idempotent where possible. Provide row-level error report and import audit logs. Test repeated uploads and rollback on failure.”
**Deliverables:** Admin screens, CSV template, import preview/commit, reconciliation report, tests.
**Gate:** Test CSV imports reconcile exactly; bad files do not partially change holdings.

## Day 6 — Security, QA, recovery
**Goal:** Eliminate pilot blockers.
**Codex prompt:** “Implement Day 6 only. Run unit/integration/E2E suites and fix critical defects. Audit the service worker caching rules: never cache authenticated API responses, user-specific HTML or sensitive files; test log-out, offline state, storage inspection, update activation, re-open after installation, Android/desktop install criteria and an iOS Add to Home Screen manual checklist. Test horizontal authorization (shareholder A cannot read B), admin authorization, sessions, CSRF controls, password reset/invite flows if implemented, malformed imports, dividend/valuation integrity and audit trails. Configure structured logging without sensitive payloads. Document backup steps and perform a real restore drill in a nonproduction environment. Produce docs/TEST_REPORT.md and docs/DEPLOYMENT.md with actual commands/results. Report any untested areas honestly.”
**Deliverables:** Test report, security fixes, backup/restore evidence, deploy checklist.
**Gate:** No critical authorization/data defects; PWA privacy/install/offline/update tests pass; backup restore has been demonstrated.

## Day 7 — Private deployment and pilot sign-off
**Goal:** Deploy a restricted pilot, not an open financial marketplace.
**Codex prompt:** “Implement Day 7 only. Configure production environment, HTTPS, secure cookies, secrets, DB backups, migration procedure and health checks. Deploy and smoke-test against production-like settings, including HTTPS, service-worker scope, manifest links, cache headers, offline shell and update behavior on the live origin. Import *only human-verified* company/shareholding records and reconcile imported totals against signed source registers. Prepare a PILOT_SIGNOFF.md checklist. Invite a small pilot group only after the project owner approves security, accuracy and restoration checks. If any launch gate fails, document the blocker and do not invite users.”
**Deliverables:** Running restricted deployment if gates pass; PILOT_SIGNOFF.md; operational README and rollback notes.
**Gate:** Human-approved source reconciliation, account isolation, recoverable backups, PWA installation and privacy gates, correct disclosures, owner sign-off.

## Codex daily response template
1. **Completed:** features and files changed.
2. **Database:** migrations, seed data, and any destructive-risk notes.
3. **Validation:** commands actually run, tests passed/failed, manual checks.
4. **Learning notes:** 2–4 TypeScript, Prisma, or PostgreSQL concepts explained using JavaScript/MySQL equivalents.
5. **Risks and next:** unresolved problems, scope decisions, next-day prerequisites.

## Day-7 release decision
**GO** only when verified legal records reconcile, no shareholder can view another's data, valuation dates and statuses are honest, tests and backup restore pass, HTTPS/secrets are configured, PWA installation/offline/privacy tests pass, and the owner signs off. Otherwise **NO-GO**; keep working privately. Future financial features require separate legal/product design.

## PWA acceptance test matrix (required, not optional)
- **Install:** Manifest name/start URL/scope/display/theme/colors/icons validate. Android Chrome and Chromium desktop recognize installability; document iOS Safari Add to Home Screen steps (native prompts are not guaranteed).
- **Offline:** After one successful visit, offline launch renders a branded generic offline shell explaining that shareholder details require connectivity; no stale balances, holdings or dividends are shown.
- **Data privacy:** `CacheStorage`, IndexedDB, localStorage and browser-controlled application caches contain no authenticated API payloads, private pages, investor details or financial documents. Apply `Cache-Control: no-store` to sensitive server responses; don't use service-worker cache-first for API routes.
- **Updates:** A new app version is discoverable; user receives a controlled update/reload option without silently disrupting an in-progress admin form.
- **Security:** HTTPS outside localhost, secure cookie sessions, working logout and session expiration; offline mode never bypasses authentication.
- **Device QA:** Test mobile viewport, touch navigation, standalone launch, icons, and supported browsers; record platform-specific limitations.

**Scope rule:** PWA packaging and static offline shell are mandatory for v0.1, but offline access to financial/account data, push notifications, background sync, and native-store distribution are deferred.
