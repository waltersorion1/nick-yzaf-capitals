# Day 1 implementation report — 21 November 2026 (Africa/Lagos)

## Completed and files changed

Read `Codex_Playbook.md` completely; stopped at Day 1. The original playbook was preserved.

- Root: `package.json`, `package-lock.json`, `tsconfig.json`, `prisma.config.ts`, `vitest.config.ts`, `.nvmrc`, `.gitignore`, `.env.example`, optional `compose.yaml`, and expanded `README.md`.
- Backend: `src/app.ts`, `src/server.ts`, `src/db.ts`, `src/password.ts`, `src/session.d.ts`.
- Database: `prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/202611210001_day1/migration.sql`, `prisma/seed.ts`.
- Frontend: `public/index.html`, `public/offline.html`, `public/manifest.webmanifest`, `public/sw.js`, versioned JS/CSS and local Bootstrap CSS under `public/assets/`, 192/512 PNG icons under `public/icons/`, `scripts/copy-assets.mjs`.
- Verification/documentation: `tests/auth.test.ts`, `docs/ARCHITECTURE.md`, this report.

Implemented administrator-created accounts or expiring, single-use invitations; login/logout; persistent PostgreSQL sessions; versioned salted scrypt hashes; server-loaded roles and account status; session rotation, CSRF tokens/origin checks, rate limiting, strict Zod input validation, security headers, safe errors, and append-only audits. The shell contains sign-in, invitation acceptance and sign-out only. No public registration or financial APIs were added.

## Database and fictional data

One migration creates all six requested business tables, foreign keys, composite uniqueness, nonnegative BIGINT share checks, the role enum, PostgreSQL session storage and an audit-mutation rejection trigger. No destructive reset/drop operation was used. Pending users have no usable password until accepting an invitation.

Applied successfully from empty databases `nycap`, `nycap_test`, and finally `nycap_final`. The final fresh DB was used after password-work-factor hardening. Ran the final seed twice. Counts after both runs: 3 fictional companies, 3 classes, 2 users, 1 fictional shareholder, 3 holding snapshots and 2 seed audit records. Both stored credentials used the versioned hash format. No duplicate business rows appeared; existing records are preserved by seed upserts. The seed is explicitly opt-in and rejects NODE_ENV=production.

## Commands actually run and outcomes

Environment: Windows PowerShell, Node 24.13.1, npm 11.8.0, PostgreSQL 17.7, Prisma CLI/client/adapter 7.10.1, TypeScript 5.9.3, Vitest 5.1.1.

| Executed command/check | Final outcome |
| --- | --- |
| `Get-Content Codex_Playbook.md -Raw`, repository/instruction discovery and `git status --short` | Full playbook read; initially only README/playbook present |
| `node --version`, `npm --version` | Versions above |
| `docker info --format '{{.ServerVersion}}'`, attempted hidden Docker Desktop startup | Docker engine unavailable; Compose not validated |
| `npm install` (initial and dependency remediation), `npm ci` | Final clean install succeeded; local Bootstrap asset copy ran |
| `npm run db:generate` | Prisma Client generated successfully |
| `npm run db:migrate` with each isolated database URL | Initial migration applied successfully from empty PostgreSQL databases |
| `npm run db:seed` twice on the final fresh database | Both succeeded; fictional records/counts verified using parameterized PostgreSQL queries |
| `npm test` with distinct normal/test URLs | **19 tests passed**, 1 test file, final duration 5.33 seconds |
| `npm run build` | Passed after final server changes |
| `npx prisma validate` | Schema valid |
| `npm audit` | **0 vulnerabilities** in final lockfile |
| `npx --yes prettier@3.6.2 --write ...` | Formatted authored TypeScript, JS, CSS, HTML and JSON |
| `git diff --check` | Passed |
| Compiled `dist/src/server.js` imported with a temporary environment loader, then real HTTP fetches on localhost:3102 | App launched; root, manifest, both icons, offline page and service worker returned 200; anonymous `/api/auth/me` returned 401; all returned no-store; graceful shutdown exited 0 |

