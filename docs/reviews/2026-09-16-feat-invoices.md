# Review, feat/invoices, 2026-09-16

**Reviewed by**: Opus 5 (1M context) (author model not recorded; this is a fresh, independent re-review of the same feature-scoped diff)
**Scope**: 81 files, `git diff 04f7006` (feature 13, invoice authoring & lifecycle, on `feat/invoices`)
**Verdict**: Approve with nits

## Summary

This is the full invoice feature from spec 0012: one migration (`invoices.notes` and the append only `invoice_events` table), the pure status and money modules, the Zod boundary, nine Server Actions, four screens plus the portal placeholder, and the notification path. It is unusually careful work. Every draft write opens with the same row locking compare and set, the invoice counter is advanced last inside the issue transaction so every refusal rolls it back, money never leaves integer arithmetic, and `invoice_events` is wired into the tenant registry with the contact side sub select carrying `org_id`. I traced the spec's acceptance criteria against the code and found no criterion unmet and no correctness or tenancy defect.

The two changes made since the previous review both hold up under independent inspection rather than merely being present: the three CI steps are in the `migrations-apply` job, which is the only job with the PostgreSQL service and the job level `DIRECT_URL`, and they carry the same `if: ${{ !cancelled() }}` as their siblings, so those suites now genuinely run; and the new `listInvoices` / `listInvoicesForClient` tests seed rows that satisfy every CHECK on `invoices` and whose arithmetic matches the assertions exactly (see Test coverage for the working).

What is left is three Minors, all about what is *proved* rather than what is *built*: the confirm dialogs have no automated accessibility coverage, the append only rule has no guard, and three shared UI primitives were changed on the strength of class name assertions.

## Minor

### 🟡 The four dialogs, the surfaces AC-17 names by hand, have no axe coverage and no `/design` entry in their open state, `src/invoices/ui/invoices-ui.test.tsx:352`

**Problem**: The three axe suites render the actions group, the header form, the line table, the frozen document, the warning, the history, the filter bar, the pagination and the client section, in both themes. None of them opens a dialog, so the Issue confirm, `MarkPaidDialog`, `VoidDialog` and `EditLineDialog` bodies are never seen by axe. `src/app/design/gallery.tsx` shows only their triggers, with the note that "opening a dialog needs a client component". AC-17 singles these out ("the confirm dialogs are keyboard operable and return focus on close"), and `src/ui/AGENTS.md` is explicit: "Add every new component to `/design`, in every state it has, and give it an axe test in both themes."

**Why it matters**: The dialogs carry the only two free text inputs on a non draft invoice (the paid date and the void reason) and their own field error rendering, and they are where two live bugs were already found in this pass (the textarea overflow and the off screen footer). They are the highest risk surfaces in the feature and the only ones resting entirely on a manual check that will not be repeated on the next change.

**Suggested fix**: The existing test already opens the Void dialog with `userEvent` (line 222), so the machinery is there. Add one axe case per theme that opens each dialog and runs `expectNoAccessibilityViolations` over `document.body` (Radix portals outside `container`), and add a client side gallery entry that renders the three dialog bodies open, the way the rest of `/design` shows every state.

### 🟡 AC-15's append only rule has no guard, and the seed in fact updates `invoice_events` rows, `scripts/db-seed.ts:764`

**Problem**: AC-15 ends "No code path updates or deletes an `invoice_events` row", and the spec's Consequences say that is "a rule enforced by review and by AC-15's test". There is no such test. I grepped the tree: no application code mutates the table, which is correct today, but nothing stops the next one, and `upsertAll(tx, schema.invoiceEvents, data.invoiceEvents)` issues an `onConflictDoUpdate`, so the seed itself is a code path that updates event rows (deliberately, to satisfy AC-18's idempotency, but the invariant does not say "except the seed").

**Why it matters**: The tenant accessor's generic `update` and `delete` compile happily against `invoiceEvents`, so the only thing between this and a rewritten audit trail is somebody remembering. On a financial document's history that is the one invariant worth making mechanical, and spec 0012's Follow-up already contemplates the `UPDATE`/`DELETE` trigger.

**Suggested fix**: Either a source level assertion (a unit test, or a small ESLint rule beside the two that already fence this area, asserting no `update`/`delete` on `invoiceEvents` outside `scripts/`), or take the Follow-up item now and add the hand written trigger. Whichever you pick, name the seed as the sanctioned exception in the spec so the rule and the code stop disagreeing.

### 🟡 Three shared UI primitives changed, guarded only by class name assertions, `src/ui/primitives/primitives.test.tsx:361`, `src/ui/primitives/textarea.test.tsx:7`, `src/ui/patterns/patterns.test.tsx:189`

