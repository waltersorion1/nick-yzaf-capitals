# Architecture and learning notes

The first section records Day 1; current Day 2 additions are described below.



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

- `Promise<Buffer>` describes a Promise that resolves to Node bytes. The small `deriveKey` wrapper converts Node’s callback-based crypto function into the familiar `await` style. `??` provides a fallback only for null/undefined; `?.` safely accesses a possibly absent object. These are also ordinary modern JS syntax.

- `strict: true` catches missing/null values and incompatible arguments before shipping. Runtime inputs still require Zod `.parse()`: JavaScript clients can send anything regardless of TypeScript types. `.strict()` rejects extra request properties to avoid accidentally accepting fields such as `active` or `passwordHash`.



## Prisma through MySQL



A `model` describes a table. `@id` is PRIMARY KEY, `@unique` is UNIQUE, `@@unique([a,b])` is a composite unique index, and `@@map("users")` preserves the desired SQL table name while using `User` in TypeScript. `String?`/`DateTime?` permit SQL NULL; missing data stays NULL. `@default(uuid())` generates IDs through Prisma; this is not a PostgreSQL `DEFAULT` for manual SQL inserts. `@db.Uuid` uses PostgreSQL's native UUID type, unlike storing UUID text in MySQL CHAR(36).



`@relation(fields: [userId], references: [id])` is a foreign key. Array fields such as `Company.classes` are ORM relation views, not arrays serialized into a company SQL row. `findUnique({ where: { email } })` corresponds to a parameterized SELECT with a unique-key predicate. `upsert` means insert-if-missing; the seed's empty `update: {}` intentionally preserves existing rows. `$transaction(async tx => ...)` is BEGIN/COMMIT, with automatic ROLLBACK on an exception. User creation and its audit entry commit together. Invite acceptance uses a conditional UPDATE with its original hash and expiry; concurrent attempts cannot both consume the token.



Prisma CLI/client/adapter share exact version 7.10.1. `prisma.config.ts` gives the CLI its database URL and migration/seed locations; the runtime separately receives an explicit connection URL. This follows the [Prisma 7 configuration and adapter model](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7). Generated Prisma Client is in ignored `node_modules` and must be regenerated after install/schema changes. `BigInt` maps to JS `bigint` (`100n`), not `number`; JSON cannot serialize it directly, so future holding APIs must return decimal strings. There are no financial computations or money fields in Day 1.



## Security and operational boundaries



Sessions are server-side PostgreSQL records with HttpOnly, SameSite=Lax, one-hour cookies. Production cookies are Secure; development permits HTTP only on localhost. Login regenerates the ID to prevent fixation. Logout destroys the server session. Middleware reloads the user on every protected request, so role/active changes take effect immediately. CSRF uses a random session-bound token plus origin checks on all mutations, including login and invite acceptance. No CORS allowance is configured.



The production server trusts exactly one reverse proxy; that proxy must overwrite forwarded headers and be the only ingress. Do not expose the Node port publicly under that configuration. The app rejects a non-HTTPS production origin. Helmet adds security headers and same-origin CSP; all shell assets are local. Errors never echo passwords, tokens, queries or stack traces. Audit creation errors fail the operation; administrative creation/invite acceptance are atomic. A login audit may be recorded even if the later session save fails; that represents credential validation rather than guaranteed delivery of a usable cookie.



Invite delivery is manual and private, not email integration. There is no public signup, reset-password feature, user list, holdings endpoint or administrative frontend in this phase. Day 2 requires object-level authorization on every new holdings endpoint; a role check alone is insufficient. Development seeds are conspicuously fictional and blocked when NODE_ENV=production. Existing verified registers are not imported.



Bootstrap 5.3.9 CSS is copied locally by `scripts/copy-assets.mjs` during npm install; no CDN is needed. The checked-in generated CSS carries its upstream MIT license header. An exact Effect 3.22.1 override patches Prisma CLI’s transitive regex advisory while retaining its Effect 3 API; generation/migration tests verify that combination.



