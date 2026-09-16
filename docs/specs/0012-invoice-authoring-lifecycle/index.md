# 0012. Invoice authoring and lifecycle

**Date**: 2026-09-15
**Status**: In Progress

## Summary

This spec is the build plan for invoices: staff build a draft from line items for one client, issue it (which assigns the next number in the agency's gapless sequence, freezes the document and emails the client's contacts), then mark it paid or void it. The two invoice tables and the money arithmetic already exist from spec 0002; this spec adds one `notes` column, one append only `invoice_events` table (a permanent record of every issue, payment, void and notification), and every rule, Server Action (a function that runs on the server when a form is submitted) and screen on top. Three things are settled here that later features depend on: an issued invoice never changes except its status, so the PDF (feature 14) can reproduce it; a client only ever sees `sent`, `overdue` and `paid` invoices, which the client portal (feature 15) enforces; and the nightly sweep (feature 18) reuses this spec's transition rule to move `sent` to `overdue`.

## Requirements

**User stories**:
- As agency staff, I want to build an invoice from line items for a client, so that the subtotal, tax and total are right every time without a spreadsheet.
- As agency staff, I want to issue an invoice, so that it gets its number, stops changing, and the client is told what to pay and when.
- As agency staff, I want to record that an invoice was paid, or cancel one, so that the agency's books match reality and the history of who did what is kept.
- As agency staff, I want to see every invoice across the agency and every invoice for one client, so that I know what is outstanding.
- As a client contact, I want an email when an invoice is issued to my company, so that I know the amount and the due date without logging in.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: From `/invoices/new` (a client picker, pre selected from `?client=<id>` when that id resolves to an active client of the acting agency), staff create a draft in one step: `status = draft`, `number = null`, `currency` copied from `organizations.default_currency`, `tax_rate_bp = 0`, `due_date` prefilled with the UTC calendar day 30 days from today, no line items; then a redirect to `/invoices/[id]`. An archived client, or a client of another agency, is refused and nothing is written.
- **AC-2**: On a draft, the header (client, due date, tax rate, notes) is saved as one form through one Server Action: the client must be an active client of the acting agency, the due date a real calendar day (`YYYY-MM-DD` that survives a `Date.UTC` round trip), the tax rate a percent with at most two decimals from 0 to 100 inclusive (stored as basis points, so `7.25` becomes `725`), the notes trimmed and at most 5,000 characters with blank stored as null. A tax rate change recalculates `tax_cents` and `total_cents` in the same write. On any invoice that is not `draft` the action refuses with `conflict` and changes nothing.
- **AC-3**: On a draft, staff add, edit, remove and move (up or down by one) line items, each as its own Server Action that recalculates `subtotal_cents`, `tax_cents` and `total_cents` in the same transaction: description trimmed, 1 to 500 characters; quantity matching `^\d{1,9}(\.\d{1,3})?$` and above zero; unit amount entered in the major unit with at most two decimals and stored as integer cents from 0 to 99,999,999; at most 100 lines per invoice; `position` stays 1 based and contiguous after every remove and move. A line whose amount, or whose resulting subtotal or total, would exceed the database's integer range is refused with a clear message rather than a database error. Any line write on an invoice that is not `draft` is refused with `conflict`, including one that races the issue transaction.
- **AC-4**: `subtotal_cents` equals the sum of the line items' `amount_cents`, `tax_cents = round(subtotal_cents × tax_rate_bp / 10000)` rounded half away from zero, and `total_cents = subtotal_cents + tax_cents`, all computed in integer cents by `src/lib/money.ts` and never in floating point; every amount shown to a person is formatted with the invoice's own currency.
- **AC-5**: Issuing a draft that has at least one line item, a due date on or after today (UTC), and an active client moves it to `sent` in one transaction that assigns `number` from `organizations.next_invoice_number`, sets `issue_date` to today (UTC), and writes one `issued` event. Two staff issuing two different drafts in the same agency at the same time both succeed with consecutive, different numbers; two staff issuing the same draft at the same time see one succeed and the other refused with `conflict`. A draft with no line items, no due date, a due date before today, or an archived client is refused with a message naming the reason, and the counter is not advanced.
- **AC-6**: After the issue transaction commits, every contact of the client that has an email receives one email carrying the agency name, the display number, the total with currency, the issue and due dates, the notes, and a button linking to `/portal/invoices/[id]`. Each attempt writes exactly one event: `notified` when every address was delivered, otherwise `notification_failed`, whose note lists the delivered addresses, the refused addresses with the provider's reason, or "no contacts to notify". An unexpected throw anywhere in the send still writes a `notification_failed` event carrying the error summary. The invoice is `sent` in every case. The issue confirm dialog warns before the click when nobody would be emailed.
- **AC-7**: On a `sent` or `overdue` invoice, "Resend notification" repeats the send of AC-6 with the same single event write, and is refused with a message when the invoice's most recent notification event (`notified` or `notification_failed`, newest by `created_at` then `id`) is less than 5 minutes old (`COOLDOWN_MINUTES` from spec 0009). It is not offered on a `draft`, `paid` or `void` invoice.
- **AC-8**: Marking a `sent` or `overdue` invoice paid takes a paid date chosen by staff (a real calendar day by the same `YYYY-MM-DD` and `Date.UTC` round trip check as AC-2, prefilled with today, not after today, not before the issue date), stores it as `paid_at` at midnight UTC of that day, moves the status to `paid` and writes one `paid` event, all in one transaction. The write is a compare and set on the status the button was rendered from: when the status has changed in the meantime, the action refuses with `conflict` and the page shows the current status.
- **AC-9**: Voiding a `draft`, `sent` or `overdue` invoice takes an optional reason (trimmed, at most 500 characters, blank stored as null), moves the status to `void` and writes one `voided` event carrying the reason, as a compare and set in one transaction. A `paid` or `void` invoice shows no void control and the action refuses it. `paid` and `void` are final: no transition leaves them.
- **AC-10**: `/invoices` replaces the reserved placeholder with a list of the agency's invoices, by default every status except `void`, ordered drafts first then by issue date descending then created date descending, 25 per page, showing the display number (or "Draft"), the client name, the status, the past due badge of AC-12, the total with currency, the issue date and the due date. URL driven controls filter by any one status and by client and toggle voided invoices in; any control change resets to page one; a client filter that does not resolve in this agency shows the empty list with the filter still visible.
- **AC-11**: `/invoices/[id]` is the editor while `draft` (the header form, the line rows with add, edit, remove, move up and move down, the live totals, an Issue button and a Void button) and the frozen document afterwards (number, dates, client, lines, totals, notes, status and exactly the actions AC-8, AC-9 and AC-7 allow for that status), followed by the invoice's events newest first with the actor's name ("System" when there is none), the kind, the time, and the note. When the most recent notification event is `notification_failed`, a warning names the reason and offers Resend.
- **AC-12**: A `sent` invoice whose `due_date` is before today (UTC) shows a "Past due" badge on the list and the detail page. The stored status is unchanged; only the nightly sweep (feature 18) moves it to `overdue`, using the `sent → overdue` transition this spec's pure status module defines.
- **AC-13**: `/clients/[id]` gains an Invoices section listing that client's invoices (every status except `void`, same ordering as AC-10, no paging, with a count in the heading), a "New invoice" link to `/invoices/new?client=<id>` (omitted when the client is archived), and an empty state when there are none.
- **AC-14**: An invoice, a line item or an event created by one agency is invisible to another on every read, and every write against it from another agency returns `not_found`. A signed in client contact reaching any `/invoices` path is handled by the `(agency)` route group's existing guard, never by this feature's pages. `invoice_events` is registered as the ninth tenant scoped table, with a contact side predicate through the invoice's client, so the tenant layer scopes it like the others.
- **AC-15**: Every issue, paid and void writes exactly one `invoice_events` row in the same transaction as the status change, and every notification attempt writes its outcome rows immediately after the send; `actor_user_id` is the acting staff member for staff moves and null for the sweep. No code path updates or deletes an `invoice_events` row.
- **AC-16**: A pure helper names the statuses a client may see (`sent`, `overdue`, `paid`) and nothing else, exported for feature 15, and `/portal/invoices/[id]` exists as a placeholder that requires a signed in client contact and says the invoice view is coming, reading no invoice data and deliberately not checking that the id belongs to that contact's client (there is nothing to protect yet; feature 15 must add that check when it shows data), so the email's link never lands on a bare 404.
- **AC-17**: `/invoices`, `/invoices/new`, `/invoices/[id]`, the client page section and the portal placeholder meet WCAG 2.2 AA in every state (empty, error, loading, every status), the confirm dialogs are keyboard operable and return focus on close, each line row's controls are labelled with that line's description, and a totals change after a line write is announced politely to assistive technology.
- **AC-18**: One migration adds `invoices.notes` and the `invoice_events` table with its index and CHECK constraints; `pnpm db:migrate:check` reports no drift, `pnpm db:schema:assert` is extended to cover the new column and table and passes, and `pnpm db:seed` writes events for the five seeded invoices without duplicating rows on a second run.

