# Day 4 report - 21 November 2026 (Africa/Lagos)

## Completed and files

Read `Codex_Playbook.md` completely and followed `AGENTS.md`. Implemented Day 4 only: company announcements, class-specific dated indicative valuations with methodology, Chart.js histories, and separately recorded DECLARED/PAID dividends. No payment execution, trading, wallet, bank integration, issuance or Day 5 CSV/core-register workspace was added.

- Added `src/reporting/validation.ts`, `service.ts`, `routes.ts`; mounted them in `src/app.ts` behind existing sessions, CSRF, server roles and no-store headers.
- Added Announcement, ValuationSnapshot, DividendRecord and DividendStatus to `prisma/schema.prisma`, with migration `202611210003_day4/migration.sql`.
- Added local pinned Chart.js 4.6.1 and its asset copy step; updated package/lockfile.
- Added v3 public controller/model/view/PWA/CSS assets and `reporting-v3.js`; updated HTML/offline shell/worker to v3, retaining v2 assets for open installed clients.
- Added `tests/reporting.test.ts`; extended E2E fixtures/spec/server wrapper for published financial reporting and worker v3.
- Added `docs/DAY4_API.md`, this report, and updated README/architecture explanations.

Administrators can open Companies -> a company and use expandable announcement, valuation or dividend forms. Each saves a draft; source-row Publish/Withdraw actions require a separate audit reason. Readers see only active published sources authorized for their company/class or their own dividend profile. Current/historical dividends are separate from current ownership valuation. Missing prices stay missing, multiple currencies stay separate, and a partial set of valuations is never displayed as a complete portfolio.

## Database and arithmetic

Migration creates three reporting tables, date/currency/evidence/numeric checks, source-lifecycle guards, retained-record/truncation protection, a partial unique current valuation index, and dividend parent/cap/date checks. Source fields are immutable; corrections retain the old record via withdrawal and create a replacement. Dividend references remain unique across history per shareholder/class, so replacements require distinct source/amendment references. Published payments reference an active published declaration; all nonwithdrawn payments, including drafts, reserve capacity so concurrent drafts cannot exceed it. Only published records appear in reader totals.

Money uses exact NUMERIC(28,8) and Prisma.Decimal, with 65-digit operation precision. Inputs reject binary JSON numbers and excess fractional precision. Share multiplication uses the exact BigInt string; responses expose fixed eight-decimal strings. Number conversion is limited to illustrative Chart.js coordinates; table/tooltips retain exact values. No cross-currency addition/conversion or automatic source valuation is performed.

Applied successfully from empty isolated databases. The additive migration also applied to the user's existing local `nycap` database on localhost:5432. A before/after hash/count of holding IDs and quantities matched: all **3 existing holdings preserved**. `prisma migrate status` reports the schema up to date. No normal-database seed or real reporting record was inserted by this task. All financial sample records belong only to fictional test fixtures in an isolated disposable instance on localhost:55435.

## Commands and actual results

| Executed command/check | Result |
| --- | --- |
| Full playbook/instruction/source reads, Git status and Docker status | Current implementation reviewed; initial Git tree clean |
| `npx prisma format`, `npm run db:generate` | Schema formatted and client generated |
| Schema-to-schema `prisma migrate diff` | Additive SQL generated, then reviewed/extended with constraints and lifecycle guards |
| `npm install --save-exact chart.js@4.6.1`, `npm run assets` | Pinned library copied locally with upstream header; no CDN dependency |
| `npm run db:migrate` on both isolated empty DBs | All three migrations applied |
| `npm test` with distinct isolated normal/test URLs | **54 tests passed**, 3 files, 15.61 seconds |
| Final `npm run test:e2e` | **22 tests passed**, desktop Chromium and Pixel 7 emulation, 43.3 seconds |
| `npm run build` | Passed |
| `npx prisma validate` | Schema valid |
| `npm audit` | Zero vulnerabilities |
| Local migration via Prisma CLI and before/after holding digest/count | Applied Day 4; existing quantities/IDs unchanged |
| `npx prisma migrate status` with normal local `.env` | Three migrations; database up to date |
| Reporting desktop screenshot inspected | Published dates, methodology, exact table/tooltip values, chart, portfolio value and separate dividend totals reviewed |
| Formatting and `git diff --check` | Passed before Git delivery |

