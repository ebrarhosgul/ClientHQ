# 0011. Deliverable upload and download

**Date**: 2026-09-14
**Status**: Proposed

## Summary

This spec is the build plan for attaching real files to a project. A staff member picks one file on the project page, the browser sends the bytes straight to Cloudflare R2 (the file store, which speaks the same API as Amazon S3) using a short lived signed URL, and the server only ever handles small facts about the file: its name, its declared type and size, and later the real type and size read back from the store. A file starts as a `pending` row that nobody can see, and becomes `ready` only after the server has confirmed the object is really there. Downloads work the same way in reverse: a plain link that the server checks and then redirects to a signed URL good for two minutes, always as a saved attachment. Each file carries one switch for whether the client may see it. The database table already exists from spec 0002 with no changes; what is new is the storage module (`src/storage/`), the R2 client library, four environment variables, and the Deliverables section on the project page.

## Requirements

**User stories**:
- As an agency staff member, I want to attach a file to a project so the deliverable lives with the work it belongs to.
- As an agency staff member, I want to see a progress bar while a large file uploads, and a clear message if it fails, so I know whether to wait or retry.
- As an agency staff member, I want to choose, per file, whether the client can see it, so drafts and internal notes stay internal.
- As an agency staff member, I want to download any file on my agency's projects and delete one that was uploaded by mistake.
- As a client contact, I want to download the files my agency has chosen to share with me, and nothing else (the download rule is built here; the portal screen that lists them is feature 15).

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: A signed in staff member (admin or member) can add one file at a time to a project that is not archived, from the Deliverables section of `/projects/[id]`, in any project status including `delivered`; an archived project shows no upload control, and a `requestUpload` against it is refused with `conflict`.
- **AC-2**: `requestUpload` validates the file name (trimmed, 1 to 255 characters, no control characters, and none of `/`, `\` or `"`, which a browser never puts in `File.name` and which would break the download header), the declared content type against the allowlist, and the declared size (1 byte to 100 MB, `104857600` bytes); any failure is refused with `validation` and a field error, and no row is created. Checks run in a fixed order: the Zod parse (done by the wrapper before the handler), then storage configured, then project found in this agency, then project not archived; the first failure wins.
- **AC-3**: The allowlist is exactly: `application/pdf` · `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (docx) · `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (xlsx) · `application/vnd.openxmlformats-officedocument.presentationml.presentation` (pptx) · `text/plain` · `text/csv` · `image/png` · `image/jpeg` · `image/gif` · `image/webp` · `image/svg+xml` · `application/zip`; one constant drives both the server check and the file picker's `accept` attribute, and the server check is the one that counts.
- **AC-4**: A successful `requestUpload` inserts a `deliverables` row with status `pending`, `r2_key` equal to `org/{orgId}/project/{projectId}/{deliverableId}`, `uploaded_by_user_id` equal to the acting user, and the browser's declared type and size, and returns the row id plus a presigned PUT URL valid for 15 minutes whose signature fixes the declared `Content-Type` and `Content-Length` (passed to the presigner as `signableHeaders`, so they are signed headers rather than hoisted into the query), so the browser cannot store bytes other than what it declared; the signed request carries no SDK checksum headers, which R2 rejects. Presigning is a local computation: this action never calls R2.
- **AC-5**: The browser sends the bytes directly to the signed URL with `XMLHttpRequest`, and never to the app server; the upload control shows a labelled progress bar that reflects upload progress, and a live region announces completion and failure to assistive technology.
- **AC-6**: `confirmUpload` on a `pending` row belonging to the acting user calls `HeadObject` on the key; when the object is present its real `Content-Length` and `Content-Type` are written into `size_bytes` and `content_type` and the row flips to `ready` with a compare and set on `status = 'pending'`; when the object is absent the row stays `pending` and the action returns `conflict` with a message saying the upload has not finished, so the browser can retry the confirm without uploading again; when the object is present but its read back type is outside the allowlist or its size is zero or over the cap, the object is deleted, then the row, and the action returns `validation`; that removal tolerates a concurrent `abandonUpload` (the object delete is idempotent and a row already gone is not an error).
- **AC-7**: `confirmUpload` and `abandonUpload` act only on a `pending` row whose `uploaded_by_user_id` is the acting user; any other row (another user's, another agency's, nonexistent) is `not_found`; confirming a row that is already `ready` short circuits, returning the stored size and type with no R2 call and no change.
- **AC-8**: `abandonUpload` deletes the R2 object if one landed and then the `pending` row, and succeeds with no change when the row is already gone; the browser calls it, best effort, when the PUT fails or the person cancels, and nothing depends on that call arriving because feature 18's daily sweep removes `pending` rows older than 24 hours.
- **AC-9**: A `pending` row is never listed in the Deliverables section, is `not_found` to `setDeliverableVisibility` and `deleteDeliverable`, answers 404 on the download route, and is invisible to every contact path.
- **AC-10**: The Deliverables section on `/projects/[id]` lists the project's `ready` deliverables newest first with no paging, showing for each the name, a human readable size, a short type label, the uploader's name, the upload date, the client visibility switch, a download link, and a delete button; it renders an empty state when there are none and an error state when the read fails.
- **AC-11**: Any staff member can flip `visible_to_client` on a `ready` deliverable with `setDeliverableVisibility`; the action is idempotent (setting the value it already has succeeds), the switch is labelled with the file's name, and the stored value is what shows after a refresh.
- **AC-12**: `GET /deliverables/[id]/download` with a staff session first applies the subscription gate exactly as the gated layout does (an `unsubscribed` or `locked` agency is redirected to `/billing` before any row is read), then resolves the row inside the acting agency, requires status `ready`, calls `HeadObject`, and answers `302` to a presigned GET URL valid for 2 minutes carrying `response-content-disposition: attachment` with the stored name as the filename, so the browser always saves rather than renders; a `pending` row, another agency's row, a non uuid or a nonexistent id all answer the app's 404 page.
- **AC-13**: The same route with a client contact session answers `302` only when the deliverable is `ready`, `visible_to_client` is true, its project is not archived, and the project's client is the contact's own client; every other case answers 404 and looks identical to a nonexistent id.
- **AC-14**: When the download route's `HeadObject` finds no object behind a `ready` row, it answers a readable "this file is missing" page with status 404 naming the deliverable, and writes a server side error log naming the row id, rather than redirecting to an R2 error document.
- **AC-15**: Any staff member can delete a `ready` deliverable from the section, behind a confirm dialog; `deleteDeliverable` deletes the R2 object first and the row second, so a storage failure leaves the row in place and returns an error message and nothing else changes; deleting a row that is already gone succeeds with no change.
- **AC-16**: Every deliverable read and write goes through the tenant scoping data access layer; a staff member from another agency cannot list, confirm, abandon, toggle, download, or delete this agency's deliverables, and each attempt behaves exactly like a nonexistent id; a client contact context calling any of the five Server Actions is refused; every successful write revalidates `/projects/[id]`.
- **AC-17**: Two deliverables on one project may share a name; no uniqueness is enforced on `name`.
- **AC-18**: The four R2 variables are optional outside production and required in production by a cross field rule in `src/lib/env.ts`; when they are absent the Deliverables section still lists rows but replaces the upload control with a notice saying file storage is not configured, every one of the five Server Actions checks `isStorageConfigured()` before anything else and refuses with `conflict` and the message "File storage is not configured for this environment", and the download route answers a readable page with status 503 (heading "File storage is not configured", body "Downloads are unavailable in this environment.") rather than crashing.
- **AC-19**: `scripts/r2-setup.ts` applies the bucket's CORS rule (allowed origin `NEXT_PUBLIC_APP_URL`, method `PUT`, allowed header `Content-Type`, max age one day) with `PutBucketCors`, reads it back with `GetBucketCors`, is safe to run repeatedly, and authenticates with `R2_ADMIN_ACCESS_KEY_ID` and `R2_ADMIN_SECRET_ACCESS_KEY` (optional in the Zod schema in every environment, read by this script only, never by the app); it refuses to run without those two plus `R2_ACCOUNT_ID`, `R2_BUCKET` and `NEXT_PUBLIC_APP_URL`.
- **AC-20**: The upload control, the list, the switch, the confirm dialog, the progress bar, the empty, error, and not configured states, the missing file page, and the storage not configured page all pass WCAG 2.2 AA in both themes, using the existing empty and error state patterns, and the new pieces appear on `/design` in every state.

## Decision

**Chosen option**: Option 1: Direct to R2 with a pending row, as spec 0001 sketched, made concrete: a narrow storage port in `src/storage/` backed by `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, five Server Actions through `withTenantAction`, one route handler for downloads, and an `XMLHttpRequest` upload with progress.

File bytes never touch Vercel; the server signs URLs, reads facts back from R2, and keeps the `pending` to `ready` promise. Every choice below reuses a pattern the codebase already runs on (the tenant layer, the compare and set `update`, the email module's port and fake shape, the optional outside production env rule from Resend).

**Implementation skills**: `aws-sdk-js-v3-usage` (`aws/agent-toolkit-for-aws`, `.agents/skills/aws-sdk-js-v3-usage/`) · `cloudflare-r2` (`secondsky/claude-skills`, `.agents/skills/cloudflare-r2/`) · `zod` (`.agents/skills/zod/`) · `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `shadcn` (`.agents/skills/shadcn/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `vitest` (`.agents/skills/vitest/`) · `error-handling-patterns` (`.agents/skills/error-handling-patterns/`)

## Feature design

**Data model sketch**:

The `deliverables` table already exists (spec 0002). No column, index, or constraint changes, so no migration lands in the build plan. This feature fixes how each column is written.

| Field | Type | Nullable | Rule this feature adds |
|---|---|---|---|
| id | uuid (pk) | no | existing; generated before the PUT is signed, so the object key can use it |
| org_id | uuid (fk to organizations, restrict) | no | existing, tenant scope, always from context |
| project_id | uuid (fk to projects, restrict) | no | must be a non archived project of the acting agency at `requestUpload` |
| name | text | no | the browser's file name, trimmed, 1 to 255 characters, no control characters; duplicates allowed |
| r2_key | text, unique | no | `org/{orgId}/project/{projectId}/{id}`; never user text, never shown, never a URL |
| content_type | text | no | the browser's declared type at insert; overwritten from R2 on confirm |
| size_bytes | bigint | no | the browser's declared size at insert; overwritten from R2 on confirm |
| uploaded_by_user_id | uuid (fk to users, restrict) | no | the acting user's `users.id` from context; the only user who may confirm or abandon |
| visible_to_client | boolean, default false | no | flipped by `setDeliverableVisibility` on `ready` rows only |
| status | text, `pending` or `ready` | no | `pending` at insert, `ready` after a confirmed `HeadObject`, never back |
| created_at, updated_at | timestamptz | no | existing; `created_at` is the sweep cutoff and the list order |

The R2 object is not a table but it is part of the model: exactly one object per `ready` row, zero or one per `pending` row, none for a deleted row. The `(org_id, status, created_at)` index from spec 0002 serves feature 18's sweep; `(org_id, project_id)` serves the list.

Relationships, unchanged: `projects` 1:N `deliverables` (RESTRICT, so a project with files cannot be deleted); `users` 1:N `deliverables` as uploader (RESTRICT, and `scrubUser()` keeps the row resolvable as "Deleted user").

**State transitions**:

`pending` → `ready`, once, by `confirmUpload` with a compare and set on `status = 'pending'`. There is no path back. A `pending` row leaves the table through `abandonUpload` (the requesting user), feature 18's sweep (older than 24 hours), or the out of rules branch of `confirmUpload`. A `ready` row leaves through `deleteDeliverable`. In every removal the object goes first and the row second.

```
requestUpload ──► pending ──confirmUpload (HeadObject ok)──► ready ──deleteDeliverable──► gone
                    │                                          
                    ├── abandonUpload / sweep / out of rules confirm ──► gone
                    └── confirmUpload (object absent) ──► pending, conflict returned, retry allowed
```

**The storage port** (`src/storage/`, shared infrastructure, mirrors `src/email/`):

```ts
type ObjectStorage = {
  readonly presignPut: (args: { key; contentType; contentLength; expiresInSeconds }) => Promise<string>;
  readonly presignGet: (args: { key; filename; expiresInSeconds }) => Promise<string>;
  readonly head: (key) => Promise<{ contentType: string; contentLength: number } | undefined>;
  readonly delete: (key) => Promise<void>;
};
```

`r2.ts` implements it with `S3Client` (endpoint `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region `auto`, the SDK's default addressing, and `requestChecksumCalculation: "WHEN_REQUIRED"` plus `responseChecksumValidation: "WHEN_REQUIRED"`, because the SDK's default checksum middleware adds headers R2 rejects on presigned requests) and the presigner; `presignPut` passes `signableHeaders: new Set(["content-type", "content-length"])` so both are signed headers, not query hoisted. `fake.ts` is an in memory implementation for tests, recording puts, heads and deletes, with a switch to make `delete` throw. `index.ts` exports `objectStorage()` (returns `undefined` when the four variables are absent) and `isStorageConfigured()`. The client is constructed inside a function, never at module scope, so a build never needs credentials (the same rule `src/db/AGENTS.md` sets for the database handle). `presignGet` sets `ResponseContentDisposition` to `attachment; filename="<ascii fallback>"; filename*=UTF-8''<encoded name>`, where the fallback replaces every non ASCII character with `_` (the schema already refuses `"`, `\`, `/` and control characters) and the encoded form is `encodeURIComponent(name)`, so non ASCII names survive and the header cannot be broken out of. `head` maps the SDK's `NotFound` (404) to `undefined` and lets any other error throw. Only `src/storage/**` and `scripts/r2-setup.ts` may import `@aws-sdk/*`, enforced by a `no-restricted-imports` pattern in `eslint.config.mjs` with an override for those two paths (plain hygiene, not a custom rule; the tenant rule stays the only bespoke one). Feature 14 (invoice PDF) is expected to write through this same port.

**API surface**:

All five Server Actions are `withTenantAction` wrappers returning the existing `Result<TData>` shape; the codes used all exist already: `validation` (with `fieldErrors`), `not_found`, `conflict`, `forbidden`, plus `subscription_inactive` from the access gate (spec 0008), which the wrapper applies to every write. Every one of the five checks `isStorageConfigured()` first and returns `conflict` with "File storage is not configured for this environment" when it is false (AC-18); the table below lists the errors past that check.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `requestUpload` | Server Action | projectId (uuid), name (1 to 255), contentType (allowlist member), sizeBytes (integer, 1 to 104857600) | `Result<{ deliverableId, uploadUrl, expiresAt }>` | requireStaff | in this order: `validation` (name, type, size), `not_found` (project not in this agency), `conflict` (project archived) |
| `confirmUpload` | Server Action | deliverableId (uuid) | `Result<{ status: "ready", sizeBytes, contentType }>` | requireStaff, row's uploader only | `not_found` (not pending and not ready, not mine, not here), `conflict` (object not there yet, retry), `validation` (object outside the rules, removed); a `ready` row of this agency returns `ok` with the stored values |
| `abandonUpload` | Server Action | deliverableId (uuid) | `Result<{ removed: boolean }>` | requireStaff, row's uploader only | `not_found` only when the row exists but is not the caller's pending row; a missing row is `ok` with `removed: false` |
| `setDeliverableVisibility` | Server Action | deliverableId (uuid), visibleToClient (boolean) | `Result<{ visibleToClient }>` | requireStaff | `not_found` (pending, other agency, nonexistent) |
| `deleteDeliverable` | Server Action | deliverableId (uuid) | `Result<{ removed: boolean }>` | requireStaff | `not_found` (pending, other agency), a storage failure returns `conflict` with "The file could not be removed from storage. Nothing was deleted; try again."; a missing row is `ok` with `removed: false` |
| `GET /deliverables/[id]/download` | Route handler at `src/app/deliverables/[id]/download/route.ts` (outside every route group, so the proxy requires a session but not an organization) | id (route param) | `302` to the presigned GET, or the app's 404 page, or the missing file page (404), or the storage not configured page (503) | staff of the owning agency (gate first, then row), or a contact under AC-13 | 404 for every refusal |
| `/projects/[id]` Deliverables section | Server Component read, replaces the spec 0010 placeholder | project id (route param) | the `ready` rows newest first with uploader name; the upload control or the not configured notice; the archived flag hides the control | requireStaff | the page's own not found; a section level error state on a failed read |
| `listDeliverables(ctx, projectId)` | query in `src/deliverables/queries.ts` | project id | `ready` rows joined to `users.name`, ordered `created_at desc, id desc` | staff accessor | none |
| `scripts/r2-setup.ts` | terminal script, `pnpm r2:setup` | env: `R2_ADMIN_ACCESS_KEY_ID`, `R2_ADMIN_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `NEXT_PUBLIC_APP_URL` | prints the CORS rule read back | the admin scoped token, never the app's | exits non zero without those five variables |

The download route resolves context with `tenantContext()` (staff when an organization claim is present, contact otherwise). For staff it runs `agencyAccess()` before reading any row and treats `unsubscribed` and `locked` the way the gated layout does (redirect to `/billing`), because a route handler sits outside the `(gated)` layout and would otherwise bypass spec 0008. For a contact no gate runs here; feature 15 owns the portal's gate. Its order is: storage configured (else the 503 page), context, gate (staff only), row, status and visibility rules, `head` (else the missing file page), redirect.

**The browser flow** (one client component, `src/deliverables/ui/upload-deliverable.tsx`):

1. Pick a file (`accept` mirrors the allowlist). Show name and size.
2. Call `requestUpload`. On `validation`, show the field error and stop.
3. `PUT` the file to `uploadUrl` with `XMLHttpRequest`, headers `Content-Type` and (set by the browser) `Content-Length`, updating the progress bar from `upload.onprogress`. A cancel button aborts the request.
4. On a 2xx, call `confirmUpload`. On `ok`, call `router.refresh()` so the list shows the new row. On `conflict`, wait two seconds and retry the confirm up to three times, then show "Your file is still being processed. Try again in a moment." with a button that re calls `confirmUpload` only (the bytes are already there). On `validation`, show "This file was removed because it did not match what was declared." with a retry that starts over from step 1 (pick a file again). On `not_found`, show "This upload was cancelled." and return to the idle state.
5. On a PUT error, a non 2xx status, or cancel, call `abandonUpload` without awaiting the result, and show "The upload did not finish." with a retry that starts over from step 2 (same file, new request).

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| every action and read | which agency's rows | tenant context (session), never a URL or form value (spec 0003) |
| requestUpload | the project's archived state | `projects.archived_at` via `db.findById`, refused when not null |
| requestUpload | `deliverables.id` and the object key | `newId()` from `src/lib/id.ts`, then `org/${ctx.orgId}/project/${projectId}/${id}` |
| requestUpload | `uploaded_by_user_id` | `ctx.userId` |
| requestUpload | `name`, declared `content_type`, declared `size_bytes` | input params, parsed by the Zod schema in `src/deliverables/schema.ts` |
| requestUpload | the allowlist and the cap | `ALLOWED_CONTENT_TYPES` and `MAX_UPLOAD_BYTES` in `src/deliverables/file-rules.ts`, a module with no server imports so the picker can share it |
| requestUpload | `uploadUrl` and `expiresAt` | `objectStorage().presignPut({ key, contentType, contentLength: sizeBytes, expiresInSeconds: 900 })`; `expiresAt` is now plus 900 seconds |
| every action | the not configured refusal | `isStorageConfigured()`, checked first; returned as `conflict` with the message "File storage is not configured for this environment", shown by the existing action error pattern |
| confirmUpload | the real `size_bytes` and `content_type` | `objectStorage().head(r2_key)`, never the input |
| confirmUpload | whether the flip landed | the tenant layer's `update` with `where: eq(deliverables.status, "pending")` (spec 0010's compare and set) |
| confirmUpload | the out of rules verdict | the read back type against `ALLOWED_CONTENT_TYPES` and size against `1..MAX_UPLOAD_BYTES` |
| abandonUpload, deleteDeliverable | the object key to delete | `deliverables.r2_key` |
| Deliverables section | the uploader's display name | `users.name` joined in `listDeliverables`; a scrubbed user already reads "Deleted user" (spec 0002) |
| Deliverables section | the human readable size | `formatBytes(size_bytes)` in `src/deliverables/format.ts` (1024 based, one decimal, `B`, `KB`, `MB`, `GB`) |
| Deliverables section | the short type label | `typeLabel(content_type)` in `file-rules.ts`, one label per allowlist entry ("PDF", "Word", "Excel", "PowerPoint", "Text", "CSV", "PNG", "JPEG", "GIF", "WebP", "SVG", "ZIP") |
| Deliverables section | the upload date | `created_at`, rendered by the same date formatter the projects list uses |
| Deliverables section | whether to show the upload control | `project.archived_at === null && isStorageConfigured()` |
| download route | the acting person's kind | `tenantContext().kind` |
| download route | the contact's client | `ContactContext.clientId`, and the tenant layer's contact predicate on `deliverables` (spec 0003) already restricts rows to that client's projects |
| download route | the project's archived state for a contact | `projects.archived_at` read through the contact accessor |
| download route | the staff gate verdict | `agencyAccess().level` (spec 0008) |
| download route | the signed GET | `objectStorage().presignGet({ key, filename: name, expiresInSeconds: 120 })` |
| download route | the missing file page copy | the row's `name`; the log line carries `deliverables.id` and `org_id` |
| download route | the storage not configured page copy | fixed strings in AC-18 |
| confirmUpload on a `ready` row | the returned size and type | the row's stored `size_bytes` and `content_type`, no `head` call |
| r2-setup script | the allowed origin | `NEXT_PUBLIC_APP_URL` (spec 0005 already reads it) |
| r2-setup script | its credentials | `R2_ADMIN_ACCESS_KEY_ID` and `R2_ADMIN_SECRET_ACCESS_KEY` through `env()`, never the app's `R2_ACCESS_KEY_ID` |
| every write | which paths to revalidate | `DELIVERABLE_REVALIDATE` in `src/deliverables/revalidate.ts`: `{ path: "/projects/[id]", type: "page" }` |

**Key invariants**:
- A `ready` row's `size_bytes` and `content_type` were read from R2, never from the browser.
- A `pending` row is invisible: not listed, not downloadable, not toggleable, not deletable except by its own uploader's abandon or the sweep.
- `r2_key` is never built from user text, never returned to the browser, and never a public URL; the bucket has no public access.
- The signed PUT fixes `Content-Type` and `Content-Length`; the signed GET fixes `attachment` disposition.
- Removal order is always object first, then row. A failed object delete leaves a visible row; a failed row delete leaves a row pointing nowhere, which AC-14 turns into a readable page and a log line, never a silent orphaned object.
- `status` only ever moves `pending` → `ready`, and only through a compare and set.
- Nothing outside `src/db/tenant/` imports the raw database handle; nothing outside `src/storage/` and `scripts/r2-setup.ts` imports the AWS SDK (the `no-restricted-imports` pattern above).
- Presigning never contacts R2; only `head` and `delete` do. A signed request never carries an SDK checksum header.

**Security model**:
- Staff (admin or member) of the owning agency: request, confirm (own rows), abandon (own rows), toggle, delete, download. No admin only action in this feature.
- A client contact: download only, under AC-13. The five Server Actions refuse a contact context through `withTenantAction`'s `requireStaff`.
- Another agency: every row looks nonexistent (`not_found` or 404), never `forbidden`.
- The R2 API token the app uses is scoped to one bucket with Object Read and Write only; the setup script's token (Admin Read and Write) lives only in the operator's shell.
- SVG and HTML like content is never rendered under any origin the app controls: downloads are always attachments from R2's own domain.
- Rate limiting of `requestUpload` is feature 19's job; until then the 100 MB cap and the 10 GB free tier are the only brakes, noted in Consequences.
- No regulated data scope is added: files are the agency's own work product, and nothing in this feature reads their contents.

**Configuration required**:
- `R2_ACCOUNT_ID`: the Cloudflare account id, forms the S3 endpoint host
- `R2_ACCESS_KEY_ID`: the bucket scoped token's key id
- `R2_SECRET_ACCESS_KEY`: the bucket scoped token's secret
- `R2_BUCKET`: the bucket name (one bucket per environment: local, preview, production)
- `R2_ADMIN_ACCESS_KEY_ID` and `R2_ADMIN_SECRET_ACCESS_KEY`: an Admin Read and Write token used by `scripts/r2-setup.ts` only; optional in every environment, never read by the app, never set on Vercel
- The four app variables are optional outside production and required in production by a cross field refinement in `src/lib/env.ts`, exactly as `RESEND_API_KEY` is handled. Prerequisite before building the real thread: a bucket per environment created in the Cloudflare dashboard, a bucket scoped token for the app, and the admin token for the operator running `pnpm r2:setup`.

**Critical test scenarios** (each maps to an acceptance criterion above):
- Happy path: `requestUpload` inserts a `pending` row and returns a signed URL, the fake storage records a put, `confirmUpload` copies the fake's size and type into the row and flips it to `ready`, `listDeliverables` now returns it, and the download route answers `302` with an `attachment` disposition; against real PostgreSQL in `src/deliverables/deliverables.db.test.ts`, verifies **AC-4**, **AC-6**, **AC-10**, **AC-12**.
- Failure case, confirm before the bytes land: the fake reports no object, the row stays `pending`, the action returns `conflict`, a second confirm after the fake receives the object succeeds, verifies **AC-6**.
- Failure case, confirm versus abandon race: a confirm whose compare and set finds the row already gone returns `not_found` and writes nothing; an out of rules confirm whose row an abandon removed first still deletes the object and returns `validation` without throwing, verifies **AC-6**, **AC-7**.
- Failure case, storage unconfigured: with the four variables absent, each of the five actions returns `conflict` with the fixed message before touching a row, and the download route answers the 503 page, verifies **AC-18**.
- Failure case, delete with a failing store: the fake throws on delete, `deleteDeliverable` returns `conflict`, the row is still there, verifies **AC-15**.
- Failure case, missing object: a `ready` row whose key the fake does not hold makes the download route answer the missing file page with 404 and one log line, verifies **AC-14**.
- Auth/permission: a staff member of agency B calling every action with agency A's id gets `not_found`; the download route answers 404 for agency B's staff, for a contact of another client, for a contact when `visible_to_client` is false, when the row is `pending`, and when the project is archived; a contact context calling any action is refused, verifies **AC-9**, **AC-13**, **AC-16**.
- Auth/permission: a second staff member of the same agency confirming or abandoning the first member's `pending` row gets `not_found`, verifies **AC-7**.
- Validation: a 0 byte file, a 100 MB + 1 byte file, a `application/x-msdownload` type, a 256 character name, a name with a control character, and a name containing `"` are each refused with a field error, verifies **AC-2**, **AC-3**.
- Signing: `presignPut` output carries `X-Amz-SignedHeaders` including `content-type` and `content-length` and no `x-amz-checksum-*` or `x-amz-sdk-checksum-algorithm` anywhere in the URL or signed headers, and `presignGet` output carries the `attachment` disposition with the ASCII fallback and the `filename*` form for a name such as `Rapport été "final".pdf`, unit tested on the real R2 implementation with dummy credentials (no network), verifies **AC-4**, **AC-12**.
- Signing, against the real bucket: a PUT to a signed URL with a different `Content-Type` than the one signed is refused by R2 with 403, and the correct one succeeds; a manual step in `verify.md`, the one proof that the signed headers bind, verifies **AC-4**.
- UI: the upload component moves through picking, uploading (progress announced), confirming, and done, and on a failed PUT shows the error, calls abandon, and offers retry, with axe clean in both themes; `e2e/deliverables.spec.ts` covers the section render, the empty state, and the not configured notice, verifies **AC-5**, **AC-18**, **AC-20**.
- Configuration: `env()` accepts a development environment without the four variables and rejects a production one, verifies **AC-18**.
- Bucket: `pnpm r2:setup` against a real bucket, then a real browser upload from the app origin, is a manual step in `verify.md` and the only proof that CORS plus the signature work together, verifies **AC-19**.

## Build plan

Ordered for Tracer Bullet: the thinnest end to end thread (a real file, picked in the browser, landing in a real bucket, confirmed, listed, and downloaded, tenant scoped) comes first, then each later task thickens one part of it. No migration: the data model is already in place. Task 1 is the one piece of infrastructure the thread cannot run without.

1. Configuration and the storage port: the four app `R2_*` variables and the two `R2_ADMIN_*` variables in `src/lib/env.ts` (the four optional outside production and required in production, the two optional everywhere, unit tested), `src/storage/port.ts`, `src/storage/r2.ts` on `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (client built inside a function with both checksum settings on `WHEN_REQUIRED`, `presignPut` with `signableHeaders` for `content-type` and `content-length`, `head` mapping 404 to `undefined`, `presignGet` with the sanitised and encoded disposition), `src/storage/fake.ts` with its throwing switch, `src/storage/index.ts` with `objectStorage()` and `isStorageConfigured()`, the `no-restricted-imports` pattern for `@aws-sdk/*` with the two path overrides; the signing unit tests including the no checksum header assertion. Satisfies **AC-4**, **AC-12**, **AC-18**.
2. The file rules and schemas: `src/deliverables/file-rules.ts` (`ALLOWED_CONTENT_TYPES`, `MAX_UPLOAD_BYTES`, `typeLabel`, the `accept` string derived from the list), `src/deliverables/format.ts` (`formatBytes`), and the Zod inputs in `src/deliverables/schema.ts` for all five actions; unit tests over every boundary in AC-2. Satisfies **AC-2**, **AC-3**.
3. One thread end to end: `requestUpload` (project active in this agency, `newId()`, the key, the `pending` insert, the signed PUT), `confirmUpload` (uploader check, `head`, the compare and set flip, the out of rules branch), `listDeliverables` with the uploader join, the Deliverables section replacing the spec 0010 placeholder with a minimal list and the upload component (pick, XHR PUT with progress, confirm, refresh), `DELIVERABLE_REVALIDATE`, and the download route for staff (`tenantContext`, `agencyAccess`, `ready` check, `head`, `302`); the database test proving the happy path and that agency B sees nothing. Run `pnpm r2:setup` (task 6's script may land here in its minimal form if the thread needs it first) and prove one real upload in the browser. Satisfies **AC-1**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-9**, **AC-10**, **AC-12**, **AC-16**.
4. Thicken the upload: `abandonUpload`, the browser's failure and cancel paths calling it, the confirm retry on `conflict` and the three result copies (`conflict` after retries, `validation`, `not_found`), the short circuit on a `ready` row, the progress bar labelling and live region, the archived project rule (no control, `conflict` at the action), the storage configured check first in all five actions, and the not configured notice; database tests for the missing object confirm, both confirm versus abandon races, the second staff member refusal, and the unconfigured refusal. Satisfies **AC-1**, **AC-6**, **AC-7**, **AC-8**, **AC-18**.
5. Manage: `setDeliverableVisibility` with the labelled switch, `deleteDeliverable` behind the confirm dialog with object first removal and the storage failure message, the section's per row controls, name duplicates allowed; database tests for idempotency, the failing store, and the `pending` refusals. Satisfies **AC-9**, **AC-11**, **AC-15**, **AC-17**.
6. The contact path and the two route pages: the download route's contact branch (`ready`, visible, project not archived, own client), the gate before row order for staff, the missing object page and its log line, the storage not configured page (503); database tests for every 404 case in AC-13 and the cross client refusal. Satisfies **AC-12**, **AC-13**, **AC-14**, **AC-18**.
7. Bucket setup: `scripts/r2-setup.ts` and the `r2:setup` package script (the admin token from `env()`, `PutBucketCors` from `NEXT_PUBLIC_APP_URL` with `PUT` and `Content-Type`, `GetBucketCors` read back, refuses without its five variables), `verify.md` steps for creating the buckets and the two tokens per environment, running the script, proving one browser upload, and proving the wrong `Content-Type` 403, and the seed's four deliverables given keys in the real layout. Satisfies **AC-4**, **AC-19**.
8. Empty state, error state, an accessibility pass (axe, both themes) across the section, the upload component in every phase, the switch, the confirm dialog, the not configured notice, the missing file page, and the storage not configured page; add each to `/design`; `e2e/deliverables.spec.ts` for the section render, the empty state, and the not configured notice. Satisfies **AC-10**, **AC-20**.

## Consequences

**Positive**:
- File bytes never pass through Vercel, so the 4.5 MB request body limit and the function timeout never apply, and R2's zero egress means client downloads cost nothing.
- The `pending` to `ready` promise makes a half finished upload impossible to see, and reading size and type back from R2 makes the browser's word irrelevant.
- The storage port has four functions and an in memory fake, so every deliverable test runs without a network and feature 14 gets its file store for free.
- Downloads are plain links: keyboard and screen reader native, shareable inside the agency, and reusable by the portal as is.
- Object first removal means a failure is always visible (a row pointing nowhere) rather than billable and invisible (an object nobody references).

**Negative / tradeoffs**:
- `@aws-sdk/client-s3` is a large dependency for four calls. It is server only and tree shaken, but it is the biggest package this project has added, and its release cadence is something to watch: the checksum default that R2 rejects arrived in a minor version, which is why both checksum settings are pinned to `WHEN_REQUIRED` and a unit test asserts no checksum header is signed.
- `XMLHttpRequest` for progress is older API in a React 19 codebase; the wrapper is small, but it is one more thing that does not look like the rest of the client code.
- A `HeadObject` on every download adds one R2 round trip (tens of milliseconds) before the redirect. At this product's volume that is invisible; at thousands of downloads a minute it would be worth revisiting.
- Until feature 19, nothing rate limits `requestUpload`; a hostile staff account could fill the free tier. The 100 MB cap and the daily sweep are the only brakes.
- No audit trail of deletions. A misdelete is fixed by uploading again, and there is no record of who removed what.
- CORS is per bucket and per origin, so each Vercel preview URL that needs real uploads needs its own bucket run through the setup script, or previews test with storage unconfigured.

**Neutral**:
- Two new Agent Skills (`aws-sdk-js-v3-usage`, `cloudflare-r2`) are installed and third party; skim them before trusting them.
- `src/storage/` is a new top level area and deserves its own `AGENTS.md` (Follow-up).
- The route handler for downloads is the first tenant scoped route handler in the app that is not a webhook or a cron; it sets the pattern for feature 14's PDF download.
- Feature 18's sweep gains a concrete contract: delete `pending` rows older than 24 hours through the storage port, object first.
- The seed's deliverable rows get keys in the real layout, but no objects; in development they show in the list and their download answers the missing file page, which is a fair way to see that page.

## Follow-up

- [ ] `aws-sdk-js-v3-usage` and `cloudflare-r2` conventions are not yet captured in an `AGENTS.md`. Both are area scoped: `src/storage/AGENTS.md` should carry them (client construction, the presigner, R2's endpoint and CORS quirks) before the build begins, with a one line pointer from root `AGENTS.md`; `/sync` owns those files.
- [ ] Root `AGENTS.md` `## Agent skills` lists neither new skill yet; add the two bullets there when `/sync` runs.
- [ ] Feature 18 (daily cron sweeps) should implement the abandoned upload sweep through `objectStorage().delete` with object first ordering, using the `(org_id, status, created_at)` index and the 24 hour cutoff fixed here.
- [ ] Feature 19 (rate limiting) should limit `requestUpload` per agency; the spec here leaves the hook point (the action name) and nothing else.
- [ ] Feature 15 (client portal) should reuse `GET /deliverables/[id]/download` unchanged and decide whether a contact's downloads are gated by the agency's subscription state.
- [ ] Feature 14 (invoice PDF) should write through the `src/storage/` port rather than adding a second client.
- [ ] Feature 20 (error tracking) should attach the missing file log line (AC-14) to Sentry once the SDK is installed; until then it is a server log.
- [ ] If previews need real uploads, decide between one shared preview bucket with a wildcard origin rule and per preview buckets; the setup script takes the origin from `NEXT_PUBLIC_APP_URL` either way.
- [ ] The allowlist in AC-3 is a first cut; legacy Office formats (`doc`, `xls`, `ppt`) and video are deliberately out. Extend the constant if agencies ask.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
