# Day 7 production preparation and launch report

Date: 21 November 2026 (Africa/Lagos). Read the complete playbook again after completing/pushing Day 6. User authorized proceeding to Day 7. **Pilot release decision remains NO-GO until PILOT_SIGNOFF.md gates pass.**

## Implementation

Added production Docker build/runtime/migration/backup targets; Compose with private database/backend, non-root read-only app, one Caddy HTTPS proxy, bounded log rotation and file-mounted secrets. Default edge policy denies all requests until the owner/operator sets a private access allowlist. Added exact-origin/HTTPS config checks and `_FILE` secret support, bounded PostgreSQL query/connection waits, no-session liveness/readiness endpoints, explicit production HTTP rejection, separate runtime/backup role grants and empty-register-only audited owner bootstrap. Runtime image excludes the development seed. Release IDs change worker bytes/cache names for real deployments; cached source assets retain their explicit version names.

`deploy/backup.sh` makes a PostgreSQL custom archive with no session data, encrypts through age using only a public recipient, writes checksum and records generic completion. No private decryption key is needed on the VPS. Off-host transfer/retention/alert configuration requires the owner's destination and is not silently invented. `deploy/provision.mjs` generates secrets without printing values and refuses to overwrite existing directories. See DEPLOYMENT.md for exact operator commands, permissions, migration/rollback and backup schedule guidance.

Changes: Dockerfile, .dockerignore/.gitattributes, deploy/*, src/config.ts, src/server.ts, src/app.ts, src/db.ts, src/ops/bootstrap-admin.ts, .env.example, tests/operations.test.ts, scripts/production-smoke.mjs, package scripts, operational docs and PILOT_SIGNOFF.md. No schema migration or normal database seed/reset/import is required.

## Actual checks

Final `npm run test:production` completed successfully at 2026-11-21 15:58:28 UTC. Local production-like TLS uses an isolated Caddy CA on loopback; it does not establish public certificate issuance, DNS, Hostinger access or installed OS behavior. Chromium uses a test-only certificate-trust exception (including worker script loading); a separate Node HTTPS client verifies the Caddy CA chain without bypassing TLS.

| Executed check                                                        | Actual result                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`, standalone `npx vitest run tests/operations.test.ts` | Passed; 3 configuration/health tests                                                                                                                                       |
| Final `npm run verify:isolated`                                       | Passed; four migrations applied to each of two new DBs; generate/build passed                                                                                              |
| Backend suite in final isolated run                                   | **82 passed**, 6 files, 25.94 seconds                                                                                                                                      |
| Desktop/mobile browser suite                                          | **30 passed**, 1.4 minutes                                                                                                                                                 |
| Fictional restore in final isolated run                               | Passed: 12 tables and schema guards identical; 112949-byte archive, 1079 ms drill; no sessions, exact ledger/capacity                                                      |
| Dependency audit in final isolated run                                | 0 vulnerabilities                                                                                                                                                          |
| Production-like real Linux images and migration owner                 | Built successfully; all four migrations applied to new disposable production-mode DB                                                                                       |
| Initial owner and runtime grants                                      | First owner bootstrap succeeded, second attempt denied; runtime is neither superuser nor role/DB creator and cannot CREATE schema, UPDATE audits or TRUNCATE ledger        |
| HTTPS and sessions                                                    | Node verified isolated Caddy CA; readiness 200/no-store; Secure/HttpOnly/SameSite cookie and CSRF enforcement passed                                                       |
| Runtime reporting and reviewed CSV                                    | Published dated valuation/announcement/declared and paid records; CSV exact final total **325** (100 + 200 + 25), repeated commit did not duplicate holdings               |
| HTTPS browser privacy/PWA                                             | Foreign holding 404, admin route 403, manifest/icons/scope, Chromium installability, private-free browser storage and generic offline shell passed                         |
| Actual production image update                                        | Rebuilt app with a new release cache ID, worker waited for acceptance, draft preserved before acceptance and cleared after actual reload; logged-out session stayed denied |
| Encrypted backup and actual decryption/restore                        | age-encrypted custom archive decrypted with an isolated test identity, restored into NEW database; all 12 table fingerprints identical and sessions empty                  |
| Formatting and whitespace                                             | Checked before Git delivery                                                                                                                                                |

Encrypted archive SHA-256: `f6acd4f44d6a26669d49b101c1e8631c45e2ff980e51f01bb32959eaebe4b729`. Private fictional evidence is under ignored `.local/nycap-smoke-0b87038e/` and `.local/production-smoke-latest.json`; raw logs are in `.local/day7-production-final2.log`. Test Compose projects/volumes and the isolated regression container were removed. The normal database was not migrated/seeded/imported or used by these checks.

Resolved test/config issues: the earlier browser update assertion could run between immediate form reset and navigation; it now waits for the actual load event. Proxy and app both supplied Cache-Control, so the Caddy header is now set with defer to replace rather than duplicate it. Local-CA worker loading required a Chromium launch-level exception beyond the context exception; bounded active-worker checks replace an unbounded ready promise. The Linux migration build explicitly installs OpenSSL/certificates; bootstrap uses executeRaw for the void-returning advisory lock and shares the exact built runtime image. Caddy runtime logging filters the entire request object, while access logging stays disabled. These are local tests, not a live-origin or physical-device pass.

## Blockers and untouched actions

Owner specified Hostinger KVM 2 and capital.nickyzaf.xyz, confirmed verified registers exist and reported no backup destination. SSH endpoint/username/key/deployment path, local register paths and an approved off-host destination were requested and remain pending. DNS lookup returned NXDOMAIN. Existing unrelated SSH config aliases were not guessed or accessed. No Hostinger deployment, DNS/firewall change, real source import/reconciliation, real owner account or pilot invitation has occurred. Device tests remain explicitly unexecuted as described in TEST_REPORT.md.

The production package can be reviewed/tested locally while access is pending. Local test credentials, TLS CA, encrypted backups and fixture data remain ignored under `.local/`; disposable Compose resources are removed after the smoke run. A failed test is fixed/reported before claiming a pass. Initial local attempts exposed Windows read-only file behavior in mutable edge/recipient fixtures and a stopped Docker daemon; these were corrected/restarted before rerunning.

## Learning notes

1. `_FILE` settings read a mounted file using ordinary JavaScript fs; Compose secrets are not automatically substituted into environment strings. Parent directory permissions protect host files; non-root containers need read permission on only their mounted files.
2. PostgreSQL roles separate migration ownership from runtime DML, like using a MySQL schema owner for ALTER and a limited application login for SELECT/INSERT/UPDATE. Triggers still run and require their invoker's appropriate DML grants.
3. Readiness checks the database/migration/session schema; liveness says the Node process responds. Neither reveals investor records or establishes a signed-register match.
   `Array<{ migration_name: string }>` describes a JavaScript array such as `[{ migration_name: "202611210004_day5" }]` to TypeScript; the SQL still executes in PostgreSQL and TypeScript does not make it faster.
4. An age public recipient encrypts archives while the private identity stays off-host. Restore proof requires the identity plus archive and verified exact data/guards; a checksum alone is not recovery.
