# Invoices

## Overview

Invoice authoring and its lifecycle (draft, sent, overdue, paid, void), the issue email to the client's contacts, and the invoice PDF. It carries the product's hardest money rules: gapless numbering and frozen documents. No client money moves through it; an agency only records that an invoice was paid. Settled by [spec 0012](../../docs/specs/0012-invoice-authoring-lifecycle/index.md) and [spec 0013](../../docs/specs/0013-invoice-pdf/index.md).

## Key files

| File | Owns |
|---|---|
| `src/invoices/status.ts` | The lifecycle rule in one pure module: `canTransition`, `nextActions`, the client visible statuses and the past due check. The page, the actions, the portal and the sweep all read it |
| `src/invoices/draft.ts` | `lockDraft` (the row locking compare and set on `status = draft`) and `recalculateTotals` |
| `src/invoices/line-items.ts`, `update-invoice-draft.ts`, `create-invoice-draft.ts` | The draft writes. Each opens with `lockDraft` |
| `src/invoices/issue-invoice.ts` | Issuing: takes the next number, sets `sent`, writes the event, then sends the email after the commit |
| `src/invoices/transition-invoice.ts` | Mark paid and void, as compare and set on the status the button was rendered from |
| `src/invoices/notify.ts`, `resend-invoice-notification.ts` | The issue email and its resend. Writes exactly one `notified` or `notification_failed` event per attempt |
| `src/invoices/overdue-sweep.ts` | The `overdue_invoices` nightly sweep |
| `src/invoices/presentation.ts` | `presentInvoice`, the one source of every string on the PDF and on the frozen screen |
| `src/invoices/pdf/` | The renderer, the document layout, the font registration and the shared route handler. The only place that imports `@react-pdf/*` |
| `src/invoices/revalidate.ts` | The three surfaces every invoice write revalidates |
| `src/lib/money.ts` (outside this area) | The money helpers: line amounts and totals in integer cents |

## Conventions

- Every status move is a compare and set on the status the caller saw, follows `canTransition`, and writes exactly one `invoice_events` row in its own transaction. `paid` and `void` are final.
- Every write to a draft starts with `lockDraft`. Line items, header and notes change only while the invoice is a draft.
- `number` is null exactly while the invoice is a draft. The issue transaction is the only writer, and the agency counter rolls back with any refusal, so numbers stay gapless.
- Contacts see only the statuses in `CLIENT_VISIBLE_STATUSES`. Never write a second list of them.
- Money is integer cents everywhere. Import from `src/lib/money.ts`, never do the arithmetic inline.
- Every action goes through `withTenantAction`. Issue and resend declare the `INVOICE_EMAIL` rate limit and share one allowance per agency.
- Import the renderer only through `@/invoices/pdf/render`. ESLint blocks `@react-pdf/*` anywhere else.

## Gotchas

- **`issueInvoice` cannot use `transaction: true`.** Its email must go out after the commit, so it opens its own transaction through `tenantTransaction` for the locked part only.
- **Never hold a transaction across a network call.** The pool holds one connection. Notify and resend do their sends on the pooled accessor.
- **A sent invoice never has a silent failure.** The whole notify block sits inside one catch that still writes a `notification_failed` event.
- **The five minute resend cooldown is a read then a send with no claim row.** Two staff pressing Resend in the same second can send two emails. Spec 0012 accepts that. The rate limit check runs first, the cooldown second.
- **The PDF fonts are registered fresh on every render, on purpose.** `@react-pdf/renderer` mutates shared font state, and reusing it corrupted glyphs in the next PDF with no error. Do not "optimise" it to register once.
- **The PDF response is never cacheable, and the handler writes nothing.** Every refusal is the same 404 page, so nobody learns whether an id exists.
- **The PDF layout is its own React tree.** It shares values with the screen through `presentInvoice` but never markup.
- **The nightly sweep passes `today` in.** Never read the clock for the day inside a sweep.

## Agent skills

- [react-email](../../.agents/skills/react-email/) and [resend](../../.agents/skills/resend/): the issue email
- [email-best-practices](../../.agents/skills/email-best-practices/): deliverability and accessible email
- [billing-automation](../../.agents/skills/billing-automation/): invoicing lifecycle patterns

## Related specs

- [Spec 0012](../../docs/specs/0012-invoice-authoring-lifecycle/index.md): the lifecycle, numbering and events
- [Spec 0013](../../docs/specs/0013-invoice-pdf/index.md): the PDF and its font handling
- [Spec 0014](../../docs/specs/0014-client-portal/index.md): the contact side that reads these invoices
- [Spec 0018](../../docs/specs/0018-rate-limiting/index.md): the email ceiling

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
