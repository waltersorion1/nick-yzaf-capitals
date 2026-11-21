# NyCap â€” Days 1-2 foundation

Express + strict TypeScript API, PostgreSQL + Prisma, and a same-origin Vanilla JS ES module shell. This repository implements **Days 1 and 2** of `Codex_Playbook.md`, read in full. Day 2 adds protected company/class/profile CRUD, verified openings, immutable corrections and account-isolated holding reads. Portfolio/admin screens, valuations, trading and payments remain outside the implemented scope.

## Windows / VS Code setup

1. Install Node.js **24 LTS** (tested with 24.13.1), VS Code and either PostgreSQL **17** or Docker Desktop (Linux containers). Prisma CLI, client and adapter are pinned together at 7.10.1. TypeScript and all direct packages are exact pins; commit `package-lock.json` and use `npm ci`. Do not run `prisma@latest` against this project.
2. In VS Code choose **File â†’ Open Folder**, open this repository, then **Terminal â†’ New Terminal** (PowerShell). VS Code's built-in TypeScript support is sufficient. No global Prisma installation is needed. If execution policy blocks `npm.ps1`, use `npm.cmd` / `npx.cmd` instead of relaxing machine policy.
3. Run:

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Paste that random output into `SESSION_SECRET` in `.env`. Replace the database password in `DATABASE_URL`, URL-encoding special characters. Keep `.env` private. Set a separate `SEED_ADMIN_PASSWORD` of 12â€“128 characters if using the fictional demo seed. The seed never runs automatically.

## PostgreSQL service and databases

With the Windows PostgreSQL installer, include command-line tools and remember the `postgres` superuser password. In an **elevated** PowerShell terminal:

```powershell
Get-Service *postgres*
Start-Service postgresql-x64-17
```

Use the actual service name shown by `Get-Service`. If already running, no restart is required. In a normal terminal (adjust the installed path):

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -U postgres -d postgres
```

At the `postgres=#` prompt:

```sql
CREATE ROLE nycap LOGIN PASSWORD 'choose-a-private-local-password';
CREATE DATABASE nycap OWNER nycap;
CREATE DATABASE nycap_test OWNER nycap;
\q
```

Expected: `CREATE ROLE`, then `CREATE DATABASE` twice. This development role owns only the two development databases; do not run the app as `postgres`. PostgreSQL uses roles for database logins, unlike MySQL's `user@host` accounts. `public` is a schema (namespace) **inside** each database, not a public-access flag. Production should use distinct migration-owner and restricted runtime roles.

Docker alternative (use this instead of installing a Windows PostgreSQL service):

```powershell
$env:POSTGRES_PASSWORD = 'choose-a-private-local-password'
docker compose up -d --wait db
docker compose exec db createdb -U nycap -O nycap nycap_test
```

Compose creates the `nycap` database automatically; `createdb` creates the separate test database once. If `nycap_test` already exists, skip that command. Set the password in your `.env` `DATABASE_URL` to the same value as `POSTGRES_PASSWORD`, and URL-encode special characters. The app runs on Windows with `npm run dev` or `npm start`; only PostgreSQL runs in Docker. This image's development user has database-administration privileges; do not reuse it for production.

This binds PostgreSQL to localhost:5432 and retains data in a named volume. Stop any other database using that port before starting Compose. Use `docker compose stop db` to stop it and `docker compose up -d --wait db` to resume. Do not delete the volume to resolve migration errors. Changing `POSTGRES_PASSWORD` does not change the password inside an already-initialized volume; reuse the original password or deliberately change it with SQL. See `docs/DAY1_REPORT.md` for validation results.

## Generate, migrate, seed and run

After editing `.env`:

```powershell
npm run db:generate
npm run db:migrate
npm run db:seed
npm run build
npm start
```

Expected: generated Prisma Client; the Day 1 and Day 2 migrations applied; a fictional-seed confirmation; successful TypeScript compilation; `NyCap listening on 3000`. Open **http://localhost:3000**. For live development use `npm run dev` instead of `npm start`.

Demo emails: `admin@example.test` and `shareholder@example.test`; both use your explicitly chosen `SEED_ADMIN_PASSWORD`. Every company and person is fictional. Never use this seed for a live register. Rerunning it does not overwrite existing users or holdings; it appends a seed audit entry. There is no default/hardcoded password and no automatic public admin bootstrap. Production rejects this development seed.

`npm run db:migrate` applies committed SQL without resetting data or needing a shadow database. For a future schema change, use `npx prisma migrate dev --name descriptive_name` **only against a disposable development DB** with a separate shadow DB/appropriate permissions, inspect the generated SQL, then commit it. Never edit an already-applied migration. This Day 1 migration creates six business tables, the role enum, indexes, foreign keys, nonnegative share checks, the sessions table and an append-only audit trigger. It deletes no existing tables. Whole shares use PostgreSQL `BIGINT`, not floating point.

## Authentication and administrator invitations

The shell supports sign-in, sign-out and token acceptance. Administrator account creation is an API operation for Day 1; the admin UI belongs to later days. API requests use same-origin cookies; there is no public registration.

