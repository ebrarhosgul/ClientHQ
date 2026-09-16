# 0012. Invoice authoring and lifecycle: rationale

## Context

Invoices are the reason an agency pays for this product: everything else (clients, projects, deliverables) explains the bill, and the bill is what the client's accountant keeps. Spec 0002 built the two tables with the arithmetic guarded by the database (a line's amount follows from its quantity and unit price, tax follows from the stored rate, total follows from both), a per agency counter for numbering, and a status column that permits any of five values. It deliberately left every rule to this feature: what may change when, who assigns the number, how two people acting at once are kept from corrupting a financial document, and whether anyone can later tell who marked an invoice paid.

Three forces shape the design. First, a financial document has to be trustworthy after the fact: the copy the client received, the copy the agency shows, and the PDF feature 14 will generate must all be the same document, which means an issued invoice must stop changing. Second, the numbering must be gapless and collision free under concurrency, because a gap in an invoice sequence is a question from an auditor, and spec 0002 chose a counter row over a database sequence precisely so a rolled back issue returns its number. Third, the platform's connection budget is one pooled connection per serverless function (spec 0001), so no transaction may wait on the email provider, and the email must therefore happen after the commit with its outcome recorded somewhere staff can see.

Two later features lean on what is decided here. The client portal (feature 15) needs one rule for which invoices a contact may see, and the nightly sweep (feature 18) needs the `sent → overdue` transition to exist as a rule it can reuse rather than reinvent. Spec 0002 also flagged that the schema holds financial documents with no history of who changed them, and named this feature as the last cheap moment to add one.

Not deciding leaves the placeholder at `/invoices` and blocks features 14, 15 and 18, which are the rest of the invoicing half of the product.

## Options considered

### Option 1: One form, the whole draft saved on submit

The draft page is a single form holding the header and every line; a submit replaces the entire line set and recomputes the totals in one transaction. Issue, paid and void are separate actions on top.

**Pros**:
- One Server Action and one Zod schema for the whole draft; the fewest moving parts to wire.
- No intermediate state: the database only ever holds a draft someone chose to save.
- No per line round trips while typing.

**Cons**:
- Every save deletes and reinserts the lines, so a line's `id` is not stable across saves; anything that later references a line (a dispute, a credit note) has nothing to point at.
- A long draft is one large payload, and a validation error on line 37 has to be surfaced back into a form of 40 rows.
- Two people editing the same draft silently overwrite each other's whole line set, not one line.
- The totals shown while editing are client side arithmetic until the save, so what the person sees and what the database will accept can differ until they submit.

### Option 2: Per action writes on the invoice row, a row locked issue transaction, and an append only events table (chosen)

Every line change, header save and status move is its own Server Action through the tenant layer, recalculating the totals inside the same transaction. Each such transaction opens with a compare and set on the invoice row (`where status = 'draft'`) that verifies the status and takes the row lock, so writes on one invoice run one after the other. The issue transaction locks first, validates, advances the counter, updates the invoice and writes an `issued` event; the email goes out after the commit and its outcome is written as one `notified` or `notification_failed` event per attempt. Paid and void are compare and set moves that write their own event, in the shape spec 0010 introduced for projects.

**Pros**:
- The database is correct after every change, and the totals a person sees are the totals the database holds.
- The race spec 0002 could not close (a line written between the draft check and the number assignment) is closed by the row lock, with no new machinery: the tenant layer's conditional `update` already exists.
- Line ids are stable, so the history and any later feature can refer to a line.
- The events table doubles as the audit log spec 0002 deferred and as the detail page's activity list, and it gives the notification outcome a home so staff can see and retry a failed email.
- It is the pattern the rest of the app already runs on (spec 0006 and 0010), so nothing new to learn.

**Cons**:
- More Server Actions (ten) and more tests than one form.
- Each line change is a round trip; entering fifty lines is slower than typing them into one form.
- The events table is append only by rule and by test, not by the type system, since the generic tenant accessor can still update or delete rows in it.
- The issue action needs a second way to open a transaction (`tenantTransaction`), because the action wrapper's flag holds the transaction for the whole handler and the email must go out after the commit.

### Option 3: Freeze by snapshot rather than by rule

On issue, copy the header, the lines and the totals into an immutable JSON document column (or a separate `issued_invoices` table), and let the live rows keep being editable. The PDF and the client read the snapshot; staff read the live rows.

