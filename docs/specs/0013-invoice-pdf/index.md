# 0013. Invoice PDF

**Date**: 2026-09-16
**Status**: Accepted

## Summary

This spec is the build plan for downloading an issued invoice as a PDF file. The file is drawn on every request from the invoice rows spec 0012 froze at issue, using `@react-pdf/renderer` (a library that turns React components into a PDF without a browser), and streamed straight back to the browser; nothing is stored. Agency staff download it from `/invoices/[id]`, and a client contact downloads the same file from a portal URL, so the client portal (feature 15) only has to add a link. Drafts and voided invoices have no PDF: asking for one gives the ordinary "not found" page. The PDF and the on screen document read from one shared presentation module, which is what makes "the PDF matches the screen" true by construction rather than by care.

## Requirements

**User stories**:
- As agency staff, I want to download an issued invoice as a PDF, so that I can send it to the client by any channel and keep a copy in the agency's records.
- As a client contact, I want to download the PDF of an invoice my company was sent, so that I can save it and forward it to our accountant without asking the agency.
- As either, I want the PDF to say exactly what the screen says, including whether it has been paid, so that nobody has to reconcile two versions of one document.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: `GET /invoices/[id]/pdf` with a staff session (admin or member) first applies the subscription gate exactly as the deliverable download route does (an `unsubscribed` or `locked` agency is redirected to `/billing` before any row is read), then resolves the invoice inside the acting agency and requires a status of `sent`, `overdue` or `paid`; it answers `200` with `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="INV-0042.pdf"` (the display number from `formatInvoiceNumber`) and `Cache-Control: private, no-store`, and the body is a valid PDF. A `draft`, a `void`, another agency's invoice, a non uuid and a nonexistent id all answer the app's 404 page.
- **AC-2**: `GET /portal/invoices/[id]/pdf` with a signed in client contact answers the same PDF when the invoice belongs to that contact's client (through the tenant layer's contact predicate, never a URL or form value) and its status is in `CLIENT_VISIBLE_STATUSES`; every other case answers the 404 page. Whether the client has since been archived is not consulted. Both URLs run one shared handler whose rules follow the resolved context kind (staff or contact), not the URL; a contact never reaches the `/invoices` URL because the proxy sends any request without an organization claim to `/onboarding` first.
- **AC-3**: The PDF prints, in this order: the agency name as the heading; the word "Invoice" with the display number; the status ("Sent", "Overdue" or "Paid", plus the words "Past due" whenever `isPastDue` is true for the invoice today, and "Paid on YYYY-MM-DD" for a paid invoice, the date being `paid_at` as a UTC calendar day); the issued and due dates as `YYYY-MM-DD`; a "Bill to" block with the client's name and its billing address lines (address line 1, address line 2, then city, region and postal code joined by ", ", then country, each line omitted when blank); the line table with the columns Description, Qty, Unit and Amount in `position` order, quantities trimmed of trailing zeros and every amount formatted by `formatMoney` with the invoice's currency; the totals (Subtotal, "Tax (7.25%)" with the rate from `tax_rate_bp`, Total); the notes when present with line breaks preserved; and on every page a footer reading "Generated YYYY-MM-DD HH:MM UTC" and "Page n of m". Every string on the PDF comes from `presentInvoice` in `src/invoices/presentation.ts`, a pure function.
- **AC-4**: The frozen document on `/invoices/[id]` (`InvoiceDocument`, shown for every status except `draft`) renders its number, status words, dates, client name, address lines, line cells, totals labels and notes from the same `presentInvoice` output, and gains the client's billing address lines under the client name (omitted when the client has none). For a `sent`, `overdue` or `paid` invoice the document header shows a link to `/invoices/[id]/pdf` with the visible text "Download PDF" followed by a visually hidden space and the display number, so its accessible name is "Download PDF INV-0042" and starts with its visible label; a `draft` or `void` invoice shows no link. The draft editor is unchanged.
- **AC-5**: The page is A4 with a 40 point margin on every side, set in Inter regular and semibold embedded from TTF files kept in the repo, so that names with letters outside Western European Latin (for example ş, ğ, İ, ł, ő) print correctly. An invoice with the maximum 100 lines and a long notes field spans several pages: the table's header row repeats at the top of every page, no line row is split across a page break, and the totals and notes follow the last row. Amounts and invoice numbers are never hyphenated across lines.
- **AC-6**: When rendering throws (a missing font file, a renderer error), the response is a readable page with status `500` built by `downloadErrorResponse` from `src/deliverables/download-error-page.ts`: heading "The PDF could not be generated", body "Something went wrong while drawing this invoice. Try again in a moment, or open the invoice instead.", and a link reading "Back to the invoice" to `/invoices/[id]` for a staff context or "Back to the portal" to `/portal/invoices/[id]` for a contact context (the builder gains an optional `link` for this). Never a stack trace or a digest. The server writes one `console.error` line of the deliverable route's JSON shape, `{ event: "invoices.pdf.render_failed", invoiceId, message, at }`, and never the invoice's content. Feature 20 routes that log to Sentry; nothing here depends on it.
- **AC-7**: An invoice of agency A requested by staff of agency B, or by a contact of a different client, answers the 404 page. A signed in person with no active organization and no accepted contact row (the tenant context resolution errors) answers the 404 page rather than a 500. An anonymous request is redirected to sign in by the proxy before the handler runs. Every read in the handler goes through `tenantDb(ctx)` or a named tenant layer door (`agencyProfile`, widened to accept either context kind because both carry `orgId` and it reads only the caller's own organization row).
- **AC-8**: The feature adds no environment variable, no migration and no storage object. The two font files are traced into the deployed function by `outputFileTracingIncludes` in `next.config.ts` (keys `"/invoices/[id]/pdf"` and `"/portal/invoices/[id]/pdf"`, value `["./src/invoices/pdf/fonts/**"]`), `@react-pdf/renderer` is listed in `serverExternalPackages`, and a download from a Vercel preview deployment of the first slice proves both before anything else is built. If that preview cannot find the font files, the named fallback is to move them to `public/fonts/` and register them by absolute URL (`env().NEXT_PUBLIC_APP_URL` plus `/fonts/Inter-Regular.ttf`), which the renderer fetches and which needs no tracing; the spec is then updated to say so. A unit test renders a 100 line invoice with non ASCII names to a buffer and, through `pdf-parse` (a dev dependency that reads text, page count and metadata out of PDF bytes), asserts a valid PDF with more than one page. An `eslint.config.mjs` entry in the shape of the existing `clienthq/aws-sdk-boundary` pair restricts `@react-pdf/*` imports to `src/invoices/pdf/**`.
- **AC-9**: The "Download PDF" link and the address block meet WCAG 2.2 AA on `/invoices/[id]` in both themes, the 500 and 404 pages meet it too, and the PDF carries document metadata: title "Invoice INV-0042 from <Agency>", author the agency name, language `en`. The PDF is not a tagged PDF (the renderer cannot produce one); this is recorded as a known gap, not hidden.

## Decision

**Chosen option**: Option 1: Render on demand with `@react-pdf/renderer` from a shared presentation module, one handler behind two URLs.

Every request draws the PDF from the frozen invoice rows and the client's address, through a pure `presentInvoice` that the screen also renders from, and streams the bytes back as an attachment; nothing is stored, no post commit step is added to issuing, and the contact path is served now so feature 15 only links to it.

**Implementation skills**: `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `vercel-functions-runtime` (`vercel-labs/agent-skills`, `.agents/skills/vercel-functions-runtime/`) · `typescript-core` (`.agents/skills/typescript-core/`) · `zod` (`.agents/skills/zod/`) · `shadcn` (`.agents/skills/shadcn/`) · `tailwind` (`.agents/skills/tailwind/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `vitest` (`.agents/skills/vitest/`) · `playwright-cli` (`.agents/skills/playwright-cli/`)

## Feature design

**Data model sketch**:

No table, column or migration changes. The feature reads five existing tables and writes nothing.

| Table | Read | Written |
|---|---|---|
| `invoices` | `id`, `number`, `status`, `issue_date`, `due_date`, `currency`, `tax_rate_bp`, `subtotal_cents`, `tax_cents`, `total_cents`, `notes`, `paid_at`, `client_id` | no |
| `invoice_line_items` | `description`, `quantity`, `unit_amount_cents`, `amount_cents`, ordered by `position` | no |
| `clients` | `name`, `billing_address_line1`, `billing_address_line2`, `billing_city`, `billing_region`, `billing_postal_code`, `billing_country` | no |
| `organizations` | `name`, through `agencyProfile(ctx)` | no |
| `invoice_events` | not read | no |

**State transitions**: none added. The PDF exists exactly for the statuses in `CLIENT_VISIBLE_STATUSES` (`sent`, `overdue`, `paid`, spec 0012), for staff and contacts alike; that constant is the single "has a PDF" rule, so a future status change in spec 0012 flows here without an edit.

**Modules** (all under `src/invoices/` unless named):

- `presentation.ts`: `presentInvoice({ invoice, client, lines, agencyName, todayUtc, generatedAt })` returning an `InvoicePresentation` of plain strings: `agencyName`, `title` ("Invoice"), `number`, `status` (`label`, `pastDue`, `paidOn?`), `issued`, `due`, `billTo` (`name`, `lines[]`), `lines[]` (`description`, `quantity`, `unit`, `amount`), `totals` (`subtotal`, `taxLabel`, `tax`, `total`), `notes?`, `generated`, `documentTitle`. `displayQuantity` moves here from `invoice-document.tsx`, `formatTaxLabel(taxRateBp)` is exported for `InvoiceTotals`, and `billingAddressLines(client)` is exported for the screen. No React, no IO.
- `pdf/invoice-pdf.tsx`: the `@react-pdf/renderer` document (`Document`, `Page`, `View`, `Text`) taking one `InvoicePresentation`. Table header row and footer are `fixed` (repeated on every page); each line row is `wrap={false}`; the footer's page text uses the renderer's `render` prop for `pageNumber` and `totalPages`.
- `pdf/fonts.ts` and `pdf/fonts/`: `Inter-Regular.ttf`, `Inter-SemiBold.ttf` and their `OFL.txt`; `registerInvoiceFonts()` first asks the renderer's registry (`Font.getRegisteredFontFamilies()`) and returns at once when `Inter` is already there, otherwise calls `Font.register` for the `Inter` family with absolute paths built from `process.cwd()` and `Font.registerHyphenationCallback((word) => [word])`. The render function calls it every time; the registry check keeps the files read once per process, and no module level variable or side effect exists.
- `pdf/render.ts`: `renderInvoicePdf(presentation)` returning a `Uint8Array` via `renderToBuffer`; the only file that imports `@react-pdf/renderer` besides the document and the fonts module, a boundary the ESLint entry of AC-8 enforces.
- `pdf/handle-request.ts`: `handleInvoicePdfRequest(rawId)`, the shared handler both routes call, in this order: resolve `tenantContext()` (a resolution error answers `notFoundResponse()` from `src/deliverables/download-error-page.ts`); for staff, `agencyAccess()` and the same redirect rule as the deliverable download route; `getInvoiceDocument(ctx, id)` (undefined answers the same 404); `agencyProfile(ctx)` (undefined answers the same 404); `presentInvoice`; `renderInvoicePdf` inside a try that answers the 500 page of AC-6 through `downloadErrorResponse` and writes the log line; the `200` response with the three headers.
- `src/deliverables/download-error-page.ts`: `downloadErrorResponse` gains an optional `link: { href, label }` rendered as one anchor under the body paragraph; every existing caller passes none and is unchanged.
- `queries.ts`: `getInvoiceDocument(ctx: TenantContext, id)` returning the invoice, the client's name and address fields, and the lines by position, only when `isClientVisible(status)`; `undefined` otherwise, for a non uuid, and for a row the tenant predicates hide. `getInvoice`'s client selection gains the six billing columns so `InvoiceDetail` carries them to the screen.
- `src/app/invoices/[id]/pdf/route.ts` and `src/app/portal/invoices/[id]/pdf/route.ts`: two files of a few lines each, `runtime = "nodejs"`, delegating to the shared handler. The first sits outside the `(agency)/(gated)` group like the deliverable download route, because a route handler has no layout above it; the proxy's `/invoices(.*)` rule still requires an organization claim there.
- `src/db/tenant/organization.ts`: `agencyProfile(ctx: TenantContext, …)`, the one signature change.
- `next.config.ts`: `serverExternalPackages: ["@react-pdf/renderer"]` and `outputFileTracingIncludes` mapping both route paths to `./src/invoices/pdf/fonts/**`.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/invoices/[id]/pdf` | GET, route handler | `id` (route param, parsed by `invoiceIdSchema`) | `200 application/pdf`, attachment `INV-0042.pdf`, `private, no-store` | staff of the owning agency, gate first | 404 page (draft, void, other agency, bad id, no context); redirect to `/billing` (gate); 500 page (render failure) |
| `/portal/invoices/[id]/pdf` | GET, route handler | `id` | the same PDF | a contact of the invoiced client, status in `CLIENT_VISIBLE_STATUSES` | 404 page for every refusal; 500 page (render failure) |
| `getInvoiceDocument(ctx, id)` | query | id | invoice, client with address, lines by position | staff or contact context | `undefined` for anything not visible to this context or not in a PDF status |
| `presentInvoice(input)` | pure function | rows, agency name, today, generated at | `InvoicePresentation` strings | none | none; it never throws on valid rows |
| `renderInvoicePdf(presentation)` | function | `InvoicePresentation` | `Uint8Array` | none | throws on renderer or font failure; the handler catches |
| `/invoices/[id]` | page (existing) | id | the frozen document with the address block and the Download PDF link | staff | unchanged |

**Value sourcing** (every value each action produces, computes, or displays names where it comes from):
| Action | Value produced / displayed | Source |
|---|---|---|
| both routes | the acting person's kind and tenant | `tenantContext()` from the session (spec 0003); staff when an organization claim is present, contact otherwise |
| staff route | whether the gate refuses | `agencyAccess()` (spec 0008), the same `unsubscribed` and `locked` rule the deliverable download route applies |
| both routes | whether the invoice is in this agency and, for a contact, this client | the tenant layer's predicates on `invoices`, `invoice_line_items` and `clients` (spec 0003, spec 0012) |
| both routes | whether a PDF exists for this status | `isClientVisible(status)` over `CLIENT_VISIBLE_STATUSES` (spec 0012), for staff and contacts alike |
| both routes | the filename | `formatInvoiceNumber(number)` plus `.pdf`; `number` is never null in a PDF status |
| presentInvoice | agency name | `agencyProfile(ctx).name` |
| presentInvoice | display number | `formatInvoiceNumber(invoices.number)` |
| presentInvoice | status label | `invoices.status` mapped by a closed record: `sent` → "Sent", `overdue` → "Overdue", `paid` → "Paid" (exhaustive over the three PDF statuses) |
| presentInvoice | "Past due" | `isPastDue(status, dueDate, todayUtc)` with `todayUtc()` from `src/lib/dates.ts` passed in by the handler |
| presentInvoice | "Paid on YYYY-MM-DD" | `invoices.paid_at` as a UTC calendar day (`toISOString().slice(0, 10)`), present exactly when `paid` (spec 0002 CHECK) |
| presentInvoice | issued and due dates | `invoices.issue_date` and `invoices.due_date` as stored (`YYYY-MM-DD`), the same strings the screen shows |
| presentInvoice | bill to lines | `billingAddressLines(client)`: `billing_address_line1`, `billing_address_line2`, the non blank of `billing_city`, `billing_region`, `billing_postal_code` joined by ", ", `billing_country`; blank lines dropped |
| presentInvoice | quantity | `displayQuantity(quantity)` (trailing zeros and a trailing dot trimmed), moved from the screen component |
| presentInvoice | unit, amount, subtotal, tax, total | `formatMoney(cents, invoices.currency)` (spec 0012) over the stored cents; nothing is recomputed |
| presentInvoice | tax label | `formatTaxLabel(tax_rate_bp)`: "Tax (7.25%)", basis points divided by 100 with trailing zeros trimmed, "Tax (0%)" for zero |
| presentInvoice | notes | `invoices.notes`, unchanged, line breaks kept |
| presentInvoice | generated line | `generatedAt`, a `Date` the handler creates once per request, formatted `YYYY-MM-DD HH:MM UTC` |
| presentInvoice | document title | "Invoice " + display number + " from " + agency name (the issue email's subject rule, spec 0012) |
| `invoice-pdf.tsx` | page numbers | the renderer's `pageNumber` and `totalPages` through the footer's `render` prop |
| `invoice-pdf.tsx` | fonts | the two TTF files in `src/invoices/pdf/fonts/`, registered by `registerInvoiceFonts()` |
| /invoices/[id] | the address lines | `billingAddressLines(invoice.client)` over the six columns `getInvoice` now selects |
| /invoices/[id] | whether the link renders | `isClientVisible(invoice.status)` |
| /invoices/[id] | the link's accessible name | the visible "Download PDF" plus a visually hidden space and `formatInvoiceNumber(number)` |
| 404 responses | the page | `notFoundResponse()` from `src/deliverables/download-error-page.ts`, unchanged |
| 500 page | heading, body and the way back | the literal strings in AC-6; the link is `/invoices/[id]` with "Back to the invoice" for a staff context, `/portal/invoices/[id]` with "Back to the portal" for a contact context |
| error log | the line | `JSON.stringify({ event: "invoices.pdf.render_failed", invoiceId, message, at })`, `message` from the caught error, `at` the ISO instant; the presentation is never logged |
| `invoice-pdf.tsx` | page size and margins | A4 with `padding: 40` points on every side, constants in the document module |

**Key invariants**:
- A PDF exists for an invoice exactly when `isClientVisible(status)`; there is no second status list anywhere in the feature.
- Every string on the PDF and every corresponding string on the screen comes from one `presentInvoice` call; the two cannot disagree on a value, only on layout.
- The handler writes nothing: no row, no event, no object. Two downloads a second apart of an unchanged invoice differ only in the "Generated" line.
- Every row read goes through `tenantDb(ctx)` or the named `agencyProfile` door; the acting agency and, for a contact, the acting client come from the session, never from the URL.
- No font file, no renderer and no PDF module is imported anywhere outside `src/invoices/pdf/`, enforced by the `no-restricted-imports` entry for `@react-pdf/*` in `eslint.config.mjs`.
- The response never carries a cacheable header: a shared cache must never hold an invoice.

**Security model**:
- Staff: any member of the owning agency, after the subscription gate; feature 16 may tighten with `requireRole` and no other change. Contact: a signed in contact of the invoiced client only, for `sent`, `overdue` and `paid`, with no gate (feature 15 owns the portal's gate, as spec 0011 decided for downloads).
- Every refusal is the same 404 page, so nobody learns whether a draft exists or whether an id belongs to another tenant.
- The PDF carries the client's billing address and the invoice figures: personal data already held in `clients` and shown on screen to the same people; no new data category, no card or bank data, no PCI DSS scope. The handler never logs the document.
- Rendering costs CPU on every request; feature 19 adds the two routes to the per agency and per contact ceilings. Until then the routes sit behind a session, never anonymous.

**Configuration required**:
- None. No environment variable, credential or storage bucket. The build configuration change is in `next.config.ts` (`serverExternalPackages`, `outputFileTracingIncludes`) and is proven by the preview deployment in build task 1.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: staff download the PDF of a seeded `sent` invoice; the response is `200 application/pdf` with the attachment header naming `INV-0001.pdf` and `private, no-store`, the body begins with `%PDF-`, and the text `pdf-parse` extracts contains every string `presentInvoice` produced for the same rows, verifies **AC-1**, **AC-3**.
- Contact path: a contact of the invoiced client downloads the same invoice from the portal URL and gets the same bytes apart from the generated line; a contact of another client of the same agency gets the 404 page, verifies **AC-2**, **AC-7**.
- Refusals: a `draft`, a `void`, a non uuid, a nonexistent id and another agency's id each answer the 404 page for staff; a `draft` answers the 404 page for a contact; a `locked` agency's staff are redirected to `/billing`, verifies **AC-1**, **AC-2**, **AC-7**.
- Layout: a rendered invoice with 100 lines, a 5,000 character notes field and an agency named "Şirket Ölçüm" produces more than one page, the header row text appears on every page, no row's cells fall on different pages, and the Turkish letters are present in the extracted text, verifies **AC-5**, **AC-8**.
- Failure case: a render function that throws answers the 500 page with the literal heading and body, the "Back to the invoice" link for a staff context and the "Back to the portal" link for a contact context, and one `console.error` line carrying `event`, `invoiceId`, `message` and `at` and not the presentation, verifies **AC-6**.
- Screen parity: `InvoiceDocument` for a paid invoice shows "Paid on", the address lines and a link whose accessible name is "Download PDF INV-0001"; for a `void` invoice it shows no link; the draft editor is byte for byte unchanged, verifies **AC-4**.
- Presentation unit tests: `billingAddressLines` drops blanks and joins the third line by ", "; `formatTaxLabel` renders `725` as "Tax (7.25%)", `1000` as "Tax (10%)" and `0` as "Tax (0%)"; the status record is exhaustive; `generated` is `YYYY-MM-DD HH:MM UTC`, verifies **AC-3**.
- Accessibility: axe passes on `/invoices/[id]` with the link and the address block in both themes, and on the 404 and 500 pages; `pdf-parse` reads the title, author and language out of the metadata, verifies **AC-9**.
- Deployment: a preview deployment of build task 1 serves a real PDF with Inter embedded (checked by opening the file's font list in a PDF viewer), which proves the tracing and the external package setting; a lint run fails on an `@react-pdf/*` import placed outside `src/invoices/pdf/`, verifies **AC-8**.

## Build plan

Ordered for Tracer Bullet: the first task is the thinnest real thread (a real invoice, rendered by the real library with the real fonts, downloaded by real staff from a real Vercel preview), because the two things most likely to fail on this feature are bundling and fonts on the host, and both are only proven by a deploy. Everything after thickens that thread.

1. [ ] The thin thread: add `@react-pdf/renderer` and the `pdf-parse` dev dependency, the two Inter TTF files with their licence, the ESLint boundary entry, `registerInvoiceFonts` with its registry check, a minimal `presentInvoice` (agency name, number, dates, lines, totals), a minimal `InvoicePdf`, `renderInvoicePdf`, `getInvoiceDocument` for the staff context, `handleInvoicePdfRequest` with the gate and the 404 rule, the staff route file, the `next.config.ts` entries, and a plain "Download PDF" link in `InvoiceDocument`; a node environment unit test that renders a buffer starting with `%PDF-`; then a Vercel preview deployment where a real download opens with Inter embedded. If the preview cannot find the fonts, switch to the `public/fonts/` URL fallback named in AC-8 and update the spec before task 2. Satisfies **AC-1**, **AC-8**.
2. [x] The contact thread: widen `agencyProfile` to `TenantContext`, make `getInvoiceDocument` accept either context (the contact predicates do the scoping, `isClientVisible` does the status), add the portal route file, catch the tenant resolution errors as 404; database tests for cross agency invisibility, another client's contact, a contact reading a draft, and a contact of an archived client still reading a paid invoice. Satisfies **AC-2**, **AC-7**.
3. [x] Thicken the content: the full `InvoicePresentation` (status words with past due and paid on, the bill to block, the tax label, the notes, the generated line, the document title), `getInvoice` selecting the billing columns, `InvoiceDocument` and `InvoiceTotals` reading from `presentInvoice`, `formatTaxLabel` and `billingAddressLines`, the address block on screen, the link only for PDF statuses with the number in its accessible name; unit tests over every presentation rule and a screen test for the link and the address. Satisfies **AC-3**, **AC-4**.
4. [x] Thicken the layout: A4 with the 40 point margin, the fixed header row and footer, `wrap={false}` rows, the hyphenation callback, the metadata (title, author, language); the 100 line and non ASCII render test asserting several pages, the repeated header and the glyphs. Satisfies **AC-5**, **AC-9**.
5. [x] Failure handling: the optional `link` on `downloadErrorResponse`, the 500 page with its literal strings and the context aware link, the single JSON error log line, and route tests for both files covering the 200 headers, every 404 case, the gate redirect and the throwing renderer. Satisfies **AC-6**, **AC-1**.
6. [ ] Accessibility and proof: axe over `/invoices/[id]` in both themes with the link and the address block, over the 404 and 500 pages; a browser test that clicks Download PDF on the seeded invoice and asserts the download's suggested filename; the link and the address block added to `/design`. Satisfies **AC-9**, **AC-4**.

## Consequences

**Positive**:
- One presentation module makes "matches the screen" a property of the code, not a review checklist, and gives feature 15 the same strings for the portal's invoice page.
- Nothing is stored, so there is no object to orphan, no cache to invalidate when an invoice is paid, and no new failure mode inside `issueInvoice`; the status on the PDF is always the truth at download time.
- The contact path ships now with the same handler, so feature 15 adds one link and inherits the tenant tests written here.
- No environment variable, no migration, no provider; the only new dependency runs inside the function the app already has.
- `CLIENT_VISIBLE_STATUSES` is reused as the "has a PDF" rule, so drafts and voided invoices are excluded by the same constant the portal uses.

**Negative / tradeoffs**:
- `@react-pdf/renderer` is a few megabytes of server dependency, and its layout is its own React tree: the PDF shares values with the screen, not markup, so a design change to `InvoiceDocument` has to be mirrored by hand in `InvoicePdf`.
- Every download renders again, spending a few hundred milliseconds of CPU per request; fine at this product's volume, and feature 19's ceilings are the guard if a client scripts it. The font files are read once per process thanks to the registry check, not once per request.
- The renderer does not produce a tagged PDF, so the file is not accessible to a screen reader the way the page is; the metadata is set, and a tagged output is a follow up if a client needs it.
- Two downloads of the same invoice differ in the "Generated" line and, after a payment, in the status, so the file is not a fixed artifact; the frozen rows are, and any download can be reproduced from them.
- Dates are the UTC calendar day everywhere (issue, due, paid on, generated), inheriting spec 0002's timezone gap.
- The page is A4 for every agency, and the letterhead carries only the agency name; a US agency and an agency needing an address, tax id or payment instructions on the invoice wait for an agency settings feature.
- `serverExternalPackages` and `outputFileTracingIncludes` are the first entries in `next.config.ts`; both are host specific and only a deploy proves them, which is why task 1 ends on a preview download and names the `public/fonts/` URL fallback.
- Two route files for one handler is a small duplication forced by the proxy's `/invoices(.*)` rule.

**Neutral**:
- `agencyProfile` accepting a contact context is the first tenant layer door a contact can call; it still reads only the caller's own organization row.
- The screen's `displayQuantity` moves into `presentation.ts`; `invoice-document.tsx` loses its private helper.
- Spec 0011 expected this feature to write through the storage port; it does not, because nothing is stored. The port stays as it is; the feature borrows spec 0011's error page builder instead, which gains one optional link.
- Non ASCII agency or client names already render on screen; the font choice only brings the PDF up to the same standard.

## Follow-up

- [ ] Agent Skill for `@react-pdf/renderer`: the engineer chose "not now". A skill would teach the build the renderer's component set, `fixed` and `wrap` rules, font registration and known Next.js bundling fixes; search the skills registry when wanted, and record the pick in `AGENTS.md`.
- [ ] Feature 15 (client portal): link "Download PDF" from the portal invoice page to `/portal/invoices/[id]/pdf`, and render that page from `presentInvoice` so the three views stay identical.
- [ ] Feature 19 (rate limiting): add both PDF routes to the per agency and per contact ceilings; rendering is the most CPU expensive read in the product.
- [ ] Feature 20 (error tracking): the render failure log line is the first candidate for a Sentry capture with the invoice id as a tag.
- [ ] Agency letterhead and locale (a settings feature): agency address, tax or VAT id, payment instructions, page size (A4 or Letter) and a money locale; `presentInvoice` gains fields, the PDF and the screen gain a block, and `organizations` gains columns. Until then the PDF says who the agency is by name only.
- [ ] Attach the PDF to the issue and resend emails (spec 0012's notification step, after the commit, through Resend's single send endpoint which supports attachments); decide after the PDF has been trusted for a while.
- [ ] Tagged (accessible) PDF output: not produced by the chosen renderer; revisit if a client or a procurement requirement asks for it.
- [ ] Zero decimal currencies and the agency timezone: inherited from spec 0012 unchanged; every date and amount on the PDF follows whatever those decisions settle.
- [ ] `vercel-functions-runtime` conventions (tracing includes, external packages, function size) are installed under `.agents/skills/` and listed in root `AGENTS.md`, but nothing in the repo yet records the two `next.config.ts` entries this feature adds; once they exist, `/sync` should note them in the root context so later features do not remove them.

## Rationale

Reasoning and options considered: see [rationale.md](rationale.md).
