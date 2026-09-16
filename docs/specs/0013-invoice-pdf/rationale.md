# 0013. Invoice PDF: rationale

The decision record behind [index.md](index.md). `/develop` reads the index; this file is for a person who wants to know why.

## Context

An agency's client needs the invoice as a file: to save it, to forward it to their accountant, to attach it to a purchase order. Spec 0012 made that possible in principle by freezing an issued invoice (nothing but its status changes after issue) and by giving every read path the same rows, but it left the file itself to this feature, and the scope row says the document must match the screen exactly, be reachable by the agency and by the invoiced client, and be refused for drafts and voided invoices.

Four forces shape the design. First, the host: the product is a single Next.js application on Vercel, running inside a serverless function with a bundle size limit, a cold start cost that grows with the bundle, and no browser installed; anything that needs a headless browser fights the platform. Second, trust: the client's PDF, the agency's screen and the portal's page must be one document, so the source of every string has to be shared, not copied. Third, tenancy: the route serves two kinds of person, staff of the owning agency and a contact of the invoiced client, and the proxy sends any `/invoices` URL without an organization claim away before a handler runs, so a contact cannot reach the URL a staff member would use. Fourth, the agency row carries only a name, a slug and a currency; there is no address, tax id or payment instruction to print, and an agency settings feature is not on the near roadmap.

Not deciding leaves the client with a browser's print to PDF of a web page: no filename, the shell's navigation on the page, and a layout that changes with the window. Deciding badly (a stored file that goes stale after payment, or a browser binary in the function) is a cost paid on every download for years.

## Options considered

### Option 1: Render on demand with `@react-pdf/renderer` from a shared presentation module (chosen)

A pure function turns the frozen rows into plain strings; a small React tree written for the renderer lays them out; a route handler renders to bytes on every request and streams them back as an attachment. Two route files, one under `/invoices` for staff and one under `/portal` for contacts, call one handler. Nothing is stored.

**Pros**:
- Pure JavaScript in the existing Node function: a few megabytes, no binary, no browser, sub second renders.
- Always current: the status printed is the status at download time, with no cache or object to invalidate.
- The shared presentation module makes the screen and the PDF agree by construction, and hands feature 15 the same strings.
- No new environment variable, provider, migration or storage object.

**Cons**:
- The PDF's layout is its own component tree, not the screen's markup; a visual change has to be made twice.
- Every download spends CPU; a scripted client could make the route expensive until feature 19's ceilings exist.
- The renderer produces no tagged PDF, so the file is less accessible than the page.
- Fonts must be shipped as files and traced into the function; the built in fonts cannot print Turkish or Central European letters.

### Option 2: Headless Chromium printing a print view of the page

Add `puppeteer-core` and a serverless Chromium build, render a print styled version of `/invoices/[id]` and call the browser's print to PDF.

**Pros**:
- Pixel faithful reuse of the real HTML and Tailwind: one layout, no second tree.
- Anything the page can show, the PDF can show, including future letterhead blocks with no renderer work.

**Cons**:
- A 50 MB browser binary in the function, cold starts of several seconds, and a bundle that presses against Vercel's size limit; the heaviest choice on a product that runs inside free tiers.
- The print view needs its own authenticated navigation from inside the function (a session for the browser to use), which is a second security surface.
- Fragile across Chromium and Next.js upgrades; the most common "it broke in production" story for PDF features on serverless hosts.

### Option 3: Generate once on issue and store the file in R2

Render (with any engine) inside the notification step after the issue commit, put the bytes through the storage port spec 0011 built, and serve downloads as a redirect to a presigned GET, exactly like deliverables.

**Pros**:
- A durable artifact: the file the client received is stored, and a download is a redirect, not a render.
- Reuses the storage port and the download route shape the team already knows.

**Cons**:
- The status printed is fixed at issue, so a paid invoice's PDF says "Sent" forever, or a second generation on every status change has to be added, which is a cache with more failure modes.
- It adds a step to issuing that can fail after the commit, a metadata column or two to record the object, and an object to clean up when a tenant is deleted.
- R2 is optional outside production; the feature would inherit the "storage not configured" path for a document that needs no storage.

### Option 4: A hosted HTML to PDF service

Send the invoice's HTML to a provider (PDFShift, DocRaptor, Browserless and similar) and return what it sends back.

**Pros**:
- No rendering code or fonts to own; the provider runs the browser.

**Cons**:
- Invoice data and the client's address leave the platform on every download, to a provider the agency did not sign up for.
- A per page cost, a new key, a new outage mode and a new item in the data processing agreement.
- Latency of a network round trip on top of the render, for a document that takes milliseconds locally.

## Rationale

Option 1 is chosen because the forces in Context are about the host, trust and tenancy, and Option 1 answers each with the least machinery. The host: a pure JavaScript renderer is the only option that stays inside the function the app already has without a binary or a provider. Trust: the engineer's choice to print the current status and paid date rules out a stored file (Option 3) unless it is regenerated on every change, at which point it is a cache and the on demand render is simpler; and the shared presentation module gives the "matches the screen" guarantee that Option 2 would buy with a browser, at a fraction of the cost. Tenancy: two thin route files behind one handler respect the proxy's existing rule instead of carving an exception into the line spec 0005 calls the most consequential in that feature.

Two calls were made here rather than asked. The status rule for staff is the same `CLIENT_VISIBLE_STATUSES` constant the portal uses, because "has a PDF" and "a client may see it" are the same set today and should stay one constant; if they ever diverge, spec 0012's module is where the new constant belongs. And the fonts are shipped as files and registered inside the render function rather than at module load, because a module level `Font.register` is a side effect the project's rules forbid, and the renderer's registry makes repeated registration harmless.

One quieter alternative deserves a note: `pdfkit`, the drawing library the chosen renderer is built on, with a longer track record on serverless hosts and no React layer. It was not carried as a full option because it draws by coordinates: a line item table that breaks across pages with a repeated header, wrapping descriptions and right aligned amounts is exactly the layout work the renderer's flexbox layer does for free, and that layer is the whole reason task 1 exists to prove the bundling. If the preview deployment in task 1 fails in a way the URL font fallback cannot fix, `pdfkit` is the retreat, with the same `presentInvoice` feeding it.

Option 2 would be the right answer for an invoice with rich, frequently changing branding that must be pixel identical to the page; this product's invoice is a table and a few blocks, and the second tree is a morning's work. Option 3 becomes attractive if a regulator ever requires the exact bytes the client received to be kept; the frozen rows already allow any past download to be reproduced, which is the same guarantee at no storage cost. Option 4 was never close: the data leaves the platform for a problem the platform solves locally in milliseconds.

The engineer's picks that shaped the design: contacts served now rather than in feature 15; the client's billing address printed and added to the screen; the status and paid date printed; A4 for every agency; the email left as a link; the 404 page for every refusal; a save as download named after the invoice; Inter embedded; a readable 500 page on render failure; a footer with the generation time and page numbers; any staff role; an archived client's contacts still able to download. None conflicted with the recommended direction.