No local PostgreSQL Windows service was installed. For real SQL validation, installed `embedded-postgres@17.7.0-beta.16` **outside the repository** using `npm install --prefix <TEMP>/nycap-day1-pg-tools embedded-postgres@17.7.0-beta.16`. A temporary Node helper initialized genuine PostgreSQL 17.7 bound to 127.0.0.1:55432, created the isolated development/test databases, and supplied random local credentials without printing them. This is a validation aid, not an application dependency or replacement for the documented service setup. No real register was touched.

The HTTP smoke used the compiled application module with temporary environment variables rather than writing a local `.env`. Configure your own `.env` and PostgreSQL service using README before normal `npm start`. No server or database is intended to remain running after verification.

The test suite verifies salted hashing, unauthorized access/public-registration rejection, missing CSRF/foreign-origin rejection, input validation and uniform credential failures, session rotation/persistence, old-token rejection, role checks, admin creation/duplicates/password policy, digest-only invitations/single consumption/expiry, disabled accounts, logout, no-store/PWA assets and PNG dimensions, production Secure cookies, server-side expiration, rate limiting, immutable audit records/nonnegative shares, malformed-JSON cache headers, and audit events.

Intermediate failures were resolved: Vitest 5 removed the `describe.sequential` helper; the suite now uses normal sequential execution. Sharing a store instance between the production-cookie test and development app changed cookie generation; the test now uses a separate store. Explicit Node crypto options needed a simple typed callback-to-Promise wrapper. The first forced Windows process exit hit a libuv shutdown assertion; the server now stops the session cleanup timer, closes database pools, and exits naturally. Final build, 19-test suite and compiled launch/shutdown checks pass. Initial dependency advisories were addressed with updated exact pins and an Effect 3.22.1 transitive override; the final audit is clean.

## Learning notes

1. TypeScript `interface`, `: string` and `Promise<Buffer>` describe JS values before execution. They disappear in compiled JS and do not inherently increase runtime speed. Zod performs the separate runtime validation.
2. Prisma `@relation` is a SQL foreign key, `@@unique([a,b])` is a MySQL-style composite unique index, and `$transaction` is BEGIN/COMMIT with automatic rollback.
3. PostgreSQL BIGINT maps to JS `bigint` (`100n`); future JSON APIs must serialize shares to strings. Missing fields remain SQL NULL; no financial values are invented.
4. A migration is committed SQL history. The initial script creates tables/constraints/trigger/session storage; applying it is not the same as resetting a database. Regenerate Prisma Client when schema/client versions change.

## Known limits and next dependencies

- Browser/device PWA installation, service-worker offline/cache-storage/update flows, mobile/iOS and HTTPS deployment were **not tested**. Day 1 includes the foundation; full Day 3/6 PWA acceptance remains outstanding. HTTP routes and icon sizes passing do not prove installability.
- The Windows installer/service-creation instructions and optional Compose file were documented, not executed here. Docker Desktop could not start.
- No production `.env`, HTTPS ingress, real admin bootstrap, deployment, backups or restore drill was configured. The documented production trust-proxy setting assumes exactly one trusted ingress.
- Invitation delivery is manual and private; there is no mail provider, password reset or administrator UI yet. IP rate limiting uses a single-process memory counter; share it before multiple instances.
- Initial holdings are snapshots only. Before any Day 2 editing API, implement the append-only adjustment ledger, reconciliation and object-level permissions required by the playbook. No holdings endpoint exists to expose another account’s records.
- Tests retain synthetic users and append-only audits in the disposable test DB; never point them at a real register. Development database ownership is convenient for migrations but production needs restricted runtime permissions.
- Next work requires an explicit Day 2 request. No Day 2–7 feature work was performed.
