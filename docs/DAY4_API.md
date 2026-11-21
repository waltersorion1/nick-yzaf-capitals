# Day 4 reporting API and publication workflow

All APIs use existing server sessions. Administrator mutations require a current CSRF token, active ADMIN role and an audit `reason` of 3-1000 characters. Every source record starts as a draft; publishing is a separate explicit action. Investor-facing responses are always no-store and never include drafts or withdrawn records. There is no payment execution, wallet, trading, transfer or automatic valuation.

## Administrator endpoints

| Operation | Endpoint |
| --- | --- |
| List/create announcements | GET/POST `/api/admin/announcements` |
| List/create class valuations | GET/POST `/api/admin/valuations` |
| List/create declaration/payment records | GET/POST `/api/admin/dividend-records` |
| Publish a draft | POST `/api/admin/:kind/:id/publish` |
| Withdraw a draft or publication | POST `/api/admin/:kind/:id/withdraw` |

`:kind` is `announcements`, `valuations` or `dividend-records`. Lists accept `companyId`, `limit` (1-100, default 50) and `offset` (0-10000, default 0). POST creation returns 201; publishing/withdrawal returns 200. Publishing and withdrawing take only `{ "reason": "Source checked against the register" }`. All actions atomically append an audit record with actor, request ID, reason and before/after data. There are no edit/delete endpoints. Withdraw an incorrect source and create a replacement; withdrawn records remain available to administrators and in the audit history.

Use actual source documents, not the examples below, for real records. The fictional examples are documentation only and are not loaded into the normal database.

### Announcement draft

```json
{"companyId":"COMPANY_UUID","title":"FICTIONAL company update","body":"Fictional source announcement text.","datedAt":"2026-01-01","sourceReference":"FICTIONAL-MINUTES-001","reason":"Fictional source review"}
```

Title: 3-200 characters; body: 3-8000; reference: 3-300. Body is plain text, escaped when displayed; HTML is not executed.

### Indicative class valuation draft

```json
{"shareClassId":"CLASS_UUID","asOf":"2026-01-01","pricePerShare":"1.25000000","currency":"NGN","methodology":"FICTIONAL dated book-value method; subject to stated source limitations.","sourceReference":"FICTIONAL-VALUATION-001","reason":"Fictional source review"}
```

Price must be a nonnegative decimal **string**, up to 20 integer digits and 8 fractional digits. JSON numbers, scientific notation, negative prices and extra decimal places are rejected. Explicit zero is permitted when supported by a published source; an absent price is never changed to zero. Methodology is required (10-4000 characters).

There is only one nonwithdrawn snapshot per `(shareClassId, asOf)`, including drafts. To correct the same class/date, withdraw the original then create a replacement. Published history is class-specific and dated; currency changes create separate chart series. Valuation publication does not assert a live market price or change legal holdings.

### Dividend declaration draft

```json
{"status":"DECLARED","shareholderId":"PROFILE_UUID","shareClassId":"CLASS_UUID","amount":"100.10","currency":"NGN","datedAt":"2026-01-10","reference":"FICTIONAL-DECLARATION-001","reason":"Fictional declaration source reviewed"}
```

The shareholder must have a verified current or historical holding in that class. A zero current balance is allowed for historical entitlement evidence. Amount is a **positive** exact decimal string, not computed from today's share count. Source entitlement amounts must be independently checked; this is not an entitlement calculation engine.

### Dividend payment draft

```json
{"status":"PAID","declarationId":"PUBLISHED_DECLARATION_UUID","amount":"40.01","datedAt":"2026-01-11","reference":"FICTIONAL-PAYMENT-001","reason":"Fictional payment evidence reviewed"}
```

Payment class, shareholder and currency are inherited from the declaration and cannot be supplied/overridden. The parent must be a published, nonwithdrawn DECLARED record. Payment date cannot precede the declaration date. Multiple partial payment records are allowed; their cumulative nonwithdrawn amount, including drafts, cannot exceed the declaration. Drafts reserve capacity to prevent competing entries from over-recording the source, but count as paid in the investor totals **only after publication**. A parent row lock serializes concurrent payment writes.