## Decision

**Chosen option**: Option 2: Per action writes on the invoice row (the projects pattern), plus a row locked issue transaction and an append only events table.

Every line change, header save and status move is its own Server Action through the tenant layer, each one recalculating the totals in the same transaction; the issue transaction takes the invoice row's lock first, so a line write can never slip in between "checked the draft" and "assigned the number"; and every move and every notification attempt leaves one row in `invoice_events`, which is both the audit log spec 0002 deferred and the source of the detail page's history.

**Implementation skills**: `zod` (`.agents/skills/zod/`) · `drizzle` (`.agents/skills/drizzle/`) · `drizzle-migrations` (`.agents/skills/drizzle-migrations/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `postgresql-table-design` (`.agents/skills/postgresql-table-design/`) · `react-email` (`.agents/skills/react-email/`) · `resend` (`.agents/skills/resend/`) · `shadcn` (`.agents/skills/shadcn/`) · `tailwind` (`.agents/skills/tailwind/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `vitest` (`.agents/skills/vitest/`) · `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`)

## Feature design

**Data model sketch**:

`invoices` and `invoice_line_items` exist as spec 0002 built them. One column is added to `invoices` and one table is new; everything else is a rule on top of the existing schema. `invoice_events` is the ninth tenant scoped table and joins the registry in `src/db/tenant/tables.ts`.