The 15 added backend tests cover missing valuations, roles/CSRF on all reporting actions, announcement draft/publication visibility, invalid/future dates, price precision/currency/methodology, latest published snapshots versus later drafts, duplicate current dates, class/company isolation and query identity rejection, audited withdrawal/replacement, mixed currency separation, very large exact share multiplication, declared/paid totals, payment drafts, references/date/cap validation, concurrent payment recording, parent/child withdrawal ordering, immutable records, SQL inconsistencies, audit-failure rollback and explicit source zero prices. Existing 39 backend tests remain passing.

The browser suite retains the 18 Day 3 checks and adds four desktop/mobile executions for Day 4: a real reader's published chart/portfolio/dividends, and the administrator's source forms/lifecycle. Reader checks confirm chart points only include published sources, correct separate declared/paid sums, company updates, exact indicative value, no draft leakage, no financial marker in cached bodies/storage, and chart-instance destruction/private DOM removal offline. Admin checks save/publish an announcement and save/publish/withdraw valuation and PAID records through actual forms/APIs. No payment provider is called. E2E requests use real PostgreSQL, server sessions and authorization.

Fictional examples: 3 shares at 0.2 yielded exactly 0.60000000; a withdrawn latest source correctly fell back to the prior snapshot; a replacement 0.25 price yielded 0.75000000. 9007199254740993 shares at USD 0.00000001 yielded exactly USD 90071992.54740993, separately from NGN totals. A declaration of 100.10 and published payment of 40.01 produced declared 100.10000000 and paid 40.01000000, not a combined balance. Concurrent records of 7 against a declaration of 10 yielded one success and one conflict. Browser fixtures showed 4 shares at 3.25 = NGN 13.00 and historical declared NGN 100.00 versus paid NGN 40.00.

An initial browser run failed because the test used exact label-text matching on a select whose label also contained option text; the test now uses the combobox accessible role/name. Final desktop/mobile publishing tests pass, including the payment form and chart privacy checks. Backend financial checks passed on their first full run. No failed or unexecuted check is described as successful.

## Learning notes

1. Prisma `Decimal @db.Decimal(28,8)` is PostgreSQL NUMERIC, comparable to MySQL DECIMAL, not FLOAT. Prisma.Decimal calculations preserve source amounts; JSON strings avoid Number rounding.
2. A PAID row's self-relation to a DECLARED row is a foreign key back to the same table. Status is not overwritten, so declared and paid facts remain separately auditable.
3. `$transaction` provides BEGIN/COMMIT/ROLLBACK around each source change and audit. Parent-first SELECT FOR UPDATE serializes payment capacity checks. Repeatable-read source summaries avoid mixing publication states from different database moments.
4. A PostgreSQL partial unique index enforces one nonwithdrawn class/date snapshot while retaining withdrawn history; unlike ordinary MySQL-style UNIQUE, its predicate applies only to current records. SQL migration guards are required in addition to Prisma model declarations.

## Limits and next dependencies

Reporting remains source-backed administrator attestation, not automated legal or settlement verification. Only NGN, USD, GBP and EUR are accepted; adding a currency requires explicit schema/API support. Dates use the current UTC calendar cutoff. Payments may be partial but cannot exceed their declaration; drafts reserve capacity yet remain invisible to readers. Company publications require positive verified holdings, while historical own dividend records can remain visible after a holding reaches zero. Dividend correction references cannot be reused; announcements do not have a retry idempotency key, so inspect history after a timeout before resubmitting.

No independent FX conversion, market prices, entitlement calculation by record-date holdings, automatic payouts or historical as-of portfolio balance was added. Chart points use approximate geometry only and exact source prices remain alongside them. General admin editors/CSV migration stay Day 5. Physical iOS/Android installation, live HTTPS deployment and Day 6 recovery/security gates remain untested. Test fixtures are retained only in the disposable instance until cleanup; it and its temporary credentials are removed before delivery. No Day 5 work or deployment occurred.

After restart/refresh at localhost:3000, open a company to see the Day 4 reporting forms/history. Existing records without published sources still correctly show Not available. Choose Update and reload if the previous worker offers it. No reseed/reset is needed.