DECLARED never changes into PAID: both source facts are retained as separate rows. Withdrawing a declaration requires withdrawing its linked nonwithdrawn payments first. References are unique per `(shareholderId, shareClassId, reference)` across retained history, including withdrawn records. For a correction, use a distinct source/amendment reference; do not reuse the original. Reusing a declaration reference for a payment is also rejected. Check history before retrying a timed-out create request; announcements do not have an idempotency key.

All reporting dates are real calendar dates in `YYYY-MM-DD`, from 1900 through the server/database's current UTC date. Timestamps or future dates are rejected. Currency is explicitly one of **NGN, USD, GBP, EUR**. There is no FX conversion or cryptocurrency support. Amount responses are exact eight-decimal strings. Publication and withdrawal timestamps are server-generated; backdated source dates are distinct from publication times.

## Shareholder endpoints and visibility

| Endpoint | Result |
| --- | --- |
| GET `/api/companies/:id/announcements` | Published company updates for a company with a positive verified holding linked to the session user |
| GET `/api/companies/:id/valuations` | Published histories for only the positively held verified classes in that company |
| GET `/api/me/valuation-summary?companyId=...` | Own current positive verified positions, latest active published class snapshot, exact indicative values and separate currency totals |
| GET `/api/me/dividends?companyId=...` | Only the session user's published declarations/payments, including historical ownership |
| GET `/api/me/dividend-totals?companyId=...` | Separate DECLARED and PAID sums by currency; no balance/due/payment instruction |

Company lists use the same limit/offset bounds. Company access outside the user's positive verified holdings returns 404, as does an unknown company. Valuation-summary and dividend filters never substitute a caller-supplied identity. An arbitrary `userId` or `shareholderId` query is rejected. Admin reports are available through admin routes; an admin account alone does not give that user a personal portfolio or dividend entitlement.

The portfolio summary uses the **latest as-of date among published, nonwithdrawn snapshots**, not the latest draft or publication time. It multiplies that source price by the user's current exact quantity; it is not a historical as-of holding balance. Missing snapshots produce `valuation: null`, `indicativeValue: null` and an incremented `missingCount`. `complete` requires every positive verified position to have a published snapshot. Each currency has a separate total; the UI displays one portfolio figure only for a complete, single-currency portfolio, otherwise **Not available** with coverage information. No partial amount is presented as a complete portfolio and no currencies are silently added together.

Dividend totals sum active published declarations and active published payments separately. Published payments must have an active published parent. For a declaration of 100.10 and a recorded published payment of 40.01, totals are **declared 100.10000000, paid 40.01000000**. There is no withdrawable balance or automatic payable amount. These totals describe records published in this system, not proof of external settlement beyond the supplied source evidence.

## Screens and errors

Open a company through Companies or a holdings link. Shareholders see announcements, exact dated valuation tables/methodology, Chart.js histories and their dividend history/totals. Chart coordinates use browser floating point solely for plotting; exact prices remain in the table and tooltips. Charts are labeled **Indicative only - not a live market quote**, with separate class/currency series. No prices are cached for offline use.

Administrators see source status and expandable forms to save announcement, valuation or dividend drafts. Enter the shared publication/withdrawal reason before using the relevant source-row action. Core company/class/profile editors and CSV imports remain Day 5; these are Day 4 reporting forms only.

Invalid input: 400; no session: 401; role/CSRF failure: 403; inaccessible/missing record: 404; duplicate source, invalid lifecycle, referenced declaration or overpayment: 409. Unexpected infrastructure errors: 500. SQL details, credentials and stack traces are not returned. Published records are retained, protected from direct core-field changes/deletion/truncation, and corrected through audited withdrawal/replacement. Production must still restrict database permissions because owners can modify database triggers.