`invoices`, the rules this feature adds per column (existing columns keep their spec 0002 definition):

| Field | Type | Nullable | Rule this feature adds |
|---|---|---|---|
| client_id | uuid (fk to clients, restrict) | no | an active client of the acting agency at creation and at every header save; frozen on issue |
| number | integer | yes | null exactly while `draft`; assigned once, on issue, from the agency counter; displayed as `INV-` plus the number zero padded to four digits (`INV-0001`, `INV-10000`) |
| status | text, one of five | no | moves only through the transitions below, every move a compare and set |
| issue_date | date | yes | null while `draft`; set to today (UTC) on issue; frozen |
| due_date | date | yes | prefilled today (UTC) plus 30 days at creation; editable while `draft`; required and on or after today at issue; frozen |
| currency | char(3) | no | copied from `organizations.default_currency` at creation; never edited |
| tax_rate_bp | integer 0 to 10000 | no | entered as a percent with at most two decimals; editable while `draft` |
| subtotal_cents, tax_cents, total_cents | integer | no | recomputed by the application on every line write and on every tax rate change, inside the same transaction |
| paid_at | timestamptz | yes | midnight UTC of the paid date staff chose; present exactly when `paid` (existing CHECK) |
| **notes** | **text** | **yes** | **new.** Trimmed, at most 5,000 characters, blank stored as null; editable while `draft`, frozen on issue, printed on the PDF later |

`invoice_line_items`, unchanged; the rules: writes only while the parent is `draft`, `position` 1 based and contiguous, at most 100 rows per invoice, `amount_cents = round(quantity × unit_amount_cents)` computed by `lineAmountCents` and re checked by the existing constraint.

`invoice_events`, **new**, append only:

| Field | Type | Nullable | Rule |
|---|---|---|---|
| id | uuid (pk) | no | `newId()` in the application |
| org_id | uuid (fk to organizations, cascade) | no | tenant scope, always from context |
| invoice_id | uuid (fk to invoices, cascade) | no | |
| kind | text | no | one of `issued`, `paid`, `voided`, `overdue`, `notified`, `notification_failed`; CHECKed. `overdue` is written by feature 18's sweep, never by a staff action |
| from_status, to_status | text | yes | both set for `issued`, `paid`, `voided` and `overdue`, both null for the two notification kinds; each CHECKed against the five statuses, and a CHECK that they are null or set together exactly by kind |
| actor_user_id | uuid (fk to users, set null) | yes | the acting staff member; null for the sweep |
| note | text | yes | the void reason (at most 500 characters), the comma separated addresses for `notified` and `notification_failed`, or the failure reason |
| created_at | timestamptz | no | default now(). There is no `updated_at`: rows are never updated |

Index (`org_id`, `invoice_id`, `created_at`). Relations: `invoices` 1:N `invoice_events`, `users` 1:N `invoice_events` as actor. No code path updates or deletes a row. Its contact side predicate in `src/db/tenant/tables.ts` is `invoice_id in (select id from invoices where client_id = ctx.clientId and org_id = ctx.orgId)`, the same subquery shape `invoiceLineItems` already uses there.

**State transitions**:

`draft → sent` (issue, staff) · `draft → void` (void, staff) · `sent → paid` (mark paid, staff) · `sent → overdue` (the nightly sweep, feature 18, when `due_date` is before today) · `sent → void` (void, staff) · `overdue → paid` (mark paid, staff) · `overdue → void` (void, staff). `paid` and `void` are final. The pure module `src/invoices/status.ts` owns `canTransition(from, to)`, `nextActions(status)` (the buttons the detail page renders: issue and void on draft; mark paid, void and resend on sent and overdue; nothing on paid and void), `isPastDue(status, dueDate, todayUtc)` (true only for `sent` with `due_date < todayUtc`), `CLIENT_VISIBLE_STATUSES = ['sent', 'overdue', 'paid']`, `formatInvoiceNumber(n)` and `DEFAULT_TERMS_DAYS = 30`.

