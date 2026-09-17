# 0014. Client portal: rationale

The decision record behind [index.md](index.md). `/develop` reads the index; this file is for a person who wants to know why.

## Context

The product's promise to an agency's client is one place to look: what is being worked on, what has been shared, what is owed. Every earlier feature built the agency's side of that promise and left the client's side as a placeholder: spec 0005 put a stub at `/portal` so an accepted contact had somewhere to land, spec 0009 built the front door (the invitation, the acceptance, the `clienthq_contact` cookie), spec 0011 built the download rule for a contact and reused the same route, spec 0012 fixed which invoice statuses a client may see and put a stub at `/portal/invoices/[id]` so the issue email had somewhere to link, and spec 0013 served the contact's PDF from a portal URL. What remains is the surface itself, plus three decisions those specs explicitly handed here: the switcher for a person with several contact rows, whether a lapsed agency's files stay downloadable, and whether a client sees invoice history.

Four forces shape the design. First, isolation is already structural: spec 0003's contact accessor narrows every table to the contact's own client and cannot express a query that does not, so the portal's job is to stay on that path and never introduce a read that bypasses it. Second, the gate rule is already written: spec 0008 fixed that a `locked` agency's contact sees a plain page naming the agency, that `grace` and `full` read as normal, and that the read goes through `unsafeTenantQuery` with the reason `portal gate`; it also noted that a Next.js layout does not re render on a client side navigation, so a gate checked only in a layout goes stale mid session. Third, the chrome is already written: spec 0004 and `design.md` fix a top bar, three sections, no sidebar, no primary buttons and describing empty states. Fourth, the people: an agency's client is not a ClientHQ user and should never be shown ClientHQ's internal vocabulary, billing state or agency facing copy; and the person reading the portal may be the contact for several companies or work with several agencies, each an independent `client_contacts` row.

One more force is proof. Spec 0009 could only walk the contact's sign in by hand, because the browser suite had a single Clerk test user with an agency; the portal is the first feature whose whole surface lives behind that second kind of session, and a portal that is never driven by a machine is a portal whose isolation is proven only by database tests.

Not deciding leaves two stubs in production and an email button that lands on "coming soon". Deciding badly (a page that trusts a client id in the URL, a gate that checks once per session, a list without paging) is the kind of failure a multi tenant product cannot recover its reputation from.

## Options considered

### Option 1: Server rendered pages behind one cached `portalContext()` helper, a `(contact)` route group, and a redirect based gate

Each page is a Server Component. It calls one request cached helper that resolves the context, applies the staff and no row redirects, reads the gate and redirects a lapsed agency to a dedicated `/portal/unavailable` page, then reads its rows through the contact accessor. A `(contact)` route group carries the chrome in its layout and keeps `/portal/accept` (which must work before a row is bound) outside it. The two existing file routes call the same gate function in their contact branch.

**Pros**:
- Every page re checks the gate on every navigation, because the helper runs per request and is cached, so a lock lands on the next page rather than the next full load.
- The layout and the pages cannot disagree: a lapsed agency is redirected, not shown different content by different components rendering in parallel.
- No new library, no client state, no API layer; the same pattern every agency screen already runs on.
- The unavailable page is a real URL, so a bookmarked file link can `302` to it and a restored agency's contact is sent back cleanly.

**Cons**:
- One extra `subscriptions` read per request, on top of the context resolution.
- A redirect based gate means the unavailable page needs its own minimal frame outside the group, a small duplication of the top bar.
- Server rendering the invoice document on the portal means the `InvoiceDocument` component must already be free of agency only controls, which spec 0013 arranged but this feature must keep.

### Option 2: Gate in the layout only, with a `template.tsx` to force re rendering

The `(contact)` layout resolves the context and the gate once and renders either the chrome and children or the unavailable content in place; a `template.tsx` in the group makes the check re run on client side navigations.

**Pros**:
- One call site for the gate rather than one per page.
- No separate unavailable route.