**Problem**: `dialog.tsx` gained `grid-cols-1`, `max-h-[calc(100%-2rem)]` and `overflow-y-auto`; `textarea.tsx` gained `max-w-full`; `page-header.tsx` lost `shrink-0`. All three are global, used by every dialog, every textarea and every page header in the product. The three new tests assert that those exact class strings are present or absent, which is a restatement of the implementation, not a check of behaviour: swapping `max-h-[calc(100%-2rem)]` for an equivalent clamp fails the test while the page is fine, and a regression arriving from a different direction (a child that sets its own `min-width`, a future `overflow` on an ancestor) passes it.

I worked through the layout and the fixes are correct: `PageHeader`'s actions wrapper can now shrink to its content's min content width, and because `InvoiceActions` renders a `flex-wrap` group the buttons wrap instead of overflowing, while other pages' single, `shrink-0` buttons are unaffected. The reasoning is sound; it is the *proof* that is thin.

**Why it matters**: The blast radius is the whole application, the evidence is a manual 320x700 check recorded in `verify.md`, and jsdom cannot measure layout, so the unit tests cannot ever become the real guard.

**Suggested fix**: The `browser` job already runs Playwright. One spec that opens the void dialog at 320x700 with a 500 character unbroken reason and asserts `document.documentElement.scrollWidth <= clientWidth` and that the submit button is in view would turn all three class assertions into one behavioural one.

## Nits

- ⚪ `src/invoices/create-invoice-draft.ts:8-12`, the header says an archived client "collapses to `not_found`, so a prober cannot tell them apart", and the very next sentence plus the code give it its own `validation` message. The code matches AC-1; the first sentence does not match the code.
- ⚪ `src/invoices/schema.ts:93`, `.refine((value) => Number(value) > 0)` calls `Number()` on a quantity, which `src/lib/money.ts:13-14` states nothing ever does. It is safe here (only the sign is read, and the regex has already bounded the string), but it is the one place the rule is broken; `parseQuantityThousandths(value) > 0n` would keep it.
- ⚪ `src/invoices/queries.ts:311`, `isNotNull(clientContacts.email)` is a predicate on a `NOT NULL` column; the `.filter(row => row.email.trim() !== "")` on line 318 is what actually excludes a blank. The comment acknowledges this, but the dead predicate reads as if it does the work.
- ⚪ `src/invoices/ui/invoices-section.tsx:77`, "View all" links to `?client=<id>&void=true`, so it shows a superset of the rows the section just counted. Defensible for a link called "View all", mildly surprising next to a heading that says `(2)`.
- ⚪ `src/invoices/invoices.db.test.ts:1182`, `[...numbers].sort()` is a lexicographic sort. Correct for `[1, 2]`, wrong the day the fixture reaches ten drafts. `sort((a, b) => a - b)` costs nothing.
- ⚪ `src/db/invoice-events.db.test.ts:158`, "refuses a kind the schema does not name" inserts `kind: "reminded"` with no statuses, which violates `invoice_events_kind_check` *and* `invoice_events_statuses_by_kind_check`. It proves a 23514 came back, not which constraint caught it.
- ⚪ `src/invoices/invoices.db.test.ts:1305-1410`, the `listInvoices` cases assert totals, filters and page sizes but never the AC-10 row order on real rows; the page 1 / page 2 split depends on that order silently. `listInvoicesForClient` (line 1447) does assert drafts first on real rows, so the comparator's wiring is covered once, which is why this is a nit and not a gap.
- ⚪ `src/invoices/resend-invoice-notification.ts:21`, `@/contacts/limits` is imported after `@/db/tenant`, breaking the alphabetical grouping the rest of the feature keeps. No lint rule enforces it, so this is taste.
- ⚪ Out of scope, noted because this change establishes the pattern: five database suites are still never run in CI, since they are `skipIf(!DIRECT_URL)` and no job names them, `src/access/gate.db.test.ts`, `src/contacts/contacts.db.test.ts`, `src/db/tenant/organization.db.test.ts`, `src/db/tenant/provisioning.db.test.ts` and `src/deliverables/deliverables.db.test.ts`. They belong to earlier, already reviewed features; the invoice ones are all wired correctly.

## Strengths