**Serialising writes on one invoice** (the rule that makes AC-3 and AC-5 hold under a race): every transaction that changes a draft, whether a line write, a header save or the issue itself, opens with the same compare and set on the invoice row through the tenant layer's conditional `update`: it re asserts `{ status: 'draft' }` with `where: eq(invoices.status, 'draft')`, a real update with a non empty SET, which both verifies the status (`undefined` back means not a draft, so `conflict`) and takes the row lock for the rest of the transaction. Two such transactions on one invoice therefore run one after the other, and whichever runs second sees the first one's status. The line writes and the header save run under `withTenantAction({ transaction: true })` as projects do. The issue action cannot, because its email must go out after the commit and that wrapper holds the transaction for the whole handler; it runs with `transaction: false` and calls a new tenant layer helper `tenantTransaction(ctx, fn)` (exported from `src/db/tenant`, opens one transaction on the pooled handle and hands `fn` a `tenantDb(ctx, tx)` accessor, a throw rolling everything back) for the locked part only. Inside it, in order: lock and verify draft (else `conflict`); read the lines, the due date and the client and validate the preconditions (else a named refusal, rolled back); increment `organizations.next_invoice_number` through a new tenant layer function `nextInvoiceNumber(ctx, tx)` in `src/db/tenant/organization.ts` (the table is not tenant scoped, so `tenantDb` cannot reach it), taking the returned value minus one as the assigned number; update the invoice with number, issue date and `status = 'sent'`; insert the `issued` event; commit. A refusal at any step rolls the counter back with it, so the sequence stays gapless. Only after the commit does the handler send the email and write the notification event through its ordinary pooled accessor.

**API surface** (Server Actions under `src/invoices/`, all through `withTenantAction`, all returning the tenant layer's `Result` shape; queries in `src/invoices/queries.ts`):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `createInvoiceDraft` | Server Action | clientId: uuid (req) | redirect to `/invoices/[id]` | staff | `validation` (archived client), `not_found` (another agency's client) |
| `updateInvoiceDraft` | Server Action, transaction | id, clientId, dueDate: `YYYY-MM-DD`, taxRatePercent: string (0 to 100, two decimals), notes?: string | the saved header and totals | staff | `validation`, `conflict` (not draft), `not_found` |
| `addLineItem` | Server Action, transaction | invoiceId, description, quantity: string, unitAmount: string (major unit) | the line and the new totals | staff | `validation` (limits, overflow, 100 lines), `conflict`, `not_found` |
| `updateLineItem` | Server Action, transaction | id, invoiceId, description, quantity, unitAmount | the line and the new totals | staff | `validation`, `conflict`, `not_found` |
| `removeLineItem` | Server Action, transaction | id, invoiceId | the new totals | staff | `conflict`, `not_found` |
| `moveLineItem` | Server Action, transaction | id, invoiceId, direction: `up` or `down` | the new positions | staff | `conflict`, `not_found`; a move past either end is a no op success |
| `issueInvoice` | Server Action (`transaction: false`; the locked part in `tenantTransaction`, then the send) | id | status `sent`, the number; notification outcome | staff | `conflict` (not draft, or raced), `validation` (no lines, no or past due date, archived client) |
| `markInvoicePaid` | Server Action, transaction | id, from: `sent` or `overdue`, paidOn: `YYYY-MM-DD` | status `paid` | staff | `validation` (date bounds), `conflict` (status moved), `not_found` |
| `voidInvoice` | Server Action, transaction | id, from: `draft`, `sent` or `overdue`, reason?: string | status `void` | staff | `conflict`, `not_found` |
| `resendInvoiceNotification` | Server Action (`transaction: false`), check then send | id | notification outcome | staff | `conflict` (status not sent or overdue, or inside the cooldown), `not_found` |
| `listInvoices(ctx, filters)` | query | status?, clientId?, includeVoid?, page | rows with client name, 25 per page, total count | staff context | none; an unresolvable client filter yields an empty page |
| `getInvoice(ctx, id)` | query | id | invoice, client, lines by position, events newest first with actor names | staff context | `undefined` when not in this agency |
| `listInvoicesForClient(ctx, clientId)` | query | clientId | rows and count | staff context | none |
| `contactsToNotify(ctx, clientId)` | query | clientId | the client's contacts with an email | staff context | none |
| `/invoices`, `/invoices/new`, `/invoices/[id]` | pages (server components) | URL params | the screens of AC-10, AC-1, AC-11 | staff, inside `(agency)/(gated)` | route level `error.tsx`, `notFound()` for an invoice not in this agency |
| `/portal/invoices/[id]` | page | id | the placeholder of AC-16 | signed in client contact | redirect to sign in otherwise |