**Cons**:
- In the App Router a layout and its page render in parallel; while the layout decides the agency is locked, the page has already run its queries, so the gate protects the screen but not the read.
- `template.tsx` re mounts the whole subtree on every navigation, which resets focus and scroll and makes the skip link and the switcher's focus return harder to keep right.
- The two file routes still need a gate call of their own, so the "one call site" is not real.

### Option 3: A client rendered portal over JSON route handlers

A single client component tree under `/portal` fetches `/api/portal/*` route handlers and renders lists and documents in the browser, with the context and the gate checked in each handler.

**Pros**:
- Instant section switching without a server round trip for the chrome.
- The handlers are reusable by a future mobile app.

**Cons**:
- A second surface to secure and test: every handler repeats the context, the gate and the scoping, and every one is a place to get it wrong.
- The invoice document would render twice, once for the agency (server) and once for the portal (client), undoing spec 0013's single presentation module or forcing it into the browser bundle.
- Loading, empty and error states move into client state, and axe has to run against every state transition rather than a rendered page.
- No mobile app is on the roadmap; the reuse is hypothetical.

### Option 4: Reuse the agency `AppShell` with a portal navigation config

Mount the portal pages inside the existing `AppShell`, passing a navigation list of three items and hiding the agency switcher.

**Pros**:
- No new shell component.
- The mobile sheet, the skip link and the landmark structure are already tested.

**Cons**:
- `design.md` fixes the portal as having no sidebar and a horizontal section strip; the shell's whole layout is a sidebar, so the reuse is a fight with the design system rather than a saving.
- The shell's user menu and switcher are wired to Clerk organizations, which a contact never has.
- Hiding controls by configuration is how a primary button ends up in the portal one day.

## Rationale

Option 1 is chosen because the two forces that matter most, structural isolation and a gate that cannot go stale, are both satisfied by the same shape: a page that must call one helper to get its context is a page that cannot skip the gate and cannot read a row outside the accessor, and a helper that runs per request is a gate that is checked per navigation. Option 2 protects the screen but not the read, which in a multi tenant product is the wrong half. Option 3 doubles the surface to secure for a benefit (instant switching, a reusable API) that no one has asked for. Option 4 spends its effort fighting `design.md`.

The redirect based unavailable page, rather than swapping content in the layout, follows from the same parallel rendering fact: a redirect thrown from the helper stops both the layout and the page, and gives the file routes a URL to send a bookmarked link to. Extending the unavailable rule from `locked` to `unsubscribed` follows from spec 0008's own wording for that level ("no row, or a Checkout that never finished"): nothing is being paid for, and a client should see the same neutral page in both cases rather than an empty portal in one of them.

The engineer's picks in the design conversation shaped the rest and are recorded as fixed requirements: an overview at `/portal` rather than a straight list; every non archived project in every status; a project detail page carrying its files as well as a cross project Files section; files grouped by project and dated by `created_at` rather than a new `shared_at` column; invoices unpaid first with status and key dates only and no events list; the switcher in the top bar in place of the plain company name; no staff preview, no visit tracking, an archived client's portal reading as normal; pages of 25; the file routes gated; a staff session sent to `/dashboard`; a Playwright walk on a second Clerk test user; the section strip staying at every width; the gate re checked per page; a portal specific not found page; and the neutral unavailable copy. The decisions made here without asking, each with its runner up: the third section is labelled `Files` at `/portal/files` (plain words for a client audience; runner up `Deliverables`, the agency's word); `page` and `id` are parsed by Zod with invalid values reading as page 1 or not found (runner up: throwing, which would be an error page for a typo); `switchContact` is a plain Server Action outside `withTenantAction` because it acts before a tenant is chosen (runner up: a route handler, which would need its own CSRF story); the switcher rows come from a named door in `src/db/tenant/` in the shape of `invitation.ts` (runner up: extending `context.ts`, which would mix a per request resolver with a listing); a refused switch writes one warn line (runner up: silence, which hides a forged id); overview blocks are capped at 5 (runner up: 3, which hides too much for a client with several projects); the invoice list tie breaks by number descending (runner up: created time, which a client never sees); the file routes answer a `302` to the unavailable page when the agency is lapsed (runner up: a `503` page built by `downloadErrorResponse`, which a browser shows as an error rather than the neutral page).