**Pros**:
- The frozen document is frozen by construction: nothing can edit a snapshot that no action writes to.
- Staff could correct a typo on their working copy without a void and reissue.

**Cons**:
- Two representations of one invoice, which drift the first time someone edits the live rows after issue; the agency's screen and the client's copy then disagree, which is the exact failure a financial document must not have.
- The database CHECK constraints from spec 0002 do not reach into a JSON column, so the snapshot's arithmetic is unguarded.
- Every read path (list, detail, PDF, portal) has to know which representation to show, and the events table would still be needed for who did what.

## Rationale

Option 2 is chosen because the forces in Context are about trust and concurrency, and Option 2 answers both with tools the codebase already has. Trust: an issued invoice is one set of rows that no action writes to except the status column, so the agency's screen, the client's email, the portal and the PDF all read the same thing. Concurrency: spec 0010 already added the conditional `update` that makes a move a compare and set; using the same call as the opening statement of every draft transaction turns it into a row lock, which is the smallest possible change that makes "line writes and the issue serialise" true. The counter advance is placed last inside that transaction so a refusal rolls it back, which keeps the sequence gapless without any extra bookkeeping.

A leaner shape was weighed for the issue itself: one atomic `UPDATE` with every precondition folded into its `WHERE` (status is draft, a line count subquery, the due date bound, a join to an active client), the counter advanced in a common table expression, and a follow up read only when nothing matched. It is one statement instead of a locked sequence, but it cannot say which precondition failed, and AC-5 promises staff a named reason; the follow up read that would work it out runs after the lock is released, so it can report a reason that has since changed. The locked sequence reads the preconditions under the lock and names the exact one that failed, which is worth the second statement.

Option 1 was the tempting simplification, and it would ship faster. It was set aside because its line set is replaced on every save, so nothing later can point at a line, two editors overwrite each other wholesale, and the totals a person watches while typing are not the ones the database will hold. For a document whose whole value is that the numbers on it are right, correctness after every change is worth ten actions instead of one. Option 3 was considered because "frozen by construction" is a stronger guarantee than "frozen by rule", but it buys that guarantee by creating a second copy of the invoice, and two copies of a financial document is a worse problem than the one it solves.

The events table was deferred by spec 0002 and is added now because the invoice code is being written now: every move already runs inside a transaction that can insert one more row, whereas retrofitting history later cannot recover the moves that happened before it. The engineer's answers extended it beyond a pure transition log to carry the notification outcome, which is what makes "did the client get told" answerable from the page rather than from a log search, and what gives the Resend button something to react to. The `overdue` kind was added at write time so feature 18 can record its moves in the same table without a schema change; it is the only addition beyond the model the engineer confirmed, and it costs nothing (the actor column was already nullable for exactly that sweep).

The engineer's choices on the smaller questions all favoured the recoverable path over the strict one: a draft is voided rather than deleted, a client with no contacts can still be invoiced with a warning rather than a block, a zero total invoice can be issued, and any staff member may make any move until feature 16 decides otherwise. Those are the right defaults for a two person agency, and each is one option away from tighter when a real agency asks.

The RECOMMEND items settled at write time, each with its runner up: the issue transaction locks the invoice row first through the existing conditional `update` rather than a `select ... for update` the accessor does not offer (runner up: add locking reads to the tenant layer, more surface for one caller); `nextInvoiceNumber` lives in `src/db/tenant/organization.ts` beside `agencyProfile`, since `organizations` is not tenant scoped and that file is where the layer already reads it (runner up: a raw statement in the invoices feature, which the lint rule forbids); `todayUtc` moves to `src/lib/dates.ts` so projects and invoices cannot drift on what "today" means (runner up: import it from the projects module, a feature depending on a sibling feature); money display uses `Intl.NumberFormat` with `en-US` and the invoice's currency (runner up: the request locale, which would make one invoice format differently for two staff); the paid date is stored as midnight UTC of the chosen day (runner up: the click time, which the engineer ruled out); the email idempotency key is per attempt and per contact so a retry of one send never duplicates and two attempts never collide (runner up: per invoice, which would silently drop a deliberate resend); issuing requires an active client, matching creation, so an archived client cannot receive new bills (runner up: allow it, which would let an archived client keep accumulating invoices nobody looks at); and the list pages in memory like the other two lists rather than introducing keyset pagination for one screen.
