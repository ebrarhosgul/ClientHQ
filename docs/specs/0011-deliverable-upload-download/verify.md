# Verify: Deliverable upload & download · spec 0011 · updated 2026-09-14

_Steps derived from spec 0011 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Bucket setup (manual, once per environment)

- [ ] In the Cloudflare dashboard, create an R2 bucket for this environment (one each: local, preview, production) → bucket exists → AC-19
- [ ] Create a bucket scoped API token with Object Read and Write only; set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` for the app → the four `R2_*` variables are set → AC-18
- [ ] Create an Admin Read and Write token for the operator; export `R2_ADMIN_ACCESS_KEY_ID` and `R2_ADMIN_SECRET_ACCESS_KEY` in your own shell only (never on Vercel) → the two `R2_ADMIN_*` variables are set → AC-19
- [ ] Run `pnpm r2:setup` → prints the bucket's CORS rule read back via `GetBucketCors`, allowed origin `NEXT_PUBLIC_APP_URL`, method `PUT`, header `Content-Type` → AC-19
- [ ] Run `pnpm r2:setup` a second time → succeeds identically, no error → AC-19
- [ ] Run `pnpm r2:setup` with `R2_ADMIN_ACCESS_KEY_ID` unset → exits non zero with a message naming the missing variable → AC-19

## UI / manual (with the four `R2_*` app variables set)

- [ ] Open a project's page → the Deliverables section renders with an upload control → AC-1, AC-10
- [ ] Pick a file under 100 MB of an allowed type → a labelled progress bar appears and advances to 100% → AC-5
- [ ] After the PUT completes → the list refreshes and shows the new file as `ready`, with its real size and type → AC-4, AC-6, AC-10
- [ ] In the browser's network tab, confirm the PUT request went straight to the R2 host, never to this app's own origin → AC-5
- [ ] Pick a file with a different declared `Content-Type` than what the browser will actually send is not reproducible manually; instead see the signing unit test below → AC-4
- [ ] Attempt to `PUT` a signed URL's bytes with a different `Content-Type` header than the one signed (e.g. with `curl`) → R2 answers `403` → AC-4
- [ ] Toggle the "Visible to client" switch on a file → the value persists after a refresh → AC-11
- [ ] Delete a file, confirming the dialog → it disappears from the list and a repeat visit to its download link answers the app's 404 page → AC-15
- [ ] Archive the project → the upload control disappears from the Deliverables section, existing files still list and download → AC-1
- [ ] With the four `R2_*` variables unset, open the project page → the upload control is replaced by a "File storage is not configured" notice, and existing rows still list → AC-18
- [ ] With the four `R2_*` variables unset, visit any `/deliverables/[id]/download` → a "File storage is not configured" page, status `503` → AC-18
- [ ] As a client contact, visit `/deliverables/[id]/download` for a file with `visible_to_client` true on your own client's project → redirects to a download → AC-13
- [ ] As a client contact, visit the same route for a file that is `visible_to_client` false, or belongs to another client, or sits on an archived project → the app's 404 page → AC-13
- [ ] Visit `/design` in both themes → the Deliverables section, the upload control's phases, the switch, the empty state, the error state, the not configured notice, the missing file page mockup and the storage not configured page mockup all render and pass axe → AC-20

## Commands

- [ ] `pnpm vitest run src/storage` → the port, the fake, and the real R2 signing tests (dummy credentials, no network) pass → AC-4, AC-12, AC-18
- [ ] `pnpm vitest run src/deliverables` → file rules, format, schema and query unit tests pass → AC-2, AC-3, AC-9, AC-10
- [ ] `pnpm vitest run src/deliverables/deliverables.db.test.ts` (needs `DIRECT_URL`) → all 32 cases pass against real PostgreSQL: the happy path, both confirm races, the second staff member refusal, the storage failure on delete, every cross tenant and cross client refusal, and every download route branch → AC-1, AC-4, AC-6 through AC-9, AC-11 through AC-16
- [ ] `pnpm vitest run "src/app/deliverables"` → the download route's storage not configured and Clerk not configured branches pass with no database → AC-18
- [ ] `pnpm typecheck && pnpm lint && pnpm format:check` → clean
- [ ] `pnpm test:e2e -- deliverables` → the download route's degraded states and the gallery's Deliverables states pass axe in both themes → AC-20

## Acceptance-criteria coverage

- AC-1 (upload control gated on project status and archived state) · project page manual steps, `requestUpload`'s archived-project db test
- AC-2, AC-3 (validation, the allowlist) · `schema.test.ts`, `file-rules.test.ts`
- AC-4 (signed PUT, fixed headers, no R2 call, the real key) · `r2.test.ts`, `deliverables.db.test.ts`'s `requestUpload` happy path, the manual wrong `Content-Type` 403 step
- AC-5 (XHR upload, progress, live region) · manual UI steps
- AC-6, AC-7 (confirm rules, races, short circuit) · `deliverables.db.test.ts`'s `confirmUpload` cases
- AC-8 (abandon, best effort) · `deliverables.db.test.ts`'s `abandonUpload` cases
- AC-9 (a `pending` row is invisible everywhere) · `queries.test` shape in `deliverables.db.test.ts`'s `listDeliverables` case, the `not_found` cases on `setDeliverableVisibility`/`deleteDeliverable`/download
- AC-10 (the section itself) · `deliverables.db.test.ts`'s `listDeliverables` case, manual UI step, gallery
- AC-11 (the switch, idempotent) · `deliverables.db.test.ts`'s `setDeliverableVisibility` cases, manual UI step
- AC-12, AC-13 (download route, staff and contact) · `deliverables.db.test.ts`'s `GET` cases
- AC-14 (missing object page, logged) · `deliverables.db.test.ts`'s missing object case
- AC-15 (delete, object first) · `deliverables.db.test.ts`'s `deleteDeliverable` cases
- AC-16 (tenant scoping, contact refusal on all five actions) · every cross tenant case across the five action describe blocks, plus the explicit contact-forbidden case on `requestUpload`
- AC-17 (no name uniqueness) · not enforced anywhere; nothing to test beyond the schema not adding a constraint
- AC-18 (storage not configured) · `env.test.ts`'s R2 describe block, `deliverables.db.test.ts`'s unconfigured `requestUpload` case, `route.test.ts`'s 503 case, manual steps
- AC-19 (bucket setup script) · the bucket setup manual steps above
- AC-20 (accessibility, `/design`) · `e2e/deliverables.spec.ts`, `e2e/design-gallery.spec.ts`'s whole page axe run
