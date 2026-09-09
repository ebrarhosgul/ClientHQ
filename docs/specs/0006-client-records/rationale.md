# 0006. Client records: rationale

## Context

An agency's whole reason for using this product is to manage its clients, so this is the first screen with real stakes: real data, owned by one agency, that must never leak to another. The table this feature builds on, `clients`, was already designed in spec 0002 with a minimal shape (name, company email, notes, an archived timestamp); nothing has been built on top of it yet. The tenant scoping layer (spec 0003) and agency sign in (spec 0005) are both already built and tested, so this feature's only new risk is whether it uses that layer correctly, not whether the layer itself holds.

The project's build approach is Tracer Bullet: prove the whole pipe end to end before thickening any one part. The scope row for this feature calls it "the first real tenant scoped write and read" that "closes the walking skeleton thread", which means the build plan should reach a working create and list before it reaches search, pagination, or polish.

Two forces shaped the data model beyond what spec 0002 already settled. First, the agency wants more fields than the original three (phone, industry, and a billing address), captured now while this table's shape is already being touched, rather than as a second migration later. Second, feature 14 (invoice PDF) will eventually need a billing address to print on an invoice; whether that address is structured or free text now decides whether that later feature can read it directly or has to parse it.

Every screen in this feature also has to meet the project's accessibility baseline (WCAG 2.2 AA), including its empty and error states, which the design system (spec 0004) already has patterns for.

## Options considered

### Option 1: URL driven server components, Server Actions for writes

The list page reads `page`, `q`, and `archived` straight from its URL search params and queries `tenantDb` directly as a server component; every write (create, update, archive, restore) is a Server Action wrapped in `withTenantAction`. No client side data fetching library, no local component state for what page or filter is showing.

**Pros**:
- Matches the pattern the rest of the app already runs on (Server Components for reads, Server Actions for writes, per the project's `AGENTS.md`); no new dependency.
- The URL is the single source of truth for what is showing, so the back button, a bookmarked filtered view, and a shared link all work with no extra code.

**Cons**:
- Every filter change is a full server round trip (a page navigation), not an instant client side update; at agency scale this is unlikely to be noticeable, but it is a real cost compared to client side state.

### Option 2: Client side fetching with local state

A client component holds the current page and search term in React state, fetching from a route handler as the user types or clicks, similar to a typical single page app data table.

**Pros**:
- Can feel snappier for a fast typist searching interactively, with no full page reload per keystroke.

**Cons**:
- Needs a new route handler layer alongside the Server Actions this project already uses for writes, plus a client side fetching approach (nothing is installed for this; it would mean adding a new library or hand rolling one), and its own loading and error handling separate from what Server Components already give for free.
- The URL no longer reflects what is showing unless it is manually kept in sync, so back button and shareable links need extra code to still work.

### Option 3: Cursor based pagination instead of page numbers

Rather than page numbers, the list moves through with a cursor (an opaque pointer to the next batch), the pattern that scales best under high write volume or very large tables.

**Pros**:
- Stays correct and fast even at very large row counts, where offset pagination can skip or repeat rows as data changes underneath it.

**Cons**:
- No page numbers to jump to a specific page, only next and previous, which is a worse fit for a list an agency will have at most a few hundred rows in.
- More moving parts (an opaque cursor to encode and decode) for a problem this feature does not have.

## Rationale

Option 1 is the only one that costs nothing new: no library, no second data fetching layer, no client side state to keep in sync with the URL. It is also the pattern spec 0004 and spec 0005 already established for every other screen in the app, so a staff engineer reading this feature after those two will recognize it immediately. Option 2's snappier feel is a real benefit, but not one an agency with at most a few hundred clients will notice, and it would introduce the exact kind of new moving part the Tracer Bullet approach argues against this early. Option 3 solves a scale problem this feature does not have; offset pagination is the simpler tool for the actual row counts in play, and switching later is a contained change if it is ever needed.

The structured billing address (six columns instead of one free text field) costs a handful of extra nullable columns today in exchange for feature 14 never having to parse an address back out of a paragraph of text. Given the migration is already touching this table for the other new fields, this was the cheaper moment to make that call.
