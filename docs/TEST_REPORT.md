# Day 6 security, QA and recovery report

Date: 21 November 2026 (Africa/Lagos). Read the full playbook and AGENTS.md. Implemented Day 6 before starting the separately requested Day 7. All test data is fictional; no normal database writes, real imports or pilot invitations.

## Changes and audit findings

- `src/logging.ts`, app/server: explicit-field JSON request/startup/error/session/pool/shutdown logs; safe error correlation, no raw errors or private payloads. All responses now receive no-store, including missing documents/errors. Sink failure cannot undo successful delivery.
- `public/sw.js`: v5 named-cache lookups prevent an unrelated cache supplying fallback/scripts. The prior unrestricted CacheStorage.match could search unrelated caches. The static allowlist remains unchanged; all other same-origin GETs explicitly use network-only/no-store. No private HTML/API/document enters the allowlist.
- Auth/logging regressions: inactive/expired and concurrent single-use invites, role revocation within an existing session, destroyed-cookie replay, secret markers excluded from real request logs, runtime serializer allowlist and failing log destination.
- Fixed login audit failure ordering: a regenerated session receives userId only after the LOGIN audit succeeds. A real, narrowly scoped database fault trigger proves a failed audit returns generic 500 and leaves the session unauthenticated; its temporary trigger/function is removed in finally.
- Browser regressions: two-tab logout, online close/reopen revalidation, offline new-window launch, unrelated-cache contamination and private/unknown-document network-only behavior. Existing mobile/admin/reporting/import/privacy/update checks remain.
- `scripts/verify-isolated.mjs`, `scripts/recovery-drill.mjs`, package scripts, ignore rules and DEPLOYMENT.md: disposable real PostgreSQL QA, custom-format backup and NEW-database restore with exact data/schema/guard/reconciliation evidence. No Day 6 database migration.

## Actual execution

`npm run verify:isolated` completed successfully; its final run finished at 2026-11-21 02:30:10 UTC. Raw fictional logs/backups remain ignored in `.local/`.

| Executed check                                        | Actual final result                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Four migrations on each of two new isolated databases | Passed; all four applied, normal local database untouched                                                                        |
| `npm run db:generate` / `npm run build`               | Passed                                                                                                                           |
| `npm test`                                            | **79 passed**, 5 files, Vitest 24.69 seconds                                                                                     |
| `npm run test:e2e`                                    | **30 passed**, desktop Chromium + Pixel 7 emulation, 1.3 minutes                                                                 |
| `npm run recovery:drill` inside the isolated runner   | **Passed**, 12 tables plus schema guards identical; restored sessions zero; restored ledger/capacity and immutable guards passed |
| `npm audit`                                           | 0 vulnerabilities                                                                                                                |
| `npx prisma validate`                                 | Valid schema                                                                                                                     |
| Formatting / `git diff --check`                       | Passed before delivery                                                                                                           |

Recovery used PostgreSQL 17.7, a 112922-byte custom archive, SHA-256 `7874c283d525658627126965a677639ad09b805627cf44eaf2cbe0bfcf24bbfd`, and completed its dump/restore/verification in 1048 ms on this tiny fictional dataset. This excludes production provisioning, network/key recovery and downtime coordination. Archive/evidence stay in `.local/recovery/nycap_restore_6ec28981bf714d48ae8674229f507cb4/`. Disposable containers/restore DBs were removed. Source business rows were read only during backup; no ordinary local database was accessed.

## Security coverage

Real PostgreSQL/Supertest suites test cross-account holding IDs and identity query substitution, company/class reporting isolation, guest/shareholder/admin routes, CSRF/origins, hashing/rate limits, session rotation/expiry/logout, inactive accounts, secure production cookies and private invitations. Password reset is **not implemented**; no reset flow is claimed. Invitations are consumed atomically. Emergency account/session revocation remains an operator database procedure.

Financial suites cover missing/zero class values, exact money/shares, dates, drafts/withdrawals, separate declared/paid totals, references/overpayment/concurrent payment guards, source immutability and audit failure rollback. Import suites cover malformed/oversized CSV, mapping/IDs, quantities, duplicates, capacity/reconciliation, stale/expired previews, concurrent/repeated commits and real late-row/final-audit failures. Audits/ledger/receipts are immutable and exercised. Logging intentionally avoids private targets; business audit metadata is protected in PostgreSQL.

## Device matrix and manual checklist

| Area             | Automated coverage                                                                                                   | Remaining manual coverage                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Install criteria | Desktop Chromium and Pixel 7 emulation: manifest, icons, scope/start URL, no Chromium blocking installability errors | Actual native Android/desktop install prompts, icons and standalone launch |
| Offline/privacy  | Private DOM/chart cleared, reload/new-window generic shell; cache keys/bodies, local/sessionStorage and IndexedDB    | Installed app offline restart after OS termination/device storage policies |
| Session reopen   | Cross-tab logout, destroyed-cookie replay, close/reopen browser tab                                                  | Installed OS-window restart after logout/expiry                            |
| Updates          | Real worker install/wait/consent/activate/reload; in-progress form preserved until acceptance                        | Multiple installed windows and physical OS integration                     |
| iOS Safari       | Documented procedure below                                                                                           | Entire physical-device run unexecuted                                      |

Before pilot sign-off, record device/OS/browser/date/tester/result for these **iOS Safari** steps:

1. Open the restricted HTTPS origin; verify sign-in, dark/light layouts. Share -> Add to Home Screen -> Add (wording varies); launch icon, verify standalone layout, touch/keyboard/zoom and maskable/icon appearance.
2. Sign in as fictional A; verify only A's records and B-ID denial. Close/terminate and reopen online: revalidate server session. Expire/revoke it, reopen and require login.
3. After one online visit enable airplane mode: private details disappear. Terminate/relaunch offline: generic fallback only, no identity/balances/dividends. Reconnect: check session again.
4. Sign out online, terminate/reopen and navigate back: no private details. Inspect storage using Safari remote Web Inspector: public-only Cache Storage and no private local/sessionStorage or IndexedDB.
5. Release updated versioned assets/worker to that restricted origin: preserve current form until Update and reload, then activate correctly. Record actual install support without fabricating native prompts.

Run equivalent native Android Chrome and desktop Chrome/Edge install/standalone/close/reopen/offline/logout/expiry/storage/update checks. **Physical devices and actual native OS installation were not exercised.** Browser emulation and tab reopen are explicitly narrower evidence.

## Learning notes

1. A TypeScript interface documents JavaScript object keys at compile time; runtime field selection still excludes secrets from JSON.
2. pg_dump custom archives are comparable to MySQL logical dumps packaged for pg_restore. File creation alone does not prove recovery; restoring and verifying data/guards does.
3. PostgreSQL triggers/CHECKs, like MySQL triggers/constraints, must survive and be tested after restore. Session data is deliberately excluded so revoked sessions cannot revive.
4. CacheStorage.match searches across caches; opening a named Cache constrains lookup. Worker installation is independent of authenticated server sessions.

## Limits and next dependencies

Initial new invitation regression reused an existing test email; that fixture collision was corrected before rerunning. No failing run is counted as passing. Physical installs/iOS, hosted HTTPS/proxy, durable log collection and encrypted off-host backup/key/retention/RPO/RTO operations require the deployment/device owners. The fictional restore is not a production recovery guarantee. Day 7 needs hosting/domain access, signed human-verified sources, source reconciliation and owner security/accuracy/restoration approval; unmet gates mean NO-GO and no invitations.
