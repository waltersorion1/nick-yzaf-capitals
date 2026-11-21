# Operations and deployment runbook

## Day 6: isolated QA and recovery

This procedure uses fictional records only. No production deployment, real import or pilot invitation is part of Day 6. In Windows PowerShell with Docker Desktop, supported Node and Chromium:

```powershell
npm ci
npx playwright install chromium
npm run verify:isolated
```

The runner starts PostgreSQL 17.7 in a uniquely named disposable container on a random loopback port. It migrates separate normal/test databases from empty, generates Prisma, builds, runs backend and desktop/mobile suites, performs a real restore, and runs npm audit. It never uses the owner's `.env` database. Finally it removes its exact container/volume. Interrupted processes may require manual removal of that exact `nycap-verify-<UUID>` container; never remove the normal database volume.

Results are in ignored `.local/verification-latest.json`, `.local/recovery-latest.json` and `.local/recovery/<random>/`. Archives include fictional password hashes and private-style evidence: restrict access, never serve/commit them, and delete when no longer needed. The drill executes:

```text
pg_dump -U nycap -d nycap_test -Fc --no-owner --no-acl --exclude-table-data=public.sessions -f /tmp/recovery.dump
createdb -U nycap --template=template0 nycap_restore_<random>
pg_restore -U nycap -d nycap_restore_<random> --no-owner --no-acl --exit-on-error --single-transaction /tmp/recovery.dump
```

It restores the complete schema and business data into a NEW database. It compares exact row counts/SHA-256 for every business table and migration history, trigger/function/constraint/index definitions, tests restored append-only guards, reconciles ledger/snapshots/class capacity, and requires zero restored sessions. Source fingerprints before/after dump detect concurrent business writes; stop writers for the drill. It drops only its new restore database. This demonstrates recovery of a fictional dataset, not a production RTO guarantee.

## Pilot backups

Before migrations/imports and at least daily during pilot operation, use PostgreSQL 17-compatible tools with a separately authorized backup account. Verify target first: `SELECT current_database(), current_user, version();`. Supply connection credentials via protected environment/pgpass or secret files, never shared command arguments/logs. Dumps contain password/invitation digests, CSV evidence, personal records and audits; protect the entire archive.

An operator can run this local-Docker example AFTER verifying the container/database names. It is documented, not automatically run against the owner's database:

```powershell
$backupStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDirectory = Join-Path $PWD '.local/backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
docker exec nick-yzaf-capitals-db-1 pg_dump -U nycap -d nycap -Fc --no-owner --no-acl --exclude-table-data=public.sessions -f /tmp/nycap-backup.dump
if ($LASTEXITCODE -ne 0) { throw 'Backup failed' }
docker cp 'nick-yzaf-capitals-db-1:/tmp/nycap-backup.dump' (Join-Path $backupDirectory "nycap-$backupStamp.dump")
if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed' }
Get-FileHash -Algorithm SHA256 (Join-Path $backupDirectory "nycap-$backupStamp.dump")
```

Use `docker cp`/pg_dump `-f`, not binary redirection in older Windows PowerShell. Encrypt archives before off-host transfer, restrict destination/key access and alert on failure/missing backups. Record UTC time, checksum, size, app commit and migration IDs. Owner must assign retention, recovery owner and RPO/RTO before launch. Proposed starting targets: daily plus pre-change archives, 30-day retention, RPO <=24h, RTO <=4h; these are not measured production guarantees. Local drill archives are not encrypted by this script. Protect cluster roles, TLS/deployment secrets and signed registers separately; pg_dump does not include those. Use managed continuous/PITR backups when the agreed RPO requires them.

## Restore, migrations and rollback

1. Stop writes/invitations and restrict the origin. Preserve the failed database/archive. Verify archive checksum and trusted source: restored functions/SQL execute with restore privileges.
2. Restore into a NEW private database with pg_restore `--exit-on-error --single-transaction --no-owner --no-acl`. Never use `--clean` on the live register or disable its guards.
3. Verify migrations, exact holdings/ledger/class totals, dividend sources, import receipts, audits and immutable guards against recorded evidence. Reapply restricted runtime grants; it must not own tables or have DDL/TRUNCATE privileges.
4. Ensure sessions are empty before traffic; rotate session secret if compromise is suspected. The backup command excludes session DATA while retaining its schema. Old restored sessions must never revive revoked access.
5. Use the matching app commit, switch the private connection only after checks, smoke-test identity isolation, record operator/timestamps/evidence and obtain operational approval.

Back up before `npm run db:migrate` with a migration-owner connection. Use a restricted runtime role for `npm start`. Prisma migrations apply forward, like versioned MySQL ALTER scripts; they do not supply automatic rollback. Redeploy an older app only if compatible with the current schema; otherwise use a tested forward fix or restore into a new DB and reconcile intervening writes. Never use migrate reset or development seeds against a pilot.

## Logging and production prerequisites

Operational stdout logs are newline JSON: UTC timestamp, fixed event/level, generated request ID, coarse category, method, status and duration. They omit URL/query/target IDs, IP/user-agent, request/response bodies, CSV, names/emails, cookies/passwords/tokens, connection URLs and raw errors/stacks. The response X-Request-ID links failures without private payloads. Structured logs supplement protected append-only business audits. Configure restricted durable collection, retention/rotation and alerts; do not enable raw proxy access logs or Prisma query logs for private traffic. Sink failures must not change transaction delivery.

Use one Express instance behind exactly one trusted HTTPS reverse proxy, private backend/DB ports, exact HTTPS APP_ORIGIN and a randomly generated SESSION_SECRET outside Git. Build using npm ci, db:generate and build; migrate before runtime. A second replica requires shared login throttling. Before launch verify Secure/HttpOnly/SameSite cookies, no-store API/HTML/errors, worker `/` scope, manifest/icons, generic offline shell and explicit update acceptance on the final origin. Domain/hosting, encrypted off-host backups, owner-approved legal sources, physical device checks and pilot sign-off remain launch dependencies.

Primary references: [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [MDN cache lookup](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/match), [OWASP logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
