# Verify: client records · spec 0006 · updated 2026-09-10

_Steps derived from spec 0006 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Sign in as agency staff, visit `/clients/new`, submit with only a name filled in → redirected to `/clients/[id]`, every optional field shows as empty → AC-1
- [ ] On `/clients/new`, submit with a name of only spaces → inline error, no row created → AC-2
- [ ] On `/clients/new`, fill a name and an invalid company email (e.g. `not-an-email`) → inline error beside the email field, no row created, the name value is preserved in the form → AC-3
- [ ] Visit `/clients` with more than 25 active clients → 25 rows shown, ordered by name, a pagination control for the rest; the Archived toggle shows only archived clients → AC-4
- [ ] On `/clients`, search a substring of an existing client's name (any case) → only matching clients show, and the search honors whichever of Active/Archived is currently selected → AC-5
- [ ] Open a client's detail page → every field (including phone, industry, billing address) and its archived state are visible → AC-6
- [ ] Edit a client's field, save → the new value shows immediately on the detail page → AC-7
- [ ] Archive a client → a confirm dialog appears first; after confirming, it disappears from the active list and appears under Archived; archiving it again (e.g. via a stale tab) succeeds with no error → AC-8
- [ ] Restore an archived client → no confirm dialog, it returns to the active list immediately; restoring an already-active client succeeds with no error → AC-9
- [ ] As agency A, create a client; sign in as agency B → the client does not appear in B's `/clients` list → AC-10, AC-11
- [ ] As agency B, visit `/clients/[A's client id]` directly → not found, not a permission error or a blank page → AC-11
- [ ] As a client contact (portal login), visit `/clients` → redirected away (no organization claim for the proxy to find) → AC-12
- [ ] A brand new agency with zero clients visits `/clients` → the empty state shows, passes an axe scan in both themes → AC-13
- [ ] Force a read failure on `/clients/[id]` (e.g. a bad id shape that still parses) → the route's `error.tsx` shows, not a stack trace or a blank screen → AC-13
- [ ] Open the same client in two tabs, edit a different field in each, save both within a few seconds → both saves succeed, no error in either tab, and the field values on screen after a reload are whichever save landed last → AC-14
- [ ] On `/clients`, search while on page 3 of unfiltered results → lands on page 1 of the filtered results, not an empty page 3 → AC-4, AC-5, Value sourcing
- [ ] Visit `/clients?page=0`, `?page=-1`, `?page=abc`, and a page number past the last page → all four render page 1, never a 404 or a crash → Value sourcing

## Commands

- [ ] `pnpm typecheck` → passes → build correctness
- [ ] `pnpm lint` → passes, including `clienthq/no-raw-db-import` (nothing outside `src/db/tenant/` touches the raw handle) → AC-10
- [ ] `pnpm test` → passes, 0 regressions → build correctness
- [ ] `pnpm test:e2e` → passes, including the `/design` axe pass in both themes covering the new confirm dialog and address fieldset patterns → AC-13
- [ ] Query `clients` in the live database after a create/update with a mixed-case email → `company_email` is stored lowercase and the `clients_company_email_lowercase_check` constraint holds → Value sourcing

## Acceptance-criteria coverage

- AC-1 create with just a name · AC-2 blank name rejected · AC-3 invalid email rejected · AC-4 active/archived list, 25/page, ordered by name · AC-5 name search honors the current filter · AC-6 detail shows every field · AC-7 edit shows immediately · AC-8 archive confirms and is idempotent · AC-9 restore needs no confirm and is idempotent · AC-10 every read/write scoped through `tenantDb` · AC-11 a foreign agency's id resolves not found · AC-12 a client contact never reaches `/clients` · AC-13 empty and error states pass WCAG 2.2 AA · AC-14 concurrent edits both succeed, last write wins