Password hashes carry an explicit `scrypt-v1` format tag, random 16-byte salt and 64-byte derived key. The configured work factors are N=16384, r=8, p=5 (not Node’s lower default p=1). Verification uses constant-time byte comparison; unknown accounts perform the same expensive derivation with a dummy hash.


## Day 2 records and immutable ledger

`src/records/validation.ts` holds runtime schemas, `routes.ts` applies permissions/parsing, `service.ts` owns transactions, and `common.ts` holds audit serialization and exact math. Existing session/CSRF protections cover the module. All private responses remain no-store.

### Migration in SQL/MySQL terms

`202611210002_day2` wraps changes in BEGIN/COMMIT. ALTER TABLE adds verification/source fields and JSONB audit metadata. CREATE TABLE adds holding events with foreign keys, unique per-holding sequences, before/delta/after counts, actors, source evidence and dates. CHECK validates arithmetic. INSERT SELECT preserves old quantities as explicitly unverified legacy baselines, without inventing sources or administrators. A SUM/GROUP BY preflight aborts the migration if existing holdings exceed any class total. No tables or balances are dropped.

PostgreSQL BEFORE/AFTER triggers resemble MySQL row triggers. Validation runs first; then an event changes its snapshot and inserts its audit in the same transaction. Any error rolls everything back. Separate statement triggers block TRUNCATE, which DELETE row triggers do not cover. Guards also block direct balance edits, ledger/audit updates/deletions, moving classes between companies and reassigning a profile account. Prisma cannot fully describe these triggers/checks; preserve the SQL migration, and do not replace it with `prisma db push`.

### Learning notes

