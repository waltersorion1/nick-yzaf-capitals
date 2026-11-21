# Verified opening CSV: preview, reconcile, then commit

Use **Admin workspace -> CSV import**. This imports only existing, independently verified legal opening balances into existing verified shareholder profiles and existing share classes. It does not create users/profiles/companies/classes, issue or transfer shares, overwrite holdings, execute payments, or skip bad rows. Use the Holdings section's audited correction/legacy-verification controls for an existing row, including a zero balance.

## Prepare the register

1. In Companies & classes, maintain the company, class and exact registered issued total. Reconcile it against the legal source register.
2. In Shareholders, invite/create the account if needed, create its legal profile, and record its source verification time/reference. An invite can remain pending activation, but the account must be active with SHAREHOLDER role and its profile verified. Deliver one-time tokens privately before refreshing/leaving the view; no email is sent.
3. Check existing holdings and history. CSV import is not a correction tool. An existing shareholder/class pair is always rejected, even when its current quantity is zero.
4. Download the header-only template from the import screen, or use `public/templates/verified-openings.csv`. Expand **CSV identifiers and mappings** to match company, class and shareholder profile IDs to the source records. Names are displayed for review but never used for fuzzy matching.

The example `docs/examples/fictional-openings.csv` uses **made-up IDs that do not exist in your database**. Do not upload it as real data or copy its verification timestamps. Replace example values with actual independently checked source information and the IDs from your own workspace.

## Nine columns

```csv
company_id,share_class_id,shareholder_id,quantity,verified_at,effective_at,source_reference,class_issued_shares,expected_class_recorded_shares
```

| Column | Meaning |
| --- | --- |
| `company_id` | Existing company UUID; must match the class's actual company |
| `share_class_id` | Existing class UUID, not a class name |
| `shareholder_id` | Existing verified shareholder **profile** UUID, not the login user's UUID |
| `quantity` | Positive canonical whole-share decimal string, at most 9223372036854775807; no separators, signs, decimals, exponent or leading zeros |
| `verified_at` | When this opening source was independently verified, as a nonfuture ISO timestamp with a timezone, e.g. `2026-01-01T10:30:00+01:00` |
| `effective_at` | Source record's effective time, also a nonfuture ISO timestamp with a timezone |
| `source_reference` | Source evidence reference, 3-300 characters, one line; CSV quoting supports commas and escaped quotes |
| `class_issued_shares` | Exact existing class denominator; must match the application's class register |
| `expected_class_recorded_shares` | Independently reconciled total expected to be represented in this application **after this entire file**, including existing rows plus this file's rows |

Header order may vary but all nine columns must occur once, with no unknown or duplicate columns. UTF-8, UTF-8 BOM, LF and Windows CRLF are supported. Blank lines are ignored. Decimal quantities/totals are processed as strings/BigInt; format spreadsheet ID and share columns as text to avoid spreadsheet rounding. A parser never repairs already-rounded source data.

Limits: 128 KiB of CSV UTF-8 bytes, 200 data rows and 4096 characters per CSV record. The JSON preview request is limited to 256 KiB. Oversized or malformed inputs are rejected; files are never silently partially imported. Split larger files into separate source-reconciled batches, with each subsequent file's expected totals accounting for earlier commits.

## Reconciliation example

A class has 1000 issued shares and **50 already recorded**. This file adds two openings of 100 and 200. Put `class_issued_shares=1000` and `expected_class_recorded_shares=350` on both rows:

- Before: 50; file: 300; after: 350; unrecorded after: 650.
- The existing ledger must equal the existing snapshot total before importing.
- Every row of a class must agree on its expected post-import total.
- The final recorded total cannot exceed the class denominator.

The unrecorded 650 is register coverage, not shares offered for sale. Source expected total is **not necessarily the issued total**. Do not copy the computed preview number into the CSV simply to make it pass; reconcile independently against the signed source register. Before totals include all existing snapshots, including preserved unverified legacy balances; an import does not verify those old records. Review legacy records separately in Holdings.

## Preview and error report

Choose the file, enter an audit reason and select **Preview CSV**. Preview stores a creator-bound, immutable server-side batch and validation/audit evidence, but writes no holding or ledger event. It resolves IDs to company/class/legal names, checks account/profile verification, detects duplicate pairs in the file and existing register, and compares exact class totals. Row diagnostics use the physical ending CSV line number (including the header), including for quoted multi-line CSV records; source references themselves must remain single-line.

