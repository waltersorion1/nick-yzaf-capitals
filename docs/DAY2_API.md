# Day 2 API and source-register workflow

All endpoints are same-origin JSON. Use the existing login session. Every mutation (including DELETE) requires a fresh `X-CSRF-Token` from `GET /api/auth/csrf`. Every response under `/api` is `Cache-Control: no-store` and carries a server-generated `X-Request-ID`. All `/api/admin/*` endpoints require a currently active ADMIN account, checked on the server. No public record lists exist.

Amounts are **base-10 strings**, never JSON numbers: `"100"`, `"-20"`. Share counts are whole PostgreSQL BIGINT values, at most 9223372036854775807. All writes require `reason` (3–1000 characters). Names are trimmed and limited to 200 characters, source references to 3–300. Unknown properties, invalid UUIDs and future verification/effective dates are rejected. Dates are ISO 8601 timestamps with an explicit timezone, e.g. `2026-01-01T00:00:00Z`.

## CRUD

| Entity | List/create | Read/update/delete |
| --- | --- | --- |
| Companies | `GET/POST /api/admin/companies` | `GET/PATCH/DELETE /api/admin/companies/:id` |
| Share classes | `GET/POST /api/admin/share-classes` | `GET/PATCH/DELETE /api/admin/share-classes/:id` |
| Shareholder profiles | `GET/POST /api/admin/shareholders` | `GET/PATCH/DELETE /api/admin/shareholders/:id` |

POST returns 201, GET/PATCH 200, DELETE 204. DELETE body is `{ "reason": "Explain why this unused record is removed" }`. Referenced records return 409 and are retained: delete an unused class before its company, and never delete profiles/classes with holdings, even when corrected to zero. This preserves history. Creating a profile does not create a user account; use the existing administrator invite/create-user endpoint first.

Create bodies:

```json
{"name":"FICTIONAL Example Company","reason":"Fictional source register setup"}
```

```json
{"companyId":"COMPANY_UUID","name":"Ordinary","issuedShares":"1000","reason":"Record the verified existing class total"}
```

```json
{"userId":"SHAREHOLDER_USER_UUID","legalName":"FICTIONAL Avery Example","verifiedAt":"2026-01-01T00:00:00Z","verificationReference":"FICTIONAL-PROFILE-REGISTER","reason":"Fictional profile verification"}
```

A company PATCH supplies `name` and `reason`. Class PATCH accepts `name` and/or `issuedShares` plus `reason`; it cannot move a class to another company or set the total below recorded holdings. This is maintenance of an existing legal register, not share issuance. Profile PATCH accepts `legalName` and/or the verification pair plus `reason`; `userId` cannot be changed. Unverified profiles may be created by omitting both verification fields, but cannot receive holdings. Verification requires both the date and reference; users must have an active SHAREHOLDER account when a profile is created. Verification is an administrator attestation against independently checked records, not automated legal verification.

Lists support `limit` (default 50, maximum 100) and `offset` (default 0, maximum 10000), ordered by ID. Class lists optionally filter `companyId`; holdings lists optionally filter `shareholderId` and/or `shareClassId`. Responses are arrays. Empty lists return `[]`. Duplicate names use PostgreSQL's case-sensitive unique rules: the same company name, same `(companyId, class name)`, same profile account, or same `(shareholderId, shareClassId)` opening is rejected. Prefer consistent register spelling rather than case variants.

## Verified openings and immutable corrections

1. Create/invite the user and create their profile.
2. Verify the profile using its verification date and source reference.
3. Record a **verified existing opening**, never a purchase or new investment:

`POST /api/admin/holdings/openings`

```json
{"shareholderId":"PROFILE_UUID","shareClassId":"CLASS_UUID","quantity":"100","verifiedAt":"2026-01-01T00:00:00Z","effectiveAt":"2026-01-01T00:00:00Z","sourceReference":"FICTIONAL-OPENING-REGISTER","reason":"Verified fictional opening from source register"}
```

This atomically creates a snapshot and its OPENING ledger event, applies the balance, and appends an audit entry. Duplicate openings return 409; never retry a successful opening as a new one. `verifiedAt` means when the source was checked, `effectiveAt` is the date recorded in the source, and `createdAt` is when the app recorded the event. Totals always reflect the current correction sequence, not a historical-as-of-date calculation.

4. Correct a recording error with `POST /api/admin/holdings/:id/adjustments`:

