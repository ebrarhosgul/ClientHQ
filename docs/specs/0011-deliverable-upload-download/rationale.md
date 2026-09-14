# 0011. Deliverable upload and download: rationale

The decision record behind [index.md](index.md). `/develop` builds from the index; this file is for the people who want to know why.

## Context

Agencies hand their clients files: a print ready PDF, a deck, a zip of source assets, a signed contract. Today ClientHQ has a project page with an empty Deliverables section (spec 0010) and a `deliverables` table with no rows behind it (spec 0002). Feature 12 has to make a file a first class part of a project: attached by staff, visible to the client only when staff say so, downloadable by both, and deletable when it was a mistake.

The forces come from the platform and the earlier specs. The app runs on Vercel serverless functions, which cap a request body at a few megabytes and a function's life at seconds, so a deliverable the size of a real design file cannot pass through the app server at all. Spec 0001 chose Cloudflare R2 as the file store for its zero egress fees and S3 compatible API, and sketched the flow in prose: short lived signed URLs both ways, a `pending` row that becomes `ready` only after the server checks the object, and object first removal. Spec 0002 built the table to that sketch. Spec 0003 made every read and write go through the tenant layer, and spec 0010 added a compare and set to that layer's `update`. None of those decisions is up for debate here; this spec has to turn them into something buildable and settle everything they left open: the allowlist, the size cap, who may do what, how the browser sends the bytes, which library signs the URLs, how a download reaches the browser, what happens in every failure, and how a bucket gets configured.

The tenant rule matters more here than in any feature so far, because a file store has no `org_id` column. The bucket does not know which agency owns a key. Every guarantee about who may read or remove an object has to be enforced by the app before it hands out a URL, and a leaked or guessable key would be a cross tenant leak that the database's scoping cannot catch. The `pending` state matters for a similar reason: a browser can claim any size and type, so the server has to treat the browser's word as a hint and the store's word as the truth.

Not deciding would leave the Deliverables section as a placeholder, block the client portal (feature 15, which has nothing to show without files), and leave the invoice PDF (feature 14) without a store to write into.

## Options considered

### Option 1: Direct to R2 with a pending row (spec 0001's sketch, made concrete)

The browser asks a Server Action for a signed PUT URL, the action inserts a `pending` row and signs a URL that fixes the declared type and size, the browser uploads straight to R2, and a second action reads the object back with `HeadObject` and flips the row to `ready`. Downloads are a route handler that checks permission and redirects to a signed GET. A four function storage port wraps the AWS S3 SDK, with an in memory fake for tests.

**Pros**:
- Bytes never touch Vercel, so the body limit and timeout never apply and the cost is R2's alone.
- The browser's claims are never trusted; the store's answer is what the row records.
- A half finished upload is invisible by construction, not by discipline.
- Everything reuses an existing pattern: `withTenantAction`, the compare and set `update`, the email module's port and fake shape, the Resend style optional env rule.

**Cons**:
- Three round trips per upload (request, put, confirm) and a client component with real state to manage.
- The bucket needs a CORS rule per environment before the browser can PUT, which is an operational step outside the repo.
- The AWS SDK is a heavy dependency for four calls.
- A `HeadObject` per download and per confirm adds a network call the simplest design would not have.

### Option 2: Upload through the app server

A multipart form posts the file to a route handler, which streams it to R2 with the SDK and inserts a `ready` row in one go. No presigning, no CORS, no pending state.

**Pros**:
- One request, one code path, no client side state machine, no bucket CORS.
- The server sees the bytes, so it could sniff the real type rather than trust either the browser or a header.

**Cons**:
- Vercel's request body limit (about 4.5 MB on serverless functions) makes any real deliverable impossible; the feature would ship with a cap that rules out most PDFs and every design file.
- The function timeout bounds the upload time, so a slow connection fails outright.
- Every byte is billed twice (into Vercel, out to R2) and the app server becomes the bottleneck for what should be a storage concern.
- Spec 0001 already rejected this for exactly these reasons.

### Option 3: Supabase Storage instead of R2

Use the storage product of the BaaS the project already runs its database on: signed upload URLs, signed download URLs, and row level policies in the same dashboard.

**Pros**:
- One fewer provider and one fewer set of credentials; the storage rules could be written as Postgres policies next to the tables.
- A first party JavaScript client with resumable uploads built in.

**Cons**:
- Spec 0001 chose R2 for zero egress fees; Supabase's free tier egress is small and client downloads are exactly the traffic that grows.
- It reverses a settled foundation decision for a convenience, and the `r2_key` column, the seed, and the scope row all already say R2.
- The policies would live in a second place that spec 0003's tenant layer does not see, splitting the one rule the product rests on.

### Option 4: A managed upload widget (Uppy with tus, or UploadThing)

Drop in a client library that handles picking, chunking, resumable multipart uploads, and progress, pointed at R2 or at the vendor's own store.

**Pros**:
- Resumable, chunked uploads with retries for free, and a polished picker.
- The progress and cancel UI comes finished.

**Cons**:
- Multipart and resumable uploads need server side coordination (create, sign each part, complete) that is far more surface than a single PUT, for files capped at 100 MB where a single PUT is fine.
- A vendor hosted store moves the bytes off R2 and brings back egress bills; a self hosted tus server is a whole new service to run.
- The widget's styling and accessibility are the vendor's, not `design.md`'s, and would need to be made to fit.

## Rationale

Option 1 is chosen because it is the only one that honours all three settled constraints at once: bytes stay off Vercel, R2 stays the store, and the tenant layer stays the single place that decides who may touch a row. The prose in spec 0001 was already this option; the work here was pinning every detail that prose left loose, and each of those pins was chosen with the same lens, reuse what the codebase already runs on and keep the new surface as small as it can be while still being complete.