In browser DevTools **after signing in as the fictional admin**, use:

```javascript
const { token } = await (await fetch('/api/auth/csrf', { cache: 'no-store' })).json();
const response = await fetch('/api/admin/users', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
  body: JSON.stringify({ email: 'invited-person@example.test', role: 'SHAREHOLDER' }),
  cache: 'no-store'
});
const invitation = await response.json();
```

The response contains `invitationToken` **once**; deliver it privately and paste it into the shell's invitation form. It expires after 24 hours and can be consumed once. There is no email provider or automatic delivery. Do not put tokens in URLs, logs or browser storage. To create an already-active account, pass `password` (12â€“128 characters) in the admin request; prefer invitations so admins do not choose other users' passwords. Accepted roles are `ADMIN` and `SHAREHOLDER`; only an active administrator can assign either.

| Route | Behavior |
| --- | --- |
| `GET /api/auth/csrf` | Establish session and return CSRF token |
| `POST /api/auth/login` | Validate credentials, rotate session ID |
| `GET /api/auth/me` | Return own ID, email and current server-checked role |
| `POST /api/auth/logout` | Destroy server session and clear cookie |
| `POST /api/admin/users` | Admin-only create or invite; audited transaction |
| `POST /api/auth/accept-invite` | Consume unexpired invitation and set password atomically |

All POST requests need `X-CSRF-Token` from their current session. Login regenerates that session, so obtain a fresh token afterwards. JSON only; invalid input returns 400, missing identity 401, denied role/CSRF 403, duplicate email 409. Passwords use salted Node `scrypt`; invitation tokens are stored as SHA-256 digests. Login and invite acceptance share an IP rate limit (20 requests / 15 minutes). Limits are per-process and suited to one pilot instance; a shared limiter is required before scaling.

## Tests

Create the separate `nycap_test` database first. In PowerShell:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://nycap:YOUR_ENCODED_PASSWORD@localhost:5432/nycap_test?schema=public'
# Migrate the TEST database in a child process, preserving the normal DB setting.
$normalDb = $env:DATABASE_URL
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run db:migrate
if ($null -eq $normalDb) { Remove-Item Env:DATABASE_URL } else { $env:DATABASE_URL = $normalDb }
npm test
npm run build
npm audit
```

The suite refuses a missing test URL or an identical normal/test URL. Use a dedicated disposable test DB: test runs retain synthetic users and audit records because audits cannot be deleted. Every run uses unique `example.test` addresses. Tests exercise real PostgreSQL transactions and the real session store, not mocked authentication. See `docs/DAY1_REPORT.md` for executed results.

## PWA foundation and privacy

Manifest, 192/512 PNG maskable icons, service worker registration, public static assets and generic offline fallback are present. Localhost works as a secure browser context; outside localhost use HTTPS. The service worker caches only explicitly listed, versioned public JS/CSS/icons and `/offline.html`. Root HTML, API, account and investor data are never stored by it. API and document responses use `Cache-Control: no-store`; application code does not use localStorage, IndexedDB or persistent credentials. Offline launch shows only a generic message; it cannot show or edit holdings.

For updates change the cache version and asset filenames/allowlist, visit online, then choose **Update app and reload** when the waiting worker is detected. The worker does not activate itself over an existing session. Full browser installation, update, mobile and privacy acceptance tests remain Day 3/6 work; HTTP asset tests do not establish device installability. Android/desktop Chrome may offer Install; on iOS Safari use Share â†’ Add to Home Screen where available. Native prompts vary.

See [the Day 1 validation report](docs/DAY1_REPORT.md) for executed checks and [architecture notes](docs/ARCHITECTURE.md) for TypeScript/Prisma learning notes and security boundaries. Before deployment: configure HTTPS, exactly one trusted reverse proxy, private secrets, database TLS appropriate to your provider, restricted DB permissions and a production-only admin provisioning process. No deployment or real-user invitation is included in Day 1.

## Day 2 records and migration

See [Day 2 API/workflow](docs/DAY2_API.md), [architecture notes](docs/ARCHITECTURE.md) and [executed Day 2 results](docs/DAY2_REPORT.md). No frontend screens were added. Use the administrator session and CSRF token for admin CRUD. `/api/me/holdings` and `/api/me/holdings/:id` return only the current user's verified records. All share counts and percentages are strings; private responses remain no-store.

After pulling Day 2, stop the dev server, run the following and restart:

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run build
npm run dev
```

The new migration adds the ledger, verification/evidence fields and audit metadata, without dropping tables or changing existing quantities. **Day 1 balances become unverified legacy baselines**, hidden from shareholder reads until verified against source evidence using the API workflow. Existing profile dates need a source reference as well. If previous holdings exceed a class total, migration stops and rolls back; reconcile source records before retrying. Back up any database containing real records before migrations.

Migrate the separate test DB using the earlier test instructions before `npm test`. Tests retain fictional register records and immutable events: use a disposable DB only. The optional seed now records openings through the ledger and verifies only its explicitly fictional fixtures. It commits demo metadata first and missing openings separately, so an interrupted development seed can be rerun. It preserves existing passwords and quantities and never resets the database. Do not seed real records.