**Notification** (after the issue transaction commits, and on resend): read `contactsToNotify`; pre generate one attempt id (`newId()`, which becomes the event row's `id`) and send one `sendEmail` per contact sequentially with the three segment idempotency key the email module documents, `invoice-notification/<invoiceId>:<contactId>/<attemptId>` (the entity is the invoice and contact pair, the version is the attempt), the From and Reply To composed exactly as the invitation email (spec 0009), the subject "Invoice INV-0001 from <Agency>", and the React Email template `src/email/templates/invoice-issued.tsx`. Then write exactly one event for the attempt: `notified` when every address was delivered, else `notification_failed`, its note in the form "delivered: a@x.com; failed: b@y.com (provider reason)" or "no contacts to notify". The whole block, from reading the contacts to the event write, sits inside one catch: any throw still writes a `notification_failed` event with the error's message as the reason and is reported the way the invitation send failure is, so a `sent` invoice never has a silent, eventless failure. The network calls happen on no open transaction, per the spec 0009 rule about the single pooled connection. Two staff pressing Resend within the same second can both pass the cooldown check and both send; this is accepted (the cost is one duplicate email, the odds are tiny, and feature 19's ceiling is the abuse control) rather than paid for with a claim row.

**Value sourcing** (every value each action produces, computes, or displays names where it comes from):
| Action | Value produced / displayed | Source |
|---|---|---|
| createInvoiceDraft | `currency` | `organizations.default_currency` read through `agencyProfile(ctx)` (spec 0003) |
| createInvoiceDraft, issueInvoice, isPastDue, markInvoicePaid bounds | today, the UTC calendar day | `todayUtc()`, moved from `src/projects/status.ts` to `src/lib/dates.ts` and re exported there, so projects and invoices share one day source; the timezone gap is spec 0002's deferred item and unchanged here |
| createInvoiceDraft | prefilled `due_date` | today plus `DEFAULT_TERMS_DAYS` (30), a constant in `src/invoices/status.ts` |
| createInvoiceDraft, updateInvoiceDraft | whether the client is active and in this agency | `clients.archived_at is null` read through `tenantDb(ctx)`; the pre selection comes from the `?client=` URL param |
| updateInvoiceDraft | `tax_rate_bp` | `taxRatePercent` input × 100, parsed as a decimal string by `percentToBasisPoints` in `src/lib/money.ts`, never through a float |
| every line write | `unit_amount_cents` | the `unitAmount` input in the major unit, parsed by `parseMoneyInput` in `src/lib/money.ts` (two decimals at most, integer cents out) |
| every line write | `amount_cents` | `lineAmountCents(quantity, unitAmountCents)` (spec 0002) |
| every line write, updateInvoiceDraft | `subtotal_cents`, `tax_cents`, `total_cents` | `invoiceTotals(lineAmounts, taxRateBp)` (spec 0002) over the lines re read inside the transaction |
| every line write | `position` | on add, the current max plus one; on remove, every higher line shifts down by one; on move, the two neighbours swap, written through a temporary position of one above the current highest (never 0, the CHECK is `position >= 1`) so the unique constraint never trips |
| addLineItem | the 100 line cap | a count of the invoice's lines read inside the same transaction, after the lock and before the insert |
| `/invoices/[id]` (draft) | whether the issue dialog warns that nobody will be emailed | `contactsToNotify(ctx, clientId).length` read by the page and passed to the dialog |
| issueInvoice | `number` | `nextInvoiceNumber(ctx, tx)`: `update organizations set next_invoice_number = next_invoice_number + 1 where id = ctx.orgId returning next_invoice_number`, minus one (spec 0002) |
| issueInvoice | `issue_date` | today (UTC) as above |
| issueInvoice, resendInvoiceNotification | the recipients | `client_contacts` rows for the invoice's client with a non empty `email`, through `tenantDb(ctx)` |
| issueInvoice, resendInvoiceNotification | the email's agency name, From and Reply To | `agencyProfile(ctx).name` and the composition rule from spec 0009 |
| issueInvoice, resendInvoiceNotification | the portal link | `env().NEXT_PUBLIC_APP_URL` plus `/portal/invoices/<id>` |
| resendInvoiceNotification | whether the cooldown refuses | the newest `invoice_events` row of kind `notified` or `notification_failed` for the invoice (ordered `created_at desc, id desc`), compared with `COOLDOWN_MINUTES` from `src/contacts/limits.ts` |
| listInvoices | the row order | an in memory comparator: draft before non draft, then `issue_date` descending, then `created_at` descending, then `id` ascending as the final tiebreak |
| markInvoicePaid | `paid_at` | the `paidOn` input as `<paidOn>T00:00:00Z` |
| markInvoicePaid | the date bounds | `invoices.issue_date` and today (UTC) |
| every move | `actor_user_id` | `ctx.userId` from the tenant context (spec 0003); null for the sweep |
| every move | `from_status`, `to_status` | the `from` the button was rendered with (hidden input) and the target the action owns |
| list and detail | the display number | `formatInvoiceNumber(number)`; "Draft" when null |
| list and detail | formatted amounts | `formatMoney(cents, currency)` in `src/lib/money.ts`, `Intl.NumberFormat` with the `en-US` locale and the invoice's `currency` |
| list and detail | the past due badge | `isPastDue(status, dueDate, todayUtc())` |
| list | the client name | join to `clients.name` through the tenant accessor |
| detail | the actor's display name on an event | `users.name`, falling back to `users.email`; "System" when `actor_user_id` is null |
| detail | which buttons render | `nextActions(status)` |
| detail | the notification warning | the newest notification event (same ordering as the cooldown) has kind `notification_failed`; its `note` is the reason shown |
| client page section | the count and rows | `listInvoicesForClient(ctx, clientId)` read once by the page |
| portal placeholder | who may see it | the contact context from spec 0003, resolved from the session, never from the URL |

**Key invariants**:
- `number` is null exactly while `status = draft`, and (`org_id`, `number`) is unique; the issue transaction is the only writer of `number`.
- Issued numbers in one agency form a gapless ascending sequence: the counter is advanced only inside the issue transaction, after every precondition has passed, and a rollback returns it.
- Line items, the header and the notes change only while `status = draft`; every such write starts with the row locking compare and set on `status = draft`.
- `subtotal_cents` is the sum of the invoice's line amounts after every committed transaction, and the tax and total CHECKs from spec 0002 hold.
- Every status move is a compare and set on the status the caller saw, follows `canTransition`, and writes exactly one `invoice_events` row in its own transaction.
- `paid` and `void` are final; `paid_at` is set exactly when `paid`.
- A client sees only `CLIENT_VISIBLE_STATUSES`; drafts and voided invoices never reach a contact context.
- Every query and write goes through `tenantDb(ctx)`; the acting agency comes from the session, never from the URL or a form field.

**Security model**:
- Any staff member of the agency (admin or member) may create, edit, issue, mark paid, void and resend; every action uses `withTenantAction`'s default staff guard. Feature 16 may tighten individual moves to admin with the existing `requireRole` option and no other change.
- A signed in client contact never reaches `/invoices*`; the `(agency)` route group's guard handles that before any page here runs. The contact accessor predicate for `invoice_events` goes through the invoice's `client_id` so that feature 15 can list events later if it wants to, and `CLIENT_VISIBLE_STATUSES` is the rule it must apply.
- Cross tenant: an id from another agency is `not_found` on every read and write, by construction of the tenant layer (spec 0003).
- No card data, no bank data and no money movement, so no PCI DSS scope. The `notified` event's note carries contact email addresses, which are personal data already held on `client_contacts`; a future GDPR erasure of a contact must also scrub those notes, recorded in Follow-up.
- The issue email is the third email the product sends on a staff action; its cooldown is per invoice, and feature 19 adds it to the per agency ceilings.

**Configuration required**:
- None. The feature uses the existing `RESEND_API_KEY`, `EMAIL_FROM` and `NEXT_PUBLIC_APP_URL`, and no new environment variable or credential.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: create a draft for a client, add two lines, set tax to 7.25 percent, issue it; the invoice reads `sent` with number 1, today's issue date, the right totals, one `issued` event and one `notified` event listing the client's contact addresses, and the emails went out with the portal link, verifies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-15**.
- Failure case, concurrency: two transactions issue two different drafts of one agency at once, both commit with consecutive numbers; two transactions issue the same draft at once, one commits and the other returns `conflict`; a line removal started while the issue holds the row lock returns `conflict` and the issued invoice keeps the line, verifies **AC-3**, **AC-5**.
- Failure case, preconditions: issuing a draft with no lines, with a due date before today, or for a client archived after the draft was created, is refused with the named reason and `organizations.next_invoice_number` is unchanged afterwards, verifies **AC-5**.
- Failure case, notification: the email provider refuses one of two contacts; the invoice is `sent`, one `notification_failed` event names the delivered address and the refused one with its reason, the detail page shows the warning, and Resend within five minutes is refused while Resend after it sends again and writes one `notified` event; a transport that throws leaves a `notification_failed` event rather than nothing, verifies **AC-6**, **AC-7**, **AC-11**.
- Failure case, stale move: staff A marks an invoice paid while staff B's page still shows `sent`; B's void submits `from = sent`, returns `conflict`, and the page shows `paid`, verifies **AC-8**, **AC-9**.
- Failure case, arithmetic: a quantity and unit amount whose product would exceed the integer range is refused with a message and no database error is thrown; a tax rate of `7.255` is refused, verifies **AC-2**, **AC-3**.
- Auth/permission: staff of agency B reading or writing agency A's invoice, line or event get `not_found`; a signed in client contact requesting `/invoices/[id]` is turned away by the route group guard; the portal placeholder refuses an anonymous request, verifies **AC-14**, **AC-16**.
- Rendering: a `sent` invoice due yesterday shows the past due badge and its stored status is still `sent`; the list hides void by default and shows it with the toggle; the client page section counts every non void invoice, verifies **AC-10**, **AC-12**, **AC-13**.
- Accessibility: axe passes on every page in every state and both themes; the confirm dialogs trap and return focus; the totals region announces after a line write, verifies **AC-17**.
- Migration: the migration applies to a fresh database and to the current one, `db:migrate:check` and the extended `db:schema:assert` pass, the seed is idempotent, verifies **AC-18**.

## Build plan

Ordered for Tracer Bullet: the migration first because the thread needs the events table, then the thinnest end to end thread (a real draft with one real line, issued for a real number through the real transaction, visible on a real list and detail page, tenant scoped), then each later task thickens one part of it.

1. [x] Schema and migration: add `notes` to `invoices` and the `invoice_events` table (kinds, from and to with their CHECKs, actor, note, index) in `src/db/schema/invoices.ts`, the relations, the drizzle-zod schemas, the tenant table registry with the contact predicate through the invoice's client, `pnpm db:generate`, the `db-schema-assert` extension, and the seed writing one plausible event history for each of the five seeded invoices; a database test that the CHECKs refuse a `notified` row with statuses and an `issued` row without them. Satisfies **AC-14**, **AC-15**, **AC-18**.
2. [x] The pure modules: `src/invoices/status.ts` (transitions, `nextActions`, `isPastDue`, `CLIENT_VISIBLE_STATUSES`, `formatInvoiceNumber`, `DEFAULT_TERMS_DAYS`), `todayUtc` moved to `src/lib/dates.ts` with the projects module importing it, and `formatMoney`, `parseMoneyInput` and `percentToBasisPoints` added to `src/lib/money.ts`; unit tests over every status pair, the past due boundary (due today is not past due), the number padding at 9999 and 10000, and the money parsers' refusals. Satisfies **AC-4**, **AC-9**, **AC-12**, **AC-16**.
3. [x] The Zod input schemas in `src/invoices/schema.ts`: draft create, header update, line add and update, line move, issue, mark paid, void and resend, with every limit from AC-2 and AC-3; unit tests. Satisfies **AC-2**, **AC-3**.
4. [x] One thread end to end: `tenantTransaction(ctx, fn)` and `nextInvoiceNumber(ctx, tx)` in the tenant layer, with a database test that a throw inside `tenantTransaction` rolls back and that its accessor carries the same tenant predicates; `createInvoiceDraft` and `/invoices/new` with the native client select pre selected from `?client=`; `addLineItem` with the row locking compare and set, the line count cap and the totals recalculation; `issueInvoice` as the transaction described above, writing the `issued` event and not yet sending email; `/invoices` replacing the reserved placeholder with a minimal list; `/invoices/[id]` showing the header, the lines, the totals, the display number and an Issue button, with a route level `error.tsx`; database tests for the concurrent numbering, the same draft issued twice, the line write racing the issue, the precondition refusals leaving the counter untouched, and cross agency invisibility on every read and write. Satisfies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-14**, **AC-15**.
5. [x] Notification: `src/email/templates/invoice-issued.tsx`, `contactsToNotify`, the send loop and the single event write after the issue commits (the whole block inside one catch), the issue confirm dialog with the no contacts warning fed by the page's contact count, `resendInvoiceNotification` with the cooldown, the warning and Resend button on the detail page, and the `/portal/invoices/[id]` placeholder; tests with the console transport for the partial failure, the no contacts case, the throwing transport, the cooldown and the idempotency keys. Satisfies **AC-6**, **AC-7**, **AC-11**, **AC-16**.
6. [x] Thicken the draft editor: `updateInvoiceDraft` and the header form (client, due date, tax rate, notes), `updateLineItem`, `removeLineItem` and `moveLineItem` with the renumbering, the line rows with labelled controls, the polite live region for the totals, and the `conflict` message when the invoice stopped being a draft; database tests for the contiguous positions after every remove and move. Satisfies **AC-2**, **AC-3**, **AC-17**.
7. [x] Paid and void: `markInvoicePaid` with the paid date dialog and its bounds, `voidInvoice` with the optional reason dialog, both compare and set with a hidden `from`, the events written in the same transaction, and the detail page rendering exactly what `nextActions` returns; a database test for the stale move race. Satisfies **AC-8**, **AC-9**, **AC-15**.
8. [x] Thicken the list and the frozen document: the status, client and void controls driven by URL params, the ordering, 25 per page with the reset on any control change, the past due badge on both pages, the frozen document view after issue, and the events list with actor names. Satisfies **AC-10**, **AC-11**, **AC-12**.
9. [x] The client page: `listInvoicesForClient`, the Invoices section on `/clients/[id]` with its count, New invoice link and empty state. Satisfies **AC-13**.
10. [x] Empty state, error state and an accessibility pass (axe, both themes) across `/invoices`, `/invoices/new`, `/invoices/[id]`, the client page section and the portal placeholder; add the line row, the totals block, the status chip with the past due badge, and the three dialogs to `/design` in every state. Satisfies **AC-17**.

## Consequences

**Positive**:
- The frozen document rule plus the events table give feature 14 (the PDF) an invoice that cannot change under it and feature 15 (the portal) a single visibility constant, so neither has to reason about drafts or history.
- The row locking compare and set closes the one race spec 0002 could not: a line written between "checked the draft" and "assigned the number". Both writers wait on the same row, so whichever runs second sees the truth.
- Numbers stay gapless under every refusal, because the counter is advanced last inside the transaction and rolls back with it.
- The audit gap spec 0002 named on a financial document is closed while the invoice code is written, which is the only cheap moment to do it.
- No new library, no new environment variable, one migration; the email path is the one spec 0009 already runs.

**Negative / tradeoffs**:
- "Today" is the UTC calendar day for the issue date, the due date prefill, the paid date bounds and the past due badge, so an agency far from UTC sees dates shift by a few hours around midnight; the fix is the deferred timezone column, unchanged by this spec.
- A correction to an issued invoice means void and reissue, which consumes a number and leaves a voided one in the history. That is the price of a document the client can trust.
- The unit amount input assumes a currency with two decimal places in its minor unit; a zero decimal currency such as JPY would be entered and displayed inconsistently. Recorded in Follow-up.
- Money formatting uses the `en-US` locale regardless of the agency, so a European agency sees `€1,234.56` rather than `1.234,56 €`.
- Every line change is a round trip and a transaction, which is a little slower than an all in one form for someone entering fifty lines; the trade is correctness after every keystroke of the totals.
- Two staff pressing Resend in the same second can both send, because the cooldown is a check followed by an act with no claim row; accepted for one duplicate email at tiny odds.
- The list loads every matching row for the agency and pages in memory, as clients and projects do; the same scaling note spec 0006 carries.
- `tenantTransaction` is a second way to open a transaction beside the action wrapper's flag; it exists for the one shape the flag cannot express (commit, then a network call, then more writes), and a reviewer should ask why whenever a new caller reaches for it.
- Last write wins on the draft header fields; only the status and the line set are protected by the lock.

**Neutral**:
- `todayUtc` moves to `src/lib/dates.ts`; projects keeps working through the re export.
- `invoice_events` is the first append only table; the tenant accessor's generic `update` and `delete` still compile against it, so "never updated" is a rule enforced by review and by AC-15's test, not by the type system.
- The `overdue` event kind is defined here and written by feature 18, so that feature needs no schema change.
- The `(agency)/(gated)/invoices` placeholder is deleted, closing the reservation spec 0005 made.

## Follow-up

- [ ] Feature 14 (invoice PDF): the frozen document view on `/invoices/[id]` is the reference the PDF must match; `notes`, `formatInvoiceNumber` and `formatMoney` are the shared pieces.
- [ ] Feature 15 (client portal): replace the `/portal/invoices/[id]` placeholder, apply `CLIENT_VISIBLE_STATUSES` in every contact side invoice query, and decide whether contacts see the events list.
- [ ] Feature 18 (daily cron sweeps): implement the `sent → overdue` sweep with `withSystemAccess`, using `canTransition` and writing one `overdue` event per moved invoice with a null actor.
- [ ] Feature 19 (rate limiting): add "resend invoice notification" to the per agency ceilings; the per invoice cooldown here is the floor, not the ceiling.
- [ ] Agency timezone (scope Deferred): this spec adds four more readers of `todayUtc()`; the one column fix now covers projects and invoices together.
- [ ] Zero decimal currencies: `parseMoneyInput` and `formatMoney` assume two minor unit digits. Decide whether to support JPY style currencies (a minor unit table keyed by currency) before an agency outside the two decimal world signs up.
- [ ] GDPR erasure of a contact must scrub that contact's address from `invoice_events.note` on `notified` and `notification_failed` rows; note it in the erasure design when it is written.
- [ ] `react-email` and `resend` conventions are installed under `.agents/skills/` but not yet captured; a `src/email/AGENTS.md` should hold them before more templates are written (an area file, not root, since only email work needs them).
- [ ] Spec 0002's deferred `invoice_events` item and its "trigger that refuses line writes on a non draft invoice" item: the first is settled here; the second remains open, since the application lock in this spec covers the race but a hand written trigger would fail closed against a dashboard edit too. The same hand written migration could add a trigger refusing `UPDATE` and `DELETE` on `invoice_events`, turning "append only by rule and by test" into append only by construction; decide both together.

## Rationale

Reasoning and options considered: see [rationale.md](rationale.md).
