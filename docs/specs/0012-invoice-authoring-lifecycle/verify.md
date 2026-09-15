# Verify: invoice authoring and lifecycle · spec 0012 · updated 2026-09-16

_Steps derived from spec 0012 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones. Run them signed in as agency staff against a dev database (`pnpm db:seed` gives Studio North five invoices in every status)._

## UI / manual

- [ ] Open `/invoices/new` → a client picker only; choose an active client and press Create draft → lands on `/invoices/[id]` as a draft with no number, the agency's default currency, tax 0%, due date exactly 30 days from today (UTC), no lines → AC-1
- [ ] Open `/invoices/new?client=<active client id>` → that client is pre selected; with an archived or foreign id → nothing pre selected → AC-1
- [ ] On a draft, save the header with tax `7.25`, a due date, and notes with leading and trailing spaces → totals recompute, notes are stored trimmed; tax `7.255` or `100.01` is refused beside the field; a due date like `2026-02-30` is refused → AC-2
- [ ] Add a line with quantity `3.5` and unit amount `125` → amount `$437.50`, totals follow; quantity `0`, unit amount `1,000` or `1.234` are refused beside the field; a line whose quantity times amount exceeds the integer range is refused with a message, never a database error → AC-3, AC-4
- [ ] Add three lines, remove the middle one, move the last one up, then past the top → positions read 1, 2 after the remove, the order swaps on the move, and the move past the top changes nothing → AC-3
- [ ] Add a line, then set tax to 20% → tax equals `round(subtotal × 0.20)` half away from zero; every amount on screen carries the invoice's currency symbol → AC-4
- [ ] Issue a draft with no lines → Issue is disabled; with lines but a past due date → refused naming the due date; with an archived client → refused naming the client; in each case `organizations.next_invoice_number` is unchanged → AC-5
- [ ] Issue a valid draft → status Sent, number `INV-0001` (or the next in the agency), issue date today (UTC), one Issued event, one Client notified event listing every contact email; the console transport shows one email per contact with subject `Invoice INV-000N from <Agency>`, the total with currency, both dates, the notes and a `/portal/invoices/<id>` link → AC-5, AC-6
- [ ] Issue a draft for a client with no contacts → the confirm dialog warns nobody will be emailed before the click; afterwards the history shows Notification failed with "no contacts to notify" and the page shows the warning → AC-6, AC-11
- [ ] Press Resend notification right after issuing → refused with a message naming the 5 minute cooldown; after 5 minutes → one new notification event and new idempotency keys in the console → AC-7
- [ ] On a Paid or Void invoice → no Resend, Mark paid or Void controls at all; on a draft → Issue and Void only → AC-7, AC-9, AC-11
- [ ] Mark paid with a future date → refused beside the field; with a date before the issue date → refused naming the issue date; with today → status Paid, "Paid on <today>", one Marked paid event → AC-8
- [ ] Open the same Sent invoice in two tabs; mark it paid in one, then void in the other → the second is refused with a conflict naming Paid and the page shows Paid → AC-8, AC-9
- [ ] Void a draft with a 501 character reason → refused; with a short reason → status Void, reason on the Voided event, no controls remain → AC-9
- [ ] `/invoices` → drafts first, then newest issue date; voided invoices hidden until Show void; the status select filters to one status; the client select filters to one client; a `?client=<unknown id>` shows the empty list with the filters still visible; 26 or more invoices page at 25 with every filter carried along and any control change returning to page 1 → AC-10
- [ ] Set a Sent invoice's due date in the past (seed INV-0001 is due 2026-09-19; use a date before today) → Past due badge on the list and detail, stored status still Sent → AC-12
- [ ] `/clients/[id]` → an Invoices section counting every non void invoice, each row linking to the invoice, a New invoice link carrying `?client=`; an archived client has no New invoice link; a client with none shows the empty state → AC-13
- [ ] Sign in as staff of another agency and open agency A's `/invoices/[id]` → not found; the list shows none of A's rows → AC-14
- [ ] Open `/portal/invoices/<any id>` signed in as a client contact → the placeholder page, no invoice data; signed out → the sign in page → AC-16
- [ ] Keyboard: open each dialog (Issue, Mark paid, Void, Edit line), Tab stays inside, Escape closes and focus returns to the button; each line row's Move up, Move down, Edit and Remove buttons are announced with the line's description; after adding a line the totals region is announced → AC-17
- [ ] `/design` in both themes → the Invoices section renders the line rows, totals, actions by status, warning and history; zoom to 200% on `/invoices/[id]` → no horizontal scroll at 320px → AC-17

## Commands

- [ ] `corepack pnpm db:migrate` then `corepack pnpm db:migrate:check` → migrations applied and "in step with the schema" → AC-18
- [ ] `corepack pnpm db:schema:assert` → 120 of 120 expectations hold, including `invoices.notes` and the four `invoice_events` CHECKs → AC-18
- [ ] `SEED_ALLOW_HOST=<host> corepack pnpm db:seed` twice → `invoice_events 12` both times, no duplicates → AC-18
- [ ] `corepack pnpm vitest run src/invoices src/lib/money.test.ts src/db/invoice-events.db.test.ts src/db/tenant/transaction.db.test.ts --no-file-parallelism` → all pass, including the three concurrency cases (two drafts get 1 and 2; the same draft issued twice yields one conflict; a line removal racing the issue is refused) → AC-3, AC-5, AC-14, AC-15

## Value sourcing checks

- [ ] Currency: set `organizations.default_currency` to `EUR`, create a draft → the draft reads `EUR` and every amount shows `€` → createInvoiceDraft
- [ ] Today: near midnight UTC, create a draft and issue one → the due date prefill and the issue date follow the UTC day, not the local one → todayUtc
- [ ] Tax rate: enter `7.25` → `tax_rate_bp` is 725, never 724 or 725.0000001 → percentToBasisPoints
- [ ] Unit amount: enter `0.29` → `unit_amount_cents` is 29 → parseMoneyInput
- [ ] Number: two staff issue two drafts at the same second → consecutive different numbers; the counter reads the higher plus one → nextInvoiceNumber
- [ ] Recipients: add a contact to the client after the draft exists, then issue → the new contact is emailed too → contactsToNotify
- [ ] Cooldown: with the newest notification event older than 5 minutes but an older one newer (edit `created_at` in the database) → the newest by `created_at` then `id` decides → resendInvoiceNotification
- [ ] List order: two invoices issued the same day → the one created later comes first; a tie on both falls back to id → compareForList
- [ ] Paid at: mark paid on `2026-09-10` → `paid_at` is `2026-09-10T00:00:00Z` exactly → markInvoicePaid
- [ ] Actor: an event written by staff shows their `users.name`, or their email when the name is null; the seeded sweep event shows "System" → detail page

## Acceptance-criteria coverage

- AC-1 · draft creation and preselect steps · AC-2 · header save step · AC-3 · line steps, positions, overflow, command · AC-4 · tax and currency step · AC-5 · issue refusals and issue step, command · AC-6 · issue step, no contacts step · AC-7 · resend step, controls by status · AC-8 · mark paid steps, stale move · AC-9 · void steps, stale move · AC-10 · list step · AC-11 · controls by status, warning step · AC-12 · past due step · AC-13 · client page step · AC-14 · other agency step, command · AC-15 · issue, paid and void steps (one event each), command · AC-16 · portal step · AC-17 · keyboard and design steps · AC-18 · the four commands