Every error is shown at the row/field or class/header level. A single error blocks the entire file; there is no skip-row button. **Download validation report (JSON)** saves a private user-requested report with row diagnostics and totals; it is not an automatic browser cache and should be handled as a private source document. JSON output avoids generating spreadsheet formulas from source text. Fix the original CSV/source mappings and preview it again.

## Commit and receipts

Only a valid preview offers **Commit reviewed import**. Check the source-review/reconciliation checkbox first. Preview expires after 30 minutes and only the same active administrator can use its batch token. The commit request contains only the batch ID in the URL and `{ "confirm": true }`; client-supplied rows, quantities or replacement CSV are rejected.

Commit locks the stored batch, class registers in sorted ID order and target profiles, then reparses/revalidates the stored file. It compares the resulting validation digest with the reviewed preview. Changed balances, class denominators, names, mapping or profile/account state require a new preview. No old preview is treated as authority over changed database records.

Every new holding, OPENING event, event audit, post-import reconciliation, batch receipt and IMPORT_COMMITTED audit commits in **one database transaction**. A failure on a later row or final audit rolls all financial/batch writes back. A separate IMPORT_FAILED audit records a failed attempt when the database is available; it does not make partial holdings durable. If that failure audit itself cannot be written, the original error is still returned and no import is claimed successful.

The committed receipt contains row count, holding IDs, source content hash, time and class reconciliations. My import history restores reports/receipts after refresh; no CSV or investor data is stored in localStorage, sessionStorage, IndexedDB or service-worker caches. Going offline/logging out clears the private UI.

Repeated commit or upload of the same file by the same administrator returns the existing receipt with `replayed: true` and creates no duplicate holdings/events. Hashing normalizes UTF-8 BOM, LF/CRLF and trailing empty whitespace; file name and a new audit reason do not create new openings. Row order, header order and arbitrary cell formatting are not normalized: a differently formatted/reordered equivalent upload is rejected through existing-pair validation rather than partially skipped. A second administrator cannot use another person's preview or duplicate an already committed file. A partial unique committed-hash index adds database protection against repeated file commits.

If a network response is uncertain, review My import history or upload the same file again; do not invent a different file just to bypass duplicate checks. Concurrent same-file commits return one durable commit and a replay receipt; competing files are serialized against the class totals. After a successful earlier import, a subsequent legitimate file needs independently updated expected recorded totals.

## API reference

All endpoints are active ADMIN only, use no-store responses, and require CSRF on POST. Other accounts cannot access mappings, source files, diagnostics or receipts.

| Endpoint | Behavior |
| --- | --- |
| GET `/api/admin/users` | Bounded account/profile mappings; no password/invite hashes |
| GET `/api/admin/imports/template` | Authenticated header-only CSV download |
| POST `/api/admin/imports/preview` | `{ "csv": "...", "reason": "Source review" }`, 201 with batch/report or an existing receipt |
| POST `/api/admin/imports/:id/commit` | `{ "confirm": true }`, 200 receipt/replay or 409 rejected/stale report |
| GET `/api/admin/imports/:id` | Creator-bound stored report/receipt; a duplicate same-file preview can resolve to the creator's committed receipt |
| GET `/api/admin/imports` | Bounded creator's history, not raw CSV; `limit` 1-100 and `offset` 0-10000 |

Field/header/type errors appear in a preview report with `canCommit: false`; malformed API JSON/schema errors return 400, oversized bodies 413, unauthenticated 401, denied role/CSRF 403, inaccessible/missing batches 404, and expiry/conflicts 409. Commit audit types are IMPORT_PREVIEW, IMPORT_REJECTED, IMPORT_COMMITTED, IMPORT_REPLAY and IMPORT_FAILED. Holding event audit request IDs match the import's commit request ID, linking per-row events to the batch receipt.

Migration `202611210004_day5` adds only private import-batch evidence/receipt storage, its creator FK/indexes and immutability/receipt guards. Existing holdings are not rewritten or seeded. Preview CSV/report evidence is retained server-side for audit, including rejected/expired previews; production retention/access/backups need review during Day 6. Database owners can change triggers, so runtime permissions must be restricted before deployment. No real records are imported automatically and legal source approval remains a human responsibility.
