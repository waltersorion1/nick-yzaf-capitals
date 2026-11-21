# Day 2 report - 21 November 2026 (Africa/Lagos)

## Completed

Read the complete `Codex_Playbook.md` and repository `AGENTS.md`. Implemented Day 2 only. No frontend/PWA behavior, Day 3 screens, CSV imports, valuations, transfers, issuance, trades or payment features were added.

Changed `src/app.ts` to mount protected record routes, generate request IDs, serialize exact share quantities and map safe record errors. Added `src/records/common.ts`, `validation.ts`, `service.ts`, and `routes.ts` for admin company/class/profile CRUD, verified openings, append-only corrections, legacy verification, self-only holdings, class ownership/reconciliation and audit reads. Updated `prisma/schema.prisma` and `prisma/seed.ts`; added `prisma/migrations/202611210002_day2/migration.sql` and `tests/records.test.ts`. Updated README and architecture notes; added `docs/DAY2_API.md` and this report. Dependencies and lockfile were unchanged.

All administrative record reads/writes check an active server-loaded ADMIN identity. Every mutation uses the existing CSRF/origin protections. Shareholder reads filter by the session user inside the database query and hide unverified holdings. Private APIs remain no-store; no browser persistence was added.

## Database

The additive Day 2 migration adds holding events, per-holding sequences, source/verification metadata and richer audit metadata. It preserves all existing quantities as explicitly unverified LEGACY_BASELINE events, without fabricating an actor or source document. A source-backed zero-delta VERIFICATION event is required to expose legacy balances to shareholders. Fresh OPENING and subsequent ADJUSTMENT events apply their snapshots and audits atomically.

Constraints/triggers prevent negative or over-cap holdings, direct snapshot rewrites, class/profile identity reassignment, ledger/audit UPDATE/DELETE/TRUNCATE and deletion of referenced records. A class row lock serializes concurrent writes. Repeatable-read transactions keep ownership/reconciliation reads consistent. An existing over-allocated class aborts and rolls back the migration rather than silently modifying balances. See the API document for failed-migration recovery instructions.

The normal local database at localhost:5432 successfully applied `202611210002_day2`. `npx prisma migrate status` reports both migrations present and schema up to date. No seed was run against that normal database and no existing quantities were changed. Prior Day 1 snapshots remain verification-required. No new real investor records were created.

## Executed validation

All register/auth tests used an isolated Docker PostgreSQL 17.7 instance on localhost:55433 with random temporary credentials; the user's existing database/container on port 5432 was not used for test fixtures. Only the tested additive migration was applied to the normal local DB afterwards.

| Command or check actually executed | Result |
| --- | --- |
| Full playbook/instruction/source reads, `git status --short`, `docker ps` | Inspected before implementation; clean initial working tree |
| `npx prisma format`, `npm run db:generate` / `npx prisma generate` | Schema formatted and Client generated |
| Schema-to-schema `npx prisma migrate diff` | Initial additive SQL generated; reviewed and extended with ledger guards/backfill/atomic transaction |
| `npm run db:migrate` on an empty isolated database | Both migrations applied successfully |
| Day 1 fixture initialization, migration bookkeeping, then `npm run db:migrate` | Existing quantity 100 preserved as unverified legacy baseline; Day 2 applied successfully |
| Temporary upgrade integration helper against real app/session store | Hidden before verification; premature correction denied; profile evidence and baseline verification accepted; repeated verification denied; quantity stayed 100; ownership became 10.000000; ledger reconciled |
| Temporary inconsistent Day 1 fixture (1 recorded share, class total 0), execute Day 2 SQL | Migration rejected; transaction rolled back; original quantity retained and ledger table absent |
| `npm run db:seed` twice in isolated databases | Fictional fixtures created through ledger; reruns preserve quantities and credentials |
| `npm test` using separate isolated development/test URLs | 39 tests passed across auth and record suites; final run 10.29 seconds |
| `npm run build` | TypeScript compilation passed |
| `npx prisma validate` | Schema valid |
| `npm audit` | Zero vulnerabilities reported |
| Compiled-server launch, real HTTP fetches and graceful shutdown | Shell/manifest/icons/offline/worker 200; unauthenticated admin companies and own holdings 401; all no-store; process exited successfully |
| `npm run db:migrate`, `npx prisma migrate status` with normal local `.env` | Day 2 applied; database up to date |
| Formatting and `git diff --check` | Authored code formatted; final whitespace check completed before commit |

The record tests cover CRUD and audit before/after metadata; every administrator route for guests/shareholders; CSRF; cross-account IDs and identity-injection queries; malformed, negative, fractional, numeric and oversized shares; duplicate companies/classes/profiles/openings; missing verification/evidence and future dates; traceable corrections; negative/over-cap rollback; referenced-record retention; direct snapshot/ledger mutation and bulk-truncation rejection; concurrent corrections and competing openings; exact arithmetic above Number.MAX_SAFE_INTEGER; zero balances/denominators; safe missing-record/foreign-key errors; pagination; audit-failure rollback and one audit per event. The existing 19 auth tests remain included.

A fictional Ordinary-class example reconciled 100 + 200 = 300 of 1000 issued shares. Corrections +50 and -20 produced 130 for the first holder, 330 recorded/ledger shares, and 13.000000 percent for that holder. Concurrent +10 and +20 both persisted, producing 160 and class total 360. Separately, 25 of 100 Preferred shares produced 25.000000 percent. Competing openings of 60 each against a total of 100 yielded one success and one conflict. These are fictional register tests, not real investors.

Intermediate issues resolved: migration-directory diff required an unnecessary shadow DB, so generation used the committed Day 1 schema versus the new schema; an overwritten TypeScript delta property was removed; existing mixed-encoding architecture notes were normalized to UTF-8 and line endings corrected. Final generated Client, migration paths, build and tests passed. No failed check is reported as a pass.

## Learning notes

- Prisma relations are foreign keys; nested `include` follows related rows like SQL JOINs, while the ownership filter is a WHERE condition tied to the logged-in account.
- `$transaction` is BEGIN/COMMIT with automatic ROLLBACK. Class `SELECT FOR UPDATE` locks serialize capacity checks; repeatable-read gives consistent read snapshots, like MySQL InnoDB.
- `z.infer<typeof schema>` reuses a validated JS object's shape for compile-time checks. It does not replace runtime parsing or speed execution.
- Whole shares stay BIGINT/JS BigInt. JSON and percentages are strings, avoiding floating-point errors; each class has its own denominator and zero stays null.

## Limits and next dependencies

No real source register was verified: administrators must attest only against independently checked legal records. Legacy balances are hidden until verified; do not treat that migration state as lost data. Correcting a source-register error appends an event; it is not a transfer or issuance. Class totals are legal register denominators, not shares available to buy.

Adjustments have no idempotency key or historical-as-of query: inspect event history before retrying an uncertain request. Pagination is bounded and uses offsets. Development seeds commit metadata and individual openings separately and are resumable, not a production import tool. Production needs restricted runtime DB permissions/backups because owners can alter triggers. No backup/restore drill, live deployment, browser/device PWA acceptance or Day 3 UI tests were performed. Temporary validation scripts/containers/credentials are removed after checks; test fixture data never enters the normal database. Next work is Day 3 only when requested.
