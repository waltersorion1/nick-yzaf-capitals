# Day 5 report - 21 November 2026 (Africa/Lagos)

## Completed and changed files

Read `Codex_Playbook.md` completely and followed `AGENTS.md`. Implemented Day 5 only. Added an administrator workspace, verified-opening CSV preview/commit, row diagnostics, class reconciliation, replay receipts and import audit evidence. No Day 6 recovery/deployment work, real CSV import, trading, transfers, issuance or payment execution was performed.

- Added `src/imports/csv.ts`, `service.ts`, `routes.ts`; mounted protected routes and a bounded preview JSON parser in `src/app.ts`.
- Refactored `src/records/service.ts` to share `openInTransaction` with the existing single-row opening path, preserving ledger/audit rules without nested commits.
- Added OpeningImportBatch to `prisma/schema.prisma` and `prisma/migrations/202611210004_day5/migration.sql`.
- Added pinned csv-parse 7.0.3; updated package/lockfile.
- Added v4 controller/model/view/PWA/reporting/CSS assets plus `admin-v4.js`; updated shell, offline page and worker. Prior versioned assets remain available to installed clients until explicit update acceptance.
- Added `public/templates/verified-openings.csv`, `docs/examples/fictional-openings.csv`, `docs/CSV_IMPORT.md` and this report; updated README and architecture notes.
- Added `tests/imports.test.ts` and extended desktop/mobile browser fixtures/spec/server wrapper.

The administrator navigation now includes Admin workspace. It has company/class creation/editing/safe deletion, account invitation and verified profile maintenance, manual verified openings, append-only corrections, preserved-legacy verification, holding history and class reconciliation. The Reporting section summarizes per-company publication states and opens the existing announcement/valuation/dividend source editors. No unsafe direct balance or published-source editing was introduced.

## CSV behavior

A header-only template and private ID/mapping panel support existing company/class/profile IDs. Preview checks UTF-8/RFC CSV structure, bounds, required IDs, company/class mapping, profile verification/account status, exact positive whole quantities, duplicate pairs, existing holdings, nonfuture evidence timestamps and source references. Every class must match its current issued total and the independently supplied expected post-file recorded total. Existing snapshot and ledger totals must already reconcile.

A single row/header/class error blocks the whole file. Row diagnostics and exact before/file/after/expected/unrecorded totals are displayed and can be explicitly downloaded as private JSON. Preview itself writes only server batch/audit evidence, never holdings. Preview IDs are creator-bound and expire after 30 minutes.

Commit uses only the stored batch and explicit confirmation. It reparses/revalidates under sorted class locks/profile locks, rejects a stale reviewed digest, and writes every opening/event/audit plus final reconciliation and receipt in one transaction. Repeated same-file upload/commit returns a receipt, not new holdings/events. BOM/LF/CRLF/trailing whitespace normalization supports common repeat uploads; reordered/formatted equivalents are caught through existing-pair errors rather than silently skipped. Different administrators cannot use someone else's token or duplicate a committed source hash.

## Database and local state

The additive migration creates only `opening_import_batches`, its creator FK, indexes, JSON evidence/receipt fields, completeness checks and retention/immutability guards. A partial unique content-hash index prevents multiple committed copies of the same normalized file. Source payloads/digests cannot change, committed receipts cannot be rewritten, and evidence cannot be deleted/truncated through normal SQL operations. Database owners can still modify guards; production runtime roles must be restricted.

The migration succeeded from empty isolated normal/test databases and also applied to the existing local `nycap` database on localhost:5432. A before/after hash/count verified **all 3 existing holding IDs and quantities were preserved**. Prisma reports four migrations applied and the schema up to date. No normal-database seed, account invitation, opening, correction or CSV upload was executed by this task. All test users/records/source files are fictional and were confined to a disposable PostgreSQL 17.7 instance on localhost:55436.

## Commands actually run and results

| Command/check | Result |
| --- | --- |
| Complete playbook/instruction/source reads, Git/Docker status | Implementation constraints/current state reviewed; initial working tree clean |
| `npm install --save-exact csv-parse@7.0.3` | Pinned parser and lockfile updated |
| `npx prisma format`, `npm run db:generate` | Schema formatted and client generated |
| Schema-to-schema `prisma migrate diff` | Additive SQL generated, reviewed and extended with commit/evidence guards |
| `npm run db:migrate` on isolated empty databases | All four migrations applied successfully |
| `npm test` | **73 tests passed**, 4 files, 20.97 seconds |
| Full `npm run test:e2e` | **26 desktop/mobile tests passed**, reported duration 1.2 minutes |
| Focused admin/CSV follow-up checks | **4 desktop/mobile tests passed**, 45.5 seconds, after viewport/expiry-display changes |
| `npm run build` | TypeScript compilation passed |
| `npx prisma validate` | Schema valid |
| `npm audit` | Zero vulnerabilities |
| Normal local Prisma migrate deploy and before/after holding digest/count | Day 5 applied; identities/quantities unchanged |
| `npx prisma migrate status` | Four migrations; schema up to date |
| Formatting and `git diff --check` | Completed before Git delivery |