1. Prisma `include: { shareClass: { include: { company: true } } }` follows foreign keys, like SELECTs/JOINs across holding, class and company. Relation fields do not store arrays in SQL rows. Self-service queries filter the shareholder relation by the session user ID in the database query; role checks alone cannot isolate accounts.
2. `$transaction(async tx => ...)` means BEGIN/COMMIT with automatic ROLLBACK. `$queryRaw` tagged-template UUID values are bound parameters, like MySQL `?` placeholders; table names are static. `SELECT FOR UPDATE` locks a class until commit so concurrent openings cannot both consume its remaining capacity. Posting operations always lock the class before the holding. See [Prisma 7 transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions) and [PostgreSQL 17 row locks](https://www.postgresql.org/docs/17/explicit-locking.html).
3. Repeatable-read transactions give balance/denominator queries and reconciliation a consistent snapshot, like MySQL InnoDB's repeatable-read view. A response cannot combine a balance from before a correction with a denominator from afterwards.
4. `z.infer<typeof schema.opening>` asks TypeScript for the shape produced by a Zod parser. `Prisma.TransactionClient` describes the transaction-scoped database handle. `RecordError extends Error` uses ordinary JS class inheritance with an HTTP status. Type descriptions disappear at runtime; Zod still validates real inputs.

Shares and percentage computations use BigInt scaling/division with half-up rounding to six decimal places. Each class uses its own denominator; no company-wide ratio is invented. Zero denominators remain null. API/audit JSON uses strings for large numbers to preserve precision above Number.MAX_SAFE_INTEGER.

### Source and operational boundaries

New openings require a verified profile and dated source evidence. Legacy verification appends a zero-delta event without altering quantity; unverified snapshots stay hidden from shareholders. Event audits are inserted by a database trigger in the same transaction as the snapshot; CRUD audits store actor, request ID, reason and before/after metadata. Referenced company/class/profile rows cannot be deleted, even for corrected zero balances.

Verification is administrator attestation, not automated legal proof. Denominator maintenance is register correction, not issuance. There are no transfers, payment functions, historical-as-of APIs or adjustment idempotency keys. Inspect history before retrying a timed-out correction. Owners can alter database triggers, so production still needs restricted runtime roles/backups. Day 3 UI and browser/device PWA checks remain outstanding.

## Day 3 frontend and PWA

`public/assets/portal-v2.js` is the small controller: in-memory user state, hash navigation, API loading, cancellation and view selection. `api-v2.js` is the model/transport boundary, with no-store fetches, CSRF tokens and bounded pagination over the existing Day 2 APIs. `views-v2.js` contains reusable escaped HTML cards, tables, headings and accessible forms. `pwa-v2.js` handles installation and explicit update activation. Bootstrap remains local; CSS variables in `shell-v2.css` implement system/manual dark and light themes. No frontend framework or TypeScript runtime is required.

The hash identifies a screen, not permission. Actual access still depends on session-checked database filters. Company details are derived only from the current user's authorized holdings, or admin record APIs. Displayed private strings are HTML-escaped; whole share counts use JS BigInt formatting and ownership uses the server's exact decimal string. No prices, published valuations or datasets are invented; Chart.js integration belongs with Day 4's published valuation histories.

`AbortController` cancels outdated view requests, and an incrementing render epoch prevents a late response restoring private data after logout, going offline, or pagehide. The offline/pagehide paths clear the user, table DOM, credentials, navigation and private document title. A new online/pageshow checks the session afresh. BroadcastChannel signals logout to other tabs without persisting messages. Theme choices also stay in memory; the CSS system preference provides the initial choice.

The worker cache v2 contains only an explicit list of public versioned modules/CSS/icons and a generic offline page. Navigation and API calls always use network/no-store; no private HTML is generated server-side or cached. A waiting update is offered only when an existing worker controls the page, avoiding a false update banner during first install. It never calls skipWaiting automatically. The visible action asks the waiting worker to activate, then the accepting page reloads. New workers delete obsolete NyCap public caches, without touching unrelated caches. See [Playwright service-worker testing](https://playwright.dev/docs/service-workers) for the browser mechanics used in the E2E suite.

Tests use a test-only server wrapper to vary actual worker bytes/cache versions. This enables a real waiting-worker lifecycle instead of mocking update events; the production server has no such endpoint. Chromium DevTools installability checks, offline navigation, private cache-body inspection, real logout and account isolation are automated; device-specific install prompts and iOS standalone behavior still need manual hardware checks.

## Day 4 reporting, decimal arithmetic and publication

`src/reporting/validation.ts` parses strict runtime inputs; `service.ts` creates drafts, publishes/withdraws sources, enforces ownership and calculates summaries; `routes.ts` applies existing session/role/CSRF protections and serializes decimals. `public/assets/reporting-v3.js` renders sources, basic reporting forms and local Chart.js histories. The v3 controller destroys chart instances when changing views, logging out or going offline, so financial series are removed with private DOM data. The old v2 static assets remain available to already-open clients while worker v3 caches only current public assets.

Migration `202611210003_day4` creates announcements, valuation snapshots and dividend records plus a DECLARED/PAID enum. It adds foreign keys and exact NUMERIC(28,8), like MySQL DECIMAL(28,8): 20 digits before the decimal, 8 after. API inputs reject excess decimal places rather than letting the database round them. No existing holdings or opening evidence are rewritten. PostgreSQL DATE stores calendar source dates separately from server publication timestamps. A partial unique index allows only one nonwithdrawn valuation per class/date; Prisma cannot express that predicate fully, so preserve the SQL migration.

Prisma 7's `Prisma.Decimal` uses decimal.js, not a binary JS Number. Computation precision is set to 65 significant digits, enough for bounded source prices multiplied by a BIGINT share count. Quantity is converted to a decimal string, then multiplied exactly; JSON uses fixed eight-decimal strings. Currency totals are grouped explicitly with no exchange rate conversion. The summary chooses latest published as-of snapshots; drafts, withdrawn sources and missing prices are not substituted. See [Prisma 7 decimal types](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference) for storage mappings.

A payment record is a self-relation to its original declaration, like a parent foreign key to the same MySQL table. It is not a status overwrite. Parent-first row locking and exact sums prevent concurrent payment drafts exceeding the declaration; source dates and class/shareholder/currency consistency are checked in SQL as well as application code. Payment drafts reserve recording capacity but only published records contribute to reader totals. Source rows cannot be edited/deleted/truncated; publication/withdrawal is the only allowed lifecycle mutation. Application transactions commit each mutation and its audit together or roll both back. Normal read summaries use repeatable-read where multiple queries must share a snapshot.

Company announcements require a positive verified holding in that company; valuation histories further restrict to the user's positively held verified classes. Dividend reads are filtered by session shareholder and may show historical entitlement records after a balance reaches zero. Admins see drafts/withdrawals only through admin APIs. No endpoint accepts a caller-selected identity for self-service reads.

Chart.js runs from a pinned local UMD asset, following its [plain JavaScript integration](https://www.chartjs.org/docs/latest/getting-started/integration). Number conversion is limited to chart coordinates; table values/tooltips and all financial calculations remain exact strings/Decimal. Series are separated by class/currency and show published source dates, not live ticks. No authenticated API data is added to the worker cache or browser storage. Reporting inputs/source text are escaped before rendering. No payments, live prices or auto-valuations are implemented.

## Day 5 reviewed opening imports and admin workspace

`src/imports/csv.ts` parses bounded UTF-8 CSV with pinned csv-parse, preserving quantities as strings. `service.ts` validates mappings, existing pairs and source class totals, persists creator-bound previews, and commits all rows atomically. `routes.ts` supplies protected template/history/report/commit endpoints and minimal account mappings. `public/assets/admin-v4.js` composes the existing audited core record APIs and reporting editors into admin sections. New v4 assets/worker keep prior installed clients usable until they accept an update. Private admin data, upload state and invitation tokens are never added to persistent browser storage.

Migration `202611210004_day5` creates only `opening_import_batches`: a User foreign key, immutable CSV/preview/digest/reason, expiry, optional commit timestamp/request ID and JSON receipt. JSONB is comparable to MySQL JSON. A partial unique index enforces one committed source hash, while allowing rejected/uncommitted previews. CHECKs validate hash/evidence/receipt completeness; triggers retain immutable input and prevent receipt rewrites or truncation. No existing holding is changed by the migration.

The CSV parser's `info.lines` identifies a physical source line, `bom` handles Windows/Excel UTF-8 BOM, and `max_record_size` bounds records; see [csv-parse options](https://csv.js.org/parse/options/). Zod validates parser output and every domain value. Unknown raw input is not assumed safe merely because TypeScript describes a shape. Exact quantity/denominator/reconciliation sums use BigInt, just like adding MySQL BIGINT values without converting them to JS Number.

Preview reads use a repeatable-read transaction. Commit uses deterministic sorted class locks and profile locks, then reparses the stored CSV and compares a digest of current validation/mappings/totals with the reviewed digest. The digest is not a replacement for validation or permission checks; it detects a stale human-reviewed view. A checksum-normalized file hash provides replay lookup, while composite holding uniqueness still rejects reordered/formatted duplicates. Creator checks prevent using someone else's preview as your own attestation.

`RecordService.openInTransaction(tx, ...)` shares the caller's transaction handle. Calling the old independent `open()` transaction inside an import would commit rows separately, so an outer rollback could not undo them. The new helper reuses identical opening/ledger rules within one SQL BEGIN/COMMIT. Each event's trigger applies the snapshot and its audit; the import transaction checks final ledger/recorded totals, saves the receipt and appends its batch audit. Any exception rolls it all back. Transactions have a bounded 30-second execution timeout and 10-second acquisition wait; see [Prisma 7 transaction options](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference). Timeouts are failures, not partial-success responses.

The admin controller discards old state on view changes/offline/logout; asynchronous callbacks check the render epoch before showing private results. API transport supports CSRF-protected PATCH/DELETE and preserves structured conflict reports in ApiError for row diagnostics. Reports can be explicitly downloaded as private JSON using an ephemeral Blob URL, revoked after use; no CSV formula-bearing report is generated. Server preview evidence is retained for audit and needs an explicit production retention policy in later security work. No account creation or balances are inferred from an import file.
