# Day 1 architecture and learning notes

One deployable modular monolith serves public static HTML and a JSON API on the same origin. `src/server.ts` validates environment settings, connects PostgreSQL, constructs the persistent session store and starts Express. `src/app.ts` builds the app without opening a port, which lets Supertest exercise the same middleware. `src/db.ts` connects Prisma to PostgreSQL through `@prisma/adapter-pg`. `src/password.ts` owns hashing. `public/assets/app-v1.js` is an ES module with a small API helper and view functions; a larger MVC structure belongs with the portal views on Day 3.

## Schema in SQL terms

- `Company` → `companies`; `ShareClass` → `share_classes`. Each company has named classes with a unique `(companyId, name)` pair and a nonnegative exact `issuedShares` count.
- `User` → `users`. Unique normalized email, hashed password or pending invite, server-checked role and active flag. A pending invite cannot sign in.
- `Shareholder` → `shareholders`. Optional one-to-one profile per user (`userId` UNIQUE); legal name and nullable verification timestamp. Creating an account does not assert legal ownership or create verified records.
- `Shareholding` → `shareholdings`. One row per shareholder/class pair, exact nonnegative BIGINT count. No API edits or reads are exposed yet. Day 2 must introduce append-only adjustment events and transactional reconciliation before allowing changes; a current snapshot alone is not an adjustment ledger.
- `AuditLog` → `audit_logs`. Actor, event, target and time; password/token/request bodies are excluded. Database triggers reject UPDATE/DELETE. A database owner can bypass triggers, so this does not replace restricted roles/backups. Tests retain audit rows rather than disabling the protection.
- `sessions` is owned by connect-pg-simple, created explicitly in the migration. It stores only session identity/CSRF and cookie metadata, never password hashes or holdings. Its expiry index supports cleanup; the production store prunes expired sessions.

`prisma/migrations/202611210001_day1/migration.sql` is the full SQL explanation of the initial schema: CREATE TYPE is PostgreSQL's reusable enum (MySQL commonly puts ENUM on a column); CREATE TABLE and foreign keys have their usual MySQL meaning. Composite unique indexes prevent duplicate class names/holdings. CHECK constraints reject negative shares even outside the app. The PL/pgSQL trigger raises an exception for audit mutations. Prisma does not represent that trigger or CHECKs in its schema, so preserve them in migrations.

## TypeScript through JavaScript

TypeScript adds compile-time checks; it does **not** inherently make runtime JavaScript faster. `npm run build` strips types and emits JavaScript into `dist/`; `tsx` runs TypeScript in development.

- `password: string`, `Promise<boolean>` and `interface Options` describe the values your existing JS functions expect/return. Interfaces disappear at runtime. `production?: boolean` means an optional property, like a JS property that may be undefined.
- `import { type RequestHandler }` imports a compile-time description of an Express callback. It adds no runtime import. `declare module 'express-session'` extends the session library's TypeScript description so `session.userId` and `session.csrf` are known fields; it does not create or trust those values automatically.
- `Promise<Buffer>` describes a Promise that resolves to Node bytes. The small `deriveKey` wrapper converts Node�s callback-based crypto function into the familiar `await` style. `??` provides a fallback only for null/undefined; `?.` safely accesses a possibly absent object. These are also ordinary modern JS syntax.
- `strict: true` catches missing/null values and incompatible arguments before shipping. Runtime inputs still require Zod `.parse()`: JavaScript clients can send anything regardless of TypeScript types. `.strict()` rejects extra request properties to avoid accidentally accepting fields such as `active` or `passwordHash`.

## Prisma through MySQL

A `model` describes a table. `@id` is PRIMARY KEY, `@unique` is UNIQUE, `@@unique([a,b])` is a composite unique index, and `@@map("users")` preserves the desired SQL table name while using `User` in TypeScript. `String?`/`DateTime?` permit SQL NULL; missing data stays NULL. `@default(uuid())` generates IDs through Prisma; this is not a PostgreSQL `DEFAULT` for manual SQL inserts. `@db.Uuid` uses PostgreSQL's native UUID type, unlike storing UUID text in MySQL CHAR(36).

`@relation(fields: [userId], references: [id])` is a foreign key. Array fields such as `Company.classes` are ORM relation views, not arrays serialized into a company SQL row. `findUnique({ where: { email } })` corresponds to a parameterized SELECT with a unique-key predicate. `upsert` means insert-if-missing; the seed's empty `update: {}` intentionally preserves existing rows. `$transaction(async tx => ...)` is BEGIN/COMMIT, with automatic ROLLBACK on an exception. User creation and its audit entry commit together. Invite acceptance uses a conditional UPDATE with its original hash and expiry; concurrent attempts cannot both consume the token.

Prisma CLI/client/adapter share exact version 7.10.1. `prisma.config.ts` gives the CLI its database URL and migration/seed locations; the runtime separately receives an explicit connection URL. This follows the [Prisma 7 configuration and adapter model](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7). Generated Prisma Client is in ignored `node_modules` and must be regenerated after install/schema changes. `BigInt` maps to JS `bigint` (`100n`), not `number`; JSON cannot serialize it directly, so future holding APIs must return decimal strings. There are no financial computations or money fields in Day 1.

## Security and operational boundaries

Sessions are server-side PostgreSQL records with HttpOnly, SameSite=Lax, one-hour cookies. Production cookies are Secure; development permits HTTP only on localhost. Login regenerates the ID to prevent fixation. Logout destroys the server session. Middleware reloads the user on every protected request, so role/active changes take effect immediately. CSRF uses a random session-bound token plus origin checks on all mutations, including login and invite acceptance. No CORS allowance is configured.

The production server trusts exactly one reverse proxy; that proxy must overwrite forwarded headers and be the only ingress. Do not expose the Node port publicly under that configuration. The app rejects a non-HTTPS production origin. Helmet adds security headers and same-origin CSP; all shell assets are local. Errors never echo passwords, tokens, queries or stack traces. Audit creation errors fail the operation; administrative creation/invite acceptance are atomic. A login audit may be recorded even if the later session save fails; that represents credential validation rather than guaranteed delivery of a usable cookie.

Invite delivery is manual and private, not email integration. There is no public signup, reset-password feature, user list, holdings endpoint or administrative frontend in this phase. Day 2 requires object-level authorization on every new holdings endpoint; a role check alone is insufficient. Development seeds are conspicuously fictional and blocked when NODE_ENV=production. Existing verified registers are not imported.

Bootstrap 5.3.9 CSS is copied locally by `scripts/copy-assets.mjs` during npm install; no CDN is needed. The checked-in generated CSS carries its upstream MIT license header. An exact Effect 3.22.1 override patches Prisma CLI�s transitive regex advisory while retaining its Effect 3 API; generation/migration tests verify that combination.

Password hashes carry an explicit `scrypt-v1` format tag, random 16-byte salt and 64-byte derived key. The configured work factors are N=16384, r=8, p=5 (not Node�s lower default p=1). Verification uses constant-time byte comparison; unknown accounts perform the same expensive derivation with a dummy hash.