Nineteen added backend tests exercise roles/CSRF/private mappings, quoted CSV and exact preview totals, invalid fields/IDs/dates/sources, missing/wrong mappings, inactive/unverified profiles, duplicate file pairs/existing zero holdings, issued/expected/cap mismatches, malformed/oversized input, atomic successful commit/audit correlation, repeat upload/commit including BOM/CRLF and uppercase tokens, creator binding/client-row forgery denial, stale balance/name changes, expiry, concurrent same-file replay, competing capacity writes, real late-row and final-audit database failures, multi-company/class reconciliation, another administrator's duplicate upload and exact large shares/immutable evidence. The prior 54 backend tests remain included.

Rollback proof used narrowly scoped test-only database triggers, not mocked transaction behavior: one rejected a later holding INSERT after earlier opening/event writes, another rejected the final IMPORT_COMMITTED audit. Both left only the pre-existing holding/event and no receipt. Temporary triggers/functions were removed in finally blocks. The late-row failure then successfully retried after removing the fault. A separate IMPORT_FAILED audit recorded the failed attempt outside the rolled-back financial transaction.

The full browser suite retains prior portal/reporting/installability/privacy/update checks and adds administrator CRUD/invitation/profile/opening/correction/history/reconciliation plus invalid/valid CSV preview, required review confirmation, actual commit, same-file receipt replay, report download/history and offline privacy on desktop Chromium and Pixel 7 emulation. Tests reuse real server session cookies only in worker memory; production login rate limits remain unchanged. Dedicated viewport fixtures prevent a failed editor test from changing the separate shareholder portal fixture.

Fictional reconciliation example: issued 1000, existing 50, file openings 100 + 200, expected after 350, unrecorded 650. Committed snapshots and ledger both equaled 350. Two files each requesting 600 against an empty 1000-share class yielded one commit and one conflict. Two same-file previews committed concurrently yielded one commit plus one receipt replay. Exact quantity 9007199254740993 stayed unchanged through parsing, posting and reconciliation.

## Resolved issues during implementation

csv-parse's static overload described plain records even with `info:true`; parser output now goes through explicit Zod runtime shape validation instead of an unsafe type cast. Initial browser correction/history tests read controls before the asynchronous refresh finished and shared a mutable portal fixture. The UI now announces operation state and preserves the selected holding after save; tests wait for completion and use dedicated editor fixtures. A later repeated-run locator matched prior fictional class names; it now targets the exact generated class ID. No failing check is represented as a pass; final checks are recorded above.

## Learning notes

1. `openInTransaction(tx, ...)` means all CSV rows use one database connection/BEGIN/COMMIT, like a MySQL transaction around many INSERTs. Independent inner transactions could commit early and defeat rollback.
2. JSONB preview/receipt fields are PostgreSQL's equivalent of MySQL JSON. Source hashes identify repeated normalized files; preview digests detect changed reviewed state, but neither replaces server roles, CSRF or revalidation.
3. Deterministic row locks serialize class capacity checks. A partial unique index applies only to committed batches, so many invalid previews can coexist without permitting duplicate commits.
4. CSV share cells stay strings until BigInt parsing; UUIDs identify existing rows and names are display labels. There is no floating-point financial arithmetic or guessed company mapping.

## Limits and next dependencies

CSV supports 128 KiB, 200 rows, exact documented headers and existing verified opening records only. Files never create legal identities or repair existing holdings. Verification remains independent human source attestation; preview cannot establish legal ownership. Post-file recorded totals may cover a verified subset rather than every issued share; unrecorded shares are not offered for sale. Existing unverified legacy balances are included in capacity totals but are not verified by an import.

Previews and uploaded source/report evidence are retained server-side, including invalid/expired attempts. A production retention/access/backups policy and restricted runtime DB permissions remain Day 6/7 work. Failures roll back financial changes; a failure-attempt audit is best effort if the database itself is unavailable. Reconciliation/row-report downloads are explicit private documents, not public cache content. No raw CSV, profiles, receipts or invitation token is put into browser persistence; offline/logout clears the UI. Invites are one-shot and must be copied/delivered privately before view changes.

No physical-device OS install test, live HTTPS deployment, backup/restore drill or broader Day 6 audit was performed. Existing reporting editors retain withdrawal/replacement semantics and no payments execute. Next work is Day 6 only when requested. Restart/refresh localhost:3000 and choose Admin workspace; accept Update and reload if worker v3 still controls the tab. No reseed/reset is required.
