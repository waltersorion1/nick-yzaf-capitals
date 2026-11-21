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

## Day 7: Hostinger KVM 2 / capital.nickyzaf.xyz

**Current decision: NO-GO; see [PILOT_SIGNOFF.md](../PILOT_SIGNOFF.md).** The owner supplied the target/domain and says signed registers are available. SSH access/register paths/off-host backup destination remain pending. DNS A lookup returned name does not exist. No live deployment/import/invitation has happened. Do not connect to unrelated SSH aliases or overwrite an existing VPS web stack.

### Review and local production-like test

```powershell
npm run build
npx vitest run tests/operations.test.ts
npm run test:production
```

The last command builds real Linux Node 24.13.1 runtime/migration containers, PostgreSQL 17.7, Caddy 2.10.2 and an age-enabled PostgreSQL backup image. It binds **only loopback** ports 9087/9447, uses a private internal CA, production secure sessions, a restricted runtime role, fictional admin/shareholders/openings/CSV and real rebuilt-image worker updates. It encrypts a backup, decrypts it with a test-only private key and restores into a NEW database with matching fingerprints and no sessions. Its unique Compose project/volumes are removed in finally; ignored `.local/nycap-smoke-*` artifacts are private. Never use its fictional users or internal CA as live pilot data. Browser TLS bypass is test-only; a Node HTTPS client separately validates the CA chain. Public ACME/physical installation must still be tested on the actual origin. Ensure 9087/9447 are free first; do not stop unrelated listeners.

### VPS prerequisites (not yet executed)

