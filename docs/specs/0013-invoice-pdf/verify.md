# Verify: Invoice PDF · spec 0013 · updated 2026-09-16

_Steps derived from spec 0013 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Visit `/invoices/[id]` for a `sent`, `overdue` or `paid` invoice as staff → the document header shows a "Download PDF INV-00NN" link → click it → a PDF named `INV-00NN.pdf` downloads → AC-1, AC-4
- [x] Visit `/invoices/[id]` for a `draft` or `void` invoice → no Download PDF link appears → AC-4
- [ ] Sign in as a client contact and visit `/portal/invoices/[id]/pdf` for an invoice belonging to that contact's client → the same PDF downloads → AC-2
- [ ] Visit `/invoices/[id]/pdf` for another agency's invoice, a `draft`, a `void`, a non uuid, and a nonexistent id → the app's 404 page every time → AC-1, AC-7
- [ ] Visit `/portal/invoices/[id]/pdf` as a contact of a different client of the same agency → the 404 page → AC-2, AC-7
- [ ] As staff of an `unsubscribed` or `locked` agency, visit `/invoices/[id]/pdf` → redirected to `/billing` before any row is read → AC-1
- [x] Compare a paid invoice's downloaded PDF against its `/invoices/[id]` screen: number, status words, dates, bill to address, line items, totals and notes all match → AC-3, AC-4
- [x] Open a downloaded PDF's document properties → Title reads "Invoice INV-00NN from `<Agency>`", Author is the agency name → AC-9
- [ ] Force a render failure (e.g. temporarily rename a font file) and request the PDF → the 500 page reads "The PDF could not be generated" with the correct "Back to the invoice" / "Back to the portal" link for the calling context, and one `invoices.pdf.render_failed` JSON line is logged with no invoice content → AC-6
- [x] A Vercel preview deployment downloads a real invoice PDF and its embedded font list shows Inter, not a system fallback (spec 0013 build task 1; `next.config.ts`'s `serverExternalPackages` and `outputFileTracingIncludes` are proven this way) → AC-8
- [x] A signed in Lighthouse accessibility pass over `/invoices/[id]` in both light and dark theme scores 100/100 with no failed audits (this project's browser suite runs signed out only, per `e2e/CLERK.md`, so this needed a manual signed in session) → AC-9

## Commands

- [ ] `corepack pnpm vitest run src/invoices/presentation.test.ts` → every presentation rule (address lines, tax label, quantity display, status record, generated line, document title) passes → AC-3
- [ ] `corepack pnpm vitest run src/invoices/pdf/render.test.ts` → a valid PDF, its metadata, and the 100 line non ASCII invoice spanning several pages with the header row repeated on each all pass → AC-5, AC-8, AC-9
- [ ] `corepack pnpm vitest run src/invoices/invoice-pdf.db.test.ts` → the staff and contact tenant scoping proofs pass against real PostgreSQL (skipped without `DIRECT_URL`) → AC-1, AC-2, AC-7
- [ ] `corepack pnpm vitest run src/invoices/pdf/handle-request.test.ts` → every 404, gate redirect, 500 and 200 branch passes → AC-1, AC-2, AC-6
- [ ] `corepack pnpm exec playwright test e2e/invoice-pdf.spec.ts` → the signed out 404s and the gallery's address block, Download PDF link and axe checks pass → AC-1, AC-2, AC-4, AC-9
- [ ] `corepack pnpm lint` → placing an `@react-pdf/*` import outside `src/invoices/pdf/**` fails the build → AC-8
- [ ] `corepack pnpm build` → both PDF routes compile, and `Inter-Regular.ttf` / `Inter-SemiBold.ttf` appear in each route's `.next/server/app/**/route.js.nft.json` → AC-8

## Acceptance-criteria coverage

- AC-1 (staff route, gate, 404s) · `src/invoices/pdf/handle-request.test.ts`, `src/invoices/invoice-pdf.db.test.ts`, `e2e/invoice-pdf.spec.ts`, manual staff download
- AC-2 (contact route, predicates) · `src/invoices/invoice-pdf.db.test.ts`, `src/invoices/pdf/handle-request.test.ts`, manual contact download
- AC-3 (PDF print order and content) · `src/invoices/presentation.test.ts`, `src/invoices/pdf/render.test.ts`, manual PDF vs screen comparison
- AC-4 (screen parity, address block, link) · `src/invoices/ui/invoices-ui.test.tsx`, `src/invoices/presentation.test.ts`, `e2e/invoice-pdf.spec.ts`
- AC-5 (A4, margins, fonts, hyphenation, multi-page) · `src/invoices/pdf/render.test.ts`'s 100 line test, manual embedded-font check
- AC-6 (500 page, log line) · `src/invoices/pdf/handle-request.test.ts`, manual forced-failure check
- AC-7 (cross tenant / cross client refusals) · `src/invoices/invoice-pdf.db.test.ts`
- AC-8 (deps, ESLint boundary, tracing, deploy proof) · lint boundary check, `pnpm build` trace check, **manual Vercel preview deploy (outstanding)**
- AC-9 (accessibility, metadata) · `src/invoices/pdf/render.test.ts`'s metadata test, `e2e/invoice-pdf.spec.ts`'s axe checks, **manual `/invoices/[id]` signed in axe pass (outstanding)**

## Known gap found during the build

`registerInvoiceFonts()` (`src/invoices/pdf/fonts.ts`) no longer reads the font files once per process the way this spec's `## Feature design` and `## Consequences` describe. While building this feature, rendering one plain invoice and then a second one containing "ı" silently turned "ı" into "9" in the second file — `@react-pdf/renderer`'s font embedding mutates subset and glyph state directly on the shared, cached font object, so reusing it across two unrelated PDF renders in one process corrupts glyphs. The fix (delete and re-register the family before every render) is in place and tested (`render.test.ts`'s multi-page non ASCII case), but it means the two font files are read and parsed once per request rather than once per process, and the font gets loaded once per process is a factual claim the spec's `## Feature design` (`fonts.ts` description) and `## Consequences` still make. Worth an `/architect invoice PDF: correct the font caching description` pass to bring the spec back in line with the safe implementation.