- **The serialisation rule is applied uniformly and proved under real concurrency.** `lockDraft` (`src/invoices/draft.ts:39`) is the first statement of every header save, every line write and the issue transaction, and it is a real update with a non empty SET so it both verifies and locks. Three tests with two live connections prove what that buys: consecutive numbers for two simultaneous issues, exactly one winner for two issues of the same draft, and a line removal that races the issue getting `conflict` while the issued invoice keeps its line (`src/invoices/invoices.db.test.ts:1163-1252`).
- **Gaplessness is built, not hoped for.** `nextInvoiceNumber` is called last in `issueInvoice`, after every precondition, and each refusal case has a test asserting `organizations.next_invoice_number` is untouched afterwards. `src/db/tenant/organization.ts:107` keeps the counter inside the layer and inside the caller's transaction.
- **Money never meets a float.** BigInt throughout `src/lib/money.ts`, with the database CHECKs recomputing the same expressions so a disagreement fails the write rather than storing a wrong total. `formatMoney` (line 225) is the nicest touch: it takes the symbol, placement and spacing from `Intl.formatToParts` on a placeholder and substitutes digits produced by integer division, so `Intl` only ever sees a string.
- **The notification block cannot leave a silent failure.** One catch from reading the contacts to the event write, with an inner catch around the fallback write, so a `sent` invoice always carries an outcome. Tested for a partially refused send, no contacts at all, and a transport that throws (`src/invoices/invoices.db.test.ts:809-872`).
- **`invoice_events` joins the tenant layer properly.** The contact side predicate carries `org_id` into the sub select, `tables.test.ts` asserts that explicitly against a forged context, and `tenancy.db.test.ts` was widened so all nine scoped tables are proven on every read and write, not just the eight that existed.
- **The CI additions are right.** Correct job, the service container and job level `DIRECT_URL` are in scope, `if: ${{ !cancelled() }}` matches the siblings, and each step carries a comment saying what claim it defends. Three suites that previously self skipped everywhere now run on every push.
- **The spec is treated as a contract, not a suggestion.** Nearly every non obvious decision in the code names the acceptance criterion it serves, including the places where the implementation deliberately departs from the spec's sketch and says why (`src/invoices/notify.ts:159-163`, on the attempt id not being the event row's id).

## Test coverage

Strong, and among the better suites in this repository. Unit coverage over `status.ts` (every transition pair, the past due boundary including "due today is not past due", the number padding at 9999 and 10000), `money.ts` (both parsers' refusals, the classic float trap, the integer column bounds), `dates.ts` (leap years, month and year boundaries, `2026-02-30`), `schema.ts` (every limit from AC-2 and AC-3), `queries.ts` (the comparator across all four tiebreaks, `latestNotification`), plus component tests, four page test files, and axe over the static surfaces in both themes.

I verified the two new database describes rather than taking them on trust:

- **CHECK satisfaction**: the 30 direct inserted rows satisfy every constraint on `invoices`. `currency` is `"EUR"` (upper, three letters); `subtotal`/`tax`/`total` take their `0` defaults, so `invoices_total_check` and `invoices_tax_check` both hold trivially at `tax_rate_bp = 0`; `paidAt` is set exactly on the `paid` rows and left `undefined` (so `DEFAULT`, i.e. `NULL`) otherwise, which is what `invoices_paid_at_check` demands; the `(org_id, number)` unique constraint holds because issued rows take `index + 1` and drafts take `null`; issue dates land on days 1 to 27 of January, all real.
- **Arithmetic**: indices 0-2 are `void`, so the remaining 27 cycle `draft, sent, paid, overdue` from index 3, giving 7 drafts, 7 sent, 7 paid and 6 overdue. The assertions of 27 (default), 30 (toggle), 3 (`void`) and 7 (`sent`) all match. Indices 0-23 go to `clientA1`, of which 3 are void, so the 21 the client filter test expects is right, and the 6 for the archived client is right. 27 non void rows page as 25 + 2, exactly as asserted.
- **The direct insert approach**: justified by its own comment and, I think, correct. These describes test what the query does with rows that exist, not how they came to exist, and building 30 invoices through `createInvoiceDraft` + `addLineItem` + `issueInvoice` would be slow and would not let the fixture hold `overdue` (no staff action produces it). `listInvoicesForClient` is the right counterweight and does go through the real actions for three of its four rows. The assertions are not count-only: `clientName`, `status`, row identity and exclusion are all checked.

Gaps, all recorded above: the dialogs' open state (Minor 1), the append only rule (Minor 2), the shared primitive fixes (Minor 3), and the `listInvoices` row order (nit). The cross agency case AC-14 could not be exercised live (only one Clerk organization exists in the dev environment) but is well covered by `invoices.db.test.ts:1080` and `tenancy.db.test.ts`, which is the stronger proof anyway.