The finer choices follow from that lens. The **AWS S3 SDK with the presigner** over `aws4fetch` or a hand rolled signer: Cloudflare documents this exact path for R2, the presigner fixes `Content-Type` and `Content-Length` into the signature without hand assembling canonical requests, and the four calls the port needs are typed and maintained; the runner up, `aws4fetch`, is tiny but leaves the caller writing and parsing raw S3 requests, which is where signing bugs live. **`XMLHttpRequest`** over `fetch`: it is the only browser API that reports upload progress, and a 100 MB file without a progress bar is indistinguishable from a hung page; the wrapper is small enough that the older API does not spread. **A route handler that redirects** for downloads over an action that returns a URL: a plain link needs no JavaScript, is keyboard and screen reader native, can be pasted inside the agency, and is exactly what the client portal needs later; the runner up would have made every download a button with client code and made a copied link impossible. **A `HeadObject` before every download redirect**: one cheap call turns an unstyled R2 XML error into a readable page and a log line, and the row that points nowhere is precisely the failure the object first delete order is designed to make visible. **15 minute PUT and 2 minute GET lifetimes**: R2 checks the signature when the request starts, so a long upload only needs the PUT URL alive at the moment the connection opens; two minutes on GET is ample for an immediate redirect and short enough that a leaked link is near useless. **An `abandonUpload` action** on top of feature 18's sweep: a person who retries five times should not leave five pending rows until tomorrow, and because the sweep still runs, the call can be best effort and nothing depends on it. **Uploader only confirm and abandon**: a pending row is one person's in progress action, and letting another session finish or discard it is a small oddity with no benefit. **A bucket scoped token** for the app and a separate admin token for the setup script (`R2_ADMIN_*`, optional everywhere and read by the script alone): least privilege costs one extra token and removes the ability of a leaked app key to empty or delete every bucket in the account. **Two SDK settings pinned in the spec rather than left to defaults**: the checksum middleware is set to `WHEN_REQUIRED` because its default adds headers R2 rejects on presigned requests, and `content-type` and `content-length` are passed as `signableHeaders` because the claim that the signature binds them is only true if the presigner is told to sign them; both are unit tested so a future SDK bump that changes a default fails in CI rather than in a customer's browser. **A setup script over dashboard clicks**: three environments configured by hand drift, and a wrong origin shows up as an opaque CORS failure in the browser; a script in git is reviewed, repeatable, and reads the origin from a variable the app already has.

The engineer's product answers set the rest: any staff member may upload and delete (no admin gate, matching spec 0001's role table; delete is recoverable by uploading again, unlike archive), the allowlist is documents, images and archives with a 100 MB cap, one file at a time, visibility is the only edit (rename and replace are delete plus upload), archived projects refuse uploads but any status allows them, downloads are always attachments (so user uploaded SVG never renders under an origin the app controls), duplicate names are allowed, no audit trail (consistent with hard delete everywhere else so far, and an audit log is a cross cutting decision for its own spec), and the automated tests stop at a fake store with the real bucket proven once per environment in `verify.md`, matching how Stripe and Resend are tested here.

Two things were considered and deliberately not done. Sniffing the bytes for their real type is impossible in this design because the server never sees them, and `HeadObject` only reports what R2 was told; the mitigation is the signed `Content-Type`, the allowlist, and the attachment disposition, which together mean a mislabelled file is at worst a file that will not open, never one that runs. Multipart uploads were left out because a single PUT covers the 100 MB cap with room to spare, and the day the cap needs to grow past 5 GB is the day to revisit Option 4.

## Evidence

Read during the design, so the decisions above rest on the code as it is on 2026-09-14:

- `src/db/schema/projects.ts`: the `deliverables` table matches spec 0002, including the `r2_key` unique, the `pending`/`ready` check, and the `(org_id, status, created_at)` sweep index.
- `src/db/tenant/tables.ts`: the contact predicate on `deliverables` already restricts a contact to rows on their own client's projects, so the download route's contact branch adds only the `ready`, visible, and not archived checks.
- `src/db/tenant/accessor.ts`: `update` takes `options.where` combined with `AND` inside the scope, which is the compare and set `confirmUpload` uses.
- `src/proxy.ts`: `/deliverables(.*)` is neither public nor an agency route, so a session is required and an organization claim is not, which is what a route shared by staff and contacts needs.
- `src/app/(agency)/(gated)/layout.tsx` and `src/access/gate.ts`: the gate applies to pages by layout, so the download route calls `agencyAccess()` itself.
- `src/lib/env.ts`: the `RESEND_API_KEY` optional outside production pattern the `R2_*` variables copy.
- `src/email/`: the module shape (`send.ts` plus templates and a test that never hits the network) that `src/storage/` mirrors.
- `src/ui/primitives/`: `switch.tsx`, `dialog.tsx`, and `sonner.tsx` exist; there is no progress primitive, so the build adds one (a native `<progress>` styled with tokens, or shadcn's `progress`, the builder's call).
- `package.json`: no `@aws-sdk/*` and no Sentry SDK yet; the AC-14 log line is a server log until feature 20.
- `docs/.agent-cache/tool-discovery/stack.md` (2026-09-05) and a fresh registry search: `aws/agent-toolkit-for-aws@aws-sdk-js-v3-usage` and `secondsky/claude-skills@cloudflare-r2` installed; `jezweb/claude-skills` no longer carries an R2 skill; no credible MCP server for R2 or S3 beyond the Cloudflare one already declined.