1. Supply verified SSH host/user/key and approved directory. Inventory existing ports/services/proxies, disk, Docker/Compose and firewall. Use a dedicated deployment user; preserve existing sites. If 80/443 belong to an existing proxy, integrate the private backend with it rather than replacing that service.
2. Point `capital.nickyzaf.xyz` A to the verified VPS IPv4 and set AAAA only if IPv6 is configured. Confirm authoritative DNS and public reachability before ACME. Keep SSH restricted to owner/admin addresses and database/backend ports unexposed; allow public 80/443 only for the intended HTTPS proxy/ACME. Review [Hostinger firewall setup](https://www.hostinger.com/support/4805502-how-to-set-up-a-firewall-at-vps/).
3. On the VPS, clone the verified main commit under `/opt/nycap/repository`. Install Docker Engine/Compose from official instructions. The following commands are Bash on the VPS, **not PowerShell**; replace the approved directories if needed.

```bash
cd /opt/nycap/repository
node deploy/provision.mjs /opt/nycap/secrets
install -d -m 700 /opt/nycap/backups
cp deploy/pilot.env.example /opt/nycap/pilot.env
chmod 600 /opt/nycap/pilot.env
# Edit owner ACME email, exact APP_ORIGIN, secret/backup paths; never insert passwords here.
```

Provision requires Node 24, available directly or via `docker run --rm -v /opt/nycap:/opt/nycap -w /opt/nycap/repository node:24.13.1-bookworm-slim node deploy/provision.mjs /opt/nycap/secrets`. Secret directories must be owner-controlled mode 0700. Mounted files are readable by the non-root app (0444; mutable public recipient/access policy 0644); the 0700 parent prevents other host users reading them. Role-creation SQL stays 0600. Docker daemon/root access can read mounted secrets; Compose file secrets are **not encrypted at rest**. Use encrypted VPS disks/protected host backups and never store this directory in the Git clone, public files or image build context. Windows mode bits do not establish equivalent ACL protection: apply explicit Windows ACLs if using real secrets locally.

4. Generate an age identity on the owner's trusted **off-host** recovery device (`age-keygen -o backup-identity.txt`), protect its private key separately and copy only `age-keygen -y backup-identity.txt` output to `/opt/nycap/secrets/backup_recipient`. Configure an approved encrypted off-host destination with alerting/retention and prove key recovery. No destination is currently configured.
5. Replace the fail-closed `/opt/nycap/secrets/edge_policy` with an owner-approved IP allowlist before private owner testing. Example (replace the documentation IP with the actual admin address):

```caddyfile
@blocked not remote_ip 192.0.2.10/32
respond @blocked "Private pilot" 403
```

Do not use `tls internal` on the public origin, remove private access control merely to bypass a failed check, or enable raw access logging. Direct connections to Caddy must preserve real source IP; an upstream CDN/proxy requires a separately reviewed trust/access policy. Automatic public HTTPS/renewal uses the configured domain and owner email. See [Caddy HTTPS/reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy), [TLS](https://caddyserver.com/docs/caddyfile/directives/tls) and [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/).

### Initial provisioning and each release

Run from the checked-out repository. The shell function avoids accidentally using the local-development Compose file. No secret value goes on the command line.

```bash
dc() { docker compose --env-file /opt/nycap/pilot.env -p nycap-pilot -f deploy/compose.yaml "$@"; }
dc build --build-arg RELEASE_ID="$(git rev-parse --short HEAD)" app migrate backup
dc up -d --wait db
# FIRST EMPTY DATABASE ONLY; subsequent releases take an encrypted pre-migration backup first.
dc run --rm migrate
dc exec -T db psql -U nycap_owner -d nycap -v ON_ERROR_STOP=1 < /opt/nycap/secrets/create-roles.sql
dc exec -T db psql -U nycap_owner -d nycap -v ON_ERROR_STOP=1 < deploy/runtime-grants.sql
# Set the real owner's approved address in /opt/nycap/pilot.env as BOOTSTRAP_ADMIN_EMAIL.
dc run --rm bootstrap
dc up -d --wait app proxy
dc run --rm backup
```

Role creation and first-owner bootstrap deliberately fail if repeated; skip them on subsequent releases. Use bootstrap only on an empty real user register; its random admin password is in the private `admin_password` file and is never printed. No development seed is packaged in the runtime image or automatically run. The bootstrap is an owner account, not authorization to invite a pilot group. Compose runtime is non-root/read-only with capabilities dropped; runtime role cannot DDL/TRUNCATE/modify audit evidence. Migration-owner secrets are mounted only in the ops migration service. Treat owner/role provisioning SQL as confidential; remove the one-time role file when safely provisioned. Back up before subsequent `dc run --rm migrate`, then reapply/review grants after any new tables and redeploy the compatible app release. Keep exact image/commit/migration evidence. Rollback follows the new-database recovery procedure above; never drop/reset the live register.

### Health, backups, real records and release

`GET /health/live` returns minimal process liveness; `/health/ready` checks session table and all four successful migrations. Both are no-store, disclose no database details and create no session. Docker health checks use internal HTTP for these two routes; production API/static traffic requires HTTPS. Readiness is not a legal-source check. Probe the live HTTPS origin from an approved address and confirm cookie/security headers, `/sw.js` scope `/`, manifest/icon links, cache privacy/offline and real worker update behavior. Record results in PILOT_SIGNOFF.md; do not infer them from localhost.

Install the reviewed `deploy/nycap-backup.service` and `.timer` under `/etc/systemd/system` only AFTER paths, recipient, off-host transfer, failure alerts and retention are assigned. `systemd-analyze verify` the units, run the service manually, verify encrypted archive checksum and off-host copy, then enable the timer with `systemctl enable --now nycap-backup.timer`. The template schedules daily UTC 02:00 plus small random delay and catches missed runs. It currently creates a same-host encrypted archive only: add a monitored transfer using the destination's authenticated tooling; do not claim off-host protection until copied/restored successfully. Retention deletion is deliberately not automated before approval/verified off-host recovery. Back up Caddy certificates/account state and host/role configuration separately.

For human-verified records, use the documented CSV workflow after inspecting supplied signed registers privately. Record reviewer/signature/date and file checksum, verify legal identities/classes, preview and compare exact existing/imported/final totals against signed sources, commit the reviewed batch, and compare receipt/ledger/snapshot totals class by class. If any mapping/quantity/evidence/total differs, stop without partial import and ask the human reviewer to resolve it. Do not fabricate a register, treat fictional fixtures as production or check legal-accuracy sign-off on the owner's behalf. Keep actual source rows/checksums/receipt IDs in restricted evidence, not a public Git commit. Pilot invitations require the owner's separate explicit security/accuracy/restoration approval and named pilot group after every launch gate passes.