```json
{"delta":"-20","effectiveAt":"2026-01-02T00:00:00Z","sourceReference":"FICTIONAL-CORRECTION-NOTE","reason":"Correct an opening transcription error"}
```

A correction must be nonzero, leave a nonnegative balance, and keep all recorded holdings within that class's issued total. Zero balances remain in the register. No PATCH or DELETE holding/event endpoint exists. Corrections are administrative record corrections only; transfers, issuance and trading are outside scope. Correct a mistaken correction with another explained event. There is no idempotency key for adjustment requests: after a network timeout, inspect the event history before manually retrying to avoid applying a delta twice.

`GET /api/admin/holdings`, `GET /api/admin/holdings/:id` show snapshots. `GET /api/admin/holdings/:id/events` shows sequenced, paginated events with before/delta/after, administrator actor, explanation, source and dates. `GET /api/admin/audit-logs?targetId=HOLDING_UUID` returns immutable audit entries. Ordinary CRUD stores before/after metadata; holding events produce their audit entry inside the database trigger in the same transaction. Audits include request IDs; password hashes, invitation tokens and request bodies are excluded.

## Day 1 upgrade

Migration `202611210002_day2` preserves every previous quantity and adds a `LEGACY_BASELINE` event. It does not invent source evidence or attribute old records to an administrator. Those snapshots have `verificationRequired: true`, a null displayed ownership percentage, and are excluded from shareholder APIs. Existing profile dates alone are insufficient: supply the missing profile source reference and date with a profile PATCH.

After independently checking the existing balance, use `POST /api/admin/holdings/:id/verify` with:

```json
{"verifiedAt":"2026-01-01T00:00:00Z","effectiveAt":"2026-01-01T00:00:00Z","sourceReference":"FICTIONAL-VERIFIED-LEGACY-REGISTER","reason":"Verified the preserved fictional opening"}
```

This appends a zero-delta VERIFICATION event and an audit entry; the quantity stays unchanged. Repeated verification or correction before verification returns 409. If an old snapshot is incorrect, reconcile it against human-verified evidence before attesting to its opening; do not use this endpoint to assert unsupported ownership. The optional development seed verifies only its explicitly fictional demo profile/holdings, not arbitrary legacy records.

## Ownership and reconciliation

`GET /api/admin/share-classes/:id/reconciliation` returns issued, recorded, verified, unverified, unrecorded and ledger share totals as decimal strings, plus `reconciled` and `recordedPercentage`. `unrecordedShares` is the legal class total not represented in this application's snapshots; it does not mean shares available for sale.

`GET /api/me/holdings` and `GET /api/me/holdings/:id` use the session's user ID and return only that user's verified holdings with company/class details. Supplying another user's holding ID returns the same 404 as a missing record; supplying a query `userId` is rejected. Shareholders cannot read administrative profiles, another account's records, or the staff audit/event feeds.

Ownership = own shares / that class's recorded issued total × 100. It is returned as a string rounded half up to six decimal places using BigInt arithmetic, not floating point. For example, 100 of 1000 Ordinary shares is `"10.000000"`; 25 of 100 Preferred shares is `"25.000000"`. These denominators are never mixed into an invented company-wide percentage. If issued shares are zero, percentage is null. Display rounding can make separately rounded percentages sum slightly above/below 100; reconcile exact share counts.

A class lock serializes openings, corrections and denominator changes. Repeatable-read transactions keep balance/denominator and reconciliation reads consistent. Database triggers enforce nonnegative/cap/evidence/sequence rules, update only snapshots affected by events, and reject event/audit UPDATE, DELETE and TRUNCATE. Database owners can change triggers, so production still needs restricted runtime permissions and backups.

Safe error statuses: 400 invalid input, 401 no active session, 403 role/CSRF denial, 404 absent or inaccessible record, 409 duplicate/referenced/constraint/conflicting update, 500 unexpected infrastructure failure. Responses omit SQL, driver internals and stack traces. Tests use fictional data in a separate database. No admin or portfolio UI has been added; those remain later-day work.

If Prisma records the Day 2 migration as failed after a legacy over-allocation check, first reconcile the source data and verify that the migration transaction rolled back. In that specific failed-migration recovery case, run `npx prisma migrate resolve --rolled-back 202611210002_day2`, then `npm run db:migrate`. Do not mark a failed migration applied or delete its history. Normal upgrades do not require `migrate resolve`.
